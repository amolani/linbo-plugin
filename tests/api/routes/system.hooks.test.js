/**
 * LINBO Docker - Hooks Route Test
 * Verifies GET /hooks endpoint is wired correctly
 */

jest.mock('../../src/services/hook.service');
jest.mock('../../src/middleware/auth', () => ({
  authenticateToken: (req, res, next) => next(),
  requireRole: () => (req, res, next) => next(),
}));

const express = require('express');
const request = require('supertest');
const hookService = require('../../src/services/hook.service');
const hooksRoute = require('../../src/routes/system/hooks');

describe('GET /hooks', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use('/', hooksRoute);
  });

  test('returns hook data from service', async () => {
    hookService.getHooks.mockResolvedValue({
      hooks: [
        { name: '01_edulution-plymouth', type: 'pre', executable: true, size: 500, lastExitCode: 0, lastFilesDelta: 5 },
      ],
      lastBuild: '2026-03-10T14:30:00Z',
      hookWarnings: 0,
    });

    const res = await request(app).get('/hooks');

    expect(res.status).toBe(200);
    expect(res.body.data.hooks).toHaveLength(1);
    expect(res.body.data.hooks[0].name).toBe('01_edulution-plymouth');
    expect(res.body.data.hooks[0].type).toBe('pre');
    expect(res.body.data.lastBuild).toBe('2026-03-10T14:30:00Z');
    expect(res.body.data.hookWarnings).toBe(0);
  });

  test('returns empty hooks when none installed', async () => {
    hookService.getHooks.mockResolvedValue({
      hooks: [],
      lastBuild: null,
      hookWarnings: 0,
    });

    const res = await request(app).get('/hooks');

    expect(res.status).toBe(200);
    expect(res.body.data.hooks).toEqual([]);
    expect(res.body.data.lastBuild).toBeNull();
  });
});
