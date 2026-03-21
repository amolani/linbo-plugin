/**
 * LINBO Plugin - Auth Routes
 * POST /auth/login, /auth/logout, GET /auth/me
 *
 * Sync-only mode: env-admin login via ADMIN_USERNAME/ADMIN_PASSWORD.
 * No database user management.
 */

const express = require('express');
const router = express.Router();

const {
  generateToken,
  verifyToken,
  authenticateToken,
  JWT_SECRET,
} = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const { validateBody, loginSchema } = require('../middleware/validate');
const { loginLimiter } = require('../middleware/rate-limit');

// Audit middleware: optional
let auditAction;
try {
  auditAction = require('../middleware/audit').auditAction;
} catch {
  auditAction = () => (req, res, next) => next();
}

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login and get JWT token
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username: { type: string, example: admin }
 *               password: { type: string, example: changeme }
 *     responses:
 *       200: { description: JWT token returned }
 *       401: { description: Invalid credentials }
 *       429: { description: Rate limited (5/min) }
 */
router.post(
  '/login',
  loginLimiter,
  validateBody(loginSchema),
  auditAction('auth.login', {
    getTargetType: () => 'user',
    getTargetId: () => null,
    getTargetName: (req) => req.body.username,
    getChanges: () => ({}), // Don't log password
  }),
  async (req, res, next) => {
    try {
      const { username, password } = req.body;

      const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
      const settingsService = require('../services/settings.service');

      if (username === ADMIN_USER) {
        const passwordOk = await settingsService.checkAdminPassword(password);
        if (passwordOk) {
          const token = generateToken({
            id: 'env-admin',
            username: ADMIN_USER,
            email: null,
            role: 'admin',
          });
          return res.json({
            data: {
              token,
              user: {
                id: 'env-admin',
                username: ADMIN_USER,
                role: 'admin',
              },
            },
          });
        }
      }

      return res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid username or password',
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Refresh JWT token (accepts expired tokens up to 7 days old)
 *     responses:
 *       200: { description: New JWT token }
 *       401: { description: Token too old or invalid }
 */
router.post('/refresh', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Token required for refresh' },
      });
    }

    // Accept expired tokens (up to 7 days) for refresh
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
    } catch {
      return res.status(401).json({
        error: { code: 'INVALID_TOKEN', message: 'Token is invalid' },
      });
    }

    // Reject tokens older than 7 days (force re-login)
    const MAX_REFRESH_AGE = 7 * 24 * 60 * 60; // 7 days in seconds
    const tokenAge = Math.floor(Date.now() / 1000) - (decoded.iat || 0);
    if (tokenAge > MAX_REFRESH_AGE) {
      return res.status(401).json({
        error: { code: 'TOKEN_TOO_OLD', message: 'Token is too old for refresh. Please login again.' },
      });
    }

    // Issue new token with same claims
    const newToken = generateToken({
      id: decoded.id,
      username: decoded.username,
      email: decoded.email || null,
      role: decoded.role,
    });

    return res.json({
      data: {
        token: newToken,
        user: {
          id: decoded.id,
          username: decoded.username,
          role: decoded.role,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Logout (invalidate token client-side)
 *     responses:
 *       200: { description: Logged out }
 */
router.post(
  '/logout',
  authenticateToken,
  auditAction('auth.logout'),
  async (req, res) => {
    // In a stateless JWT setup, logout is handled client-side
    res.json({
      data: {
        message: 'Logged out successfully',
      },
    });
  }
);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get current authenticated user
 *     responses:
 *       200: { description: User info }
 *       401: { description: Not authenticated }
 */
router.get('/me', authenticateToken, async (req, res, next) => {
  try {
    // Env-admin user
    if (req.user.id === 'env-admin') {
      return res.json({
        data: {
          id: 'env-admin',
          username: req.user.username,
          email: null,
          role: 'admin',
          active: true,
          lastLogin: null,
          createdAt: null,
        },
      });
    }

    // Internal service user
    if (req.user.id === 'internal') {
      return res.json({
        data: {
          id: 'internal',
          username: 'internal-service',
          email: null,
          role: 'admin',
          active: true,
          lastLogin: null,
          createdAt: null,
        },
      });
    }

    // No other user types are supported without a database
    return res.status(404).json({
      error: {
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
