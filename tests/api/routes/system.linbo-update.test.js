/**
 * LINBO Docker - LINBO Update Route Tests
 */

const path = require('path');
const os = require('os');
const http = require('http');

const tmpDir = path.join(os.tmpdir(), `linbo-update-route-test-${Date.now()}`);
process.env.LINBO_DIR = tmpDir;
process.env.JWT_SECRET = 'test-secret-linbo-update-routes';
process.env.ADMIN_PASSWORD = 'testadmin';

// ---------------------------------------------------------------------------
// Redis Mock
// ---------------------------------------------------------------------------

const redisStore = new Map();

function resetRedis() {
  redisStore.clear();
}

const mockRedisClient = {
  get: jest.fn(async (key) => redisStore.get(key) || null),
  set: jest.fn(async (key, val, ...args) => {
    if (args.includes('NX') && redisStore.has(key)) return null;
    redisStore.set(key, val);
    return 'OK';
  }),
  del: jest.fn(async (...keys) => { keys.flat().forEach((k) => redisStore.delete(k)); }),
  expire: jest.fn(async () => 1),
  hmset: jest.fn(async (key, data) => { redisStore.set(key, data); }),
  hgetall: jest.fn(async (key) => redisStore.get(key) || null),
  setex: jest.fn(async (key, ttl, val) => { redisStore.set(key, val); }),
  status: 'ready',
  ping: jest.fn(async () => 'PONG'),
};

jest.mock('../../src/lib/redis', () => ({
  getClient: () => mockRedisClient,
}));

jest.mock('../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
  getServer: () => null,
  init: jest.fn(),
}));

// Mock linbofs service
jest.mock('../../src/services/linbofs.service', () => ({
  updateLinbofs: jest.fn(async () => ({ success: true, output: 'ok', duration: 100 })),
  getLinbofsInfo: jest.fn(async () => ({ exists: true, size: 1000 })),
  verifyLinbofs: jest.fn(async () => ({ valid: true, hasPasswordHash: true, hasAuthorizedKeys: true, hasDropbearKey: true })),
  checkKeyFiles: jest.fn(async () => ({ dropbearKeys: [], sshKeys: [], publicKeys: [] })),
  initializeKeys: jest.fn(async () => ({ created: [], existing: [] })),
  generateSshKeyPair: jest.fn(async () => ({ created: false })),
  generateDropbearKey: jest.fn(async () => ({ created: false })),
}));

// Mock kernel service
jest.mock('../../src/services/kernel.service', () => ({
  listKernelVariants: jest.fn(async () => []),
  getActiveKernel: jest.fn(async () => ({ variant: 'stable' })),
  getKernelStatus: jest.fn(async () => ({ rebuildRunning: false })),
  switchKernel: jest.fn(async () => ({ jobId: 'test' })),
  repairConfig: jest.fn(async () => ({ variant: 'stable' })),
  readKernelState: jest.fn(async () => ({ rebuildStatus: 'completed' })),
}));

// Mock grub-generator (used by system/grub-config.js sub-router)
jest.mock('../../src/services/grub-generator', () => ({
  regenerateAll: jest.fn(async () => ({ configs: 0, hosts: 0, hostcfgMac: 0 })),
}));

jest.mock('../../src/services/grub-theme.service', () => ({
  getThemeStatus: jest.fn(async () => ({})),
}));

jest.mock('../../src/services/firmware.service', () => ({
  getFirmwareEntries: jest.fn(async () => []),
  getFirmwareStatus: jest.fn(async () => ({})),
}));

// Mock audit middleware
jest.mock('../../src/middleware/audit', () => ({
  auditAction: () => (req, res, next) => next(),
}));

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

const jwt = require('jsonwebtoken');

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
const viewerToken = makeToken({ role: 'viewer', username: 'viewer' });

// ---------------------------------------------------------------------------
// Express App + HTTP helpers
// ---------------------------------------------------------------------------

const express = require('express');
const systemRoutes = require('../../src/routes/system');

let app, server;

function buildApp() {
  const a = express();
  a.use(express.json());
  a.use('/system', systemRoutes);
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
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
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
// Setup
// ---------------------------------------------------------------------------

const fs = require('fs').promises;

beforeAll(async () => {
  await fs.mkdir(tmpDir, { recursive: true });
  app = buildApp();
  server = app.listen(0);
});

afterAll(async () => {
  server.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  resetRedis();
  jest.clearAllMocks();
  const svc = require('../../src/services/linbo-update.service');
  await svc._testing.releaseLock();
});

// ---------------------------------------------------------------------------
// GET /system/linbo-version
// ---------------------------------------------------------------------------

describe('GET /system/linbo-version', () => {
  test('returns version info', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'linbo-version.txt'),
      'LINBO 4.3.29-0: Psycho Killer\n'
    );

    const originalFetch = global.fetch;
    global.fetch = jest.fn(() => Promise.reject(new Error('no network')));

    try {
      const res = await request('GET', '/system/linbo-version');
      expect(res.status).toBe(200);
      expect(res.body.data.installed).toBe('4.3.29-0');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('returns 401 without token', async () => {
    const res = await request('GET', '/system/linbo-version', null, null);
    expect(res.status).toBe(401);
  });

  test('viewer can check version', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'linbo-version.txt'),
      'LINBO 4.3.29-0: Test\n'
    );

    const originalFetch = global.fetch;
    global.fetch = jest.fn(() => Promise.reject(new Error('no network')));

    try {
      const res = await request('GET', '/system/linbo-version', null, viewerToken);
      expect(res.status).toBe(200);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// POST /system/linbo-update
// ---------------------------------------------------------------------------

describe('POST /system/linbo-update', () => {
  test('returns 401 without token', async () => {
    const res = await request('POST', '/system/linbo-update', null, null);
    expect(res.status).toBe(401);
  });

  test('returns 403 without admin role', async () => {
    const res = await request('POST', '/system/linbo-update', null, viewerToken);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /system/linbo-update/status
// ---------------------------------------------------------------------------

describe('GET /system/linbo-update/status', () => {
  test('returns idle status when no update running', async () => {
    const res = await request('GET', '/system/linbo-update/status');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('idle');
  });

  test('returns current status from Redis', async () => {
    redisStore.set('linbo:update:status', {
      status: 'downloading',
      progress: '45',
      message: 'Downloading...',
      version: '4.3.30-0',
      startedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:01:00Z',
      runId: 'test',
      error: '',
    });

    const res = await request('GET', '/system/linbo-update/status');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('downloading');
    expect(res.body.data.progress).toBe(45);
  });

  test('returns 401 without token', async () => {
    const res = await request('GET', '/system/linbo-update/status', null, null);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /system/linbo-update/cancel
// ---------------------------------------------------------------------------

describe('POST /system/linbo-update/cancel', () => {
  test('returns 200 with cancelled: true', async () => {
    const res = await request('POST', '/system/linbo-update/cancel');
    expect(res.status).toBe(200);
    expect(res.body.data.cancelled).toBe(true);
  });

  test('returns 401 without token', async () => {
    const res = await request('POST', '/system/linbo-update/cancel', null, null);
    expect(res.status).toBe(401);
  });

  test('returns 403 without admin role', async () => {
    const res = await request('POST', '/system/linbo-update/cancel', null, viewerToken);
    expect(res.status).toBe(403);
  });
});
