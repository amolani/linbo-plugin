/**
 * LINBO Plugin - Terminal Service
 * Interactive SSH session management for web terminal.
 *
 * Manages SSH connections to LINBO clients with PTY support
 * and exec-mode fallback.
 */

const { Client } = require('ssh2');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// SSH config for direct LINBO client connections (not via SSH container)
// Key is loaded lazily to avoid race condition with SSH container key generation
let linboClientKey = null;
const linboKeyPath = process.env.LINBO_CLIENT_SSH_KEY || '/etc/linuxmuster/linbo/ssh_host_rsa_key_client';
const fallbackKeyPath = process.env.SSH_PRIVATE_KEY;

function getClientKey() {
  if (linboClientKey) return linboClientKey;
  try {
    linboClientKey = fs.readFileSync(linboKeyPath);
    console.log(`[Terminal] Loaded LINBO client key from ${linboKeyPath}`);
  } catch {
    if (fallbackKeyPath) {
      try {
        linboClientKey = fs.readFileSync(fallbackKeyPath);
        console.warn(`[Terminal] Using fallback key ${fallbackKeyPath} — may not work for LINBO clients`);
      } catch {}
    }
  }
  return linboClientKey;
}

const sshDefaults = {
  port: parseInt(process.env.LINBO_CLIENT_SSH_PORT, 10) || 2222,
  username: 'root',
  get privateKey() { return getClientKey(); },
  readyTimeout: parseInt(process.env.SSH_TIMEOUT, 10) || 10000,
  keepaliveInterval: 5000,
};

const MAX_SESSIONS = parseInt(process.env.TERMINAL_MAX_SESSIONS, 10) || 10;
const IDLE_TIMEOUT_MS = parseInt(process.env.TERMINAL_IDLE_TIMEOUT, 10) || 30 * 60 * 1000; // 30 min

/** @type {Map<string, Session>} */
const sessions = new Map();

/**
 * @typedef {object} Session
 * @property {string} id
 * @property {string} hostIp
 * @property {string} userId
 * @property {string} mode - 'pty' or 'exec'
 * @property {import('ssh2').Client} client
 * @property {import('ssh2').ClientChannel} stream
 * @property {function} onData
 * @property {function} onClose
 * @property {function} onError
 * @property {NodeJS.Timeout} idleTimer
 * @property {Date} createdAt
 * @property {Date} lastActivity
 */

/**
 * Touch session activity (resets idle timer)
 */
function touchSession(session) {
  session.lastActivity = new Date();
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    console.log(`[Terminal] Session ${session.id} idle timeout — destroying`);
    destroySession(session.id);
  }, IDLE_TIMEOUT_MS);
}

/**
 * Create a new interactive SSH session.
 * Tries PTY first, falls back to exec('sh') if PTY allocation fails.
 *
 * @param {string} hostIp
 * @param {string} userId
 * @param {object} opts
 * @param {number} opts.cols
 * @param {number} opts.rows
 * @param {function} opts.onData   - (data: string) => void
 * @param {function} opts.onClose  - (reason: string) => void
 * @param {function} opts.onError  - (error: string) => void
 * @returns {Promise<string>} sessionId
 */
function createSession(hostIp, userId, { cols = 80, rows = 24, onData, onClose, onError }) {
  if (sessions.size >= MAX_SESSIONS) {
    return Promise.reject(new Error(`Maximum sessions (${MAX_SESSIONS}) reached`));
  }

  const sessionId = uuidv4();

  return new Promise((resolve, reject) => {
    const client = new Client();

    client.on('ready', () => {
      // Try PTY shell first
      client.shell(
        { term: 'xterm-256color', cols, rows },
        (err, stream) => {
          if (err) {
            // PTY failed — fallback to exec
            console.warn(`[Terminal] PTY failed for ${hostIp}: ${err.message} — falling back to exec`);
            client.exec('sh', (execErr, execStream) => {
              if (execErr) {
                client.end();
                return reject(execErr);
              }
              setupSession(sessionId, hostIp, userId, 'exec', client, execStream, { onData, onClose, onError });
              resolve(sessionId);
            });
            return;
          }
          setupSession(sessionId, hostIp, userId, 'pty', client, stream, { onData, onClose, onError });
          resolve(sessionId);
        }
      );
    });

    client.on('error', (err) => {
      reject(err);
    });

    client.connect({
      ...sshDefaults,
      host: hostIp,
    });
  });
}

/**
 * Wire up a session's stream events and store it.
 */
function setupSession(sessionId, hostIp, userId, mode, client, stream, { onData, onClose, onError }) {
  const session = {
    id: sessionId,
    hostIp,
    userId,
    mode,
    client,
    stream,
    onData,
    onClose,
    onError,
    idleTimer: null,
    createdAt: new Date(),
    lastActivity: new Date(),
  };

  stream.on('data', (data) => {
    touchSession(session);
    if (onData) onData(data.toString('binary'));
  });

  stream.stderr?.on('data', (data) => {
    touchSession(session);
    if (onData) onData(data.toString('binary'));
  });

  stream.on('close', () => {
    const reason = 'remote closed';
    cleanup(sessionId, reason);
  });

  stream.on('error', (err) => {
    if (onError) onError(err.message);
  });

  client.on('end', () => {
    cleanup(sessionId, 'connection ended');
  });

  client.on('close', () => {
    cleanup(sessionId, 'connection closed');
  });

  sessions.set(sessionId, session);
  touchSession(session);

  console.log(`[Terminal] Session ${sessionId} opened to ${hostIp} (${mode} mode, user: ${userId})`);
}

/**
 * Cleanup a session and notify via onClose callback.
 */
function cleanup(sessionId, reason) {
  const session = sessions.get(sessionId);
  if (!session) return;

  if (session.idleTimer) clearTimeout(session.idleTimer);
  sessions.delete(sessionId);

  try { session.stream.end(); } catch (err) { console.debug('[Terminal] cleanup: stream end failed:', err.message); }
  try { session.client.end(); } catch (err) { console.debug('[Terminal] cleanup: client end failed:', err.message); }

  console.log(`[Terminal] Session ${sessionId} closed: ${reason}`);
  if (session.onClose) session.onClose(reason);
}

/**
 * Write data to a session's stdin.
 */
function writeToSession(sessionId, data) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Session not found');
  touchSession(session);
  session.stream.write(data);
}

/**
 * Resize a session's PTY.
 */
function resizeSession(sessionId, cols, rows) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Session not found');
  if (session.mode === 'pty' && session.stream.setWindow) {
    session.stream.setWindow(rows, cols, 0, 0);
  }
}

/**
 * Destroy a session.
 */
function destroySession(sessionId) {
  cleanup(sessionId, 'destroyed by user');
}

/**
 * List active sessions (for REST endpoint).
 */
function listSessions() {
  const result = [];
  for (const [id, s] of sessions) {
    result.push({
      id,
      hostIp: s.hostIp,
      userId: s.userId,
      mode: s.mode,
      createdAt: s.createdAt.toISOString(),
      lastActivity: s.lastActivity.toISOString(),
    });
  }
  return result;
}

/**
 * Get a session by ID.
 */
function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

/**
 * Destroy all sessions (for graceful shutdown).
 */
function destroyAll() {
  for (const id of sessions.keys()) {
    cleanup(id, 'server shutdown');
  }
}

module.exports = {
  createSession,
  writeToSession,
  resizeSession,
  destroySession,
  listSessions,
  getSession,
  destroyAll,
};
