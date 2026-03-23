'use strict';

const express = require('express');
const crypto = require('crypto');

let _app = null;

/**
 * Create a minimal Express app for Supertest integration tests.
 *
 * Mirrors the middleware and route setup of src/index.js but omits
 * server-only concerns: WebSocket, PID file, sync timers, Swagger,
 * helmet, cors, morgan, and rate limiting.
 *
 * The app instance is cached so multiple test files share one import
 * without re-mounting routes.
 */
async function createTestApp() {
  if (_app) return _app;

  const app = express();

  // Body parser (matches src/index.js)
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Request ID middleware (matches src/index.js)
  app.use((req, res, next) => {
    req.requestId = `req_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    res.setHeader('X-Request-ID', req.requestId);
    next();
  });

  // Health endpoint (simplified — no WebSocket or filesystem checks)
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '2.1.0',
    });
  });

  // Ready endpoint
  app.get('/ready', (req, res) => {
    res.json({
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  });

  // Mount all API routes
  const createRouter = require('../../src/routes');
  const apiRoutes = await createRouter();
  app.use('/api/v1', apiRoutes);

  // 404 handler (matches src/index.js)
  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.path} not found`,
        requestId: req.requestId,
      },
    });
  });

  // Global error handler (matches src/index.js patterns)
  app.use((err, req, res, _next) => {
    // Zod validation errors
    if (err.name === 'ZodError') {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: err.errors,
          requestId: req.requestId,
        },
      });
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: {
          code: 'AUTH_ERROR',
          message: err.message,
          requestId: req.requestId,
        },
      });
    }

    // Generic errors
    res.status(err.status || 500).json({
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: err.message || 'Internal server error',
        requestId: req.requestId,
      },
    });
  });

  _app = app;
  return app;
}

module.exports = { createTestApp };
