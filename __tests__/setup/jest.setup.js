/**
 * Jest Global Setup
 *
 * Sets environment variables BEFORE any module loads (critical for auth.js
 * which reads JWT_SECRET at module scope and throws if missing).
 *
 * Resets the in-memory store between tests for isolation.
 */

'use strict';

// Must be set before any require() of src/ modules
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest-do-not-use-in-production';
process.env.INTERNAL_API_KEY = 'test-internal-key';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'testpassword';
process.env.LINBO_DIR = '/tmp/linbo-test';
process.env.STORE_SNAPSHOT = '/tmp/linbo-test-store.json';
process.env.PID_FILE = '/tmp/linbo-test.pid';

// Silence console output during tests (pino is already silent via NODE_ENV=test)
const _origLog = console.log;
const _origWarn = console.warn;
const _origDebug = console.debug;

beforeAll(() => {
  console.log = jest.fn();
  console.warn = jest.fn();
  console.debug = jest.fn();
});

afterAll(() => {
  console.log = _origLog;
  console.warn = _origWarn;
  console.debug = _origDebug;
});

// Reset in-memory store between each test for isolation
afterEach(() => {
  try {
    const { reset } = require('../../src/lib/store');
    reset();
  } catch {
    // Store not yet loaded — nothing to reset
  }
});
