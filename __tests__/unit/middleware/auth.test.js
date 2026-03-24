'use strict';

const jwt = require('jsonwebtoken');
const {
  generateToken,
  verifyToken,
  hashPassword,
  comparePassword,
  authenticateToken,
  requireRole,
  optionalAuth,
  JWT_SECRET,
  JWT_EXPIRES_IN,
} = require('../../../src/middleware/auth');

// ---------------------------------------------------------------------------
// Mock helpers for Express middleware
// ---------------------------------------------------------------------------

const mockReq = (overrides = {}) => ({ headers: {}, ...overrides });
const mockRes = () => {
  const res = { statusCode: 200 };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn();
  return res;
};
const mockNext = () => jest.fn();

const testUser = {
  id: 'user-1',
  username: 'alice',
  email: 'alice@school.local',
  role: 'admin',
};

// ---------------------------------------------------------------------------
// generateToken
// ---------------------------------------------------------------------------

describe('auth — generateToken', () => {
  it('returns a string', () => {
    const token = generateToken(testUser);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
  });

  it('embeds the correct payload fields', () => {
    const token = generateToken(testUser);
    const decoded = jwt.decode(token);
    expect(decoded.id).toBe(testUser.id);
    expect(decoded.username).toBe(testUser.username);
    expect(decoded.email).toBe(testUser.email);
    expect(decoded.role).toBe(testUser.role);
  });

  it('does not embed extra user fields', () => {
    const token = generateToken({ ...testUser, passwordHash: 'secret' });
    const decoded = jwt.decode(token);
    expect(decoded.passwordHash).toBeUndefined();
  });

  it('sets an expiration claim', () => {
    const token = generateToken(testUser);
    const decoded = jwt.decode(token);
    expect(decoded.exp).toBeDefined();
    expect(decoded.iat).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// verifyToken
// ---------------------------------------------------------------------------

describe('auth — verifyToken', () => {
  it('round-trips with generateToken', () => {
    const token = generateToken(testUser);
    const decoded = verifyToken(token);
    expect(decoded.id).toBe(testUser.id);
    expect(decoded.username).toBe(testUser.username);
    expect(decoded.role).toBe(testUser.role);
  });

  it('throws on expired token', () => {
    const token = jwt.sign({ id: 'u1' }, JWT_SECRET, { expiresIn: '0s' });
    expect(() => verifyToken(token)).toThrow(jwt.TokenExpiredError);
  });

  it('throws on tampered token', () => {
    const token = generateToken(testUser);
    const tampered = token.slice(0, -4) + 'XXXX';
    expect(() => verifyToken(tampered)).toThrow(jwt.JsonWebTokenError);
  });

  it('throws on token signed with wrong secret', () => {
    const token = jwt.sign({ id: 'u1' }, 'wrong-secret', { expiresIn: '1h' });
    expect(() => verifyToken(token)).toThrow(jwt.JsonWebTokenError);
  });
});

// ---------------------------------------------------------------------------
// hashPassword / comparePassword
// ---------------------------------------------------------------------------

describe('auth — hashPassword & comparePassword', () => {
  it('hashPassword returns a bcrypt hash string', async () => {
    const hash = await hashPassword('my-password');
    expect(typeof hash).toBe('string');
    expect(hash).toMatch(/^\$2[aby]?\$/); // bcrypt prefix
  });

  it('comparePassword returns true for correct password', async () => {
    const hash = await hashPassword('correct-horse');
    const result = await comparePassword('correct-horse', hash);
    expect(result).toBe(true);
  });

  it('comparePassword returns false for wrong password', async () => {
    const hash = await hashPassword('correct-horse');
    const result = await comparePassword('wrong-horse', hash);
    expect(result).toBe(false);
  });

  it('different calls produce different hashes (random salt)', async () => {
    const h1 = await hashPassword('same');
    const h2 = await hashPassword('same');
    expect(h1).not.toBe(h2);
  });
});

// ---------------------------------------------------------------------------
// authenticateToken middleware
// ---------------------------------------------------------------------------

describe('auth — authenticateToken', () => {
  it('sets req.user and calls next() for valid JWT', () => {
    const token = generateToken(testUser);
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = mockNext();

    authenticateToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.id).toBe(testUser.id);
    expect(req.user.username).toBe(testUser.username);
    expect(req.user.role).toBe(testUser.role);
  });

  it('returns 401 UNAUTHORIZED when no token is provided', () => {
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    authenticateToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'UNAUTHORIZED', message: 'Access token required' }),
      })
    );
  });

  it('accepts INTERNAL_API_KEY as Bearer token', () => {
    const internalKey = process.env.INTERNAL_API_KEY;
    const req = mockReq({ headers: { authorization: `Bearer ${internalKey}` } });
    const res = mockRes();
    const next = mockNext();

    authenticateToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({ id: 'internal', username: 'internal-service', role: 'admin' });
  });

  it('accepts INTERNAL_API_KEY via X-Internal-Key header', () => {
    const internalKey = process.env.INTERNAL_API_KEY;
    const req = mockReq({ headers: { 'x-internal-key': internalKey } });
    const res = mockRes();
    const next = mockNext();

    authenticateToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({ id: 'internal', username: 'internal-service', role: 'admin' });
  });

  it('returns 401 TOKEN_EXPIRED for expired JWT', () => {
    const token = jwt.sign({ id: 'u1' }, JWT_SECRET, { expiresIn: '0s' });
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = mockNext();

    authenticateToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'TOKEN_EXPIRED' }),
      })
    );
  });

  it('returns 403 INVALID_TOKEN for tampered JWT', () => {
    const token = generateToken(testUser);
    const tampered = token.slice(0, -4) + 'XXXX';
    const req = mockReq({ headers: { authorization: `Bearer ${tampered}` } });
    const res = mockRes();
    const next = mockNext();

    authenticateToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'INVALID_TOKEN' }),
      })
    );
  });

  it('returns 401 when Authorization header has no Bearer prefix', () => {
    const token = generateToken(testUser);
    const req = mockReq({ headers: { authorization: token } }); // missing "Bearer "
    const res = mockRes();
    const next = mockNext();

    authenticateToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects wrong X-Internal-Key value', () => {
    const req = mockReq({ headers: { 'x-internal-key': 'wrong-key' } });
    const res = mockRes();
    const next = mockNext();

    authenticateToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ---------------------------------------------------------------------------
// requireRole middleware factory
// ---------------------------------------------------------------------------

describe('auth — requireRole', () => {
  it('calls next() when user role is in allowedRoles', () => {
    const middleware = requireRole(['admin', 'teacher']);
    const req = mockReq({ user: { id: 'u1', role: 'admin' } });
    const res = mockRes();
    const next = mockNext();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 403 FORBIDDEN when user role is not in allowedRoles', () => {
    const middleware = requireRole(['admin']);
    const req = mockReq({ user: { id: 'u1', role: 'viewer' } });
    const res = mockRes();
    const next = mockNext();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'FORBIDDEN' }),
      })
    );
  });

  it('returns 401 UNAUTHORIZED when req.user is not set', () => {
    const middleware = requireRole(['admin']);
    const req = mockReq(); // no user
    const res = mockRes();
    const next = mockNext();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'UNAUTHORIZED' }),
      })
    );
  });

  it('works with a single-element allowedRoles array', () => {
    const middleware = requireRole(['teacher']);
    const req = mockReq({ user: { id: 'u1', role: 'teacher' } });
    const res = mockRes();
    const next = mockNext();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// optionalAuth middleware
// ---------------------------------------------------------------------------

describe('auth — optionalAuth', () => {
  it('sets req.user for a valid token', () => {
    const token = generateToken(testUser);
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = mockNext();

    optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(testUser.id);
  });

  it('calls next() without req.user when no token is provided', () => {
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
  });

  it('calls next() without req.user when token is invalid', () => {
    const req = mockReq({ headers: { authorization: 'Bearer invalid.token.here' } });
    const res = mockRes();
    const next = mockNext();

    optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
  });

  it('calls next() without req.user when token is expired', () => {
    const token = jwt.sign({ id: 'u1' }, JWT_SECRET, { expiresIn: '0s' });
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = mockNext();

    optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Module-level exports sanity
// ---------------------------------------------------------------------------

describe('auth — module exports', () => {
  it('exports JWT_SECRET matching env variable', () => {
    expect(JWT_SECRET).toBe(process.env.JWT_SECRET);
  });

  it('exports JWT_EXPIRES_IN with a default value', () => {
    expect(typeof JWT_EXPIRES_IN).toBe('string');
    // The module uses process.env.JWT_EXPIRES_IN || '24h' at load time.
    // When the env var is set (e.g. by another test project's globalSetup),
    // the exported value reflects that; otherwise it defaults to '24h'.
    const expected = process.env.JWT_EXPIRES_IN || '24h';
    expect(JWT_EXPIRES_IN).toBe(expected);
  });
});
