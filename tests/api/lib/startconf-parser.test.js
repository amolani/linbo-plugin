'use strict';

/**
 * Tests for startconf-parser — converts INI text into { linbo, partitions, os } object
 */
const { parseStartConf } = require('../../../src/lib/startconf-parser');

describe('parseStartConf', () => {
  it('should return { linbo: {}, partitions: [], os: [] } for empty string', () => {
    const result = parseStartConf('');
    expect(result).toEqual({ linbo: {}, partitions: [], os: [] });
  });

  it('should parse [LINBO] section with lowercased keys', () => {
    const result = parseStartConf('[LINBO]\nServer = 10.0.0.13\nGroup = win11\n');
    expect(result.linbo).toEqual({ server: '10.0.0.13', group: 'win11' });
    expect(result.partitions).toEqual([]);
    expect(result.os).toEqual([]);
  });

  it('should parse multiple [Partition] blocks into separate objects', () => {
    const content = [
      '[Partition]',
      'Dev = /dev/sda1',
      'Size = 200M',
      '[Partition]',
      'Dev = /dev/sda2',
      'Size = 50G',
    ].join('\n');
    const result = parseStartConf(content);
    expect(result.partitions).toHaveLength(2);
    expect(result.partitions[0]).toEqual({ dev: '/dev/sda1', size: '200M' });
    expect(result.partitions[1]).toEqual({ dev: '/dev/sda2', size: '50G' });
  });

  it('should parse multiple [OS] blocks into separate objects', () => {
    const content = [
      '[OS]',
      'Name = Windows 11',
      'Version = 24H2',
      '[OS]',
      'Name = Ubuntu',
      'Version = 22.04',
    ].join('\n');
    const result = parseStartConf(content);
    expect(result.os).toHaveLength(2);
    expect(result.os[0]).toEqual({ name: 'Windows 11', version: '24H2' });
    expect(result.os[1]).toEqual({ name: 'Ubuntu', version: '22.04' });
  });

  it('should skip comment lines (# ...)', () => {
    const content = [
      '# This is a comment',
      '[LINBO]',
      '# Another comment',
      'Server = 10.0.0.13',
    ].join('\n');
    const result = parseStartConf(content);
    expect(result.linbo).toEqual({ server: '10.0.0.13' });
  });

  it('should handle key=value with no spaces around =', () => {
    const content = '[LINBO]\nServer=10.0.0.13\nGroup=win11\n';
    const result = parseStartConf(content);
    expect(result.linbo).toEqual({ server: '10.0.0.13', group: 'win11' });
  });

  it('should handle case-insensitive section headers', () => {
    const content = '[linbo]\nServer = 10.0.0.13\n[partition]\nDev = /dev/sda1\n[os]\nName = Win\n';
    const result = parseStartConf(content);
    expect(result.linbo.server).toBe('10.0.0.13');
    expect(result.partitions).toHaveLength(1);
    expect(result.os).toHaveLength(1);
  });

  it('should skip empty lines', () => {
    const content = '\n\n[LINBO]\n\nServer = 10.0.0.13\n\n';
    const result = parseStartConf(content);
    expect(result.linbo).toEqual({ server: '10.0.0.13' });
  });

  it('should handle a full realistic start.conf', () => {
    const content = `[LINBO]
Server = 10.0.0.13
Group = win11_efi_sata
Cache = /dev/sda4
RootTimeout = 600
AutoPartition = no
AutoFormat = no
AutoInitCache = no
DownloadType = torrent
SystemType = efi64
KernelOptions = quiet splash server=10.0.0.13

[Partition]
Dev = /dev/sda1
Label = efi
Size = 200M
Id = ef
FSType = vfat
Bootable = yes

[Partition]
Dev = /dev/sda4
Label = cache
Size =
Id = 8300
FSType = ext4
Bootable = no

[OS]
Name = Windows 11
Version = 24H2
Description = Windows 11 for classroom
IconName = win10.svg
BaseImage = win11.qcow2
Boot = /dev/sda3
Root = /dev/sda3
Kernel = auto
Initrd =
Append =
StartEnabled = yes
SyncEnabled = yes
NewEnabled = yes
Autostart = no
DefaultAction = sync
Hidden = no`;

    const result = parseStartConf(content);
    expect(result.linbo.server).toBe('10.0.0.13');
    expect(result.linbo.group).toBe('win11_efi_sata');
    expect(result.linbo.systemtype).toBe('efi64');
    expect(result.linbo.kerneloptions).toBe('quiet splash server=10.0.0.13');
    expect(result.partitions).toHaveLength(2);
    expect(result.partitions[0].dev).toBe('/dev/sda1');
    expect(result.partitions[0].fstype).toBe('vfat');
    expect(result.partitions[1].dev).toBe('/dev/sda4');
    expect(result.os).toHaveLength(1);
    expect(result.os[0].name).toBe('Windows 11');
    expect(result.os[0].baseimage).toBe('win11.qcow2');
    expect(result.os[0].defaultaction).toBe('sync');
  });

  it('should handle value with = sign in it', () => {
    const content = '[LINBO]\nKernelOptions = quiet splash key=val\n';
    const result = parseStartConf(content);
    expect(result.linbo.kerneloptions).toBe('quiet splash key=val');
  });
});
