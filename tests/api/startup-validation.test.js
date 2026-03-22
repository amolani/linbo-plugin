/**
 * LINBO Docker - Startup Secrets Validation Tests
 * Tests for validateSecrets() logic (extracted, no server startup needed)
 */

// Known insecure defaults (must match index.js)
const JWT_SECRET_DEFAULTS = [
  'linbo-docker-secret-change-in-production',
  'your_jwt_secret_here_change_in_production',
  'your_jwt_secret_here_change_me_in_production_use_openssl_rand',
  'development_secret_change_in_production',
];
const INTERNAL_KEY_DEFAULTS = [
  'linbo-internal-secret',
  'linbo-internal-secret-change-in-production',
];

/**
 * Pure function extracted from index.js — validates secrets against known defaults.
 * Returns { shouldExit, issues, corsWarning } instead of calling process.exit directly.
 */
function checkSecrets(env) {
  const issues = [];
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.trim() === '') {
    issues.push('JWT_SECRET is not set');
  } else if (JWT_SECRET_DEFAULTS.includes(jwtSecret)) {
    issues.push('JWT_SECRET is using a known default value');
  }
  const internalKey = env.INTERNAL_API_KEY;
  if (!internalKey || internalKey.trim() === '') {
    issues.push('INTERNAL_API_KEY is not set');
  } else if (INTERNAL_KEY_DEFAULTS.includes(internalKey)) {
    issues.push('INTERNAL_API_KEY is using a known default value');
  }
  const corsWarning = env.CORS_ORIGIN === '*';
  const nodeEnv = env.NODE_ENV || 'development';
  const shouldExit = nodeEnv === 'production' && issues.length > 0;
  const shouldWarn = nodeEnv !== 'test' && nodeEnv !== 'production' && issues.length > 0;
  return { shouldExit, shouldWarn, issues, corsWarning };
}

describe('validateSecrets', () => {
  test('production + default JWT_SECRET → should exit', () => {
    const result = checkSecrets({
      NODE_ENV: 'production',
      JWT_SECRET: 'linbo-docker-secret-change-in-production',
      INTERNAL_API_KEY: 'some-secure-key-abc',
    });
    expect(result.shouldExit).toBe(true);
    expect(result.issues).toHaveLength(1);
  });

  test('production + default INTERNAL_API_KEY → should exit', () => {
    const result = checkSecrets({
      NODE_ENV: 'production',
      JWT_SECRET: 'some-secure-secret-abc',
      INTERNAL_API_KEY: 'linbo-internal-secret',
    });
    expect(result.shouldExit).toBe(true);
    expect(result.issues).toHaveLength(1);
  });

  test('production + undefined JWT_SECRET → should exit', () => {
    const result = checkSecrets({
      NODE_ENV: 'production',
      INTERNAL_API_KEY: 'some-secure-key-abc',
    });
    expect(result.shouldExit).toBe(true);
  });

  test('production + undefined INTERNAL_API_KEY → should exit', () => {
    const result = checkSecrets({
      NODE_ENV: 'production',
      JWT_SECRET: 'some-secure-secret-abc',
    });
    expect(result.shouldExit).toBe(true);
  });

  test('production + non-default values → no exit', () => {
    const result = checkSecrets({
      NODE_ENV: 'production',
      JWT_SECRET: 'my-real-production-jwt-secret-2026',
      INTERNAL_API_KEY: 'my-real-production-internal-key-2026',
    });
    expect(result.shouldExit).toBe(false);
    expect(result.issues).toHaveLength(0);
  });

  test('development + defaults → warn but no exit', () => {
    const result = checkSecrets({
      NODE_ENV: 'development',
      JWT_SECRET: 'linbo-docker-secret-change-in-production',
      INTERNAL_API_KEY: 'linbo-internal-secret',
    });
    expect(result.shouldExit).toBe(false);
    expect(result.shouldWarn).toBe(true);
    expect(result.issues).toHaveLength(2);
  });

  test('test mode + defaults → no exit, no warn', () => {
    const result = checkSecrets({
      NODE_ENV: 'test',
      JWT_SECRET: 'linbo-docker-secret-change-in-production',
      INTERNAL_API_KEY: 'linbo-internal-secret',
    });
    expect(result.shouldExit).toBe(false);
    expect(result.shouldWarn).toBe(false);
  });

  test('CORS_ORIGIN=* → cors warning', () => {
    const result = checkSecrets({
      NODE_ENV: 'production',
      CORS_ORIGIN: '*',
      JWT_SECRET: 'my-real-production-jwt-secret-2026',
      INTERNAL_API_KEY: 'my-real-production-internal-key-2026',
    });
    expect(result.corsWarning).toBe(true);
    expect(result.shouldExit).toBe(false);
  });

  test('CORS_ORIGIN specific → no cors warning', () => {
    const result = checkSecrets({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://myapp.example.com',
      JWT_SECRET: 'my-real-production-jwt-secret-2026',
      INTERNAL_API_KEY: 'my-real-production-internal-key-2026',
    });
    expect(result.corsWarning).toBe(false);
  });
});
