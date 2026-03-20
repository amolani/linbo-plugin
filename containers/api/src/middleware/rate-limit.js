/**
 * LINBO Docker - Rate Limiting Middleware
 * Login rate limiter using express-rate-limit with Redis-backed store.
 *
 * Limits login attempts to 5 per minute per IP address.
 * Uses Redis store in production for distributed counting,
 * falls back to in-memory store in test or when Redis is unavailable.
 */

const { rateLimit } = require('express-rate-limit');

/**
 * Create a rate limiter for login attempts.
 * @param {object} [options] - Override options (useful for testing)
 * @param {object} [options.store] - Custom store (default: Redis in production, memory in test)
 */
function createLoginLimiter(options = {}) {
  let store = options.store;

  // Default to Redis store in non-test environments
  if (!store && process.env.NODE_ENV !== 'test') {
    try {
      const { RedisStore } = require('rate-limit-redis');
      const redis = require('../lib/redis');
      store = new RedisStore({
        sendCommand: (command, ...args) => redis.getClient().call(command, ...args),
        prefix: 'rl:login:',
      });
    } catch (err) {
      console.warn('[rate-limit] Redis store unavailable, falling back to in-memory store:', err.message);
      // Falls through to default in-memory store
    }
  }

  return rateLimit({
    windowMs: 60 * 1000,           // 1 minute
    limit: 5,                       // 5 attempts per window
    standardHeaders: 'draft-7',     // RateLimit-* headers
    legacyHeaders: false,           // no X-RateLimit-* headers
    // Default keyGenerator uses req.ip with IPv6 normalization
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many login attempts. Please try again later.',
      },
    },
    ...(store ? { store } : {}),
  });
}

const loginLimiter = createLoginLimiter();

module.exports = { loginLimiter, createLoginLimiter };
