/**
 * LINBO Docker - Firmware Catalog
 * Static vendor catalog with prefix expansion, .zst transparency, and availability cache
 */

const fs = require('fs').promises;
const path = require('path');

const FIRMWARE_BASE = process.env.FIRMWARE_BASE || '/lib/firmware';

// =============================================================================
// Static Catalog
// =============================================================================

const FIRMWARE_CATALOG = [
  {
    id: 'wifi-intel',
    name: 'Intel WiFi',
    category: 'wifi',
    description: 'Intel Wireless (AX200, AX201, AX210, BE200, aeltere N/AC)',
    entries: [
      {
        path: 'iwlwifi',
        type: 'prefix',
        pattern: /^iwlwifi-.*\.(ucode|pnvm)$/,
        description: 'Intel WiFi Firmware-Dateien',
      },
    ],
  },
  {
    id: 'wifi-atheros',
    name: 'Qualcomm/Atheros WiFi',
    category: 'wifi',
    description: 'Atheros 802.11ac/ax (QCA6174, QCA9984, WCN785x)',
    entries: [
      { path: 'ath10k', type: 'dir', description: '802.11ac (aeltere Chips)' },
      { path: 'ath11k', type: 'dir', description: '802.11ax (WiFi 6)' },
      { path: 'ath12k', type: 'dir', description: '802.11be (WiFi 7, neu)' },
    ],
  },
  {
    id: 'wifi-realtek',
    name: 'Realtek WiFi',
    category: 'wifi',
    description: 'Realtek Wireless (RTL8821, RTL8822, RTL8852)',
    entries: [
      { path: 'rtlwifi', type: 'dir', description: 'Aeltere Realtek WiFi' },
      { path: 'rtw88', type: 'dir', description: 'WiFi 5 (RTL8822/8723)' },
      { path: 'rtw89', type: 'dir', description: 'WiFi 6 (RTL8852)' },
    ],
  },
  {
    id: 'wifi-broadcom',
    name: 'Broadcom WiFi',
    category: 'wifi',
    description: 'Broadcom/Cypress Wireless (BCM43xx)',
    entries: [
      { path: 'brcm', type: 'dir', description: 'Broadcom WiFi + Bluetooth' },
      { path: 'cypress', type: 'dir', description: 'Cypress (ex-Broadcom IoT)' },
    ],
  },
  {
    id: 'wifi-mediatek',
    name: 'MediaTek WiFi',
    category: 'wifi',
    description: 'MediaTek Wireless (MT7921, MT7922, MT7961)',
    entries: [
      { path: 'mediatek', type: 'dir', description: 'MediaTek WiFi/BT Firmware' },
    ],
  },
  {
    id: 'nic-realtek',
    name: 'Realtek Ethernet',
    category: 'ethernet',
    description: 'Realtek Gigabit/2.5G Ethernet (RTL8111, RTL8125, RTL8126)',
    entries: [
      { path: 'rtl_nic', type: 'dir', description: 'Alle Realtek NIC Firmware' },
    ],
  },
  {
    id: 'nic-intel',
    name: 'Intel Ethernet',
    category: 'ethernet',
    description: 'Intel Gigabit/10G Ethernet (e1000, i350, X710)',
    entries: [
      { path: 'intel', type: 'dir', description: 'Intel NIC Firmware' },
      { path: 'e100', type: 'dir', description: 'Intel e100 (Legacy)' },
    ],
  },
  {
    id: 'nic-broadcom',
    name: 'Broadcom Ethernet',
    category: 'ethernet',
    description: 'Broadcom NetXtreme (bnx2, bnx2x)',
    entries: [
      { path: 'bnx2', type: 'dir', description: 'NetXtreme I' },
      { path: 'bnx2x', type: 'dir', description: 'NetXtreme II/III' },
    ],
  },
  {
    id: 'gpu-amd',
    name: 'AMD GPU',
    category: 'gpu',
    description: 'AMD Radeon (RX 5000/6000/7000, APU)',
    entries: [
      { path: 'amdgpu', type: 'dir', description: 'AMDGPU (modern, RDNA/CDNA)' },
      { path: 'radeon', type: 'dir', description: 'Radeon (Legacy, pre-GCN)' },
    ],
  },
  {
    id: 'gpu-intel',
    name: 'Intel GPU',
    category: 'gpu',
    description: 'Intel iGPU (HD Graphics, Iris, Arc)',
    entries: [
      { path: 'i915', type: 'dir', description: 'Intel HD/Iris/UHD Graphics' },
      { path: 'xe', type: 'dir', description: 'Intel Arc (Xe, neu)' },
    ],
  },
  {
    id: 'gpu-nvidia',
    name: 'NVIDIA GPU',
    category: 'gpu',
    description: 'NVIDIA GeForce/Quadro Open-Source Firmware',
    entries: [
      { path: 'nvidia', type: 'dir', description: 'NVIDIA GSP Firmware' },
    ],
  },
  {
    id: 'bt-realtek',
    name: 'Realtek Bluetooth',
    category: 'bluetooth',
    description: 'Realtek Bluetooth (RTL8761, RTL8821)',
    entries: [
      { path: 'rtl_bt', type: 'dir', description: 'Realtek Bluetooth Firmware' },
    ],
  },
];

const CATEGORIES = [
  { id: 'wifi', name: 'WLAN', icon: 'wifi' },
  { id: 'ethernet', name: 'Ethernet', icon: 'cable' },
  { id: 'gpu', name: 'GPU', icon: 'monitor' },
  { id: 'bluetooth', name: 'Bluetooth', icon: 'bluetooth' },
];

// =============================================================================
// Availability Cache
// =============================================================================

let _catalogCache = null;
let _catalogCacheTime = 0;
const CATALOG_CACHE_TTL = 5 * 60 * 1000; // 5 min

function invalidateCatalogCache() {
  _catalogCache = null;
  _catalogCacheTime = 0;
}

// =============================================================================
// Prefix Expansion with .zst Transparency
// =============================================================================

/**
 * Expand a prefix entry by scanning /lib/firmware for matching files.
 * .zst suffixes are transparently stripped — result always contains base names.
 * @param {object} entry - Catalog entry with type: 'prefix'
 * @returns {Promise<string[]>} Sorted array of base-name firmware files
 */
async function expandPrefixEntry(entry) {
  try {
    const files = await fs.readdir(FIRMWARE_BASE);
    const baseNames = new Set();
    for (const f of files) {
      const base = f.endsWith('.zst') ? f.slice(0, -4) : f;
      if (entry.pattern.test(base)) {
        baseNames.add(base);
      }
    }
    return [...baseNames].sort();
  } catch {
    return [];
  }
}

// =============================================================================
// Availability Check
// =============================================================================

/**
 * Check if a firmware path exists on disk (with .zst fallback)
 * @param {string} fwPath - Relative path under /lib/firmware
 * @returns {Promise<boolean>}
 */
async function checkAvailability(fwPath) {
  const full = path.join(FIRMWARE_BASE, fwPath);
  try {
    await fs.access(full);
    return true;
  } catch {
    try {
      await fs.access(full + '.zst');
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Build availability data for all catalog entries (expensive, cached)
 * @returns {Promise<Map>} Map of entry path → { available, expandedFiles? }
 */
async function buildCatalogAvailability() {
  const result = new Map();

  for (const vendor of FIRMWARE_CATALOG) {
    for (const entry of vendor.entries) {
      if (entry.type === 'prefix') {
        const expandedFiles = await expandPrefixEntry(entry);
        result.set(entry.path, {
          available: expandedFiles.length > 0,
          expandedFiles,
        });
      } else {
        const available = await checkAvailability(entry.path);
        result.set(entry.path, { available });
      }
    }
  }

  return result;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get the firmware catalog with availability and configuration status.
 * @param {string[]} configEntries - Currently configured firmware entries
 * @param {boolean} expand - If true, include expandedFiles for prefix entries
 * @returns {Promise<object[]>} Array of categories with vendors and entries
 */
async function getCatalogWithAvailability(configEntries, expand = false) {
  const now = Date.now();
  if (!_catalogCache || (now - _catalogCacheTime) >= CATALOG_CACHE_TTL) {
    _catalogCache = await buildCatalogAvailability();
    _catalogCacheTime = now;
  }

  const configSet = new Set(configEntries);

  return CATEGORIES.map(cat => {
    const vendors = FIRMWARE_CATALOG
      .filter(v => v.category === cat.id)
      .map(vendor => {
        let vendorConfiguredCount = 0;
        let vendorTotalCount = 0;

        const entries = vendor.entries.map(entry => {
          const avail = _catalogCache.get(entry.path) || { available: false };

          if (entry.type === 'prefix') {
            const expandedFiles = avail.expandedFiles || [];
            const configuredFiles = expandedFiles.filter(f => configSet.has(f));
            vendorConfiguredCount += configuredFiles.length;
            vendorTotalCount += expandedFiles.length;

            const result = {
              path: entry.path,
              type: entry.type,
              description: entry.description,
              available: avail.available,
              configured: false,
              configuredCount: configuredFiles.length,
              totalCount: expandedFiles.length,
            };
            if (expand) {
              result.expandedFiles = expandedFiles;
              result.configuredFiles = configuredFiles;
            }
            return result;
          } else {
            // type: 'dir'
            const configured = configSet.has(entry.path);
            vendorConfiguredCount += configured ? 1 : 0;
            vendorTotalCount += 1;

            return {
              path: entry.path,
              type: entry.type,
              description: entry.description,
              available: avail.available,
              configured,
              configuredCount: configured ? 1 : 0,
              totalCount: 1,
            };
          }
        });

        return {
          id: vendor.id,
          name: vendor.name,
          category: vendor.category,
          description: vendor.description,
          entries,
          configuredCount: vendorConfiguredCount,
          totalCount: vendorTotalCount,
        };
      });

    return {
      id: cat.id,
      name: cat.name,
      icon: cat.icon,
      vendors,
    };
  });
}

module.exports = {
  FIRMWARE_CATALOG,
  CATEGORIES,
  FIRMWARE_BASE,
  expandPrefixEntry,
  checkAvailability,
  getCatalogWithAvailability,
  invalidateCatalogCache,
  // Exposed for testing
  _getCache: () => _catalogCache,
  _getCacheTime: () => _catalogCacheTime,
};
