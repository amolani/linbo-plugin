/**
 * LINBO Docker - Host Status Worker (Redis-only, no Prisma)
 *
 * Periodically scans all synced hosts via SSH port probe (TCP 2222)
 * and updates host:status:{ip} hashes in Redis with TTL.
 *
 * Reads hosts from sync:host:index (Redis sync cache).
 * Writes to host:status:{ip} (Redis hash with TTL).
 */

const net = require('net');
const redis = require('../lib/redis');
const ws = require('../lib/websocket');

const SCAN_INTERVAL = parseInt(process.env.HOST_SCAN_INTERVAL, 10) || 30000; // 30s
const PROBE_TIMEOUT = parseInt(process.env.HOST_PROBE_TIMEOUT, 10) || 2000; // 2s
const STATUS_TTL = parseInt(process.env.HOST_OFFLINE_TIMEOUT_SEC, 10) || 600; // 10min
const MAX_CONCURRENT = parseInt(process.env.HOST_SCAN_CONCURRENCY, 10) || 20;
const PROBE_PORT = 2222; // Dropbear SSH on LINBO clients

let _interval = null;
let _scanning = false;

/**
 * Probe a single host via TCP connect to port 2222.
 * Returns true if port is open (host is in LINBO), false otherwise.
 */
function probeHost(ip) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(PROBE_TIMEOUT);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(PROBE_PORT, ip);
  });
}

/**
 * Run a single scan cycle: load hosts from Redis, probe each, update status.
 */
async function scanAll() {
  if (_scanning) return;
  _scanning = true;

  try {
    const client = redis.getClient();
    if (!client || client.status !== 'ready') return;

    // Load all synced hosts
    const macs = await client.smembers('sync:host:index');
    if (!macs || macs.length === 0) return;

    const hosts = [];
    for (const mac of macs) {
      const json = await client.get(`sync:host:${mac}`);
      if (json) {
        const h = JSON.parse(json);
        if (h.ip) hosts.push(h);
      }
    }

    if (hosts.length === 0) return;

    // Probe hosts with concurrency limit
    let onlineCount = 0;
    let offlineCount = 0;

    for (let i = 0; i < hosts.length; i += MAX_CONCURRENT) {
      const batch = hosts.slice(i, i + MAX_CONCURRENT);
      const results = await Promise.all(
        batch.map(async (host) => {
          const online = await probeHost(host.ip);
          return { host, online };
        })
      );

      for (const { host, online } of results) {
        const statusKey = `host:status:${host.ip}`;
        const now = Date.now();

        if (online) {
          const prev = await client.hget(statusKey, 'status');
          await client.hmset(statusKey, {
            status: 'online',
            lastSeen: String(now),
            hostname: host.hostname || '',
            mac: host.mac || '',
          });
          await client.expire(statusKey, STATUS_TTL);
          onlineCount++;

          // Auto-trigger hwinfo scan if no cached data exists
          if (host.mac) {
            const hasHwinfo = await client.exists('hwinfo:' + host.mac);
            if (!hasHwinfo) {
              const hwinfoScanner = require('../services/hwinfo-scanner.service');
              hwinfoScanner.scanHost(host.ip, host.mac).catch(err =>
                console.warn('[HostStatus] hwinfo scan failed for', host.ip, err.message)
              );
            }
          }

          // Broadcast status change only when transitioning
          if (prev !== 'online') {
            ws.broadcast('host.status.changed', {
              hostname: host.hostname,
              ip: host.ip,
              status: 'online',
              lastSeen: new Date(now),
            });
          }
        } else {
          // Only update if key exists (was previously online)
          const exists = await client.exists(statusKey);
          if (exists) {
            const prev = await client.hget(statusKey, 'status');
            if (prev === 'online') {
              await client.hmset(statusKey, { status: 'offline' });
              await client.expire(statusKey, STATUS_TTL);
              offlineCount++;

              ws.broadcast('host.status.changed', {
                hostname: host.hostname,
                ip: host.ip,
                status: 'offline',
                lastSeen: new Date(now),
              });
            }
          }
        }
      }
    }

    if (onlineCount > 0 || offlineCount > 0) {
      console.log(`[HostStatus] Scan: ${onlineCount} online, ${offlineCount} went offline (${hosts.length} total)`);
    }
  } catch (err) {
    console.error('[HostStatus] Scan error:', err.message);
  } finally {
    _scanning = false;
  }
}

function startWorker() {
  console.log(`[HostStatus] Starting (interval=${SCAN_INTERVAL}ms, timeout=${PROBE_TIMEOUT}ms, concurrency=${MAX_CONCURRENT})`);
  // Initial scan after 5s (let Redis populate first)
  setTimeout(() => scanAll(), 5000);
  _interval = setInterval(() => scanAll(), SCAN_INTERVAL);
}

function stopWorker() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}

module.exports = { startWorker, stopWorker, scanAll, probeHost };
