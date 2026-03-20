/**
 * LINBO Docker - Wake-on-LAN Service
 * Send magic packets to wake up hosts
 *
 * Dual-path WoL:
 *   1. Networkbox API (POST /wake) when NETWORKBOX_HOST is configured
 *   2. Direct UDP broadcast fallback (with configurable WOL_BROADCAST_ADDRESS)
 */

const dgram = require('dgram');
const http = require('http');

/**
 * Create Wake-on-LAN magic packet
 * @param {string} macAddress - MAC address (XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX)
 * @returns {Buffer} Magic packet buffer
 */
function createMagicPacket(macAddress) {
  // Normalize MAC address
  const mac = macAddress.replace(/[:-]/g, '');

  if (mac.length !== 12 || !/^[0-9a-fA-F]+$/.test(mac)) {
    throw new Error(`Invalid MAC address: ${macAddress}`);
  }

  // Convert MAC to bytes
  const macBytes = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) {
    macBytes[i] = parseInt(mac.substr(i * 2, 2), 16);
  }

  // Magic packet: 6 bytes of 0xFF followed by MAC address repeated 16 times
  const packet = Buffer.alloc(102);

  // First 6 bytes are 0xFF
  for (let i = 0; i < 6; i++) {
    packet[i] = 0xff;
  }

  // Repeat MAC address 16 times
  for (let i = 0; i < 16; i++) {
    macBytes.copy(packet, 6 + i * 6);
  }

  return packet;
}

/**
 * Send Wake-on-LAN via Networkbox API
 * @param {string} macAddress - MAC address to wake
 * @param {string} host - Networkbox host address
 * @param {object} options - Additional options
 * @param {string} options.address - Broadcast IP (default: 255.255.255.255)
 * @param {number} options.port - WoL port (default: 9)
 * @returns {Promise<{macAddress: string, via: string}>}
 */
async function sendViaNetworkbox(macAddress, host, options = {}) {
  const port = process.env.NETWORKBOX_PORT || '8000';
  const body = JSON.stringify({
    mac: macAddress,
    ip: options.address || '255.255.255.255',
    port: options.port || 9,
  });

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: host,
        port,
        path: '/wake',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ macAddress, via: 'networkbox' });
          } else {
            reject(new Error(`Networkbox WoL failed: HTTP ${res.statusCode}`));
          }
        });
      }
    );

    req.on('error', (err) => {
      reject(new Error(`Networkbox WoL connection error: ${err.message}`));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Send Wake-on-LAN packet
 * @param {string} macAddress - MAC address to wake
 * @param {object} options - Additional options
 * @param {string} options.address - Broadcast address (default: WOL_BROADCAST_ADDRESS env or 255.255.255.255)
 * @param {number} options.port - UDP port (default: 9)
 * @param {number} options.count - Number of packets to send (default: 3)
 * @param {number} options.interval - Interval between packets in ms (default: 100)
 */
async function sendWakeOnLan(macAddress, options = {}) {
  // Try Networkbox first if configured
  const nbHost = process.env.NETWORKBOX_HOST;
  if (nbHost) {
    return sendViaNetworkbox(macAddress, nbHost, options);
  }

  // Direct UDP broadcast fallback
  const {
    address = process.env.WOL_BROADCAST_ADDRESS || '255.255.255.255',
    port = 9,
    count = 3,
    interval = 100,
  } = options;

  const packet = createMagicPacket(macAddress);
  const socket = dgram.createSocket('udp4');

  return new Promise((resolve, reject) => {
    socket.on('error', (err) => {
      socket.close();
      reject(err);
    });

    socket.bind(() => {
      socket.setBroadcast(true);

      let sent = 0;
      const sendPacket = () => {
        socket.send(packet, 0, packet.length, port, address, (err) => {
          if (err) {
            socket.close();
            return reject(err);
          }

          sent++;
          if (sent < count) {
            setTimeout(sendPacket, interval);
          } else {
            socket.close();
            resolve({
              macAddress,
              packetsSent: count,
              broadcastAddress: address,
              port,
            });
          }
        });
      };

      sendPacket();
    });
  });
}

/**
 * Send Wake-on-LAN to multiple hosts
 * @param {string[]} macAddresses - Array of MAC addresses
 * @param {object} options - WoL options
 */
async function sendWakeOnLanBulk(macAddresses, options = {}) {
  const results = await Promise.allSettled(
    macAddresses.map(mac => sendWakeOnLan(mac, options))
  );

  return {
    total: macAddresses.length,
    successful: results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length,
    results: results.map((r, i) => ({
      macAddress: macAddresses[i],
      success: r.status === 'fulfilled',
      error: r.status === 'rejected' ? r.reason?.message : null,
    })),
  };
}

/**
 * Send Wake-on-LAN to a subnet
 * @param {string} macAddress - MAC address to wake
 * @param {string} subnet - Subnet (e.g., "10.0.0")
 */
async function sendWakeOnLanToSubnet(macAddress, subnet) {
  const broadcastAddress = `${subnet}.255`;
  return sendWakeOnLan(macAddress, { address: broadcastAddress });
}

/**
 * Validate MAC address format
 * @param {string} macAddress - MAC address to validate
 */
function isValidMac(macAddress) {
  const pattern = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
  return pattern.test(macAddress);
}

/**
 * Normalize MAC address to lowercase with colons
 * @param {string} macAddress - MAC address
 */
function normalizeMac(macAddress) {
  const mac = macAddress.replace(/[:-]/g, '').toLowerCase();
  return mac.match(/.{2}/g).join(':');
}

module.exports = {
  createMagicPacket,
  sendViaNetworkbox,
  sendWakeOnLan,
  sendWakeOnLanBulk,
  sendWakeOnLanToSubnet,
  isValidMac,
  normalizeMac,
};
