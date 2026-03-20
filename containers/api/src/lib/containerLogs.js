/**
 * LINBO Docker - Container Log Streaming
 *
 * Uses dockerode to stream Docker container logs in real-time.
 * On-demand streaming with ref-counting: one stream per container,
 * shared across multiple WS clients, cleanup when last client unsubscribes.
 */

const BATCH_INTERVAL_MS = 100;

let Docker;
let docker;

// Active streams: containerName -> { stream, clients: Set<ws>, batchTimer, pendingBatch }
const activeStreams = new Map();

// WebSocket broadcast function (injected at init)
let broadcastFn = null;
let wssRef = null;

/**
 * Initialize container logs module.
 * @param {function} broadcast - websocket.broadcast function
 * @param {object} wss - WebSocket.Server instance
 */
function init(broadcast, wss) {
  broadcastFn = broadcast;
  wssRef = wss;

  try {
    Docker = require('dockerode');
    docker = new Docker({ socketPath: '/var/run/docker.sock' });
    console.log('  Container Logs: Docker socket connected');
  } catch (err) {
    console.warn('  Container Logs: dockerode not available or Docker socket not mounted:', err.message);
    docker = null;
  }
}

/**
 * Check if Docker is available.
 */
function isAvailable() {
  return docker !== null;
}

/**
 * List running containers matching linbo-* prefix.
 * @returns {Promise<Array<{name: string, id: string, state: string, status: string}>>}
 */
async function listContainers() {
  if (!docker) return [];

  try {
    const containers = await docker.listContainers({ all: false });
    return containers
      .map((c) => ({
        name: (c.Names[0] || '').replace(/^\//, ''),
        id: c.Id.slice(0, 12),
        state: c.State,
        status: c.Status,
        image: c.Image,
      }))
      .filter((c) => c.name.startsWith('linbo-'))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.error('[containerLogs] listContainers error:', err.message);
    return [];
  }
}

/**
 * Get recent logs from a container (for catchup).
 * @param {string} containerName
 * @param {number} tail - Number of lines
 * @returns {Promise<Array<{stream: string, message: string, timestamp: string}>>}
 */
async function getRecentLogs(containerName, tail = 200) {
  if (!docker) return [];

  try {
    const container = docker.getContainer(containerName);
    const logBuffer = await container.logs({
      follow: false,
      stdout: true,
      stderr: true,
      tail,
      timestamps: true,
    });

    return parseDockerLogs(logBuffer);
  } catch (err) {
    console.error(`[containerLogs] getRecentLogs(${containerName}) error:`, err.message);
    return [];
  }
}

/**
 * Parse Docker multiplexed log output.
 * Docker log format: 8-byte header + payload per frame.
 * Header[0] = stream type (0=stdin, 1=stdout, 2=stderr)
 * Header[4..7] = payload size (big-endian uint32)
 */
function parseDockerLogs(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    // Sometimes Docker returns a string (TTY mode)
    const str = typeof buffer === 'string' ? buffer : buffer.toString('utf8');
    return str.split('\n').filter(Boolean).map((line) => {
      const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s*(.*)/);
      return {
        stream: 'stdout',
        message: tsMatch ? tsMatch[2] : line,
        timestamp: tsMatch ? tsMatch[1] : new Date().toISOString(),
      };
    });
  }

  const entries = [];
  let offset = 0;

  while (offset < buffer.length - 8) {
    const streamType = buffer[offset];
    const payloadSize = buffer.readUInt32BE(offset + 4);
    offset += 8;

    if (offset + payloadSize > buffer.length) break;

    const payload = buffer.slice(offset, offset + payloadSize).toString('utf8').trim();
    offset += payloadSize;

    if (!payload) continue;

    const stream = streamType === 2 ? 'stderr' : 'stdout';

    // Parse timestamp if present (Docker adds them with --timestamps)
    const tsMatch = payload.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s*(.*)/s);
    entries.push({
      stream,
      message: tsMatch ? tsMatch[2] : payload,
      timestamp: tsMatch ? tsMatch[1] : new Date().toISOString(),
    });
  }

  return entries;
}

/**
 * Subscribe a WS client to container log stream.
 * Starts streaming if this is the first subscriber.
 * @param {string} containerName
 * @param {WebSocket} ws - The subscribing client
 */
async function subscribe(containerName, ws) {
  if (!docker) return;

  // If already streaming this container, just add client
  if (activeStreams.has(containerName)) {
    const streamInfo = activeStreams.get(containerName);
    streamInfo.clients.add(ws);
    return;
  }

  // Start new stream
  try {
    const container = docker.getContainer(containerName);
    const stream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: 0, // Don't replay — catchup is done via REST
      timestamps: true,
    });

    const streamInfo = {
      stream,
      clients: new Set([ws]),
      pendingBatch: [],
      batchTimer: null,
    };

    activeStreams.set(containerName, streamInfo);

    // Handle multiplexed stream data
    stream.on('data', (chunk) => {
      const entries = parseDockerLogs(chunk);
      if (entries.length === 0) return;

      streamInfo.pendingBatch.push(...entries);

      // Batched broadcast
      if (!streamInfo.batchTimer) {
        streamInfo.batchTimer = setTimeout(() => {
          streamInfo.batchTimer = null;
          if (streamInfo.pendingBatch.length === 0) return;

          const batch = streamInfo.pendingBatch;
          streamInfo.pendingBatch = [];

          if (broadcastFn) {
            broadcastFn('container.log.batch', {
              container: containerName,
              entries: batch,
            });
          }
        }, BATCH_INTERVAL_MS);
      }
    });

    stream.on('error', (err) => {
      console.error(`[containerLogs] Stream error for ${containerName}:`, err.message);
      cleanup(containerName);
    });

    stream.on('end', () => {
      cleanup(containerName);
    });
  } catch (err) {
    console.error(`[containerLogs] subscribe(${containerName}) error:`, err.message);
  }
}

/**
 * Unsubscribe a WS client from container log stream.
 * Stops streaming if this was the last subscriber.
 * @param {string} containerName
 * @param {WebSocket} ws
 */
function unsubscribe(containerName, ws) {
  const streamInfo = activeStreams.get(containerName);
  if (!streamInfo) return;

  streamInfo.clients.delete(ws);

  if (streamInfo.clients.size === 0) {
    cleanup(containerName);
  }
}

/**
 * Unsubscribe a WS client from ALL container streams (on disconnect).
 * @param {WebSocket} ws
 */
function unsubscribeAll(ws) {
  for (const [name, streamInfo] of activeStreams) {
    streamInfo.clients.delete(ws);
    if (streamInfo.clients.size === 0) {
      cleanup(name);
    }
  }
}

/**
 * Cleanup: destroy stream and remove from active map.
 */
function cleanup(containerName) {
  const streamInfo = activeStreams.get(containerName);
  if (!streamInfo) return;

  if (streamInfo.batchTimer) clearTimeout(streamInfo.batchTimer);

  try {
    if (streamInfo.stream && typeof streamInfo.stream.destroy === 'function') {
      streamInfo.stream.destroy();
    }
  } catch {
    // Ignore cleanup errors
  }

  activeStreams.delete(containerName);
}

module.exports = {
  init,
  isAvailable,
  listContainers,
  getRecentLogs,
  subscribe,
  unsubscribe,
  unsubscribeAll,
};
