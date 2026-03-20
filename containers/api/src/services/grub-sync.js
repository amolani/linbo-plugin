/**
 * LINBO Docker - GRUB Config Sync
 * Writes raw GRUB configs from LMN Authority API to the TFTP volume.
 * Rewrites server= in kernel cmdlines to the Docker VM IP.
 * Creates hostcfg/ symlinks for GRUB hostname and MAC fallback.
 */

const fsp = require('fs/promises');
const path = require('path');
const { atomicWrite, forceSymlink, safeUnlink } = require('../lib/atomic-write');

const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';
const GRUB_DIR = path.join(LINBO_DIR, 'boot/grub');
const HOSTCFG_DIR = path.join(GRUB_DIR, 'hostcfg');

/**
 * Rewrite server=<old> to server=<new> in raw GRUB config text.
 * Applies globally — all server= occurrences are replaced.
 * Safe no-op when content has no server= or either argument is falsy.
 *
 * @param {string|null} content - Raw GRUB config text
 * @param {string|null} newServerIp - New server IP (e.g. '10.0.0.13')
 * @returns {string|null} Rewritten content, or original if nothing to replace
 */
function rewriteGrubServerIp(content, newServerIp) {
  if (!content || !newServerIp) return content;
  return content.replace(/\bserver=\S+/g, `server=${newServerIp}`);
}

/**
 * Write GRUB configs from Authority API response to the TFTP volume.
 * Rewrites server= in all files. Removes stale group .cfg files not in API response.
 * Does NOT touch subdirectories (e.g. hostcfg/).
 *
 * @param {Array<{id: string, filename: string, content: string, updatedAt: string|null}>} grubConfigs
 * @param {string} serverIp - Docker VM IP for server= rewrite
 */
async function writeGrubConfigs(grubConfigs, serverIp) {
  await fsp.mkdir(GRUB_DIR, { recursive: true });

  const expectedFiles = new Set();

  for (const cfg of grubConfigs) {
    const filename = cfg.id === 'grub' ? 'grub.cfg' : `${cfg.id}.cfg`;
    const filepath = path.join(GRUB_DIR, filename);
    const rewritten = rewriteGrubServerIp(cfg.content, serverIp);
    await atomicWrite(filepath, rewritten);
    expectedFiles.add(filename);
  }

  // Remove stale .cfg files not in the API response (files only, not directories)
  try {
    const entries = await fsp.readdir(GRUB_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      if (entry.name.endsWith('.cfg') && !expectedFiles.has(entry.name)) {
        await safeUnlink(path.join(GRUB_DIR, entry.name));
        console.log(`[GrubSync] Removed stale: ${entry.name}`);
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[GrubSync] Cleanup error:', err.message);
    }
  }
}

/**
 * Create hostcfg/{hostname}.cfg and hostcfg/01-{mac}.cfg symlinks for all hosts.
 * Each symlink points to ../{hostgroup}.cfg (relative to hostcfg/ directory).
 * Removes stale hostcfg .cfg files not belonging to any current host.
 *
 * @param {Array<{hostname: string|null, mac: string|null, hostgroup: string|null}>} hosts
 */
async function writeHostcfgSymlinks(hosts) {
  await fsp.mkdir(HOSTCFG_DIR, { recursive: true });

  const expectedFiles = new Set();

  for (const host of hosts) {
    if (!host.hostgroup) continue;
    const cfgFile = `${host.hostgroup}.cfg`;
    const target = `../${cfgFile}`;

    // hostname-based symlink
    if (host.hostname) {
      const hostFile = `${host.hostname}.cfg`;
      expectedFiles.add(hostFile);
      await forceSymlink(target, path.join(HOSTCFG_DIR, hostFile));
    }

    // MAC-based symlink (GRUB fallback when $net_pxe_hostname is not set)
    if (host.mac) {
      const macFile = '01-' + host.mac.toLowerCase().replace(/:/g, '-') + '.cfg';
      expectedFiles.add(macFile);
      await forceSymlink(target, path.join(HOSTCFG_DIR, macFile));
    }
  }

  // Remove stale hostcfg .cfg files
  try {
    const files = await fsp.readdir(HOSTCFG_DIR);
    for (const file of files) {
      if (file.endsWith('.cfg') && !expectedFiles.has(file)) {
        await safeUnlink(path.join(HOSTCFG_DIR, file));
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[GrubSync] Hostcfg cleanup error:', err.message);
    }
  }
}

module.exports = { writeGrubConfigs, writeHostcfgSymlinks, rewriteGrubServerIp };
