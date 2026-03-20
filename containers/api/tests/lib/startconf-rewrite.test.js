/**
 * Tests for start.conf server= rewrite — scoped to [LINBO] section
 */
const { rewriteServerField } = require('../../src/lib/startconf-rewrite');

describe('rewriteServerField', () => {
  const REAL_START_CONF = `[LINBO]
Server = 10.0.0.1
Group = win11_efi_sata
Cache = /dev/sda4
RootTimeout = 600
AutoPartition = no
AutoFormat = no
AutoInitCache = no
DownloadType = torrent
SystemType = efi64
KernelOptions = quiet splash server=10.0.0.1

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

  it('should rewrite Server= in [LINBO] section', () => {
    const result = rewriteServerField(REAL_START_CONF, '10.0.0.13');
    expect(result).toContain('Server = 10.0.0.13');
    // The old IP must no longer appear as a standalone value
    expect(result).toMatch(/Server = 10\.0\.0\.13\n/);
    expect(result).not.toMatch(/Server = 10\.0\.0\.1\n/);
  });

  it('should rewrite server= in KernelOptions within [LINBO] section', () => {
    const result = rewriteServerField(REAL_START_CONF, '10.0.0.13');
    expect(result).toContain('server=10.0.0.13');
    // Old value must not appear (not just as prefix of 10.0.0.13)
    expect(result).not.toMatch(/server=10\.0\.0\.1[\s\n]/);
  });

  it('should NOT touch fields outside [LINBO] section', () => {
    const result = rewriteServerField(REAL_START_CONF, '10.0.0.13');
    // [Partition], [OS] sections must remain unchanged
    expect(result).toContain('Dev = /dev/sda1');
    expect(result).toContain('Name = Windows 11');
    expect(result).toContain('Boot = /dev/sda3');
  });

  it('should handle server= appearing mid-line in KernelOptions', () => {
    const content = `[LINBO]
Server = 10.0.0.1
KernelOptions = quiet server=10.0.0.1 splash irqpoll`;
    const result = rewriteServerField(content, '10.0.0.13');
    expect(result).toContain('KernelOptions = quiet server=10.0.0.13 splash irqpoll');
  });

  it('should handle multiple server= in KernelOptions', () => {
    const content = `[LINBO]
Server = 10.0.0.1
KernelOptions = quiet server=10.0.0.1 server=10.0.0.2`;
    const result = rewriteServerField(content, '10.0.0.13');
    expect(result).toContain('server=10.0.0.13 server=10.0.0.13');
    expect(result).not.toMatch(/server=10\.0\.0\.1[\s"]/);
    expect(result).not.toMatch(/server=10\.0\.0\.2/);
  });

  it('should be case-insensitive for section headers and keys', () => {
    const content = `[linbo]
server = 10.0.0.1
kerneloptions = server=10.0.0.1 quiet`;
    const result = rewriteServerField(content, '10.0.0.99');
    expect(result).toContain('server = 10.0.0.99');
    expect(result).toContain('server=10.0.0.99 quiet');
  });

  it('should stop rewriting after leaving [LINBO] section', () => {
    const content = `[LINBO]
Server = 10.0.0.1
[OS]
Server = should-not-be-touched`;
    const result = rewriteServerField(content, '10.0.0.13');
    const lines = result.split('\n');
    expect(lines[1]).toBe('Server = 10.0.0.13');
    expect(lines[3]).toBe('Server = should-not-be-touched');
  });

  it('should handle [LINBO] not at the start of the file', () => {
    const content = `# some comment
[Partition]
Dev = /dev/sda1
[LINBO]
Server = 10.0.0.1
[OS]
Name = Test`;
    const result = rewriteServerField(content, '10.0.0.13');
    expect(result).toContain('Server = 10.0.0.13');
    expect(result).toContain('Dev = /dev/sda1');
  });

  it('should return content unchanged if no [LINBO] section', () => {
    const content = `[Partition]
Dev = /dev/sda1
Server = 10.0.0.1`;
    const result = rewriteServerField(content, '10.0.0.13');
    expect(result).toContain('Server = 10.0.0.1');
  });

  it('should return content unchanged for null/empty inputs', () => {
    expect(rewriteServerField(null, '10.0.0.1')).toBeNull();
    expect(rewriteServerField('', '10.0.0.1')).toBe('');
    expect(rewriteServerField('test', '')).toBe('test');
    expect(rewriteServerField('test', null)).toBe('test');
  });

  it('should preserve line endings and whitespace', () => {
    const content = `[LINBO]\n  Server = 10.0.0.1\n  KernelOptions = quiet splash`;
    const result = rewriteServerField(content, '10.0.0.13');
    expect(result).toBe(`[LINBO]\n  Server = 10.0.0.13\n  KernelOptions = quiet splash`);
  });
});
