/**
 * LINBO Docker - Firmware Service Tests
 * Tests for firmware config management, sanitization, validation, search, status
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');

// Create isolated test directories
const TEST_BASE = path.join(os.tmpdir(), `firmware-test-${Date.now()}`);
const TEST_CONFIG_DIR = path.join(TEST_BASE, 'config');
const TEST_FIRMWARE_BASE = path.join(TEST_BASE, 'lib_firmware');
const TEST_KERNEL_DIR = path.join(TEST_BASE, 'current');
const TEST_LINBO_DIR = path.join(TEST_BASE, 'linbo');

// Set environment BEFORE importing services
process.env.CONFIG_DIR = TEST_CONFIG_DIR;
process.env.LINBO_CONFIG_DIR = TEST_CONFIG_DIR;
process.env.FIRMWARE_BASE = TEST_FIRMWARE_BASE;
process.env.KERNEL_VAR_DIR = TEST_KERNEL_DIR;
process.env.LINBO_DIR = TEST_LINBO_DIR;
process.env.LINBO_DATA_DIR = TEST_LINBO_DIR;
process.env.UPDATE_LINBOFS_SCRIPT = path.join(TEST_BASE, 'mock-update-linbofs.sh');

// Mock child_process for kernel service rebuild
jest.mock('child_process', () => ({
  execFile: jest.fn((cmd, args, opts, callback) => {
    if (typeof opts === 'function') { callback = opts; }
    if (callback) setTimeout(() => callback(null, 'OK\n', ''), 10);
  }),
}));

const firmwareService = require('../../src/services/firmware.service');
const firmwareScanner = require('../../src/lib/firmware-scanner');

// =============================================================================
// Helpers
// =============================================================================

async function setupDirs() {
  await fs.mkdir(TEST_CONFIG_DIR, { recursive: true });
  await fs.mkdir(TEST_FIRMWARE_BASE, { recursive: true });
  await fs.mkdir(TEST_KERNEL_DIR, { recursive: true });
  await fs.mkdir(TEST_LINBO_DIR, { recursive: true });
}

async function cleanDirs() {
  await fs.rm(TEST_BASE, { recursive: true, force: true }).catch(() => {});
}

async function writeFirmwareConfig(content) {
  await fs.writeFile(path.join(TEST_CONFIG_DIR, 'firmware'), content);
}

async function removeFirmwareConfig() {
  await fs.unlink(path.join(TEST_CONFIG_DIR, 'firmware')).catch(() => {});
}

async function createFirmwareFile(relPath, content = 'firmware-binary') {
  const fullPath = path.join(TEST_FIRMWARE_BASE, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content);
}

async function createFirmwareDir(relPath) {
  await fs.mkdir(path.join(TEST_FIRMWARE_BASE, relPath), { recursive: true });
}

async function createSymlink(linkPath, target) {
  const fullPath = path.join(TEST_FIRMWARE_BASE, linkPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.symlink(target, fullPath);
}

// =============================================================================
// Tests
// =============================================================================

describe('Firmware Service', () => {
  beforeAll(async () => {
    await setupDirs();
  });

  afterAll(async () => {
    await cleanDirs();
  });

  beforeEach(async () => {
    // Clean firmware config
    await removeFirmwareConfig();
    // Clean wpa_supplicant.conf
    await fs.unlink(path.join(TEST_CONFIG_DIR, 'wpa_supplicant.conf')).catch(() => {});
    // Clean firmware base dir
    await fs.rm(TEST_FIRMWARE_BASE, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(TEST_FIRMWARE_BASE, { recursive: true });
    // Invalidate scanner cache
    firmwareScanner.invalidateCache();
  });

  // ===========================================================================
  // Config Parsing
  // ===========================================================================

  describe('readFirmwareConfig', () => {
    test('should return empty array for missing config file', async () => {
      const entries = await firmwareService.readFirmwareConfig();
      expect(entries).toEqual([]);
    });

    test('should return empty array for empty config file', async () => {
      await writeFirmwareConfig('');
      const entries = await firmwareService.readFirmwareConfig();
      expect(entries).toEqual([]);
    });

    test('should parse entries ignoring comments and blank lines', async () => {
      await writeFirmwareConfig('# comment\nrtl_nic\n\n# another comment\niwlwifi-cc-a0-77.ucode\n');
      const entries = await firmwareService.readFirmwareConfig();
      expect(entries).toEqual(['rtl_nic', 'iwlwifi-cc-a0-77.ucode']);
    });

    test('should handle CRLF line endings', async () => {
      await writeFirmwareConfig('rtl_nic\r\niwlwifi\r\n');
      const entries = await firmwareService.readFirmwareConfig();
      expect(entries).toEqual(['rtl_nic', 'iwlwifi']);
    });

    test('should trim whitespace', async () => {
      await writeFirmwareConfig('  rtl_nic  \n\tiwlwifi\t\n');
      const entries = await firmwareService.readFirmwareConfig();
      expect(entries).toEqual(['rtl_nic', 'iwlwifi']);
    });

    test('should handle only comments and blank lines', async () => {
      await writeFirmwareConfig('# only comments\n\n# here\n\n');
      const entries = await firmwareService.readFirmwareConfig();
      expect(entries).toEqual([]);
    });

    test('should write config atomically', async () => {
      await firmwareService.writeFirmwareConfig(['rtl_nic', 'iwlwifi']);
      const entries = await firmwareService.readFirmwareConfig();
      expect(entries).toEqual(['rtl_nic', 'iwlwifi']);
    });
  });

  // ===========================================================================
  // Entry Sanitization
  // ===========================================================================

  describe('sanitizeEntry', () => {
    test('should reject path traversal (../etc/shadow)', () => {
      expect(() => firmwareService.sanitizeEntry('../etc/shadow')).toThrow('Path traversal');
    });

    test('should allow foo..bar (not traversal)', () => {
      const result = firmwareService.sanitizeEntry('foo..bar.bin');
      expect(result).toBe('foo..bar.bin');
    });

    test('should reject a/../b traversal', () => {
      expect(() => firmwareService.sanitizeEntry('a/../b')).toThrow('Path traversal');
    });

    test('should reject standalone ..', () => {
      expect(() => firmwareService.sanitizeEntry('..')).toThrow('Path traversal');
    });

    test('should reject absolute paths', () => {
      expect(() => firmwareService.sanitizeEntry('/etc/passwd')).toThrow('Absolute paths');
    });

    test('should strip /lib/firmware/ prefix and accept', () => {
      const result = firmwareService.sanitizeEntry('/lib/firmware/rtl_nic');
      expect(result).toBe('rtl_nic');
    });

    test('should reject backslashes', () => {
      expect(() => firmwareService.sanitizeEntry('foo\\bar')).toThrow('Backslashes');
    });

    test('should reject NUL bytes', () => {
      expect(() => firmwareService.sanitizeEntry('foo\0bar')).toThrow('NUL bytes');
    });

    test('should reject newlines', () => {
      expect(() => firmwareService.sanitizeEntry('foo\nbar')).toThrow('Newlines');
      expect(() => firmwareService.sanitizeEntry('foo\rbar')).toThrow('Newlines');
    });

    test('should normalize double slashes', () => {
      const result = firmwareService.sanitizeEntry('rtl_nic//rtl8168g.fw');
      expect(result).toBe('rtl_nic/rtl8168g.fw');
    });

    test('should reject empty entry', () => {
      expect(() => firmwareService.sanitizeEntry('')).toThrow('empty');
      expect(() => firmwareService.sanitizeEntry('   ')).toThrow('empty');
    });
  });

  // ===========================================================================
  // Entry CRUD
  // ===========================================================================

  describe('addFirmwareEntry', () => {
    test('should add a file entry', async () => {
      await createFirmwareFile('rtl_nic/rtl8168g-2.fw');
      const result = await firmwareService.addFirmwareEntry('rtl_nic/rtl8168g-2.fw');
      expect(result.entry).toBe('rtl_nic/rtl8168g-2.fw');
      expect(result.exists).toBe(true);
      expect(result.isFile).toBe(true);
    });

    test('should add a directory entry', async () => {
      await createFirmwareDir('rtl_nic');
      await createFirmwareFile('rtl_nic/rtl8168g-2.fw');
      await createFirmwareFile('rtl_nic/rtl8168g-3.fw');
      const result = await firmwareService.addFirmwareEntry('rtl_nic');
      expect(result.entry).toBe('rtl_nic');
      expect(result.exists).toBe(true);
      expect(result.isDirectory).toBe(true);
    });

    test('should reject duplicate with 409', async () => {
      await createFirmwareFile('rtl_nic/rtl8168g-2.fw');
      await firmwareService.addFirmwareEntry('rtl_nic/rtl8168g-2.fw');
      await expect(
        firmwareService.addFirmwareEntry('rtl_nic/rtl8168g-2.fw')
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    test('should reject missing firmware with 404', async () => {
      await expect(
        firmwareService.addFirmwareEntry('nonexistent/firmware.fw')
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    test('should strip /lib/firmware/ prefix and add', async () => {
      await createFirmwareFile('rtl_nic/rtl8168g-2.fw');
      const result = await firmwareService.addFirmwareEntry('/lib/firmware/rtl_nic/rtl8168g-2.fw');
      expect(result.entry).toBe('rtl_nic/rtl8168g-2.fw');
      expect(result.exists).toBe(true);
    });
  });

  describe('removeFirmwareEntry', () => {
    test('should remove an existing entry', async () => {
      await createFirmwareFile('rtl_nic/rtl8168g-2.fw');
      await firmwareService.addFirmwareEntry('rtl_nic/rtl8168g-2.fw');
      const result = await firmwareService.removeFirmwareEntry('rtl_nic/rtl8168g-2.fw');
      expect(result.removed).toBe('rtl_nic/rtl8168g-2.fw');

      const entries = await firmwareService.readFirmwareConfig();
      expect(entries).not.toContain('rtl_nic/rtl8168g-2.fw');
    });

    test('should reject removing nonexistent entry with 404', async () => {
      await expect(
        firmwareService.removeFirmwareEntry('nonexistent')
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  // ===========================================================================
  // Validation
  // ===========================================================================

  describe('validatePath', () => {
    test('should validate existing file', async () => {
      await createFirmwareFile('iwlwifi-cc-a0-77.ucode', 'x'.repeat(100));
      const result = await firmwareService.validatePath('iwlwifi-cc-a0-77.ucode');
      expect(result.exists).toBe(true);
      expect(result.isFile).toBe(true);
      expect(result.size).toBe(100);
    });

    test('should validate existing directory', async () => {
      await createFirmwareDir('rtl_nic');
      await createFirmwareFile('rtl_nic/rtl8168g-2.fw');
      const result = await firmwareService.validatePath('rtl_nic');
      expect(result.exists).toBe(true);
      expect(result.isDirectory).toBe(true);
    });

    test('should report missing firmware', async () => {
      const result = await firmwareService.validatePath('nonexistent.fw');
      expect(result.exists).toBe(false);
    });

    test('should validate .zst variant', async () => {
      await createFirmwareFile('iwlwifi-cc.ucode.zst', 'compressed-data');
      const result = await firmwareService.validatePath('iwlwifi-cc.ucode');
      expect(result.exists).toBe(true);
      expect(result.isZst).toBe(true);
    });

    test('should accept symlink within firmware base', async () => {
      await createFirmwareFile('actual/real.fw');
      await createSymlink('linked.fw', path.join(TEST_FIRMWARE_BASE, 'actual/real.fw'));
      const result = await firmwareService.validatePath('linked.fw');
      expect(result.exists).toBe(true);
      expect(result.isFile).toBe(true);
    });

    test('should reject symlink pointing outside firmware base', async () => {
      // Create a file outside the firmware base
      const outsidePath = path.join(TEST_BASE, 'outside.txt');
      await fs.writeFile(outsidePath, 'secret');
      await createSymlink('evil.fw', outsidePath);
      await expect(
        firmwareService.validatePath('evil.fw')
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  // ===========================================================================
  // getFirmwareEntries
  // ===========================================================================

  describe('getFirmwareEntries', () => {
    test('should return entries with validation status', async () => {
      await createFirmwareFile('rtl_nic/rtl8168g-2.fw');
      await writeFirmwareConfig('rtl_nic/rtl8168g-2.fw\nnonexistent.fw\n');
      const entries = await firmwareService.getFirmwareEntries();
      expect(entries).toHaveLength(2);

      const rtl = entries.find(e => e.entry === 'rtl_nic/rtl8168g-2.fw');
      expect(rtl.exists).toBe(true);
      expect(rtl.valid).toBe(true);

      const missing = entries.find(e => e.entry === 'nonexistent.fw');
      expect(missing.exists).toBe(false);
      expect(missing.valid).toBe(true);
    });

    test('should handle invalid entries in config', async () => {
      await writeFirmwareConfig('../etc/shadow\nrtl_nic\n');
      await createFirmwareDir('rtl_nic');
      const entries = await firmwareService.getFirmwareEntries();
      const invalid = entries.find(e => e.entry === '../etc/shadow');
      expect(invalid.valid).toBe(false);
      expect(invalid.error).toBe('Invalid path');
    });

    test('should return empty array for no config', async () => {
      const entries = await firmwareService.getFirmwareEntries();
      expect(entries).toEqual([]);
    });
  });

  // ===========================================================================
  // Search
  // ===========================================================================

  describe('searchAvailableFirmware', () => {
    test('should find firmware by substring', async () => {
      await createFirmwareFile('rtl_nic/rtl8168g-2.fw');
      await createFirmwareFile('rtl_nic/rtl8168g-3.fw');
      await createFirmwareFile('iwlwifi-cc.ucode');
      firmwareScanner.invalidateCache();

      const results = await firmwareService.searchAvailableFirmware('rtl');
      expect(results.some(r => r.includes('rtl'))).toBe(true);
    });

    test('should be case-insensitive', async () => {
      await createFirmwareFile('RTL_NIC/rtl8168.fw');
      firmwareScanner.invalidateCache();

      const results = await firmwareService.searchAvailableFirmware('rtl');
      expect(results.length).toBeGreaterThan(0);
    });

    test('should respect limit', async () => {
      for (let i = 0; i < 10; i++) {
        await createFirmwareFile(`test/file${i}.fw`);
      }
      firmwareScanner.invalidateCache();

      const results = await firmwareService.searchAvailableFirmware('file', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    test('should return top-level entries for empty query', async () => {
      await createFirmwareFile('rtl_nic/rtl8168.fw');
      await createFirmwareFile('iwlwifi.ucode');
      firmwareScanner.invalidateCache();

      const results = await firmwareService.searchAvailableFirmware('');
      expect(results.length).toBeGreaterThan(0);
    });

    test('should find in deeper directories', async () => {
      await createFirmwareFile('rtl_nic/rtl8168g-2.fw');
      await createFirmwareFile('rtl_nic/rtl8168g-3.fw');
      firmwareScanner.invalidateCache();

      const results = await firmwareService.searchAvailableFirmware('8168g-2');
      expect(results.some(r => r.includes('8168g-2'))).toBe(true);
    });
  });

  // ===========================================================================
  // Status
  // ===========================================================================

  describe('computeStats', () => {
    test('should compute correct stats', () => {
      const entries = [
        { entry: 'a.fw', valid: true, exists: true, isFile: true, isDirectory: false },
        { entry: 'b/', valid: true, exists: true, isFile: false, isDirectory: true },
        { entry: 'c.fw', valid: true, exists: false, isFile: false, isDirectory: false },
        { entry: '../bad', valid: false, exists: false, isFile: false, isDirectory: false },
      ];
      const stats = firmwareService.computeStats(entries);
      expect(stats.total).toBe(4);
      expect(stats.valid).toBe(3);
      expect(stats.existing).toBe(2);
      expect(stats.missing).toBe(1);
      expect(stats.files).toBe(1);
      expect(stats.directories).toBe(1);
    });

    test('should handle empty entries', () => {
      const stats = firmwareService.computeStats([]);
      expect(stats.total).toBe(0);
      expect(stats.valid).toBe(0);
    });
  });

  describe('getFirmwareStatus', () => {
    test('should return combined status', async () => {
      await createFirmwareFile('rtl_nic/rtl8168g.fw');
      await firmwareService.addFirmwareEntry('rtl_nic/rtl8168g.fw');

      const status = await firmwareService.getFirmwareStatus();
      expect(status).toHaveProperty('entries');
      expect(status).toHaveProperty('stats');
      expect(status).toHaveProperty('rebuildRunning');
      expect(status).toHaveProperty('lastSwitchAt');
      expect(status.entries).toHaveLength(1);
      expect(status.stats.total).toBe(1);
      expect(status.stats.existing).toBe(1);
    });

    test('should handle empty config', async () => {
      const status = await firmwareService.getFirmwareStatus();
      expect(status.entries).toEqual([]);
      expect(status.stats.total).toBe(0);
    });

    test('should include mixed valid/invalid entries', async () => {
      await createFirmwareFile('good.fw');
      await writeFirmwareConfig('good.fw\nmissing.fw\n');

      const status = await firmwareService.getFirmwareStatus();
      expect(status.stats.total).toBe(2);
      expect(status.stats.existing).toBe(1);
      expect(status.stats.missing).toBe(1);
    });
  });

  // ===========================================================================
  // Bulk Add
  // ===========================================================================

  describe('addBulkFirmwareEntries', () => {
    test('should add multiple entries in one atomic write', async () => {
      await createFirmwareFile('a.fw');
      await createFirmwareFile('b.fw');
      await createFirmwareFile('c.fw');
      const result = await firmwareService.addBulkFirmwareEntries(['a.fw', 'b.fw', 'c.fw']);
      expect(result.added).toEqual(['a.fw', 'b.fw', 'c.fw']);
      expect(result.duplicates).toEqual([]);
      expect(result.invalid).toEqual([]);

      const config = await firmwareService.readFirmwareConfig();
      expect(config).toContain('a.fw');
      expect(config).toContain('b.fw');
      expect(config).toContain('c.fw');
    });

    test('should report duplicates without error', async () => {
      await createFirmwareFile('a.fw');
      await createFirmwareFile('b.fw');
      await firmwareService.addFirmwareEntry('a.fw');

      const result = await firmwareService.addBulkFirmwareEntries(['a.fw', 'b.fw']);
      expect(result.added).toEqual(['b.fw']);
      expect(result.duplicates).toEqual(['a.fw']);
    });

    test('should reject traversal entries and add valid ones', async () => {
      await createFirmwareFile('good.fw');
      const result = await firmwareService.addBulkFirmwareEntries(['good.fw', '../bad']);
      expect(result.added).toEqual(['good.fw']);
      expect(result.invalid).toEqual(['../bad']);
    });

    test('should reject non-existent entries', async () => {
      await createFirmwareFile('exists.fw');
      const result = await firmwareService.addBulkFirmwareEntries(['exists.fw', 'missing.fw']);
      expect(result.added).toEqual(['exists.fw']);
      expect(result.invalid).toEqual(['missing.fw']);
    });

    test('should throw 400 for empty entries array', async () => {
      await expect(
        firmwareService.addBulkFirmwareEntries([])
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    test('should throw 400 for non-array entries', async () => {
      await expect(
        firmwareService.addBulkFirmwareEntries('not-array')
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  // ===========================================================================
  // wpa_supplicant Configuration
  // ===========================================================================

  describe('SSID Validation', () => {
    test('should reject empty SSID', () => {
      expect(() => firmwareService.validateSsid('')).toThrow('SSID ist erforderlich');
      expect(() => firmwareService.validateSsid('  ')).toThrow('SSID ist erforderlich');
    });

    test('should reject SSID with control characters', () => {
      expect(() => firmwareService.validateSsid('test\nfoo')).toThrow('Steuerzeichen');
      expect(() => firmwareService.validateSsid('test\rfoo')).toThrow('Steuerzeichen');
      expect(() => firmwareService.validateSsid('test\0foo')).toThrow('Steuerzeichen');
    });

    test('should reject SSID longer than 32 chars', () => {
      expect(() => firmwareService.validateSsid('a'.repeat(33))).toThrow('max. 32');
    });

    test('should accept valid SSID', () => {
      expect(() => firmwareService.validateSsid('LINBO_MGMT')).not.toThrow();
      expect(() => firmwareService.validateSsid('Test WiFi Network')).not.toThrow();
    });
  });

  describe('WPA Config Escaping', () => {
    test('should escape quotes in SSID', () => {
      const result = firmwareService.escapeWpaString('My "WiFi"');
      expect(result).toBe('My \\"WiFi\\"');
    });

    test('should escape backslashes', () => {
      const result = firmwareService.escapeWpaString('back\\slash');
      expect(result).toBe('back\\\\slash');
    });
  });

  describe('WPA Config Generation', () => {
    test('should generate WPA-PSK config with string PSK', () => {
      const config = firmwareService.generateWpaConfig('TestNet', 'WPA-PSK', 'mypassword');
      expect(config).toContain('ssid="TestNet"');
      expect(config).toContain('key_mgmt=WPA-PSK');
      expect(config).toContain('psk="mypassword"');
    });

    test('should generate WPA-PSK config with hex PSK (no quotes)', () => {
      const hexPsk = 'a'.repeat(64);
      const config = firmwareService.generateWpaConfig('TestNet', 'WPA-PSK', hexPsk);
      expect(config).toContain(`psk=${hexPsk}`);
      expect(config).not.toContain(`psk="${hexPsk}"`);
    });

    test('should generate NONE config without PSK', () => {
      const config = firmwareService.generateWpaConfig('OpenNet', 'NONE', undefined);
      expect(config).toContain('ssid="OpenNet"');
      expect(config).toContain('key_mgmt=NONE');
      expect(config).not.toContain('psk=');
    });

    test('should escape SSID special chars', () => {
      const config = firmwareService.generateWpaConfig('My "Net"', 'NONE', undefined);
      expect(config).toContain('ssid="My \\"Net\\""');
    });
  });

  describe('WPA Config Parsing', () => {
    test('should parse quoted PSK', () => {
      const raw = 'network={\n    ssid="TestNet"\n    key_mgmt=WPA-PSK\n    psk="mypassword"\n}';
      const parsed = firmwareService.parseWpaConfig(raw);
      expect(parsed.ssid).toBe('TestNet');
      expect(parsed.keyMgmt).toBe('WPA-PSK');
      expect(parsed.psk).toBe('mypassword');
    });

    test('should parse hex PSK', () => {
      const hexPsk = 'a1b2c3d4'.repeat(8); // 64 hex chars
      const raw = `network={\n    ssid="TestNet"\n    key_mgmt=WPA-PSK\n    psk=${hexPsk}\n}`;
      const parsed = firmwareService.parseWpaConfig(raw);
      expect(parsed.psk).toBe(hexPsk);
    });

    test('should parse NONE config without PSK', () => {
      const raw = 'network={\n    ssid="OpenNet"\n    key_mgmt=NONE\n}';
      const parsed = firmwareService.parseWpaConfig(raw);
      expect(parsed.ssid).toBe('OpenNet');
      expect(parsed.keyMgmt).toBe('NONE');
      expect(parsed.psk).toBe('');
    });

    test('should unescape SSID with quotes', () => {
      const raw = 'network={\n    ssid="My \\"WiFi\\""\n    key_mgmt=NONE\n}';
      const parsed = firmwareService.parseWpaConfig(raw);
      expect(parsed.ssid).toBe('My "WiFi"');
    });
  });

  describe('getWlanConfig', () => {
    test('should return disabled when file missing', async () => {
      const config = await firmwareService.getWlanConfig();
      expect(config).toEqual({
        enabled: false,
        ssid: '',
        keyMgmt: 'WPA-PSK',
        hasPsk: false,
        scanSsid: false,
      });
    });

    test('should return config without PSK value', async () => {
      const content = 'ctrl_interface=/var/run/wpa_supplicant\n\nnetwork={\n    ssid="TestNet"\n    key_mgmt=WPA-PSK\n    psk="secret123"\n}\n';
      await fs.writeFile(path.join(TEST_CONFIG_DIR, 'wpa_supplicant.conf'), content);

      const config = await firmwareService.getWlanConfig();
      expect(config.enabled).toBe(true);
      expect(config.ssid).toBe('TestNet');
      expect(config.keyMgmt).toBe('WPA-PSK');
      expect(config.hasPsk).toBe(true);
      // PSK value must NOT be returned
      expect(config).not.toHaveProperty('psk');
    });

    test('should report hasPsk true for hex PSK', async () => {
      const hexPsk = 'abcdef01'.repeat(8);
      const content = `network={\n    ssid="TestNet"\n    key_mgmt=WPA-PSK\n    psk=${hexPsk}\n}\n`;
      await fs.writeFile(path.join(TEST_CONFIG_DIR, 'wpa_supplicant.conf'), content);

      const config = await firmwareService.getWlanConfig();
      expect(config.hasPsk).toBe(true);
    });
  });

  describe('setWlanConfig', () => {
    test('should create WPA-PSK config with new PSK', async () => {
      await firmwareService.setWlanConfig({ ssid: 'TestNet', keyMgmt: 'WPA-PSK', psk: 'mypassword123' });

      const raw = await fs.readFile(path.join(TEST_CONFIG_DIR, 'wpa_supplicant.conf'), 'utf-8');
      expect(raw).toContain('ssid="TestNet"');
      expect(raw).toContain('key_mgmt=WPA-PSK');
      expect(raw).toContain('psk="mypassword123"');
    });

    test('should preserve existing PSK when psk not provided', async () => {
      // First create config with PSK
      await firmwareService.setWlanConfig({ ssid: 'TestNet', keyMgmt: 'WPA-PSK', psk: 'firstpass123' });

      // Update SSID without PSK
      await firmwareService.setWlanConfig({ ssid: 'NewSSID', keyMgmt: 'WPA-PSK' });

      const raw = await fs.readFile(path.join(TEST_CONFIG_DIR, 'wpa_supplicant.conf'), 'utf-8');
      expect(raw).toContain('ssid="NewSSID"');
      expect(raw).toContain('psk="firstpass123"');
    });

    test('should throw when no PSK exists and none provided', async () => {
      await expect(
        firmwareService.setWlanConfig({ ssid: 'TestNet', keyMgmt: 'WPA-PSK' })
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    test('should reject PSK shorter than 8 characters', async () => {
      await expect(
        firmwareService.setWlanConfig({ ssid: 'TestNet', keyMgmt: 'WPA-PSK', psk: 'short' })
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    test('should accept 64-hex PSK without length check', async () => {
      const hexPsk = 'abcdef01'.repeat(8);
      await firmwareService.setWlanConfig({ ssid: 'TestNet', keyMgmt: 'WPA-PSK', psk: hexPsk });

      const raw = await fs.readFile(path.join(TEST_CONFIG_DIR, 'wpa_supplicant.conf'), 'utf-8');
      expect(raw).toContain(`psk=${hexPsk}`);
      expect(raw).not.toContain(`psk="${hexPsk}"`);
    });

    test('should create NONE config without PSK', async () => {
      await firmwareService.setWlanConfig({ ssid: 'OpenNet', keyMgmt: 'NONE' });

      const raw = await fs.readFile(path.join(TEST_CONFIG_DIR, 'wpa_supplicant.conf'), 'utf-8');
      expect(raw).toContain('key_mgmt=NONE');
      expect(raw).not.toContain('psk=');
    });

    test('should write with 0o600 permissions', async () => {
      await firmwareService.setWlanConfig({ ssid: 'TestNet', keyMgmt: 'WPA-PSK', psk: 'mypassword123' });

      const stat = await fs.stat(path.join(TEST_CONFIG_DIR, 'wpa_supplicant.conf'));
      // Check permissions (only owner read/write)
      expect(stat.mode & 0o777).toBe(0o600);
    });

    test('should escape SSID with special characters', async () => {
      await firmwareService.setWlanConfig({
        ssid: 'My "WiFi"',
        keyMgmt: 'WPA-PSK',
        psk: 'password123',
      });

      const raw = await fs.readFile(path.join(TEST_CONFIG_DIR, 'wpa_supplicant.conf'), 'utf-8');
      expect(raw).toContain('ssid="My \\"WiFi\\""');
    });

    test('should reject SSID with invalid characters', async () => {
      await expect(
        firmwareService.setWlanConfig({ ssid: 'bad\nssid', keyMgmt: 'NONE' })
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('scan_ssid support', () => {
    test('should parse scan_ssid=1 from config', async () => {
      const content = 'network={\n    ssid="HiddenNet"\n    scan_ssid=1\n    key_mgmt=WPA-PSK\n    psk="secret123"\n}\n';
      await fs.writeFile(path.join(TEST_CONFIG_DIR, 'wpa_supplicant.conf'), content);

      const config = await firmwareService.getWlanConfig();
      expect(config.scanSsid).toBe(true);
      expect(config.ssid).toBe('HiddenNet');
    });

    test('should default scanSsid to false when not present', async () => {
      const content = 'network={\n    ssid="VisibleNet"\n    key_mgmt=WPA-PSK\n    psk="secret123"\n}\n';
      await fs.writeFile(path.join(TEST_CONFIG_DIR, 'wpa_supplicant.conf'), content);

      const config = await firmwareService.getWlanConfig();
      expect(config.scanSsid).toBe(false);
    });

    test('should return scanSsid false when disabled', async () => {
      const config = await firmwareService.getWlanConfig();
      expect(config.scanSsid).toBe(false);
    });

    test('should generate scan_ssid=1 when enabled', async () => {
      await firmwareService.setWlanConfig({ ssid: 'HiddenNet', keyMgmt: 'WPA-PSK', psk: 'password123', scanSsid: true });

      const raw = await fs.readFile(path.join(TEST_CONFIG_DIR, 'wpa_supplicant.conf'), 'utf-8');
      expect(raw).toContain('scan_ssid=1');
      expect(raw).toContain('ssid="HiddenNet"');
    });

    test('should not generate scan_ssid when disabled', async () => {
      await firmwareService.setWlanConfig({ ssid: 'VisibleNet', keyMgmt: 'WPA-PSK', psk: 'password123', scanSsid: false });

      const raw = await fs.readFile(path.join(TEST_CONFIG_DIR, 'wpa_supplicant.conf'), 'utf-8');
      expect(raw).not.toContain('scan_ssid');
    });

    test('should preserve scan_ssid through read/write cycle', async () => {
      await firmwareService.setWlanConfig({ ssid: 'HiddenNet', keyMgmt: 'WPA-PSK', psk: 'password123', scanSsid: true });

      // Update SSID without changing scanSsid — but re-supply scanSsid
      await firmwareService.setWlanConfig({ ssid: 'StillHidden', keyMgmt: 'WPA-PSK', scanSsid: true });

      const raw = await fs.readFile(path.join(TEST_CONFIG_DIR, 'wpa_supplicant.conf'), 'utf-8');
      expect(raw).toContain('scan_ssid=1');
      expect(raw).toContain('ssid="StillHidden"');
      expect(raw).toContain('psk="password123"');
    });
  });

  describe('disableWlan', () => {
    test('should delete wpa_supplicant.conf', async () => {
      await firmwareService.setWlanConfig({ ssid: 'TestNet', keyMgmt: 'WPA-PSK', psk: 'password123' });
      await firmwareService.disableWlan();

      const config = await firmwareService.getWlanConfig();
      expect(config.enabled).toBe(false);
    });

    test('should not throw when file already missing', async () => {
      await expect(firmwareService.disableWlan()).resolves.not.toThrow();
    });
  });
});
