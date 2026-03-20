/**
 * LINBO Plugin - Internal Routes
 * Internal API endpoints for RSYNC hooks and service-to-service communication
 * Redis-only mode — no Prisma/PostgreSQL dependencies.
 */

const express = require('express');
const router = express.Router();

// Once-flag: suppress repeated Redis host lookup warnings
let _redisWarnLogged = false;
const ws = require('../lib/websocket');
const redisLib = require('../lib/redis');

// Internal API key for service-to-service authentication
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'linbo-internal-secret';

/**
 * Middleware to authenticate internal requests
 */
function authenticateInternal(req, res, next) {
  const apiKey = req.headers['x-internal-key'];

  if (!apiKey || apiKey !== INTERNAL_API_KEY) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or missing internal API key',
      },
    });
  }

  next();
}

/**
 * POST /internal/rsync-event
 * Handle RSYNC pre/post events from rsync hooks
 */
router.post('/rsync-event', authenticateInternal, async (req, res, next) => {
  try {
    const { event, module, clientIp, request, filename, relativePath } = req.body;

    console.log(`[Internal] RSYNC event: ${event} from ${clientIp} (${module})`);

    // Try to find the host by IP — Redis sync cache only
    let host = null;
    if (clientIp) {
      host = await findHostByIp(clientIp);
    }

    // Broadcast event based on type
    switch (event) {
      case 'pre-download':
        ws.broadcast('rsync.download.started', {
          clientIp,
          module,
          request,
          hostname: host?.hostname,
          timestamp: new Date(),
        });

        // Update host last seen + mark online (Redis-based)
        if (host) {
          await updateHostStatus(clientIp, host, 'online');
        }
        break;

      case 'post-download':
        ws.broadcast('rsync.download.completed', {
          clientIp,
          module,
          request,
          hostname: host?.hostname,
          timestamp: new Date(),
        });
        break;

      case 'pre-upload':
        ws.broadcast('rsync.upload.started', {
          clientIp,
          module,
          request,
          filename,
          hostname: host?.hostname,
          timestamp: new Date(),
        });

        // Update host status to 'uploading' (Redis-based)
        if (host) {
          await updateHostStatus(clientIp, host, 'uploading');
        }
        break;

      case 'post-upload':
        ws.broadcast('rsync.upload.completed', {
          clientIp,
          module,
          filename,
          hostname: host?.hostname,
          timestamp: new Date(),
        });

        // Handle image or sidecar upload
        if (filename) {
          const { IMAGE_EXTS, parseSidecarFilename } = require('../lib/image-path');
          if (IMAGE_EXTS.some(ext => filename.endsWith(ext))) {
            await handleImageUpload(filename, clientIp, host, relativePath);
          } else {
            const sidecar = parseSidecarFilename(filename);
            if (sidecar) {
              handleSidecarUpload(sidecar.imageFilename, sidecar.sidecarExt, clientIp);
            }
          }
        }

        // Update host status back to 'online' (Redis-based)
        if (host) {
          await updateHostStatus(clientIp, host, 'online');
        }
        break;

      default:
        console.log(`[Internal] Unknown RSYNC event: ${event}`);
    }

    res.json({ data: { received: true, event, host: host?.hostname } });
  } catch (error) {
    next(error);
  }
});

/**
 * Handle image upload completion — filesystem operations only, no DB.
 * Ensures subdirectory layout, reads MD5, broadcasts WebSocket event.
 */
async function handleImageUpload(filename, clientIp, host, relativePath) {
  const {
    parseMainFilename,
    resolveImageDir,
    resolveImagePath,
    resolveSidecarPath,
    toRelativePath,
  } = require('../lib/image-path');
  const fs = require('fs').promises;

  // Validate filename
  let parsed;
  try {
    parsed = parseMainFilename(filename);
  } catch (err) {
    console.error(`[Internal] Invalid image filename "${filename}": ${err.message}`);
    return;
  }

  // Validate relativePath from rsync hook (informational)
  const expectedRelPath = toRelativePath(filename);
  const normalizedRelPath = (relativePath || '').replace(/^\/+/, '');
  if (normalizedRelPath && normalizedRelPath !== expectedRelPath) {
    console.warn(`[Internal] rsync relativePath mismatch: got="${normalizedRelPath}", expected="${expectedRelPath}" — using server-computed`);
  }

  // Ensure image subdirectory exists
  const imageDir = resolveImageDir(filename);
  try {
    await fs.mkdir(imageDir, { recursive: true });
  } catch (err) {
    console.error(`[Internal] Failed to create image dir ${imageDir}:`, err.message);
  }

  // Determine image type
  const type = filename.endsWith('.qdiff') ? 'differential' : 'base';

  const { LINBO_DIR } = require('../lib/image-path');
  const path = require('path');
  const filepath = resolveImagePath(filename);
  const relPath = toRelativePath(filename);

  // Get file info — check canonical path first, then flat path as fallback
  let size = null;
  let checksum = null;
  try {
    const stat = await fs.stat(filepath);
    size = stat.size;
  } catch {
    // Fallback: check flat path (legacy client uploaded to /srv/linbo/<filename>)
    const flatPath = path.join(LINBO_DIR, filename);
    try {
      const stat = await fs.stat(flatPath);
      size = stat.size;
      // Move flat file to canonical subdirectory
      console.warn(`[Internal] Legacy flat upload detected: ${flatPath} → ${filepath}`);
      try {
        await fs.rename(flatPath, filepath);
        console.log(`[Internal] Moved ${filename} to ${filepath}`);
        // Also move sidecars if they exist
        for (const sfx of ['.md5', '.info', '.desc', '.torrent', '.macct']) {
          try {
            await fs.rename(flatPath + sfx, filepath + sfx);
          } catch { /* sidecar doesn't exist */ }
        }
      } catch (moveErr) {
        console.error(`[Internal] Failed to move ${flatPath} → ${filepath}:`, moveErr.message);
      }
    } catch {
      console.error(`[Internal] Image file not found at ${filepath} or ${flatPath}`);
    }
  }

  // Try to read MD5 sidecar
  try {
    const md5Path = resolveSidecarPath(filename, '.md5');
    checksum = await fs.readFile(md5Path, 'utf8');
    checksum = checksum.trim();
  } catch {
    // Also check flat MD5 as fallback
    try {
      const flatMd5 = path.join(LINBO_DIR, filename + '.md5');
      checksum = await fs.readFile(flatMd5, 'utf8');
      checksum = checksum.trim();
    } catch {
      // MD5 file doesn't exist
    }
  }

  // Broadcast image event (no DB registration)
  ws.broadcast('image.updated', {
    filename,
    type,
    size,
    checksum,
    path: relPath,
    uploadedBy: host?.hostname || clientIp,
  });

  console.log(`[Internal] Image upload processed: ${filename} (path=${relPath}, size=${size}, checksum=${checksum || 'n/a'})`);
}

// =============================================================================
// Sidecar handling
// =============================================================================

/**
 * Rate-limited warning for sidecars arriving before their image
 */
const sidecarWarnCache = new Map();
const SIDECAR_WARN_MAX = 200;
const SIDECAR_WARN_TTL = 10 * 60 * 1000;

function shouldWarnSidecarBeforeImage(imageFilename) {
  const now = Date.now();
  // Cleanup old entries when map is full
  if (sidecarWarnCache.size > SIDECAR_WARN_MAX) {
    for (const [k, v] of sidecarWarnCache) {
      if (now - v > SIDECAR_WARN_TTL) sidecarWarnCache.delete(k);
    }
  }
  const last = sidecarWarnCache.get(imageFilename);
  if (last && now - last < 60_000) return false; // max 1x/min per filename
  sidecarWarnCache.set(imageFilename, now);
  return true;
}

/**
 * Parse .info timestamp format "202601271107" → ISO string (UTC)
 */
function parseInfoTimestamp(raw) {
  if (!raw || typeof raw !== 'string' || raw.length < 12) return null;
  const clean = raw.replace(/['"]/g, '');
  if (clean.length < 12) return null;
  const year = parseInt(clean.slice(0, 4), 10);
  const month = parseInt(clean.slice(4, 6), 10) - 1; // 0-indexed
  const day = parseInt(clean.slice(6, 8), 10);
  const hour = parseInt(clean.slice(8, 10), 10);
  const min = parseInt(clean.slice(10, 12), 10);
  if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hour) || isNaN(min)) return null;
  const d = new Date(Date.UTC(year, month, day, hour, min));
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Read and parse a .info file for an image.
 * Returns { imageInfo, infoUpdatedAt, size?, uploadedAt? } or null.
 */
async function readInfoFile(imageFilename) {
  const { resolveSidecarPath, INFO_KEYS } = require('../lib/image-path');
  const fs = require('fs').promises;

  const infoPath = resolveSidecarPath(imageFilename, '.info');
  let content;
  try {
    content = await fs.readFile(infoPath, 'utf8');
  } catch {
    return null;
  }

  const parsed = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+)="(.*)"/);
    if (match) {
      const [, key, value] = match;
      if (INFO_KEYS.includes(key)) {
        parsed[key] = value;
      }
    }
  }

  // Cross-check image field
  if (parsed.image && parsed.image !== imageFilename) {
    if (shouldWarnSidecarBeforeImage(`info-mismatch:${imageFilename}`)) {
      console.warn(`[Internal] .info image mismatch: file says "${parsed.image}", expected "${imageFilename}"`);
    }
  }

  const result = { imageInfo: { ...parsed }, infoUpdatedAt: new Date() };

  // Parse timestamp
  if (parsed.timestamp) {
    const isoTs = parseInfoTimestamp(parsed.timestamp);
    if (isoTs) {
      result.imageInfo.timestampRaw = parsed.timestamp;
      result.imageInfo.timestamp = isoTs;
      result.uploadedAt = new Date(isoTs);
    }
  }

  // Parse imagesize → size
  if (parsed.imagesize) {
    const sizeNum = parseInt(parsed.imagesize, 10);
    if (!isNaN(sizeNum) && sizeNum > 0) {
      result.size = sizeNum;
    }
  }

  return result;
}

/**
 * Handle sidecar file upload — no-op in Redis-only mode.
 * Sidecar metadata was previously stored in Prisma; now sidecars are
 * simply files on disk and need no DB tracking.
 */
function handleSidecarUpload(imageFilename, sidecarExt, _clientIp) {
  console.log(`[Internal] Sidecar ${sidecarExt} uploaded for ${imageFilename} (no DB registration in sync mode)`);
}

/**
 * POST /internal/client-status
 * Update client status (called by LINBO client during boot)
 */
router.post('/client-status', authenticateInternal, async (req, res, next) => {
  try {
    const { clientIp, status, cacheInfo, hardware, osRunning } = req.body;

    if (!clientIp) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'clientIp is required',
        },
      });
    }

    // Find host by IP (Redis-based)
    const host = await findHostByIp(clientIp);

    if (!host) {
      console.log(`[Internal] Unknown client: ${clientIp}`);
      return res.json({ data: { registered: false, message: 'Unknown client' } });
    }

    // Update host status in Redis
    const effectiveStatus = status || 'online';
    await updateHostStatus(clientIp, host, effectiveStatus);

    // Broadcast status change
    ws.broadcast('host.status.changed', {
      hostname: host.hostname,
      status: effectiveStatus,
      lastSeen: new Date(),
    });

    res.json({
      data: {
        registered: true,
        hostname: host.hostname,
        hostgroup: host.hostgroup,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /internal/config/:identifier
 * Get start.conf for a host (by IP, MAC, or hostname).
 * Reads the file directly from /srv/linbo/ filesystem.
 * Sync service creates: start.conf.{group}, start.conf-{ip}, start.conf-{mac}
 */
router.get('/config/:identifier', async (req, res, next) => {
  try {
    const { identifier } = req.params;
    const fs = require('fs').promises;
    const path = require('path');
    const { LINBO_DIR } = require('../lib/image-path');

    // Try multiple filename patterns:
    // 1. start.conf-{identifier} (IP or MAC symlink created by sync)
    // 2. start.conf.{identifier} (group config file)
    const candidates = [
      path.join(LINBO_DIR, `start.conf-${identifier}`),
      path.join(LINBO_DIR, `start.conf.${identifier}`),
    ];

    for (const confPath of candidates) {
      try {
        const content = await fs.readFile(confPath, 'utf8');
        return res.type('text/plain').send(content);
      } catch {
        // Try next candidate
      }
    }

    return res.status(404).json({
      error: {
        code: 'CONFIG_NOT_FOUND',
        message: `No start.conf found for identifier "${identifier}"`,
      },
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// Redis-based host status helpers
// =============================================================================

const HOST_OFFLINE_TIMEOUT_SEC = parseInt(process.env.HOST_OFFLINE_TIMEOUT_SEC, 10) || 600;

/**
 * Find host by IP from Redis sync cache via O(1) secondary index.
 * Uses sync:host:ip:{ip} -> MAC, then sync:host:{mac} -> JSON.
 * Returns null if not found.
 */
async function findHostByIp(clientIp) {
  try {
    const client = redisLib.getClient();
    const mac = await client.get(`sync:host:ip:${clientIp}`);
    if (!mac) return null;
    const json = await client.get(`sync:host:${mac}`);
    return json ? JSON.parse(json) : null;
  } catch (err) {
    if (!_redisWarnLogged) {
      console.debug('[Internal] Redis host lookup failed:', err.message);
      _redisWarnLogged = true;
    }
  }

  return null;
}

/**
 * Update host runtime status in Redis (TTL-based, not persisted to DB).
 */
async function updateHostStatus(clientIp, host, status) {
  try {
    const client = redisLib.getClient();
    const now = Date.now();
    await client.hset(`host:status:${clientIp}`, {
      status,
      lastSeen: String(now),
      hostname: host.hostname || '',
      mac: host.mac || host.macAddress || '',
    });
    await client.expire(`host:status:${clientIp}`, HOST_OFFLINE_TIMEOUT_SEC);

    ws.broadcast('host.status.changed', {
      hostname: host.hostname,
      status,
      lastSeen: new Date(now),
    });
  } catch (err) {
    console.error('[Internal] Failed to update host status:', err.message);
  }
}

// Export internals for testing
router._testExports = {
  parseInfoTimestamp,
  readInfoFile,
  shouldWarnSidecarBeforeImage,
  sidecarWarnCache,
  findHostByIp,
};

module.exports = router;
