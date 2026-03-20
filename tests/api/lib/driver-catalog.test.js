/**
 * LINBO Docker - Driver Catalog Tests
 */

const path = require('path');

// Set custom catalog path to non-existent to use built-in only
process.env.DRIVER_CATALOG_CUSTOM = path.join(__dirname, 'nonexistent-catalog.json');

const {
  getCatalog, getCategories, getCatalogByCategory,
  findByVendorDevice, resolveCategory, searchCatalog,
  mergeCatalogs, invalidateCache,
} = require('../../src/lib/driver-catalog');

describe('driver-catalog', () => {
  beforeEach(() => {
    invalidateCache();
  });

  describe('getCatalog()', () => {
    test('returns catalog with categories and vendors', () => {
      const catalog = getCatalog();
      expect(catalog.version).toBe(1);
      expect(catalog.categories.length).toBeGreaterThanOrEqual(8);
      expect(catalog.vendors.length).toBeGreaterThanOrEqual(10);
    });

    test('caches result on second call', () => {
      const first = getCatalog();
      const second = getCatalog();
      expect(first).toBe(second); // Same reference = cached
    });
  });

  describe('getCategories()', () => {
    test('returns all categories', () => {
      const cats = getCategories();
      const ids = cats.map(c => c.id);
      expect(ids).toContain('nic');
      expect(ids).toContain('gpu');
      expect(ids).toContain('audio');
      expect(ids).toContain('wifi');
      expect(ids).toContain('usb');
      expect(ids).toContain('bluetooth');
    });

    test('categories have required fields', () => {
      for (const cat of getCategories()) {
        expect(cat.id).toBeTruthy();
        expect(cat.name).toBeTruthy();
        expect(cat.icon).toBeTruthy();
      }
    });
  });

  describe('getCatalogByCategory()', () => {
    test('groups vendors by category', () => {
      const grouped = getCatalogByCategory();
      expect(grouped.length).toBeGreaterThan(0);

      for (const entry of grouped) {
        expect(entry.category).toBeDefined();
        expect(entry.category.id).toBeTruthy();
        expect(entry.vendors.length).toBeGreaterThan(0);
      }
    });

    test('nic category has Intel and Realtek', () => {
      const grouped = getCatalogByCategory();
      const nic = grouped.find(g => g.category.id === 'nic');
      expect(nic).toBeDefined();
      const vendorNames = nic.vendors.map(v => v.name);
      expect(vendorNames).toContain('Intel Ethernet');
      expect(vendorNames).toContain('Realtek Ethernet');
    });
  });

  describe('findByVendorDevice()', () => {
    test('finds Intel I219-LM by PCI ID', () => {
      const result = findByVendorDevice('8086', '15bb');
      expect(result).not.toBeNull();
      expect(result.device.name).toContain('I219-LM');
      expect(result.vendor.name).toBe('Intel Ethernet');
      expect(result.category.id).toBe('nic');
    });

    test('finds Realtek RTL8168', () => {
      const result = findByVendorDevice('10ec', '8168');
      expect(result).not.toBeNull();
      expect(result.device.name).toContain('RTL8111');
    });

    test('handles case-insensitive IDs', () => {
      const result = findByVendorDevice('8086', '15BB');
      expect(result).not.toBeNull();
    });

    test('returns null for unknown device', () => {
      expect(findByVendorDevice('ffff', 'ffff')).toBeNull();
    });
  });

  describe('resolveCategory()', () => {
    test('resolves NIC category', () => {
      expect(resolveCategory('8086', '15bb')).toBe('nic');
    });

    test('resolves GPU category', () => {
      expect(resolveCategory('8086', '3e92')).toBe('gpu');
    });

    test('returns null for unknown', () => {
      expect(resolveCategory('ffff', 'ffff')).toBeNull();
    });
  });

  describe('searchCatalog()', () => {
    test('finds Intel devices', () => {
      const results = searchCatalog('Intel');
      expect(results.length).toBeGreaterThan(5);
    });

    test('finds device by PCI ID', () => {
      const results = searchCatalog('8086:15bb');
      expect(results.length).toBe(1);
      expect(results[0].device.name).toContain('I219-LM');
    });

    test('finds by device name', () => {
      const results = searchCatalog('RTL8111');
      expect(results.length).toBeGreaterThan(0);
    });

    test('returns empty for short query', () => {
      expect(searchCatalog('a')).toEqual([]);
    });

    test('returns empty for null', () => {
      expect(searchCatalog(null)).toEqual([]);
    });
  });

  describe('mergeCatalogs()', () => {
    test('merges new vendors', () => {
      const base = {
        version: 1,
        categories: [{ id: 'nic', name: 'NIC', icon: 'cable' }],
        vendors: [{ id: 'v1', name: 'V1', category: 'nic', devices: [] }],
      };
      const custom = {
        version: 2,
        vendors: [{ id: 'v2', name: 'V2', category: 'nic', devices: [] }],
      };

      const merged = mergeCatalogs(base, custom);
      expect(merged.vendors).toHaveLength(2);
      expect(merged.version).toBe(2);
    });

    test('extends existing vendor with new devices', () => {
      const base = {
        version: 1,
        categories: [{ id: 'nic', name: 'NIC', icon: 'cable' }],
        vendors: [{
          id: 'v1', name: 'V1', category: 'nic',
          devices: [{ vendor: '1111', device: 'aaaa', name: 'Dev A' }],
        }],
      };
      const custom = {
        vendors: [{
          id: 'v1', name: 'V1', category: 'nic',
          devices: [
            { vendor: '1111', device: 'aaaa', name: 'Dev A' }, // duplicate
            { vendor: '1111', device: 'bbbb', name: 'Dev B' }, // new
          ],
        }],
      };

      const merged = mergeCatalogs(base, custom);
      expect(merged.vendors).toHaveLength(1);
      expect(merged.vendors[0].devices).toHaveLength(2);
    });

    test('adds new categories', () => {
      const base = {
        version: 1,
        categories: [{ id: 'nic', name: 'NIC', icon: 'cable' }],
        vendors: [],
      };
      const custom = {
        categories: [
          { id: 'nic', name: 'NIC', icon: 'cable' }, // dup
          { id: 'custom', name: 'Custom', icon: 'star' }, // new
        ],
      };

      const merged = mergeCatalogs(base, custom);
      expect(merged.categories).toHaveLength(2);
    });
  });
});
