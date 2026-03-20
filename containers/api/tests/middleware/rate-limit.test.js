/**
 * LINBO Docker - Rate Limit Middleware Tests
 * Tests for login rate limiting behavior using express-rate-limit
 */

const express = require('express');
const request = require('supertest');

describe('loginLimiter', () => {
  let createLoginLimiter;
  let app;
  let limiter;

  beforeEach(() => {
    // Create a fresh limiter instance for each test (in-memory store)
    const rateLimitModule = require('../../src/middleware/rate-limit');
    createLoginLimiter = rateLimitModule.createLoginLimiter;

    // Create a minimal Express app with the rate limiter mounted
    app = express();
    app.use(express.json());

    // Create limiter with in-memory store (no Redis needed for tests)
    limiter = createLoginLimiter({ store: undefined });

    // Mount on a test route
    app.post('/test-login', limiter, (req, res) => {
      res.status(200).json({ success: true });
    });
  });

  // Test 1: loginLimiter is an express middleware function
  test('loginLimiter is an express middleware function', () => {
    const { loginLimiter } = require('../../src/middleware/rate-limit');
    expect(typeof loginLimiter).toBe('function');
    // Express middleware takes (req, res, next)
    expect(loginLimiter.length).toBeGreaterThanOrEqual(0);
  });

  // Test 2: 5 requests within windowMs pass through
  test('5 requests within windowMs pass through (next() called)', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/test-login')
        .send({ username: 'test', password: 'test' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    }
  });

  // Test 3: 6th request within windowMs returns 429 with RATE_LIMITED error
  test('6th request within windowMs returns 429 with RATE_LIMITED error', async () => {
    // Send 5 allowed requests
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/test-login')
        .send({ username: 'test', password: 'test' });
    }

    // 6th request should be rate limited
    const res = await request(app)
      .post('/test-login')
      .send({ username: 'test', password: 'test' });

    expect(res.status).toBe(429);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.body.error.message).toBeDefined();
  });

  // Test 4: 429 response includes Retry-After header
  test('429 response includes Retry-After header', async () => {
    // Exhaust the limit
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/test-login')
        .send({ username: 'test', password: 'test' });
    }

    // 6th request should include Retry-After
    const res = await request(app)
      .post('/test-login')
      .send({ username: 'test', password: 'test' });

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  // Test 5: Requests from different IPs are counted independently
  test('requests from different IPs are counted independently', async () => {
    // Create a new app that uses X-Forwarded-For for IP detection
    const ipApp = express();
    ipApp.set('trust proxy', 'loopback, linklocal, uniquelocal');
    ipApp.use(express.json());
    const ipLimiter = createLoginLimiter({ store: undefined });
    ipApp.post('/test-login', ipLimiter, (req, res) => {
      res.status(200).json({ success: true, ip: req.ip });
    });

    // Send 5 requests from IP "1.1.1.1"
    for (let i = 0; i < 5; i++) {
      await request(ipApp)
        .post('/test-login')
        .set('X-Forwarded-For', '1.1.1.1')
        .send({ username: 'test', password: 'test' });
    }

    // 6th from same IP -> 429
    const blocked = await request(ipApp)
      .post('/test-login')
      .set('X-Forwarded-For', '1.1.1.1')
      .send({ username: 'test', password: 'test' });
    expect(blocked.status).toBe(429);

    // 1st from different IP -> 200
    const allowed = await request(ipApp)
      .post('/test-login')
      .set('X-Forwarded-For', '2.2.2.2')
      .send({ username: 'test', password: 'test' });
    expect(allowed.status).toBe(200);
  });
});
