'use strict';

/**
 * LINBO Native - Devices CSV Reader
 *
 * Reads host entries from /etc/linuxmuster/sophomorix/default-school/devices.csv
 * Format: room;hostname;hostgroup;mac;ip;...
 *
 * Returns [] on ENOENT (file not yet available). Re-throws other errors.
 */

const fsp = require('fs/promises');

const DEFAULT_CSV_PATH = process.env.DEVICES_CSV
  || '/etc/linuxmuster/sophomorix/default-school/devices.csv';

/**
 * Read and parse hosts from the devices.csv file.
 *
 * @param {string} [csvPath] - Path to devices.csv (defaults to DEVICES_CSV env or standard path)
 * @returns {Promise<Array<{room: string, hostname: string, hostgroup: string, mac: string, ip: string}>>}
 */
async function readHostsFromDevicesCsv(csvPath = DEFAULT_CSV_PATH) {
  let content;
  try {
    content = await fsp.readFile(csvPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const lines = content.split('\n');
  const hosts = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    // Skip empty lines and comments
    if (!line || !(/^[a-zA-Z0-9]/.test(line))) continue;

    const cols = line.split(';');
    const room = (cols[0] || '').trim();
    const hostname = (cols[1] || '').trim();
    const hostgroup = (cols[2] || '').trim();
    const mac = (cols[3] || '').trim().toLowerCase();
    const ip = (cols[4] || '').trim();

    // Filter out rows missing required fields
    if (!hostname || !mac) continue;

    hosts.push({ room, hostname, hostgroup, mac, ip });
  }

  return hosts;
}

module.exports = { readHostsFromDevicesCsv };
