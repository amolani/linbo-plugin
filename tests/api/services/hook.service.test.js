/**
 * LINBO Docker - Hook Service Tests
 * Tests for hook scanning and manifest reading
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');

// Set environment before importing service
const TEST_DIR = path.join(os.tmpdir(), `hook-test-${Date.now()}`);
const HOOKS_DIR = path.join(TEST_DIR, 'hooks');
process.env.LINBO_DIR = TEST_DIR;
process.env.HOOKSDIR = HOOKS_DIR;

const hookService = require('../../src/services/hook.service');

describe('Hook Service', () => {
  beforeAll(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
    await fs.mkdir(path.join(HOOKS_DIR, 'update-linbofs.pre.d'), { recursive: true });
    await fs.mkdir(path.join(HOOKS_DIR, 'update-linbofs.post.d'), { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  afterEach(async () => {
    // Clean up hooks and manifest between tests
    const preDir = path.join(HOOKS_DIR, 'update-linbofs.pre.d');
    const postDir = path.join(HOOKS_DIR, 'update-linbofs.post.d');
    for (const dir of [preDir, postDir]) {
      const files = await fs.readdir(dir).catch(() => []);
      for (const f of files) {
        await fs.unlink(path.join(dir, f)).catch(() => {});
      }
    }
    await fs.unlink(path.join(TEST_DIR, '.linbofs-build-manifest.json')).catch(() => {});
  });

  describe('getHooks()', () => {
    test('returns empty when no hooks installed', async () => {
      const result = await hookService.getHooks();

      expect(result.hooks).toEqual([]);
      expect(result.lastBuild).toBeNull();
      expect(result.hookWarnings).toBe(0);
    });

    test('finds hooks in pre.d and post.d with correct type and executable status', async () => {
      // Create test hooks
      const preHook = path.join(HOOKS_DIR, 'update-linbofs.pre.d', '01_theme');
      const postHook = path.join(HOOKS_DIR, 'update-linbofs.post.d', '01_notify');

      await fs.writeFile(preHook, '#!/bin/bash\necho "theme"');
      await fs.chmod(preHook, 0o755);

      await fs.writeFile(postHook, '#!/bin/bash\necho "notify"');
      // Not executable

      const result = await hookService.getHooks();

      expect(result.hooks).toHaveLength(2);

      const pre = result.hooks.find(h => h.name === '01_theme');
      expect(pre).toBeDefined();
      expect(pre.type).toBe('pre');
      expect(pre.executable).toBe(true);
      expect(pre.size).toBeGreaterThan(0);

      const post = result.hooks.find(h => h.name === '01_notify');
      expect(post).toBeDefined();
      expect(post.type).toBe('post');
      expect(post.executable).toBe(false);
    });

    test('merges manifest data when manifest exists', async () => {
      // Create a hook
      const preHook = path.join(HOOKS_DIR, 'update-linbofs.pre.d', '01_edulution-plymouth');
      await fs.writeFile(preHook, '#!/bin/bash\necho "plymouth"');
      await fs.chmod(preHook, 0o755);

      // Create manifest
      const manifest = {
        buildTimestamp: '2026-03-10T14:30:00Z',
        kernelVariant: 'stable',
        kernelVersion: '6.18.4',
        hookCount: 1,
        hookWarnings: 0,
        hooks: [
          { name: '01_edulution-plymouth', type: 'pre', exitCode: 0, filesDelta: 5 },
        ],
      };
      await fs.writeFile(
        path.join(TEST_DIR, '.linbofs-build-manifest.json'),
        JSON.stringify(manifest)
      );

      const result = await hookService.getHooks();

      expect(result.hooks).toHaveLength(1);
      expect(result.hooks[0].lastExitCode).toBe(0);
      expect(result.hooks[0].lastFilesDelta).toBe(5);
      expect(result.lastBuild).toBe('2026-03-10T14:30:00Z');
      expect(result.hookWarnings).toBe(0);
    });

    test('works gracefully when manifest is missing', async () => {
      // Create a hook but no manifest
      const preHook = path.join(HOOKS_DIR, 'update-linbofs.pre.d', '01_test');
      await fs.writeFile(preHook, '#!/bin/bash\necho "test"');
      await fs.chmod(preHook, 0o755);

      const result = await hookService.getHooks();

      expect(result.hooks).toHaveLength(1);
      expect(result.hooks[0].name).toBe('01_test');
      expect(result.hooks[0].lastExitCode).toBeUndefined();
      expect(result.hooks[0].lastFilesDelta).toBeUndefined();
      expect(result.lastBuild).toBeNull();
    });
  });

  describe('readManifest()', () => {
    test('returns parsed JSON when manifest exists', async () => {
      const manifest = {
        buildTimestamp: '2026-03-10T14:30:00Z',
        hookCount: 1,
        hookWarnings: 0,
        hooks: [],
      };
      await fs.writeFile(
        path.join(TEST_DIR, '.linbofs-build-manifest.json'),
        JSON.stringify(manifest)
      );

      const result = await hookService.readManifest();

      expect(result).not.toBeNull();
      expect(result.buildTimestamp).toBe('2026-03-10T14:30:00Z');
      expect(result.hookCount).toBe(1);
    });

    test('returns null when manifest is missing', async () => {
      const result = await hookService.readManifest();

      expect(result).toBeNull();
    });

    test('returns null when manifest contains invalid JSON', async () => {
      await fs.writeFile(
        path.join(TEST_DIR, '.linbofs-build-manifest.json'),
        'this is not json {'
      );

      const result = await hookService.readManifest();

      expect(result).toBeNull();
    });
  });
});
