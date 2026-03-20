/**
 * Tests for atomic file write utility
 */
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { atomicWrite, atomicWriteWithMd5, safeUnlink, forceSymlink } = require('../../src/lib/atomic-write');

describe('atomic-write', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'linbo-atomic-test-'));
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  describe('atomicWrite', () => {
    it('should write a file atomically', async () => {
      const filepath = path.join(tmpDir, 'test.txt');
      await atomicWrite(filepath, 'hello world');
      const content = await fsp.readFile(filepath, 'utf8');
      expect(content).toBe('hello world');
    });

    it('should overwrite an existing file', async () => {
      const filepath = path.join(tmpDir, 'test.txt');
      await fsp.writeFile(filepath, 'old content');
      await atomicWrite(filepath, 'new content');
      const content = await fsp.readFile(filepath, 'utf8');
      expect(content).toBe('new content');
    });

    it('should create parent directories if needed', async () => {
      const filepath = path.join(tmpDir, 'sub', 'dir', 'test.txt');
      await atomicWrite(filepath, 'nested');
      const content = await fsp.readFile(filepath, 'utf8');
      expect(content).toBe('nested');
    });

    it('should not leave temp files on success', async () => {
      const filepath = path.join(tmpDir, 'test.txt');
      await atomicWrite(filepath, 'content');
      const files = await fsp.readdir(tmpDir);
      expect(files).toEqual(['test.txt']);
    });
  });

  describe('atomicWriteWithMd5', () => {
    it('should write file and MD5 sidecar', async () => {
      const filepath = path.join(tmpDir, 'start.conf.win11_efi');
      const hash = await atomicWriteWithMd5(filepath, 'test content');

      const content = await fsp.readFile(filepath, 'utf8');
      expect(content).toBe('test content');

      const md5 = await fsp.readFile(`${filepath}.md5`, 'utf8');
      expect(md5).toBe(hash);
      expect(md5).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should produce correct MD5 hash', async () => {
      const crypto = require('crypto');
      const filepath = path.join(tmpDir, 'test.txt');
      const content = 'known content';
      const expectedHash = crypto.createHash('md5').update(content).digest('hex');

      const hash = await atomicWriteWithMd5(filepath, content);
      expect(hash).toBe(expectedHash);
    });
  });

  describe('safeUnlink', () => {
    it('should remove an existing file', async () => {
      const filepath = path.join(tmpDir, 'test.txt');
      await fsp.writeFile(filepath, 'content');
      await safeUnlink(filepath);
      await expect(fsp.stat(filepath)).rejects.toThrow();
    });

    it('should not throw for non-existent file', async () => {
      const filepath = path.join(tmpDir, 'nonexistent.txt');
      await expect(safeUnlink(filepath)).resolves.toBeUndefined();
    });
  });

  describe('forceSymlink', () => {
    it('should create a symlink', async () => {
      const target = 'start.conf.win11';
      const linkPath = path.join(tmpDir, 'start.conf-10.0.0.1');
      await forceSymlink(target, linkPath);
      const resolved = await fsp.readlink(linkPath);
      expect(resolved).toBe(target);
    });

    it('should replace an existing symlink', async () => {
      const linkPath = path.join(tmpDir, 'start.conf-10.0.0.1');
      await fsp.symlink('old-target', linkPath);
      await forceSymlink('new-target', linkPath);
      const resolved = await fsp.readlink(linkPath);
      expect(resolved).toBe('new-target');
    });

    it('should replace an existing file with symlink', async () => {
      const linkPath = path.join(tmpDir, 'start.conf-10.0.0.1');
      await fsp.writeFile(linkPath, 'regular file');
      await forceSymlink('target', linkPath);
      const resolved = await fsp.readlink(linkPath);
      expect(resolved).toBe('target');
    });

    it('should create parent directories', async () => {
      const linkPath = path.join(tmpDir, 'hostcfg', 'test.cfg');
      await forceSymlink('../group.cfg', linkPath);
      const resolved = await fsp.readlink(linkPath);
      expect(resolved).toBe('../group.cfg');
    });
  });
});
