/**
 * LINBO Docker - Firmware Catalog Tests
 * Tests for static catalog, prefix expansion, .zst transparency, and cache
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');

// Create isolated test directories
const TEST_BASE = path.join(os.tmpdir(), `fw-catalog-test-${Date.now()}`);
const TEST_FIRMWARE_BASE = path.join(TEST_BASE, 'lib_firmware');
const TEST_CONFIG_DIR = path.join(TEST_BASE, 'config');
const TEST_KERNEL_DIR = path.join(TEST_BASE, 'current');
const TEST_LINBO_DIR = path.join(TEST_BASE, 'linbo');

// Set environment BEFORE importing modules
process.env.FIRMWARE_BASE = TEST_FIRMWARE_BASE;
process.env.CONFIG_DIR = TEST_CONFIG_DIR;
process.env.LINBO_CONFIG_DIR = TEST_CONFIG_DIR;
process.env.KERNEL_VAR_DIR = TEST_KERNEL_DIR;
process.env.LINBO_DIR = TEST_LINBO_DIR;
process.env.LINBO_DATA_DIR = TEST_LINBO_DIR;
process.env.UPDATE_LINBOFS_SCRIPT = path.join(TEST_BASE, 'mock-update-linbofs.sh');

// Mock child_process for kernel service
jest.mock('child_process', () => ({
  execFile: jest.fn((cmd, args, opts, callback) => {
    if (typeof opts === 'function') { callback = opts; }
    if (callback) setTimeout(() => callback(null, 'OK\n', ''), 10);
  }),
}));

const catalog = require('../../src/lib/firmware-catalog');

// =============================================================================
// Setup / Teardown
// =============================================================================

async function setupDirs() {
  await fs.mkdir(TEST_FIRMWARE_BASE, { recursive: true });
  await fs.mkdir(TEST_CONFIG_DIR, { recursive: true });
  await fs.mkdir(TEST_KERNEL_DIR, { recursive: true });
  await fs.mkdir(TEST_LINBO_DIR, { recursive: true });
}

async function cleanDirs() {
  await fs.rm(TEST_BASE, { recursive: true, force: true }).catch(() => {});
}

beforeAll(async () => {
  await cleanDirs();
  await setupDirs();
});

afterAll(async () => {
  await cleanDirs();
});

beforeEach(async () => {
  // Reset firmware directory
  await fs.rm(TEST_FIRMWARE_BASE, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(TEST_FIRMWARE_BASE, { recursive: true });
  catalog.invalidateCatalogCache();
});

// =============================================================================
// Catalog Structure Tests
// =============================================================================

describe('Firmware Catalog Structure', () => {
  test('all catalog entries have required fields', () => {
    for (const vendor of catalog.FIRMWARE_CATALOG) {
      expect(vendor).toHaveProperty('id');
      expect(vendor).toHaveProperty('name');
      expect(vendor).toHaveProperty('category');
      expect(vendor).toHaveProperty('entries');
      expect(Array.isArray(vendor.entries)).toBe(true);

      for (const entry of vendor.entries) {
        expect(entry).toHaveProperty('path');
        expect(entry).toHaveProperty('type');
        expect(['dir', 'prefix']).toContain(entry.type);
        expect(entry).toHaveProperty('description');
        if (entry.type === 'prefix') {
          expect(entry).toHaveProperty('pattern');
          expect(entry.pattern).toBeInstanceOf(RegExp);
        }
      }
    }
  });

  test('all categories are defined', () => {
    expect(catalog.CATEGORIES).toHaveLength(4);
    const ids = catalog.CATEGORIES.map(c => c.id);
    expect(ids).toContain('wifi');
    expect(ids).toContain('ethernet');
    expect(ids).toContain('gpu');
    expect(ids).toContain('bluetooth');
  });

  test('all vendors belong to a valid category', () => {
    const catIds = new Set(catalog.CATEGORIES.map(c => c.id));
    for (const vendor of catalog.FIRMWARE_CATALOG) {
      expect(catIds.has(vendor.category)).toBe(true);
    }
  });

  test('vendor IDs are unique', () => {
    const ids = catalog.FIRMWARE_CATALOG.map(v => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// =============================================================================
// Prefix Expansion Tests
// =============================================================================

describe('Prefix Expansion', () => {
  const intelEntry = {
    path: 'iwlwifi',
    type: 'prefix',
    pattern: /^iwlwifi-.*\.(ucode|pnvm)$/,
  };

  test('expands .ucode files matching pattern', async () => {
    await fs.writeFile(path.join(TEST_FIRMWARE_BASE, 'iwlwifi-cc-a0-77.ucode'), '');
    await fs.writeFile(path.join(TEST_FIRMWARE_BASE, 'iwlwifi-so-a0-gf-a0-89.ucode'), '');
    await fs.writeFile(path.join(TEST_FIRMWARE_BASE, 'iwlwifi-ty-a0-gf-a0.pnvm'), '');
    // Non-matching
    await fs.writeFile(path.join(TEST_FIRMWARE_BASE, 'iwlwifi-README.txt'), '');

    const files = await catalog.expandPrefixEntry(intelEntry);
    expect(files).toContain('iwlwifi-cc-a0-77.ucode');
    expect(files).toContain('iwlwifi-so-a0-gf-a0-89.ucode');
    expect(files).toContain('iwlwifi-ty-a0-gf-a0.pnvm');
    expect(files).not.toContain('iwlwifi-README.txt');
    expect(files.length).toBe(3);
  });

  test('.zst transparency: strips .zst suffix in expansion', async () => {
    await fs.writeFile(path.join(TEST_FIRMWARE_BASE, 'iwlwifi-cc-a0-77.ucode.zst'), '');
    await fs.writeFile(path.join(TEST_FIRMWARE_BASE, 'iwlwifi-so-a0.ucode'), '');

    const files = await catalog.expandPrefixEntry(intelEntry);
    expect(files).toContain('iwlwifi-cc-a0-77.ucode');
    expect(files).toContain('iwlwifi-so-a0.ucode');
    expect(files).not.toContain('iwlwifi-cc-a0-77.ucode.zst');
  });

  test('.zst dedup: same base with and without .zst → only one entry', async () => {
    await fs.writeFile(path.join(TEST_FIRMWARE_BASE, 'iwlwifi-foo.ucode'), '');
    await fs.writeFile(path.join(TEST_FIRMWARE_BASE, 'iwlwifi-foo.ucode.zst'), '');

    const files = await catalog.expandPrefixEntry(intelEntry);
    expect(files.filter(f => f === 'iwlwifi-foo.ucode')).toHaveLength(1);
  });

  test('empty firmware directory returns empty array', async () => {
    const files = await catalog.expandPrefixEntry(intelEntry);
    expect(files).toEqual([]);
  });

  test('non-existent firmware directory returns empty array', async () => {
    await fs.rm(TEST_FIRMWARE_BASE, { recursive: true, force: true });
    const files = await catalog.expandPrefixEntry(intelEntry);
    expect(files).toEqual([]);
    await fs.mkdir(TEST_FIRMWARE_BASE, { recursive: true });
  });

  test('results are sorted alphabetically', async () => {
    await fs.writeFile(path.join(TEST_FIRMWARE_BASE, 'iwlwifi-z.ucode'), '');
    await fs.writeFile(path.join(TEST_FIRMWARE_BASE, 'iwlwifi-a.ucode'), '');
    await fs.writeFile(path.join(TEST_FIRMWARE_BASE, 'iwlwifi-m.ucode'), '');

    const files = await catalog.expandPrefixEntry(intelEntry);
    expect(files).toEqual(['iwlwifi-a.ucode', 'iwlwifi-m.ucode', 'iwlwifi-z.ucode']);
  });
});

// =============================================================================
// Availability Check Tests
// =============================================================================

describe('Availability Check', () => {
  test('dir exists → available', async () => {
    await fs.mkdir(path.join(TEST_FIRMWARE_BASE, 'ath11k'), { recursive: true });
    const avail = await catalog.checkAvailability('ath11k');
    expect(avail).toBe(true);
  });

  test('dir missing → not available', async () => {
    const avail = await catalog.checkAvailability('ath11k');
    expect(avail).toBe(false);
  });

  test('file with .zst fallback → available', async () => {
    await fs.writeFile(path.join(TEST_FIRMWARE_BASE, 'foo.ucode.zst'), '');
    const avail = await catalog.checkAvailability('foo.ucode');
    expect(avail).toBe(true);
  });
});

// =============================================================================
// getCatalogWithAvailability Tests
// =============================================================================

describe('getCatalogWithAvailability', () => {
  test('returns all categories', async () => {
    const result = await catalog.getCatalogWithAvailability([]);
    expect(result).toHaveLength(4);
    expect(result.map(c => c.id)).toEqual(['wifi', 'ethernet', 'gpu', 'bluetooth']);
  });

  test('dir entry: configured status from config', async () => {
    await fs.mkdir(path.join(TEST_FIRMWARE_BASE, 'ath11k'), { recursive: true });
    const result = await catalog.getCatalogWithAvailability(['ath11k']);
    const wifiCat = result.find(c => c.id === 'wifi');
    const athVendor = wifiCat.vendors.find(v => v.id === 'wifi-atheros');
    const ath11kEntry = athVendor.entries.find(e => e.path === 'ath11k');
    expect(ath11kEntry.configured).toBe(true);
    expect(ath11kEntry.configuredCount).toBe(1);
    expect(ath11kEntry.available).toBe(true);
  });

  test('dir entry: not configured when absent from config', async () => {
    await fs.mkdir(path.join(TEST_FIRMWARE_BASE, 'ath11k'), { recursive: true });
    const result = await catalog.getCatalogWithAvailability([]);
    const wifiCat = result.find(c => c.id === 'wifi');
    const athVendor = wifiCat.vendors.find(v => v.id === 'wifi-atheros');
    const ath11kEntry = athVendor.entries.find(e => e.path === 'ath11k');
    expect(ath11kEntry.configured).toBe(false);
    expect(ath11kEntry.configuredCount).toBe(0);
  });

  test('prefix entry: configuredCount from config intersection', async () => {
    await fs.writeFile(path.join(TEST_FIRMWARE_BASE, 'iwlwifi-a.ucode'), '');
    await fs.writeFile(path.join(TEST_FIRMWARE_BASE, 'iwlwifi-b.ucode'), '');
    await fs.writeFile(path.join(TEST_FIRMWARE_BASE, 'iwlwifi-c.ucode'), '');

    catalog.invalidateCatalogCache();
    const result = await catalog.getCatalogWithAvailability(['iwlwifi-a.ucode', 'iwlwifi-c.ucode']);
    const wifiCat = result.find(c => c.id === 'wifi');
    const intelVendor = wifiCat.vendors.find(v => v.id === 'wifi-intel');
    const iwlEntry = intelVendor.entries.find(e => e.path === 'iwlwifi');
    expect(iwlEntry.configuredCount).toBe(2);
    expect(iwlEntry.totalCount).toBe(3);
  });

  test('expand=false: no expandedFiles in response', async () => {
    await fs.writeFile(path.join(TEST_FIRMWARE_BASE, 'iwlwifi-a.ucode'), '');
    catalog.invalidateCatalogCache();
    const result = await catalog.getCatalogWithAvailability([], false);
    const wifiCat = result.find(c => c.id === 'wifi');
    const intelVendor = wifiCat.vendors.find(v => v.id === 'wifi-intel');
    const iwlEntry = intelVendor.entries.find(e => e.path === 'iwlwifi');
    expect(iwlEntry.expandedFiles).toBeUndefined();
    expect(iwlEntry.configuredFiles).toBeUndefined();
    expect(iwlEntry.totalCount).toBe(1);
  });

  test('expand=true: includes expandedFiles and configuredFiles', async () => {
    await fs.writeFile(path.join(TEST_FIRMWARE_BASE, 'iwlwifi-a.ucode'), '');
    await fs.writeFile(path.join(TEST_FIRMWARE_BASE, 'iwlwifi-b.ucode'), '');
    catalog.invalidateCatalogCache();
    const result = await catalog.getCatalogWithAvailability(['iwlwifi-a.ucode'], true);
    const wifiCat = result.find(c => c.id === 'wifi');
    const intelVendor = wifiCat.vendors.find(v => v.id === 'wifi-intel');
    const iwlEntry = intelVendor.entries.find(e => e.path === 'iwlwifi');
    expect(iwlEntry.expandedFiles).toEqual(['iwlwifi-a.ucode', 'iwlwifi-b.ucode']);
    expect(iwlEntry.configuredFiles).toEqual(['iwlwifi-a.ucode']);
  });

  test('vendor configuredCount is sum of entry counts', async () => {
    await fs.mkdir(path.join(TEST_FIRMWARE_BASE, 'ath10k'), { recursive: true });
    await fs.mkdir(path.join(TEST_FIRMWARE_BASE, 'ath11k'), { recursive: true });
    catalog.invalidateCatalogCache();
    const result = await catalog.getCatalogWithAvailability(['ath10k', 'ath11k']);
    const wifiCat = result.find(c => c.id === 'wifi');
    const athVendor = wifiCat.vendors.find(v => v.id === 'wifi-atheros');
    expect(athVendor.configuredCount).toBe(2);
    expect(athVendor.totalCount).toBe(3); // ath10k, ath11k, ath12k
  });
});

// =============================================================================
// Cache Tests
// =============================================================================

describe('Availability Cache', () => {
  test('second call uses cache (no FS changes needed)', async () => {
    await fs.mkdir(path.join(TEST_FIRMWARE_BASE, 'ath11k'), { recursive: true });
    catalog.invalidateCatalogCache();

    const result1 = await catalog.getCatalogWithAvailability([]);
    const cacheTime1 = catalog._getCacheTime();
    expect(cacheTime1).toBeGreaterThan(0);

    // Second call should use cache (same cache time)
    const result2 = await catalog.getCatalogWithAvailability([]);
    const cacheTime2 = catalog._getCacheTime();
    expect(cacheTime2).toBe(cacheTime1);
    expect(result2).toEqual(result1);
  });

  test('invalidateCatalogCache resets cache', async () => {
    await fs.mkdir(path.join(TEST_FIRMWARE_BASE, 'ath11k'), { recursive: true });
    await catalog.getCatalogWithAvailability([]);
    expect(catalog._getCache()).not.toBeNull();

    catalog.invalidateCatalogCache();
    expect(catalog._getCache()).toBeNull();
    expect(catalog._getCacheTime()).toBe(0);
  });
});
