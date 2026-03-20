/**
 * Tests for Sync Service
 */
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

// Setup temp dir and env before module load
const tmpDir = `${os.tmpdir()}/linbo-sync-test-${process.pid}`;
process.env.LINBO_DIR = tmpDir;
process.env.LINBO_SERVER_IP = '10.0.0.13';

// Mock dependencies
jest.mock('../../src/lib/redis', () => {
  const store = new Map();
  const sets = new Map();
  const mockClient = {
    get: jest.fn(async (key) => store.get(key) || null),
    set: jest.fn(async (key, val) => { store.set(key, val); }),
    del: jest.fn(async (key) => { store.delete(key); }),
    mget: jest.fn(async (...keys) => {
      const flat = keys.flat();
      return flat.map(k => store.get(k) || null);
    }),
    sadd: jest.fn(async (key, ...members) => {
      if (!sets.has(key)) sets.set(key, new Set());
      for (const m of members.flat()) sets.get(key).add(m);
    }),
    srem: jest.fn(async (key, ...members) => {
      const s = sets.get(key);
      if (s) for (const m of members.flat()) s.delete(m);
    }),
    smembers: jest.fn(async (key) => [...(sets.get(key) || [])]),
    sismember: jest.fn(async (key, member) => (sets.get(key) || new Set()).has(member) ? 1 : 0),
    scard: jest.fn(async (key) => (sets.get(key) || new Set()).size),
    pipeline: jest.fn(() => {
      const ops = [];
      const p = {
        get: (key) => { ops.push(['get', key]); return p; },
        exec: async () => ops.map(([, key]) => [null, store.get(key) || null]),
      };
      return p;
    }),
    _store: store,
    _sets: sets,
    _reset: () => { store.clear(); sets.clear(); },
  };
  return {
    getClient: () => mockClient,
    disconnect: jest.fn(),
  };
});

jest.mock('../../src/lib/lmn-api-client', () => ({
  getChanges: jest.fn(),
  batchGetHosts: jest.fn(),
  batchGetStartConfs: jest.fn(),
  batchGetConfigs: jest.fn(),
  getDhcpExport: jest.fn(),
  getIscDhcpConfig: jest.fn(),
  getGrubConfigs: jest.fn(),
  checkHealth: jest.fn(),
}));

jest.mock('../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
  getServer: jest.fn(),
}));

jest.mock('../../src/services/grub-generator', () => ({
  regenerateAll: jest.fn(async () => ({ configs: 1, hosts: 2, hostcfgMac: 2 })),
}));

jest.mock('../../src/services/grub-sync', () => ({
  writeGrubConfigs: jest.fn(async () => {}),
  writeHostcfgSymlinks: jest.fn(async () => {}),
}));

const redis = require('../../src/lib/redis');
const lmnClient = require('../../src/lib/lmn-api-client');
const grubGenerator = require('../../src/services/grub-generator');
const grubSync = require('../../src/services/grub-sync');
const settingsService = require('../../src/services/settings.service');
const { syncOnce, getSyncStatus, resetSync, KEY } = require('../../src/services/sync.service');

beforeAll(async () => {
  await fsp.mkdir(tmpDir, { recursive: true });
});

afterAll(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  jest.clearAllMocks();
  redis.getClient()._reset();
  // Invalidate settings in-memory cache to prevent stale values across tests
  settingsService.invalidateCache();
  // Clean up tmpDir files
  try {
    const files = await fsp.readdir(tmpDir);
    for (const f of files) await fsp.rm(path.join(tmpDir, f), { recursive: true, force: true });
  } catch {}
});

// =============================================================================
// Tests
// =============================================================================

describe('syncOnce — full sync (empty cursor)', () => {
  const DELTA = {
    nextCursor: '1708943200:42',
    hostsChanged: ['AA:BB:CC:DD:EE:01'],
    startConfsChanged: ['win11_efi_sata'],
    configsChanged: ['win11_efi_sata'],
    dhcpChanged: true,
    deletedHosts: [],
    deletedStartConfs: [],
  };

  const HOST = {
    mac: 'AA:BB:CC:DD:EE:01',
    hostname: 'r100-pc01',
    ip: '10.0.100.1',
    hostgroup: 'win11_efi_sata',
    pxeEnabled: true,
    pxeFlag: 1,
    startConfId: 'win11_efi_sata',
  };

  const START_CONF_CONTENT = `[LINBO]
Server = 10.0.0.1
Group = win11_efi_sata
KernelOptions = quiet splash server=10.0.0.1

[OS]
Name = Windows 11`;

  const CONFIG = {
    id: 'win11_efi_sata',
    name: 'Windows 11 EFI SATA',
    osEntries: [{ name: 'Windows 11', root: '/dev/sda3' }],
    partitions: [{ device: '/dev/sda3', label: 'windows' }],
    grubPolicy: { timeout: 5 },
  };

  beforeEach(() => {
    lmnClient.getChanges.mockResolvedValue(DELTA);
    lmnClient.batchGetHosts.mockResolvedValue({ hosts: [HOST] });
    lmnClient.batchGetStartConfs.mockResolvedValue({
      startConfs: [{ id: 'win11_efi_sata', content: START_CONF_CONTENT, hash: 'abc' }],
    });
    lmnClient.batchGetConfigs.mockResolvedValue({ configs: [CONFIG] });
    lmnClient.getIscDhcpConfig.mockResolvedValue({
      school: 'default-school',
      subnets: '# subnets config',
      devices: '# devices config',
      subnetsUpdatedAt: '2026-03-17T12:00:00Z',
      devicesUpdatedAt: '2026-03-17T12:00:00Z',
    });
    lmnClient.getGrubConfigs.mockResolvedValue({ configs: [], school: 'default-school', total: 0 });
  });

  it('should call getChanges with empty cursor and school parameter', async () => {
    await syncOnce();
    expect(lmnClient.getChanges).toHaveBeenCalledWith('', 'default-school');
  });

  it('should write start.conf with server= rewrite', async () => {
    await syncOnce();
    const content = await fsp.readFile(path.join(tmpDir, 'start.conf.win11_efi_sata'), 'utf8');
    expect(content).toContain('Server = 10.0.0.13');
    expect(content).toContain('server=10.0.0.13');
    expect(content).not.toMatch(/Server = 10\.0\.0\.1\n/);
  });

  it('should write MD5 file alongside start.conf', async () => {
    await syncOnce();
    const md5 = await fsp.readFile(path.join(tmpDir, 'start.conf.win11_efi_sata.md5'), 'utf8');
    expect(md5).toMatch(/^[0-9a-f]{32}$/);
  });

  it('should create IP-based symlink', async () => {
    await syncOnce();
    const target = await fsp.readlink(path.join(tmpDir, 'start.conf-10.0.100.1'));
    expect(target).toBe('start.conf.win11_efi_sata');
  });

  it('should create MAC-based symlink (lowercase)', async () => {
    await syncOnce();
    const target = await fsp.readlink(path.join(tmpDir, 'start.conf-aa:bb:cc:dd:ee:01'));
    expect(target).toBe('start.conf.win11_efi_sata');
  });

  it('should cache host in Redis', async () => {
    await syncOnce();
    const client = redis.getClient();
    const hostJson = client._store.get('sync:host:AA:BB:CC:DD:EE:01');
    expect(JSON.parse(hostJson).hostname).toBe('r100-pc01');
  });

  it('should cache config in Redis', async () => {
    await syncOnce();
    const client = redis.getClient();
    const configJson = client._store.get('sync:config:win11_efi_sata');
    expect(JSON.parse(configJson).name).toBe('Windows 11 EFI SATA');
  });

  it('should save cursor after success', async () => {
    await syncOnce();
    const client = redis.getClient();
    expect(client._store.get('sync:cursor')).toBe('1708943200:42');
  });

  it('should sync GRUB configs from Authority API with school parameter', async () => {
    await syncOnce();
    expect(lmnClient.getGrubConfigs).toHaveBeenCalledWith('default-school');
    expect(grubSync.writeGrubConfigs).toHaveBeenCalledTimes(1);
    expect(grubSync.writeHostcfgSymlinks).toHaveBeenCalledTimes(1);
  });

  it('should write ISC DHCP subnets.conf', async () => {
    await syncOnce();
    const content = await fsp.readFile(path.join(tmpDir, 'dhcp/subnets.conf'), 'utf8');
    expect(content).toBe('# subnets config');
  });

  it('should write ISC DHCP devices/{school}.conf', async () => {
    await syncOnce();
    const content = await fsp.readFile(path.join(tmpDir, 'dhcp/devices/default-school.conf'), 'utf8');
    expect(content).toBe('# devices config');
  });

  it('should call getIscDhcpConfig with school parameter', async () => {
    await syncOnce();
    expect(lmnClient.getIscDhcpConfig).toHaveBeenCalledWith('default-school');
  });
});

describe('syncOnce — incremental sync', () => {
  it('should pass existing cursor to getChanges', async () => {
    const client = redis.getClient();
    client._store.set('sync:cursor', '1708943200:42');

    lmnClient.getChanges.mockResolvedValue({
      nextCursor: '1708943260:43',
      hostsChanged: [],
      startConfsChanged: [],
      configsChanged: [],
      dhcpChanged: false,
      deletedHosts: [],
      deletedStartConfs: [],
    });

    await syncOnce();
    expect(lmnClient.getChanges).toHaveBeenCalledWith('1708943200:42', 'default-school');
    expect(client._store.get('sync:cursor')).toBe('1708943260:43');
  });

  it('should not sync GRUB on no changes', async () => {
    const client = redis.getClient();
    client._store.set('sync:cursor', '1708943200:42');

    lmnClient.getChanges.mockResolvedValue({
      nextCursor: '1708943260:43',
      hostsChanged: [],
      startConfsChanged: [],
      configsChanged: [],
      dhcpChanged: false,
      deletedHosts: [],
      deletedStartConfs: [],
    });

    await syncOnce();
    expect(lmnClient.getGrubConfigs).not.toHaveBeenCalled();
    expect(grubSync.writeGrubConfigs).not.toHaveBeenCalled();
  });
});

describe('syncOnce — deletions', () => {
  it('should remove start.conf for deleted configs', async () => {
    // Pre-create a start.conf
    await fsp.writeFile(path.join(tmpDir, 'start.conf.old_config'), 'old content');
    await fsp.writeFile(path.join(tmpDir, 'start.conf.old_config.md5'), 'abc');

    const client = redis.getClient();
    client._store.set('sync:cursor', '100:1');

    lmnClient.getChanges.mockResolvedValue({
      nextCursor: '100:2',
      hostsChanged: [],
      startConfsChanged: [],
      configsChanged: [],
      dhcpChanged: false,
      deletedHosts: [],
      deletedStartConfs: ['old_config'],
    });

    await syncOnce();

    await expect(fsp.stat(path.join(tmpDir, 'start.conf.old_config'))).rejects.toThrow();
    await expect(fsp.stat(path.join(tmpDir, 'start.conf.old_config.md5'))).rejects.toThrow();
  });

  it('should remove symlinks for deleted hosts', async () => {
    const client = redis.getClient();
    client._store.set('sync:cursor', '100:1');
    // Pre-cache host
    client._store.set('sync:host:AA:BB:CC:DD:EE:99', JSON.stringify({
      mac: 'AA:BB:CC:DD:EE:99', hostname: 'deleted-pc', ip: '10.0.0.99', hostgroup: 'test',
    }));
    client._sets.set('sync:host:index', new Set(['AA:BB:CC:DD:EE:99']));

    // Pre-create symlinks
    await fsp.symlink('start.conf.test', path.join(tmpDir, 'start.conf-10.0.0.99'));
    await fsp.symlink('start.conf.test', path.join(tmpDir, 'start.conf-aa:bb:cc:dd:ee:99'));

    lmnClient.getChanges.mockResolvedValue({
      nextCursor: '100:2',
      hostsChanged: [],
      startConfsChanged: [],
      configsChanged: [],
      dhcpChanged: false,
      deletedHosts: ['AA:BB:CC:DD:EE:99'],
      deletedStartConfs: [],
    });

    await syncOnce();

    await expect(fsp.lstat(path.join(tmpDir, 'start.conf-10.0.0.99'))).rejects.toThrow();
    await expect(fsp.lstat(path.join(tmpDir, 'start.conf-aa:bb:cc:dd:ee:99'))).rejects.toThrow();
    expect(client._store.has('sync:host:AA:BB:CC:DD:EE:99')).toBe(false);
  });
});

describe('syncOnce — error handling', () => {
  it('should not update cursor on failure', async () => {
    const client = redis.getClient();
    client._store.set('sync:cursor', '100:1');

    lmnClient.getChanges.mockRejectedValue(new Error('API down'));

    await expect(syncOnce()).rejects.toThrow('API down');

    // Cursor should NOT have changed
    expect(client._store.get('sync:cursor')).toBe('100:1');
    // Error should be recorded
    expect(client._store.get('sync:lastError')).toBe('API down');
    // Running flag should be cleared
    expect(client._store.get('sync:isRunning')).toBe('false');
  });

  it('should prevent concurrent syncs', async () => {
    const client = redis.getClient();
    client._store.set('sync:isRunning', 'true');

    await expect(syncOnce()).rejects.toThrow('Sync already in progress');
  });
});

describe('getSyncStatus', () => {
  it('should return current status', async () => {
    const client = redis.getClient();
    client._store.set('sync:cursor', '100:1');
    client._store.set('sync:lastSyncAt', '2026-02-27T08:00:00Z');
    client._store.set('sync:isRunning', 'false');
    client._sets.set('sync:host:index', new Set(['mac1', 'mac2']));
    client._sets.set('sync:config:index', new Set(['cfg1']));

    lmnClient.checkHealth.mockResolvedValue({ healthy: true });

    const status = await getSyncStatus();
    expect(status.cursor).toBe('100:1');
    expect(status.lastSyncAt).toBe('2026-02-27T08:00:00Z');
    expect(status.isRunning).toBe(false);
    expect(status.hosts).toBe(2);
    expect(status.configs).toBe(1);
    expect(status.lmnApiHealthy).toBe(true);
  });
});

describe('resetSync', () => {
  it('should clear cursor', async () => {
    const client = redis.getClient();
    client._store.set('sync:cursor', '100:1');

    await resetSync();
    expect(client._store.has('sync:cursor')).toBe(false);
  });
});

// =============================================================================
// TEST-03: Additional integration tests
// =============================================================================

describe('syncOnce — 5000+ hosts scale test', () => {
  function hex(n) { return n.toString(16).padStart(2, '0').toUpperCase(); }

  function generateMockHosts(count) {
    const hosts = [];
    for (let i = 0; i < count; i++) {
      const b3 = Math.floor(i / 65536) & 0xFF;
      const b4 = Math.floor(i / 256) & 0xFF;
      const b5 = i & 0xFF;
      const mac = `AA:BB:CC:${hex(b3)}:${hex(b4)}:${hex(b5)}`;
      hosts.push({
        mac,
        hostname: `pc-${i}`,
        ip: `10.${b3}.${b4}.${b5 || 1}`,
        hostgroup: 'win11_efi_sata',
        pxeEnabled: true,
        pxeFlag: 1,
        startConfId: 'win11_efi_sata',
      });
    }
    return hosts;
  }

  it('should handle 5001 hosts without error', async () => {
    const HOST_COUNT = 5001;
    const mockHosts = generateMockHosts(HOST_COUNT);
    const mockMacs = mockHosts.map(h => h.mac);

    const START_CONF_CONTENT = `[LINBO]
Server = 10.0.0.1
Group = win11_efi_sata`;

    const CONFIG = {
      id: 'win11_efi_sata',
      name: 'Windows 11 EFI SATA',
      osEntries: [{ name: 'Windows 11', root: '/dev/sda3' }],
      partitions: [{ device: '/dev/sda3', label: 'windows' }],
      grubPolicy: { timeout: 5 },
    };

    lmnClient.getChanges.mockResolvedValue({
      nextCursor: '1710000000:1',
      hostsChanged: mockMacs,
      startConfsChanged: ['win11_efi_sata'],
      configsChanged: ['win11_efi_sata'],
      dhcpChanged: false,
      deletedHosts: [],
      deletedStartConfs: [],
    });

    lmnClient.batchGetHosts.mockResolvedValue({ hosts: mockHosts });
    lmnClient.batchGetStartConfs.mockResolvedValue({
      startConfs: [{ id: 'win11_efi_sata', content: START_CONF_CONTENT, hash: 'abc' }],
    });
    lmnClient.batchGetConfigs.mockResolvedValue({ configs: [CONFIG] });
    lmnClient.getGrubConfigs.mockResolvedValue({ configs: [], school: 'default-school', total: 0 });

    const startTime = Date.now();
    const result = await syncOnce();
    const duration = Date.now() - startTime;

    expect(result.success).toBe(true);
    expect(result.stats.hosts).toBe(HOST_COUNT);

    // Verify all hosts cached in Redis
    const client = redis.getClient();
    const cachedMacs = [...(client._sets.get('sync:host:index') || [])];
    expect(cachedMacs).toHaveLength(HOST_COUNT);

    // Verify IP symlinks created (spot-check)
    const symlinkExists = await fsp.lstat(path.join(tmpDir, 'start.conf-10.0.0.1'))
      .then(() => true).catch(() => false);
    expect(symlinkExists).toBe(true);

    // Performance: should complete in under 5 seconds (mocked I/O)
    expect(duration).toBeLessThan(5000);
  }, 10000); // 10s jest timeout
});

describe('syncOnce — school parameter passthrough', () => {
  it('should pass school parameter to all API calls', async () => {
    const client = redis.getClient();
    // Set school via Redis (settings.service reads config:lmn_school)
    client._store.set('config:lmn_school', 'gymnasium-sued');

    const DELTA = {
      nextCursor: '1710000100:1',
      hostsChanged: ['AA:BB:CC:DD:EE:01'],
      startConfsChanged: ['win11_efi_sata'],
      configsChanged: ['win11_efi_sata'],
      dhcpChanged: true,
      deletedHosts: [],
      deletedStartConfs: [],
    };

    const HOST = {
      mac: 'AA:BB:CC:DD:EE:01',
      hostname: 'pc01',
      ip: '10.0.100.1',
      hostgroup: 'win11_efi_sata',
    };

    lmnClient.getChanges.mockResolvedValue(DELTA);
    lmnClient.batchGetHosts.mockResolvedValue({ hosts: [HOST] });
    lmnClient.batchGetStartConfs.mockResolvedValue({
      startConfs: [{ id: 'win11_efi_sata', content: '[LINBO]\nServer = 10.0.0.1', hash: 'x' }],
    });
    lmnClient.batchGetConfigs.mockResolvedValue({ configs: [{ id: 'win11_efi_sata' }] });
    lmnClient.getIscDhcpConfig.mockResolvedValue({
      school: 'gymnasium-sued',
      subnets: '# subnet data',
      devices: '# device data',
    });
    lmnClient.getGrubConfigs.mockResolvedValue({ configs: [], school: 'gymnasium-sued', total: 0 });

    await syncOnce();

    // Verify school parameter passed to getChanges
    expect(lmnClient.getChanges).toHaveBeenCalledWith('', 'gymnasium-sued');

    // Verify school parameter passed to getIscDhcpConfig
    expect(lmnClient.getIscDhcpConfig).toHaveBeenCalledWith('gymnasium-sued');

    // Verify school parameter passed to getGrubConfigs
    expect(lmnClient.getGrubConfigs).toHaveBeenCalledWith('gymnasium-sued');

    // Verify DHCP devices file written to dhcp/devices/gymnasium-sued.conf
    const devicesContent = await fsp.readFile(
      path.join(tmpDir, 'dhcp/devices/gymnasium-sued.conf'), 'utf8'
    );
    expect(devicesContent).toBe('# device data');
  });
});

describe('syncOnce — DHCP config write verification', () => {
  const BASE_DELTA = {
    nextCursor: '1710000200:1',
    hostsChanged: ['AA:BB:CC:DD:EE:01'],
    startConfsChanged: ['win11_efi_sata'],
    configsChanged: ['win11_efi_sata'],
    deletedHosts: [],
    deletedStartConfs: [],
  };

  const HOST = {
    mac: 'AA:BB:CC:DD:EE:01',
    hostname: 'pc01',
    ip: '10.0.100.1',
    hostgroup: 'win11_efi_sata',
  };

  beforeEach(() => {
    // Ensure school is set to a known value for this describe block
    const client = redis.getClient();
    client._store.set('config:lmn_school', 'testschool');
    lmnClient.batchGetHosts.mockResolvedValue({ hosts: [HOST] });
    lmnClient.batchGetStartConfs.mockResolvedValue({
      startConfs: [{ id: 'win11_efi_sata', content: '[LINBO]\nServer = 10.0.0.1', hash: 'x' }],
    });
    lmnClient.batchGetConfigs.mockResolvedValue({ configs: [{ id: 'win11_efi_sata' }] });
    lmnClient.getGrubConfigs.mockResolvedValue({ configs: [], total: 0 });
  });

  it('should write DHCP files when dhcpChanged is true', async () => {
    lmnClient.getChanges.mockResolvedValue({ ...BASE_DELTA, dhcpChanged: true });
    lmnClient.getIscDhcpConfig.mockResolvedValue({
      school: 'testschool',
      subnets: '# subnet data',
      devices: '# device data',
      subnetsUpdatedAt: '2026-03-17T12:00:00Z',
      devicesUpdatedAt: '2026-03-17T12:00:00Z',
    });

    const result = await syncOnce();

    // Verify subnets.conf written
    const subnetsContent = await fsp.readFile(path.join(tmpDir, 'dhcp/subnets.conf'), 'utf8');
    expect(subnetsContent).toBe('# subnet data');

    // Verify devices/{school}.conf written
    const devicesContent = await fsp.readFile(
      path.join(tmpDir, 'dhcp/devices/testschool.conf'), 'utf8'
    );
    expect(devicesContent).toBe('# device data');

    // Verify directories created
    const dhcpDevicesStat = await fsp.stat(path.join(tmpDir, 'dhcp/devices'));
    expect(dhcpDevicesStat.isDirectory()).toBe(true);

    expect(result.stats.dhcp).toBe(true);
  });

  it('should NOT write DHCP files when dhcpChanged is false', async () => {
    lmnClient.getChanges.mockResolvedValue({ ...BASE_DELTA, dhcpChanged: false });

    const result = await syncOnce();

    // getIscDhcpConfig should NOT have been called
    expect(lmnClient.getIscDhcpConfig).not.toHaveBeenCalled();

    // No DHCP files should exist
    const exists = await fsp.stat(path.join(tmpDir, 'dhcp/subnets.conf'))
      .then(() => true).catch(() => false);
    expect(exists).toBe(false);

    expect(result.stats.dhcp).toBe(false);
  });

  it('should create dhcp/devices directory recursively', async () => {
    lmnClient.getChanges.mockResolvedValue({ ...BASE_DELTA, dhcpChanged: true });
    lmnClient.getIscDhcpConfig.mockResolvedValue({
      school: 'testschool',
      subnets: '# subnets',
      devices: '# devices',
    });

    await syncOnce();

    // Verify nested directory was created
    const stat = await fsp.stat(path.join(tmpDir, 'dhcp/devices'));
    expect(stat.isDirectory()).toBe(true);
  });
});
