'use strict';

const request = require('supertest');
const { createTestApp } = require('../../setup/test-app');

let app;

beforeAll(async () => {
  app = await createTestApp();
});

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
describe('GET /health', () => {
  it('returns 200 with healthy status', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });

  it('includes timestamp and version', async () => {
    const res = await request(app).get('/health');

    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('version', '2.1.0');
    // Timestamp must be a valid ISO 8601 string
    expect(() => new Date(res.body.timestamp).toISOString()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// GET /ready
// ---------------------------------------------------------------------------
describe('GET /ready', () => {
  it('returns 200 with ready status', async () => {
    const res = await request(app).get('/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body).toHaveProperty('timestamp');
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/ — API info endpoint
// ---------------------------------------------------------------------------
describe('GET /api/v1/', () => {
  it('returns 200 with API info and endpoints listing', async () => {
    const res = await request(app).get('/api/v1/');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message', 'LINBO Plugin API');
    expect(res.body).toHaveProperty('version', 'v1');
    expect(res.body).toHaveProperty('mode', 'sync');
    expect(res.body).toHaveProperty('endpoints');
    // Verify key endpoint groups are listed
    expect(res.body.endpoints).toHaveProperty('auth');
    expect(res.body.endpoints).toHaveProperty('sync');
    expect(res.body.endpoints).toHaveProperty('images');
    expect(res.body.endpoints).toHaveProperty('operations');
    expect(res.body.endpoints).toHaveProperty('system');
    expect(res.body.endpoints).toHaveProperty('settings');
  });

  it('includes documentation links', async () => {
    const res = await request(app).get('/api/v1/');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('documentation');
    expect(res.body.documentation).toHaveProperty('swagger', '/docs');
    expect(res.body.documentation).toHaveProperty('openapi', '/openapi.json');
  });
});

// ---------------------------------------------------------------------------
// 404 — unmatched routes
// ---------------------------------------------------------------------------
describe('Unmatched routes', () => {
  it('returns 404 with NOT_FOUND error for unknown paths', async () => {
    const res = await request(app).get('/api/v1/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.error).toHaveProperty('code', 'NOT_FOUND');
    expect(res.body.error).toHaveProperty('requestId');
  });
});
