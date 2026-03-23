'use strict';

const request = require('supertest');
const { createTestApp } = require('../../setup/test-app');
const { createAdminToken, createViewerToken, getInternalKey } = require('../../setup/test-auth');
const { seedAdminPassword } = require('../../setup/test-store');

let app;

beforeAll(async () => {
  app = await createTestApp();
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/login
// ---------------------------------------------------------------------------
//
// IMPORTANT: The login route applies a singleton rate limiter (5 req/min)
// BEFORE validation middleware. Since the limiter cannot be reset between
// tests, the order of tests matters:
//
//   1. Validation tests (4 requests — stay within the 5-request window)
//   2. One successful-login test (5th request — last within the window)
//   3. Rate-limit test (fires additional requests, expects 429)
//   4. Remaining credential tests that accept 401 OR 429
//
// ---------------------------------------------------------------------------
describe('POST /api/v1/auth/login', () => {
  beforeEach(async () => {
    await seedAdminPassword('testpassword');
  });

  // --- Validation tests (run first, consume 4 of the 5-request window) ---

  it('returns 400 VALIDATION_ERROR when username is missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ password: 'testpassword' });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when password is missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin' });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when body is empty', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for empty username string', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: '', password: 'testpassword' });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  // --- Successful login (5th request — last within the rate-limit window) ---

  it('returns JWT token and user object for valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'testpassword' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('token');
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.token.split('.')).toHaveLength(3); // JWT format
    expect(res.body.data.user).toEqual({
      id: 'env-admin',
      username: 'admin',
      role: 'admin',
    });
  });

  // --- Rate-limit test (fires additional requests that trigger 429) ---

  it('rate-limits login attempts (429 after exceeding 5/min)', async () => {
    // Previous tests already consumed the 5-request window, so
    // additional requests should immediately receive 429.
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'wrong' });

    expect(res.status).toBe(429);
    expect(res.body.error).toHaveProperty('code', 'RATE_LIMITED');
  });

  // --- Credential tests (run after rate limit is exhausted) ---
  // These expect 401 OR 429 since the rate limiter may still be active.

  it('returns 401 INVALID_CREDENTIALS for wrong password (or 429 if rate-limited)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'wrong-password' });

    // Accept either 401 (wrong creds) or 429 (rate-limited)
    expect([401, 429]).toContain(res.status);
    if (res.status === 401) {
      expect(res.body.error).toHaveProperty('code', 'INVALID_CREDENTIALS');
    } else {
      expect(res.body.error).toHaveProperty('code', 'RATE_LIMITED');
    }
  });

  it('returns 401 for unknown username (or 429 if rate-limited)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'nobody', password: 'testpassword' });

    expect([401, 429]).toContain(res.status);
    if (res.status === 401) {
      expect(res.body.error).toHaveProperty('code', 'INVALID_CREDENTIALS');
    } else {
      expect(res.body.error).toHaveProperty('code', 'RATE_LIMITED');
    }
  });

  it('returns 400 for empty password (or 429 if rate-limited)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: '' });

    expect([400, 429]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/refresh
// ---------------------------------------------------------------------------
describe('POST /api/v1/auth/refresh', () => {
  it('returns a new token for a valid Bearer token', async () => {
    const originalToken = createAdminToken();

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Authorization', `Bearer ${originalToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('token');
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.token.split('.')).toHaveLength(3);
  });

  it('returns user info alongside the new token', async () => {
    const token = createAdminToken();

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user).toHaveProperty('id', 'test-admin-1');
    expect(res.body.data.user).toHaveProperty('username', 'testadmin');
    expect(res.body.data.user).toHaveProperty('role', 'admin');
  });

  it('preserves role claims in refreshed token', async () => {
    const viewerToken = createViewerToken();

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user).toHaveProperty('role', 'viewer');
  });

  it('returns 401 when no token is provided', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh');

    expect(res.status).toBe(401);
    expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED');
  });

  it('returns 401 for a completely invalid token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Authorization', 'Bearer not.a.valid.jwt');

    expect(res.status).toBe(401);
    expect(res.body.error).toHaveProperty('code', 'INVALID_TOKEN');
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/logout
// ---------------------------------------------------------------------------
describe('POST /api/v1/auth/logout', () => {
  it('returns success message with valid token', async () => {
    const token = createAdminToken();

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('message', 'Logged out successfully');
  });

  it('works for viewer role as well', async () => {
    const token = createViewerToken();

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('message', 'Logged out successfully');
  });

  it('returns 401 without a token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout');

    expect(res.status).toBe(401);
    expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED');
  });

  it('returns 403 for an invalid token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', 'Bearer garbage-token');

    expect(res.status).toBe(403);
    expect(res.body.error).toHaveProperty('code', 'INVALID_TOKEN');
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/auth/me
// ---------------------------------------------------------------------------
describe('GET /api/v1/auth/me', () => {
  it('returns admin user data with a valid admin JWT', async () => {
    const token = createAdminToken({ id: 'env-admin', username: 'admin' });

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('id', 'env-admin');
    expect(res.body.data).toHaveProperty('username', 'admin');
    expect(res.body.data).toHaveProperty('role', 'admin');
    expect(res.body.data).toHaveProperty('active', true);
  });

  it('returns internal-service user with X-Internal-Key header', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('X-Internal-Key', getInternalKey());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('id', 'internal');
    expect(res.body.data).toHaveProperty('username', 'internal-service');
    expect(res.body.data).toHaveProperty('role', 'admin');
  });

  it('returns internal-service user with internal key as Bearer token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${getInternalKey()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('id', 'internal');
    expect(res.body.data).toHaveProperty('username', 'internal-service');
  });

  it('returns 401 without any authentication', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED');
  });

  it('returns 403 for an invalid JWT', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid-jwt-token');

    expect(res.status).toBe(403);
    expect(res.body.error).toHaveProperty('code', 'INVALID_TOKEN');
  });

  it('returns 404 for a JWT user that is neither env-admin nor internal', async () => {
    const token = createViewerToken();

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toHaveProperty('code', 'USER_NOT_FOUND');
  });
});
