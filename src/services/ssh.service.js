/**
 * LINBO Plugin - SSH Service
 * Execute commands on hosts via SSH
 *
 * Key loading is LAZY: the SSH private key is loaded on first use,
 * not at module import time. This eliminates the race condition where
 * the API starts before setup.sh has provisioned the key file.
 */

const { Client } = require('ssh2');
const fs = require('fs');

/**
 * SSH key paths — resolved from environment or defaults.
 */
const linboKeyPath = process.env.LINBO_CLIENT_SSH_KEY || '/etc/linuxmuster/linbo/ssh_host_rsa_key_client';

/**
 * Cached private key. Sentinel values:
 *   undefined = not yet attempted
 *   Buffer    = successfully loaded
 * If loading fails with no fallback, getPrivateKey() throws (never caches failure).
 */
let _cachedKey = undefined;

/**
 * Lazily load and cache the SSH private key.
 * Tries linboKeyPath first, then fallbackKeyPath (SSH_PRIVATE_KEY env).
 * Caches the result after first successful load.
 *
 * @returns {Buffer} The SSH private key
 * @throws {Error} If no key can be loaded
 */
function getPrivateKey() {
  if (_cachedKey !== undefined) {
    return _cachedKey;
  }

  // Try primary key path
  try {
    _cachedKey = fs.readFileSync(linboKeyPath);
    console.log(`[SSH] Loaded LINBO client key from ${linboKeyPath}`);
    return _cachedKey;
  } catch {
    // Primary key not available, try fallback
  }

  // Try fallback key path
  const fallbackKeyPath = process.env.SSH_PRIVATE_KEY;
  if (fallbackKeyPath) {
    try {
      _cachedKey = fs.readFileSync(fallbackKeyPath);
      console.warn(`[SSH] LINBO client key not found, using fallback ${fallbackKeyPath}`);
      return _cachedKey;
    } catch {
      // Fallback also failed
    }
  }

  // No key available
  throw new Error(
    `SSH private key not available. Ensure setup.sh has been run and /etc/linuxmuster/linbo/ssh_host_rsa_key_client is readable by linbo user. Expected: ${linboKeyPath}`
  );
}

/**
 * Build SSH connection config for a given host.
 * Calls getPrivateKey() on each invocation (returns cached after first load).
 *
 * @param {string} host - Hostname or IP address
 * @param {object} options - Additional SSH connection options
 * @returns {object} Merged SSH config
 */
function getConfig(host, options = {}) {
  const key = getPrivateKey();

  return {
    host,
    port: parseInt(process.env.LINBO_CLIENT_SSH_PORT, 10) || 2222,
    username: 'root',
    privateKey: key,
    readyTimeout: parseInt(process.env.SSH_TIMEOUT, 10) || 10000,
    keepaliveInterval: 5000,
    ...options,
  };
}

/**
 * Execute command on remote host via SSH
 * @param {string} host - Hostname or IP address
 * @param {string} command - Command to execute
 * @param {object} options - SSH connection options
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
async function executeCommand(host, command, options = {}) {
  const config = getConfig(host, options);

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }

        stream.on('close', (code) => {
          conn.end();
          resolve({ stdout, stderr, code });
        });

        const MAX_OUTPUT = 10 * 1024 * 1024; // 10MB safety limit
        stream.on('data', (data) => {
          if (stdout.length < MAX_OUTPUT) stdout += data.toString();
        });

        stream.stderr.on('data', (data) => {
          if (stderr.length < MAX_OUTPUT) stderr += data.toString();
        });
      });
    });

    conn.on('error', (err) => {
      console.error(`[SSH] Connection to ${host}:${config.port} failed: ${err.message}`);
      reject(err);
    });

    conn.connect(config);
  });
}

/**
 * Execute multiple commands sequentially
 * @param {string} host - Hostname or IP address
 * @param {string[]} commands - Array of commands
 * @param {object} options - SSH connection options
 */
async function executeCommands(host, commands, options = {}) {
  const results = [];

  for (const command of commands) {
    try {
      const result = await executeCommand(host, command, options);
      results.push({
        command,
        success: result.code === 0,
        ...result,
      });

      // Stop on failure unless continueOnError is set
      if (result.code !== 0 && !options.continueOnError) {
        break;
      }
    } catch (error) {
      results.push({
        command,
        success: false,
        error: error.message,
        code: -1,
      });

      if (!options.continueOnError) {
        break;
      }
    }
  }

  return results;
}

/**
 * Execute command with timeout
 * @param {string} host - Hostname or IP address
 * @param {string} command - Command to execute
 * @param {number} timeout - Timeout in milliseconds
 * @param {object} options - SSH connection options
 */
async function executeWithTimeout(host, command, timeout = 30000, options = {}) {
  const config = getConfig(host, options);
  const conn = new Client();
  let timedOut = false;

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    try { conn.end(); } catch {}
  }, timeout);

  try {
    const result = await new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      conn.on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) { conn.end(); return reject(err); }
          stream.on('close', (code) => { conn.end(); resolve({ stdout, stderr, code }); });
          stream.on('data', (data) => { stdout += data.toString(); });
          stream.stderr.on('data', (data) => { stderr += data.toString(); });
        });
      });
      conn.on('error', (err) => reject(err));
      conn.connect(config);
    });
    clearTimeout(timeoutHandle);
    return result;
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (timedOut) throw new Error('Command timeout');
    throw err;
  }
}

/**
 * Test SSH connectivity to host
 * @param {string} host - Hostname or IP address
 * @param {object} options - SSH connection options
 */
async function testConnection(host, options = {}) {
  try {
    const result = await executeWithTimeout(host, 'echo "connected"', 5000, options);
    return {
      success: true,
      connected: result.stdout.trim() === 'connected',
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// Validation patterns for shell-safe parameters
const SAFE_OSNAME_RE = /^[A-Za-z0-9 ._-]{1,100}$/;
const SAFE_PARTITION_RE = /^\/dev\/[a-z]{2,8}[0-9]{1,3}$/;
const SAFE_DOWNLOAD_TYPE_RE = /^(rsync|multicast|torrent)$/;

/**
 * Validate a parameter is safe for shell interpolation.
 * @throws {Error} if value contains shell metacharacters
 */
function validateShellParam(value, name, pattern) {
  if (!pattern.test(value)) {
    throw new Error(`Invalid ${name}: "${value}" does not match expected format`);
  }
}

/**
 * Execute LINBO command on host
 * @param {string} host - Hostname or IP address
 * @param {string} linboCommand - LINBO command (sync, start, reboot, shutdown)
 * @param {object} params - Command parameters
 */
async function executeLinboCommand(host, linboCommand, params = {}) {
  let command;

  switch (linboCommand) {
    case 'sync':
      command = params.forceNew
        ? 'linbo_cmd synconly -f'
        : 'linbo_cmd synconly';
      if (params.osName) {
        validateShellParam(params.osName, 'osName', SAFE_OSNAME_RE);
        command += ` ${params.osName}`;
      }
      break;

    case 'start':
      if (params.osName) {
        validateShellParam(params.osName, 'osName', SAFE_OSNAME_RE);
        command = `linbo_cmd start ${params.osName}`;
      } else {
        command = 'linbo_cmd start';
      }
      break;

    case 'reboot':
      command = 'linbo_cmd reboot';
      break;

    case 'shutdown':
      command = 'linbo_cmd shutdown';
      break;

    case 'halt':
      command = 'linbo_cmd halt';
      break;

    case 'initcache':
      if (params.downloadType) {
        validateShellParam(params.downloadType, 'downloadType', SAFE_DOWNLOAD_TYPE_RE);
        command = `linbo_cmd initcache ${params.downloadType}`;
      } else {
        command = 'linbo_cmd initcache';
      }
      break;

    case 'partition':
      command = 'linbo_cmd partition';
      break;

    case 'format':
      if (params.partition) {
        validateShellParam(params.partition, 'partition', SAFE_PARTITION_RE);
        command = `linbo_cmd format ${params.partition}`;
      } else {
        command = 'linbo_cmd format';
      }
      break;

    default:
      throw new Error(`Unknown LINBO command: ${linboCommand}`);
  }

  return executeCommand(host, command, params.sshOptions);
}

/**
 * Get LINBO status from host
 * @param {string} host - Hostname or IP address
 * @param {object} options - SSH connection options
 */
async function getLinboStatus(host, options = {}) {
  try {
    const [osInfo, cacheInfo, diskInfo] = await Promise.all([
      executeCommand(host, 'linbo_cmd listimages', options),
      executeCommand(host, 'df -h /cache', options),
      executeCommand(host, 'lsblk -J', options),
    ]);

    return {
      success: true,
      images: osInfo.stdout.trim().split('\n').filter(Boolean),
      cache: cacheInfo.stdout,
      disks: diskInfo.stdout ? JSON.parse(diskInfo.stdout) : null,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Stream command output (for long-running commands)
 * @param {string} host - Hostname or IP address
 * @param {string} command - Command to execute
 * @param {function} onData - Callback for stdout data
 * @param {function} onError - Callback for stderr data
 * @param {object} options - SSH connection options
 */
function streamCommand(host, command, onData, onError, options = {}) {
  const config = getConfig(host, options);

  const conn = new Client();

  return new Promise((resolve, reject) => {
    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }

        stream.on('close', (code) => {
          conn.end();
          resolve({ code });
        });

        stream.on('data', (data) => {
          if (onData) onData(data.toString());
        });

        stream.stderr.on('data', (data) => {
          if (onError) onError(data.toString());
        });
      });
    });

    conn.on('error', (err) => {
      console.error(`[SSH] Connection to ${host}:${config.port} failed: ${err.message}`);
      reject(err);
    });
    conn.connect(config);
  });
}

module.exports = {
  executeCommand,
  executeCommands,
  executeWithTimeout,
  testConnection,
  executeLinboCommand,
  getLinboStatus,
  streamCommand,

  // Testing namespace — exposed for unit tests only
  _testing: {
    getPrivateKey,
    getConfig,
    _resetCache: () => { _cachedKey = undefined; },
  },
};
