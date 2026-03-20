/**
 * LINBO Docker - Settings Route Tests
 */

const path = require('path');
const os = require('os');
const http = require('http');

const tmpDir = path.join(os.tmpdir(), `linbo-settings-route-test-${Date.now()}`);
process.env.LINBO_DIR = tmpDir;
process.env.JWT_SECRET = 'test-secret-for-settings-routes';
process.env.ADMIN_PASSWORD = 'testadmin';

// ---------------------------------------------------------------------------
// Redis Mock
// ---------------------------------------------------------------------------

const redisStore = new Map();

function resetRedis() {
  redisStore.clear();
}

const mockClient = {
  get: jest.fn(async (key) => redisStore.get(key) || null),
  set: jest.fn(async (key, val) => { redisStore.set(key, val); }),
  del: jest.fn(async (...keys) => { keys.flat().forEach(k => redisStore.delete(k)); }),
  setex: jest.fn(async (key, ttl, val) => { redisStore.set(key, val); }),
  status: 'ready',
  ping: jest.fn(async () => 'PONG'),
};

jest.mock('../../src/lib/redis', () => ({
  getClient: () => mockClient,
}));

jest.mock('../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
  getServer: () => null,
  init: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

const jwt = require('jsonwebtoken');

function adminToken() {
  return jwt.sign(
    { id: 'env-admin', username: 'admin', email: null, role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  );
}

function userToken() {
  return jwt.sign(
    { id: 'user1', username: 'viewer', email: null, role: 'viewer' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  );
}

// ---------------------------------------------------------------------------
// App Setup
// ---------------------------------------------------------------------------

const express = require('express');
const settingsRoutes = require('../../src/routes/settings');
const settingsService = require('../../src/services/settings.service');

let app, server, baseUrl;

beforeAll((done) => {
  app = express();
  app.use(express.json());
  app.use('/api/v1/settings', settingsRoutes);
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: { message: err.message } });
  });
  server = http.createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}/api/v1/settings`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  resetRedis();
  settingsService.invalidateCache();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function req(method, urlPath, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${urlPath}`, options);
  const data = await res.json();
  return { status: res.status, data };
}

// ---------------------------------------------------------------------------
// GET /
// ---------------------------------------------------------------------------

describe('GET /settings', () => {
  test('returns all settings with admin token', async () => {
    const { status, data } = await req('GET', '/', null, adminToken());
    expect(status).toBe(200);
    expect(Array.isArray(data.data)).toBe(true);
    const keys = data.data.map(s => s.key);
    expect(keys).toContain('lmn_api_url');
    expect(keys).toContain('lmn_api_password');
    expect(keys).toContain('admin_password_hash');
  });

  test('secrets are masked', async () => {
    redisStore.set('config:lmn_api_password', 'super-secret-key');
    settingsService.invalidateCache();
    const { data } = await req('GET', '/', null, adminToken());
    const apiKey = data.data.find(s => s.key === 'lmn_api_password');
    expect(apiKey.valueMasked).toBe('****-key');
    expect(apiKey.value).toBeUndefined();
  });

  test('returns 401 without token', async () => {
    const { status } = await req('GET', '/');
    expect(status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PUT /:key
// ---------------------------------------------------------------------------

describe('PUT /settings/:key', () => {
  test('sets a value with admin token', async () => {
    const { status, data } = await req('PUT', '/lmn_api_url', { value: 'http://new:8000' }, adminToken());
    expect(status).toBe(200);
    expect(redisStore.get('config:lmn_api_url')).toBe('http://new:8000');
  });

  test('rejects invalid URL', async () => {
    const { status, data } = await req('PUT', '/lmn_api_url', { value: 'ftp://bad' }, adminToken());
    expect(status).toBe(400);
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });

  test('rejects invalid IP', async () => {
    const { status } = await req('PUT', '/linbo_server_ip', { value: '999.0.0.1' }, adminToken());
    expect(status).toBe(400);
  });

  test('rejects unknown key', async () => {
    const { status } = await req('PUT', '/unknown_key', { value: 'test' }, adminToken());
    expect(status).toBe(400);
  });

  test('rejects setting admin_password_hash directly', async () => {
    const { status } = await req('PUT', '/admin_password_hash', { value: '$2a$...' }, adminToken());
    expect(status).toBe(400);
  });

  test('stores admin_password as hash', async () => {
    const { status } = await req('PUT', '/admin_password', { value: 'securePass1' }, adminToken());
    expect(status).toBe(200);
    const stored = redisStore.get('config:admin_password_hash');
    expect(stored).toMatch(/^\$2[ayb]\$/);
  });

  test('rejects missing value', async () => {
    const { status } = await req('PUT', '/lmn_api_url', {}, adminToken());
    expect(status).toBe(400);
  });

  test('returns 403 for non-admin', async () => {
    const { status } = await req('PUT', '/lmn_api_url', { value: 'http://test:8000' }, userToken());
    expect(status).toBe(403);
  });

  test('returns 401 without token', async () => {
    const { status } = await req('PUT', '/lmn_api_url', { value: 'http://test:8000' });
    expect(status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE /:key
// ---------------------------------------------------------------------------

describe('DELETE /settings/:key', () => {
  test('resets a setting', async () => {
    redisStore.set('config:lmn_api_url', 'http://custom:8000');
    const { status, data } = await req('DELETE', '/lmn_api_url', null, adminToken());
    expect(status).toBe(200);
    expect(data.data.success).toBe(true);
    expect(redisStore.has('config:lmn_api_url')).toBe(false);
  });

  test('rejects unknown key', async () => {
    const { status } = await req('DELETE', '/unknown_key', null, adminToken());
    expect(status).toBe(400);
  });

  test('returns 403 for non-admin', async () => {
    const { status } = await req('DELETE', '/lmn_api_url', null, userToken());
    expect(status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /test-connection
// ---------------------------------------------------------------------------

describe('POST /settings/test-connection', () => {
  test('returns connection test result', async () => {
    // Will fail to connect (no server running) but should not error
    const { status, data } = await req('POST', '/test-connection', {}, adminToken());
    expect(status).toBe(200);
    expect(data.data).toHaveProperty('reachable');
    expect(data.data).toHaveProperty('healthy');
    expect(data.data).toHaveProperty('latency');
    expect(typeof data.data.latency).toBe('number');
  });

  test('accepts custom url/key in body', async () => {
    const { status, data } = await req('POST', '/test-connection', {
      url: 'http://localhost:99999',
      key: 'test-key',
    }, adminToken());
    expect(status).toBe(200);
    expect(data.data.reachable).toBe(false);
  });

  test('returns 403 for non-admin', async () => {
    const { status } = await req('POST', '/test-connection', {}, userToken());
    expect(status).toBe(403);
  });
});
