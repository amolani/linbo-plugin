/**
 * LINBO Docker - API Log Stream
 *
 * Intercepts console.log/error/warn/debug, stores in a ring buffer,
 * and broadcasts batched events via WebSocket for the frontend log panel.
 */

const BUFFER_SIZE = 2000;
const BATCH_INTERVAL_MS = 100;

// Ring buffer for catchup
const logBuffer = [];

// Pending entries for next batch
let pendingBatch = [];
let batchTimer = null;

// WebSocket broadcast function (injected at init)
let broadcastFn = null;

// Original console methods
const origLog = console.log;
const origError = console.error;
const origWarn = console.warn;
const origDebug = console.debug;
const origInfo = console.info;

/**
 * Format arguments to a single string message.
 */
function formatArgs(args) {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

/**
 * Capture a log entry into the ring buffer and queue for broadcast.
 */
function captureLog(level, args) {
  const entry = {
    level,
    message: formatArgs(args),
    timestamp: new Date().toISOString(),
  };

  // Ring buffer
  logBuffer.push(entry);
  if (logBuffer.length > BUFFER_SIZE) logBuffer.shift();

  // Queue for batched broadcast
  pendingBatch.push(entry);
  scheduleBatch();
}

/**
 * Schedule a batched broadcast (throttled to BATCH_INTERVAL_MS).
 */
function scheduleBatch() {
  if (batchTimer) return;
  batchTimer = setTimeout(() => {
    batchTimer = null;
    if (pendingBatch.length === 0) return;
    if (!broadcastFn) return;

    const entries = pendingBatch;
    pendingBatch = [];

    try {
      broadcastFn('api.log.batch', { entries });
    } catch {
      // Avoid recursion — do NOT log here
    }
  }, BATCH_INTERVAL_MS);
}

/**
 * Initialize log stream: monkey-patch console methods.
 * Must be called early in startup, AFTER websocket.init().
 *
 * @param {function} broadcast - The websocket.broadcast function
 */
function init(broadcast) {
  broadcastFn = broadcast;

  console.log = (...args) => {
    origLog(...args);
    captureLog('log', args);
  };

  console.error = (...args) => {
    origError(...args);
    captureLog('error', args);
  };

  console.warn = (...args) => {
    origWarn(...args);
    captureLog('warn', args);
  };

  console.debug = (...args) => {
    origDebug(...args);
    captureLog('debug', args);
  };

  console.info = (...args) => {
    origInfo(...args);
    captureLog('log', args);
  };
}

/**
 * Get recent log entries for catchup.
 * @param {number} limit - Max entries to return (default 200)
 * @returns {Array} Recent log entries
 */
function getRecentLogs(limit = 200) {
  return logBuffer.slice(-limit);
}

module.exports = {
  init,
  getRecentLogs,
};
