/**
 * LINBO Plugin - Multicast Service
 * Wrapper around /usr/sbin/linbo-multicast for multicast image distribution.
 */

'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

const execFileAsync = promisify(execFile);
const MULTICAST_BIN = '/usr/sbin/linbo-multicast';
const CONFIG_FILE = '/etc/default/linbo-multicast';
const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';
const MULTICAST_LIST = path.join(LINBO_DIR, 'multicast.list');

/**
 * Execute linbo-multicast with given action.
 */
async function exec(action) {
  try {
    const { stdout, stderr } = await execFileAsync('sudo', [MULTICAST_BIN, action], {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw Object.assign(new Error('linbo-multicast not installed'), { statusCode: 503 });
    }
    throw Object.assign(
      new Error(err.stderr?.trim() || err.message),
      { statusCode: 500 }
    );
  }
}

/**
 * Get status of active multicast sessions.
 */
async function status() {
  const { stdout } = await exec('status');
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
 * Start multicast sessions for all images.
 */
async function start() {
  const result = await exec('start');
  return { success: true, output: result.stdout };
}

/**
 * Stop all multicast sessions.
 */
async function stop() {
  const result = await exec('stop');
  return { success: true, output: result.stdout };
}

/**
 * Read multicast config from /etc/default/linbo-multicast.
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

/**
 * Read multicast.list (image → port mapping).
 */
async function getMulticastList() {
  try {
    const content = await fs.readFile(MULTICAST_LIST, 'utf8');
    const entries = [];
    for (const line of content.split('\n')) {
      if (!line.trim() || line.startsWith('#')) continue;
      // Format: image:port or image port
      const parts = line.trim().split(/[:\s]+/);
      if (parts.length >= 2) {
        entries.push({ image: parts[0], port: parseInt(parts[1], 10) || 0 });
      }
    }
    return entries;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

module.exports = { status, start, stop, getConfig, getMulticastList };
