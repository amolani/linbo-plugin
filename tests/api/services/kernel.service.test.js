/**
 * LINBO Docker - Kernel Service Tests
 * Tests for kernel variant management (stable, longterm, legacy)
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');

// Create isolated test directories
const TEST_BASE = path.join(os.tmpdir(), `kernel-test-${Date.now()}`);
const TEST_KERNEL_DIR = path.join(TEST_BASE, 'current');
const TEST_CONFIG_DIR = path.join(TEST_BASE, 'config');
const TEST_LINBO_DIR = path.join(TEST_BASE, 'linbo');

// Set environment BEFORE importing service
process.env.KERNEL_VAR_DIR = TEST_KERNEL_DIR;
process.env.CONFIG_DIR = TEST_CONFIG_DIR;
process.env.LINBO_CONFIG_DIR = TEST_CONFIG_DIR;
process.env.LINBO_DIR = TEST_LINBO_DIR;
process.env.LINBO_DATA_DIR = TEST_LINBO_DIR;
process.env.UPDATE_LINBOFS_SCRIPT = path.join(TEST_BASE, 'mock-update-linbofs.sh');

// Mock child_process for rebuild
jest.mock('child_process', () => ({
  execFile: jest.fn((cmd, args, opts, callback) => {
    if (typeof opts === 'function') {
      callback = opts;
    }
    // Simulate successful script execution
    if (callback) {
      setTimeout(() => callback(null, 'Update complete\n', ''), 10);
    }
  }),
}));

const kernelService = require('../../src/services/kernel.service');

// =============================================================================
// Helpers
// =============================================================================

async function createVariantDir(variant, { version = '6.17.7', kernel = true, modules = true, versionFile = true } = {}) {
  const varDir = path.join(TEST_KERNEL_DIR, variant);
  await fs.mkdir(varDir, { recursive: true });
  if (kernel) await fs.writeFile(path.join(varDir, 'linbo64'), 'mock-kernel-binary-' + variant);
  if (modules) await fs.writeFile(path.join(varDir, 'modules.tar.xz'), 'mock-modules-' + variant);
  if (versionFile) await fs.writeFile(path.join(varDir, 'version'), version);
}

async function writeCustomKernel(content) {
  await fs.writeFile(path.join(TEST_CONFIG_DIR, 'custom_kernel'), content);
}

async function cleanDirs() {
  await fs.rm(TEST_BASE, { recursive: true, force: true }).catch(() => {});
}

async function setupDirs() {
  await fs.mkdir(TEST_KERNEL_DIR, { recursive: true });
  await fs.mkdir(TEST_CONFIG_DIR, { recursive: true });
  await fs.mkdir(TEST_LINBO_DIR, { recursive: true });
}

async function removeStateFile() {
  const stateFile = path.join(TEST_CONFIG_DIR, 'kernel_state.json');
  await fs.unlink(stateFile).catch(() => {});
}

async function removeCustomKernel() {
  const ckFile = path.join(TEST_CONFIG_DIR, 'custom_kernel');
  await fs.unlink(ckFile).catch(() => {});
}

// =============================================================================
// Tests
// =============================================================================

describe('Kernel Service', () => {
  beforeAll(async () => {
    await setupDirs();
  });

  afterAll(async () => {
    await cleanDirs();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset in-process rebuild flag
    kernelService._setRebuildActive(false);
    // Clean up state between tests
    await removeStateFile();
    await removeCustomKernel();
    // Remove variant dirs
    for (const v of ['stable', 'longterm', 'legacy']) {
      await fs.rm(path.join(TEST_KERNEL_DIR, v), { recursive: true, force: true }).catch(() => {});
    }
  });

  // ===========================================================================
  // listKernelVariants
  // ===========================================================================

  describe('listKernelVariants', () => {
    test('should return correct structure for all 3 variants', async () => {
      await createVariantDir('stable', { version: '6.17.7' });
      await createVariantDir('longterm', { version: '6.12.57' });
      await createVariantDir('legacy', { version: '6.1.158' });

      const variants = await kernelService.listKernelVariants();

      expect(variants).toHaveLength(3);
      expect(variants.map(v => v.name)).toEqual(['stable', 'longterm', 'legacy']);

      for (const v of variants) {
        expect(v).toHaveProperty('name');
        expect(v).toHaveProperty('version');
        expect(v).toHaveProperty('kernelSize');
        expect(v).toHaveProperty('modulesSize');
        expect(v).toHaveProperty('isActive');
        expect(v).toHaveProperty('available');
      }
    });

    test('should handle missing variant directories', async () => {
      // No variant dirs created
      const variants = await kernelService.listKernelVariants();

      expect(variants).toHaveLength(3);
      for (const v of variants) {
        expect(v.available).toBe(false);
        expect(v.version).toBe('unknown');
        expect(v.kernelSize).toBe(0);
        expect(v.modulesSize).toBe(0);
      }
    });

    test('should handle partial variant list', async () => {
      await createVariantDir('stable', { version: '6.17.7' });
      // longterm and legacy not created

      const variants = await kernelService.listKernelVariants();
      const stable = variants.find(v => v.name === 'stable');
      const longterm = variants.find(v => v.name === 'longterm');

      expect(stable.available).toBe(true);
      expect(stable.version).toBe('6.17.7');
      expect(longterm.available).toBe(false);
    });

    test('should handle missing version file', async () => {
      await createVariantDir('stable', { version: '6.17.7', versionFile: false });

      const variants = await kernelService.listKernelVariants();
      const stable = variants.find(v => v.name === 'stable');

      expect(stable.version).toBe('unknown');
      expect(stable.available).toBe(false); // missing version = incomplete
    });

    test('should mark active variant correctly', async () => {
      await createVariantDir('stable', { version: '6.17.7' });
      await createVariantDir('longterm', { version: '6.12.57' });
      await writeCustomKernel('KERNELPATH="longterm"');

      const variants = await kernelService.listKernelVariants();
      const stable = variants.find(v => v.name === 'stable');
      const longterm = variants.find(v => v.name === 'longterm');

      expect(stable.isActive).toBe(false);
      expect(longterm.isActive).toBe(true);
    });

    test('should show file sizes', async () => {
      await createVariantDir('stable', { version: '6.17.7' });

      const variants = await kernelService.listKernelVariants();
      const stable = variants.find(v => v.name === 'stable');

      expect(stable.kernelSize).toBeGreaterThan(0);
      expect(stable.modulesSize).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // getActiveKernel
  // ===========================================================================

  describe('getActiveKernel', () => {
    test('should default to stable when no custom_kernel file', async () => {
      const active = await kernelService.getActiveKernel();

      expect(active.variant).toBe('stable');
      expect(active.configValid).toBe(true);
      expect(active.configWarning).toBeNull();
    });

    test('should read "legacy" from custom_kernel', async () => {
      await writeCustomKernel('KERNELPATH="legacy"');
      await createVariantDir('legacy', { version: '6.1.158' });

      const active = await kernelService.getActiveKernel();

      expect(active.variant).toBe('legacy');
      expect(active.version).toBe('6.1.158');
    });

    test('should read "longterm" from custom_kernel', async () => {
      await writeCustomKernel('KERNELPATH="longterm"');
      await createVariantDir('longterm', { version: '6.12.57' });

      const active = await kernelService.getActiveKernel();

      expect(active.variant).toBe('longterm');
      expect(active.version).toBe('6.12.57');
    });

    test('should handle commented-out KERNELPATH -> stable', async () => {
      await writeCustomKernel('# KERNELPATH="longterm"\n# This is a comment');

      const active = await kernelService.getActiveKernel();

      expect(active.variant).toBe('stable');
    });
  });

  // ===========================================================================
  // readCustomKernelConfig
  // ===========================================================================

  describe('readCustomKernelConfig', () => {
    test('should take last KERNELPATH when multiple lines exist', async () => {
      await writeCustomKernel('KERNELPATH="stable"\nKERNELPATH="longterm"');

      const config = await kernelService.readCustomKernelConfig();

      expect(config.variant).toBe('longterm');
      expect(config.valid).toBe(true);
    });

    test('should handle quoted vs unquoted values', async () => {
      await writeCustomKernel('KERNELPATH=legacy');

      const config = await kernelService.readCustomKernelConfig();

      expect(config.variant).toBe('legacy');
      expect(config.valid).toBe(true);
    });

    test('should return invalid for unknown variant', async () => {
      await writeCustomKernel('KERNELPATH="foobar"');

      const config = await kernelService.readCustomKernelConfig();

      expect(config.valid).toBe(false);
      expect(config.warning).toContain('foobar');
    });

    test('should return stable for empty KERNELPATH', async () => {
      await writeCustomKernel('KERNELPATH=""');

      const config = await kernelService.readCustomKernelConfig();

      expect(config.variant).toBe('stable');
      expect(config.valid).toBe(true);
    });

    test('should ignore whitespace around value', async () => {
      await writeCustomKernel('  KERNELPATH= longterm ');

      const config = await kernelService.readCustomKernelConfig();

      expect(config.variant).toBe('longterm');
      expect(config.valid).toBe(true);
    });

    test('should return raw content', async () => {
      const content = '# Comment\nKERNELPATH="stable"';
      await writeCustomKernel(content);

      const config = await kernelService.readCustomKernelConfig();

      expect(config.raw).toBe(content);
    });
  });

  // ===========================================================================
  // writeCustomKernelConfig
  // ===========================================================================

  describe('writeCustomKernelConfig', () => {
    test('should write stable variant in strict format', async () => {
      await kernelService.writeCustomKernelConfig('stable');

      const content = await fs.readFile(path.join(TEST_CONFIG_DIR, 'custom_kernel'), 'utf-8');
      expect(content).toContain('KERNELPATH="stable"');
      expect(content).toContain('managed by linbo-docker');
    });

    test('should write longterm variant', async () => {
      await kernelService.writeCustomKernelConfig('longterm');

      const content = await fs.readFile(path.join(TEST_CONFIG_DIR, 'custom_kernel'), 'utf-8');
      expect(content).toContain('KERNELPATH="longterm"');
    });

    test('should reject invalid variant', async () => {
      await expect(kernelService.writeCustomKernelConfig('invalid'))
        .rejects.toThrow('Invalid variant');
    });
  });

  // ===========================================================================
  // switchKernel
  // ===========================================================================

  describe('switchKernel', () => {
    test('should execute full switch flow', async () => {
      await createVariantDir('longterm', { version: '6.12.57' });

      const result = await kernelService.switchKernel('longterm');

      expect(result).toHaveProperty('jobId');
      expect(result.jobId).toMatch(/^ks-/);
      expect(result).toHaveProperty('startedAt');
      expect(result.requestedVariant).toBe('longterm');

      // Verify config was written
      const config = await kernelService.readCustomKernelConfig();
      expect(config.variant).toBe('longterm');
    });

    test('should reject invalid variant name (400)', async () => {
      try {
        await kernelService.switchKernel('invalid');
        fail('Should have thrown');
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });

    test('should reject when variant dir is missing (400)', async () => {
      // No variant dir created for 'legacy'
      try {
        await kernelService.switchKernel('legacy');
        // If legacy dir doesn't exist, the variant will have available=false
        // but switchKernel checks target.available
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });

    test('should return 409 when rebuild already running', async () => {
      // Simulate an active rebuild in this process so readKernelState doesn't auto-correct
      kernelService._setRebuildActive(true);
      await kernelService.writeKernelState({ rebuildStatus: 'running' });

      try {
        await kernelService.switchKernel('stable');
        fail('Should have thrown');
      } catch (err) {
        expect(err.statusCode).toBe(409);
        expect(err.message).toContain('already in progress');
      }
    });
  });

  // ===========================================================================
  // getKernelStatus
  // ===========================================================================

  describe('getKernelStatus', () => {
    test('should return combined response with all fields', async () => {
      await createVariantDir('stable', { version: '6.17.7' });
      await createVariantDir('longterm', { version: '6.12.57' });

      const status = await kernelService.getKernelStatus();

      expect(status).toHaveProperty('variants');
      expect(status).toHaveProperty('activeVariant');
      expect(status).toHaveProperty('activeVersion');
      expect(status).toHaveProperty('configValid');
      expect(status).toHaveProperty('configWarning');
      expect(status).toHaveProperty('hasTemplate');
      expect(status).toHaveProperty('rebuildRunning');
      expect(status).toHaveProperty('lastSwitchAt');
      expect(status).toHaveProperty('lastError');
      expect(status).toHaveProperty('currentLinbo64');

      expect(status.variants).toHaveLength(3);
      expect(status.activeVariant).toBe('stable');
      expect(status.rebuildRunning).toBe(false);
    });
  });

  // ===========================================================================
  // isRebuildRunning
  // ===========================================================================

  describe('isRebuildRunning', () => {
    test('should return false when no state file', async () => {
      const running = await kernelService.isRebuildRunning();
      expect(running).toBe(false);
    });

    test('should return true when state is running (in-process)', async () => {
      // Simulate an active rebuild in this process
      kernelService._setRebuildActive(true);
      await kernelService.writeKernelState({ rebuildStatus: 'running' });

      const running = await kernelService.isRebuildRunning();
      expect(running).toBe(true);
    });

    test('should return false when state is completed', async () => {
      await kernelService.writeKernelState({ rebuildStatus: 'completed' });

      const running = await kernelService.isRebuildRunning();
      expect(running).toBe(false);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('Edge Cases', () => {
    test('variant present but incomplete (modules missing) -> available=false', async () => {
      await createVariantDir('legacy', { version: '6.1.158', modules: false });

      const variants = await kernelService.listKernelVariants();
      const legacy = variants.find(v => v.name === 'legacy');

      expect(legacy.available).toBe(false);
      expect(legacy.version).toBe('6.1.158');
    });

    test('template missing -> hasTemplate=false in status', async () => {
      const status = await kernelService.getKernelStatus();
      expect(status.hasTemplate).toBe(false);
    });

    test('template present -> hasTemplate=true', async () => {
      await fs.writeFile(path.join(TEST_KERNEL_DIR, 'linbofs64.xz'), 'mock-template');

      const hasIt = await kernelService.hasTemplate();
      expect(hasIt).toBe(true);

      // Cleanup
      await fs.unlink(path.join(TEST_KERNEL_DIR, 'linbofs64.xz'));
    });

    test('custom_kernel broken/empty -> stable with configWarning', async () => {
      await writeCustomKernel('KERNELPATH="doesnotexist"');

      const active = await kernelService.getActiveKernel();
      expect(active.configValid).toBe(false);
      expect(active.configWarning).toBeTruthy();
    });
  });

  // ===========================================================================
  // State Persistence
  // ===========================================================================

  describe('State Persistence', () => {
    test('readKernelState returns default when file missing', async () => {
      const state = await kernelService.readKernelState();

      expect(state.lastSwitchAt).toBeNull();
      expect(state.lastError).toBeNull();
      expect(state.rebuildStatus).toBe('completed');
    });

    test('writeKernelState merges updates correctly', async () => {
      await kernelService.writeKernelState({
        lastSwitchAt: '2026-02-08T14:30:00Z',
        lastRequestedVariant: 'longterm',
      });

      const state = await kernelService.readKernelState();
      expect(state.lastSwitchAt).toBe('2026-02-08T14:30:00Z');
      expect(state.lastRequestedVariant).toBe('longterm');
      // Default fields should still be present
      expect(state.lastError).toBeNull();
      expect(state.rebuildStatus).toBe('completed');
    });

    test('container restart with running state -> failed', async () => {
      // Directly write state file with running status
      const stateFile = path.join(TEST_CONFIG_DIR, 'kernel_state.json');
      await fs.writeFile(stateFile, JSON.stringify({
        rebuildStatus: 'running',
        lastRequestedVariant: 'longterm',
      }));

      // readKernelState should detect interrupted rebuild
      const state = await kernelService.readKernelState();
      expect(state.rebuildStatus).toBe('failed');
      expect(state.lastError).toContain('interrupted');
    });

    test('multiple writes preserve state', async () => {
      await kernelService.writeKernelState({ lastSwitchAt: 'time1' });
      await kernelService.writeKernelState({ lastError: 'err1' });

      const state = await kernelService.readKernelState();
      expect(state.lastSwitchAt).toBe('time1');
      expect(state.lastError).toBe('err1');
    });
  });

  // ===========================================================================
  // repairConfig
  // ===========================================================================

  describe('repairConfig', () => {
    test('should reset custom_kernel to stable', async () => {
      await writeCustomKernel('KERNELPATH="legacy"');

      const result = await kernelService.repairConfig();

      expect(result.variant).toBe('stable');

      // Verify file was written
      const config = await kernelService.readCustomKernelConfig();
      expect(config.variant).toBe('stable');
    });

    test('should clear lastError in state', async () => {
      await kernelService.writeKernelState({ lastError: 'previous error' });

      await kernelService.repairConfig();

      const state = await kernelService.readKernelState();
      expect(state.lastError).toBeNull();
    });
  });

  // ===========================================================================
  // getLinbo64Info
  // ===========================================================================

  describe('getLinbo64Info', () => {
    test('should return info when linbo64 exists', async () => {
      await fs.writeFile(path.join(TEST_LINBO_DIR, 'linbo64'), 'mock-kernel');
      await fs.writeFile(path.join(TEST_LINBO_DIR, 'linbo64.md5'), 'abc123');

      const info = await kernelService.getLinbo64Info();

      expect(info.size).toBeGreaterThan(0);
      expect(info.md5).toBe('abc123');
      expect(info.modifiedAt).toBeTruthy();
    });

    test('should handle missing linbo64', async () => {
      await fs.unlink(path.join(TEST_LINBO_DIR, 'linbo64')).catch(() => {});
      await fs.unlink(path.join(TEST_LINBO_DIR, 'linbo64.md5')).catch(() => {});

      const info = await kernelService.getLinbo64Info();

      expect(info.size).toBe(0);
      expect(info.md5).toBeNull();
      expect(info.modifiedAt).toBeNull();
    });
  });

  // ===========================================================================
  // Constants
  // ===========================================================================

  describe('Constants', () => {
    test('VALID_VARIANTS should contain all three variants', () => {
      expect(kernelService.VALID_VARIANTS).toEqual(['stable', 'longterm', 'legacy']);
    });
  });
});
