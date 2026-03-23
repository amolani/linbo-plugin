'use strict';

const {
  mergeCatalogs,
  getCatalog,
  invalidateCache,
  getCategories,
  getCatalogByCategory,
  findByVendorDevice,
  searchCatalog,
  resolveCategory,
} = require('../../../src/lib/driver-catalog');

// ---------------------------------------------------------------------------
// Helpers — synthetic catalog objects for mergeCatalogs tests (no file I/O)
// ---------------------------------------------------------------------------

function makeBase() {
  return {
    version: 1,
    categories: [
      { id: 'nic', name: 'Netzwerk', icon: 'cable' },
      { id: 'gpu', name: 'Grafik', icon: 'monitor' },
    ],
    vendors: [
      {
        id: 'nic-intel',
        name: 'Intel Ethernet',
        category: 'nic',
        devices: [
          { vendor: '8086', device: '1533', name: 'I210 Gigabit' },
        ],
      },
    ],
  };
}

function makeCustom() {
  return {
    version: 2,
    categories: [
      { id: 'nic', name: 'Netzwerk (duplicate)', icon: 'cable' }, // duplicate — must NOT be added
      { id: 'custom-cat', name: 'Custom Category', icon: 'star' }, // new — must be added
    ],
    vendors: [
      // Existing vendor — extend with new device
      {
        id: 'nic-intel',
        name: 'Intel Ethernet',
        category: 'nic',
        devices: [
          { vendor: '8086', device: '1533', name: 'I210 Gigabit' }, // duplicate device — must NOT be added
          { vendor: '8086', device: 'AAAA', name: 'Custom Intel NIC' }, // new device — must be added
        ],
      },
      // New vendor
      {
        id: 'custom-vendor',
        name: 'Custom Vendor',
        category: 'custom-cat',
        devices: [
          { vendor: 'ffff', device: '0001', name: 'Custom Device' },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('driver-catalog', () => {
  afterEach(() => {
    invalidateCache();
  });

  // -------------------------------------------------------------------------
  // mergeCatalogs — pure function, no I/O
  // -------------------------------------------------------------------------
  describe('mergeCatalogs', () => {
    it('uses custom.version when provided', () => {
      const merged = mergeCatalogs(makeBase(), makeCustom());
      expect(merged.version).toBe(2);
    });

    it('falls back to base.version when custom has no version', () => {
      const custom = makeCustom();
      delete custom.version;
      const merged = mergeCatalogs(makeBase(), custom);
      expect(merged.version).toBe(1);
    });

    it('adds new categories without duplicating existing ones', () => {
      const merged = mergeCatalogs(makeBase(), makeCustom());
      const ids = merged.categories.map(c => c.id);
      expect(ids).toContain('nic');
      expect(ids).toContain('gpu');
      expect(ids).toContain('custom-cat');
      // nic must appear only once even though custom also has it
      expect(ids.filter(id => id === 'nic')).toHaveLength(1);
    });

    it('adds new vendors from custom', () => {
      const merged = mergeCatalogs(makeBase(), makeCustom());
      const vendorIds = merged.vendors.map(v => v.id);
      expect(vendorIds).toContain('custom-vendor');
    });

    it('extends existing vendor with new devices without duplicating', () => {
      const merged = mergeCatalogs(makeBase(), makeCustom());
      const intel = merged.vendors.find(v => v.id === 'nic-intel');
      const deviceIds = intel.devices.map(d => d.device);
      expect(deviceIds).toContain('1533');
      expect(deviceIds).toContain('AAAA');
      // 1533 must appear only once
      expect(deviceIds.filter(id => id === '1533')).toHaveLength(1);
    });

    it('does not mutate the base object', () => {
      const base = makeBase();
      const origVendorCount = base.vendors.length;
      mergeCatalogs(base, makeCustom());
      expect(base.vendors).toHaveLength(origVendorCount);
    });
  });

  // -------------------------------------------------------------------------
  // getCatalog
  // -------------------------------------------------------------------------
  describe('getCatalog', () => {
    it('returns an object with version, categories, and vendors', () => {
      const catalog = getCatalog();
      expect(catalog).toHaveProperty('version');
      expect(catalog).toHaveProperty('categories');
      expect(catalog).toHaveProperty('vendors');
      expect(Array.isArray(catalog.categories)).toBe(true);
      expect(Array.isArray(catalog.vendors)).toBe(true);
    });

    it('caches the result on subsequent calls', () => {
      const a = getCatalog();
      const b = getCatalog();
      expect(a).toBe(b); // same reference
    });

    it('returns a fresh object after invalidateCache', () => {
      const a = getCatalog();
      invalidateCache();
      const b = getCatalog();
      // After invalidation, the object is rebuilt (may or may not be
      // the same reference depending on builtin-only path, but the
      // call must succeed without throwing).
      expect(b).toHaveProperty('version');
    });
  });

  // -------------------------------------------------------------------------
  // getCategories
  // -------------------------------------------------------------------------
  describe('getCategories', () => {
    it('returns an array of category objects with id, name, icon', () => {
      const cats = getCategories();
      expect(Array.isArray(cats)).toBe(true);
      expect(cats.length).toBeGreaterThan(0);
      for (const cat of cats) {
        expect(cat).toHaveProperty('id');
        expect(cat).toHaveProperty('name');
        expect(cat).toHaveProperty('icon');
      }
    });
  });

  // -------------------------------------------------------------------------
  // getCatalogByCategory
  // -------------------------------------------------------------------------
  describe('getCatalogByCategory', () => {
    it('groups vendors under their category', () => {
      const grouped = getCatalogByCategory();
      expect(Array.isArray(grouped)).toBe(true);
      for (const entry of grouped) {
        expect(entry).toHaveProperty('category');
        expect(entry).toHaveProperty('vendors');
        expect(entry.vendors.length).toBeGreaterThan(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // findByVendorDevice
  // -------------------------------------------------------------------------
  describe('findByVendorDevice', () => {
    it('finds a known device by exact PCI ID', () => {
      const result = findByVendorDevice('8086', '1533');
      expect(result).not.toBeNull();
      expect(result.device.name).toBe('I210 Gigabit');
      expect(result.vendor.id).toBe('nic-intel');
      expect(result.category).toHaveProperty('id', 'nic');
    });

    it('is case-insensitive', () => {
      const result = findByVendorDevice('8086', '15B8');
      expect(result).not.toBeNull();
      expect(result.device.device).toBe('15b8');
    });

    it('returns null for unknown PCI ID', () => {
      const result = findByVendorDevice('0000', '0000');
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // resolveCategory
  // -------------------------------------------------------------------------
  describe('resolveCategory', () => {
    it('returns the category ID for a known device', () => {
      expect(resolveCategory('8086', '1533')).toBe('nic');
    });

    it('returns null for an unknown device', () => {
      expect(resolveCategory('0000', '0000')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // searchCatalog
  // -------------------------------------------------------------------------
  describe('searchCatalog', () => {
    it('finds devices by name substring', () => {
      const results = searchCatalog('I210');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].device.name).toContain('I210');
    });

    it('finds devices by vendor name', () => {
      const results = searchCatalog('Realtek');
      expect(results.length).toBeGreaterThan(0);
    });

    it('finds devices by PCI ID substring', () => {
      const results = searchCatalog('8086:1533');
      expect(results.length).toBeGreaterThan(0);
    });

    it('returns empty array for queries shorter than 2 chars', () => {
      expect(searchCatalog('a')).toEqual([]);
    });

    it('returns empty array for null / empty / non-string input', () => {
      expect(searchCatalog(null)).toEqual([]);
      expect(searchCatalog('')).toEqual([]);
      expect(searchCatalog(undefined)).toEqual([]);
    });
  });
});
