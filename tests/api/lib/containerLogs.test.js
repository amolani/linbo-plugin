/**
 * LINBO Docker - containerLogs Phase 5 Requirements (RED tests)
 *
 * TDD Wave 1: These tests define the contract for Phase 5 implementation.
 * They FAIL on the current Docker-based containerLogs.js and turn GREEN
 * when Plan 02 replaces Docker dependencies with journald/graceful stubs.
 *
 * Covers: API-05 (no Docker deps), API-06 (no Docker hostnames), API-08 (graceful degradation)
 */

const fs = require('fs');
const path = require('path');

// Resolve project root (tests/api/lib -> project root is 3 levels up)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

describe('containerLogs — Phase 5 requirements', () => {
  // =========================================================================
  // API-05: No Docker dependencies in containerLogs.js
  // =========================================================================
  describe('no Docker dependencies (API-05)', () => {
    const source = fs.readFileSync(
      path.resolve(PROJECT_ROOT, 'src', 'lib', 'containerLogs.js'),
      'utf8'
    );

    test('containerLogs.js source does NOT contain require("dockerode")', () => {
      expect(source).not.toMatch(/require\(['"]dockerode['"]\)/);
    });

    test('containerLogs.js source does NOT contain require("rate-limit-redis")', () => {
      expect(source).not.toMatch(/require\(['"]rate-limit-redis['"]\)/);
    });
  });

  // =========================================================================
  // API-06: Docker hostnames replaced in config/scripts
  // =========================================================================
  describe('Docker hostnames replaced (API-06)', () => {
    test('nginx.conf does NOT contain http://api:', () => {
      const nginxConf = fs.readFileSync(
        path.resolve(PROJECT_ROOT, 'config', 'nginx.conf'),
        'utf8'
      );
      expect(nginxConf).not.toMatch(/http:\/\/api:/);
    });

    test('nginx.conf does NOT contain http://linbo-api:', () => {
      const nginxConf = fs.readFileSync(
        path.resolve(PROJECT_ROOT, 'config', 'nginx.conf'),
        'utf8'
      );
      expect(nginxConf).not.toMatch(/http:\/\/linbo-api:/);
    });

    test('helperfunctions.sh API_URL default is http://localhost:3000', () => {
      const content = fs.readFileSync(
        path.resolve(PROJECT_ROOT, 'scripts', 'server', 'helperfunctions.sh'),
        'utf8'
      );
      expect(content).toMatch(/http:\/\/localhost:3000/);
      expect(content).not.toMatch(/http:\/\/linbo-api:3000/);
    });

    test('rsync-pre-download-api.sh API_URL default is http://localhost:3000', () => {
      const content = fs.readFileSync(
        path.resolve(PROJECT_ROOT, 'scripts', 'server', 'rsync-pre-download-api.sh'),
        'utf8'
      );
      expect(content).toMatch(/http:\/\/localhost:3000/);
      expect(content).not.toMatch(/http:\/\/linbo-api:3000/);
    });

    test('rsync-pre-upload-api.sh API_URL default is http://localhost:3000', () => {
      const content = fs.readFileSync(
        path.resolve(PROJECT_ROOT, 'scripts', 'server', 'rsync-pre-upload-api.sh'),
        'utf8'
      );
      expect(content).toMatch(/http:\/\/localhost:3000/);
      expect(content).not.toMatch(/http:\/\/linbo-api:3000/);
    });

    test('rsync-post-upload-api.sh API_URL default is http://localhost:3000', () => {
      const content = fs.readFileSync(
        path.resolve(PROJECT_ROOT, 'scripts', 'server', 'rsync-post-upload-api.sh'),
        'utf8'
      );
      expect(content).toMatch(/http:\/\/localhost:3000/);
      expect(content).not.toMatch(/http:\/\/linbo-api:3000/);
    });
  });

  // =========================================================================
  // API-08: containerLogs module degrades gracefully without Docker
  // =========================================================================
  describe('containerLogs module degrades gracefully without Docker (API-08)', () => {
    let containerLogs;

    beforeAll(() => {
      // Clear any cached version and require fresh
      const modPath = require.resolve('../../../src/lib/containerLogs');
      delete require.cache[modPath];
      containerLogs = require('../../../src/lib/containerLogs');
      // Call init with no-op broadcast and mock wss
      containerLogs.init(() => {}, {});
    });

    test('isAvailable() returns false', () => {
      expect(containerLogs.isAvailable()).toBe(false);
    });

    test('listContainers() resolves to []', async () => {
      const result = await containerLogs.listContainers();
      expect(result).toEqual([]);
    });

    test('getRecentLogs("any", 10) resolves to []', async () => {
      const result = await containerLogs.getRecentLogs('any', 10);
      expect(result).toEqual([]);
    });

    test('subscribe("any", {}) resolves without throwing', async () => {
      await expect(containerLogs.subscribe('any', {})).resolves.not.toThrow();
    });

    test('unsubscribe("any", {}) does not throw', () => {
      expect(() => containerLogs.unsubscribe('any', {})).not.toThrow();
    });

    test('unsubscribeAll({}) does not throw', () => {
      expect(() => containerLogs.unsubscribeAll({})).not.toThrow();
    });

    test('init(() => {}, {}) does not throw', () => {
      expect(() => containerLogs.init(() => {}, {})).not.toThrow();
    });
  });
});
