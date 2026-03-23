'use strict';

const {
  getLinboSetting,
  getGrubPart,
  getGrubOstype,
  findCachePartition,
  getOsPartitionIndex,
  hexToGrubRgb,
  getOsLabel,
  applyTemplate,
  macToGrubFilename,
} = require('../../../src/services/grub-generator');

// =============================================================================
// getLinboSetting
// =============================================================================

describe('getLinboSetting', () => {
  it('returns exact match when key exists', () => {
    expect(getLinboSetting({ Server: '10.0.0.1' }, 'Server')).toBe('10.0.0.1');
  });

  it('falls back to lowercase key', () => {
    expect(getLinboSetting({ server: '10.0.0.1' }, 'Server')).toBe('10.0.0.1');
  });

  it('falls back to case-insensitive iteration', () => {
    expect(getLinboSetting({ SERVER: '10.0.0.1' }, 'server')).toBe('10.0.0.1');
  });

  it('returns undefined for null settings', () => {
    expect(getLinboSetting(null, 'Server')).toBeUndefined();
  });

  it('returns undefined for missing key', () => {
    expect(getLinboSetting({ Server: '10.0.0.1' }, 'Group')).toBeUndefined();
  });
});

// =============================================================================
// getGrubPart
// =============================================================================

describe('getGrubPart', () => {
  it('returns default (hd0,1) for null', () => {
    expect(getGrubPart(null)).toBe('(hd0,1)');
  });

  it('returns default (hd0,1) for undefined', () => {
    expect(getGrubPart(undefined)).toBe('(hd0,1)');
  });

  it('converts /dev/sda1 to (hd0,1)', () => {
    expect(getGrubPart('/dev/sda1')).toBe('(hd0,1)');
  });

  it('converts /dev/sda2 to (hd0,2)', () => {
    expect(getGrubPart('/dev/sda2')).toBe('(hd0,2)');
  });

  it('converts /dev/sdb1 to (hd1,1) — disk letter mapping', () => {
    expect(getGrubPart('/dev/sdb1')).toBe('(hd1,1)');
  });

  it('converts /dev/nvme0n1p2 to (hd0,2)', () => {
    expect(getGrubPart('/dev/nvme0n1p2')).toBe('(hd0,2)');
  });

  it('converts /dev/nvme1n1p3 to (hd1,3)', () => {
    expect(getGrubPart('/dev/nvme1n1p3')).toBe('(hd1,3)');
  });

  it('converts /dev/mmcblk0p1 to (hd0,1)', () => {
    expect(getGrubPart('/dev/mmcblk0p1')).toBe('(hd0,1)');
  });

  it('converts /dev/vda1 to (hd0,1) — virtio disk', () => {
    expect(getGrubPart('/dev/vda1')).toBe('(hd0,1)');
  });

  it('returns default (hd0,1) for unknown format', () => {
    expect(getGrubPart('/dev/xyzzy42')).toBe('(hd0,1)');
  });
});

// =============================================================================
// getGrubOstype
// =============================================================================

describe('getGrubOstype', () => {
  it('returns unknown for null', () => {
    expect(getGrubOstype(null)).toBe('unknown');
  });

  it('detects Windows 11 Pro → win11', () => {
    expect(getGrubOstype('Windows 11 Pro')).toBe('win11');
  });

  it('detects Windows 10 Education → win10', () => {
    expect(getGrubOstype('Windows 10 Education')).toBe('win10');
  });

  it('detects Windows 8.1 → win8', () => {
    expect(getGrubOstype('Windows 8.1')).toBe('win8');
  });

  it('detects Windows 7 Pro → win7', () => {
    expect(getGrubOstype('Windows 7 Pro')).toBe('win7');
  });

  it('detects generic Windows Server → windows', () => {
    expect(getGrubOstype('Windows Server')).toBe('windows');
  });

  it('detects Ubuntu 22.04 → ubuntu', () => {
    expect(getGrubOstype('Ubuntu 22.04')).toBe('ubuntu');
  });

  it('detects Debian 12 → debian', () => {
    expect(getGrubOstype('Debian 12')).toBe('debian');
  });

  it('detects Linux Mint 21 → linuxmint', () => {
    expect(getGrubOstype('Linux Mint 21')).toBe('linuxmint');
  });

  it('detects Fedora 39 → fedora', () => {
    expect(getGrubOstype('Fedora 39')).toBe('fedora');
  });

  it('detects openSUSE Leap → opensuse', () => {
    expect(getGrubOstype('openSUSE Leap')).toBe('opensuse');
  });

  it('detects Arch Linux → arch', () => {
    expect(getGrubOstype('Arch Linux')).toBe('arch');
  });

  it('detects Manjaro → manjaro', () => {
    expect(getGrubOstype('Manjaro')).toBe('manjaro');
  });

  it('detects CentOS 7 → centos', () => {
    expect(getGrubOstype('CentOS 7')).toBe('centos');
  });

  it('detects RHEL 9 → rhel', () => {
    expect(getGrubOstype('RHEL 9')).toBe('rhel');
  });

  it('detects generic Some Linux Distro → linux', () => {
    expect(getGrubOstype('Some Linux Distro')).toBe('linux');
  });

  it('returns unknown for unrecognized ChromeOS', () => {
    expect(getGrubOstype('ChromeOS')).toBe('unknown');
  });
});

// =============================================================================
// findCachePartition
// =============================================================================

describe('findCachePartition', () => {
  it('returns null for null input', () => {
    expect(findCachePartition(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(findCachePartition(undefined)).toBeNull();
  });

  it('returns null for non-array input', () => {
    expect(findCachePartition('not-an-array')).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(findCachePartition([])).toBeNull();
  });

  it('finds partition with label "cache" (case insensitive)', () => {
    const partitions = [
      { device: '/dev/sda1', label: 'Windows', fsType: 'ntfs' },
      { device: '/dev/sda2', label: 'Cache', fsType: 'ext4' },
    ];
    expect(findCachePartition(partitions)).toBe(partitions[1]);
  });

  it('falls back to ext4 partition without EFI/Windows label', () => {
    const partitions = [
      { device: '/dev/sda1', label: 'EFI', fsType: 'vfat', partitionId: 'ef00' },
      { device: '/dev/sda2', label: 'Windows', fsType: 'ntfs' },
      { device: '/dev/sda3', label: 'data', fsType: 'ext4', partitionId: '8300' },
    ];
    expect(findCachePartition(partitions)).toBe(partitions[2]);
  });

  it('falls back to btrfs partition without EFI/Windows label', () => {
    const partitions = [
      { device: '/dev/sda1', label: 'Windows', fsType: 'ntfs' },
      { device: '/dev/sda2', label: 'data', fsType: 'btrfs', partitionId: '8300' },
    ];
    expect(findCachePartition(partitions)).toBe(partitions[1]);
  });

  it('skips partitions with partitionId ef00', () => {
    const partitions = [
      { device: '/dev/sda1', label: '', fsType: 'ext4', partitionId: 'ef00' },
    ];
    expect(findCachePartition(partitions)).toBeNull();
  });

  it('skips partitions with partitionId 0c01', () => {
    const partitions = [
      { device: '/dev/sda1', label: '', fsType: 'ext4', partitionId: '0c01' },
    ];
    expect(findCachePartition(partitions)).toBeNull();
  });
});

// =============================================================================
// getOsPartitionIndex
// =============================================================================

describe('getOsPartitionIndex', () => {
  it('returns 1 for null partitions', () => {
    expect(getOsPartitionIndex(null, '/dev/sda1')).toBe(1);
  });

  it('returns 1 when no partition matches', () => {
    const partitions = [{ device: '/dev/sda1' }, { device: '/dev/sda2' }];
    expect(getOsPartitionIndex(partitions, '/dev/sda5')).toBe(1);
  });

  it('returns 1-based index for matching device', () => {
    const partitions = [
      { device: '/dev/sda1' },
      { device: '/dev/sda2' },
      { device: '/dev/sda3' },
    ];
    expect(getOsPartitionIndex(partitions, '/dev/sda2')).toBe(2);
  });

  it('returns 1 for null rootDevice', () => {
    const partitions = [{ device: '/dev/sda1' }];
    expect(getOsPartitionIndex(partitions, null)).toBe(1);
  });
});

// =============================================================================
// hexToGrubRgb
// =============================================================================

describe('hexToGrubRgb', () => {
  it('converts #2a4457 to 42,68,87', () => {
    expect(hexToGrubRgb('#2a4457')).toBe('42,68,87');
  });

  it('converts #ff0000 to 255,0,0', () => {
    expect(hexToGrubRgb('#ff0000')).toBe('255,0,0');
  });

  it('converts #000000 to 0,0,0', () => {
    expect(hexToGrubRgb('#000000')).toBe('0,0,0');
  });

  it('returns default for null', () => {
    expect(hexToGrubRgb(null)).toBe('42,68,87');
  });

  it('returns default for invalid format', () => {
    expect(hexToGrubRgb('not-a-hex')).toBe('42,68,87');
  });
});

// =============================================================================
// getOsLabel
// =============================================================================

describe('getOsLabel', () => {
  it('returns label when device matches', () => {
    const partitions = [
      { device: '/dev/sda1', label: 'Windows' },
      { device: '/dev/sda2', label: 'Ubuntu' },
    ];
    expect(getOsLabel(partitions, '/dev/sda2')).toBe('Ubuntu');
  });

  it('returns empty string when no device matches', () => {
    const partitions = [{ device: '/dev/sda1', label: 'Windows' }];
    expect(getOsLabel(partitions, '/dev/sda5')).toBe('');
  });

  it('returns empty string for null partitions', () => {
    expect(getOsLabel(null, '/dev/sda1')).toBe('');
  });

  it('returns empty string for null rootDevice', () => {
    expect(getOsLabel([{ device: '/dev/sda1', label: 'Test' }], null)).toBe('');
  });
});

// =============================================================================
// applyTemplate
// =============================================================================

describe('applyTemplate', () => {
  it('replaces a single @@key@@ placeholder', () => {
    expect(applyTemplate('Hello @@name@@!', { name: 'World' })).toBe('Hello World!');
  });

  it('replaces multiple different keys', () => {
    const template = '@@greeting@@ @@name@@!';
    expect(applyTemplate(template, { greeting: 'Hi', name: 'Alice' })).toBe('Hi Alice!');
  });

  it('replaces null/undefined values with empty string', () => {
    expect(applyTemplate('Value: @@key@@', { key: null })).toBe('Value: ');
    expect(applyTemplate('Value: @@key@@', { key: undefined })).toBe('Value: ');
  });

  it('replaces multiple occurrences of the same key', () => {
    const template = '@@x@@ and @@x@@';
    expect(applyTemplate(template, { x: 'A' })).toBe('A and A');
  });
});

// =============================================================================
// macToGrubFilename
// =============================================================================

describe('macToGrubFilename', () => {
  it('converts MAC to GRUB filename format', () => {
    expect(macToGrubFilename('AA:BB:CC:DD:EE:FF')).toBe('01-aa-bb-cc-dd-ee-ff');
  });
});
