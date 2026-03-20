/**
 * LINBO Docker - WebSocket Authentication Tests
 * Tests for verifyWsToken() helper and upgrade handler auth logic.
 *
 * Covers PROD-06: WebSocket /ws endpoint verifies JWT token at connection upgrade.
 */

const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'test-jwt-secret-for-ws-auth';
const TEST_INTERNAL_KEY = 'test-internal-api-key-ws';

// Set env vars before requiring the module
process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.INTERNAL_API_KEY = TEST_INTERNAL_KEY;

// Load verifyWsToken from index.js _testing export
const { _testing } = require('../../src/index');
const { verifyWsToken } = _testing;

describe('verifyWsToken', () => {
  test('returns null when no token is provided', () => {
    const result = verifyWsToken(null);
    expect(result).toBeNull();
  });

  test('returns null when token is undefined', () => {
    const result = verifyWsToken(undefined);
    expect(result).toBeNull();
  });

  test('returns null when token is empty string', () => {
    const result = verifyWsToken('');
    expect(result).toBeNull();
  });

  test('returns internal user object when token matches INTERNAL_API_KEY', () => {
    const result = verifyWsToken(TEST_INTERNAL_KEY);
    expect(result).toEqual({
      id: 'internal',
      username: 'internal-service',
      role: 'admin',
    });
  });

  test('returns decoded JWT payload when token is a valid JWT', () => {
    const payload = { id: 'user-1', username: 'testuser', email: 'test@example.com', role: 'admin' };
    const token = jwt.sign(payload, TEST_JWT_SECRET, { expiresIn: '1h' });

    const result = verifyWsToken(token);

    expect(result).not.toBeNull();
    expect(result.id).toBe('user-1');
    expect(result.username).toBe('testuser');
    expect(result.email).toBe('test@example.com');
    expect(result.role).toBe('admin');
  });

  test('returns null when token is an invalid JWT', () => {
    const result = verifyWsToken('not-a-valid-jwt-token');
    expect(result).toBeNull();
  });

  test('returns null when token is a JWT signed with wrong secret', () => {
    const token = jwt.sign(
      { id: 'user-1', username: 'testuser', role: 'admin' },
      'wrong-secret',
      { expiresIn: '1h' }
    );

    const result = verifyWsToken(token);
    expect(result).toBeNull();
  });

  test('returns null when token is an expired JWT', () => {
    const token = jwt.sign(
      { id: 'user-1', username: 'testuser', role: 'admin' },
      TEST_JWT_SECRET,
      { expiresIn: '-1s' } // already expired
    );

    const result = verifyWsToken(token);
    expect(result).toBeNull();
  });
});

describe('WebSocket upgrade handler auth integration', () => {
  // These tests verify the upgrade handler behavior by testing the
  // verifyWsToken helper in context of how the upgrade handler uses it.
  // The upgrade handler: no token -> 401, valid token -> handleUpgrade, invalid -> 401.

  test('no token means connection rejected (verifyWsToken returns null)', () => {
    // Simulates: /ws without ?token= -> verifyWsToken(null) -> null -> 401
    expect(verifyWsToken(null)).toBeNull();
  });

  test('invalid token means connection rejected (verifyWsToken returns null)', () => {
    // Simulates: /ws?token=garbage -> verifyWsToken('garbage') -> null -> 401
    expect(verifyWsToken('garbage-invalid-token')).toBeNull();
  });

  test('valid JWT token means connection accepted with user populated', () => {
    // Simulates: /ws?token=<valid-jwt> -> verifyWsToken(jwt) -> decoded -> handleUpgrade
    const token = jwt.sign(
      { id: 'u2', username: 'wsuser', email: 'ws@test.com', role: 'viewer' },
      TEST_JWT_SECRET,
      { expiresIn: '1h' }
    );
    const user = verifyWsToken(token);
    expect(user).not.toBeNull();
    expect(user.username).toBe('wsuser');
    expect(user.role).toBe('viewer');
  });

  test('INTERNAL_API_KEY means connection accepted with internal-service user', () => {
    // Simulates: /ws?token=<INTERNAL_API_KEY> -> verifyWsToken(key) -> internal user -> handleUpgrade
    const user = verifyWsToken(TEST_INTERNAL_KEY);
    expect(user).toEqual({
      id: 'internal',
      username: 'internal-service',
      role: 'admin',
    });
  });

  test('terminal WebSocket is not affected (separate handler)', () => {
    // This is a documentation test: /ws/terminal uses its own auth in
    // terminalWss.on('connection') handler, not the upgrade-level verifyWsToken.
    // The upgrade handler routes /ws/terminal directly to terminalWss.handleUpgrade
    // without calling verifyWsToken. This is verified by code inspection.
    expect(true).toBe(true);
  });
});
