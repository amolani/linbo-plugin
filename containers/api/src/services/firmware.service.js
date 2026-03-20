/**
 * LINBO Docker - Firmware Service
 * Manages firmware config entries for linbofs64 injection
 */

const fs = require('fs').promises;
const path = require('path');
const firmwareScanner = require('../lib/firmware-scanner');
const firmwareCatalog = require('../lib/firmware-catalog');
const dmesgParser = require('../lib/dmesg-firmware-parser');
const kernelService = require('./kernel.service');
const ws = require('../lib/websocket');

// =============================================================================
// Constants
// =============================================================================

const CONFIG_DIR = process.env.CONFIG_DIR || process.env.LINBO_CONFIG_DIR || '/etc/linuxmuster/linbo';
const FIRMWARE_BASE = firmwareScanner.FIRMWARE_BASE;
const FIRMWARE_CONFIG_FILE = path.join(CONFIG_DIR, 'firmware');
const WPA_CONFIG_FILE = path.join(CONFIG_DIR, 'wpa_supplicant.conf');
const HEX_PSK_RE = /^[0-9a-fA-F]{64}$/;

// =============================================================================
// Entry Sanitization
// =============================================================================

/**
 * Sanitize and validate a firmware entry path
 * @param {string} entry - Raw entry from user/config
 * @returns {string} Sanitized relative path
 * @throws {Error} with statusCode 400 on invalid input
 */
function sanitizeEntry(entry) {
  let trimmed = entry.trim();
  if (!trimmed) {
    throw Object.assign(new Error('Entry must not be empty'), { statusCode: 400 });
  }

  // Strip /lib/firmware/ prefix (production compat)
  if (trimmed.startsWith('/lib/firmware/')) {
    trimmed = trimmed.slice('/lib/firmware/'.length);
  }

  // Segment-based traversal check: reject a/../b but allow foo..bar.bin
  if (/(^|\/)\.\.($|\/)/.test(trimmed)) {
    throw Object.assign(new Error('Path traversal not allowed'), { statusCode: 400 });
  }

  if (trimmed.startsWith('/')) {
    throw Object.assign(new Error('Absolute paths not allowed'), { statusCode: 400 });
  }
  if (trimmed.includes('\\')) {
    throw Object.assign(new Error('Backslashes not allowed'), { statusCode: 400 });
  }
  if (trimmed.includes('\0')) {
    throw Object.assign(new Error('NUL bytes not allowed'), { statusCode: 400 });
  }
  if (/[\r\n]/.test(trimmed)) {
    throw Object.assign(new Error('Newlines not allowed'), { statusCode: 400 });
  }

  // Normalize double slashes and trailing slash
  return trimmed.replace(/\/+/g, '/').replace(/\/$/, '');
}

// =============================================================================
// Config File I/O (tolerant read, atomic write)
// =============================================================================

/**
 * Read firmware config file, returning array of raw entries (trimmed, no comments)
 * @returns {Promise<string[]>}
 */
async function readFirmwareConfig() {
  try {
    const raw = await fs.readFile(FIRMWARE_CONFIG_FILE, 'utf-8');
    return raw
      .split('\n')
      .map(line => line.replace(/\r$/, '').trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Write firmware config file atomically
 * @param {string[]} entries - Array of firmware paths to write
 */
async function writeFirmwareConfig(entries) {
  const header = '# LINBO Docker - Firmware configuration\n'
    + '# Managed by linbo-docker API. One entry per line.\n'
    + '# Entries are relative paths under /lib/firmware/\n'
    + '# Lines starting with # are comments.\n';
  const content = header + '\n' + entries.join('\n') + '\n';
  const tmp = FIRMWARE_CONFIG_FILE + '.tmp.' + process.pid;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, FIRMWARE_CONFIG_FILE);
}

// =============================================================================
// Firmware Path Validation
// =============================================================================

/**
 * Validate a firmware path exists on disk and is safe (symlink check)
 * @param {string} entry - Sanitized relative path
 * @returns {Promise<object>} Validation result
 */
async function validatePath(entry) {
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

  // Symlink safety: realpath must stay within FIRMWARE_BASE
  try {
    const realPath = await fs.realpath(actualPath);
    if (realPath !== FIRMWARE_BASE && !realPath.startsWith(FIRMWARE_BASE + path.sep)) {
      throw Object.assign(
        new Error('Symlink points outside firmware base'),
        { statusCode: 400 }
      );
    }
  } catch (err) {
    if (err.statusCode) throw err;
    return { exists: false, isFile: false, isDirectory: false, size: 0, isZst: false };
  }

  try {
    const stat = await fs.stat(actualPath);
    if (stat.isDirectory()) {
      return { exists: true, isFile: false, isDirectory: true, size: 0, isZst: false };
    }
    return { exists: true, isFile: true, isDirectory: false, size: stat.size, isZst };
  } catch {
    return { exists: false, isFile: false, isDirectory: false, size: 0, isZst: false };
  }
}

// =============================================================================
// CRUD Operations
// =============================================================================

/**
 * Get all configured firmware entries with their validation status
 */
async function getFirmwareEntries() {
  const rawEntries = await readFirmwareConfig();
  const results = [];

  for (const raw of rawEntries) {
    let sanitized;
    try {
      sanitized = sanitizeEntry(raw);
    } catch {
      results.push({
        entry: raw,
        valid: false,
        exists: false,
        error: 'Invalid path',
      });
      continue;
    }

    try {
      const validation = await validatePath(sanitized);
      results.push({
        entry: sanitized,
        valid: true,
        exists: validation.exists,
        isFile: validation.isFile,
        isDirectory: validation.isDirectory,
        size: validation.size,
        isZst: validation.isZst,
      });
    } catch (err) {
      results.push({
        entry: sanitized,
        valid: false,
        exists: false,
        error: err.message,
      });
    }
  }

  return results;
}

/**
 * Add a firmware entry to the config
 * @param {string} entry - Path to add
 * @returns {Promise<object>} The added entry with validation
 */
async function addFirmwareEntry(entry) {
  const sanitized = sanitizeEntry(entry);

  // Check for duplicates
  const existing = await readFirmwareConfig();
  const normalizedExisting = existing.map(e => {
    try { return sanitizeEntry(e); } catch { return e; }
  });

  if (normalizedExisting.includes(sanitized)) {
    throw Object.assign(
      new Error(`Entry already exists: ${sanitized}`),
      { statusCode: 409 }
    );
  }

  // Validate path exists
  const validation = await validatePath(sanitized);
  if (!validation.exists) {
    throw Object.assign(
      new Error(`Firmware not found: ${sanitized}`),
      { statusCode: 404 }
    );
  }

  // Add to config
  const entries = [...existing.map(e => {
    try { return sanitizeEntry(e); } catch { return e; }
  }), sanitized];
  await writeFirmwareConfig(entries);
  firmwareCatalog.invalidateCatalogCache();

  return {
    entry: sanitized,
    valid: true,
    exists: true,
    isFile: validation.isFile,
    isDirectory: validation.isDirectory,
    size: validation.size,
    isZst: validation.isZst,
  };
}

/**
 * Remove a firmware entry from the config
 * @param {string} entry - Path to remove
 */
async function removeFirmwareEntry(entry) {
  const sanitized = sanitizeEntry(entry);

  const existing = await readFirmwareConfig();
  const normalizedExisting = existing.map(e => {
    try { return sanitizeEntry(e); } catch { return e; }
  });

  const idx = normalizedExisting.indexOf(sanitized);
  if (idx === -1) {
    throw Object.assign(
      new Error(`Entry not found: ${sanitized}`),
      { statusCode: 404 }
    );
  }

  normalizedExisting.splice(idx, 1);
  await writeFirmwareConfig(normalizedExisting);
  firmwareCatalog.invalidateCatalogCache();

  return { removed: sanitized };
}

// =============================================================================
// Search Available Firmware
// =============================================================================

/**
 * Search available firmware files on the host
 * @param {string} query - Search query
 * @param {number} limit - Max results
 */
async function searchAvailableFirmware(query, limit = 50) {
  return firmwareScanner.searchFirmware(query, limit);
}

// =============================================================================
// Status
// =============================================================================

/**
 * Compute stats from firmware entries
 */
function computeStats(entries) {
  const total = entries.length;
  const valid = entries.filter(e => e.valid).length;
  const existing = entries.filter(e => e.exists).length;
  const missing = entries.filter(e => e.valid && !e.exists).length;
  const files = entries.filter(e => e.isFile).length;
  const directories = entries.filter(e => e.isDirectory).length;
  return { total, valid, existing, missing, files, directories };
}

/**
 * Get combined firmware status
 */
async function getFirmwareStatus() {
  const [entries, kernelStatus] = await Promise.all([
    getFirmwareEntries(),
    kernelService.getKernelStatus(),
  ]);

  return {
    entries,
    stats: computeStats(entries),
    rebuildRunning: kernelStatus.rebuildRunning,
    lastSwitchAt: kernelStatus.lastSwitchAt,
  };
}

// =============================================================================
// Bulk Add
// =============================================================================

/**
 * Add multiple firmware entries in one atomic write.
 * Returns { added, duplicates, invalid } — partial success is OK.
 * @param {string[]} entries - Array of firmware paths to add
 */
async function addBulkFirmwareEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw Object.assign(new Error('entries must be a non-empty array'), { statusCode: 400 });
  }

  const existing = await readFirmwareConfig();
  const normalizedExisting = new Set(existing.map(e => {
    try { return sanitizeEntry(e); } catch { return e; }
  }));

  const added = [];
  const duplicates = [];
  const invalid = [];

  for (const raw of entries) {
    let sanitized;
    try {
      sanitized = sanitizeEntry(raw);
    } catch {
      invalid.push(raw);
      continue;
    }

    if (normalizedExisting.has(sanitized)) {
      duplicates.push(sanitized);
      continue;
    }

    // Validate path exists
    const validation = await validatePath(sanitized);
    if (!validation.exists) {
      invalid.push(sanitized);
      continue;
    }

    normalizedExisting.add(sanitized);
    added.push(sanitized);
  }

  if (added.length > 0) {
    await writeFirmwareConfig([...normalizedExisting]);
    firmwareCatalog.invalidateCatalogCache();
  }

  return { added, duplicates, invalid };
}

// =============================================================================
// Firmware Catalog
// =============================================================================

/**
 * Get the firmware catalog with availability and config status
 * @param {boolean} expand - Include expandedFiles for prefix entries
 */
async function getFirmwareCatalog(expand = false) {
  const rawEntries = await readFirmwareConfig();
  const configEntries = rawEntries.map(e => {
    try { return sanitizeEntry(e); } catch { return e; }
  });
  return firmwareCatalog.getCatalogWithAvailability(configEntries, expand);
}

// =============================================================================
// wpa_supplicant Configuration
// =============================================================================

/**
 * Validate SSID for wpa_supplicant.conf
 */
function validateSsid(ssid) {
  if (!ssid || !ssid.trim()) {
    throw Object.assign(new Error('SSID ist erforderlich'), { statusCode: 400 });
  }
  if (/[\x00\r\n]/.test(ssid)) {
    throw Object.assign(new Error('SSID darf keine Steuerzeichen enthalten'), { statusCode: 400 });
  }
  if (ssid.length > 32) {
    throw Object.assign(new Error('SSID darf max. 32 Zeichen lang sein'), { statusCode: 400 });
  }
}

/**
 * Escape a string for use in wpa_supplicant.conf quoted values
 */
function escapeWpaString(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Parse wpa_supplicant.conf content
 * Reads both quoted string PSK and 64-hex hashed PSK
 */
function parseWpaConfig(raw) {
  const ssidMatch = raw.match(/ssid="((?:[^"\\]|\\.)*)"/);
  const keyMgmtMatch = raw.match(/key_mgmt=(\S+)/);
  const pskHexMatch = raw.match(/psk=([0-9a-fA-F]{64})(?:\s|$)/);
  const pskQuotedMatch = raw.match(/psk="((?:[^"\\]|\\.)*)"/);
  const scanSsidMatch = raw.match(/scan_ssid=(\d)/);

  const ssid = ssidMatch
    ? ssidMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    : '';

  return {
    ssid,
    keyMgmt: keyMgmtMatch ? keyMgmtMatch[1] : 'WPA-PSK',
    psk: pskQuotedMatch ? pskQuotedMatch[1] : (pskHexMatch ? pskHexMatch[1] : ''),
    scanSsid: scanSsidMatch ? scanSsidMatch[1] === '1' : false,
  };
}

/**
 * Generate wpa_supplicant.conf content with proper escaping
 */
function generateWpaConfig(ssid, keyMgmt, psk, scanSsid) {
  const lines = [
    'ctrl_interface=/var/run/wpa_supplicant',
    '',
    'network={',
    `    ssid="${escapeWpaString(ssid)}"`,
  ];
  if (scanSsid) {
    lines.push('    scan_ssid=1');
  }
  lines.push(`    key_mgmt=${keyMgmt}`);
  if (keyMgmt === 'WPA-PSK' && psk) {
    if (HEX_PSK_RE.test(psk)) {
      lines.push(`    psk=${psk}`);
    } else {
      lines.push(`    psk="${escapeWpaString(psk)}"`);
    }
  }
  lines.push('}', '');
  return lines.join('\n');
}

/**
 * Read raw wpa_supplicant.conf (internal — includes PSK for preserve logic)
 */
async function readWpaConfigRaw() {
  try {
    const raw = await fs.readFile(WPA_CONFIG_FILE, 'utf-8');
    return parseWpaConfig(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Get WLAN config (public — never returns PSK value)
 */
async function getWlanConfig() {
  try {
    const raw = await fs.readFile(WPA_CONFIG_FILE, 'utf-8');
    const parsed = parseWpaConfig(raw);
    return {
      enabled: true,
      ssid: parsed.ssid,
      keyMgmt: parsed.keyMgmt,
      hasPsk: !!parsed.psk,
      scanSsid: parsed.scanSsid,
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { enabled: false, ssid: '', keyMgmt: 'WPA-PSK', hasPsk: false, scanSsid: false };
    }
    throw err;
  }
}

/**
 * Set WLAN config (creates/updates wpa_supplicant.conf)
 * PSK is optional on update — omitting preserves existing PSK
 */
async function setWlanConfig({ ssid, keyMgmt, psk, scanSsid }) {
  validateSsid(ssid);

  if (keyMgmt === 'WPA-PSK') {
    if (psk !== undefined && psk !== '') {
      if (!HEX_PSK_RE.test(psk) && psk.length < 8) {
        throw Object.assign(
          new Error('PSK muss mindestens 8 Zeichen lang sein'),
          { statusCode: 400 }
        );
      }
    } else {
      // No PSK provided — preserve existing
      const existing = await readWpaConfigRaw();
      if (!existing || !existing.psk) {
        throw Object.assign(
          new Error('Kein bestehender PSK vorhanden'),
          { statusCode: 400 }
        );
      }
      psk = existing.psk;
    }
  }

  const content = generateWpaConfig(ssid, keyMgmt, psk, !!scanSsid);
  const tmp = WPA_CONFIG_FILE + '.tmp.' + process.pid;
  await fs.writeFile(tmp, content, { mode: 0o600 });
  await fs.rename(tmp, WPA_CONFIG_FILE);

  // WS event without PSK
  ws.broadcast('system.wlan_changed', { ssid, keyMgmt, enabled: true });
}

/**
 * Disable WLAN (delete wpa_supplicant.conf)
 */
async function disableWlan() {
  await fs.unlink(WPA_CONFIG_FILE).catch(err => {
    if (err.code !== 'ENOENT') throw err;
  });
  ws.broadcast('system.wlan_changed', { enabled: false });
}

// =============================================================================
// Auto-Detection from Client
// =============================================================================

/**
 * Detect missing firmware on a LINBO client via SSH + dmesg.
 * Groups results by driver/catalog entry with availability and config status.
 * @param {string} hostIp - IP address of the LINBO client
 * @returns {Promise<object>} Detection result with drivers, files, and summary
 */
async function detectFirmwareFromHost(hostIp) {
  // Lazy-load SSH service to avoid circular deps
  const sshService = require('./ssh.service');

  // 1. SSH into client, run dmesg | grep -i firmware
  let sshResult;
  try {
    sshResult = await sshService.executeWithTimeout(
      hostIp,
      'dmesg | grep -i firmware',
      15000
    );
  } catch (err) {
    if (err.message === 'Command timeout') {
      throw Object.assign(new Error('SSH timeout connecting to client'), { statusCode: 504 });
    }
    throw Object.assign(
      new Error(`SSH connection failed: ${err.message}`),
      { statusCode: 502 }
    );
  }

  // 2. Parse dmesg output
  const events = dmesgParser.parseDmesgFirmware(sshResult.stdout || '');
  const missingFiles = events
    .filter(e => e.status === 'missing')
    .map(e => e.filename);

  if (missingFiles.length === 0) {
    return {
      host: hostIp,
      detectedDrivers: [],
      summary: { totalMissingFiles: 0, availableToAdd: 0, alreadyConfigured: 0 },
    };
  }

  // 3. Load current config for comparison
  const currentConfig = await readFirmwareConfig();
  const configSet = new Set(currentConfig.map(e => {
    try { return sanitizeEntry(e); } catch { return e; }
  }));

  // 4. Match each missing file against catalog and check disk availability
  const catalog = firmwareCatalog.FIRMWARE_CATALOG;
  const driverMap = new Map(); // key → { driver, category, vendor, files[] }

  for (const filename of missingFiles) {
    const catalogMatch = matchFileToCatalog(filename, catalog);
    const available = await firmwareCatalog.checkAvailability(filename);
    const suggestedEntry = determineSuggestedEntry(filename, catalogMatch);
    const alreadyConfigured = configSet.has(suggestedEntry) || configSet.has(filename);

    // Group by driver key
    const driverKey = catalogMatch
      ? catalogMatch.vendor.id
      : (extractDriverDir(filename) || filename);

    if (!driverMap.has(driverKey)) {
      driverMap.set(driverKey, {
        driver: catalogMatch ? catalogMatch.entry.path : (extractDriverDir(filename) || filename),
        category: catalogMatch ? catalogMatch.vendor.category : null,
        catalogVendor: catalogMatch ? catalogMatch.vendor.name : null,
        firmwareFiles: [],
      });
    }

    driverMap.get(driverKey).firmwareFiles.push({
      filename,
      availableOnDisk: available,
      alreadyConfigured,
      suggestedEntry,
    });
  }

  // 5. Build response
  const detectedDrivers = [...driverMap.values()];

  let totalMissingFiles = 0;
  let availableToAdd = 0;
  let alreadyConfigured = 0;

  for (const driver of detectedDrivers) {
    for (const file of driver.firmwareFiles) {
      totalMissingFiles++;
      if (file.alreadyConfigured) {
        alreadyConfigured++;
      } else if (file.availableOnDisk) {
        availableToAdd++;
      }
    }
  }

  return {
    host: hostIp,
    detectedDrivers,
    summary: { totalMissingFiles, availableToAdd, alreadyConfigured },
  };
}

/**
 * Match a firmware filename against the catalog.
 * @param {string} filename - e.g. "iwlwifi-ma-b0-gf-a0-86.ucode" or "i915/mtl_dmc.bin"
 * @param {Array} catalog - FIRMWARE_CATALOG array
 * @returns {object|null} { vendor, entry } or null
 */
function matchFileToCatalog(filename, catalog) {
  for (const vendor of catalog) {
    for (const entry of vendor.entries) {
      if (entry.type === 'dir') {
        // Dir match: filename starts with "dirname/"
        if (filename.startsWith(entry.path + '/') || filename === entry.path) {
          return { vendor, entry };
        }
      } else if (entry.type === 'prefix') {
        // Prefix match: test against regex
        const baseName = filename.includes('/') ? filename : filename;
        if (entry.pattern.test(baseName)) {
          return { vendor, entry };
        }
      }
    }
  }
  return null;
}

/**
 * Determine the suggested config entry for a missing firmware file.
 * - Dir-match: suggest the directory name (covers all files in that dir)
 * - Prefix-match: suggest the individual file
 * - No match: suggest the individual file
 * @param {string} filename
 * @param {object|null} catalogMatch
 * @returns {string}
 */
function determineSuggestedEntry(filename, catalogMatch) {
  if (!catalogMatch) return filename;

  if (catalogMatch.entry.type === 'dir') {
    // Suggest the whole directory
    return catalogMatch.entry.path;
  }
  // Prefix: suggest individual file
  return filename;
}

/**
 * Extract the directory part of a firmware path, if any.
 * e.g. "i915/mtl_dmc.bin" → "i915", "iwlwifi-ma.ucode" → null
 * @param {string} filename
 * @returns {string|null}
 */
function extractDriverDir(filename) {
  const slashIdx = filename.indexOf('/');
  return slashIdx > 0 ? filename.substring(0, slashIdx) : null;
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  // Constants (for testing)
  FIRMWARE_CONFIG_FILE,
  FIRMWARE_BASE,
  WPA_CONFIG_FILE,
  HEX_PSK_RE,
  // Functions
  sanitizeEntry,
  readFirmwareConfig,
  writeFirmwareConfig,
  validatePath,
  getFirmwareEntries,
  addFirmwareEntry,
  removeFirmwareEntry,
  addBulkFirmwareEntries,
  searchAvailableFirmware,
  getFirmwareStatus,
  getFirmwareCatalog,
  computeStats,
  detectFirmwareFromHost,
  // wpa_supplicant
  validateSsid,
  escapeWpaString,
  parseWpaConfig,
  generateWpaConfig,
  getWlanConfig,
  setWlanConfig,
  disableWlan,
};
