/**
 * LINBO Docker - Image Path Resolution
 * Central module for all image path operations.
 *
 * Production layout: /srv/linbo/images/<base>/<base>.qcow2
 * DB stores relative paths: "images/<base>/<base>.qcow2"
 */

const path = require('path');

const IMAGE_EXTS = ['.qcow2', '.qdiff', '.cloop'];
const IMAGE_SIDECARS = ['.info', '.desc', '.torrent', '.macct', '.md5'];
const IMAGE_SUPPLEMENTS = ['.reg', '.prestart', '.postsync'];
const READABLE_TYPES = ['desc', 'info', 'reg', 'prestart', 'postsync'];
const WRITABLE_TYPES = ['desc', 'reg', 'prestart', 'postsync'];
const INFO_KEYS = ['timestamp', 'image', 'imagesize', 'partition', 'partitionsize'];
const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';
const IMAGES_DIR = process.env.IMAGES_DIR || path.join(LINBO_DIR, 'images');
const FILENAME_RE = /^[a-zA-Z0-9._-]+$/;
const MAX_BASE_LEN = 100;

/**
 * Parse and validate a main image filename (e.g. "ubuntu22.qcow2").
 * Returns { base, ext, filename }.
 * Throws on any invalid input — call this before touching the filesystem.
 */
function parseMainFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new Error(`Invalid image filename: ${filename}`);
  }

  const ext = IMAGE_EXTS.find(e => filename.endsWith(e));
  if (!ext) {
    throw new Error(`Invalid image filename (unsupported extension): ${filename}`);
  }

  if (!FILENAME_RE.test(filename)) {
    throw new Error(`Unsafe filename: ${filename}`);
  }

  const base = filename.slice(0, -ext.length);
  if (!base) {
    throw new Error(`Empty base in filename: ${filename}`);
  }

  if (base === '.' || base === '..') {
    throw new Error(`Illegal base: ${filename}`);
  }

  if (base.length > MAX_BASE_LEN) {
    throw new Error(`Base too long (>${MAX_BASE_LEN}): ${filename}`);
  }

  return { base, ext, filename };
}

/**
 * Resolve the image subdirectory: IMAGES_DIR/<base>/
 */
function resolveImageDir(mainFilename) {
  const { base } = parseMainFilename(mainFilename);
  return path.join(IMAGES_DIR, base);
}

/**
 * Resolve the full image path: IMAGES_DIR/<base>/<filename>
 */
function resolveImagePath(mainFilename) {
  const { base, filename } = parseMainFilename(mainFilename);
  return path.join(IMAGES_DIR, base, filename);
}

/**
 * Resolve a sidecar file path: IMAGES_DIR/<base>/<filename><suffix>
 * e.g. resolveSidecarPath("ubuntu22.qcow2", ".md5")
 */
function resolveSidecarPath(mainFilename, suffix) {
  const { base, filename } = parseMainFilename(mainFilename);
  return path.join(IMAGES_DIR, base, filename + suffix);
}

/**
 * Parse a sidecar filename like "ubuntu.qcow2.info" into its parts.
 * Returns { imageFilename, sidecarExt } or null if not a valid sidecar.
 */
function parseSidecarFilename(filename) {
  if (!filename || typeof filename !== 'string') return null;
  if (!FILENAME_RE.test(filename)) return null;

  for (const sidecarExt of IMAGE_SIDECARS) {
    if (filename.endsWith(sidecarExt)) {
      const imageFilename = filename.slice(0, -sidecarExt.length);
      // Verify the remaining part is a valid image filename
      try {
        parseMainFilename(imageFilename);
        return { imageFilename, sidecarExt };
      } catch {
        // Not a valid image base — not a sidecar
      }
    }
  }
  return null;
}

/**
 * Resolve a supplement file path: IMAGES_DIR/<base>/<base><suffix>
 * e.g. resolveSupplementPath("ubuntu22.qcow2", ".reg") → IMAGES_DIR/ubuntu22/ubuntu22.reg
 */
function resolveSupplementPath(mainFilename, suffix) {
  if (!IMAGE_SUPPLEMENTS.includes(suffix)) {
    throw new Error(`Invalid supplement suffix: ${suffix}`);
  }
  const { base } = parseMainFilename(mainFilename);
  return path.join(IMAGES_DIR, base, base + suffix);
}

/**
 * Convert a main filename to the relative DB path: "images/<base>/<filename>"
 */
function toRelativePath(mainFilename) {
  const { base, filename } = parseMainFilename(mainFilename);
  return `images/${base}/${filename}`;
}

/**
 * Resolve a DB-stored relative path to an absolute filesystem path.
 * Handles legacy absolute paths and flat paths with warnings.
 */
function resolveFromDbPath(relPath) {
  if (!relPath || typeof relPath !== 'string') {
    throw new Error('Invalid DB path');
  }

  // Handle legacy absolute paths
  if (relPath.startsWith('/')) {
    console.warn(`[image-path] Absolute DB path found: ${relPath} — normalizing`);
    if (relPath.startsWith(LINBO_DIR + '/')) {
      relPath = relPath.slice(LINBO_DIR.length + 1);
    } else {
      throw new Error(`Absolute path outside LINBO_DIR: ${relPath}`);
    }
  }

  // Reject backslashes
  if (relPath.includes('\\')) {
    throw new Error(`Backslashes not allowed: ${relPath}`);
  }

  // No empty, '.', or '..' segments
  const segments = relPath.split('/');
  if (segments.some(s => s === '' || s === '.' || s === '..')) {
    throw new Error(`Unsafe DB path segment: ${relPath}`);
  }

  // Legacy flat path (e.g. "ubuntu22.qcow2" without "images/" prefix)
  if (!relPath.startsWith('images/')) {
    console.warn(`[image-path] Legacy flat DB path: ${relPath}`);
    return path.join(LINBO_DIR, relPath);
  }

  return path.join(LINBO_DIR, relPath);
}

module.exports = {
  IMAGE_EXTS,
  IMAGE_SIDECARS,
  IMAGE_SUPPLEMENTS,
  READABLE_TYPES,
  WRITABLE_TYPES,
  INFO_KEYS,
  LINBO_DIR,
  IMAGES_DIR,
  FILENAME_RE,
  MAX_BASE_LEN,
  parseMainFilename,
  resolveImageDir,
  resolveImagePath,
  resolveSidecarPath,
  parseSidecarFilename,
  resolveSupplementPath,
  toRelativePath,
  resolveFromDbPath,
};
