/**
 * LINBO Plugin - Authentication Middleware
 * JWT authentication with role-based access control.
 * Runs in sync-only mode (Redis, no PostgreSQL/Prisma).
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || 'linbo-docker-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

/**
 * Generate JWT token for user
 * @param {object} user - User object from database
 */
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Verify JWT token
 * @param {string} token - JWT token
 */
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Hash password
 * @param {string} password - Plain text password
 */
async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

/**
 * Compare password with hash
 * @param {string} password - Plain text password
 * @param {string} hash - Password hash
 */
async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Middleware: Authenticate JWT token from Authorization header
 * Also accepts INTERNAL_API_KEY as Bearer token or X-Internal-Key header
 * for container-to-container and script-based auth.
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  // If no Bearer token, check X-Internal-Key header (system routes accept both)
  if (!token) {
    const internalKeyHeader = req.headers['x-internal-key'];
    const internalKey = process.env.INTERNAL_API_KEY;
    if (internalKey && internalKeyHeader && internalKeyHeader === internalKey) {
      req.user = { id: 'internal', username: 'internal-service', role: 'admin' };
      return next();
    }
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Access token required',
      },
    });
  }

  // Check for internal API key as Bearer token (existing behavior)
  const internalKey = process.env.INTERNAL_API_KEY;
  if (internalKey && token === internalKey) {
    req.user = { id: 'internal', username: 'internal-service', role: 'admin' };
    return next();
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Access token has expired',
        },
      });
    }
    return res.status(403).json({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid access token',
      },
    });
  }
}

/**
 * Middleware factory: Require specific roles
 * @param {string[]} allowedRoles - Array of allowed role names
 */
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: `This action requires one of these roles: ${allowedRoles.join(', ')}`,
        },
      });
    }

    next();
  };
}

/**
 * Optional authentication - populates req.user if token is valid, but doesn't fail if missing
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = verifyToken(token);
      req.user = decoded;
    } catch {
      // Token invalid, but that's OK for optional auth
    }
  }
  next();
}

module.exports = {
  generateToken,
  verifyToken,
  hashPassword,
  comparePassword,
  authenticateToken,
  requireRole,
  optionalAuth,
  JWT_SECRET,
  JWT_EXPIRES_IN,
};
