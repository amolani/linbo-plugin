/**
 * LINBO Docker - Image Push Service
 *
 * Uploads QCOW2 images to the LMN Authority API via HTTP chunked uploads
 * with Content-Range resume support. Mirrors the pull pattern from
 * image-sync.service.js (Redis-backed job queue, WebSocket progress).
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const redis = require('../lib/redis');
const ws = require('../lib/websocket');

const settings = require('./settings.service');
const IMAGES_DIR = path.join(process.env.LINBO_DIR || '/srv/linbo', 'images');
const PROGRESS_INTERVAL = 2000; // ms between WS progress events
const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB chunks

// Redis keys (parallel to imgsync:* for pull)
const KEY = {
  LOCK: 'imgpush:lock',
  CURRENT: 'imgpush:current',
  QUEUE: 'imgpush:queue',
  JOB_PREFIX: 'imgpush:job:',
};

// In-memory ref for the currently running upload
let activeAbort = null; // AbortController

/**
 * Make an authenticated request to the LMN Authority API.
 */
async function lmnFetch(urlPath, options = {}, config = {}) {
  const lmnApiClient = require('../lib/lmn-api-client');
  return lmnApiClient.request(urlPath, options);
}

// ---------------------------------------------------------------------------
// Push Queue + Worker
// ---------------------------------------------------------------------------

function generateJobId() {
  return `push_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Push an image. If an upload is already running, queue it.
 */
async function pushImage(imageName) {
  const client = redis.getClient();

  // Verify local image exists
  const imageDir = path.join(IMAGES_DIR, imageName);
  try {
    const stat = await fsp.stat(imageDir);
    if (!stat.isDirectory()) throw new Error('Not a directory');
  } catch {
    throw Object.assign(new Error(`Local image directory not found: ${imageName}`), { statusCode: 404 });
  }

  // Verify at least one .qcow2 file
  const files = await fsp.readdir(imageDir);
  const hasQcow2 = files.some(f => f.endsWith('.qcow2'));
  if (!hasQcow2) {
    throw Object.assign(new Error(`No .qcow2 file in image directory: ${imageName}`), { statusCode: 400 });
  }

  const jobId = generateJobId();
  const job = {
    jobId,
    imageName,
    status: 'queued',
    progress: 0,
    speed: 0,
    eta: 0,
    bytesUploaded: 0,
    totalBytes: 0,
    error: null,
    startedAt: null,
    queuedAt: new Date().toISOString(),
  };

  await client.hmset(`${KEY.JOB_PREFIX}${jobId}`, flattenJob(job));
  await client.expire(`${KEY.JOB_PREFIX}${jobId}`, 86400);

  const acquired = await client.set(KEY.LOCK, jobId, 'NX', 'EX', 3600);
  if (acquired) {
    await client.set(KEY.CURRENT, JSON.stringify(job));
    ws.broadcast('image.push.queued', { jobId, imageName });
    _runPush(jobId, imageName).catch(err => {
      console.error(`[ImagePush] Upload failed for ${imageName}:`, err.message);
    });
  } else {
    await client.rpush(KEY.QUEUE, JSON.stringify(job));
    ws.broadcast('image.push.queued', { jobId, imageName });
  }

  return job;
}

/**
 * Get the current queue state.
 */
async function getQueue() {
  const client = redis.getClient();

  let running = null;
  const currentJson = await client.get(KEY.CURRENT);
  if (currentJson) {
    try {
      const current = JSON.parse(currentJson);
      const jobData = await client.hgetall(`${KEY.JOB_PREFIX}${current.jobId}`);
      if (jobData && jobData.jobId) {
        running = unflattenJob(jobData);
      }
    } catch { /* ignore */ }
  }

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

  const currentJson = await client.get(KEY.CURRENT);
  if (currentJson) {
    const current = JSON.parse(currentJson);
    if (current.jobId === jobId) {
      if (activeAbort) {
        activeAbort.abort();
      }
      return { cancelled: true, was: 'running' };
    }
  }

  const queuedRaw = await client.lrange(KEY.QUEUE, 0, -1);
  for (const raw of queuedRaw) {
    try {
      const job = JSON.parse(raw);
      if (job.jobId === jobId) {
        await client.lrem(KEY.QUEUE, 1, raw);
        await updateJobStatus(jobId, 'cancelled');
        ws.broadcast('image.push.cancelled', { jobId, imageName: job.imageName });
        return { cancelled: true, was: 'queued' };
      }
    } catch { /* skip */ }
  }

  return { cancelled: false, error: 'Job not found' };
}

// ---------------------------------------------------------------------------
// Upload Worker
// ---------------------------------------------------------------------------

/**
 * Run a single image push with chunked upload and resume support.
 */
async function _runPush(jobId, imageName) {
  const client = redis.getClient();
  const pushStartTime = Date.now();

  const config = {
    lmnApiUrl: await settings.get('lmn_api_url'),
  };

  try {
    await updateJobStatus(jobId, 'uploading', { startedAt: new Date().toISOString() });
    ws.broadcast('image.push.started', { jobId, imageName, totalBytes: 0 });

    // Scan local image directory
    const imageDir = path.join(IMAGES_DIR, imageName);
    const allFiles = await fsp.readdir(imageDir);
    const fileEntries = [];
    let totalBytes = 0;

    for (const fname of allFiles) {
      const filePath = path.join(imageDir, fname);
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) continue;
      fileEntries.push({ name: fname, path: filePath, size: stat.size });
      totalBytes += stat.size;
    }

    await updateJobStatus(jobId, 'uploading', { totalBytes });
    ws.broadcast('image.push.started', { jobId, imageName, totalBytes });

    // Upload qcow2 files first (largest, with chunked upload)
    const qcow2Files = fileEntries.filter(f => f.name.endsWith('.qcow2'));
    const sidecarFiles = fileEntries.filter(f => !f.name.endsWith('.qcow2'));

    let bytesUploaded = 0;
    let lastProgressTime = Date.now();
    let lastProgressBytes = 0;

    // Create AbortController
    const abortController = new AbortController();
    activeAbort = abortController;

    for (const file of qcow2Files) {
      bytesUploaded = await _uploadFileChunked(
        jobId, imageName, file, config, abortController.signal,
        bytesUploaded, totalBytes, (uploaded) => {
          bytesUploaded = uploaded;
          const now = Date.now();
          if (now - lastProgressTime >= PROGRESS_INTERVAL) {
            const elapsed = (now - lastProgressTime) / 1000;
            const deltaBytes = bytesUploaded - lastProgressBytes;
            const speed = deltaBytes / elapsed;
            const remaining = totalBytes - bytesUploaded;
            const eta = speed > 0 ? Math.round(remaining / speed) : 0;
            const percentage = totalBytes > 0 ? Math.round((bytesUploaded / totalBytes) * 100) : 0;

            updateJobStatus(jobId, 'uploading', {
              progress: percentage, speed: Math.round(speed), eta, bytesUploaded,
            }).catch(() => {});

            client.set(KEY.CURRENT, JSON.stringify({
              jobId, imageName, status: 'uploading',
              progress: percentage, speed: Math.round(speed), eta,
              bytesUploaded, totalBytes,
            })).catch(() => {});

            ws.broadcast('image.push.progress', {
              jobId, imageName, progress: percentage, speed: Math.round(speed),
              eta, bytesUploaded, totalBytes,
            });

            lastProgressTime = now;
            lastProgressBytes = bytesUploaded;
          }
        },
      );
    }

    // Upload sidecars (small files, single request each)
    for (const file of sidecarFiles) {
      if (abortController.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const data = await fsp.readFile(file.path);
      const res = await lmnFetch(
        `/images/upload/${imageName}/${file.name}`,
        { method: 'PUT', body: data, headers: { 'Content-Type': 'application/octet-stream' }, signal: abortController.signal },
        config,
      );
      if (!res.ok) {
        const text = await res.text();
        console.warn(`[ImagePush] Sidecar upload failed: ${file.name}: ${text}`);
      }
      bytesUploaded += file.size;
    }

    // Finalize: tell server to move .incoming → images
    await updateJobStatus(jobId, 'finalizing');
    const completeRes = await lmnFetch(
      `/images/upload/${imageName}/complete`,
      { method: 'POST' },
      config,
    );
    if (!completeRes.ok) {
      const text = await completeRes.text();
      throw new Error(`Finalization failed (${completeRes.status}): ${text}`);
    }

    const duration = Date.now() - pushStartTime;
    await updateJobStatus(jobId, 'completed');
    ws.broadcast('image.push.completed', { jobId, imageName, duration, totalBytes });
    console.log(`[ImagePush] Completed ${imageName} in ${(duration / 1000).toFixed(1)}s`);

  } catch (err) {
    if (err.name === 'AbortError') {
      await updateJobStatus(jobId, 'cancelled');
      ws.broadcast('image.push.cancelled', { jobId, imageName });
      console.log(`[ImagePush] Cancelled ${imageName}`);
      // Tell server to clean up staging
      lmnFetch(`/images/upload/${imageName}`, { method: 'DELETE' }, config).catch(() => {});
    } else {
      await updateJobStatus(jobId, 'failed', { error: err.message });
      ws.broadcast('image.push.failed', { jobId, imageName, error: err.message });
      console.error(`[ImagePush] Failed ${imageName}:`, err.message);
    }
  } finally {
    activeAbort = null;
    await client.del(KEY.LOCK);
    await client.del(KEY.CURRENT);
    await _processNextInQueue();
  }
}

/**
 * Upload a single file in chunks with Content-Range and resume support.
 */
async function _uploadFileChunked(jobId, imageName, file, config, signal, currentOffset, totalJobBytes, onProgress) {
  const { name: filename, path: filePath, size: fileSize } = file;

  // Check server for existing upload progress (resume)
  let offset = 0;
  try {
    const statusRes = await lmnFetch(
      `/images/upload/${imageName}/${filename}/status`,
      { signal },
      config,
    );
    if (statusRes.ok) {
      const status = await statusRes.json();
      if (status.complete) {
        return currentOffset + fileSize; // Already fully uploaded
      }
      offset = status.bytesReceived || 0;
      if (offset > 0) {
        console.log(`[ImagePush] Resuming ${imageName}/${filename} from ${_formatBytes(offset)}`);
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // Status endpoint not available — start from 0
  }

  let bytesUploaded = currentOffset + offset;

  // Read and send chunks
  const fd = await fsp.open(filePath, 'r');
  try {
    while (offset < fileSize) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      const chunkSize = Math.min(CHUNK_SIZE, fileSize - offset);
      const buffer = Buffer.alloc(chunkSize);
      const { bytesRead } = await fd.read(buffer, 0, chunkSize, offset);

      const chunk = bytesRead < chunkSize ? buffer.subarray(0, bytesRead) : buffer;
      const end = offset + bytesRead - 1;

      const res = await lmnFetch(
        `/images/upload/${imageName}/${filename}`,
        {
          method: 'PUT',
          headers: {
            'Content-Range': `bytes ${offset}-${end}/${fileSize}`,
            'Content-Type': 'application/octet-stream',
          },
          body: chunk,
          signal,
        },
        config,
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Chunk upload failed (${res.status}): ${text}`);
      }

      offset += bytesRead;
      bytesUploaded = currentOffset + offset;
      onProgress(bytesUploaded);
    }
  } finally {
    await fd.close();
  }

  return bytesUploaded;
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
      _runPush(nextJob.jobId, nextJob.imageName).catch(err => {
        console.error(`[ImagePush] Queued upload failed for ${nextJob.imageName}:`, err.message);
      });
    } else {
      await client.lpush(KEY.QUEUE, nextRaw);
    }
  } catch (err) {
    console.error('[ImagePush] Failed to process next queue item:', err.message);
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
    bytesUploaded: Number(data.bytesUploaded) || 0,
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
      console.log(`[ImagePush] Cleaning stale lock from previous run (job: ${lockHolder})`);
      await updateJobStatus(lockHolder, 'failed', { error: 'Container restarted' });
      await client.del(KEY.LOCK);
      await client.del(KEY.CURRENT);
      await _processNextInQueue();
    }
  } catch (err) {
    console.error('[ImagePush] Recovery error:', err.message);
  }
}

module.exports = {
  pushImage,
  getQueue,
  cancelJob,
  recoverOnStartup,
};
