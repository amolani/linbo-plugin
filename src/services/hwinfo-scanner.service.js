/**
 * LINBO Plugin - HWInfo Scanner Service
 *
 * Background hwinfo scanner with Redis cache.
 * Scans LINBO clients via SSH and caches results for instant retrieval.
 *
 * NOT a separate worker process — imported as a service module.
 */

const redis = require('../lib/redis');
const sshService = require('./ssh.service');

const HWINFO_TTL = 604800; // 7 days in seconds
const HWINFO_KEY_PREFIX = 'hwinfo:';
const MAX_CONCURRENT = 30;
const SSH_TIMEOUT = 15000;

/**
 * Build the SSH command string for hwinfo collection.
 * Shared by scanHost() and the GET /hwinfo/:ip route.
 * @returns {string} Combined shell command
 */
function _buildSshCommand() {
  return [
    'echo "===DMI==="',
    'cat /sys/class/dmi/id/sys_vendor 2>/dev/null',
    'echo "---"',
    'cat /sys/class/dmi/id/product_name 2>/dev/null',
    'echo "---"',
    'cat /sys/class/dmi/id/product_serial 2>/dev/null',
    'echo "---"',
    'cat /sys/class/dmi/id/bios_version 2>/dev/null',
    'echo "===CPU==="',
    'grep -m1 "model name" /proc/cpuinfo 2>/dev/null | cut -d: -f2',
    'echo "---"',
    'grep -c ^processor /proc/cpuinfo 2>/dev/null',
    'echo "===RAM==="',
    'grep MemTotal /proc/meminfo 2>/dev/null | awk "{print \\$2}"',
    'echo "===NET==="',
    'ip -o link show 2>/dev/null | awk "{print \\$2, \\$NF}" | grep -v "lo:"',
    'echo "===DISK==="',
    'lsblk -dno NAME,SIZE,MODEL 2>/dev/null || ls /sys/block/ 2>/dev/null',
    'echo "===PCI==="',
    'lspci -mm 2>/dev/null | head -30',
    'echo "===HWINFO==="',
    'hwinfo --short 2>/dev/null | head -60',
  ].join(' && ');
}

/**
 * Parse raw SSH output into structured hwinfo data.
 * Shared by scanHost() and the GET /hwinfo/:ip route.
 * @param {string} output - Raw SSH stdout
 * @param {string} ip - Host IP address
 * @returns {object} Parsed HwinfoData object
 */
function _parseHwinfoOutput(output, ip) {
  const sections = {};
  const sectionNames = ['DMI', 'CPU', 'RAM', 'NET', 'DISK', 'PCI', 'HWINFO'];
  for (const name of sectionNames) {
    const regex = new RegExp(`===${name}===\\n([\\s\\S]*?)(?====\\w|$)`);
    const match = output.match(regex);
    sections[name.toLowerCase()] = match ? match[1].trim() : '';
  }

  const dmiParts = (sections.dmi || '').split('---').map(s => s.trim());
  const cpuParts = (sections.cpu || '').split('---').map(s => s.trim());
  const ramKb = parseInt(sections.ram) || 0;

  return {
    ip,
    timestamp: new Date().toISOString(),
    dmi: {
      vendor: dmiParts[0] || '',
      product: dmiParts[1] || '',
      serial: dmiParts[2] || '',
      biosVersion: dmiParts[3] || '',
    },
    cpu: {
      model: (cpuParts[0] || '').trim(),
      cores: parseInt(cpuParts[1]) || 0,
    },
    ram: {
      totalKb: ramKb,
      totalMb: Math.round(ramKb / 1024),
      totalGb: Math.round(ramKb / 1024 / 1024 * 10) / 10,
    },
    network: sections.net || '',
    disks: sections.disk || '',
    pci: sections.pci || '',
    hwinfo: sections.hwinfo || '',
    raw: output,
  };
}

/**
 * Scan a single host via SSH and cache the result in Redis.
 * @param {string} ip - Host IP address
 * @param {string} mac - Host MAC address (used as cache key)
 * @returns {object|null} Parsed hwinfo data, or null on failure
 */
async function scanHost(ip, mac) {
  try {
    const cmd = _buildSshCommand();
    const result = await sshService.executeCommand(ip, cmd, { timeout: SSH_TIMEOUT });
    const output = result.stdout || result.output || '';

    const parsed = _parseHwinfoOutput(output, ip);

    await redis.set(HWINFO_KEY_PREFIX + mac, parsed, HWINFO_TTL);

    return parsed;
  } catch (err) {
    console.warn(`[HwinfoScanner] Failed to scan ${ip}: ${err.message}`);
    return null;
  }
}

/**
 * Scan all online hosts that have no cached hwinfo (delta-scan).
 * Processes in batches of MAX_CONCURRENT.
 * @returns {{ scanned: number, skipped: number, failed: number }}
 */
async function scanAllOnline() {
  const client = redis.getClient();
  if (!client || client.status !== 'ready') {
    console.warn('[HwinfoScanner] Redis not ready, aborting scan');
    return { scanned: 0, skipped: 0, failed: 0 };
  }

  // Load all synced hosts
  const macs = await client.smembers('sync:host:index');
  if (!macs || macs.length === 0) {
    return { scanned: 0, skipped: 0, failed: 0 };
  }

  const hosts = [];
  for (const mac of macs) {
    const json = await client.get(`sync:host:${mac}`);
    if (json) {
      const h = JSON.parse(json);
      if (h.ip) hosts.push(h);
    }
  }

  const total = hosts.length;

  // Collect uncached hosts
  const uncached = [];
  for (const host of hosts) {
    const exists = await client.exists(HWINFO_KEY_PREFIX + host.mac);
    if (!exists) {
      uncached.push(host);
    }
  }

  const skipped = total - uncached.length;

  // Filter to online hosts only
  const onlineUncached = [];
  for (const host of uncached) {
    const status = await client.hget(`host:status:${host.ip}`, 'status');
    if (status === 'online') {
      onlineUncached.push(host);
    }
  }

  console.log(`[HwinfoScanner] Scan started: ${onlineUncached.length} uncached online of ${total} hosts (${skipped} already cached)`);

  let success = 0;
  let failed = 0;

  // Process in batches
  for (let i = 0; i < onlineUncached.length; i += MAX_CONCURRENT) {
    const batch = onlineUncached.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.all(
      batch.map(async (host) => {
        const result = await scanHost(host.ip, host.mac);
        return result !== null;
      })
    );

    for (const ok of results) {
      if (ok) success++;
      else failed++;
    }
  }

  console.log(`[HwinfoScanner] Scan complete: ${success} scanned, ${failed} failed`);

  return { scanned: success, skipped, failed };
}

module.exports = {
  scanHost,
  scanAllOnline,
  _buildSshCommand,
  _parseHwinfoOutput,
  HWINFO_TTL,
  HWINFO_KEY_PREFIX,
};
