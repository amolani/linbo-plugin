/**
 * LINBO Native - Rate Limiting Middleware
 * Login rate limiter using express-rate-limit with in-memory store.
 *
 * Limits login attempts to 5 per minute per IP address.
 * Redis rate limiting removed in Phase 4 -- in-memory resets on restart.
 * Acceptable for single-process school server (no distributed counting needed).
 */

const { rateLimit } = require('express-rate-limit');

/**
 * Create a rate limiter for login attempts.
 * @param {object} [options] - Override options (useful for testing)
 * @param {object} [options.store] - Custom store (default: in-memory MemoryStore)
 */
function createLoginLimiter(options = {}) {
  // Redis rate limiting removed in Phase 4 -- in-memory resets on restart.
  // Acceptable for single-process school server (no distributed counting needed).
  const store = options.store;

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
