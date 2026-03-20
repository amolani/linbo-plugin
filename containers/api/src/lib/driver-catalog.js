/**
 * LINBO Docker - Driver Catalog
 * Loads curated PCI/USB device database + optional custom overlay
 * Provides search and lookup functions for the API and UI
 */

const fs = require('fs');
const path = require('path');

// Load built-in catalog
const builtinCatalog = require('../data/driver-catalog.json');

// Custom catalog path (optional overlay per environment)
const CUSTOM_CATALOG_PATH = process.env.DRIVER_CATALOG_CUSTOM
  || '/etc/linuxmuster/linbo/driver-catalog-custom.json';

let _mergedCatalog = null;

/**
 * Merge a custom catalog on top of the built-in one
 * Custom vendors are appended, custom categories extend existing
 * @param {object} base - Built-in catalog
 * @param {object} custom - Custom overlay
 * @returns {object} Merged catalog
 */
function mergeCatalogs(base, custom) {
  const merged = {
    version: custom.version || base.version,
    categories: [...base.categories],
    vendors: [...base.vendors],
  };

  // Merge categories (add new, don't duplicate)
  if (Array.isArray(custom.categories)) {
    const existingIds = new Set(merged.categories.map(c => c.id));
    for (const cat of custom.categories) {
      if (!existingIds.has(cat.id)) {
        merged.categories.push(cat);
        existingIds.add(cat.id);
      }
    }
  }

  // Merge vendors (add new, extend existing by ID)
  if (Array.isArray(custom.vendors)) {
    const vendorMap = new Map(merged.vendors.map(v => [v.id, v]));
    for (const vendor of custom.vendors) {
      if (vendorMap.has(vendor.id)) {
        // Extend existing vendor with new devices
        const existing = vendorMap.get(vendor.id);
        const existingDevices = new Set(
          existing.devices.map(d => `${d.vendor}:${d.device}`)
        );
        for (const dev of vendor.devices || []) {
          if (!existingDevices.has(`${dev.vendor}:${dev.device}`)) {
            existing.devices.push(dev);
          }
        }
      } else {
        merged.vendors.push(vendor);
        vendorMap.set(vendor.id, vendor);
      }
    }
  }

  return merged;
}

/**
 * Get the merged catalog (built-in + custom overlay)
 * Caches result after first load
 * @returns {object} Full catalog
 */
function getCatalog() {
  if (_mergedCatalog) return _mergedCatalog;

  try {
    if (fs.existsSync(CUSTOM_CATALOG_PATH)) {
      const customRaw = fs.readFileSync(CUSTOM_CATALOG_PATH, 'utf-8');
      const custom = JSON.parse(customRaw);
      _mergedCatalog = mergeCatalogs(builtinCatalog, custom);
    } else {
      _mergedCatalog = builtinCatalog;
    }
  } catch {
    // Custom catalog invalid — fall back to built-in
    _mergedCatalog = builtinCatalog;
  }

  return _mergedCatalog;
}

/**
 * Invalidate cached catalog (call after custom catalog changes)
 */
function invalidateCache() {
  _mergedCatalog = null;
}

/**
 * Get categories list
 * @returns {Array<{id: string, name: string, icon: string}>}
 */
function getCategories() {
  return getCatalog().categories;
}

/**
 * Get catalog grouped by category
 * @returns {Array<{category: object, vendors: Array}>}
 */
function getCatalogByCategory() {
  const catalog = getCatalog();
  const categoryMap = new Map(catalog.categories.map(c => [c.id, { category: c, vendors: [] }]));

  for (const vendor of catalog.vendors) {
    const entry = categoryMap.get(vendor.category);
    if (entry) {
      entry.vendors.push(vendor);
    }
  }

  return Array.from(categoryMap.values()).filter(e => e.vendors.length > 0);
}

/**
 * Find a device by vendor:device PCI/USB ID
 * @param {string} vendorId - 4-char hex vendor ID
 * @param {string} deviceId - 4-char hex device ID
 * @returns {object|null} { vendor (catalog entry), device (device entry), category } or null
 */
function findByVendorDevice(vendorId, deviceId) {
  const v = vendorId.toLowerCase();
  const d = deviceId.toLowerCase();

  for (const vendor of getCatalog().vendors) {
    for (const dev of vendor.devices) {
      if (dev.vendor.toLowerCase() === v && dev.device.toLowerCase() === d) {
        const cat = getCatalog().categories.find(c => c.id === vendor.category);
        return { vendor, device: dev, category: cat || null };
      }
    }
  }

  return null;
}

/**
 * Resolve the category for a vendor:device pair
 * @param {string} vendorId
 * @param {string} deviceId
 * @returns {string|null} Category ID or null
 */
function resolveCategory(vendorId, deviceId) {
  const result = findByVendorDevice(vendorId, deviceId);
  return result ? result.vendor.category : null;
}

/**
 * Search catalog by query string (matches device name, vendor name, or PCI ID)
 * @param {string} query
 * @returns {Array<{vendor: object, device: object, category: object}>}
 */
function searchCatalog(query) {
  if (!query || typeof query !== 'string') return [];
  const q = query.toLowerCase().trim();
  if (q.length < 2) return [];

  const results = [];

  for (const vendor of getCatalog().vendors) {
    for (const dev of vendor.devices) {
      const matchFields = [
        dev.name,
        vendor.name,
        `${dev.vendor}:${dev.device}`,
        dev.suggestedSet || '',
      ].join(' ').toLowerCase();

      if (matchFields.includes(q)) {
        const cat = getCatalog().categories.find(c => c.id === vendor.category);
        results.push({ vendor, device: dev, category: cat || null });
      }
    }
  }

  return results;
}

module.exports = {
  getCatalog,
  getCategories,
  getCatalogByCategory,
  findByVendorDevice,
  resolveCategory,
  searchCatalog,
  mergeCatalogs,
  invalidateCache,
};
