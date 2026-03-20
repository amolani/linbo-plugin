/**
 * LINBO Plugin - Driver Filesystem Utilities
 * Recursive directory operations, symlink removal, hash computation, and manifest generation
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Recursively list files in a directory
 * @param {string} dirPath - Directory to list
 * @param {string} prefix - Current relative path prefix
 * @returns {Promise<Array<{name: string, path: string, size: number, isDirectory: boolean}>>}
 */
async function listDirRecursive(dirPath, prefix) {
  const results = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      results.push({ name: entry.name, path: relPath, size: 0, isDirectory: true });
      const sub = await listDirRecursive(fullPath, relPath);
      results.push(...sub);
    } else if (entry.isFile()) {
      const stat = await fs.stat(fullPath);
      results.push({ name: entry.name, path: relPath, size: stat.size, isDirectory: false });
    }
  }

  return results;
}

/**
 * Count files recursively in a directory
 * @param {string} dirPath
 * @returns {Promise<number>}
 */
async function countFiles(dirPath) {
  let count = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        count++;
      } else if (entry.isDirectory()) {
        count += await countFiles(path.join(dirPath, entry.name));
      }
    }
  } catch { /* permission error or not exist */ }
  return count;
}

/**
 * Get total size of files in a directory recursively
 * @param {string} dirPath
 * @returns {Promise<number>}
 */
async function getDirSize(dirPath) {
  let size = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isFile()) {
        const stat = await fs.stat(fullPath);
        size += stat.size;
      } else if (entry.isDirectory()) {
        size += await getDirSize(fullPath);
      }
    }
  } catch { /* permission error or not exist */ }
  return size;
}

/**
 * Remove symlinks recursively from a directory (post-extraction safety)
 * @param {string} dirPath
 */
async function removeSymlinks(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isSymbolicLink()) {
      await fs.unlink(fullPath);
    } else if (entry.isDirectory()) {
      await removeSymlinks(fullPath);
    }
  }
}

/**
 * Compute a hash over sorted file metadata (name+size+mtime) in a directory
 * Used for manifest set-level change detection
 * @param {string} setDir - Driver set directory path
 * @returns {Promise<string>} MD5 hex digest
 */
async function computeSetHash(setDir) {
  const fileEntries = [];
  await collectFileMetadata(setDir, '', fileEntries);
  fileEntries.sort((a, b) => a.path.localeCompare(b.path));

  const hash = crypto.createHash('md5');
  for (const entry of fileEntries) {
    hash.update(`${entry.path}:${entry.size}:${entry.mtimeMs}\n`);
  }
  return hash.digest('hex');
}

/**
 * Collect file metadata recursively (helper for computeSetHash)
 * @param {string} dirPath
 * @param {string} prefix
 * @param {Array} results
 */
async function collectFileMetadata(dirPath, prefix, results) {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isFile()) {
      const stat = await fs.stat(fullPath);
      results.push({ path: relPath, size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) });
    } else if (entry.isDirectory()) {
      await collectFileMetadata(fullPath, relPath, results);
    }
  }
}

/**
 * Generate driver-manifest.json for a driver profile directory
 * @param {string} profileDir - Driver profile directory path
 * @param {string} mapHash - Pre-computed hash of driver-map.json
 * @returns {Promise<object>} The manifest object
 */
async function generateManifest(profileDir, mapHash) {
  const driversDir = path.join(profileDir, 'drivers');
  const sets = {};

  try {
    const entries = await fs.readdir(driversDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const setDir = path.join(driversDir, entry.name);
      const hash = await computeSetHash(setDir);
      const fileCount = await countFiles(setDir);
      const totalSize = await getDirSize(setDir);
      sets[entry.name] = { hash, fileCount, totalSize };
    }
  } catch { /* no drivers dir yet */ }

  // Compute repoHash from mapHash + sorted set hashes
  const repoHashInput = mapHash + Object.keys(sets)
    .sort()
    .map(k => sets[k].hash)
    .join('');
  const repoHash = crypto.createHash('md5').update(repoHashInput).digest('hex');

  const manifest = {
    repoHash,
    mapHash,
    sets,
    generatedAt: new Date().toISOString(),
  };

  // Write manifest atomically
  const manifestPath = path.join(profileDir, 'driver-manifest.json');
  const tmp = manifestPath + '.tmp.' + process.pid;
  await fs.writeFile(tmp, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o644 });
  await fs.rename(tmp, manifestPath);

  return manifest;
}

module.exports = {
  listDirRecursive,
  countFiles,
  getDirSize,
  removeSymlinks,
  computeSetHash,
  generateManifest,
};
