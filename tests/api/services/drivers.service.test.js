/**
 * LINBO Docker - Drivers Service Tests (TEST-01)
 *
 * Comprehensive tests for drivers.service.js:
 *   - parseMatchConf: INI parsing edge cases
 *   - createProfile: SSH DMI read, folder creation, idempotency
 *   - listProfiles: directory scanning, empty base
 *   - setProfileImage / removeProfileImage: image.conf management
 *   - regeneratePostsync: postsync script generation/deletion
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');

const TEST_BASE = path.join(os.tmpdir(), `drivers-svc-test-${Date.now()}`);
const DRIVERS_DIR = path.join(TEST_BASE, 'drivers');
const IMAGES_DIR = path.join(TEST_BASE, 'images');

// Set environment BEFORE importing
process.env.DRIVERS_BASE = DRIVERS_DIR;
process.env.IMAGE_DIR = IMAGES_DIR;
process.env.LINBO_DIR = TEST_BASE;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../src/services/ssh.service', () => ({
  executeWithTimeout: jest.fn(),
  executeCommand: jest.fn(),
  testConnection: jest.fn(),
}));

jest.mock('../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after env setup)
// ---------------------------------------------------------------------------

const driversService = require('../../src/services/drivers.service');
const sshService = require('../../src/services/ssh.service');
const ws = require('../../src/lib/websocket');

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await fs.rm(TEST_BASE, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(DRIVERS_DIR, { recursive: true });
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  jest.clearAllMocks();
});

afterAll(async () => {
  await fs.rm(TEST_BASE, { recursive: true, force: true }).catch(() => {});
});

// =============================================================================
// parseMatchConf
// =============================================================================

describe('parseMatchConf', () => {
  test('parses standard [match] section with vendor + product', () => {
    const content = `[match]
vendor = Dell Inc.
product = OptiPlex 7090`;
    const result = driversService.parseMatchConf(content);
    expect(result.vendor).toBe('Dell Inc.');
    expect(result.products).toEqual(['OptiPlex 7090']);
  });

  test('parses multiple products in same [match] section', () => {
    const content = `[match]
vendor = Lenovo
product = ThinkCentre M920
product = ThinkCentre M920q`;
    const result = driversService.parseMatchConf(content);
    expect(result.vendor).toBe('Lenovo');
    expect(result.products).toEqual(['ThinkCentre M920', 'ThinkCentre M920q']);
  });

  test('returns empty vendor/products for empty content', () => {
    const result = driversService.parseMatchConf('');
    expect(result.vendor).toBe('');
    expect(result.products).toEqual([]);
  });

  test('returns empty vendor/products when [match] section is missing', () => {
    const content = `[other]
vendor = Dell Inc.
product = OptiPlex`;
    const result = driversService.parseMatchConf(content);
    expect(result.vendor).toBe('');
    expect(result.products).toEqual([]);
  });

  test('handles content with only comments and blank lines', () => {
    const content = `# This is a comment
# Another comment

  # Indented comment
`;
    const result = driversService.parseMatchConf(content);
    expect(result.vendor).toBe('');
    expect(result.products).toEqual([]);
  });

  test('handles vendor with special characters', () => {
    const content = `[match]
vendor = FUJITSU // Siemens
product = LIFEBOOK U727`;
    const result = driversService.parseMatchConf(content);
    expect(result.vendor).toBe('FUJITSU // Siemens');
    expect(result.products).toEqual(['LIFEBOOK U727']);
  });

  test('stops parsing match keys when new section starts', () => {
    const content = `[match]
vendor = Dell Inc.
product = OptiPlex 7090
[drivers]
vendor = Should Not Be Read`;
    const result = driversService.parseMatchConf(content);
    expect(result.vendor).toBe('Dell Inc.');
    expect(result.products).toEqual(['OptiPlex 7090']);
  });

  test('handles case insensitive key parsing', () => {
    const content = `[match]
Vendor = HP Inc.
Product = EliteDesk 800`;
    const result = driversService.parseMatchConf(content);
    expect(result.vendor).toBe('HP Inc.');
    expect(result.products).toEqual(['EliteDesk 800']);
  });

  test('handles key with no value (vendor =)', () => {
    const content = `[match]
vendor =
product = Something`;
    const result = driversService.parseMatchConf(content);
    expect(result.vendor).toBe('');
    expect(result.products).toEqual(['Something']);
  });

  test('handles multiple [match] sections (last values win)', () => {
    const content = `[match]
vendor = First
product = Product1
[other]
vendor = Ignored
[match]
vendor = Second
product = Product2`;
    const result = driversService.parseMatchConf(content);
    // The parser overwrites vendor from the second [match] section
    // but products accumulate across both sections
    expect(result.vendor).toBe('Second');
    expect(result.products).toContain('Product2');
  });

  test('ignores lines without = in [match] section', () => {
    const content = `[match]
vendor = Dell
this is not a key value pair
product = OptiPlex`;
    const result = driversService.parseMatchConf(content);
    expect(result.vendor).toBe('Dell');
    expect(result.products).toEqual(['OptiPlex']);
  });
});

// =============================================================================
// createProfile
// =============================================================================

describe('createProfile', () => {
  test('creates profile on successful SSH DMI read', async () => {
    sshService.executeWithTimeout.mockResolvedValue({
      stdout: 'Dell Inc.\n---DMI_SEP---\nOptiPlex 7090\n',
      stderr: '',
      code: 0,
    });

    const result = await driversService.createProfile('10.0.0.101');

    expect(result.created).toBe(true);
    expect(result.vendor).toBe('Dell Inc.');
    expect(result.product).toBe('OptiPlex 7090');
    expect(result.folder).toBeDefined();

    // Verify match.conf was written
    const matchConfPath = path.join(DRIVERS_DIR, result.folder, 'match.conf');
    const content = await fs.readFile(matchConfPath, 'utf-8');
    expect(content).toContain('[match]');
    expect(content).toContain('vendor = Dell Inc.');
    expect(content).toContain('product = OptiPlex 7090');

    // Verify WS broadcast
    expect(ws.broadcast).toHaveBeenCalledWith('drivers.profile_created',
      expect.objectContaining({ folder: result.folder, vendor: 'Dell Inc.' })
    );
  });

  test('returns idempotent result when match.conf already exists', async () => {
    // Pre-create profile
    const folderName = 'Dell_Inc._OptiPlex_7090';
    const folderPath = path.join(DRIVERS_DIR, folderName);
    await fs.mkdir(folderPath, { recursive: true });
    await fs.writeFile(path.join(folderPath, 'match.conf'), '[match]\nvendor = Dell Inc.\nproduct = OptiPlex 7090\n');

    sshService.executeWithTimeout.mockResolvedValue({
      stdout: 'Dell Inc.\n---DMI_SEP---\nOptiPlex 7090\n',
      stderr: '',
      code: 0,
    });

    const result = await driversService.createProfile('10.0.0.101');
    expect(result.created).toBe(false);
    expect(result.folder).toBe(folderName);
  });

  test('throws 502 when SSH returns empty vendor', async () => {
    sshService.executeWithTimeout.mockResolvedValue({
      stdout: '---DMI_SEP---\nOptiPlex 7090\n',
      stderr: '',
      code: 0,
    });

    await expect(driversService.createProfile('10.0.0.101'))
      .rejects.toThrow('Could not read DMI');
  });

  test('throws 502 when SSH returns empty product', async () => {
    sshService.executeWithTimeout.mockResolvedValue({
      stdout: 'Dell Inc.\n---DMI_SEP---\n',
      stderr: '',
      code: 0,
    });

    await expect(driversService.createProfile('10.0.0.101'))
      .rejects.toThrow('Could not read DMI');
  });
});

// =============================================================================
// listProfiles
// =============================================================================

describe('listProfiles', () => {
  test('lists profiles that have match.conf', async () => {
    // Create two profiles
    const p1 = path.join(DRIVERS_DIR, 'Dell_OptiPlex');
    await fs.mkdir(p1, { recursive: true });
    await fs.writeFile(path.join(p1, 'match.conf'), '[match]\nvendor = Dell\nproduct = OptiPlex\n');
    await fs.writeFile(path.join(p1, 'e1000e.inf'), 'driver file');

    const p2 = path.join(DRIVERS_DIR, 'HP_EliteDesk');
    await fs.mkdir(p2, { recursive: true });
    await fs.writeFile(path.join(p2, 'match.conf'), '[match]\nvendor = HP\nproduct = EliteDesk\n');

    const profiles = await driversService.listProfiles();
    expect(profiles).toHaveLength(2);
    expect(profiles.map(p => p.folder).sort()).toEqual(['Dell_OptiPlex', 'HP_EliteDesk']);
    expect(profiles.find(p => p.folder === 'Dell_OptiPlex').hasDrivers).toBe(true);
    expect(profiles.find(p => p.folder === 'HP_EliteDesk').hasDrivers).toBe(false);
  });

  test('skips directories without match.conf', async () => {
    // Legacy folder without match.conf
    const legacyDir = path.join(DRIVERS_DIR, 'legacy_profile');
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, 'some-file.txt'), 'legacy');

    const profiles = await driversService.listProfiles();
    expect(profiles).toHaveLength(0);
  });

  test('returns empty array when DRIVERS_BASE does not exist', async () => {
    await fs.rm(DRIVERS_DIR, { recursive: true, force: true });

    const profiles = await driversService.listProfiles();
    expect(profiles).toEqual([]);
  });

  test('includes image assignment from readImageConf', async () => {
    const p1 = path.join(DRIVERS_DIR, 'Dell_OptiPlex');
    await fs.mkdir(p1, { recursive: true });
    await fs.writeFile(path.join(p1, 'match.conf'), '[match]\nvendor = Dell\nproduct = OptiPlex\n');
    await fs.writeFile(path.join(p1, 'image.conf'), 'image = win11_pro\n');

    const profiles = await driversService.listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].image).toBe('win11_pro');
  });

  test('returns fileCount and totalSize', async () => {
    const p1 = path.join(DRIVERS_DIR, 'Dell_OptiPlex');
    await fs.mkdir(p1, { recursive: true });
    await fs.writeFile(path.join(p1, 'match.conf'), '[match]\nvendor = Dell\nproduct = OptiPlex\n');
    await fs.writeFile(path.join(p1, 'driver.inf'), 'x'.repeat(100));

    const profiles = await driversService.listProfiles();
    expect(profiles[0].fileCount).toBeGreaterThanOrEqual(2); // match.conf + driver.inf
    expect(profiles[0].totalSize).toBeGreaterThan(0);
  });
});

// =============================================================================
// setProfileImage / removeProfileImage
// =============================================================================

describe('setProfileImage', () => {
  beforeEach(async () => {
    const p1 = path.join(DRIVERS_DIR, 'Dell_OptiPlex');
    await fs.mkdir(p1, { recursive: true });
    await fs.writeFile(path.join(p1, 'match.conf'), '[match]\nvendor = Dell\nproduct = OptiPlex\n');
  });

  test('writes image.conf and calls regeneratePostsync', async () => {
    const result = await driversService.setProfileImage('Dell_OptiPlex', 'win11_pro');

    expect(result.folder).toBe('Dell_OptiPlex');
    expect(result.image).toBe('win11_pro');

    // Verify image.conf was written
    const imageConf = await fs.readFile(path.join(DRIVERS_DIR, 'Dell_OptiPlex', 'image.conf'), 'utf-8');
    expect(imageConf).toContain('image = win11_pro');

    // Verify WS broadcast
    expect(ws.broadcast).toHaveBeenCalledWith('drivers.image_assigned',
      expect.objectContaining({ folder: 'Dell_OptiPlex', image: 'win11_pro' })
    );
  });

  test('throws 404 when profile does not exist', async () => {
    await expect(driversService.setProfileImage('nonexistent', 'win11_pro'))
      .rejects.toThrow(/not found/i);
  });

  test('throws 400 for empty image name', async () => {
    await expect(driversService.setProfileImage('Dell_OptiPlex', ''))
      .rejects.toThrow();
  });

  test('throws 400 for image name starting with dot', async () => {
    await expect(driversService.setProfileImage('Dell_OptiPlex', '.hidden'))
      .rejects.toThrow();
  });

  test('throws 400 for image name with slash', async () => {
    await expect(driversService.setProfileImage('Dell_OptiPlex', 'foo/bar'))
      .rejects.toThrow();
  });
});

describe('removeProfileImage', () => {
  beforeEach(async () => {
    const p1 = path.join(DRIVERS_DIR, 'Dell_OptiPlex');
    await fs.mkdir(p1, { recursive: true });
    await fs.writeFile(path.join(p1, 'match.conf'), '[match]\nvendor = Dell\nproduct = OptiPlex\n');
    await fs.writeFile(path.join(p1, 'image.conf'), 'image = win11_pro\n');
  });

  test('deletes image.conf and returns null image', async () => {
    const result = await driversService.removeProfileImage('Dell_OptiPlex');

    expect(result.folder).toBe('Dell_OptiPlex');
    expect(result.image).toBeNull();

    // Verify image.conf was deleted
    await expect(fs.access(path.join(DRIVERS_DIR, 'Dell_OptiPlex', 'image.conf')))
      .rejects.toThrow();
  });

  test('is idempotent (no error when image.conf does not exist)', async () => {
    // Remove image.conf first
    await fs.unlink(path.join(DRIVERS_DIR, 'Dell_OptiPlex', 'image.conf'));

    const result = await driversService.removeProfileImage('Dell_OptiPlex');
    expect(result.image).toBeNull();
  });
});

// =============================================================================
// regeneratePostsync
// =============================================================================

describe('regeneratePostsync', () => {
  test('generates postsync script when profiles reference the image', async () => {
    // Create a profile with image assignment
    const p1 = path.join(DRIVERS_DIR, 'Dell_OptiPlex');
    await fs.mkdir(p1, { recursive: true });
    await fs.writeFile(path.join(p1, 'match.conf'), '[match]\nvendor = Dell\nproduct = OptiPlex\n');
    await fs.writeFile(path.join(p1, 'image.conf'), 'image = win11_pro\n');

    // Create image directory
    const imageDir = path.join(IMAGES_DIR, 'win11_pro');
    await fs.mkdir(imageDir, { recursive: true });

    await driversService.regeneratePostsync('win11_pro');

    // Verify postsync script was created
    const postsyncPath = path.join(imageDir, 'win11_pro.postsync');
    const content = await fs.readFile(postsyncPath, 'utf-8');
    expect(content).toContain('#!/bin/sh');
    expect(content).toContain('win11_pro');
    expect(content).toContain('rsync');
    expect(content).toContain('Dell_OptiPlex');
    expect(content).toContain('sys_vendor');
  });

  test('deletes postsync when no profiles reference the image', async () => {
    // Create a postsync that should be deleted
    const imageDir = path.join(IMAGES_DIR, 'win11_pro');
    await fs.mkdir(imageDir, { recursive: true });
    await fs.writeFile(path.join(imageDir, 'win11_pro.postsync'), '#!/bin/sh\nold script\n');

    await driversService.regeneratePostsync('win11_pro');

    // Verify postsync was deleted
    await expect(fs.access(path.join(imageDir, 'win11_pro.postsync')))
      .rejects.toThrow();
  });

  test('lists multiple profiles referencing same image in script header', async () => {
    // Create two profiles both pointing to same image
    for (const name of ['Dell_OptiPlex', 'HP_EliteDesk']) {
      const dir = path.join(DRIVERS_DIR, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'match.conf'), `[match]\nvendor = ${name}\nproduct = Test\n`);
      await fs.writeFile(path.join(dir, 'image.conf'), 'image = win11_pro\n');
    }

    const imageDir = path.join(IMAGES_DIR, 'win11_pro');
    await fs.mkdir(imageDir, { recursive: true });

    await driversService.regeneratePostsync('win11_pro');

    const content = await fs.readFile(path.join(imageDir, 'win11_pro.postsync'), 'utf-8');
    expect(content).toContain('Dell_OptiPlex');
    expect(content).toContain('HP_EliteDesk');
  });

  test('broadcasts postsync_updated event', async () => {
    await driversService.regeneratePostsync('win11_pro');

    expect(ws.broadcast).toHaveBeenCalledWith('drivers.postsync_updated',
      expect.objectContaining({ image: 'win11_pro' })
    );
  });
});
