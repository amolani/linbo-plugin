'use strict';

const {
  createLoginLimiter,
  loginLimiter,
  writeLimiter,
} = require('../../../src/middleware/rate-limit');

// ---------------------------------------------------------------------------
// createLoginLimiter factory
// ---------------------------------------------------------------------------

describe('rate-limit — createLoginLimiter', () => {
  it('returns a function (middleware)', () => {
    const limiter = createLoginLimiter();
    expect(typeof limiter).toBe('function');
  });

  it('accepts a custom store option', () => {
    const fakeStore = { init: jest.fn(), increment: jest.fn(), decrement: jest.fn(), resetKey: jest.fn() };
    const limiter = createLoginLimiter({ store: fakeStore });
    expect(typeof limiter).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Pre-created instances
// ---------------------------------------------------------------------------

describe('rate-limit — pre-created instances', () => {
  it('loginLimiter is a function', () => {
    expect(typeof loginLimiter).toBe('function');
  });

  it('writeLimiter is a function', () => {
    expect(typeof writeLimiter).toBe('function');
  });

  it('loginLimiter and writeLimiter are different instances', () => {
    expect(loginLimiter).not.toBe(writeLimiter);
  });

  it('loginLimiter accepts standard Express middleware arguments', () => {
    // Verify the middleware signature (req, res, next) is callable
    expect(loginLimiter.length).toBeGreaterThanOrEqual(2);
  });
});
