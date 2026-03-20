/**
 * LINBO Docker - authenticateToken X-Internal-Key Tests
 *
 * Tests that authenticateToken middleware accepts X-Internal-Key header
 * as an alternative to Authorization: Bearer for INTERNAL_API_KEY auth.
 */

const TEST_INTERNAL_KEY = 'test-internal-key-abc123';
const TEST_JWT_SECRET = 'test-jwt-secret-for-auth-tests';

// Set env vars before requiring the module
process.env.INTERNAL_API_KEY = TEST_INTERNAL_KEY;
process.env.JWT_SECRET = TEST_JWT_SECRET;

const jwt = require('jsonwebtoken');
const { authenticateToken } = require('../../src/middleware/auth');

/**
 * Helper: create mock Express req/res/next
 */
function createMocks(headers = {}) {
  const req = {
    headers: { ...headers },
  };
  const res = {
    _status: null,
    _json: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(data) {
      this._json = data;
      return this;
    },
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('authenticateToken - X-Internal-Key support', () => {
  test('returns 200 when X-Internal-Key header matches INTERNAL_API_KEY (no Authorization header)', () => {
    const { req, res, next } = createMocks({
      'x-internal-key': TEST_INTERNAL_KEY,
    });

    authenticateToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({
      id: 'internal',
      username: 'internal-service',
      role: 'admin',
    });
    expect(res._status).toBeNull(); // no error response
  });

  test('returns 401 when X-Internal-Key header has wrong value (no Authorization header)', () => {
    const { req, res, next } = createMocks({
      'x-internal-key': 'wrong-key-value',
    });

    authenticateToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect(res._json.error.code).toBe('UNAUTHORIZED');
  });

  test('returns 401 when neither Authorization nor X-Internal-Key header present', () => {
    const { req, res, next } = createMocks({});

    authenticateToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect(res._json.error.code).toBe('UNAUTHORIZED');
  });

  test('still works with Authorization: Bearer INTERNAL_API_KEY (existing behavior preserved)', () => {
    const { req, res, next } = createMocks({
      authorization: `Bearer ${TEST_INTERNAL_KEY}`,
    });

    authenticateToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({
      id: 'internal',
      username: 'internal-service',
      role: 'admin',
    });
  });

  test('still works with valid JWT in Authorization: Bearer (existing behavior preserved)', () => {
    const token = jwt.sign(
      { id: 'user-1', username: 'testadmin', email: 'test@example.com', role: 'admin' },
      TEST_JWT_SECRET,
      { expiresIn: '1h' }
    );
    const { req, res, next } = createMocks({
      authorization: `Bearer ${token}`,
    });

    authenticateToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.username).toBe('testadmin');
    expect(req.user.role).toBe('admin');
  });

  test('when both Authorization: Bearer and X-Internal-Key are present, Authorization: Bearer takes precedence', () => {
    // Use a valid JWT as Bearer — this should be used (not X-Internal-Key)
    const token = jwt.sign(
      { id: 'user-2', username: 'jwtuser', email: 'jwt@example.com', role: 'viewer' },
      TEST_JWT_SECRET,
      { expiresIn: '1h' }
    );
    const { req, res, next } = createMocks({
      authorization: `Bearer ${token}`,
      'x-internal-key': TEST_INTERNAL_KEY,
    });

    authenticateToken(req, res, next);

    expect(next).toHaveBeenCalled();
    // Should use the JWT user, not internal-service
    expect(req.user.username).toBe('jwtuser');
    expect(req.user.role).toBe('viewer');
  });
});
