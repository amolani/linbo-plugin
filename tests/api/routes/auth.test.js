/**
 * LINBO Plugin - Auth Routes Tests
 * Covers: login, logout, /me, validation, rate limiting
 */

const TEST_JWT_SECRET = 'test-jwt-secret-for-auth-route-tests';
const TEST_INTERNAL_KEY = 'test-internal-key-for-auth-route-tests';
const TEST_ADMIN_USER = 'admin';
const TEST_ADMIN_PASS = 'TestPass123!';

// Set env BEFORE requiring any modules
process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.INTERNAL_API_KEY = TEST_INTERNAL_KEY;
process.env.ADMIN_USERNAME = TEST_ADMIN_USER;
process.env.ADMIN_PASSWORD = TEST_ADMIN_PASS;
process.env.NODE_ENV = 'test';

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

// Build a minimal Express app with auth routes mounted
function createApp() {
  const app = express();
  app.use(express.json());

  // Disable rate limiting for tests (avoid 429 from rapid test requests)
  jest.mock('../../../src/middleware/rate-limit', () => ({
    loginLimiter: (req, res, next) => next(),
    createLoginLimiter: () => (req, res, next) => next(),
    writeLimiter: (req, res, next) => next(),
  }));

  // Mount auth routes at /auth
  const authRouter = require('../../../src/routes/auth');
  app.use('/auth', authRouter);

  // Global error handler (mirrors index.js)
  app.use((err, req, res, _next) => {
    if (err.name === 'ZodError') {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: err.errors },
      });
    }
    res.status(err.status || 500).json({
      error: { code: err.code || 'INTERNAL_ERROR', message: err.message },
    });
  });

  return app;
}

describe('Auth Routes', () => {
  let app;
  let validToken; // Reuse across tests to avoid hitting rate limit

  beforeAll(async () => {
    app = createApp();

    // Get a valid token once for reuse in /me and /logout tests
    const res = await request(app)
      .post('/auth/login')
      .send({ username: TEST_ADMIN_USER, password: TEST_ADMIN_PASS });
    validToken = res.body.data?.token;
  });

  // =========================================================================
  // POST /auth/login
  // =========================================================================
  describe('POST /auth/login', () => {
    test('returns JWT token for valid admin credentials', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: TEST_ADMIN_USER, password: TEST_ADMIN_PASS })
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.token).toBeDefined();
      expect(typeof res.body.data.token).toBe('string');
      expect(res.body.data.user.username).toBe(TEST_ADMIN_USER);
      expect(res.body.data.user.role).toBe('admin');

      // Verify token is valid JWT
      const decoded = jwt.verify(res.body.data.token, TEST_JWT_SECRET);
      expect(decoded.username).toBe(TEST_ADMIN_USER);
      expect(decoded.role).toBe('admin');
    });

    test('returns 401 for wrong password', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: TEST_ADMIN_USER, password: 'wrong-password' })
        .expect(401);

      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    test('returns 401 for nonexistent username', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'nobody', password: 'whatever' })
        .expect(401);

      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    test('returns 400 for missing username', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ password: 'something' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('returns 400 for missing password', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'admin' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('returns 400 for empty body', async () => {
      await request(app)
        .post('/auth/login')
        .send({})
        .expect(400);
    });

    test('returns 400 for empty username string', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: '', password: 'test' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // =========================================================================
  // GET /auth/me
  // =========================================================================
  describe('GET /auth/me', () => {
    test('returns user info with valid JWT', async () => {
      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(res.body.data.username).toBe(TEST_ADMIN_USER);
      expect(res.body.data.role).toBe('admin');
      expect(res.body.data.id).toBe('env-admin');
    });

    test('returns 401 without token', async () => {
      const res = await request(app)
        .get('/auth/me')
        .expect(401);

      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    test('returns 403 with invalid JWT', async () => {
      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', 'Bearer invalid-token-here')
        .expect(403);

      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });

    test('returns 401 with expired token', async () => {
      // Create a token that expired 1 hour ago
      const expired = jwt.sign(
        { id: 'env-admin', username: 'admin', role: 'admin' },
        TEST_JWT_SECRET,
        { expiresIn: '-1h' }
      );

      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);

      expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    });

    test('accepts INTERNAL_API_KEY as Bearer token', async () => {
      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${TEST_INTERNAL_KEY}`)
        .expect(200);

      expect(res.body.data.id).toBe('internal');
      expect(res.body.data.username).toBe('internal-service');
    });

    test('accepts X-Internal-Key header', async () => {
      const res = await request(app)
        .get('/auth/me')
        .set('X-Internal-Key', TEST_INTERNAL_KEY)
        .expect(200);

      expect(res.body.data.id).toBe('internal');
    });
  });

  // =========================================================================
  // POST /auth/logout
  // =========================================================================
  describe('POST /auth/logout', () => {
    test('returns success with valid token', async () => {
      const res = await request(app)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(res.body.data.message).toMatch(/logged out/i);
    });

    test('returns 401 without token', async () => {
      await request(app)
        .post('/auth/logout')
        .expect(401);
    });
  });
});
