/**
 * Sync-Mode Integration Test
 *
 * Verifies that the API starts and responds correctly in sync-only mode
 * (no Prisma/PostgreSQL dependency — Redis only).
 *
 * Tests:
 *   - API app loads without error
 *   - GET /api/v1/images returns 200 with filesystem data
 *   - GET /api/v1/hosts returns 404 (route removed, not 409)
 *   - GET /health returns 200 without database field
 */

// ---------------------------------------------------------------------------
// Environment — MUST be set before any require()
// ---------------------------------------------------------------------------
const os = require('os');
const path = require('path');
const tmpDir = path.join(os.tmpdir(), `linbo-sync-test-${process.pid}`);

process.env.SYNC_ENABLED = 'true';
process.env.JWT_SECRET = 'test-secret-sync-mode-integration';
process.env.INTERNAL_API_KEY = 'test-internal-key-sync';
process.env.NODE_ENV = 'test';
process.env.LINBO_DIR = tmpDir;
process.env.IMAGES_DIR = path.join(tmpDir, 'images');
process.env.PORT = '0'; // random port

// ---------------------------------------------------------------------------
// Mocks — MUST be set before requiring the app
// ---------------------------------------------------------------------------

// Redis mock with minimal interface
const redisStore = new Map();
const mockClient = {
  get: jest.fn(async (key) => redisStore.get(key) || null),
  set: jest.fn(async (key, val) => { redisStore.set(key, val); }),
  del: jest.fn(async (key) => { redisStore.delete(key); }),
  mget: jest.fn(async (...keys) => keys.flat().map(k => redisStore.get(k) || null)),
  smembers: jest.fn(async () => []),
  scard: jest.fn(async () => 0),
  hgetall: jest.fn(async () => null),
  keys: jest.fn(async () => []),
  pipeline: jest.fn(() => {
    const ops = [];
    const p = {
      get: (key) => { ops.push(['get', key]); return p; },
      exec: async () => ops.map(([, key]) => [null, redisStore.get(key) || null]),
    };
    return p;
  }),
  xinfo: jest.fn(async () => { throw new Error('no stream'); }),
  xgroup: jest.fn(async () => 'OK'),
  status: 'ready',
  ping: jest.fn(async () => 'PONG'),
  on: jest.fn(),
  once: jest.fn((event, cb) => { if (event === 'ready') cb(); }),
};

jest.mock('../../src/lib/redis', () => ({
  getClient: () => mockClient,
  disconnect: jest.fn(),
  delPattern: jest.fn(),
}));

// WebSocket mock
jest.mock('../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
  getServer: jest.fn(() => ({ clients: new Set() })),
  init: jest.fn(),
}));

// LMN API client mock
jest.mock('../../src/lib/lmn-api-client', () => ({
  checkHealth: jest.fn(async () => ({ healthy: false })),
  getChanges: jest.fn(),
  batchGetHosts: jest.fn(),
}));

// Grub generator mock
jest.mock('../../src/services/grub-generator', () => ({
  regenerateAll: jest.fn(async () => ({})),
}));

// Settings service mock
jest.mock('../../src/services/settings.service', () => ({
  get: jest.fn(async (key) => {
    if (key === 'sync_enabled') return 'true';
    return null;
  }),
  applySyncInterval: jest.fn(async () => {}),
}));

// Image sync service mock
jest.mock('../../src/services/image-sync.service', () => ({
  recoverOnStartup: jest.fn(async () => {}),
}));

// Image push service mock
jest.mock('../../src/services/image-push.service', () => ({
  recoverOnStartup: jest.fn(async () => {}),
}));

// Terminal service mock
jest.mock('../../src/services/terminal.service', () => ({
  createSession: jest.fn(),
  writeToSession: jest.fn(),
  resizeSession: jest.fn(),
  destroySession: jest.fn(),
  listSessions: jest.fn(() => []),
  getSession: jest.fn(),
  destroyAll: jest.fn(),
}));

// Linbofs service mock (auto-rebuild check)
jest.mock('../../src/services/linbofs.service', () => ({
  updateLinbofs: jest.fn(async () => ({ success: true })),
}));

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------
const fs = require('fs').promises;
const http = require('http');
const jwt = require('jsonwebtoken');

let app, server;

function makeToken(payload = {}) {
  const defaults = {
    id: 'test-sync-user',
    username: 'testadmin',
    email: 'test@sync.local',
    role: 'admin',
  };
  return jwt.sign({ ...defaults, ...payload }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function httpRequest(method, urlPath, token) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: urlPath,
      method,
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
// Lifecycle
// ---------------------------------------------------------------------------
beforeAll(async () => {
  // Create required directories
  await fs.mkdir(path.join(tmpDir, 'images'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'boot', 'grub'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'gui'), { recursive: true });

  // Require the app (triggers startServer)
  const appModule = require('../../src/index');
  app = appModule.app;

  // The server is created in index.js but listen() is async.
  server = appModule.server;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server start timeout')), 10000);
    if (server.listening) {
      clearTimeout(timeout);
      resolve();
    } else {
      server.on('listening', () => { clearTimeout(timeout); resolve(); });
      server.on('error', (err) => { clearTimeout(timeout); reject(err); });
    }
  });
}, 15000);

afterAll(async () => {
  if (server && server.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// =============================================================================
// Tests
// =============================================================================

describe('Sync-Mode API Integration', () => {
  it('should start the API without errors', () => {
    expect(app).toBeDefined();
    expect(server.listening).toBe(true);
  });

  it('GET /health returns 200 without database field', async () => {
    const res = await httpRequest('GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body.services).not.toHaveProperty('database');
    expect(res.body.services.api).toBe('up');
  });

  it('GET /api/v1/images returns 200 with filesystem data', async () => {
    const token = makeToken();
    const res = await httpRequest('GET', '/api/v1/images', token);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /api/v1/hosts returns 404 (route removed)', async () => {
    const token = makeToken();
    const res = await httpRequest('GET', '/api/v1/hosts', token);
    expect(res.status).toBe(404);
  });

  it('GET /api/v1 shows mode: sync', async () => {
    const res = await httpRequest('GET', '/api/v1');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('sync');
  });
});
