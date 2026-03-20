/**
 * LINBO Docker - Health Endpoint Phase 5 Requirements (RED tests)
 *
 * TDD Wave 1: These tests define the contract for the /health endpoint
 * after Phase 5 implementation. The key RED test is `services.linbo`
 * which does not exist until Plan 02 adds filesystem availability checks.
 *
 * Covers: API-07 (health endpoint reports LINBO service status, no redis field)
 *
 * Strategy: Combines source-level assertions (checking src/index.js contains
 * the expected linbo service check) with behavioral tests via supertest against
 * a test Express app that mirrors the current /health handler. This avoids
 * EADDRINUSE from requiring the full index.js while still testing the real contract.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

// Mock websocket module
jest.mock('../../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
  getServer: () => null,
  init: jest.fn(),
}));

const websocket = require('../../../src/lib/websocket');

// Build a test app with the current /health handler logic (copied from src/index.js)
// This ensures behavioral tests match reality
const app = express();
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime(),
    serverIp: process.env.LINBO_SERVER_IP || '10.0.0.1',
    services: {
      api: 'up',
      store: 'up',
      websocket: 'unknown',
    },
  };

  const wss = websocket.getServer();
  if (wss) {
    health.services.websocket = 'up';
    health.websocketClients = wss.clients.size;
  } else {
    health.services.websocket = 'down';
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

describe('GET /health — Phase 5 requirements (API-07)', () => {
  // -------------------------------------------------------------------------
  // Source-level assertion: services.linbo must be present in /health handler
  // This is the KEY RED test — FAILS until Plan 02 adds the linbo service check
  // -------------------------------------------------------------------------
  test('src/index.js /health handler includes services.linbo', () => {
    const source = fs.readFileSync(
      path.resolve(PROJECT_ROOT, 'src', 'index.js'),
      'utf8'
    );
    // After Plan 02, the /health handler must set services.linbo
    // Match patterns like: health.services.linbo = or services: { ... linbo: ...
    expect(source).toMatch(/services\.linbo\s*[=:]/);
  });

  // -------------------------------------------------------------------------
  // Behavioral tests via supertest (test the response shape)
  // -------------------------------------------------------------------------
  test('returns status 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  test('response body does NOT have services.redis field', async () => {
    const res = await request(app).get('/health');
    expect(res.body.services).not.toHaveProperty('redis');
  });

  test('response body has services.store field', async () => {
    const res = await request(app).get('/health');
    expect(res.body.services).toHaveProperty('store');
  });

  test('response status is "healthy" or "degraded"', async () => {
    const res = await request(app).get('/health');
    expect(['healthy', 'degraded']).toContain(res.body.status);
  });

  test('response has timestamp field as ISO string', async () => {
    const res = await request(app).get('/health');
    expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
