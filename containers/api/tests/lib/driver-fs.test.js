/**
 * LINBO Docker - Driver Filesystem Utilities Tests
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');

const TEST_BASE = path.join(os.tmpdir(), `driver-fs-test-${Date.now()}`);

const {
  listDirRecursive, countFiles, getDirSize, removeSymlinks,
  computeSetHash, generateManifest,
} = require('../../src/lib/driver-fs');

describe('driver-fs', () => {
  beforeEach(async () => {
    await fs.rm(TEST_BASE, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(TEST_BASE, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(TEST_BASE, { recursive: true, force: true }).catch(() => {});
  });

  // ===========================================================================
  // listDirRecursive
  // ===========================================================================

  describe('listDirRecursive()', () => {
    test('lists files and directories', async () => {
      const dir = path.join(TEST_BASE, 'list-test');
      await fs.mkdir(path.join(dir, 'sub'), { recursive: true });
      await fs.writeFile(path.join(dir, 'a.txt'), 'hello');
      await fs.writeFile(path.join(dir, 'sub', 'b.txt'), 'world');

      const result = await listDirRecursive(dir, '');
      const names = result.map(r => r.path);
      expect(names).toContain('a.txt');
      expect(names).toContain('sub');
      expect(names).toContain('sub/b.txt');
    });

    test('returns empty array for empty directory', async () => {
      const dir = path.join(TEST_BASE, 'empty');
      await fs.mkdir(dir, { recursive: true });
      const result = await listDirRecursive(dir, '');
      expect(result).toEqual([]);
    });

    test('includes file sizes', async () => {
      const dir = path.join(TEST_BASE, 'size-test');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'file.txt'), 'content');

      const result = await listDirRecursive(dir, '');
      const file = result.find(r => r.name === 'file.txt');
      expect(file.size).toBe(7); // 'content' = 7 bytes
      expect(file.isDirectory).toBe(false);
    });

    test('marks directories correctly', async () => {
      const dir = path.join(TEST_BASE, 'dir-test');
      await fs.mkdir(path.join(dir, 'subdir'), { recursive: true });

      const result = await listDirRecursive(dir, '');
      const subdir = result.find(r => r.name === 'subdir');
      expect(subdir.isDirectory).toBe(true);
      expect(subdir.size).toBe(0);
    });
  });

  // ===========================================================================
  // countFiles
  // ===========================================================================

  describe('countFiles()', () => {
    test('counts files recursively', async () => {
      const dir = path.join(TEST_BASE, 'count-test');
      await fs.mkdir(path.join(dir, 'sub'), { recursive: true });
      await fs.writeFile(path.join(dir, 'a.txt'), 'a');
      await fs.writeFile(path.join(dir, 'b.txt'), 'b');
      await fs.writeFile(path.join(dir, 'sub', 'c.txt'), 'c');

      expect(await countFiles(dir)).toBe(3);
    });

    test('returns 0 for empty directory', async () => {
      const dir = path.join(TEST_BASE, 'empty-count');
      await fs.mkdir(dir, { recursive: true });
      expect(await countFiles(dir)).toBe(0);
    });

    test('returns 0 for non-existent directory', async () => {
      expect(await countFiles(path.join(TEST_BASE, 'nonexistent'))).toBe(0);
    });
  });

  // ===========================================================================
  // getDirSize
  // ===========================================================================

  describe('getDirSize()', () => {
    test('sums file sizes recursively', async () => {
      const dir = path.join(TEST_BASE, 'size-sum');
      await fs.mkdir(path.join(dir, 'sub'), { recursive: true });
      await fs.writeFile(path.join(dir, 'a.txt'), 'hello'); // 5 bytes
      await fs.writeFile(path.join(dir, 'sub', 'b.txt'), 'world!'); // 6 bytes

      expect(await getDirSize(dir)).toBe(11);
    });

    test('returns 0 for empty directory', async () => {
      const dir = path.join(TEST_BASE, 'empty-size');
      await fs.mkdir(dir, { recursive: true });
      expect(await getDirSize(dir)).toBe(0);
    });

    test('returns 0 for non-existent directory', async () => {
      expect(await getDirSize(path.join(TEST_BASE, 'nonexistent'))).toBe(0);
    });
  });

  // ===========================================================================
  // removeSymlinks
  // ===========================================================================

  describe('removeSymlinks()', () => {
    test('removes symlinks', async () => {
      const dir = path.join(TEST_BASE, 'symlink-test');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'real.txt'), 'data');
      await fs.symlink(path.join(dir, 'real.txt'), path.join(dir, 'link.txt'));

      await removeSymlinks(dir);

      const entries = await fs.readdir(dir);
      expect(entries).toEqual(['real.txt']);
    });

    test('removes symlinks in subdirectories', async () => {
      const dir = path.join(TEST_BASE, 'symlink-sub');
      await fs.mkdir(path.join(dir, 'sub'), { recursive: true });
      await fs.writeFile(path.join(dir, 'sub', 'real.txt'), 'data');
      await fs.symlink(path.join(dir, 'sub', 'real.txt'), path.join(dir, 'sub', 'link.txt'));

      await removeSymlinks(dir);

      const entries = await fs.readdir(path.join(dir, 'sub'));
      expect(entries).toEqual(['real.txt']);
    });

    test('handles directory with no symlinks', async () => {
      const dir = path.join(TEST_BASE, 'no-symlinks');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'file.txt'), 'data');

      await removeSymlinks(dir);

      const entries = await fs.readdir(dir);
      expect(entries).toEqual(['file.txt']);
    });
  });

  // ===========================================================================
  // computeSetHash
  // ===========================================================================

  describe('computeSetHash()', () => {
    test('produces consistent hash for same content', async () => {
      const dir = path.join(TEST_BASE, 'hash-test');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'a.txt'), 'hello');
      await fs.writeFile(path.join(dir, 'b.txt'), 'world');

      const hash1 = await computeSetHash(dir);
      const hash2 = await computeSetHash(dir);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{32}$/);
    });

    test('produces different hash for different content', async () => {
      const dir1 = path.join(TEST_BASE, 'hash-diff1');
      const dir2 = path.join(TEST_BASE, 'hash-diff2');
      await fs.mkdir(dir1, { recursive: true });
      await fs.mkdir(dir2, { recursive: true });
      await fs.writeFile(path.join(dir1, 'a.txt'), 'hello');
      await fs.writeFile(path.join(dir2, 'a.txt'), 'different');

      const hash1 = await computeSetHash(dir1);
      const hash2 = await computeSetHash(dir2);
      expect(hash1).not.toBe(hash2);
    });

    test('handles empty directory', async () => {
      const dir = path.join(TEST_BASE, 'hash-empty');
      await fs.mkdir(dir, { recursive: true });

      const hash = await computeSetHash(dir);
      expect(hash).toMatch(/^[0-9a-f]{32}$/);
    });

    test('handles non-existent directory', async () => {
      const hash = await computeSetHash(path.join(TEST_BASE, 'nonexistent'));
      expect(hash).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  // ===========================================================================
  // generateManifest
  // ===========================================================================

  describe('generateManifest()', () => {
    test('generates manifest with sets', async () => {
      const pcDir = path.join(TEST_BASE, 'manifest-test');
      await fs.mkdir(path.join(pcDir, 'drivers', 'NIC'), { recursive: true });
      await fs.mkdir(path.join(pcDir, 'drivers', 'GPU'), { recursive: true });
      await fs.writeFile(path.join(pcDir, 'drivers', 'NIC', 'e1000e.inf'), '[Driver]');
      await fs.writeFile(path.join(pcDir, 'drivers', 'GPU', 'amd.inf'), '[Driver]');

      const mapHash = 'abc123def456abc123def456abc123de';
      const manifest = await generateManifest(pcDir, mapHash);

      expect(manifest.mapHash).toBe(mapHash);
      expect(manifest.repoHash).toMatch(/^[0-9a-f]{32}$/);
      expect(manifest.sets).toHaveProperty('NIC');
      expect(manifest.sets).toHaveProperty('GPU');
      expect(manifest.sets.NIC.fileCount).toBe(1);
      expect(manifest.sets.NIC.totalSize).toBeGreaterThan(0);
      expect(manifest.sets.NIC.hash).toMatch(/^[0-9a-f]{32}$/);
      expect(manifest.generatedAt).toBeDefined();

      // Verify file was written
      const written = JSON.parse(await fs.readFile(path.join(pcDir, 'driver-manifest.json'), 'utf-8'));
      expect(written.repoHash).toBe(manifest.repoHash);
    });

    test('generates manifest with no sets', async () => {
      const pcDir = path.join(TEST_BASE, 'manifest-empty');
      await fs.mkdir(path.join(pcDir, 'drivers'), { recursive: true });

      const manifest = await generateManifest(pcDir, 'abc123def456abc123def456abc123de');
      expect(manifest.sets).toEqual({});
      expect(manifest.repoHash).toMatch(/^[0-9a-f]{32}$/);
    });

    test('generates manifest when drivers dir does not exist', async () => {
      const pcDir = path.join(TEST_BASE, 'manifest-nodir');
      await fs.mkdir(pcDir, { recursive: true });

      const manifest = await generateManifest(pcDir, 'abc123def456abc123def456abc123de');
      expect(manifest.sets).toEqual({});
    });
  });
});
