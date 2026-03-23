/**
 * LINBO Plugin - Sync Routes
 * Manual sync trigger, status, and read endpoints for synced data.
 *
 * Read endpoints serve data from Redis (populated by sync.service.js).
 * GET /sync/mode is public (needed before login).
 * All other endpoints require authentication.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const syncService = require('../services/sync.service');
const redis = require('../lib/redis');
const linboFs = require('../services/linbo-fs.service');
const { KEY, loadAllHostsFromRedis, loadAllConfigsFromRedis } = syncService;

const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';

// Auth middleware
const auth = require('../middleware/auth');
const authenticate = auth.authenticateToken;
const requireAdmin = auth.requireRole(['admin']);

// ---------------------------------------------------------------------------
// GET /sync/mode — Public (no auth required, needed before login)
// ---------------------------------------------------------------------------
const settingsService = require('../services/settings.service');

/**
 * @openapi
 * /sync/mode:
 *   get:
 *     tags: [Hosts & Configs]
 *     summary: Get current operating mode (sync or offline)
 *     description: >
 *       Returns whether sync mode is enabled. This endpoint is public
 *       (no authentication required) because the frontend needs the mode
 *       before the user has logged in.
 *     responses:
 *       200:
 *         description: Current mode and sync-enabled flag
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     mode:
 *                       type: string
 *                       enum: [sync, offline]
 *                     syncEnabled:
 *                       type: boolean
 */
router.get('/mode', async (req, res) => {
  let syncEnabled = process.env.SYNC_ENABLED === 'true';
  try {
    const syncSetting = await settingsService.get('sync_enabled');
    if (syncSetting === 'true') syncEnabled = true;
  } catch (err) {
    console.debug('[Sync] settings check failed:', err.message);
  }

  const mode = syncEnabled ? 'sync' : 'offline';

  res.json({
    data: {
      mode,
      syncEnabled,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /sync/status — Existing: sync cursor, counts, LMN API health
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /sync/status:
 *   get:
 *     tags: [Hosts & Configs]
 *     summary: Get sync engine status
 *     description: >
 *       Returns the current sync cursor, last sync timestamp, host/config
 *       counts, whether a sync is currently running, and LMN API health.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sync status object
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     cursor:
 *                       type: string
 *                       nullable: true
 *                     lastSyncAt:
 *                       type: string
 *                       nullable: true
 *                     lastError:
 *                       type: string
 *                       nullable: true
 *                     isRunning:
 *                       type: boolean
 *                     serverIp:
 *                       type: string
 *                       nullable: true
 *                     hosts:
 *                       type: integer
 *                     configs:
 *                       type: integer
 *                     lmnApiHealthy:
 *                       type: boolean
 *                     hostOfflineTimeoutSec:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 */
router.get('/status', authenticate, async (req, res, next) => {
  try {
    const status = await syncService.getSyncStatus();
    res.json({ data: status });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /sync/hosts — List hosts from Redis with runtime status
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /sync/hosts:
 *   get:
 *     tags: [Hosts & Configs]
 *     summary: List all synced hosts with runtime status
 *     description: >
 *       Returns all hosts from the Redis sync cache, enriched with
 *       runtimeStatus (online/offline) and lastSeen timestamp from
 *       host:status keys. Supports filtering by search term and hostgroup.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: school
 *         schema:
 *           type: string
 *           default: default-school
 *         description: School name for multi-school environments
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Filter by hostname, MAC, or IP (case-insensitive substring match)
 *       - in: query
 *         name: hostgroup
 *         schema:
 *           type: string
 *         description: Filter by exact hostgroup name
 *     responses:
 *       200:
 *         description: Array of host objects with runtime status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       mac:
 *                         type: string
 *                       hostname:
 *                         type: string
 *                       ip:
 *                         type: string
 *                       hostgroup:
 *                         type: string
 *                       runtimeStatus:
 *                         type: string
 *                         enum: [online, offline]
 *                       lastSeen:
 *                         type: string
 *                         nullable: true
 *       401:
 *         description: Unauthorized
 */
router.get('/hosts', authenticate, async (req, res, next) => {
  try {
    const client = redis.getClient();
    let hosts = await loadAllHostsFromRedis(client);

    // BASE-02: native filesystem fallback when store is empty (no sync has run yet)
    if (hosts.length === 0) {
      try {
        const nativeHosts = await linboFs.readHostsFromDevicesCsv();
        if (nativeHosts.length > 0) {
          console.log(`[Sync] /hosts: store empty, falling back to devices.csv (${nativeHosts.length} hosts)`);
          hosts.push(...nativeHosts);
        }
      } catch (err) {
        console.error('[Sync] /hosts: native fallback failed:', err.message);
      }
    }

    // Merge runtime status from host:status:{ip} hashes
    const enriched = await Promise.all(hosts.map(async (host) => {
      let runtimeStatus = 'offline';
      let lastSeen = null;

      if (host.ip) {
        try {
          const statusData = await client.hgetall(`host:status:${host.ip}`);
          if (statusData && statusData.status) {
            runtimeStatus = statusData.status;
            lastSeen = statusData.lastSeen || null;
          }
        } catch { /* ignore */ }
      }

      return { ...host, runtimeStatus, lastSeen };
    }));

    // Apply filters
    let filtered = enriched;

    const { search, hostgroup } = req.query;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(h =>
        (h.hostname && h.hostname.toLowerCase().includes(q)) ||
        (h.mac && h.mac.toLowerCase().includes(q)) ||
        (h.ip && h.ip.includes(q))
      );
    }

    if (hostgroup) {
      filtered = filtered.filter(h => h.hostgroup === hostgroup);
    }

    res.json({ data: filtered });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /sync/hosts/:mac — Single host from Redis
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /sync/hosts/{mac}:
 *   get:
 *     tags: [Hosts & Configs]
 *     summary: Get a single synced host by MAC address
 *     description: >
 *       Returns one host from the Redis sync cache, enriched with
 *       runtimeStatus and lastSeen from host:status keys.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: school
 *         schema:
 *           type: string
 *           default: default-school
 *         description: School name for multi-school environments
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: MAC address of the host (e.g. AA:BB:CC:DD:EE:FF)
 *     responses:
 *       200:
 *         description: Host object with runtime status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     mac:
 *                       type: string
 *                     hostname:
 *                       type: string
 *                     ip:
 *                       type: string
 *                     hostgroup:
 *                       type: string
 *                     runtimeStatus:
 *                       type: string
 *                       enum: [online, offline]
 *                     lastSeen:
 *                       type: string
 *                       nullable: true
 *       404:
 *         description: Host not found in sync cache
 *       401:
 *         description: Unauthorized
 */
router.get('/hosts/:mac', authenticate, async (req, res, next) => {
  try {
    const client = redis.getClient();
    const hostJson = await client.get(`${KEY.HOST}${req.params.mac}`);

    if (!hostJson) {
      return res.status(404).json({
        error: {
          code: 'HOST_NOT_FOUND',
          message: `Host with MAC ${req.params.mac} not found in sync cache`,
        },
      });
    }

    const host = JSON.parse(hostJson);

    // Merge runtime status
    let runtimeStatus = 'offline';
    let lastSeen = null;
    if (host.ip) {
      try {
        const statusData = await client.hgetall(`host:status:${host.ip}`);
        if (statusData && statusData.status) {
          runtimeStatus = statusData.status;
          lastSeen = statusData.lastSeen || null;
        }
      } catch { /* ignore */ }
    }

    res.json({ data: { ...host, runtimeStatus, lastSeen } });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /sync/configs — List configs from Redis
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /sync/configs:
 *   get:
 *     tags: [Hosts & Configs]
 *     summary: List all synced start.conf configurations
 *     description: >
 *       Returns all LINBO start.conf configurations from the Redis sync
 *       cache. Each config represents a parsed start.conf file.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: school
 *         schema:
 *           type: string
 *           default: default-school
 *         description: School name for multi-school environments
 *     responses:
 *       200:
 *         description: Array of configuration objects
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Unauthorized
 */
router.get('/configs', authenticate, async (req, res, next) => {
  try {
    const client = redis.getClient();
    let configs = await loadAllConfigsFromRedis(client);

    // BASE-02: native filesystem fallback when store is empty
    if (configs.length === 0) {
      try {
        const ids = await linboFs.listNativeStartConfIds();
        if (ids.length > 0) {
          console.log(`[Sync] /configs: store empty, falling back to native start.confs (${ids.length} configs)`);
          configs = ids.map(id => ({ id, content: null, source: 'native-fs', updatedAt: null }));
        }
      } catch (err) {
        console.error('[Sync] /configs: native fallback failed:', err.message);
      }
    }

    res.json({ data: configs });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /sync/configs/:id — Single config from Redis
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /sync/configs/{id}:
 *   get:
 *     tags: [Hosts & Configs]
 *     summary: Get a single synced configuration by ID
 *     description: >
 *       Returns one parsed start.conf configuration from the Redis sync cache.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: school
 *         schema:
 *           type: string
 *           default: default-school
 *         description: School name for multi-school environments
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Configuration ID (group name, e.g. "pc-raum201")
 *     responses:
 *       200:
 *         description: Configuration object
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *       404:
 *         description: Config not found in sync cache
 *       401:
 *         description: Unauthorized
 */
router.get('/configs/:id', authenticate, async (req, res, next) => {
  try {
    const client = redis.getClient();
    const configJson = await client.get(`${KEY.CONFIG}${req.params.id}`);

    if (!configJson) {
      return res.status(404).json({
        error: {
          code: 'CONFIG_NOT_FOUND',
          message: `Config '${req.params.id}' not found in sync cache`,
        },
      });
    }

    res.json({ data: JSON.parse(configJson) });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /sync/configs/:id/preview — Read start.conf file from filesystem
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /sync/configs/{id}/preview:
 *   get:
 *     tags: [Hosts & Configs]
 *     summary: Preview the raw start.conf file content
 *     description: >
 *       Reads the start.conf.{id} file from the LINBO filesystem and returns
 *       its raw text content. Useful for displaying or editing the file.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: school
 *         schema:
 *           type: string
 *           default: default-school
 *         description: School name for multi-school environments
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Configuration ID (group name, e.g. "pc-raum201")
 *     responses:
 *       200:
 *         description: Raw file content
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     content:
 *                       type: string
 *                       description: Raw text content of start.conf.{id}
 *       404:
 *         description: start.conf file not found on filesystem
 *       401:
 *         description: Unauthorized
 */
router.get('/configs/:id/preview', authenticate, async (req, res, next) => {
  try {
    const filePath = path.join(LINBO_DIR, `start.conf.${req.params.id}`);

    let content;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({
          error: {
            code: 'FILE_NOT_FOUND',
            message: `start.conf.${req.params.id} not found on filesystem`,
          },
        });
      }
      throw err;
    }

    res.json({ data: { content } });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /sync/stats — Aggregated statistics
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /sync/stats:
 *   get:
 *     tags: [Hosts & Configs]
 *     summary: Get aggregated sync statistics
 *     description: >
 *       Returns host counts (total, online, offline), config count,
 *       sync metadata (cursor, last sync, running state), LMN API
 *       health, and the host offline timeout setting.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: school
 *         schema:
 *           type: string
 *           default: default-school
 *         description: School name for multi-school environments
 *     responses:
 *       200:
 *         description: Aggregated statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     hosts:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: integer
 *                         online:
 *                           type: integer
 *                         offline:
 *                           type: integer
 *                     configs:
 *                       type: integer
 *                     sync:
 *                       type: object
 *                       properties:
 *                         cursor:
 *                           type: string
 *                           nullable: true
 *                         lastSyncAt:
 *                           type: string
 *                           nullable: true
 *                         isRunning:
 *                           type: boolean
 *                         lastError:
 *                           type: string
 *                           nullable: true
 *                     lmnApiHealthy:
 *                       type: boolean
 *                     hostOfflineTimeoutSec:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 */
router.get('/stats', authenticate, async (req, res, next) => {
  try {
    const client = redis.getClient();

    // Host counts
    const totalHosts = await client.scard(KEY.HOST_INDEX);

    // Count online hosts by scanning host:status:* keys
    let onlineHosts = 0;
    try {
      const hosts = await loadAllHostsFromRedis(client);
      const statusChecks = await Promise.all(hosts.map(async (h) => {
        if (!h.ip) return false;
        try {
          const statusData = await client.hgetall(`host:status:${h.ip}`);
          return statusData && statusData.status === 'online';
        } catch {
          return false;
        }
      }));
      onlineHosts = statusChecks.filter(Boolean).length;
    } catch { /* ignore */ }

    // Config count
    const totalConfigs = await client.scard(KEY.CONFIG_INDEX);

    // Sync metadata
    const syncStatus = await syncService.getSyncStatus();

    // LMN API health (already in syncStatus)
    const lmnApiHealthy = syncStatus.lmnApiHealthy;

    const hostOfflineTimeoutSec = Number(process.env.HOST_OFFLINE_TIMEOUT_SEC || 300);

    res.json({
      data: {
        hosts: {
          total: Number(totalHosts),
          online: onlineHosts,
          offline: Number(totalHosts) - onlineHosts,
        },
        configs: Number(totalConfigs),
        sync: {
          cursor: syncStatus.cursor,
          lastSyncAt: syncStatus.lastSyncAt,
          isRunning: syncStatus.isRunning,
          lastError: syncStatus.lastError,
        },
        lmnApiHealthy,
        hostOfflineTimeoutSec,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /sync/services/reload — Reload rsync and restart tftpd-hpa (BASE-03)
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /sync/services/reload:
 *   post:
 *     tags: [Hosts & Configs]
 *     summary: Reload rsync and restart tftpd-hpa via systemd
 *     description: >
 *       Sends SIGHUP to rsync (reload) and restarts tftpd-hpa.
 *       Requires admin role. Returns success/errors for each service.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Services reloaded (check success field for partial failures)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (admin role required)
 */
router.post('/services/reload', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const result = await linboFs.reloadLinboServices();
    res.json({
      data: {
        success: result.success,
        errors: result.errors,
        message: result.success ? 'Services reloaded' : 'Some services failed to reload',
      },
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /sync/trigger — Trigger a sync cycle (admin only)
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /sync/trigger:
 *   post:
 *     tags: [Hosts & Configs]
 *     summary: Trigger a sync cycle manually
 *     description: >
 *       Initiates a sync cycle that fetches hosts and configs from the
 *       LMN API. Requires admin role. Returns 409 if a sync
 *       is already in progress.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: school
 *         schema:
 *           type: string
 *           default: default-school
 *         description: School name for multi-school environments
 *     responses:
 *       200:
 *         description: Sync completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     success:
 *                       type: boolean
 *                     stats:
 *                       type: object
 *                       description: Counts of synced hosts and configs
 *                     message:
 *                       type: string
 *       409:
 *         description: A sync is already running
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (admin role required)
 */
router.post('/trigger', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { success, stats } = await syncService.syncOnce();
    res.json({
      data: {
        success,
        stats,
        message: 'Sync completed successfully',
      },
    });
  } catch (error) {
    if (error.message === 'Sync already in progress') {
      return res.status(409).json({
        error: {
          code: 'SYNC_IN_PROGRESS',
          message: 'A sync is already running. Please wait.',
        },
      });
    }
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /sync/reset — Reset sync cursor (admin only)
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /sync/reset:
 *   post:
 *     tags: [Hosts & Configs]
 *     summary: Reset the sync cursor
 *     description: >
 *       Clears the sync cursor so the next trigger performs a full
 *       snapshot sync instead of a delta sync. Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: school
 *         schema:
 *           type: string
 *           default: default-school
 *         description: School name for multi-school environments
 *     responses:
 *       200:
 *         description: Cursor reset confirmation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (admin role required)
 */
router.post('/reset', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await syncService.resetSync();
    res.json({
      data: {
        message: 'Sync cursor reset. Next trigger will perform a full sync.',
      },
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================================================
// Image Sync Endpoints
// ===========================================================================
let imageSyncService;
try {
  imageSyncService = require('../services/image-sync.service');
} catch (err) {
  console.warn('[Sync] Image sync service not available:', err.message);
}

// ---------------------------------------------------------------------------
// GET /sync/images/compare — Remote vs. local image comparison
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /sync/images/compare:
 *   get:
 *     tags: [Images]
 *     summary: Compare remote and local images
 *     description: >
 *       Returns a list of images with their status indicating whether they
 *       exist only on the remote LMN server (remote_only), only locally
 *       (local_only), are up to date (synced), or outdated.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of image comparison results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       status:
 *                         type: string
 *                         enum: [remote_only, local_only, synced, outdated]
 *                       pushable:
 *                         type: boolean
 *       401:
 *         description: Unauthorized
 *       503:
 *         description: Image sync service not available
 */
router.get('/images/compare', authenticate, async (req, res, next) => {
  if (!imageSyncService) {
    return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Image sync service not available' } });
  }
  try {
    const comparison = await imageSyncService.compareImages();
    res.json({ data: comparison });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /sync/images/pull — Start image download (admin only)
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /sync/images/pull:
 *   post:
 *     tags: [Images]
 *     summary: Start image download from LMN server
 *     description: >
 *       Queues a download job for one image or all remote-only/outdated images.
 *       Pass either imageName for a single image or all:true to pull every
 *       image that is remote_only or outdated. Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               imageName:
 *                 type: string
 *                 description: Name of the image to pull (mutually exclusive with all)
 *               all:
 *                 type: boolean
 *                 description: Pull all remote-only or outdated images
 *     responses:
 *       200:
 *         description: Pull job(s) created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   oneOf:
 *                     - type: object
 *                       description: Single job object
 *                     - type: object
 *                       properties:
 *                         jobs:
 *                           type: array
 *                           items:
 *                             type: object
 *                         count:
 *                           type: integer
 *       400:
 *         description: Validation error (neither imageName nor all provided)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (admin role required)
 *       503:
 *         description: Image sync service not available
 */
router.post('/images/pull', authenticate, requireAdmin, async (req, res, next) => {
  if (!imageSyncService) {
    return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Image sync service not available' } });
  }
  try {
    const { imageName, all } = req.body;

    if (all) {
      // Pull all remote-only or outdated images
      const comparison = await imageSyncService.compareImages();
      const toPull = comparison.filter(i => i.status === 'remote_only' || i.status === 'outdated');
      const jobs = [];
      for (const img of toPull) {
        const job = await imageSyncService.pullImage(img.name);
        jobs.push(job);
      }
      return res.json({ data: { jobs, count: jobs.length } });
    }

    if (!imageName) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'imageName or all:true required' } });
    }

    const job = await imageSyncService.pullImage(imageName);
    res.json({ data: job });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /sync/images/queue — Current download queue
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /sync/images/queue:
 *   get:
 *     tags: [Images]
 *     summary: Get current image pull (download) queue
 *     description: >
 *       Returns the list of pending and in-progress image download jobs.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of pull job objects
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Unauthorized
 *       503:
 *         description: Image sync service not available
 */
router.get('/images/queue', authenticate, async (req, res, next) => {
  if (!imageSyncService) {
    return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Image sync service not available' } });
  }
  try {
    const queue = await imageSyncService.getQueue();
    res.json({ data: queue });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// DELETE /sync/images/queue/:jobId — Cancel a download job
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /sync/images/queue/{jobId}:
 *   delete:
 *     tags: [Images]
 *     summary: Cancel an image pull job
 *     description: >
 *       Cancels a pending or in-progress image download job by its ID.
 *       Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the pull job to cancel
 *     responses:
 *       200:
 *         description: Job cancelled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     cancelled:
 *                       type: boolean
 *       404:
 *         description: Job not found or already completed
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (admin role required)
 *       503:
 *         description: Image sync service not available
 */
router.delete('/images/queue/:jobId', authenticate, requireAdmin, async (req, res, next) => {
  if (!imageSyncService) {
    return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Image sync service not available' } });
  }
  try {
    const result = await imageSyncService.cancelJob(req.params.jobId);
    if (!result.cancelled) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: result.error } });
    }
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// ===========================================================================
// Image Push Endpoints
// ===========================================================================
let imagePushService;
try {
  imagePushService = require('../services/image-push.service');
} catch (err) {
  console.warn('[Sync] Image push service not available:', err.message);
}

// ---------------------------------------------------------------------------
// POST /sync/images/push — Start image upload to LMN server (admin only)
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /sync/images/push:
 *   post:
 *     tags: [Images]
 *     summary: Start image upload to LMN server
 *     description: >
 *       Queues an upload job for one image or all pushable images.
 *       Pass either imageName for a single image or all:true to push every
 *       pushable image (determined by image comparison). Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               imageName:
 *                 type: string
 *                 description: Name of the image to push (mutually exclusive with all)
 *               all:
 *                 type: boolean
 *                 description: Push all pushable images
 *     responses:
 *       200:
 *         description: Push job(s) created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   oneOf:
 *                     - type: object
 *                       description: Single job object
 *                     - type: object
 *                       properties:
 *                         jobs:
 *                           type: array
 *                           items:
 *                             type: object
 *                         count:
 *                           type: integer
 *       400:
 *         description: Validation error (neither imageName nor all provided)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (admin role required)
 *       503:
 *         description: Image push or sync service not available
 */
router.post('/images/push', authenticate, requireAdmin, async (req, res, next) => {
  if (!imagePushService) {
    return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Image push service not available' } });
  }
  try {
    const { imageName, all } = req.body;

    if (all) {
      if (!imageSyncService) {
        return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Image sync service not available (needed for compare)' } });
      }
      const comparison = await imageSyncService.compareImages();
      const toPush = comparison.filter(i => i.pushable);
      const jobs = [];
      for (const img of toPush) {
        const job = await imagePushService.pushImage(img.name);
        jobs.push(job);
      }
      return res.json({ data: { jobs, count: jobs.length } });
    }

    if (!imageName) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'imageName or all:true required' } });
    }

    const job = await imagePushService.pushImage(imageName);
    res.json({ data: job });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: { code: 'PUSH_ERROR', message: error.message } });
    }
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /sync/images/push/queue — Current push queue
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /sync/images/push/queue:
 *   get:
 *     tags: [Images]
 *     summary: Get current image push (upload) queue
 *     description: >
 *       Returns the list of pending and in-progress image upload jobs.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of push job objects
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Unauthorized
 *       503:
 *         description: Image push service not available
 */
router.get('/images/push/queue', authenticate, async (req, res, next) => {
  if (!imagePushService) {
    return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Image push service not available' } });
  }
  try {
    const queue = await imagePushService.getQueue();
    res.json({ data: queue });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// DELETE /sync/images/push/queue/:jobId — Cancel a push job
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /sync/images/push/queue/{jobId}:
 *   delete:
 *     tags: [Images]
 *     summary: Cancel an image push job
 *     description: >
 *       Cancels a pending or in-progress image upload job by its ID.
 *       Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the push job to cancel
 *     responses:
 *       200:
 *         description: Job cancelled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     cancelled:
 *                       type: boolean
 *       404:
 *         description: Job not found or already completed
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (admin role required)
 *       503:
 *         description: Image push service not available
 */
router.delete('/images/push/queue/:jobId', authenticate, requireAdmin, async (req, res, next) => {
  if (!imagePushService) {
    return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Image push service not available' } });
  }
  try {
    const result = await imagePushService.cancelJob(req.params.jobId);
    if (!result.cancelled) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: result.error } });
    }
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /sync/images/push/test — Test connection to LMN API (admin only)
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /sync/images/push/test:
 *   post:
 *     tags: [Images]
 *     summary: Test connection to the LMN API for image push
 *     description: >
 *       Attempts to reach the LMN API /images/manifest endpoint and reports
 *       whether the connection succeeded. Requires admin role. Always returns
 *       200 with a connected flag (never errors to the client).
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Connection test result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     connected:
 *                       type: boolean
 *                     imageCount:
 *                       type: integer
 *                       description: Number of images on the remote (only if connected)
 *                     url:
 *                       type: string
 *                       description: LMN API URL that was tested
 *                     error:
 *                       type: string
 *                       description: Error message (only if not connected)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (admin role required)
 */
router.post('/images/push/test', authenticate, requireAdmin, async (req, res, _next) => {
  try {
    const lmnApiClient = require('../lib/lmn-api-client');
    const settings = require('../services/settings.service');
    const lmnApiUrl = await settings.get('lmn_api_url');

    const response = await lmnApiClient.request('/images/manifest');

    if (response.ok) {
      const data = await response.json();
      res.json({
        data: {
          connected: true,
          imageCount: data.images ? data.images.length : 0,
          url: lmnApiUrl,
        },
      });
    } else {
      res.json({
        data: {
          connected: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          url: lmnApiUrl,
        },
      });
    }
  } catch (error) {
    res.json({
      data: {
        connected: false,
        error: error.message,
      },
    });
  }
});

module.exports = router;
