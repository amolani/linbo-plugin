/**
 * LINBO Plugin - GRUB Config Generator (DB-free)
 *
 * Generates GRUB configuration files from data objects (HostRecord[], ConfigRecord[])
 * fetched from the LMN API. Does NOT access Prisma/PostgreSQL.
 *
 * Output files:
 *   /srv/linbo/boot/grub/grub.cfg                     — main PXE config
 *   /srv/linbo/boot/grub/{group}.cfg                   — per-config OS menu
 *   /srv/linbo/boot/grub/hostcfg/{hostname}.cfg        — symlink → ../{group}.cfg
 *   /srv/linbo/boot/grub/hostcfg/01-{mac}.cfg          — MAC-fallback symlink
 */

const fs = require('fs').promises;
const path = require('path');
const redis = require('../lib/redis');
const { atomicWrite } = require('../lib/atomic-write');
const { forceSymlink, safeUnlink } = require('../lib/atomic-write');

const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';
const GRUB_DIR = path.join(LINBO_DIR, 'boot/grub');
const HOSTCFG_DIR = path.join(GRUB_DIR, 'hostcfg');
const TEMPLATES_DIR = path.join(__dirname, '../templates/grub');

// =============================================================================
// Pure Helper Functions (ported from grub.service.js — no DB access)
// =============================================================================

/** Case-insensitive lookup for linboSettings object */
function getLinboSetting(settings, key) {
  if (!settings) return undefined;
  if (settings[key] !== undefined) return settings[key];
  const lowerKey = key.toLowerCase();
  if (settings[lowerKey] !== undefined) return settings[lowerKey];
  for (const k of Object.keys(settings)) {
    if (k.toLowerCase() === lowerKey) return settings[k];
  }
  return undefined;
}

/**
 * Convert Linux device path to GRUB partition format.
 * /dev/sda1 → (hd0,1), /dev/nvme0n1p2 → (hd0,2)
 */
function getGrubPart(device) {
  if (!device) return '(hd0,1)';
  const dev = device.replace('/dev/', '');

  const nvmeMatch = dev.match(/^nvme(\d+)n\d+p(\d+)$/);
  if (nvmeMatch) return `(hd${nvmeMatch[1]},${nvmeMatch[2]})`;

  const mmcMatch = dev.match(/^mmcblk(\d+)p(\d+)$/);
  if (mmcMatch) return `(hd${mmcMatch[1]},${mmcMatch[2]})`;

  const sdMatch = dev.match(/^([shv]d)([a-z])(\d+)$/);
  if (sdMatch) {
    const diskNum = sdMatch[2].charCodeAt(0) - 'a'.charCodeAt(0);
    return `(hd${diskNum},${sdMatch[3]})`;
  }

  // Uniform block device: /dev/disk0p2 → (hd0,2)
  const diskMatch = dev.match(/^disk(\d+)p(\d+)$/);
  if (diskMatch) {
    const part = parseInt(diskMatch[2], 10);
    if (part >= 1) return `(hd${diskMatch[1]},${diskMatch[2]})`;
  }

  return '(hd0,1)';
}

/** Get GRUB OS type from OS name for menu icon classes */
function getGrubOstype(osname) {
  if (!osname) return 'unknown';
  const name = osname.toLowerCase();
  if (name.includes('windows 11') || name.includes('win11')) return 'win11';
  if (name.includes('windows 10') || name.includes('win10')) return 'win10';
  if (name.includes('windows 8') || name.includes('win8')) return 'win8';
  if (name.includes('windows 7') || name.includes('win7')) return 'win7';
  if (name.includes('windows')) return 'windows';
  if (name.includes('ubuntu')) return 'ubuntu';
  if (name.includes('debian')) return 'debian';
  if (name.includes('mint')) return 'linuxmint';
  if (name.includes('fedora')) return 'fedora';
  if (name.includes('opensuse') || name.includes('suse')) return 'opensuse';
  if (name.includes('arch')) return 'arch';
  if (name.includes('manjaro')) return 'manjaro';
  if (name.includes('centos')) return 'centos';
  if (name.includes('rhel') || name.includes('red hat')) return 'rhel';
  if (name.includes('linux')) return 'linux';
  return 'unknown';
}

/** Find cache partition from partition list */
function findCachePartition(partitions) {
  if (!partitions || !Array.isArray(partitions)) return null;
  const byLabel = partitions.find(p => p.label && p.label.toLowerCase() === 'cache');
  if (byLabel) return byLabel;
  return partitions.find(p =>
    (p.fsType === 'ext4' || p.fsType === 'btrfs') &&
    p.partitionId !== 'ef00' && p.partitionId !== '0c01' &&
    !p.label?.toLowerCase().includes('windows') &&
    !p.label?.toLowerCase().includes('efi')
  ) || null;
}

/** Find the partition index for an OS's root device */
function getOsPartitionIndex(partitions, rootDevice) {
  if (!partitions || !Array.isArray(partitions) || !rootDevice) return 1;
  const index = partitions.findIndex(p => p.device === rootDevice);
  return index >= 0 ? index + 1 : 1;
}

/** Convert hex color to GRUB RGB */
function hexToGrubRgb(hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return '42,68,87';
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',');
}

/** Get OS label from partition list */
function getOsLabel(partitions, rootDevice) {
  if (!partitions || !rootDevice) return '';
  const partition = partitions.find(p => p.device === rootDevice);
  return partition?.label || '';
}

/** Load a GRUB template file */
async function loadTemplate(templateName) {
  const filepath = path.join(TEMPLATES_DIR, templateName);
  return fs.readFile(filepath, 'utf8');
}

/** Apply template replacements: @@key@@ → value */
function applyTemplate(template, replacements) {
  let result = template;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.split(`@@${key}@@`).join(value ?? '');
  }
  return result;
}

/**
 * Convert MAC to GRUB hostcfg filename format.
 * AA:BB:CC:DD:EE:FF → 01-aa-bb-cc-dd-ee-ff
 */
function macToGrubFilename(mac) {
  return '01-' + mac.toLowerCase().replace(/:/g, '-');
}

/**
 * Read KernelOptions from start.conf file for a given config ID.
 * Falls back to 'quiet splash' if file not found or no KernelOptions line.
 */
async function readKernelOptionsFromStartConf(configId) {
  try {
    const startConfPath = path.join(LINBO_DIR, `start.conf.${configId}`);
    const content = await fs.readFile(startConfPath, 'utf8');
    const match = content.match(/^\s*KernelOptions\s*=\s*(.+)$/mi);
    if (match) return match[1].trim();
  } catch {}
  return 'quiet splash';
}

// =============================================================================
// Config Generation — works from data objects, not from DB
// =============================================================================

/**
 * Generate a per-config GRUB file ({group}.cfg) with OS menu entries.
 * @param {object} configRecord - ConfigRecord from LMN API
 * @param {object} options - { server, httpport, bgColor }
 * @returns {Promise<{filepath: string, content: string}>}
 */
async function generateConfigGrub(configRecord, options = {}) {
  const { id: configId, osEntries = [], partitions = [], grubPolicy = {} } = configRecord;
  const server = options.server || process.env.LINBO_SERVER_IP || '10.0.0.1';
  const httpport = options.httpport || process.env.WEB_PORT || '8080';

  // Build kernel options — read from start.conf (synced from LMN server)
  let kernelOptions = options.kernelOptions || await readKernelOptionsFromStartConf(configId);
  const kopts_raw = kernelOptions
    .replace(/\bserver=\S+/g, '')
    .replace(/\bgroup=\S+/g, '')
    .replace(/\bhostgroup=\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const kopts = `${kopts_raw} server=${server} group=${configId} hostgroup=${configId}`.trim();

  // Cache partition
  const cachePartition = findCachePartition(partitions);
  const cacheLabel = cachePartition?.label || '';
  const cacheRoot = cachePartition ? getGrubPart(cachePartition.device) : '(hd0,2)';

  const timeout = String(grubPolicy.timeout ?? 0);

  // Load and fill global template
  const globalTemplate = await loadTemplate('grub.cfg.global');
  let content = applyTemplate(globalTemplate, {
    group: configId,
    timestamp: new Date().toISOString(),
    cachelabel: cacheLabel,
    cacheroot: cacheRoot,
    kopts,
    server,
    httpport,
    timeout,
    bgcolor_rgb: hexToGrubRgb(options.bgColor || '#2a4457'),
  });

  // Load OS template and generate menu entries
  const osTemplate = await loadTemplate('grub.cfg.os');
  for (let i = 0; i < osEntries.length; i++) {
    const os = osEntries[i];
    const osnr = i + 1;
    const effectiveRoot = os.root || os.boot;
    const osLabel = getOsLabel(partitions, effectiveRoot);
    const osRoot = getGrubPart(effectiveRoot);
    const partnr = getOsPartitionIndex(partitions, effectiveRoot);

    content += applyTemplate(osTemplate, {
      group: configId,
      osname: os.name || `OS ${osnr}`,
      ostype: getGrubOstype(os.name),
      oslabel: osLabel,
      osroot: osRoot,
      kernel: os.kernel || '/boot/vmlinuz',
      initrd: os.initrd || '/boot/initrd.img',
      append: os.append || '',
      osnr: String(osnr),
      partnr: String(partnr),
      kopts,
      server,
      httpport,
    });
  }

  // "grub" is reserved for the main PXE grub.cfg — use _grub.cfg for the group config
  const filename = configId === 'grub' ? '_grub.cfg' : `${configId}.cfg`;
  const filepath = path.join(GRUB_DIR, filename);
  await atomicWrite(filepath, content);

  return { filepath, content };
}

/**
 * Generate main grub.cfg with MAC→inline-boot mapping.
 * @param {object[]} hosts - HostRecord[] from LMN API
 * @param {object[]} configs - ConfigRecord[] (for default group fallback)
 * @param {object} options - { server, httpport }
 * @returns {Promise<{filepath: string, content: string}>}
 */
async function generateMainGrub(hosts, configs, options = {}) {
  const _server = options.server || process.env.LINBO_SERVER_IP || '10.0.0.1';
  const _httpport = options.httpport || process.env.WEB_PORT || '8080';

  // Build MAC→group mapping (sets $group variable for configfile fallback)
  let macMapping = '';
  const pxeHosts = hosts.filter(h => h.mac && h.hostgroup && h.pxeEnabled !== false);
  if (pxeHosts.length > 0) {
    const lines = [' # MAC-based group assignment (when DHCP does not provide hostname/group)'];
    lines.push(' if [ -z "$group" -a -n "$net_default_mac" ]; then');
    for (const host of pxeHosts) {
      const macLower = host.mac.toLowerCase();
      const macUpper = host.mac.toUpperCase();
      lines.push(`  if [ "$net_default_mac" = "${macLower}" -o "$net_default_mac" = "${macUpper}" ]; then`);
      lines.push(`   set group="${host.hostgroup}"`);
      lines.push(`  fi`);
    }
    lines.push(' fi');
    macMapping = lines.join('\n');
  }

  const template = await loadTemplate('grub.cfg.pxe');
  const content = applyTemplate(template, {
    timestamp: new Date().toISOString(),
    mac_mapping: macMapping,
  });

  const filepath = path.join(GRUB_DIR, 'grub.cfg');
  await atomicWrite(filepath, content);

  return { filepath, content };
}

/**
 * Regenerate all GRUB configs from data objects.
 * @param {object[]} hosts - HostRecord[] (mac, hostname, ip, hostgroup, pxeEnabled)
 * @param {object[]} configs - ConfigRecord[] (id, osEntries, partitions, grubPolicy)
 * @param {object} options - { server, httpport, changedConfigIds }
 * @returns {Promise<{configs: number, hosts: number, hostcfgMac: number}>}
 */
async function regenerateAll(hosts, configs, options = {}) {
  // Prevent concurrent regeneration
  const client = redis.getClient();
  const lockKey = 'grub:regen:lock';
  const locked = await client.set(lockKey, '1', 'NX', 'EX', 120); // 2 min TTL
  if (!locked) {
    console.warn('[GrubGenerator] Regeneration already in progress, skipping');
    return { configs: 0, hosts: 0, hostcfgMac: 0 };
  }

  try {
  await fs.mkdir(GRUB_DIR, { recursive: true });
  await fs.mkdir(HOSTCFG_DIR, { recursive: true });

  const server = options.server || process.env.LINBO_SERVER_IP || '10.0.0.1';
  const httpport = options.httpport || process.env.WEB_PORT || '8080';
  const changedConfigIds = options.changedConfigIds ? new Set(options.changedConfigIds) : null;

  let configCount = 0;
  let hostCount = 0;
  let hostcfgMacCount = 0;

  // 1) Generate main grub.cfg
  await generateMainGrub(hosts, configs, { server, httpport });

  // 2) Generate per-config {group}.cfg
  for (const config of configs) {
    // Skip unchanged configs if optimization is requested
    if (changedConfigIds && !changedConfigIds.has(config.id)) continue;

    await generateConfigGrub(config, { server, httpport });
    configCount++;
  }

  // 3) Generate host symlinks: hostcfg/{hostname}.cfg + hostcfg/01-{mac}.cfg
  //    Build a set of expected hostcfg filenames for cleanup
  const expectedHostcfgFiles = new Set();

  for (const host of hosts) {
    if (!host.hostgroup) continue;
    // "grub" group config is written as _grub.cfg to avoid overwriting main PXE grub.cfg
    const cfgFile = host.hostgroup === 'grub' ? '_grub.cfg' : `${host.hostgroup}.cfg`;
    const target = `../${cfgFile}`;

    // hostname-based symlink
    if (host.hostname) {
      const hostFile = `${host.hostname}.cfg`;
      expectedHostcfgFiles.add(hostFile);
      await forceSymlink(target, path.join(HOSTCFG_DIR, hostFile));
      hostCount++;
    }

    // MAC-based symlink (GRUB fallback when $net_pxe_hostname is not set)
    if (host.mac) {
      const macFile = `${macToGrubFilename(host.mac)}.cfg`;
      expectedHostcfgFiles.add(macFile);
      await forceSymlink(target, path.join(HOSTCFG_DIR, macFile));
      hostcfgMacCount++;
    }
  }

  // 4) Cleanup stale hostcfg files that no longer belong to any host
  try {
    const existingFiles = await fs.readdir(HOSTCFG_DIR);
    for (const file of existingFiles) {
      if (file.endsWith('.cfg') && !expectedHostcfgFiles.has(file)) {
        await safeUnlink(path.join(HOSTCFG_DIR, file));
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[GrubGenerator] Failed to cleanup hostcfg:', err.message);
    }
  }

  console.log(`[GrubGenerator] Regenerated: ${configCount} configs, ${hostCount} hostname symlinks, ${hostcfgMacCount} MAC symlinks`);

  return { configs: configCount, hosts: hostCount, hostcfgMac: hostcfgMacCount };
  } finally {
    await client.del(lockKey);
  }
}

module.exports = {
  // Main exports
  regenerateAll,
  generateConfigGrub,
  generateMainGrub,

  // Helpers (exported for testing)
  getGrubPart,
  getGrubOstype,
  findCachePartition,
  getOsPartitionIndex,
  hexToGrubRgb,
  getOsLabel,
  getLinboSetting,
  loadTemplate,
  applyTemplate,
  macToGrubFilename,
  readKernelOptionsFromStartConf,
};
