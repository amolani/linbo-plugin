/**
 * LINBO Docker - Atomic File Write Utility
 * Crash-safe file writes: tmp → datasync → rename → dir-fsync
 */

const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

/**
 * Write content atomically: write to tmp file, datasync, rename to target, dir-fsync.
 * @param {string} filepath - Target file path
 * @param {string} content - File content
 */
async function atomicWrite(filepath, content) {
  const dir = path.dirname(filepath);
  const tmp = `${filepath}.tmp.${process.pid}`;

  await fsp.mkdir(dir, { recursive: true });

  const fd = await fsp.open(tmp, 'w');
  try {
    await fd.writeFile(content);
    await fd.datasync();
  } finally {
    await fd.close();
  }

  await fsp.rename(tmp, filepath);

  // Directory fsync: ensures the rename entry is persisted to disk
  const dirFd = await fsp.open(dir, 'r');
  try {
    await dirFd.datasync();
  } finally {
    await dirFd.close();
  }
}

/**
 * Write content atomically and also write its MD5 hash file alongside it.
 * @param {string} filepath - Target file path
 * @param {string} content - File content
 * @returns {Promise<string>} MD5 hex hash
 */
async function atomicWriteWithMd5(filepath, content) {
  const hash = crypto.createHash('md5').update(content).digest('hex');
  await atomicWrite(filepath, content);
  await atomicWrite(`${filepath}.md5`, hash);
  return hash;
}

/**
 * Safely remove a file, ignoring ENOENT.
 * @param {string} filepath
 */
async function safeUnlink(filepath) {
  try {
    await fsp.unlink(filepath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * Create a symlink, removing any existing file/symlink at the path first.
 * @param {string} target - Symlink target (relative or absolute)
 * @param {string} linkPath - Symlink file path
 */
async function forceSymlink(target, linkPath) {
  await fsp.mkdir(path.dirname(linkPath), { recursive: true });
  await safeUnlink(linkPath);
  await fsp.symlink(target, linkPath);
}

module.exports = {
  atomicWrite,
  atomicWriteWithMd5,
  safeUnlink,
  forceSymlink,
};
