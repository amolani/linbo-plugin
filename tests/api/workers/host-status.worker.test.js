/**
 * LINBO Docker - host-status.worker RED Test Suite
 *
 * Tests the host-status worker's Redis usage patterns with store.js backing.
 * Verifies API-03: host status as volatile in-memory Map.
 *
 * All tests must FAIL until src/lib/store.js is implemented (Plan 02).
 * The mock redirects redis.getClient() -> store.client.
 */

// Mock redis to delegate to store.js (will fail until store.js exists)
jest.mock('../../../src/lib/redis', () => {
  const store = require('../../../src/lib/store');
  return {
    getClient: () => store.client,
    get: store.client.get.bind(store.client),
    set: (...args) => store.client.set(...args),
    del: (...args) => store.client.del(...args),
  };
});

// Mock websocket (broadcast is called on status transitions)
jest.mock('../../../src/lib/websocket', () => ({ broadcast: jest.fn() }));

// Mock hwinfo-scanner (dynamic require inside scanAll)
jest.mock('../../../src/services/hwinfo-scanner.service', () => ({
  scanHost: jest.fn().mockResolvedValue(undefined),
}));

// Mock net — control TCP probe results (always simulate "online")
jest.mock('net', () => {
  const EventEmitter = require('events');
  return {
    Socket: jest.fn().mockImplementation(() => {
      const sock = new EventEmitter();
      sock.setTimeout = jest.fn();
      sock.destroy = jest.fn();
      sock.connect = jest.fn(function (port, ip) {
        // Simulate port-open (online) by default
        setImmediate(() => sock.emit('connect'));
      });
      return sock;
    }),
  };
});

const store = require('../../../src/lib/store');

describe('host-status worker — store.js backing (API-03)', () => {
  let client;

  beforeEach(() => {
    store.reset();
    client = store.client;
  });

  describe('Host status volatility', () => {
    test('host status is empty on fresh process start (no persisted state)', async () => {
      // After reset, no host:status keys should exist
      const result = await client.hgetall('host:status:10.0.0.100');
      expect(result).toBeNull();
    });

    test('exists returns 0 for unknown host before any write', async () => {
      const exists = await client.exists('host:status:10.0.0.200');
      expect(exists).toBe(0);
    });
  });

  describe('Hash operations for host status', () => {
    test('hmset + expire stores host status with TTL', async () => {
      const statusData = {
        status: 'online',
        lastSeen: String(Date.now()),
        hostname: 'pc-raum1-01',
        mac: 'AA:BB:CC:DD:EE:01',
      };

      await client.hmset('host:status:10.0.0.101', statusData);
      await client.expire('host:status:10.0.0.101', 600);

      const result = await client.hgetall('host:status:10.0.0.101');
      expect(result).toEqual(statusData);
    });

    test('hgetall returns stored status object', async () => {
      await client.hmset('host:status:10.0.0.102', {
        status: 'offline',
        lastSeen: '1700000000000',
        hostname: 'pc-raum1-02',
        mac: 'AA:BB:CC:DD:EE:02',
      });

      const result = await client.hgetall('host:status:10.0.0.102');
      expect(result.status).toBe('offline');
      expect(result.hostname).toBe('pc-raum1-02');
      expect(result.mac).toBe('AA:BB:CC:DD:EE:02');
    });

    test('hget returns single field', async () => {
      await client.hmset('host:status:10.0.0.103', {
        status: 'online',
        lastSeen: '1700000000000',
        hostname: 'pc-raum1-03',
        mac: 'AA:BB:CC:DD:EE:03',
      });

      const status = await client.hget('host:status:10.0.0.103', 'status');
      expect(status).toBe('online');
    });

    test('exists returns 1 for active host, 0 for unknown', async () => {
      await client.hmset('host:status:10.0.0.104', {
        status: 'online',
        lastSeen: String(Date.now()),
        hostname: 'pc-raum1-04',
        mac: 'AA:BB:CC:DD:EE:04',
      });

      expect(await client.exists('host:status:10.0.0.104')).toBe(1);
      expect(await client.exists('host:status:10.0.0.999')).toBe(0);
    });
  });

  describe('client.status guard', () => {
    test('client.status equals ready so workers do not silently abort', () => {
      // host-status.worker.js line 61: if (!client || client.status !== 'ready') return;
      // If status is not 'ready', every scan cycle silently aborts
      expect(client.status).toBe('ready');
    });
  });
});

describe('hwinfo auto-trigger (SSH-03)', () => {
  let hwinfoScanner;
  let client;

  beforeEach(() => {
    jest.clearAllMocks();
    store.reset();
    client = store.client;
    hwinfoScanner = require('../../../src/services/hwinfo-scanner.service');
  });

  test('scanHost() called for online host with no cached hwinfo', async () => {
    // Seed a host in the store (mimics sync:host:index + sync:host:{mac})
    await client.sadd('sync:host:index', 'AA:BB:CC:DD:EE:01');
    await client.set('sync:host:AA:BB:CC:DD:EE:01', JSON.stringify({
      ip: '10.40.0.105',
      mac: 'AA:BB:CC:DD:EE:01',
      hostname: 'client-test-01',
    }));
    // No hwinfo key — triggers auto-scan

    const worker = require('../../../src/workers/host-status.worker');
    await worker.scanAll();

    expect(hwinfoScanner.scanHost).toHaveBeenCalledWith('10.40.0.105', 'AA:BB:CC:DD:EE:01');
    expect(hwinfoScanner.scanHost).toHaveBeenCalledTimes(1);
  });

  test('scanHost() NOT called when hwinfo already cached', async () => {
    await client.sadd('sync:host:index', 'AA:BB:CC:DD:EE:02');
    await client.set('sync:host:AA:BB:CC:DD:EE:02', JSON.stringify({
      ip: '10.40.0.106',
      mac: 'AA:BB:CC:DD:EE:02',
      hostname: 'client-test-02',
    }));
    // Pre-seed hwinfo cache — must prevent auto-scan
    await client.set('hwinfo:AA:BB:CC:DD:EE:02', JSON.stringify({ vendor: 'ASUS' }));

    const worker = require('../../../src/workers/host-status.worker');
    await worker.scanAll();

    expect(hwinfoScanner.scanHost).not.toHaveBeenCalled();
  });
});
