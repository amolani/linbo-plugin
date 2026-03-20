/**
 * LINBO Plugin - Firmware Scanner
 * Scans /lib/firmware for available firmware files with caching + mutex
 */

const fs = require('fs').promises;
const path = require('path');

// =============================================================================
// Constants
// =============================================================================

const fsSync = require('fs');
const FIRMWARE_BASE_RAW = process.env.FIRMWARE_BASE || '/lib/firmware';
// Resolve symlinks (on modern Debian/Ubuntu, /lib → /usr/lib)
const FIRMWARE_BASE = fsSync.existsSync(FIRMWARE_BASE_RAW)
  ? fsSync.realpathSync(FIRMWARE_BASE_RAW)
  : FIRMWARE_BASE_RAW;
const CACHE_TTL = 3600000; // 1 hour
const SEARCH_TIMEOUT = 2000; // 2 seconds max for deep search
const DEFAULT_SEARCH_LIMIT = 50;

// =============================================================================
// Cache
// =============================================================================

let _cache = null;
let _cacheTime = 0;
let _scanPromise = null; // Mutex: prevents parallel scans

// =============================================================================
// Scanner Functions
// =============================================================================

/**
 * Shallow scan: top-level entries + 1 level deep (for search index)
 * Returns array of relative paths
 */
async function scanFirmwareDir() {
  const results = [];

  try {
    await fs.access(FIRMWARE_BASE);
  } catch {
    return results;
  }

  try {
    const topLevel = await fs.readdir(FIRMWARE_BASE, { withFileTypes: true });

    for (const entry of topLevel) {
      // Skip hidden files and symlinks pointing outside base
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(FIRMWARE_BASE, entry.name);

      if (entry.isFile() || entry.isSymbolicLink()) {
        // Check symlink safety
        try {
          const real = await fs.realpath(fullPath);
          if (real !== FIRMWARE_BASE && !real.startsWith(FIRMWARE_BASE + path.sep)) continue;
        } catch {
          continue;
        }
        results.push(entry.name);
      } else if (entry.isDirectory()) {
        results.push(entry.name + '/');

        // 1 level deep
        try {
          const subEntries = await fs.readdir(fullPath, { withFileTypes: true });
          for (const sub of subEntries) {
            if (sub.name.startsWith('.')) continue;
            const relPath = entry.name + '/' + sub.name;
            if (sub.isDirectory()) {
              results.push(relPath + '/');
            } else {
              results.push(relPath);
            }
          }
        } catch {
          // Permission denied or other error — skip
        }
      }
    }
  } catch (err) {
    console.error('Firmware scan error:', err.message);
  }

  _cache = results;
  _cacheTime = Date.now();
  return results;
}

/**
 * Get cached scan results, or trigger a new scan
 */
async function getCachedScan() {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;
  // Mutex: only one scan at a time
  if (_scanPromise) return _scanPromise;
  _scanPromise = scanFirmwareDir().finally(() => { _scanPromise = null; });
  return _scanPromise;
}

/**
 * Deep search within a specific directory (on-demand, with timeout)
 */
async function deepSearchDir(dirPath, query, limit, deadline) {
  const results = [];
  if (Date.now() > deadline || results.length >= limit) return results;

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (Date.now() > deadline || results.length >= limit) break;
      if (entry.name.startsWith('.')) continue;

      const relPath = path.relative(FIRMWARE_BASE, path.join(dirPath, entry.name));

      if (entry.isDirectory()) {
        // Check if dir name matches
        if (entry.name.toLowerCase().includes(query)) {
          results.push(relPath + '/');
        }
        // Recurse
        const subResults = await deepSearchDir(
          path.join(dirPath, entry.name), query, limit - results.length, deadline
        );
        results.push(...subResults);
      } else {
        if (entry.name.toLowerCase().includes(query)) {
          results.push(relPath);
        }
      }
    }
  } catch {
    // Permission denied or other error
  }

  return results;
}

/**
 * Search firmware files by query string
 * Uses cached shallow index first, then does deeper search if needed
 */
async function searchFirmware(query, limit = DEFAULT_SEARCH_LIMIT) {
  if (!query || query.trim().length === 0) {
    // Return top-level entries
    const cached = await getCachedScan();
    return cached.slice(0, limit);
  }

  const q = query.toLowerCase().trim();
  const cached = await getCachedScan();

  // First: search in shallow cache
  const shallowResults = cached.filter(p => p.toLowerCase().includes(q));

  if (shallowResults.length >= limit) {
    return shallowResults.slice(0, limit);
  }

  // Deep search: look inside directories that match
  const deadline = Date.now() + SEARCH_TIMEOUT;
  const deepResults = new Set(shallowResults);

  // Find directories to search deeper
  const dirsToSearch = cached
    .filter(p => p.endsWith('/') && p.toLowerCase().includes(q))
    .map(p => p.slice(0, -1));

  // Also search top-level directories even if their name doesn't match
  const topDirs = cached
    .filter(p => p.endsWith('/') && !p.includes('/'))
    .map(p => p.slice(0, -1));

  const allDirs = [...new Set([...dirsToSearch, ...topDirs])];

  for (const dir of allDirs) {
    if (Date.now() > deadline || deepResults.size >= limit) break;
    const dirPath = path.join(FIRMWARE_BASE, dir);
    const found = await deepSearchDir(dirPath, q, limit - deepResults.size, deadline);
    for (const f of found) {
      deepResults.add(f);
    }
  }

  return [...deepResults].slice(0, limit);
}

/**
 * Validate a firmware path exists and resolve safely
 */
async function validateFirmwarePath(entry) {
  const fullPath = path.join(FIRMWARE_BASE, entry);

  // Check for .zst variant
  let actualPath = fullPath;
  let isZst = false;
  try {
    await fs.access(fullPath);
  } catch {
    try {
      await fs.access(fullPath + '.zst');
      actualPath = fullPath + '.zst';
      isZst = true;
    } catch {
      return { exists: false, isFile: false, isDirectory: false, size: 0, isZst: false };
    }
  }

  // Symlink safety check
  try {
    const realPath = await fs.realpath(actualPath);
    if (realPath !== FIRMWARE_BASE && !realPath.startsWith(FIRMWARE_BASE + path.sep)) {
      return { exists: false, isFile: false, isDirectory: false, size: 0, error: 'symlink outside base' };
    }
  } catch {
    return { exists: false, isFile: false, isDirectory: false, size: 0 };
  }

  try {
    const stat = await fs.stat(actualPath);
    if (stat.isDirectory()) {
      // Count files in directory
      let fileCount = 0;
      const countFiles = async (dir) => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile()) fileCount++;
          else if (e.isDirectory()) await countFiles(path.join(dir, e.name));
        }
      };
      await countFiles(actualPath);
      return { exists: true, isFile: false, isDirectory: true, size: 0, fileCount, isZst: false };
    }
    return { exists: true, isFile: true, isDirectory: false, size: stat.size, isZst };
  } catch {
    return { exists: false, isFile: false, isDirectory: false, size: 0 };
  }
}

/**
 * Invalidate the scanner cache (e.g. after firmware changes)
 */
function invalidateCache() {
  _cache = null;
  _cacheTime = 0;
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  FIRMWARE_BASE,
  scanFirmwareDir,
  getCachedScan,
  searchFirmware,
  validateFirmwarePath,
  invalidateCache,
};
