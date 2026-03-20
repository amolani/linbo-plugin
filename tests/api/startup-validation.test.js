/**
 * LINBO Docker - Startup Secrets Validation Tests
 * Tests for validateSecrets() function in index.js
 */

describe('validateSecrets', () => {
  let validateSecrets;
  let exitSpy;
  let warnSpy;
  let errorSpy;

  // Save original env
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env to clean state
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'some-secure-production-secret-abc123';
    process.env.INTERNAL_API_KEY = 'some-secure-internal-key-xyz789';

    // Spy on process.exit (prevent actual exit)
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore env
    process.env.NODE_ENV = originalEnv.NODE_ENV;
    process.env.JWT_SECRET = originalEnv.JWT_SECRET;
    process.env.INTERNAL_API_KEY = originalEnv.INTERNAL_API_KEY;
    if (originalEnv.CORS_ORIGIN !== undefined) {
      process.env.CORS_ORIGIN = originalEnv.CORS_ORIGIN;
    } else {
      delete process.env.CORS_ORIGIN;
    }

    // Restore spies
    exitSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  beforeAll(() => {
    // Load validateSecrets from index.js _testing export
    const index = require('../src/index');
    validateSecrets = index._testing.validateSecrets;
  });

  // Test 1: production + default JWT_SECRET -> exit(1)
  test('exits with code 1 when NODE_ENV=production and JWT_SECRET is a known default', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'linbo-docker-secret-change-in-production';
    process.env.INTERNAL_API_KEY = 'some-secure-key-abc';

    validateSecrets();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  // Test 2: production + default INTERNAL_API_KEY -> exit(1)
  test('exits with code 1 when NODE_ENV=production and INTERNAL_API_KEY is a known default', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'some-secure-secret-abc';
    process.env.INTERNAL_API_KEY = 'linbo-internal-secret';

    validateSecrets();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  // Test 3: production + undefined/empty JWT_SECRET -> exit(1)
  test('exits with code 1 when NODE_ENV=production and JWT_SECRET is undefined', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    process.env.INTERNAL_API_KEY = 'some-secure-key-abc';

    validateSecrets();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  // Test 4: production + undefined/empty INTERNAL_API_KEY -> exit(1)
  test('exits with code 1 when NODE_ENV=production and INTERNAL_API_KEY is undefined', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'some-secure-secret-abc';
    delete process.env.INTERNAL_API_KEY;

    validateSecrets();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  // Test 5: production + non-default values -> no exit
  test('does NOT exit when NODE_ENV=production and both secrets have non-default values', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'my-real-production-jwt-secret-2026';
    process.env.INTERNAL_API_KEY = 'my-real-production-internal-key-2026';

    validateSecrets();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  // Test 6: development + defaults -> warn but no exit
  test('logs warning but does NOT exit when NODE_ENV=development and defaults are used', () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'linbo-docker-secret-change-in-production';
    process.env.INTERNAL_API_KEY = 'linbo-internal-secret';

    validateSecrets();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  // Test 7: test mode + defaults -> no exit, no warn
  test('does NOT exit when NODE_ENV=test and defaults are used', () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'linbo-docker-secret-change-in-production';
    process.env.INTERNAL_API_KEY = 'linbo-internal-secret';

    validateSecrets();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  // Test 8: CORS_ORIGIN=* -> warn
  test('logs warning when CORS_ORIGIN=* in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = '*';
    process.env.JWT_SECRET = 'my-real-production-jwt-secret-2026';
    process.env.INTERNAL_API_KEY = 'my-real-production-internal-key-2026';

    validateSecrets();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('CORS_ORIGIN')
    );
  });

  // Test 9: CORS_ORIGIN set to specific origin -> no warn
  test('does NOT warn when CORS_ORIGIN is a specific origin', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://myapp.example.com';
    process.env.JWT_SECRET = 'my-real-production-jwt-secret-2026';
    process.env.INTERNAL_API_KEY = 'my-real-production-internal-key-2026';

    validateSecrets();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
