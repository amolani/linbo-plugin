/**
 * LINBO Docker - Hook Service
 * Scans hook directories and reads build manifests for observability
 */

const fs = require('fs').promises;
const path = require('path');

const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';
const HOOKS_DIR = process.env.HOOKSDIR || '/etc/linuxmuster/linbo/hooks';

/**
 * Read the build manifest JSON written by update-linbofs.sh
 * @returns {Promise<object|null>} Parsed manifest or null if missing/invalid
 */
async function readManifest() {
  const manifestPath = path.join(LINBO_DIR, '.linbofs-build-manifest.json');
  try {
    const content = await fs.readFile(manifestPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Scan hook directories and return hook metadata merged with manifest data
 * @returns {Promise<{hooks: Array, lastBuild: string|null, hookWarnings: number}>}
 */
async function getHooks() {
  const hookDirs = [
    { dir: 'update-linbofs.pre.d', type: 'pre' },
    { dir: 'update-linbofs.post.d', type: 'post' },
  ];

  const hooks = [];

  for (const { dir, type } of hookDirs) {
    const dirPath = path.join(HOOKS_DIR, dir);
    let files;
    try {
      files = await fs.readdir(dirPath);
    } catch {
      // Directory doesn't exist, skip
      continue;
    }

    // Sort files by name for consistent ordering
    files.sort();

    for (const name of files) {
      // Skip dotfiles and non-hook entries
      if (name.startsWith('.')) continue;
      const fullPath = path.join(dirPath, name);
      try {
        const stat = await fs.stat(fullPath);
        // Only list regular files (not directories)
        if (!stat.isFile()) continue;
        hooks.push({
          name,
          type,
          path: fullPath,
          executable: !!(stat.mode & 0o111),
          size: stat.size,
        });
      } catch {
        // Skip files we can't stat
      }
    }
  }

  // Merge manifest data
  const manifest = await readManifest();

  if (manifest && Array.isArray(manifest.hooks)) {
    for (const hook of hooks) {
      const entry = manifest.hooks.find(
        (m) => m.name === hook.name && m.type === hook.type
      );
      if (entry) {
        hook.lastExitCode = entry.exitCode;
        hook.lastFilesDelta = entry.filesDelta;
      }
    }
  }

  return {
    hooks,
    lastBuild: manifest?.buildTimestamp || null,
    hookWarnings: manifest?.hookWarnings || 0,
  };
}

module.exports = {
  getHooks,
  readManifest,
};
