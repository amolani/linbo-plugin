/**
 * LINBO Plugin - Image Sync Service
 *
 * Downloads QCOW2 images from the LMN API via HTTP Range requests.
 * Features: resume support, MD5 verification, atomic directory swap,
 * Redis-backed job queue, WebSocket progress.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const redis = require('../lib/redis');
const ws = require('../lib/websocket');

const settings = require('./settings.service');
const IMAGES_DIR = path.join(process.env.LINBO_DIR || '/srv/linbo', 'images');
const INCOMING_DIR = path.join(IMAGES_DIR, '.incoming');
const MANIFEST_CACHE_TTL = 60; // seconds
const PROGRESS_INTERVAL = 2000; // ms between WS progress events
const BWLIMIT_MBPS = Number(process.env.IMAGE_SYNC_BWLIMIT_MBPS || 0);

// Redis keys
const KEY = {
  MANIFEST_CACHE: 'imgsync:manifest_cache',
  LOCK: 'imgsync:lock',
  CURRENT: 'imgsync:current',
  QUEUE: 'imgsync:queue',
  JOB_PREFIX: 'imgsync:job:',
};

// In-memory refs for the currently running download (not persisted)
let activeAbort = null;   // AbortController
let activeStream = null;  // fs.WriteStream

/**
 * Make an authenticated request to the LMN API.
 * @param {string} urlPath - API path
 * @param {object} options - fetch options
 * @param {object} config - optional override for url/key (from snapshot)
 */
async function lmnFetch(urlPath, options = {}, _config = {}) {
  const lmnApiClient = require('../lib/lmn-api-client');
  return lmnApiClient.request(urlPath, options);
}

// ---------------------------------------------------------------------------
// Manifest + Local Scan + Compare
// ---------------------------------------------------------------------------

/**
 * Fetch the remote image manifest from the LMN API (60s Redis cache).
 */
async function getRemoteManifest() {
  const client = redis.getClient();

  // Check cache
  const cached = await client.get(KEY.MANIFEST_CACHE);
  if (cached) {
    try { return JSON.parse(cached); } catch { /* fall through */ }
  }

  const res = await lmnFetch('/images/manifest');
  if (!res.ok) {
    throw new Error(`Failed to fetch image manifest: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const images = data.images || [];

  // Cache in Redis
  await client.setex(KEY.MANIFEST_CACHE, MANIFEST_CACHE_TTL, JSON.stringify(images));
  return images;
}

/**
 * Scan local IMAGES_DIR for image directories.
 */
async function getLocalImages() {
  const images = [];
  let entries;
  try {
    entries = await fsp.readdir(IMAGES_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const dirPath = path.join(IMAGES_DIR, entry.name);
    let files;
    try {
      files = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch { continue; }

    const fileList = [];
    let totalSize = 0;
    let modifiedAt = null;

    for (const f of files) {
      if (!f.isFile()) continue;
      try {
        const st = await fsp.stat(path.join(dirPath, f.name));
        fileList.push({ name: f.name, size: st.size });
        totalSize += st.size;
        if (f.name.endsWith('.qcow2')) {
          modifiedAt = st.mtime.toISOString();
        }
      } catch { /* skip */ }
    }

    if (fileList.length === 0) continue;

    images.push({
      name: entry.name,
      totalSize,
      files: fileList,
      modifiedAt,
    });
  }

  return images;
}

/**
 * Compare remote manifest with local images.
 * Status: synced | outdated | remote_only | local_only
 */
async function compareImages() {
  const [remote, local] = await Promise.all([
    getRemoteManifest(),
    getLocalImages(),
  ]);

  const localMap = new Map(local.map(i => [i.name, i]));
  const remoteMap = new Map(remote.map(i => [i.name, i]));
  const allNames = new Set([...remoteMap.keys(), ...localMap.keys()]);
  const results = [];

  for (const name of allNames) {
    const r = remoteMap.get(name) || null;
    const l = localMap.get(name) || null;

    let status;
    if (r && l) {
      // Both exist — compare
      const remoteQcow2Size = Number(r.imagesize || 0) || r.totalSize;
      const localQcow2 = l.files.find(f => f.name.endsWith('.qcow2'));
      const localQcow2Size = localQcow2 ? localQcow2.size : 0;

      if (r.checksum) {
        // MD5 comparison would require local MD5 — for now use size
        status = remoteQcow2Size === localQcow2Size ? 'synced' : 'outdated';
      } else {
        // No checksum: compare qcow2 file size
        status = remoteQcow2Size === localQcow2Size ? 'synced' : 'outdated';
      }
    } else if (r && !l) {
      status = 'remote_only';
    } else {
      status = 'local_only';
    }

    const pushable = status === 'local_only' || (status === 'outdated' && l !== null);
    results.push({ name, remote: r, local: l, status, pushable });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Download Queue + Worker
// ---------------------------------------------------------------------------

function generateJobId() {
  return `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Pull an image. If a download is already running, queue it.
 */
async function pullImage(imageName) {
  const client = redis.getClient();
  const jobId = generateJobId();

  const job = {
    jobId,
    imageName,
    status: 'queued',
    progress: 0,
    speed: 0,
    eta: 0,
    bytesDownloaded: 0,
    totalBytes: 0,
    error: null,
    startedAt: null,
    queuedAt: new Date().toISOString(),
  };

  // Save job
  await client.hmset(`${KEY.JOB_PREFIX}${jobId}`, flattenJob(job));
  await client.expire(`${KEY.JOB_PREFIX}${jobId}`, 86400); // 24h TTL

  // Try to acquire lock
  const acquired = await client.set(KEY.LOCK, jobId, 'NX', 'EX', 3600);
  if (acquired) {
    // We got the lock — start immediately
    await client.set(KEY.CURRENT, JSON.stringify(job));
    ws.broadcast('image.sync.queued', { jobId, imageName });
    // Start async (don't await — returns immediately)
    _runDownload(jobId, imageName).catch(err => {
      console.error(`[ImageSync] Download failed for ${imageName}:`, err.message);
    });
  } else {
    // Queue it
    await client.rpush(KEY.QUEUE, JSON.stringify(job));
    ws.broadcast('image.sync.queued', { jobId, imageName });
  }

  return job;
}

/**
 * Get the current queue state.
 */
async function getQueue() {
  const client = redis.getClient();

  // Current running job
  let running = null;
  const currentJson = await client.get(KEY.CURRENT);
  if (currentJson) {
    try {
      const current = JSON.parse(currentJson);
      // Get fresh status from job hash
      const jobData = await client.hgetall(`${KEY.JOB_PREFIX}${current.jobId}`);
      if (jobData && jobData.jobId) {
        running = unflattenJob(jobData);
      }
    } catch { /* ignore */ }
  }

  // Queued jobs
  const queuedRaw = await client.lrange(KEY.QUEUE, 0, -1);
  const queued = queuedRaw.map(raw => {
    try { return JSON.parse(raw); } catch { return null; }
  }).filter(Boolean);

  return { running, queued };
}

/**
 * Cancel a job (running or queued).
 */
async function cancelJob(jobId) {
  const client = redis.getClient();

  // Check if it's the running job
  const currentJson = await client.get(KEY.CURRENT);
  if (currentJson) {
    const current = JSON.parse(currentJson);
    if (current.jobId === jobId) {
      // Abort active download
      if (activeAbort) {
        activeAbort.abort();
      }
      return { cancelled: true, was: 'running' };
    }
  }

  // Remove from queue
  const queuedRaw = await client.lrange(KEY.QUEUE, 0, -1);
  for (const raw of queuedRaw) {
    try {
      const job = JSON.parse(raw);
      if (job.jobId === jobId) {
        await client.lrem(KEY.QUEUE, 1, raw);
        await updateJobStatus(jobId, 'cancelled');
        ws.broadcast('image.sync.cancelled', { jobId, imageName: job.imageName });
        return { cancelled: true, was: 'queued' };
      }
    } catch { /* skip */ }
  }

  return { cancelled: false, error: 'Job not found' };
}

// ---------------------------------------------------------------------------
// Download Worker
// ---------------------------------------------------------------------------

/**
 * Run a single image download with Range/resume support.
 */
async function _runDownload(jobId, imageName) {
  const client = redis.getClient();
  let downloadStartTime = Date.now();

  // Snapshot settings at job start — use fixed values throughout
  const config = {
    lmnApiUrl: await settings.get('lmn_api_url'),
    // JWT auth handled by lmn-api-client
  };

  try {
    await updateJobStatus(jobId, 'downloading', { startedAt: new Date().toISOString() });
    ws.broadcast('image.sync.started', { jobId, imageName, totalBytes: 0 });

    // Fetch manifest to get file list
    const manifest = await getRemoteManifest();
    const imageEntry = manifest.find(i => i.name === imageName);
    if (!imageEntry) {
      throw new Error(`Image "${imageName}" not found in remote manifest`);
    }

    // Create .incoming staging directory (use base name, not filename)
    const imageBase = imageEntry.base || imageName.replace(/\.(qcow2|qdiff|cloop)$/, '');
    const stagingDir = path.join(INCOMING_DIR, imageBase);
    await fsp.mkdir(stagingDir, { recursive: true });

    // Download qcow2 first (largest file, with resume support)
    const qcow2File = imageEntry.filename;
    await _downloadFileWithResume(jobId, imageName, qcow2File, stagingDir, config);

    // Download sidecars
    const sidecars = imageEntry.files.filter(f => f.name !== qcow2File);
    for (const sidecar of sidecars) {
      try {
        await _downloadSidecar(imageName, sidecar.name, stagingDir, config);
      } catch (err) {
        console.warn(`[ImageSync] Sidecar download failed: ${sidecar.name}:`, err.message);
        // Non-fatal — continue with other sidecars
      }
    }

    // Rename .part → final name for qcow2
    const partPath = path.join(stagingDir, `${qcow2File}.part`);
    const finalQcow2 = path.join(stagingDir, qcow2File);
    if (fs.existsSync(partPath)) {
      await fsp.rename(partPath, finalQcow2);
    }

    // MD5 verification (if .md5 sidecar exists)
    const md5Path = path.join(stagingDir, `${qcow2File}.md5`);
    if (fs.existsSync(md5Path)) {
      await updateJobStatus(jobId, 'verifying');
      const md5Content = await fsp.readFile(md5Path, 'utf8');
      const expectedHash = md5Content.trim().split(/\s+/)[0];
      if (expectedHash && expectedHash.length === 32) {
        const actualHash = await _computeMd5(finalQcow2, jobId, imageName);
        if (actualHash !== expectedHash) {
          throw new Error(`MD5 mismatch: expected ${expectedHash}, got ${actualHash}`);
        }
        console.log(`[ImageSync] MD5 verified for ${imageName}`);
      }
    } else {
      console.log(`[ImageSync] No .md5 sidecar — verify skipped for ${imageName}`);
    }

    // Atomic directory swap: .incoming/{base} → images/{base}
    const targetDir = path.join(IMAGES_DIR, imageBase);
    // Remove old if exists
    if (fs.existsSync(targetDir)) {
      await fsp.rm(targetDir, { recursive: true, force: true });
    }
    await fsp.rename(stagingDir, targetDir);

    const duration = Date.now() - downloadStartTime;
    await updateJobStatus(jobId, 'completed');
    ws.broadcast('image.sync.completed', { jobId, imageName, duration, totalBytes: imageEntry.totalSize });
    console.log(`[ImageSync] Completed ${imageName} in ${(duration / 1000).toFixed(1)}s`);

  } catch (err) {
    if (err.name === 'AbortError') {
      await updateJobStatus(jobId, 'cancelled');
      ws.broadcast('image.sync.cancelled', { jobId, imageName });
      console.log(`[ImageSync] Cancelled ${imageName}`);
    } else {
      await updateJobStatus(jobId, 'failed', { error: err.message });
      ws.broadcast('image.sync.failed', { jobId, imageName, error: err.message });
      console.error(`[ImageSync] Failed ${imageName}:`, err.message);
    }
  } finally {
    // Clean up in-memory refs — explicitly destroy stream to prevent partial writes
    activeAbort = null;
    if (activeStream) {
      try { activeStream.destroy(); } catch { /* ignore cleanup errors */ }
      activeStream = null;
    }

    // Release lock and process next
    await client.del(KEY.LOCK);
    await client.del(KEY.CURRENT);
    await _processNextInQueue();
  }
}

/**
 * Download a single file with HTTP Range resume support.
 */
async function _downloadFileWithResume(jobId, imageName, filename, stagingDir, config = {}) {
  const partPath = path.join(stagingDir, `${filename}.part`);
  // imageName is the full filename (e.g. "win11_pro_edu.qcow2")
  // LMN API expects the directory name (base), not the filename
  const imageBase = imageName.replace(/\.(qcow2|qdiff|cloop)$/, '');
  const downloadUrl = `/images/download/${imageBase}/${filename}`;

  // HEAD request to get total size + ETag
  const headRes = await lmnFetch(downloadUrl, { method: 'HEAD' }, config);
  if (!headRes.ok) {
    throw new Error(`HEAD ${downloadUrl} failed: ${headRes.status}`);
  }
  const totalBytes = Number(headRes.headers.get('content-length')) || 0;
  const etag = headRes.headers.get('etag');
  const lastModified = headRes.headers.get('last-modified');

  await updateJobStatus(jobId, 'downloading', { totalBytes });
  ws.broadcast('image.sync.started', { jobId, imageName, totalBytes });

  // Check existing .part file for resume
  let offset = 0;
  try {
    const partStat = await fsp.stat(partPath);
    offset = partStat.size;
  } catch { /* no .part file */ }

  // Build request headers
  const headers = {};
  if (offset > 0) {
    headers['Range'] = `bytes=${offset}-`;
    if (etag) {
      headers['If-Range'] = etag;
    } else if (lastModified) {
      headers['If-Range'] = lastModified;
    }
  }

  // Create AbortController for cancellation
  const abortController = new AbortController();
  activeAbort = abortController;

  const response = await lmnFetch(downloadUrl, {
    headers,
    signal: abortController.signal,
  }, config);

  // Handle resume scenarios
  if (response.status === 200 && offset > 0) {
    // Server returned full file — remote file changed, restart
    console.log(`[ImageSync] Remote file changed for ${imageName}, restarting download`);
    await fsp.unlink(partPath).catch(err => console.debug('[ImageSync] cleanup: unlink partial file failed:', err.message));
    offset = 0;
  } else if (response.status === 206) {
    console.log(`[ImageSync] Resuming ${imageName} from ${_formatBytes(offset)}`);
  } else if (response.status !== 200) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  // Set up write stream
  const writeFlags = offset > 0 && response.status === 206 ? 'a' : 'w';
  const writeStream = fs.createWriteStream(partPath, { flags: writeFlags });
  activeStream = writeStream;

  // Progress tracking
  let bytesDownloaded = offset;
  let lastProgressTime = Date.now();
  let lastProgressBytes = offset;
  const client = redis.getClient();

  // Create throttle transform for bandwidth limit
  const transforms = [];
  if (BWLIMIT_MBPS > 0) {
    transforms.push(_createThrottleTransform(BWLIMIT_MBPS));
  }

  // Progress transform
  const progressTransform = new Transform({
    transform(chunk, encoding, callback) {
      bytesDownloaded += chunk.length;
      const now = Date.now();

      if (now - lastProgressTime >= PROGRESS_INTERVAL) {
        const elapsed = (now - lastProgressTime) / 1000;
        const deltaBytes = bytesDownloaded - lastProgressBytes;
        const speed = deltaBytes / elapsed;
        const remaining = totalBytes - bytesDownloaded;
        const eta = speed > 0 ? Math.round(remaining / speed) : 0;
        const percentage = totalBytes > 0 ? Math.round((bytesDownloaded / totalBytes) * 100) : 0;

        // Update Redis
        updateJobStatus(jobId, 'downloading', {
          progress: percentage,
          speed: Math.round(speed),
          eta,
          bytesDownloaded,
        }).catch(() => {}); // WS broadcast: no clients is normal

        // Update current job in Redis
        client.set(KEY.CURRENT, JSON.stringify({
          jobId, imageName, status: 'downloading',
          progress: percentage, speed: Math.round(speed), eta,
          bytesDownloaded, totalBytes,
        })).catch(err => console.debug('[ImageSync] Redis progress update failed:', err.message));

        // WebSocket broadcast
        ws.broadcast('image.sync.progress', {
          jobId, imageName, progress: percentage, speed: Math.round(speed),
          eta, bytesDownloaded, totalBytes,
        });

        lastProgressTime = now;
        lastProgressBytes = bytesDownloaded;
      }

      this.push(chunk);
      callback();
    },
  });
  transforms.push(progressTransform);

  // Pipe: response.body → [throttle] → progress → writeStream
  try {
    const { Readable } = require('stream');
    const readable = Readable.fromWeb(response.body);

    const streams = [readable, ...transforms, writeStream];
    await pipeline(...streams);
  } catch (err) {
    // Ensure write stream is closed on error
    if (!writeStream.destroyed) {
      writeStream.destroy();
    }
    throw err;
  }
}

/**
 * Download a sidecar file (small, no resume needed).
 */
async function _downloadSidecar(imageName, filename, stagingDir, config = {}) {
  const imageBase = imageName.replace(/\.(qcow2|qdiff|cloop)$/, '');
  const downloadUrl = `/images/download/${imageBase}/${filename}`;
  const res = await lmnFetch(downloadUrl, {}, config);
  if (!res.ok) {
    throw new Error(`Sidecar download failed: ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(path.join(stagingDir, filename), buffer);
}

/**
 * Compute MD5 hash of a file.
 */
async function _computeMd5(filePath, _jobId, _imageName) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Create a throttle transform stream (token-bucket).
 */
function _createThrottleTransform(mbps) {
  const bytesPerSec = mbps * 1024 * 1024;
  let tokens = bytesPerSec;
  let lastRefill = Date.now();

  return new Transform({
    transform(chunk, encoding, callback) {
      const now = Date.now();
      const elapsed = (now - lastRefill) / 1000;
      tokens = Math.min(bytesPerSec, tokens + elapsed * bytesPerSec);
      lastRefill = now;

      if (chunk.length <= tokens) {
        tokens -= chunk.length;
        this.push(chunk);
        callback();
      } else {
        // Wait for enough tokens
        const waitMs = ((chunk.length - tokens) / bytesPerSec) * 1000;
        setTimeout(() => {
          tokens = 0;
          lastRefill = Date.now();
          this.push(chunk);
          callback();
        }, waitMs);
      }
    },
  });
}

/**
 * Process the next job in the queue.
 */
async function _processNextInQueue() {
  const client = redis.getClient();
  const nextRaw = await client.lpop(KEY.QUEUE);
  if (!nextRaw) return;

  try {
    const nextJob = JSON.parse(nextRaw);
    const acquired = await client.set(KEY.LOCK, nextJob.jobId, 'NX', 'EX', 3600);
    if (acquired) {
      await client.set(KEY.CURRENT, JSON.stringify(nextJob));
      _runDownload(nextJob.jobId, nextJob.imageName).catch(err => {
        console.error(`[ImageSync] Queued download failed for ${nextJob.imageName}:`, err.message);
      });
    } else {
      // Someone else got the lock — re-queue
      await client.lpush(KEY.QUEUE, nextRaw);
    }
  } catch (err) {
    console.error('[ImageSync] Failed to process next queue item:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flattenJob(job) {
  const flat = {};
  for (const [k, v] of Object.entries(job)) {
    flat[k] = v === null ? '' : String(v);
  }
  return flat;
}

function unflattenJob(data) {
  return {
    jobId: data.jobId,
    imageName: data.imageName,
    status: data.status,
    progress: Number(data.progress) || 0,
    speed: Number(data.speed) || 0,
    eta: Number(data.eta) || 0,
    bytesDownloaded: Number(data.bytesDownloaded) || 0,
    totalBytes: Number(data.totalBytes) || 0,
    error: data.error || null,
    startedAt: data.startedAt || null,
    queuedAt: data.queuedAt || null,
  };
}

async function updateJobStatus(jobId, status, extra = {}) {
  const client = redis.getClient();
  const updates = { status, ...extra };
  const flat = {};
  for (const [k, v] of Object.entries(updates)) {
    flat[k] = v === null ? '' : String(v);
  }
  await client.hmset(`${KEY.JOB_PREFIX}${jobId}`, flat);
}

function _formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

/**
 * Startup recovery: clean up stale locks from crashed containers.
 */
async function recoverOnStartup() {
  try {
    const client = redis.getClient();
    const lockHolder = await client.get(KEY.LOCK);
    if (lockHolder) {
      console.log(`[ImageSync] Cleaning stale lock from previous run (job: ${lockHolder})`);
      await updateJobStatus(lockHolder, 'failed', { error: 'Container restarted' });
      await client.del(KEY.LOCK);
      await client.del(KEY.CURRENT);

      // Try to start next queued job
      await _processNextInQueue();
    }
  } catch (err) {
    console.error('[ImageSync] Recovery error:', err.message);
  }
}

/**
 * Abort any active download (used during graceful shutdown).
 */
function abortActive() {
  if (activeAbort) {
    activeAbort.abort();
    console.log('[ImageSync] Active download aborted for shutdown');
  }
}

module.exports = {
  getRemoteManifest,
  getLocalImages,
  compareImages,
  pullImage,
  getQueue,
  cancelJob,
  recoverOnStartup,
  abortActive,
};
