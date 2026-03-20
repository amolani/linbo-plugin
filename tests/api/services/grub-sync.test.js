/**
 * Tests for grub-sync module — writes GRUB configs from Authority API to disk
 */
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

describe('grub-sync', () => {
  let tmpDir;
  let grubDir;
  let hostcfgDir;
  let grubSync;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'linbo-grub-sync-test-'));
    grubDir = path.join(tmpDir, 'boot', 'grub');
    hostcfgDir = path.join(grubDir, 'hostcfg');
    await fsp.mkdir(hostcfgDir, { recursive: true });

    // Set LINBO_DIR env so grub-sync uses our temp directory
    process.env.LINBO_DIR = tmpDir;

    // Re-require to pick up new LINBO_DIR
    jest.resetModules();
    grubSync = require('../../../src/services/grub-sync');
  });

  afterEach(async () => {
    delete process.env.LINBO_DIR;
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  describe('rewriteGrubServerIp', () => {
    it('should replace server= with new IP', () => {
      const result = grubSync.rewriteGrubServerIp(
        'linux vmlinuz server=10.0.0.11 group=test',
        '10.0.0.13'
      );
      expect(result).toBe('linux vmlinuz server=10.0.0.13 group=test');
    });

    it('should replace multiple server= occurrences', () => {
      const content = 'linux vmlinuz server=10.0.0.11 group=a\nlinux vmlinuz server=10.0.0.11 group=b';
      const result = grubSync.rewriteGrubServerIp(content, '10.0.0.13');
      expect(result).toBe('linux vmlinuz server=10.0.0.13 group=a\nlinux vmlinuz server=10.0.0.13 group=b');
    });

    it('should return content unchanged when no server= present', () => {
      const content = 'menuentry "Boot" { linux vmlinuz quiet }';
      const result = grubSync.rewriteGrubServerIp(content, '10.0.0.13');
      expect(result).toBe(content);
    });

    it('should return null when content is null', () => {
      expect(grubSync.rewriteGrubServerIp(null, '10.0.0.13')).toBeNull();
    });

    it('should return content when newServerIp is null', () => {
      const content = 'linux vmlinuz server=10.0.0.11';
      expect(grubSync.rewriteGrubServerIp(content, null)).toBe(content);
    });

    it('should return content when newServerIp is empty string', () => {
      const content = 'linux vmlinuz server=10.0.0.11';
      expect(grubSync.rewriteGrubServerIp(content, '')).toBe(content);
    });
  });

  describe('writeGrubConfigs', () => {
    it('should write grub.cfg for id "grub"', async () => {
      const configs = [
        { id: 'grub', filename: 'grub.cfg', content: '# main grub config', updatedAt: null }
      ];
      await grubSync.writeGrubConfigs(configs, '10.0.0.13');
      const content = await fsp.readFile(path.join(grubDir, 'grub.cfg'), 'utf8');
      expect(content).toBe('# main grub config');
    });

    it('should write {id}.cfg for non-grub IDs', async () => {
      const configs = [
        { id: 'raum101', filename: 'raum101.cfg', content: '# raum101 config', updatedAt: null }
      ];
      await grubSync.writeGrubConfigs(configs, '10.0.0.13');
      const content = await fsp.readFile(path.join(grubDir, 'raum101.cfg'), 'utf8');
      expect(content).toBe('# raum101 config');
    });

    it('should apply server= rewrite to written files', async () => {
      const configs = [
        { id: 'raum101', filename: 'raum101.cfg', content: 'linux vmlinuz server=10.0.0.11 group=raum101', updatedAt: null }
      ];
      await grubSync.writeGrubConfigs(configs, '10.0.0.13');
      const content = await fsp.readFile(path.join(grubDir, 'raum101.cfg'), 'utf8');
      expect(content).toBe('linux vmlinuz server=10.0.0.13 group=raum101');
    });

    it('should remove stale .cfg files not in API response', async () => {
      // Create a stale file
      await fsp.writeFile(path.join(grubDir, 'old-group.cfg'), 'stale content');

      const configs = [
        { id: 'grub', filename: 'grub.cfg', content: '# grub', updatedAt: null }
      ];
      await grubSync.writeGrubConfigs(configs, '10.0.0.13');

      // Stale file should be removed
      await expect(fsp.stat(path.join(grubDir, 'old-group.cfg'))).rejects.toThrow();
      // grub.cfg should still exist
      const content = await fsp.readFile(path.join(grubDir, 'grub.cfg'), 'utf8');
      expect(content).toBe('# grub');
    });

    it('should NOT remove subdirectories like hostcfg/', async () => {
      const configs = [
        { id: 'grub', filename: 'grub.cfg', content: '# grub', updatedAt: null }
      ];
      await grubSync.writeGrubConfigs(configs, '10.0.0.13');

      // hostcfg/ directory should still exist
      const stat = await fsp.stat(hostcfgDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should write multiple configs in one call', async () => {
      const configs = [
        { id: 'grub', filename: 'grub.cfg', content: '# main', updatedAt: null },
        { id: 'raum101', filename: 'raum101.cfg', content: '# raum101', updatedAt: null },
        { id: 'raum102', filename: 'raum102.cfg', content: '# raum102', updatedAt: null }
      ];
      await grubSync.writeGrubConfigs(configs, '10.0.0.13');

      const files = (await fsp.readdir(grubDir)).filter(f => f.endsWith('.cfg'));
      expect(files.sort()).toEqual(['grub.cfg', 'raum101.cfg', 'raum102.cfg']);
    });
  });

  describe('writeHostcfgSymlinks', () => {
    it('should create hostname.cfg symlink pointing to ../{hostgroup}.cfg', async () => {
      const hosts = [
        { hostname: 'pc01', mac: 'AA:BB:CC:DD:EE:01', hostgroup: 'raum101' }
      ];
      await grubSync.writeHostcfgSymlinks(hosts);

      const linkTarget = await fsp.readlink(path.join(hostcfgDir, 'pc01.cfg'));
      expect(linkTarget).toBe('../raum101.cfg');
    });

    it('should create MAC-based symlink 01-{mac}.cfg', async () => {
      const hosts = [
        { hostname: 'pc01', mac: 'AA:BB:CC:DD:EE:01', hostgroup: 'raum101' }
      ];
      await grubSync.writeHostcfgSymlinks(hosts);

      const linkTarget = await fsp.readlink(path.join(hostcfgDir, '01-aa-bb-cc-dd-ee-01.cfg'));
      expect(linkTarget).toBe('../raum101.cfg');
    });

    it('should skip hosts without hostgroup', async () => {
      const hosts = [
        { hostname: 'pc01', mac: 'AA:BB:CC:DD:EE:01', hostgroup: '' },
        { hostname: 'pc02', mac: 'AA:BB:CC:DD:EE:02', hostgroup: null }
      ];
      await grubSync.writeHostcfgSymlinks(hosts);

      const files = await fsp.readdir(hostcfgDir);
      expect(files.filter(f => f.endsWith('.cfg'))).toEqual([]);
    });

    it('should remove stale hostcfg files not belonging to any current host', async () => {
      // Create stale symlinks
      await fsp.symlink('../old-group.cfg', path.join(hostcfgDir, 'old-pc.cfg'));
      await fsp.symlink('../old-group.cfg', path.join(hostcfgDir, '01-ff-ff-ff-ff-ff-ff.cfg'));

      const hosts = [
        { hostname: 'pc01', mac: 'AA:BB:CC:DD:EE:01', hostgroup: 'raum101' }
      ];
      await grubSync.writeHostcfgSymlinks(hosts);

      // Stale files should be removed
      await expect(fsp.lstat(path.join(hostcfgDir, 'old-pc.cfg'))).rejects.toThrow();
      await expect(fsp.lstat(path.join(hostcfgDir, '01-ff-ff-ff-ff-ff-ff.cfg'))).rejects.toThrow();

      // Current host files should exist
      const linkTarget = await fsp.readlink(path.join(hostcfgDir, 'pc01.cfg'));
      expect(linkTarget).toBe('../raum101.cfg');
    });

    it('should handle multiple hosts', async () => {
      const hosts = [
        { hostname: 'pc01', mac: 'AA:BB:CC:DD:EE:01', hostgroup: 'raum101' },
        { hostname: 'pc02', mac: 'AA:BB:CC:DD:EE:02', hostgroup: 'raum102' }
      ];
      await grubSync.writeHostcfgSymlinks(hosts);

      const files = (await fsp.readdir(hostcfgDir)).filter(f => f.endsWith('.cfg')).sort();
      expect(files).toEqual([
        '01-aa-bb-cc-dd-ee-01.cfg',
        '01-aa-bb-cc-dd-ee-02.cfg',
        'pc01.cfg',
        'pc02.cfg'
      ]);
    });

    it('should handle hosts with hostname but no mac', async () => {
      const hosts = [
        { hostname: 'pc01', mac: null, hostgroup: 'raum101' }
      ];
      await grubSync.writeHostcfgSymlinks(hosts);

      const linkTarget = await fsp.readlink(path.join(hostcfgDir, 'pc01.cfg'));
      expect(linkTarget).toBe('../raum101.cfg');

      const files = (await fsp.readdir(hostcfgDir)).filter(f => f.endsWith('.cfg'));
      expect(files).toEqual(['pc01.cfg']);
    });

    it('should handle hosts with mac but no hostname', async () => {
      const hosts = [
        { hostname: null, mac: 'AA:BB:CC:DD:EE:01', hostgroup: 'raum101' }
      ];
      await grubSync.writeHostcfgSymlinks(hosts);

      const linkTarget = await fsp.readlink(path.join(hostcfgDir, '01-aa-bb-cc-dd-ee-01.cfg'));
      expect(linkTarget).toBe('../raum101.cfg');

      const files = (await fsp.readdir(hostcfgDir)).filter(f => f.endsWith('.cfg'));
      expect(files).toEqual(['01-aa-bb-cc-dd-ee-01.cfg']);
    });
  });

  // =========================================================================
  // Edge case tests (TEST-02)
  // =========================================================================

  describe('rewriteGrubServerIp edge cases', () => {
    it('should replace multiple server= on the SAME line', () => {
      const content = 'server=10.0.0.1 foo server=10.0.0.1 bar';
      const result = grubSync.rewriteGrubServerIp(content, '10.0.0.13');
      expect(result).toBe('server=10.0.0.13 foo server=10.0.0.13 bar');
    });

    it('should replace server= inside a GRUB comment', () => {
      const content = '# linux vmlinuz server=10.0.0.1 quiet';
      const result = grubSync.rewriteGrubServerIp(content, '10.0.0.13');
      expect(result).toBe('# linux vmlinuz server=10.0.0.13 quiet');
    });

    it('should replace server= with hostname instead of IP', () => {
      const content = 'linux vmlinuz server=linbo.example.com group=test';
      const result = grubSync.rewriteGrubServerIp(content, '10.0.0.13');
      expect(result).toBe('linux vmlinuz server=10.0.0.13 group=test');
    });

    it('should replace server= followed by newline', () => {
      const content = 'server=10.0.0.1\nnext line';
      const result = grubSync.rewriteGrubServerIp(content, '10.0.0.13');
      expect(result).toBe('server=10.0.0.13\nnext line');
    });

    it('should return empty string unchanged (not null)', () => {
      // Empty string is falsy, so rewriteGrubServerIp returns it as-is
      const result = grubSync.rewriteGrubServerIp('', '10.0.0.13');
      expect(result).toBe('');
    });

    it('should return content unchanged when no server= present', () => {
      const content = 'menuentry "Boot" { linux vmlinuz quiet }';
      const result = grubSync.rewriteGrubServerIp(content, '10.0.0.13');
      expect(result).toBe(content);
    });
  });

  describe('writeHostcfgSymlinks edge cases', () => {
    it('should handle hostname with hyphens', async () => {
      const hosts = [
        { hostname: 'raum-101-pc01', mac: 'AA:BB:CC:DD:EE:01', hostgroup: 'raum101' }
      ];
      await grubSync.writeHostcfgSymlinks(hosts);

      const linkTarget = await fsp.readlink(path.join(hostcfgDir, 'raum-101-pc01.cfg'));
      expect(linkTarget).toBe('../raum101.cfg');
    });

    it('should handle hostname with underscores', async () => {
      const hosts = [
        { hostname: 'raum_101_pc01', mac: 'AA:BB:CC:DD:EE:01', hostgroup: 'raum101' }
      ];
      await grubSync.writeHostcfgSymlinks(hosts);

      const linkTarget = await fsp.readlink(path.join(hostcfgDir, 'raum_101_pc01.cfg'));
      expect(linkTarget).toBe('../raum101.cfg');
    });

    it('should handle hostname with numbers only', async () => {
      const hosts = [
        { hostname: '12345', mac: 'AA:BB:CC:DD:EE:01', hostgroup: 'raum101' }
      ];
      await grubSync.writeHostcfgSymlinks(hosts);

      const linkTarget = await fsp.readlink(path.join(hostcfgDir, '12345.cfg'));
      expect(linkTarget).toBe('../raum101.cfg');
    });

    it('should skip hostname symlink for empty string hostname but create MAC symlink', async () => {
      const hosts = [
        { hostname: '', mac: 'AA:BB:CC:DD:EE:01', hostgroup: 'raum101' }
      ];
      await grubSync.writeHostcfgSymlinks(hosts);

      // MAC symlink should exist
      const macLink = await fsp.readlink(path.join(hostcfgDir, '01-aa-bb-cc-dd-ee-01.cfg'));
      expect(macLink).toBe('../raum101.cfg');

      // No hostname symlink (empty string is falsy)
      const files = (await fsp.readdir(hostcfgDir)).filter(f => f.endsWith('.cfg'));
      expect(files).toEqual(['01-aa-bb-cc-dd-ee-01.cfg']);
    });

    it('should create hostname symlink but skip MAC for empty string MAC', async () => {
      const hosts = [
        { hostname: 'pc01', mac: '', hostgroup: 'raum101' }
      ];
      await grubSync.writeHostcfgSymlinks(hosts);

      // Hostname symlink should exist
      const hostLink = await fsp.readlink(path.join(hostcfgDir, 'pc01.cfg'));
      expect(hostLink).toBe('../raum101.cfg');

      // No MAC symlink (empty string is falsy)
      const files = (await fsp.readdir(hostcfgDir)).filter(f => f.endsWith('.cfg'));
      expect(files).toEqual(['pc01.cfg']);
    });

    it('should handle 100 hosts correctly', async () => {
      const hosts = [];
      for (let i = 0; i < 100; i++) {
        const hex = i.toString(16).padStart(2, '0').toUpperCase();
        hosts.push({
          hostname: `pc${i.toString().padStart(3, '0')}`,
          mac: `AA:BB:CC:DD:EE:${hex}`,
          hostgroup: 'raum101',
        });
      }
      await grubSync.writeHostcfgSymlinks(hosts);

      const files = (await fsp.readdir(hostcfgDir)).filter(f => f.endsWith('.cfg'));
      // 100 hostname symlinks + 100 MAC symlinks = 200
      expect(files).toHaveLength(200);

      // Spot-check a few
      const link0 = await fsp.readlink(path.join(hostcfgDir, 'pc000.cfg'));
      expect(link0).toBe('../raum101.cfg');

      const link99 = await fsp.readlink(path.join(hostcfgDir, 'pc099.cfg'));
      expect(link99).toBe('../raum101.cfg');

      const macLink = await fsp.readlink(path.join(hostcfgDir, '01-aa-bb-cc-dd-ee-63.cfg'));
      expect(macLink).toBe('../raum101.cfg');
    });

    it('should overwrite existing symlinks (forceSymlink)', async () => {
      // Create symlink pointing to old target
      await fsp.symlink('../old-group.cfg', path.join(hostcfgDir, 'pc01.cfg'));

      const hosts = [
        { hostname: 'pc01', mac: 'AA:BB:CC:DD:EE:01', hostgroup: 'raum101' }
      ];
      await grubSync.writeHostcfgSymlinks(hosts);

      // Should now point to new target
      const linkTarget = await fsp.readlink(path.join(hostcfgDir, 'pc01.cfg'));
      expect(linkTarget).toBe('../raum101.cfg');
    });
  });
});
