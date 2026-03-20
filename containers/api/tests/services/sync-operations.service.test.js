/**
 * LINBO Docker - Sync Operations Service Tests
 *
 * Tests:
 *   - Host resolution: macs[], hostnames[], hostgroup/room, no filter
 *   - Hostname sanitization: valid, invalid, path traversal
 *   - runWithConcurrency: pool limit, sequential ordering
 *   - Operation lifecycle: create → running → completed
 *   - Cancel semantics: queued sessions → cancelled, cancel flag
 *   - Lazy index cleanup: dead entries removed
 *   - Direct commands: SSH execution, session tracking, WS events
 *   - Schedule commands: .cmd file creation
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');

const TEST_DIR = path.join(os.tmpdir(), `linbo-syncops-test-${Date.now()}`);
process.env.LINBO_DIR = TEST_DIR;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Redis mock with full Hash/SortedSet support
const redisStore = new Map();
const redisSets = new Map();
const redisSortedSets = new Map();

function resetRedis() {
  redisStore.clear();
  redisSets.clear();
  redisSortedSets.clear();
}

const mockClient = {
  get: jest.fn(async (key) => redisStore.get(key) || null),
  set: jest.fn(async (key, val) => { redisStore.set(key, val); }),
  del: jest.fn(async (...keys) => {
    const flat = keys.flat();
    flat.forEach(k => redisStore.delete(k));
    return flat.length;
  }),
  hgetall: jest.fn(async (key) => {
    const m = redisStore.get(key);
    return m && typeof m === 'object' ? { ...m } : null;
  }),
  hmset: jest.fn(async (key, obj) => {
    const existing = redisStore.get(key) || {};
    redisStore.set(key, { ...existing, ...obj });
  }),
  hget: jest.fn(async (key, field) => {
    const m = redisStore.get(key);
    return m && typeof m === 'object' ? m[field] || null : null;
  }),
  hset: jest.fn(async (key, field, value) => {
    const m = redisStore.get(key) || {};
    m[field] = value;
    redisStore.set(key, m);
  }),
  expire: jest.fn(async () => 1),
  exists: jest.fn(async (key) => redisStore.has(key) ? 1 : 0),
  zadd: jest.fn(async (key, score, member) => {
    if (!redisSortedSets.has(key)) redisSortedSets.set(key, []);
    const ss = redisSortedSets.get(key);
    const existIdx = ss.findIndex(e => e.member === member);
    if (existIdx >= 0) ss[existIdx].score = score;
    else ss.push({ score, member });
    ss.sort((a, b) => a.score - b.score);
  }),
  zrevrange: jest.fn(async (key, start, stop) => {
    const ss = redisSortedSets.get(key) || [];
    const reversed = [...ss].reverse();
    const end = stop === -1 ? reversed.length : stop + 1;
    return reversed.slice(start, end).map(e => e.member);
  }),
  zrem: jest.fn(async (key, ...members) => {
    const flat = members.flat();
    const ss = redisSortedSets.get(key);
    if (ss) {
      const newSs = ss.filter(e => !flat.includes(e.member));
      redisSortedSets.set(key, newSs);
    }
  }),
  zremrangebyrank: jest.fn(async () => 0),
  smembers: jest.fn(async (key) => [...(redisSets.get(key) || [])]),
  sadd: jest.fn(async (key, ...members) => {
    if (!redisSets.has(key)) redisSets.set(key, new Set());
    for (const m of members.flat()) redisSets.get(key).add(m);
  }),
  scard: jest.fn(async (key) => (redisSets.get(key) || new Set()).size),
  mget: jest.fn(async (...keys) => {
    const flat = keys.flat();
    return flat.map(k => redisStore.get(k) || null);
  }),
  pipeline: jest.fn(() => {
    const ops = [];
    const p = {
      get: (key) => { ops.push({ type: 'get', key }); return p; },
      hmset: (key, obj) => { ops.push({ type: 'hmset', key, obj }); return p; },
      hset: (key, field, value) => { ops.push({ type: 'hset', key, field, value }); return p; },
      expire: (key, ttl) => { ops.push({ type: 'expire', key, ttl }); return p; },
      zadd: (key, score, member) => { ops.push({ type: 'zadd', key, score, member }); return p; },
      zremrangebyrank: (key, start, stop) => { ops.push({ type: 'zremrangebyrank', key, start, stop }); return p; },
      exists: (key) => { ops.push({ type: 'exists', key }); return p; },
      hget: (key, field) => { ops.push({ type: 'hget', key, field }); return p; },
      hgetall: (key) => { ops.push({ type: 'hgetall', key }); return p; },
      exec: async () => {
        const results = [];
        for (const op of ops) {
          switch (op.type) {
            case 'get':
              results.push([null, redisStore.get(op.key) || null]);
              break;
            case 'hmset': {
              const existing = redisStore.get(op.key) || {};
              redisStore.set(op.key, { ...existing, ...op.obj });
              results.push([null, 'OK']);
              break;
            }
            case 'hset': {
              const m = redisStore.get(op.key) || {};
              m[op.field] = op.value;
              redisStore.set(op.key, m);
              results.push([null, 1]);
              break;
            }
            case 'expire':
              results.push([null, 1]);
              break;
            case 'zadd': {
              if (!redisSortedSets.has(op.key)) redisSortedSets.set(op.key, []);
              redisSortedSets.get(op.key).push({ score: op.score, member: op.member });
              results.push([null, 1]);
              break;
            }
            case 'zremrangebyrank':
              results.push([null, 0]);
              break;
            case 'exists':
              results.push([null, redisStore.has(op.key) ? 1 : 0]);
              break;
            case 'hget': {
              const m2 = redisStore.get(op.key);
              results.push([null, m2 && typeof m2 === 'object' ? m2[op.field] || null : null]);
              break;
            }
            case 'hgetall': {
              const m3 = redisStore.get(op.key);
              results.push([null, m3 && typeof m3 === 'object' ? { ...m3 } : null]);
              break;
            }
            default:
              results.push([null, null]);
          }
        }
        return results;
      },
    };
    return p;
  }),
  status: 'ready',
  ping: jest.fn(async () => 'PONG'),
};

jest.mock('../../src/lib/redis', () => ({
  getClient: () => mockClient,
  disconnect: jest.fn(),
}));

jest.mock('../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
}));

jest.mock('../../src/services/ssh.service', () => ({
  testConnection: jest.fn(),
  executeCommand: jest.fn(),
}));

jest.mock('../../src/services/wol.service', () => ({
  sendWakeOnLan: jest.fn(),
  sendWakeOnLanBulk: jest.fn(),
}));

// Must mock lmn-api-client (required by sync.service)
jest.mock('../../src/lib/lmn-api-client', () => ({
  getChanges: jest.fn(),
}));

// Must mock atomic-write (required by sync.service)
jest.mock('../../src/lib/atomic-write', () => ({
  atomicWrite: jest.fn(),
  atomicWriteWithMd5: jest.fn(),
  safeUnlink: jest.fn(),
  forceSymlink: jest.fn(),
}));

jest.mock('../../src/lib/startconf-rewrite', () => ({
  rewriteServerField: jest.fn(c => c),
}));

jest.mock('../../src/services/grub-generator', () => ({
  regenerateAll: jest.fn(),
}));

const syncOps = require('../../src/services/sync-operations.service');
const sshService = require('../../src/services/ssh.service');
const wolService = require('../../src/services/wol.service');
const ws = require('../../src/lib/websocket');

// ---------------------------------------------------------------------------
// Test Data
// ---------------------------------------------------------------------------

const testHosts = [
  { hostname: 'pc01', mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.101', hostgroup: 'room1', room: 'r101' },
  { hostname: 'pc02', mac: 'AA:BB:CC:DD:EE:02', ip: '10.0.0.102', hostgroup: 'room1', room: 'r101' },
  { hostname: 'pc03', mac: 'AA:BB:CC:DD:EE:03', ip: '10.0.0.103', hostgroup: 'room2', room: 'r202' },
];

function seedHosts(hosts = testHosts) {
  // Seed Redis with sync:host:* keys + index
  for (const h of hosts) {
    redisStore.set(`sync:host:${h.mac}`, JSON.stringify(h));
    if (!redisSets.has('sync:host:index')) redisSets.set('sync:host:index', new Set());
    redisSets.get('sync:host:index').add(h.mac);
  }
}

// ---------------------------------------------------------------------------
// Setup/Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  resetRedis();
  jest.clearAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('Sync Operations Service', () => {

  // --------------------------------------------------------------------------
  // sanitizeHostname
  // --------------------------------------------------------------------------
  describe('sanitizeHostname', () => {
    test('accepts valid hostnames', () => {
      expect(syncOps.sanitizeHostname('pc01')).toBe('pc01');
      expect(syncOps.sanitizeHostname('host.domain')).toBe('host.domain');
      expect(syncOps.sanitizeHostname('my-host_01')).toBe('my-host_01');
    });

    test('rejects empty hostname', () => {
      expect(() => syncOps.sanitizeHostname('')).toThrow('Invalid hostname');
      expect(() => syncOps.sanitizeHostname(null)).toThrow('Invalid hostname');
    });

    test('rejects path traversal', () => {
      expect(() => syncOps.sanitizeHostname('../../etc/passwd')).toThrow('Invalid hostname');
    });

    test('rejects special characters', () => {
      expect(() => syncOps.sanitizeHostname('host;rm -rf')).toThrow('Invalid hostname');
      expect(() => syncOps.sanitizeHostname('host name')).toThrow('Invalid hostname');
    });
  });

  // --------------------------------------------------------------------------
  // runWithConcurrency
  // --------------------------------------------------------------------------
  describe('runWithConcurrency', () => {
    test('runs all items with limit', async () => {
      const items = [1, 2, 3, 4, 5];
      const results = await syncOps.runWithConcurrency(items, async (x) => x * 2, 2);
      expect(results).toEqual([2, 4, 6, 8, 10]);
    });

    test('respects concurrency limit', async () => {
      let maxConcurrent = 0;
      let current = 0;

      const items = Array.from({ length: 10 }, (_, i) => i);
      await syncOps.runWithConcurrency(items, async () => {
        current++;
        maxConcurrent = Math.max(maxConcurrent, current);
        await new Promise(r => setTimeout(r, 10));
        current--;
      }, 3);

      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });

    test('handles empty array', async () => {
      const results = await syncOps.runWithConcurrency([], async (x) => x, 5);
      expect(results).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // resolveHosts
  // --------------------------------------------------------------------------
  describe('resolveHosts', () => {
    beforeEach(() => seedHosts());

    test('resolves by macs', async () => {
      const hosts = await syncOps.resolveHosts({ macs: ['AA:BB:CC:DD:EE:01'] });
      expect(hosts).toHaveLength(1);
      expect(hosts[0].hostname).toBe('pc01');
    });

    test('resolves by hostnames', async () => {
      const hosts = await syncOps.resolveHosts({ hostnames: ['pc02', 'pc03'] });
      expect(hosts).toHaveLength(2);
      expect(hosts.map(h => h.hostname).sort()).toEqual(['pc02', 'pc03']);
    });

    test('resolves by hostgroup', async () => {
      const hosts = await syncOps.resolveHosts({ hostgroup: 'room1' });
      expect(hosts).toHaveLength(2);
    });

    test('resolves by room', async () => {
      const hosts = await syncOps.resolveHosts({ room: 'r202' });
      expect(hosts).toHaveLength(1);
      expect(hosts[0].hostname).toBe('pc03');
    });

    test('throws 400 when no filter', async () => {
      await expect(syncOps.resolveHosts({})).rejects.toThrow('At least one filter');
    });

    test('throws 404 when no hosts match macs', async () => {
      await expect(syncOps.resolveHosts({ macs: ['FF:FF:FF:FF:FF:FF'] }))
        .rejects.toThrow('No hosts found');
    });

    test('throws 409 on duplicate hostname (multiple MACs)', async () => {
      // Add duplicate hostname with different MAC
      const dupHost = { hostname: 'pc01', mac: 'AA:BB:CC:DD:EE:99', ip: '10.0.0.199', hostgroup: 'room1' };
      redisStore.set(`sync:host:${dupHost.mac}`, JSON.stringify(dupHost));
      redisSets.get('sync:host:index').add(dupHost.mac);

      await expect(syncOps.resolveHosts({ hostnames: ['pc01'] }))
        .rejects.toThrow('matches multiple MACs');
    });
  });

  // --------------------------------------------------------------------------
  // Operation CRUD
  // --------------------------------------------------------------------------
  describe('Operation CRUD', () => {
    test('createOperation creates Redis entries', async () => {
      seedHosts();
      const op = await syncOps.createOperation(testHosts.slice(0, 2), 'sync:1', { type: 'direct' });

      expect(op.id).toBeDefined();
      expect(op.status).toBe('pending');

      // Verify Redis was populated
      const opData = redisStore.get(`ops:op:${op.id}`);
      expect(opData).toBeDefined();
      expect(opData.status).toBe('pending');
      expect(JSON.parse(opData.targetHosts)).toEqual(['pc01', 'pc02']);
    });

    test('getOperation returns null for missing', async () => {
      const result = await syncOps.getOperation('nonexistent');
      expect(result).toBeNull();
    });

    test('getOperation returns operation with parsed sessions', async () => {
      seedHosts();
      const op = await syncOps.createOperation(testHosts.slice(0, 1), 'reboot');
      const loaded = await syncOps.getOperation(op.id);

      expect(loaded).not.toBeNull();
      expect(loaded.sessions).toBeDefined();
      expect(loaded.sessions['pc01']).toBeDefined();
      expect(loaded.sessions['pc01'].status).toBe('queued');
    });

    test('listOperations paginates correctly', async () => {
      seedHosts();

      // Create 3 operations
      for (let i = 0; i < 3; i++) {
        await syncOps.createOperation(testHosts.slice(0, 1), `sync:${i + 1}`);
      }

      const result = await syncOps.listOperations({ page: 1, limit: 2 });
      expect(result.data).toHaveLength(2);
      expect(result.pagination.total).toBe(3);
      expect(result.pagination.pages).toBe(2);
    });

    test('listOperations lazy cleanup removes dead entries', async () => {
      seedHosts();

      const op1 = await syncOps.createOperation(testHosts.slice(0, 1), 'sync:1');
      const op2 = await syncOps.createOperation(testHosts.slice(0, 1), 'sync:2');

      // Simulate TTL expiry: delete op1 data but leave index entry
      redisStore.delete(`ops:op:${op1.id}`);

      const result = await syncOps.listOperations({});
      // op1 should be cleaned from index, only op2 returned
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(op2.id);
    });

    test('listOperations filters by status', async () => {
      seedHosts();

      const op1 = await syncOps.createOperation(testHosts.slice(0, 1), 'sync:1');
      const op2 = await syncOps.createOperation(testHosts.slice(0, 1), 'sync:2');

      // Update op2 status to running
      const opKey = `ops:op:${op2.id}`;
      const existing = redisStore.get(opKey);
      existing.status = 'running';
      redisStore.set(opKey, existing);

      const result = await syncOps.listOperations({ status: 'running' });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(op2.id);
    });
  });

  // --------------------------------------------------------------------------
  // Cancel
  // --------------------------------------------------------------------------
  describe('cancelOperation', () => {
    test('cancels queued sessions and sets flag', async () => {
      seedHosts();
      const op = await syncOps.createOperation(testHosts, 'sync:1');

      const result = await syncOps.cancelOperation(op.id);
      expect(result.status).toBe('cancelling');

      // Check cancel flag
      const opData = redisStore.get(`ops:op:${op.id}`);
      expect(opData.cancelRequested).toBe('true');

      // Check sessions
      const sessData = redisStore.get(`ops:op:${op.id}:sessions`);
      for (const json of Object.values(sessData)) {
        const sess = JSON.parse(json);
        expect(sess.status).toBe('cancelled');
      }

      // WS broadcast
      expect(ws.broadcast).toHaveBeenCalledWith('operation.cancelling', { operationId: op.id });
    });

    test('throws 404 for missing operation', async () => {
      await expect(syncOps.cancelOperation('nonexistent')).rejects.toThrow('not found');
    });

    test('throws 400 for already completed', async () => {
      seedHosts();
      const op = await syncOps.createOperation(testHosts.slice(0, 1), 'sync:1');
      const opKey = `ops:op:${op.id}`;
      const existing = redisStore.get(opKey);
      existing.status = 'completed';
      redisStore.set(opKey, existing);

      await expect(syncOps.cancelOperation(op.id)).rejects.toThrow('already completed');
    });
  });

  // --------------------------------------------------------------------------
  // executeDirectCommands
  // --------------------------------------------------------------------------
  describe('executeDirectCommands', () => {
    beforeEach(() => seedHosts());

    test('executes SSH commands on hosts', async () => {
      sshService.testConnection.mockResolvedValue({ success: true });
      sshService.executeCommand.mockResolvedValue({ stdout: 'ok', stderr: '', code: 0 });

      const result = await syncOps.executeDirectCommands(
        { macs: ['AA:BB:CC:DD:EE:01'] },
        'reboot'
      );

      expect(result.status).toBe('completed');
      expect(result.stats.success).toBe(1);
      expect(result.stats.total).toBe(1);
      expect(sshService.executeCommand).toHaveBeenCalledWith(
        '10.0.0.101',
        'reboot',
        expect.any(Object)
      );
    });

    test('marks failed session on SSH error', async () => {
      sshService.testConnection.mockResolvedValue({ success: true });
      sshService.executeCommand.mockRejectedValue(new Error('SSH timeout'));

      const result = await syncOps.executeDirectCommands(
        { macs: ['AA:BB:CC:DD:EE:01'] },
        'sync:1'
      );

      expect(result.status).toBe('failed');
      expect(result.stats.failed).toBe(1);
    });

    test('marks failed when host not online', async () => {
      sshService.testConnection.mockResolvedValue({ success: false });

      const result = await syncOps.executeDirectCommands(
        { macs: ['AA:BB:CC:DD:EE:01'] },
        'reboot'
      );

      expect(result.status).toBe('failed');
      expect(result.stats.failed).toBe(1);
    });

    test('broadcasts WS events', async () => {
      sshService.testConnection.mockResolvedValue({ success: true });
      sshService.executeCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 });

      await syncOps.executeDirectCommands({ macs: ['AA:BB:CC:DD:EE:01'] }, 'reboot');

      expect(ws.broadcast).toHaveBeenCalledWith('operation.started', expect.objectContaining({
        type: 'direct',
        commands: 'reboot',
      }));
      expect(ws.broadcast).toHaveBeenCalledWith('operation.completed', expect.objectContaining({
        status: 'completed',
      }));
    });

    test('rejects invalid commands', async () => {
      await expect(
        syncOps.executeDirectCommands({ macs: ['AA:BB:CC:DD:EE:01'] }, 'invalid_cmd')
      ).rejects.toThrow();
    });

    test('handles multiple hosts with mixed results', async () => {
      sshService.testConnection.mockImplementation(async (ip) => ({
        success: ip !== '10.0.0.102',
      }));
      sshService.executeCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 });

      const result = await syncOps.executeDirectCommands(
        { hostgroup: 'room1' },
        'reboot'
      );

      expect(result.status).toBe('completed_with_errors');
      expect(result.stats.success).toBe(1);
      expect(result.stats.failed).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // scheduleOnbootCommands
  // --------------------------------------------------------------------------
  describe('scheduleOnbootCommands', () => {
    beforeEach(async () => {
      seedHosts();
      await fs.mkdir(path.join(TEST_DIR, 'linbocmd'), { recursive: true });
    });

    test('creates .cmd files for hosts', async () => {
      const result = await syncOps.scheduleOnbootCommands(
        { macs: ['AA:BB:CC:DD:EE:01'] },
        'sync:1,start:1'
      );

      expect(result.created).toEqual(['pc01']);
      expect(result.failed).toEqual([]);

      const cmdContent = await fs.readFile(
        path.join(TEST_DIR, 'linbocmd', 'pc01.cmd'),
        'utf8'
      );
      expect(cmdContent).toBe('sync:1,start:1');
    });

    test('prepends flags when options given', async () => {
      await syncOps.scheduleOnbootCommands(
        { macs: ['AA:BB:CC:DD:EE:01'] },
        'sync:1',
        { noauto: true, disablegui: true }
      );

      const cmdContent = await fs.readFile(
        path.join(TEST_DIR, 'linbocmd', 'pc01.cmd'),
        'utf8'
      );
      expect(cmdContent).toBe('noauto,disablegui,sync:1');
    });

    test('broadcasts WS event', async () => {
      await syncOps.scheduleOnbootCommands(
        { macs: ['AA:BB:CC:DD:EE:01'] },
        'reboot'
      );

      expect(ws.broadcast).toHaveBeenCalledWith('onboot.scheduled', expect.objectContaining({
        created: ['pc01'],
      }));
    });
  });

  // --------------------------------------------------------------------------
  // wakeHosts
  // --------------------------------------------------------------------------
  describe('wakeHosts', () => {
    beforeEach(() => seedHosts());

    test('sends WoL to resolved hosts', async () => {
      wolService.sendWakeOnLanBulk.mockResolvedValue({
        total: 2,
        successful: 2,
        failed: 0,
        results: [],
      });

      const result = await syncOps.wakeHosts({ hostgroup: 'room1' });

      expect(result.hostCount).toBe(2);
      expect(wolService.sendWakeOnLanBulk).toHaveBeenCalledWith([
        'AA:BB:CC:DD:EE:01',
        'AA:BB:CC:DD:EE:02',
      ]);
    });

    test('schedules onboot commands when onboot option set', async () => {
      wolService.sendWakeOnLanBulk.mockResolvedValue({ total: 1, successful: 1, failed: 0, results: [] });

      // Create linbocmd dir
      await fs.mkdir(path.join(TEST_DIR, 'linbocmd'), { recursive: true });

      await syncOps.wakeHosts(
        { macs: ['AA:BB:CC:DD:EE:01'] },
        { commands: 'sync:1', onboot: true }
      );

      const cmdExists = await fs.access(path.join(TEST_DIR, 'linbocmd', 'pc01.cmd'))
        .then(() => true).catch(() => false);
      expect(cmdExists).toBe(true);
    });
  });
});
