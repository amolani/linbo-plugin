'use strict';

/**
 * LINBO Native - Filesystem Service
 *
 * Native read/write access to the LINBO filesystem and systemd service reload.
 * Provides: start.conf enumeration/parsing, GRUB config read/write, service reload.
 *
 * No new npm dependencies -- uses only Node built-ins + existing project libs.
 *
 * @module linbo-fs.service
 */

const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { atomicWrite } = require('../lib/atomic-write');
const { parseStartConf } = require('../lib/startconf-parser');
const { readHostsFromDevicesCsv } = require('../lib/devices-csv-reader');

const execFileAsync = promisify(execFile);

const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';
const GRUB_DIR = path.join(LINBO_DIR, 'boot/grub');

/**
 * List native start.conf group IDs by scanning LINBO_DIR.
 * Only group confs (dot separator), not IP/MAC symlinks, not .md5/.bak files.
 *
 * @returns {Promise<string[]>} Array of group IDs (e.g., ['win11_efi_sata', 'ubuntu_efi'])
 */
async function listNativeStartConfIds() {
  let files;
  try {
    files = await fsp.readdir(LINBO_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  return files
    .filter(f => f.startsWith('start.conf.')
                 && !f.endsWith('.md5')
                 && !f.endsWith('.bak'))
    .map(f => f.replace(/^start\.conf\./, ''));
}

/**
 * Read and parse a native start.conf file for the given group ID.
 *
 * @param {string} id - Group ID (e.g., 'win11_efi_sata')
 * @returns {Promise<{linbo: Object, partitions: Array, os: Array}|null>} Parsed config or null if not found
 */
async function parseNativeStartConf(id) {
  let content;
  try {
    content = await fsp.readFile(path.join(LINBO_DIR, `start.conf.${id}`), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }

  return parseStartConf(content);
}

/**
 * List GRUB config files from boot/grub/ directory.
 * Files only (not the hostcfg/ subdirectory), .cfg extension only.
 *
 * @returns {Promise<Array<{filename: string, id: string, path: string}>>}
 */
async function listNativeGrubConfigs() {
  let entries;
  try {
    entries = await fsp.readdir(GRUB_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  return entries
    .filter(e => e.isFile() && e.name.endsWith('.cfg'))
    .map(e => ({
      filename: e.name,
      id: e.name === 'grub.cfg' ? 'grub' : e.name.replace(/\.cfg$/, ''),
      path: path.join(GRUB_DIR, e.name),
    }));
}

/**
 * Read a GRUB config file by ID.
 *
 * @param {string} id - Config ID ('grub' maps to grub.cfg, others to {id}.cfg)
 * @returns {Promise<{id: string, filename: string, content: string}|null>} Config or null if not found
 */
async function readGrubConfig(id) {
  const filename = id === 'grub' ? 'grub.cfg' : `${id}.cfg`;
  let content;
  try {
    content = await fsp.readFile(path.join(GRUB_DIR, filename), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }

  return { id, filename, content };
}

/**
 * Write a GRUB config file atomically.
 *
 * @param {string} id - Config ID ('grub' maps to grub.cfg, others to {id}.cfg)
 * @param {string} content - File content to write
 * @returns {Promise<{id: string, filename: string, written: boolean}>}
 */
async function writeGrubConfig(id, content) {
  const filename = id === 'grub' ? 'grub.cfg' : `${id}.cfg`;
  await fsp.mkdir(GRUB_DIR, { recursive: true });
  await atomicWrite(path.join(GRUB_DIR, filename), content);
  return { id, filename, written: true };
}

/**
 * Reload rsync and restart tftpd-hpa via systemd.
 * Uses execFileAsync (never exec) with sudo for safe command execution.
 *
 * @returns {Promise<{success: boolean, errors: Array<string>}>}
 */
async function reloadLinboServices() {
  const errors = [];

  try {
    await execFileAsync('sudo', ['/bin/systemctl', 'reload', 'rsync']);
    console.log('[LinboFS] rsync reloaded');
  } catch (err) {
    errors.push(`rsync reload failed: ${err.message}`);
    console.error('[LinboFS] rsync reload failed:', err.message);
  }

  try {
    // tftpd-hpa: must restart -- no SIGHUP reload support (reads config only at startup)
    await execFileAsync('sudo', ['/bin/systemctl', 'restart', 'tftpd-hpa']);
    console.log('[LinboFS] tftpd-hpa restarted');
  } catch (err) {
    errors.push(`tftpd-hpa restart failed: ${err.message}`);
    console.error('[LinboFS] tftpd-hpa restart failed:', err.message);
  }

  return { success: errors.length === 0, errors };
}

module.exports = {
  listNativeStartConfIds,
  parseNativeStartConf,
  listNativeGrubConfigs,
  readGrubConfig,
  writeGrubConfig,
  reloadLinboServices,
  readHostsFromDevicesCsv,
};
