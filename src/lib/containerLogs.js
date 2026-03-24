/**
 * LINBO Native - Service Log Streaming
 *
 * Uses journald (systemd journal) to stream native service logs.
 * isAvailable() returns false when /usr/bin/journalctl is absent.
 *
 * On-demand streaming with ref-counting: one stream per service unit,
 * shared across multiple WS clients, cleanup when last client unsubscribes.
 */

const fs = require('fs');
const { execFile, spawn } = require('child_process');

const BATCH_INTERVAL_MS = 100;
const JOURNALCTL_PATH = '/usr/bin/journalctl';

// Allowlist of service names that may be streamed/queried via journalctl
const ALLOWED_SERVICES = /^(linbo-api|linbo-setup|nginx|tftpd-hpa|rsync|isc-dhcp-server|ssh)$/;

// Active streams: serviceName -> { proc, clients: Set<ws>, batchTimer, pendingBatch }
const activeStreams = new Map();

// WebSocket broadcast function (injected at init)
let broadcastFn = null;
let _wssRef = null;

/**
 * Initialize container logs module.
 * @param {function} broadcast - websocket.broadcast function
 * @param {object} wss - WebSocket.Server instance
 */
function init(broadcast, wss) {
  broadcastFn = broadcast;
  _wssRef = wss;
}

/**
 * Check if journald is available (journalctl binary exists).
 * @returns {boolean}
 */
function isAvailable() {
  return fs.existsSync(JOURNALCTL_PATH);
}

/**
 * Ensure service name has .service suffix for journald queries.
 * @param {string} name
 * @returns {string}
 */
function toUnitName(name) {
  return name.endsWith('.service') ? name : `${name}.service`;
}

/**
 * Parse a single journald JSON line into a log entry.
 * @param {string} line - JSON string from journalctl --output=json
 * @returns {object|null}
 */
function parseJournalLine(line) {
  if (!line.trim()) return null;
  try {
    const obj = JSON.parse(line);
    const tsMicros = parseInt(obj.__REALTIME_TIMESTAMP || '0', 10);
    const priority = parseInt(obj.PRIORITY || '6', 10);
    return {
      stream: priority <= 3 ? 'stderr' : 'stdout',
      message: obj.MESSAGE || '',
      timestamp: new Date(tsMicros / 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * List systemd units matching linbo-* pattern via journalctl.
 * @returns {Promise<Array<{name: string, id: string, state: string, status: string, image: string}>>}
 */
async function listContainers() {
  if (!isAvailable()) return [];

  return new Promise((resolve) => {
    execFile(JOURNALCTL_PATH, ['--field=_SYSTEMD_UNIT', '--no-pager'], (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const units = [...new Set(
        stdout.trim().split('\n')
          .map(u => u.trim())
          .filter(u => u.startsWith('linbo-') && u.endsWith('.service'))
      )];
      resolve(units.map(unit => ({
        name: unit.replace(/\.service$/, ''),
        id: 'systemd',
        state: 'active',
        status: 'running (journald)',
        image: '',
      })));
    });
  });
}

/**
 * Get recent logs from a service via journald.
 * @param {string} serviceName
 * @param {number} tail - Number of lines
 * @returns {Promise<Array<{stream: string, message: string, timestamp: string}>>}
 */
async function getRecentLogs(serviceName, tail = 200) {
  if (!isAvailable()) return [];

  const unit = toUnitName(serviceName);
  const baseName = unit.replace('.service', '');
  if (!ALLOWED_SERVICES.test(baseName)) {
    return []; // reject unknown services
  }
  return new Promise((resolve) => {
    execFile(JOURNALCTL_PATH, [
      '-u', unit,
      '-n', String(tail),
      '--output=json',
      '--no-pager',
    ], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const entries = stdout.trim().split('\n')
        .map(parseJournalLine)
        .filter(Boolean);
      resolve(entries);
    });
  });
}

/**
 * Subscribe a WS client to service log stream via journald.
 * Starts streaming if this is the first subscriber.
 * @param {string} serviceName
 * @param {WebSocket} ws - The subscribing client
 */
async function subscribe(serviceName, ws) {
  if (!isAvailable()) return;

  const unit = toUnitName(serviceName);
  const baseName = unit.replace('.service', '');
  if (!ALLOWED_SERVICES.test(baseName)) {
    return; // silently ignore unknown services
  }

  // If already streaming this service, just add client
  if (activeStreams.has(serviceName)) {
    const streamInfo = activeStreams.get(serviceName);
    streamInfo.clients.add(ws);
    return;
  }

  // Start new journald stream
  try {
    const proc = spawn(JOURNALCTL_PATH, [
      '-u', unit,
      '-f', '-n', '0',
      '--output=json',
    ]);

    const streamInfo = {
      proc,
      clients: new Set([ws]),
      pendingBatch: [],
      batchTimer: null,
    };

    // Attach error/close handlers BEFORE registering in activeStreams
    // to prevent zombie processes if spawn fails immediately
    proc.on('error', (err) => {
      console.error(`[containerLogs] Stream error for ${serviceName}:`, err.message);
      cleanup(serviceName);
    });

    proc.on('close', () => {
      cleanup(serviceName);
    });

    activeStreams.set(serviceName, streamInfo);

    let buffer = '';
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line

      const entries = [];
      for (const line of lines) {
        const entry = parseJournalLine(line);
        if (entry) entries.push(entry);
      }

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
              container: serviceName,
              entries: batch,
            });
          }
        }, BATCH_INTERVAL_MS);
      }
    });

  } catch (err) {
    console.error(`[containerLogs] subscribe(${serviceName}) error:`, err.message);
  }
}

/**
 * Unsubscribe a WS client from service log stream.
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
 * Unsubscribe a WS client from ALL service streams (on disconnect).
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
 * Cleanup: kill process and remove from active map.
 */
function cleanup(serviceName) {
  const streamInfo = activeStreams.get(serviceName);
  if (!streamInfo) return;

  if (streamInfo.batchTimer) clearTimeout(streamInfo.batchTimer);

  try {
    if (streamInfo.proc && typeof streamInfo.proc.kill === 'function') {
      streamInfo.proc.kill();
    }
  } catch {
    // Ignore cleanup errors
  }

  activeStreams.delete(serviceName);
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
