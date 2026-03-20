/**
 * Tests for Sync Read Endpoints
 *
 * Tests:
 *   GET /sync/mode — returns mode based on env vars (no auth)
 *   GET /sync/hosts — returns hosts from Redis with runtime status
 *   GET /sync/hosts/:mac — single host from Redis
 *   GET /sync/configs — returns configs from Redis
 *   GET /sync/configs/:id — single config from Redis
 *   GET /sync/configs/:id/preview — reads start.conf file
 *   GET /sync/stats — aggregated stats with hostOfflineTimeoutSec
 *   Auth: endpoints return 401 without token (except /sync/mode)
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const http = require('http');

const tmpDir = `${os.tmpdir()}/linbo-sync-read-test-${process.pid}`;
process.env.LINBO_DIR = tmpDir;
process.env.LINBO_SERVER_IP = '10.0.0.13';
process.env.JWT_SECRET = 'test-secret-for-sync-read';
process.env.HOST_OFFLINE_TIMEOUT_SEC = '600';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const redisStore = new Map();
const redisSets = new Map();
const redisHashes = new Map();

const mockClient = {
  get: jest.fn(async (key) => redisStore.get(key) || null),
  set: jest.fn(async (key, val) => { redisStore.set(key, val); }),
  del: jest.fn(async (key) => { redisStore.delete(key); }),
  mget: jest.fn(async (...keys) => {
    const flat = keys.flat();
    return flat.map(k => redisStore.get(k) || null);
  }),
  sadd: jest.fn(async (key, ...members) => {
    if (!redisSets.has(key)) redisSets.set(key, new Set());
    for (const m of members.flat()) redisSets.get(key).add(m);
  }),
  srem: jest.fn(async (key, ...members) => {
    const s = redisSets.get(key);
    if (s) for (const m of members.flat()) s.delete(m);
  }),
  smembers: jest.fn(async (key) => [...(redisSets.get(key) || [])]),
  scard: jest.fn(async (key) => (redisSets.get(key) || new Set()).size),
  hgetall: jest.fn(async (key) => redisHashes.get(key) || null),
  pipeline: jest.fn(() => {
    const ops = [];
    const p = {
      get: (key) => { ops.push(['get', key]); return p; },
      exec: async () => ops.map(([, key]) => [null, redisStore.get(key) || null]),
    };
    return p;
  }),
  status: 'ready',
  ping: jest.fn(async () => 'PONG'),
};

function resetRedis() {
  redisStore.clear();
  redisSets.clear();
  redisHashes.clear();
}

jest.mock('../../src/lib/redis', () => ({
  getClient: () => mockClient,
  disconnect: jest.fn(),
  delPattern: jest.fn(),
}));

jest.mock('../../src/lib/lmn-api-client', () => ({
  getChanges: jest.fn(),
  batchGetHosts: jest.fn(),
  batchGetStartConfs: jest.fn(),
  batchGetConfigs: jest.fn(),
  getDhcpExport: jest.fn(),
  checkHealth: jest.fn(async () => ({ healthy: true })),
}));

jest.mock('../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
  getServer: jest.fn(),
}));

jest.mock('../../src/services/grub-generator', () => ({
  regenerateAll: jest.fn(async () => ({})),
}));

// ---------------------------------------------------------------------------
// Express app with sync routes
// ---------------------------------------------------------------------------
const express = require('express');
const jwt = require('jsonwebtoken');
const syncRoutes = require('../../src/routes/sync');

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

/**
 * Helper: make an HTTP request to the test server.
 */
function httpGet(urlPath, token) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: `/sync${urlPath}`,
      method: 'GET',
      headers: {},
    };
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = body; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const HOST_1 = {
  mac: 'AA:BB:CC:DD:EE:01',
  hostname: 'r100-pc01',
  ip: '10.0.100.1',
  hostgroup: 'win11_efi_sata',
};

const HOST_2 = {
  mac: 'AA:BB:CC:DD:EE:02',
  hostname: 'r200-pc01',
  ip: '10.0.200.1',
  hostgroup: 'ubuntu_efi',
};

const CONFIG_1 = {
  id: 'win11_efi_sata',
  name: 'Windows 11 EFI SATA',
  osEntries: [{ name: 'Windows 11' }],
};

const CONFIG_2 = {
  id: 'ubuntu_efi',
  name: 'Ubuntu 24 EFI',
  osEntries: [{ name: 'Ubuntu 24.04' }],
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
beforeAll(async () => {
  await fs.mkdir(tmpDir, { recursive: true });
  app = express();
  app.use(express.json());
  app.use('/sync', syncRoutes);

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  resetRedis();
  jest.clearAllMocks();
  // Clean up tmpDir files
  try {
    const files = await fs.readdir(tmpDir);
    for (const f of files) await fs.rm(path.join(tmpDir, f), { recursive: true, force: true });
  } catch {}
});

// =============================================================================
// GET /sync/mode
// =============================================================================
describe('GET /sync/mode', () => {
  it('should return mode without auth', async () => {
    const res = await httpGet('/mode');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('mode');
    expect(res.body.data).toHaveProperty('syncEnabled');
  });

  it('should return syncEnabled as boolean', async () => {
    const res = await httpGet('/mode');
    expect(typeof res.body.data.syncEnabled).toBe('boolean');
  });

  it('should return a valid mode string', async () => {
    const res = await httpGet('/mode');
    expect(['offline', 'standalone', 'sync']).toContain(res.body.data.mode);
  });
});

// =============================================================================
// GET /sync/hosts
// =============================================================================
describe('GET /sync/hosts', () => {
  beforeEach(() => {
    redisSets.set('sync:host:index', new Set([HOST_1.mac, HOST_2.mac]));
    redisStore.set(`sync:host:${HOST_1.mac}`, JSON.stringify(HOST_1));
    redisStore.set(`sync:host:${HOST_2.mac}`, JSON.stringify(HOST_2));
    redisHashes.set(`host:status:${HOST_1.ip}`, { status: 'online', lastSeen: '2026-02-27T10:00:00Z' });
  });

  it('should return 401 without auth', async () => {
    const res = await httpGet('/hosts');
    expect(res.status).toBe(401);
  });

  it('should return all hosts with runtime status', async () => {
    const token = makeToken();
    const res = await httpGet('/hosts', token);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);

    const h1 = res.body.data.find(h => h.mac === HOST_1.mac);
    expect(h1.runtimeStatus).toBe('online');
    expect(h1.lastSeen).toBe('2026-02-27T10:00:00Z');

    const h2 = res.body.data.find(h => h.mac === HOST_2.mac);
    expect(h2.runtimeStatus).toBe('offline');
    expect(h2.lastSeen).toBeNull();
  });

  it('should filter by search query (hostname)', async () => {
    const token = makeToken();
    const res = await httpGet('/hosts?search=r100', token);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].hostname).toBe('r100-pc01');
  });

  it('should filter by search query (MAC, case-insensitive)', async () => {
    const token = makeToken();
    const res = await httpGet('/hosts?search=ee:02', token);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].mac).toBe(HOST_2.mac);
  });

  it('should filter by search query (IP)', async () => {
    const token = makeToken();
    const res = await httpGet('/hosts?search=10.0.100', token);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].ip).toBe('10.0.100.1');
  });

  it('should filter by hostgroup', async () => {
    const token = makeToken();
    const res = await httpGet('/hosts?hostgroup=ubuntu_efi', token);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].hostgroup).toBe('ubuntu_efi');
  });

  it('should return empty array when no hosts in Redis', async () => {
    resetRedis();
    const token = makeToken();
    const res = await httpGet('/hosts', token);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

// =============================================================================
// GET /sync/hosts/:mac
// =============================================================================
describe('GET /sync/hosts/:mac', () => {
  beforeEach(() => {
    redisStore.set(`sync:host:${HOST_1.mac}`, JSON.stringify(HOST_1));
    redisHashes.set(`host:status:${HOST_1.ip}`, { status: 'online', lastSeen: '2026-02-27T10:00:00Z' });
  });

  it('should return 401 without auth', async () => {
    const res = await httpGet(`/hosts/${HOST_1.mac}`);
    expect(res.status).toBe(401);
  });

  it('should return host with runtime status', async () => {
    const token = makeToken();
    const res = await httpGet(`/hosts/${HOST_1.mac}`, token);

    expect(res.status).toBe(200);
    expect(res.body.data.hostname).toBe('r100-pc01');
    expect(res.body.data.runtimeStatus).toBe('online');
    expect(res.body.data.lastSeen).toBe('2026-02-27T10:00:00Z');
  });

  it('should return 404 for unknown MAC', async () => {
    const token = makeToken();
    const res = await httpGet('/hosts/FF:FF:FF:FF:FF:FF', token);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('HOST_NOT_FOUND');
  });
});

// =============================================================================
// GET /sync/configs
// =============================================================================
describe('GET /sync/configs', () => {
  beforeEach(() => {
    redisSets.set('sync:config:index', new Set([CONFIG_1.id, CONFIG_2.id]));
    redisStore.set(`sync:config:${CONFIG_1.id}`, JSON.stringify(CONFIG_1));
    redisStore.set(`sync:config:${CONFIG_2.id}`, JSON.stringify(CONFIG_2));
  });

  it('should return 401 without auth', async () => {
    const res = await httpGet('/configs');
    expect(res.status).toBe(401);
  });

  it('should return all configs', async () => {
    const token = makeToken();
    const res = await httpGet('/configs', token);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const names = res.body.data.map(c => c.name).sort();
    expect(names).toEqual(['Ubuntu 24 EFI', 'Windows 11 EFI SATA']);
  });

  it('should return empty when no configs', async () => {
    resetRedis();
    const token = makeToken();
    const res = await httpGet('/configs', token);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

// =============================================================================
// GET /sync/configs/:id
// =============================================================================
describe('GET /sync/configs/:id', () => {
  beforeEach(() => {
    redisStore.set(`sync:config:${CONFIG_1.id}`, JSON.stringify(CONFIG_1));
  });

  it('should return 401 without auth', async () => {
    const res = await httpGet(`/configs/${CONFIG_1.id}`);
    expect(res.status).toBe(401);
  });

  it('should return config by id', async () => {
    const token = makeToken();
    const res = await httpGet(`/configs/${CONFIG_1.id}`, token);

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Windows 11 EFI SATA');
    expect(res.body.data.id).toBe('win11_efi_sata');
  });

  it('should return 404 for unknown config', async () => {
    const token = makeToken();
    const res = await httpGet('/configs/nonexistent', token);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CONFIG_NOT_FOUND');
  });
});

// =============================================================================
// GET /sync/configs/:id/preview
// =============================================================================
describe('GET /sync/configs/:id/preview', () => {
  const confContent = '[LINBO]\nServer = 10.0.0.13\nGroup = win11_efi_sata\n\n[OS]\nName = Windows 11';

  beforeEach(async () => {
    await fs.writeFile(path.join(tmpDir, 'start.conf.win11_efi_sata'), confContent);
  });

  it('should return 401 without auth', async () => {
    const res = await httpGet('/configs/win11_efi_sata/preview');
    expect(res.status).toBe(401);
  });

  it('should return file content', async () => {
    const token = makeToken();
    const res = await httpGet('/configs/win11_efi_sata/preview', token);

    expect(res.status).toBe(200);
    expect(res.body.data.content).toContain('[LINBO]');
    expect(res.body.data.content).toContain('Server = 10.0.0.13');
  });

  it('should return 404 for missing file', async () => {
    const token = makeToken();
    const res = await httpGet('/configs/nonexistent/preview', token);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('FILE_NOT_FOUND');
  });
});

// =============================================================================
// GET /sync/stats
// =============================================================================
describe('GET /sync/stats', () => {
  beforeEach(() => {
    // Seed hosts
    redisSets.set('sync:host:index', new Set([HOST_1.mac, HOST_2.mac]));
    redisStore.set(`sync:host:${HOST_1.mac}`, JSON.stringify(HOST_1));
    redisStore.set(`sync:host:${HOST_2.mac}`, JSON.stringify(HOST_2));
    redisHashes.set(`host:status:${HOST_1.ip}`, { status: 'online', lastSeen: '2026-02-27T10:00:00Z' });

    // Seed configs
    redisSets.set('sync:config:index', new Set([CONFIG_1.id, CONFIG_2.id]));

    // Sync metadata
    redisStore.set('sync:cursor', '1708943200:42');
    redisStore.set('sync:lastSyncAt', '2026-02-27T09:00:00Z');
    redisStore.set('sync:isRunning', 'false');
    redisStore.set('sync:lastError', '');
  });

  it('should return 401 without auth', async () => {
    const res = await httpGet('/stats');
    expect(res.status).toBe(401);
  });

  it('should return correct shape', async () => {
    const token = makeToken();
    const res = await httpGet('/stats', token);

    expect(res.status).toBe(200);
    const { data } = res.body;

    // Hosts
    expect(data.hosts).toHaveProperty('total');
    expect(data.hosts).toHaveProperty('online');
    expect(data.hosts).toHaveProperty('offline');
    expect(data.hosts.total).toBe(2);
    expect(data.hosts.online).toBe(1);
    expect(data.hosts.offline).toBe(1);

    // Configs
    expect(data.configs).toBe(2);

    // Sync metadata
    expect(data.sync).toHaveProperty('cursor');
    expect(data.sync).toHaveProperty('lastSyncAt');
    expect(data.sync).toHaveProperty('isRunning');
    expect(data.sync).toHaveProperty('lastError');

    // LMN health
    expect(typeof data.lmnApiHealthy).toBe('boolean');
  });

  it('should return hostOfflineTimeoutSec as a number', async () => {
    const token = makeToken();
    const res = await httpGet('/stats', token);

    expect(res.body.data.hostOfflineTimeoutSec).toBe(600);
    expect(typeof res.body.data.hostOfflineTimeoutSec).toBe('number');
  });

  it('should return numeric types for all counts', async () => {
    const token = makeToken();
    const res = await httpGet('/stats', token);

    expect(typeof res.body.data.hosts.total).toBe('number');
    expect(typeof res.body.data.hosts.online).toBe('number');
    expect(typeof res.body.data.hosts.offline).toBe('number');
    expect(typeof res.body.data.configs).toBe('number');
  });
});

// =============================================================================
// Auth enforcement across all protected endpoints
// =============================================================================
describe('Auth enforcement', () => {
  it('GET /sync/status requires auth', async () => {
    const res = await httpGet('/status');
    expect(res.status).toBe(401);
  });

  it('GET /sync/hosts requires auth', async () => {
    const res = await httpGet('/hosts');
    expect(res.status).toBe(401);
  });

  it('GET /sync/hosts/:mac requires auth', async () => {
    const res = await httpGet('/hosts/AA:BB:CC:DD:EE:01');
    expect(res.status).toBe(401);
  });

  it('GET /sync/configs requires auth', async () => {
    const res = await httpGet('/configs');
    expect(res.status).toBe(401);
  });

  it('GET /sync/configs/:id requires auth', async () => {
    const res = await httpGet('/configs/test');
    expect(res.status).toBe(401);
  });

  it('GET /sync/configs/:id/preview requires auth', async () => {
    const res = await httpGet('/configs/test/preview');
    expect(res.status).toBe(401);
  });

  it('GET /sync/stats requires auth', async () => {
    const res = await httpGet('/stats');
    expect(res.status).toBe(401);
  });

  it('GET /sync/mode does NOT require auth', async () => {
    const res = await httpGet('/mode');
    expect(res.status).toBe(200);
  });
});
