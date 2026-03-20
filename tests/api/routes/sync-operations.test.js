/**
 * LINBO Docker - Sync Operations Routes Tests
 *
 * Tests all 9 endpoints with HTTP assertions using supertest-like setup.
 */

const path = require('path');
const os = require('os');
const http = require('http');

const tmpDir = path.join(os.tmpdir(), `linbo-syncops-route-test-${Date.now()}`);
process.env.LINBO_DIR = tmpDir;
process.env.JWT_SECRET = 'test-secret-for-syncops-routes';

// ---------------------------------------------------------------------------
// Redis Mock
// ---------------------------------------------------------------------------

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
  del: jest.fn(async (...keys) => { keys.flat().forEach(k => redisStore.delete(k)); }),
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
    redisSortedSets.get(key).push({ score, member });
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
    if (ss) redisSortedSets.set(key, ss.filter(e => !flat.includes(e.member)));
  }),
  zremrangebyrank: jest.fn(async () => 0),
  smembers: jest.fn(async (key) => [...(redisSets.get(key) || [])]),
  sadd: jest.fn(async (key, ...members) => {
    if (!redisSets.has(key)) redisSets.set(key, new Set());
    for (const m of members.flat()) redisSets.get(key).add(m);
  }),
  scard: jest.fn(async (key) => (redisSets.get(key) || new Set()).size),
  mget: jest.fn(async (...keys) => keys.flat().map(k => redisStore.get(k) || null)),
  pipeline: jest.fn(() => {
    const ops = [];
    const p = {
      get: (key) => { ops.push({ type: 'get', key }); return p; },
      hmset: (key, obj) => { ops.push({ type: 'hmset', key, obj }); return p; },
      hset: (key, field, value) => { ops.push({ type: 'hset', key, field, value }); return p; },
      expire: () => { ops.push({ type: 'noop' }); return p; },
      zadd: (key, score, member) => { ops.push({ type: 'zadd', key, score, member }); return p; },
      zremrangebyrank: () => { ops.push({ type: 'noop' }); return p; },
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
            case 'zadd': {
              if (!redisSortedSets.has(op.key)) redisSortedSets.set(op.key, []);
              redisSortedSets.get(op.key).push({ score: op.score, member: op.member });
              results.push([null, 1]);
              break;
            }
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

jest.mock('../../../src/lib/redis', () => ({
  getClient: () => mockClient,
  disconnect: jest.fn(),
  delPattern: jest.fn(),
}));

jest.mock('../../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
  init: jest.fn(),
}));

jest.mock('../../../src/services/ssh.service', () => ({
  testConnection: jest.fn(),
  executeCommand: jest.fn(),
}));

jest.mock('../../../src/services/wol.service', () => ({
  sendWakeOnLan: jest.fn(),
  sendWakeOnLanBulk: jest.fn(),
}));

jest.mock('../../../src/lib/lmn-api-client', () => ({
  getChanges: jest.fn(),
}));

jest.mock('../../../src/lib/atomic-write', () => ({
  atomicWrite: jest.fn(),
  atomicWriteWithMd5: jest.fn(),
  safeUnlink: jest.fn(),
  forceSymlink: jest.fn(),
}));

jest.mock('../../../src/lib/startconf-rewrite', () => ({
  rewriteServerField: jest.fn(c => c),
}));

jest.mock('../../../src/services/grub-generator', () => ({
  regenerateAll: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Express App Setup
// ---------------------------------------------------------------------------

const express = require('express');
const jwt = require('jsonwebtoken');
const syncOpsRoute = require('../../../src/routes/sync-operations');
const sshService = require('../../../src/services/ssh.service');
const wolService = require('../../../src/services/wol.service');

let app, server;

function makeToken(payload = {}) {
  const defaults = {
    id: 'test-user-id',
    username: 'testadmin',
    email: 'test@example.com',
    role: 'admin',
  };
  return jwt.sign({ ...defaults, ...payload }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

const adminToken = makeToken();

function buildApp() {
  const a = express();
  a.use(express.json());
  a.use('/operations', syncOpsRoute);
  a.use((err, req, res, next) => {
    res.status(err.statusCode || 500).json({ error: { message: err.message } });
  });
  return a;
}

function request(method, urlPath, body, token = adminToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: server.address().port,
      path: urlPath,
      method: method.toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
      },
    };
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function seedHosts() {
  const hosts = [
    { hostname: 'pc01', mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.101', hostgroup: 'room1' },
    { hostname: 'pc02', mac: 'AA:BB:CC:DD:EE:02', ip: '10.0.0.102', hostgroup: 'room1' },
  ];
  for (const h of hosts) {
    redisStore.set(`sync:host:${h.mac}`, JSON.stringify(h));
    if (!redisSets.has('sync:host:index')) redisSets.set('sync:host:index', new Set());
    redisSets.get('sync:host:index').add(h.mac);
  }
}

// ---------------------------------------------------------------------------
// Setup/Teardown
// ---------------------------------------------------------------------------

const fs = require('fs').promises;

beforeAll(async () => {
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'linbocmd'), { recursive: true });
  app = buildApp();
  server = app.listen(0);
});

afterAll(async () => {
  server.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetRedis();
  jest.clearAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('Sync Operations Routes', () => {

  describe('GET /operations', () => {
    test('returns empty list initially', async () => {
      const res = await request('GET', '/operations');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
    });

    test('returns operations after creation', async () => {
      seedHosts();

      // Create an operation directly via service
      const syncOps = require('../../../src/services/sync-operations.service');
      const hosts = [{ hostname: 'pc01', mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.101' }];
      await syncOps.createOperation(hosts, 'reboot');

      const res = await request('GET', '/operations');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('GET /operations/:id', () => {
    test('returns 404 for missing operation', async () => {
      const res = await request('GET', '/operations/nonexistent');
      expect(res.status).toBe(404);
    });

    test('returns operation with sessions', async () => {
      seedHosts();
      const syncOps = require('../../../src/services/sync-operations.service');
      const hosts = [{ hostname: 'pc01', mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.101' }];
      const op = await syncOps.createOperation(hosts, 'reboot');

      const res = await request('GET', `/operations/${op.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(op.id);
      expect(res.body.data.sessions).toBeDefined();
    });
  });

  describe('GET /operations/scheduled', () => {
    test('returns scheduled commands list', async () => {
      // Create a .cmd file
      await fs.writeFile(path.join(tmpDir, 'linbocmd', 'testhost.cmd'), 'sync:1', { mode: 0o660 });

      const res = await request('GET', '/operations/scheduled');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ hostname: 'testhost', commands: 'sync:1' }),
        ])
      );
    });
  });

  describe('POST /operations/validate-commands', () => {
    test('validates valid command', async () => {
      const res = await request('POST', '/operations/validate-commands', { commands: 'sync:1,start:1' });
      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(true);
    });

    test('rejects invalid command', async () => {
      const res = await request('POST', '/operations/validate-commands', { commands: 'invalid_cmd' });
      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(false);
    });

    test('returns 400 when no commands', async () => {
      const res = await request('POST', '/operations/validate-commands', {});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /operations/direct', () => {
    test('executes SSH command on hosts', async () => {
      seedHosts();
      sshService.testConnection.mockResolvedValue({ success: true });
      sshService.executeCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 });

      const res = await request('POST', '/operations/direct', {
        macs: ['AA:BB:CC:DD:EE:01'],
        commands: 'reboot',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('completed');
    });

    test('returns 400 without filter', async () => {
      const res = await request('POST', '/operations/direct', {
        commands: 'reboot',
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 without commands', async () => {
      const res = await request('POST', '/operations/direct', {
        macs: ['AA:BB:CC:DD:EE:01'],
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /operations/schedule', () => {
    test('creates .cmd files for hosts', async () => {
      seedHosts();

      const res = await request('POST', '/operations/schedule', {
        macs: ['AA:BB:CC:DD:EE:01'],
        commands: 'sync:1',
      });

      expect(res.status).toBe(201);
      expect(res.body.data.created).toContain('pc01');
    });
  });

  describe('DELETE /operations/scheduled/:hostname', () => {
    test('deletes existing .cmd file', async () => {
      await fs.writeFile(path.join(tmpDir, 'linbocmd', 'delhost.cmd'), 'reboot');

      const res = await request('DELETE', '/operations/scheduled/delhost');
      expect(res.status).toBe(200);
    });

    test('returns 404 for missing .cmd file', async () => {
      const res = await request('DELETE', '/operations/scheduled/nonexistent');
      expect(res.status).toBe(404);
    });

    test('rejects invalid hostname', async () => {
      const res = await request('DELETE', '/operations/scheduled/host%3Brm%20-rf');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /operations/wake', () => {
    test('sends WoL to hosts', async () => {
      seedHosts();
      wolService.sendWakeOnLanBulk.mockResolvedValue({
        total: 1, successful: 1, failed: 0, results: [],
      });

      const res = await request('POST', '/operations/wake', {
        macs: ['AA:BB:CC:DD:EE:01'],
      });

      expect(res.status).toBe(200);
      expect(res.body.data.hostCount).toBe(1);
    });
  });

  describe('POST /operations/:id/cancel', () => {
    test('cancels a pending operation', async () => {
      seedHosts();
      const syncOps = require('../../../src/services/sync-operations.service');
      const hosts = [{ hostname: 'pc01', mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.101' }];
      const op = await syncOps.createOperation(hosts, 'sync:1');

      const res = await request('POST', `/operations/${op.id}/cancel`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cancelling');
    });

    test('returns 404 for missing operation', async () => {
      const res = await request('POST', '/operations/nonexistent/cancel');
      expect(res.status).toBe(404);
    });
  });
});
