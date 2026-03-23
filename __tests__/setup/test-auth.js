/**
 * Test Auth Helpers
 *
 * Generates valid JWT tokens for use in integration tests.
 */

'use strict';

const { generateToken } = require('../../src/middleware/auth');

function createAdminToken(overrides = {}) {
  return generateToken({
    id: 'test-admin-1',
    username: 'testadmin',
    email: 'admin@test.local',
    role: 'admin',
    ...overrides,
  });
}

function createViewerToken(overrides = {}) {
  return generateToken({
    id: 'test-viewer-1',
    username: 'testviewer',
    email: 'viewer@test.local',
    role: 'viewer',
    ...overrides,
  });
}

function getInternalKey() {
  return process.env.INTERNAL_API_KEY;
}

module.exports = { createAdminToken, createViewerToken, getInternalKey };
