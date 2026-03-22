/**
 * LINBO Docker - Driver Path Utilities Tests
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');

const TEST_BASE = path.join(os.tmpdir(), `driver-path-test-${Date.now()}`);
const TEST_PC_BASE = path.join(TEST_BASE, 'linuxmuster-client');

// Set environment BEFORE importing
process.env.DRIVERS_BASE = TEST_PC_BASE;
process.env.PATCHCLASS_BASE = TEST_PC_BASE; // backward compat test
process.env.IMAGE_DIR = path.join(TEST_BASE, 'images');
process.env.LINBO_DIR = TEST_BASE;
process.env.SRV_LINBO_DIR = TEST_BASE;

const {
  DRIVERS_BASE, IMAGE_DIR, MAX_ZIP_ENTRIES, MAX_ZIP_SIZE,
  sanitizeName, sanitizeRelativePath, resolveAndValidate, resolveDriverPath,
} = require('../../../src/lib/driver-path');

describe('driver-path', () => {
  beforeEach(async () => {
    await fs.rm(TEST_BASE, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(TEST_PC_BASE, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(TEST_BASE, { recursive: true, force: true }).catch(() => {});
  });

  // ===========================================================================
  // Constants
  // ===========================================================================

  describe('constants', () => {
    test('DRIVERS_BASE uses environment variable', () => {
      expect(DRIVERS_BASE).toBe(TEST_PC_BASE);
    });

    test('IMAGE_DIR uses environment variable', () => {
      expect(IMAGE_DIR).toBe(path.join(TEST_BASE, 'images'));
    });

    test('MAX_ZIP_ENTRIES is 50000', () => {
      expect(MAX_ZIP_ENTRIES).toBe(50000);
    });

    test('MAX_ZIP_SIZE is 4GB', () => {
      expect(MAX_ZIP_SIZE).toBe(4 * 1024 * 1024 * 1024);
    });
  });

  // ===========================================================================
  // sanitizeName
  // ===========================================================================

  describe('sanitizeName()', () => {
    test('accepts valid names', () => {
      expect(sanitizeName('win11-pc')).toBe('win11-pc');
      expect(sanitizeName('Dell_OptiPlex-7090')).toBe('Dell_OptiPlex-7090');
      expect(sanitizeName('a')).toBe('a');
      expect(sanitizeName('test.class')).toBe('test.class');
    });

    test('trims whitespace', () => {
      expect(sanitizeName('  win11  ')).toBe('win11');
    });

    test('rejects empty name', () => {
      expect(() => sanitizeName('')).toThrow(/must not be empty/);
      expect(() => sanitizeName(null)).toThrow(/must not be empty/);
      expect(() => sanitizeName(undefined)).toThrow(/must not be empty/);
    });

    test('rejects names starting with non-alphanumeric', () => {
      expect(() => sanitizeName('.hidden')).toThrow();
      expect(() => sanitizeName('-dash')).toThrow();
      expect(() => sanitizeName('_under')).toThrow();
    });

    test('rejects names with invalid characters', () => {
      expect(() => sanitizeName('foo/bar')).toThrow();
      expect(() => sanitizeName('foo bar')).toThrow();
      expect(() => sanitizeName('foo\\bar')).toThrow();
    });

    test('rejects names longer than 100 chars', () => {
      expect(() => sanitizeName('a'.repeat(101))).toThrow();
    });

    test('accepts name with exactly 100 chars', () => {
      expect(sanitizeName('a'.repeat(100))).toHaveLength(100);
    });
  });

  // ===========================================================================
  // sanitizeRelativePath
  // ===========================================================================

  describe('sanitizeRelativePath()', () => {
    test('accepts valid relative paths', () => {
      expect(sanitizeRelativePath('NIC/e1000e.inf')).toBe('NIC/e1000e.inf');
      expect(sanitizeRelativePath('driver.sys')).toBe('driver.sys');
      expect(sanitizeRelativePath('GPU/AMD/amd.cat')).toBe('GPU/AMD/amd.cat');
    });

    test('rejects path traversal', () => {
      expect(() => sanitizeRelativePath('../etc/passwd')).toThrow(/traversal/);
      expect(() => sanitizeRelativePath('foo/../bar')).toThrow(/traversal/);
      expect(() => sanitizeRelativePath('..')).toThrow(/traversal/);
    });

    test('rejects absolute paths', () => {
      expect(() => sanitizeRelativePath('/etc/passwd')).toThrow(/Absolute/);
    });

    test('rejects backslashes', () => {
      expect(() => sanitizeRelativePath('NIC\\e1000e.inf')).toThrow(/Backslash/);
    });

    test('rejects NUL bytes', () => {
      expect(() => sanitizeRelativePath('foo\0bar')).toThrow(/NUL/);
    });

    test('normalizes double slashes', () => {
      expect(sanitizeRelativePath('NIC//e1000e.inf')).toBe('NIC/e1000e.inf');
    });

    test('strips trailing slash', () => {
      expect(sanitizeRelativePath('drivers/')).toBe('drivers');
    });
  });

  // ===========================================================================
  // resolveAndValidate
  // ===========================================================================

  describe('resolveAndValidate()', () => {
    test('resolves valid path within base', async () => {
      const result = await resolveAndValidate('win11', 'drivers');
      expect(result).toBe(path.join(TEST_PC_BASE, 'win11', 'drivers'));
    });

    test('resolves existing path via realpath', async () => {
      const dir = path.join(TEST_PC_BASE, 'existing');
      await fs.mkdir(dir, { recursive: true });
      const result = await resolveAndValidate('existing');
      expect(result).toBe(dir);
    });

    test('rejects path traversal via ..', async () => {
      await expect(resolveAndValidate('..', 'etc')).rejects.toThrow(/traversal/);
    });
  });

  // ===========================================================================
  // resolveDriverPath
  // ===========================================================================

  describe('resolveDriverPath()', () => {
    test('joins segments correctly', () => {
      expect(resolveDriverPath('win11', 'drivers', 'NIC'))
        .toBe(path.join(TEST_PC_BASE, 'win11', 'drivers', 'NIC'));
    });

    test('works with single segment', () => {
      expect(resolveDriverPath('win11'))
        .toBe(path.join(TEST_PC_BASE, 'win11'));
    });
  });
});
