/**
 * LINBO Plugin - LINBO Update Service
 * APT-based version check and update for linuxmuster-linbo7 package
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const { getClient } = require('../lib/redis');
const ws = require('../lib/websocket');
const linbofsService = require('./linbofs.service');
const grubGenerator = require('./grub-generator');
const redisLib = require('../lib/redis');

// =============================================================================
// Constants
// =============================================================================

const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';
const KERNEL_DIR = process.env.KERNEL_VAR_DIR
  ? path.dirname(process.env.KERNEL_VAR_DIR)
  : '/var/lib/linuxmuster/linbo';

const DEB_BASE = process.env.DEB_BASE_URL || 'https://deb.linuxmuster.net';
const DEB_DIST = process.env.DEB_DIST || 'lmn73';
const PACKAGE_NAME = process.env.LINBO_PKG || 'linuxmuster-linbo7';

const LOCK_KEY = 'linbo:update:lock';
const STATUS_KEY = 'linbo:update:status';
const LOCK_TTL = 120;
const HEARTBEAT_INTERVAL = 30000;

// =============================================================================
// Module State
// =============================================================================

let lockRunId = null;
let heartbeatTimer = null;
let abortController = null;
let cancelRequested = false;

// =============================================================================
// Lock Management
// =============================================================================

async function acquireLock() {
  const redis = getClient();
  lockRunId = crypto.randomUUID();
  const acquired = await redis.set(LOCK_KEY, lockRunId, 'NX', 'EX', LOCK_TTL);
  if (!acquired) {
    lockRunId = null;
    const err = new Error('LINBO update already in progress');
    err.statusCode = 409;
    throw err;
  }

  heartbeatTimer = setInterval(async () => {
    try {
      const current = await redis.get(LOCK_KEY);
      if (current === lockRunId) {
        await redis.expire(LOCK_KEY, LOCK_TTL);
      }
    } catch (err) { console.debug('[LinboUpdate] heartbeat expire failed:', err.message); }
  }, HEARTBEAT_INTERVAL);
}

async function releaseLock() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (!lockRunId) return;
  try {
    const redis = getClient();
    const current = await redis.get(LOCK_KEY);
    if (current === lockRunId) await redis.del(LOCK_KEY);
  } catch (err) { console.debug('[LinboUpdate] lock release failed:', err.message); }
  lockRunId = null;
}

// =============================================================================
// Status Management (Redis Hash)
// =============================================================================

let lastBroadcast = 0;
const BROADCAST_THROTTLE = 2000;

async function setStatus(status, extra = {}) {
  const redis = getClient();
  const data = {
    status,
    progress: extra.progress != null ? String(extra.progress) : '0',
    message: extra.message || '',
    version: extra.version || '',
    startedAt: extra.startedAt || '',
    updatedAt: new Date().toISOString(),
    runId: lockRunId || '',
    error: extra.error || '',
  };
  await redis.hmset(STATUS_KEY, data);
  await redis.expire(STATUS_KEY, 3600);

  const now = Date.now();
  if (now - lastBroadcast >= BROADCAST_THROTTLE || status === 'done' || status === 'error' || status === 'cancelled') {
    lastBroadcast = now;
    ws.broadcast('linbo.update.status', {
      status: data.status,
      progress: parseInt(data.progress, 10),
      message: data.message,
      version: data.version,
    });
  }
}

async function getStatus() {
  const redis = getClient();
  const data = await redis.hgetall(STATUS_KEY);
  if (!data || !data.status) {
    return { status: 'idle', progress: 0, message: '', version: '' };
  }
  return {
    status: data.status,
    progress: parseInt(data.progress, 10) || 0,
    message: data.message || '',
    version: data.version || '',
    startedAt: data.startedAt || undefined,
    updatedAt: data.updatedAt || undefined,
    runId: data.runId || undefined,
    error: data.error || undefined,
  };
}

// =============================================================================
// Cancel Support
// =============================================================================

function checkCancel() {
  if (cancelRequested) {
    throw new Error('Update cancelled');
  }
}

function cancelUpdate() {
  cancelRequested = true;
  if (abortController) {
    abortController.abort();
  }
}

// =============================================================================
// APT Packages Parsing
// =============================================================================

function parseDebianStanza(stanza) {
  const fields = {};
  let currentKey = null;
  for (const line of stanza.split('\n')) {
    if (/^\s/.test(line) && currentKey) {
      fields[currentKey] += '\n' + line;
    } else {
      const match = line.match(/^([A-Za-z][A-Za-z0-9-]*):\s*(.*)/);
      if (match) {
        currentKey = match[1];
        fields[currentKey] = match[2];
      }
    }
  }
  return fields;
}

async function isNewer(available, installed) {
  try {
    await execFileAsync('dpkg', ['--compare-versions', available, 'gt', installed]);
    return true;
  } catch {
    return false;
  }
}

function parseInstalledVersion(content) {
  // Format: "LINBO 4.3.29-0: Psycho Killer" → "4.3.29-0"
  const match = content.match(/LINBO\s+(\S+)/i);
  return match ? match[1].replace(/:$/, '') : null;
}

async function fetchPackages() {
  const url = `${DEB_BASE}/dists/${DEB_DIST}/main/binary-amd64/Packages`;
  let body;

  // Try gzipped first
  try {
    const gz = await fetch(`${url}.gz`);
    if (gz.ok) {
      body = zlib.gunzipSync(Buffer.from(await gz.arrayBuffer())).toString();
    }
  } catch (err) { console.debug('[LinboUpdate] gzip decompression failed, using plain body:', err.message); }

  // Fallback to plain
  if (!body) {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Failed to fetch APT Packages: HTTP ${resp.status}`);
    }
    body = await resp.text();
  }

  return body;
}

async function findBestCandidate(body) {
  const stanzas = body.split(/\n\n+/);
  const candidates = [];

  for (const stanza of stanzas) {
    if (!stanza.trim()) continue;
    const fields = parseDebianStanza(stanza);
    if (fields.Package !== PACKAGE_NAME) continue;
    if (fields.Architecture && !['amd64', 'all'].includes(fields.Architecture)) continue;
    candidates.push(fields);
  }

  if (candidates.length === 0) return null;

  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (await isNewer(candidates[i].Version, best.Version)) {
      best = candidates[i];
    }
  }
  return best;
}

async function checkVersion() {
  // Read installed version
  let installed = null;
  let installedFull = null;
  try {
    const content = await fs.readFile(path.join(LINBO_DIR, 'linbo-version.txt'), 'utf8');
    installedFull = content.trim();
    installed = parseInstalledVersion(installedFull);
  } catch (err) { console.debug('[LinboUpdate] read installed version failed:', err.message); }

  // Fetch available version from APT
  let available = null;
  let packageSize = null;
  let sha256 = null;
  let filename = null;

  try {
    const body = await fetchPackages();
    const best = await findBestCandidate(body);
    if (best) {
      available = best.Version;
      packageSize = best.Size ? parseInt(best.Size, 10) : null;
      sha256 = best.SHA256 || null;
      filename = best.Filename || null;
    }
  } catch (err) {
    console.error('[LinboUpdate] Failed to check APT repo:', err.message);
  }

  let updateAvailable = false;
  if (available && installed) {
    updateAvailable = await isNewer(available, installed);
  } else if (available && !installed) {
    updateAvailable = true;
  }

  return {
    installed: installed || 'unknown',
    installedFull: installedFull || 'unknown',
    available,
    updateAvailable,
    packageSize,
    sha256,
    filename,
  };
}

// =============================================================================
// Update Phases
// =============================================================================

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fsSync.createReadStream(filePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

let workDir = null;

async function preflightCheck(expectedSize) {
  for (const dir of [os.tmpdir(), LINBO_DIR]) {
    try {
      const { stdout } = await execFileAsync('df', ['-B1', '--output=avail', dir]);
      const avail = parseInt(stdout.trim().split('\n').pop(), 10);
      const required = expectedSize * 3;
      if (avail < required) {
        throw new Error(
          `Insufficient disk space in ${dir}: ${Math.round(avail / 1024 / 1024)}MB available, ~${Math.round(required / 1024 / 1024)}MB required`
        );
      }
    } catch (err) {
      if (err.message.includes('Insufficient disk space')) throw err;
      // df might not be available, skip check
    }
  }
}

async function downloadAndVerify(debUrl, expectedSha256, expectedSize) {
  abortController = new AbortController();

  const hash = crypto.createHash('sha256');
  let downloadedBytes = 0;
  const debPath = path.join(workDir, 'linbo7.deb');
  const fileStream = fsSync.createWriteStream(debPath);

  await setStatus('downloading', {
    progress: 0,
    message: `Downloading ${path.basename(debUrl)}...`,
  });

  const response = await fetch(debUrl, { signal: abortController.signal });
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }

  const webStream = Readable.fromWeb(response.body);

  const hashTransform = new Transform({
    transform(chunk, encoding, callback) {
      hash.update(chunk);
      downloadedBytes += chunk.length;
      const progress = expectedSize
        ? Math.round((downloadedBytes / expectedSize) * 60)
        : 30;
      setStatus('downloading', {
        progress: Math.min(progress, 60),
        message: `Downloading... ${Math.round(downloadedBytes / 1024 / 1024)}MB`,
      }).catch(() => {}); // WS broadcast: no clients is normal
      callback(null, chunk);
    },
  });

  await pipeline(webStream, hashTransform, fileStream);
  abortController = null;

  // Phase 1b: Verify
  await setStatus('verifying', { progress: 62, message: 'Verifying SHA256 checksum...' });

  const actualHash = hash.digest('hex');
  if (expectedSha256 && actualHash !== expectedSha256) {
    await fs.unlink(debPath).catch(err => console.debug('[LinboUpdate] cleanup: unlink deb failed:', err.message));
    throw new Error(`SHA256 mismatch: expected ${expectedSha256}, got ${actualHash}`);
  }
  if (expectedSize && downloadedBytes !== expectedSize) {
    await fs.unlink(debPath).catch(err => console.debug('[LinboUpdate] cleanup: unlink deb failed:', err.message));
    throw new Error(`Size mismatch: expected ${expectedSize}, got ${downloadedBytes}`);
  }

  return debPath;
}

async function extractDeb(debPath) {
  await setStatus('extracting', { progress: 65, message: 'Extracting package...' });

  const extractDir = path.join(workDir, 'extracted');
  await fs.mkdir(extractDir, { recursive: true });
  await execFileAsync('dpkg-deb', ['-x', debPath, extractDir]);
  return extractDir;
}

/**
 * Safely merge GRUB files from package into existing grub dir.
 * Protects x86_64-efi/ and i386-pc/ directories (GRUB module dirs)
 * by only adding new files, never removing existing ones.
 */
async function mergeGrubFiles(srcDir, dstDir) {
  const PROTECTED_DIRS = new Set(['x86_64-efi', 'i386-pc']);

  async function mergeDir(src, dst, isProtected = false) {
    await fs.mkdir(dst, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);

      if (entry.isDirectory()) {
        // Mark as protected if this is a top-level protected dir
        const childProtected = isProtected || PROTECTED_DIRS.has(entry.name);
        await mergeDir(srcPath, dstPath, childProtected);
      } else if (isProtected) {
        // Inside a protected dir: only add files that don't exist yet
        if (!(await exists(dstPath))) {
          await fs.copyFile(srcPath, dstPath);
        }
      } else {
        // Normal file: overwrite (package files like shldr take priority)
        await fs.copyFile(srcPath, dstPath);
      }
    }
  }

  await mergeDir(srcDir, dstDir);
}

async function provisionBootFiles(extractDir, version) {
  await setStatus('provisioning', { progress: 70, message: 'Provisioning boot files...' });

  const staging = path.join(LINBO_DIR, '.update-staging');
  await fs.mkdir(staging, { recursive: true });

  // 1. GUI files to staging
  for (const file of ['linbo_gui64_7.tar.lz', 'linbo_gui64_7.tar.lz.md5']) {
    const src = path.join(extractDir, 'srv', 'linbo', file);
    if (await exists(src)) {
      await fs.copyFile(src, path.join(staging, file));
    }
  }

  // 2. GRUB: merge files from package into existing grub dir
  //    IMPORTANT: Only overwrite files that come from the package.
  //    GRUB modules (x86_64-efi/*.mod) and EFI binaries come from a
  //    separate grub package and must NOT be deleted.
  const grubSrc = path.join(extractDir, 'srv', 'linbo', 'boot', 'grub');
  if (await exists(grubSrc)) {
    const grubDir = path.join(LINBO_DIR, 'boot', 'grub');
    await fs.mkdir(grubDir, { recursive: true });
    await mergeGrubFiles(grubSrc, grubDir);
  }

  await setStatus('provisioning', { progress: 75, message: 'Moving GUI files...' });

  // 3. Staging → final (atomic rename, same FS)
  for (const file of ['linbo_gui64_7.tar.lz', 'linbo_gui64_7.tar.lz.md5']) {
    const src = path.join(staging, file);
    if (await exists(src)) {
      await fs.rename(src, path.join(LINBO_DIR, file));
    }
  }

  // 4. Icons
  const iconsSrc = path.join(extractDir, 'srv', 'linbo', 'icons');
  if (await exists(iconsSrc)) {
    await fs.cp(iconsSrc, path.join(LINBO_DIR, 'icons'), { recursive: true });
  }

  // 5. GUI symlinks: new LINBO versions look for gui/linbo_gui64_7.tar.lz
  //    and gui/icons/ in addition to the root paths. Create symlinks so
  //    both old and new LINBO client paths work.
  const guiDir = path.join(LINBO_DIR, 'gui');
  await fs.mkdir(guiDir, { recursive: true });
  for (const file of ['linbo_gui64_7.tar.lz', 'linbo_gui64_7.tar.lz.md5']) {
    const target = path.join(LINBO_DIR, file);
    const link = path.join(guiDir, file);
    if (await exists(target)) {
      try { await fs.unlink(link); } catch (err) { console.debug('[LinboUpdate] cleanup: unlink symlink failed:', err.message); }
      await fs.symlink(target, link);
    }
  }
  // Icons symlink (gui/icons/ → icons/)
  const iconsDir = path.join(LINBO_DIR, 'icons');
  const iconsLink = path.join(guiDir, 'icons');
  if (await exists(iconsDir)) {
    try { await fs.unlink(iconsLink); } catch (err) { console.debug('[LinboUpdate] cleanup: unlink icons symlink failed:', err.message); }
    await fs.symlink(iconsDir, iconsLink);
  }

  // Cleanup staging
  await fs.rm(staging, { recursive: true, force: true });

  await setStatus('provisioning', { progress: 78, message: 'Provisioning kernel variants...' });

  // 5. Kernel variants into set system
  await provisionKernels(extractDir, version);
}

async function provisionKernels(extractDir, version) {
  const kernelsSrc = path.join(extractDir, 'var', 'lib', 'linuxmuster', 'linbo');
  const kernelsDst = path.join(LINBO_DIR, 'kernels');
  await fs.mkdir(kernelsDst, { recursive: true });

  // Copy kernel variants
  for (const variant of ['stable', 'longterm', 'legacy']) {
    const src = path.join(kernelsSrc, variant);
    if (await exists(src)) {
      await fs.cp(src, path.join(kernelsDst, variant), { recursive: true });
    }
  }

  // Store linbofs64.xz template for update-linbofs.sh to use as base for rebuilds
  const linbofsSrc = path.join(kernelsSrc, 'linbofs64.xz');
  if (await exists(linbofsSrc)) {
    await fs.copyFile(linbofsSrc, path.join(kernelsDst, 'linbofs64.xz'));
  }

  // Build manifest
  const manifest = await buildManifest(kernelsDst, version);
  const manifestPath = path.join(kernelsDst, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  // Provision into sets with atomic symlink swap
  await provisionKernelSets(kernelsDst, manifestPath);
}

async function buildManifest(kernelsDst, version) {
  const manifest = {
    version,
    buildDate: new Date().toISOString(),
    variants: {},
    template: {},
  };

  for (const variant of ['stable', 'longterm', 'legacy']) {
    const varDir = path.join(kernelsDst, variant);
    if (!(await exists(varDir))) continue;

    manifest.variants[variant] = {};
    for (const file of ['linbo64', 'modules.tar.xz', 'version']) {
      const fp = path.join(varDir, file);
      if (await exists(fp)) {
        const hash = await sha256File(fp);
        const stat = await fs.stat(fp);
        manifest.variants[variant][file] = { sha256: hash, size: stat.size };
      }
    }
  }

  const templatePath = path.join(kernelsDst, 'linbofs64.xz');
  if (await exists(templatePath)) {
    manifest.template.sha256 = await sha256File(templatePath);
    manifest.template.size = (await fs.stat(templatePath)).size;
  }

  return manifest;
}

async function provisionKernelSets(kernelsDst, manifestPath) {
  const manifestHash = (await sha256File(manifestPath)).slice(0, 8);
  const setsDir = path.join(KERNEL_DIR, 'sets');
  const tempSetDir = path.join(setsDir, `.tmp-${manifestHash}`);
  const newSetDir = path.join(setsDir, manifestHash);

  await fs.mkdir(tempSetDir, { recursive: true });

  // Copy variants + template + manifest
  for (const variant of ['stable', 'longterm', 'legacy']) {
    const src = path.join(kernelsDst, variant);
    if (await exists(src)) {
      await fs.cp(src, path.join(tempSetDir, variant), { recursive: true });
    }
  }

  // Copy linbofs64.xz template into the set
  const templatePath = path.join(kernelsDst, 'linbofs64.xz');
  if (await exists(templatePath)) {
    await fs.copyFile(templatePath, path.join(tempSetDir, 'linbofs64.xz'));
  }
  await fs.copyFile(manifestPath, path.join(tempSetDir, 'manifest.json'));

  // Atomic rename: temp → final
  // Remove target if it already exists (from a previous run)
  if (await exists(newSetDir)) {
    await fs.rm(newSetDir, { recursive: true });
  }
  await fs.rename(tempSetDir, newSetDir);

  // Symlink swap: remove old, create new
  const currentLink = path.join(KERNEL_DIR, 'current');

  // Remove existing current (symlink or directory)
  try {
    const stat = await fs.lstat(currentLink);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      await fs.rm(currentLink, { recursive: true });
    } else {
      await fs.unlink(currentLink);
    }
  } catch (err) { console.debug('[LinboUpdate] cleanup: unlink current link failed:', err.message); }
  await fs.symlink(`sets/${manifestHash}`, currentLink);

  // Cleanup old sets
  try {
    const entries = await fs.readdir(setsDir);
    for (const entry of entries) {
      if (entry !== manifestHash && !entry.startsWith('.tmp-')) {
        await fs.rm(path.join(setsDir, entry), { recursive: true, force: true });
      }
    }
  } catch (err) { console.debug('[LinboUpdate] cleanup: readdir old set failed:', err.message); }
}

async function rebuildLinbofs(version) {
  await setStatus('rebuilding', { progress: 85, message: 'Rebuilding linbofs64...', version });

  const result = await linbofsService.updateLinbofs();
  if (!result.success) {
    console.error('[LinboUpdate] linbofs rebuild output:', result.output);
    console.error('[LinboUpdate] linbofs rebuild errors:', result.errors);
    throw new Error(`linbofs rebuild failed: ${result.errors}`);
  }
}

async function regenerateGrubConfigs(version) {
  await setStatus('rebuilding', { progress: 90, message: 'Regenerating GRUB configs...', version });
  try {
    // Load hosts and configs from Redis sync cache
    const client = redisLib.getClient();
    const macs = await client.smembers('sync:host:index');
    const hosts = [];
    for (const mac of macs) {
      const json = await client.get(`sync:host:${mac}`);
      if (json) {
        const h = JSON.parse(json);
        hosts.push({ mac: h.mac, hostname: h.hostname, ip: h.ip, hostgroup: h.hostgroup || h.config });
      }
    }
    const configIds = await client.smembers('sync:config:index');
    const configs = [];
    for (const id of configIds) {
      const json = await client.get(`sync:config:${id}`);
      if (json) {
        const c = JSON.parse(json);
        if (c.content !== null) configs.push({ id, osEntries: c.osEntries || [], partitions: c.partitions || [], grubPolicy: c.grubPolicy || {} });
      }
    }
    const result = await grubGenerator.regenerateAll(hosts, configs);
    console.log(`[LinboUpdate] GRUB configs regenerated: ${result.configs} configs, ${result.hosts} hosts`);
  } catch (err) {
    // Non-fatal: log but don't fail the update
    console.error('[LinboUpdate] GRUB config regeneration failed (non-fatal):', err.message);
  }
}

async function finalize(extractDir, version) {
  await setStatus('done', { progress: 95, message: 'Finalizing...', version });

  // Version file is the LAST step — UI shows "old" until everything is done
  const versionSrc = path.join(extractDir, 'srv', 'linbo', 'linbo-version.txt');
  if (await exists(versionSrc)) {
    await fs.copyFile(versionSrc, path.join(LINBO_DIR, 'linbo-version.txt'));
  }

  // Update .boot-files-installed marker
  await fs.writeFile(path.join(LINBO_DIR, '.boot-files-installed'), version);

  // Cleanup workDir
  if (workDir && (await exists(workDir))) {
    await fs.rm(workDir, { recursive: true, force: true });
  }

  await setStatus('done', { progress: 100, message: `Updated to ${version}`, version });

  // Broadcast completion events
  ws.broadcast('linbo.update.status', { status: 'done', progress: 100, version });
  ws.broadcast('system.kernel_variants_changed', {});
}

// =============================================================================
// Cleanup
// =============================================================================

async function cleanup() {
  if (workDir && (await exists(workDir))) {
    await fs.rm(workDir, { recursive: true, force: true });
  }

  const staging = path.join(LINBO_DIR, '.update-staging');
  if (await exists(staging)) {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

// =============================================================================
// Main Update Flow
// =============================================================================

async function startUpdate() {
  cancelRequested = false;
  const startedAt = new Date().toISOString();

  // Check for available update
  const versionInfo = await checkVersion();
  if (!versionInfo.updateAvailable) {
    const err = new Error('No update available');
    err.statusCode = 400;
    throw err;
  }

  await acquireLock();

  try {
    const version = versionInfo.available;
    const expectedSize = versionInfo.packageSize || 0;
    const expectedSha256 = versionInfo.sha256;
    const filename = versionInfo.filename;

    await setStatus('preflight', {
      progress: 0,
      message: 'Checking disk space...',
      version,
      startedAt,
    });

    // Phase 0: Preflight
    if (expectedSize > 0) {
      await preflightCheck(expectedSize);
    }

    // Create work directory
    workDir = path.join(os.tmpdir(), `linbo-update-${Date.now()}`);
    await fs.mkdir(workDir, { recursive: true });

    checkCancel();

    // Phase 1 + 1b: Download and verify
    const debUrl = `${DEB_BASE}/${filename}`;
    const debPath = await downloadAndVerify(debUrl, expectedSha256, expectedSize);

    checkCancel();

    // Phase 2: Extract
    const extractDir = await extractDeb(debPath);

    checkCancel();

    // Phase 3: Provision boot files + kernels
    await provisionBootFiles(extractDir, version);

    checkCancel();

    // Phase 4: Rebuild linbofs
    await rebuildLinbofs(version);

    // Phase 4b: Regenerate GRUB configs
    await regenerateGrubConfigs(version);

    // Phase 5: Finalize (version.txt LAST)
    await finalize(extractDir, version);
  } catch (err) {
    if (err.message === 'Update cancelled') {
      await setStatus('cancelled', { message: 'Update was cancelled' });
    } else {
      await setStatus('error', { error: err.message, message: `Error: ${err.message}` });
    }
    await cleanup();
    throw err;
  } finally {
    await releaseLock();
  }
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  checkVersion,
  startUpdate,
  getStatus,
  cancelUpdate,

  // Exported for testing
  _testing: {
    parseDebianStanza,
    parseInstalledVersion,
    findBestCandidate,
    isNewer,
    exists,
    sha256File,
    setStatus,
    acquireLock,
    releaseLock,
    cleanup,
    provisionKernelSets,
    buildManifest,
    mergeGrubFiles,
    provisionKernels,
  },
};
