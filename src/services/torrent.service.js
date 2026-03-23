/**
 * LINBO Plugin - Torrent Service
 * Wrapper around /usr/sbin/linbo-torrent for BitTorrent seeding management.
 */

'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;

const execFileAsync = promisify(execFile);
const TORRENT_BIN = '/usr/sbin/linbo-torrent';
const CONFIG_FILE = '/etc/default/linbo-torrent';

// Image name validation (same pattern as image-path.js)
const SAFE_IMAGE_RE = /^[a-zA-Z0-9._-]+$/;

function validateImage(name) {
  if (!name || !SAFE_IMAGE_RE.test(name)) {
    throw Object.assign(new Error(`Invalid image name: ${name}`), { statusCode: 400 });
  }
}

/**
 * Execute linbo-torrent with given action and optional image.
 */
async function exec(action, image) {
  const args = [TORRENT_BIN, action];
  if (image) {
    validateImage(image);
    args.push(image);
  }
  try {
    const { stdout, stderr } = await execFileAsync('sudo', args, {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw Object.assign(new Error('linbo-torrent not installed'), { statusCode: 503 });
    }
    throw Object.assign(
      new Error(err.stderr?.trim() || err.message),
      { statusCode: 500 }
    );
  }
}

/**
 * Get status of all active torrent sessions.
 */
async function status() {
  const { stdout } = await exec('status');
  // Parse tmux session list: "session_name: N windows (created ...)"
  const sessions = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const match = line.match(/^(\S+?):\s+(\d+)\s+windows?\s+\(created\s+(.+?)\)/);
    if (match) {
      sessions.push({ name: match[1], windows: parseInt(match[2], 10), created: match[3] });
    } else {
      sessions.push({ name: line.trim(), raw: true });
    }
  }
  return { active: sessions.length > 0, sessions };
}

/**
 * Start torrent seeding for an image (or all images).
 */
async function start(image) {
  const result = await exec('start', image);
  return { success: true, output: result.stdout };
}

/**
 * Stop torrent seeding for an image (or all).
 */
async function stop(image) {
  const result = await exec('stop', image);
  return { success: true, output: result.stdout };
}

/**
 * Create .torrent file for an image.
 */
async function create(image) {
  validateImage(image);
  const result = await exec('create', image);
  return { success: true, output: result.stdout };
}

/**
 * Verify torrent integrity for an image.
 */
async function check(image) {
  validateImage(image);
  const result = await exec('check', image);
  return { success: true, output: result.stdout };
}

/**
 * Read torrent config from /etc/default/linbo-torrent.
 */
async function getConfig() {
  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf8');
    const config = {};
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z_]+)=["']?(.+?)["']?\s*(#.*)?$/);
      if (match) config[match[1]] = match[2];
    }
    return config;
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

module.exports = { status, start, stop, create, check, getConfig };
