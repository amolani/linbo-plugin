/**
 * Tests for GRUB Generator (DB-free)
 */
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

// Set LINBO_DIR BEFORE requiring the module (it reads env at load time)
const tmpDir = `${os.tmpdir()}/linbo-grub-gen-${process.pid}`;
process.env.LINBO_DIR = tmpDir;
process.env.LINBO_SERVER_IP = '10.0.0.13';
process.env.WEB_PORT = '8080';

beforeAll(async () => {
  await fsp.mkdir(tmpDir, { recursive: true });
});
afterAll(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
  delete process.env.LINBO_DIR;
});

const {
  getGrubPart,
  getGrubOstype,
  findCachePartition,
  getOsPartitionIndex,
  hexToGrubRgb,
  getOsLabel,
  macToGrubFilename,
  applyTemplate,
  regenerateAll,
  generateConfigGrub,
  generateMainGrub,
} = require('../../../src/services/grub-generator');

// Sample data matching LMN Authority API shapes
const SAMPLE_CONFIG = {
  id: 'win11_efi_sata',
  name: 'Windows 11 EFI SATA',
  osEntries: [
    {
      name: 'Windows 11',
      version: '24H2',
      iconname: 'win10.svg',
      baseimage: 'win11.qcow2',
      boot: '/dev/sda3',
      root: '/dev/sda3',
      kernel: 'auto',
      initrd: '',
      append: '',
      startEnabled: true,
      syncEnabled: true,
      newEnabled: true,
    },
  ],
  partitions: [
    { device: '/dev/sda1', label: 'efi', size: '200M', fsType: 'vfat', bootable: true },
    { device: '/dev/sda2', label: 'msr', size: '128M', fsType: '', bootable: false },
    { device: '/dev/sda3', label: 'windows', size: '80G', fsType: 'ntfs', bootable: false },
    { device: '/dev/sda4', label: 'cache', size: '', fsType: 'ext4', bootable: false },
  ],
  grubPolicy: { timeout: 5, defaultEntry: 0, hiddenMenu: false },
};

const SAMPLE_HOSTS = [
  {
    mac: 'AA:BB:CC:DD:EE:01',
    hostname: 'r100-pc01',
    ip: '10.0.100.1',
    hostgroup: 'win11_efi_sata',
    pxeEnabled: true,
    pxeFlag: 1,
    startConfId: 'win11_efi_sata',
  },
  {
    mac: 'AA:BB:CC:DD:EE:02',
    hostname: 'r100-pc02',
    ip: '10.0.100.2',
    hostgroup: 'win11_efi_sata',
    pxeEnabled: true,
    pxeFlag: 1,
    startConfId: 'win11_efi_sata',
  },
];

// =============================================================================
// Pure helper tests
// =============================================================================

describe('getGrubPart', () => {
  it('converts SATA device', () => expect(getGrubPart('/dev/sda1')).toBe('(hd0,1)'));
  it('converts NVMe device', () => expect(getGrubPart('/dev/nvme0n1p2')).toBe('(hd0,2)'));
  it('converts eMMC device', () => expect(getGrubPart('/dev/mmcblk0p1')).toBe('(hd0,1)'));
  it('converts virtio device', () => expect(getGrubPart('/dev/vda3')).toBe('(hd0,3)'));
  it('handles second disk', () => expect(getGrubPart('/dev/sdb2')).toBe('(hd1,2)'));
  it('returns default for null', () => expect(getGrubPart(null)).toBe('(hd0,1)'));

  // Uniform block device names (LINBO 4.3.5+)
  it('converts uniform device disk0p1', () => expect(getGrubPart('/dev/disk0p1')).toBe('(hd0,1)'));
  it('converts uniform device disk0p3', () => expect(getGrubPart('/dev/disk0p3')).toBe('(hd0,3)'));
  it('converts uniform second disk', () => expect(getGrubPart('/dev/disk1p2')).toBe('(hd1,2)'));
  it('converts uniform double-digit partition', () => expect(getGrubPart('/dev/disk0p10')).toBe('(hd0,10)'));
  it('rejects disk0p0 (invalid)', () => expect(getGrubPart('/dev/disk0p0')).toBe('(hd0,1)')); // fallback
  it('rejects bare disk0 (no partition)', () => expect(getGrubPart('/dev/disk0')).toBe('(hd0,1)')); // fallback
});

describe('getGrubOstype', () => {
  it('detects Windows 11', () => expect(getGrubOstype('Windows 11 Pro')).toBe('win11'));
  it('detects Ubuntu', () => expect(getGrubOstype('Ubuntu 22.04')).toBe('ubuntu'));
  it('detects Debian', () => expect(getGrubOstype('Debian 12')).toBe('debian'));
  it('returns unknown for null', () => expect(getGrubOstype(null)).toBe('unknown'));
});

describe('findCachePartition', () => {
  it('finds partition by label "cache"', () => {
    const result = findCachePartition(SAMPLE_CONFIG.partitions);
    expect(result.label).toBe('cache');
    expect(result.device).toBe('/dev/sda4');
  });

  it('returns null for empty array', () => {
    expect(findCachePartition([])).toBeNull();
  });
});

describe('getOsPartitionIndex', () => {
  it('finds correct index', () => {
    expect(getOsPartitionIndex(SAMPLE_CONFIG.partitions, '/dev/sda3')).toBe(3);
  });

  it('returns 1 for unknown device', () => {
    expect(getOsPartitionIndex(SAMPLE_CONFIG.partitions, '/dev/sda99')).toBe(1);
  });
});

describe('hexToGrubRgb', () => {
  it('converts hex to RGB', () => expect(hexToGrubRgb('#2a4457')).toBe('42,68,87'));
  it('returns default for invalid', () => expect(hexToGrubRgb('invalid')).toBe('42,68,87'));
});

describe('macToGrubFilename', () => {
  it('converts MAC to GRUB format', () => {
    expect(macToGrubFilename('AA:BB:CC:DD:EE:FF')).toBe('01-aa-bb-cc-dd-ee-ff');
  });
  it('handles lowercase input', () => {
    expect(macToGrubFilename('aa:bb:cc:dd:ee:ff')).toBe('01-aa-bb-cc-dd-ee-ff');
  });
});

describe('applyTemplate', () => {
  it('replaces placeholders', () => {
    expect(applyTemplate('Hello @@name@@ @@ver@@', { name: 'World', ver: '1.0' }))
      .toBe('Hello World 1.0');
  });
  it('replaces multiple occurrences', () => {
    expect(applyTemplate('@@x@@ and @@x@@', { x: 'A' })).toBe('A and A');
  });
  it('replaces with empty string for null value', () => {
    expect(applyTemplate('@@x@@test', { x: null })).toBe('test');
  });
});

// =============================================================================
// Config generation tests
// =============================================================================

describe('generateConfigGrub', () => {
  it('generates a valid config file', async () => {
    const { filepath, content } = await generateConfigGrub(SAMPLE_CONFIG, { server: '10.0.0.13' });

    expect(filepath).toContain('win11_efi_sata.cfg');
    expect(content).toContain('group win11_efi_sata');
    expect(content).toContain("menuentry 'Windows 11 (Start)'");
    expect(content).toContain('server=10.0.0.13');
    expect(content).toContain('group=win11_efi_sata');
    expect(content).toContain('hostgroup=win11_efi_sata');

    // File actually written
    const onDisk = await fsp.readFile(filepath, 'utf8');
    expect(onDisk).toBe(content);
  });
});

describe('generateMainGrub', () => {
  it('generates main grub.cfg with MAC mapping', async () => {
    const { filepath, content } = await generateMainGrub(SAMPLE_HOSTS, [SAMPLE_CONFIG], { server: '10.0.0.13' });

    expect(filepath).toContain('grub.cfg');
    expect(content).toContain('aa:bb:cc:dd:ee:01');
    expect(content).toContain('AA:BB:CC:DD:EE:01');
    expect(content).toContain('set group="win11_efi_sata"');

    const onDisk = await fsp.readFile(filepath, 'utf8');
    expect(onDisk).toBe(content);
  });

  it('handles empty hosts', async () => {
    const { content } = await generateMainGrub([], [SAMPLE_CONFIG]);
    // Should still have a valid GRUB config with failsafe fallback
    expect(content).toContain('LINBO netboot in failsafe mode');
  });
});

describe('regenerateAll', () => {
  it('generates all files including MAC-based hostcfg', async () => {
    const result = await regenerateAll(SAMPLE_HOSTS, [SAMPLE_CONFIG], { server: '10.0.0.13' });

    expect(result.configs).toBe(1);
    expect(result.hosts).toBe(2);
    expect(result.hostcfgMac).toBe(2);

    // Check main grub.cfg exists
    const mainCfg = await fsp.readFile(path.join(tmpDir, 'boot/grub/grub.cfg'), 'utf8');
    expect(mainCfg).toContain('aa:bb:cc:dd:ee:01');

    // Check config file exists
    const configCfg = await fsp.readFile(path.join(tmpDir, 'boot/grub/win11_efi_sata.cfg'), 'utf8');
    expect(configCfg).toContain('Windows 11');

    // Check hostname symlink
    const hostnameLink = await fsp.readlink(path.join(tmpDir, 'boot/grub/hostcfg/r100-pc01.cfg'));
    expect(hostnameLink).toBe('../win11_efi_sata.cfg');

    // Check MAC-based symlink (GRUB fallback)
    const macLink = await fsp.readlink(path.join(tmpDir, 'boot/grub/hostcfg/01-aa-bb-cc-dd-ee-01.cfg'));
    expect(macLink).toBe('../win11_efi_sata.cfg');
  });

  it('cleans up stale hostcfg files', async () => {
    // Create a stale symlink that should be cleaned up
    const hostcfgDir = path.join(tmpDir, 'boot/grub/hostcfg');
    await fsp.mkdir(hostcfgDir, { recursive: true });
    await fsp.writeFile(path.join(hostcfgDir, 'old-host.cfg'), 'stale');

    await regenerateAll(SAMPLE_HOSTS, [SAMPLE_CONFIG]);

    // Stale file should be removed
    await expect(fsp.stat(path.join(hostcfgDir, 'old-host.cfg'))).rejects.toThrow();

    // Valid files should exist
    await expect(fsp.lstat(path.join(hostcfgDir, 'r100-pc01.cfg'))).resolves.toBeTruthy();
  });

  it('skips hosts without hostgroup', async () => {
    const hosts = [{ mac: 'AA:BB:CC:DD:EE:99', hostname: 'orphan', ip: '10.0.0.99' }];
    const result = await regenerateAll(hosts, [SAMPLE_CONFIG]);
    expect(result.hosts).toBe(0);
    expect(result.hostcfgMac).toBe(0);
  });
});
