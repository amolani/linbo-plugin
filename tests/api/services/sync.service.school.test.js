/**
 * Tests for Sync Service — hostsChanged "all" branch (CACHE-01)
 *
 * Verifies that when the LMN Authority API returns hostsChanged: ['all'],
 * syncOnce() makes a second getChanges() call with ('', school) to fetch
 * the full host list — not just ('') without the school parameter.
 */
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

// Setup temp dir and env before module load
const tmpDir = `${os.tmpdir()}/linbo-sync-school-test-${process.pid}`;
process.env.LINBO_DIR = tmpDir;
process.env.LINBO_SERVER_IP = '10.40.0.10';

// Mock dependencies (same pattern as sync.service.test.js)
jest.mock('../../../src/lib/redis', () => {
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

jest.mock('../../../src/lib/lmn-api-client', () => ({
  getChanges: jest.fn(),
  batchGetHosts: jest.fn(),
  batchGetStartConfs: jest.fn(),
  batchGetConfigs: jest.fn(),
  getIscDhcpConfig: jest.fn(),
  getGrubConfigs: jest.fn(),
  checkHealth: jest.fn(),
}));

jest.mock('../../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
  getServer: jest.fn(),
}));

jest.mock('../../../src/services/grub-generator', () => ({
  regenerateAll: jest.fn(async () => ({ configs: 0, hosts: 0, hostcfgMac: 0 })),
}));

jest.mock('../../../src/services/grub-sync', () => ({
  writeGrubConfigs: jest.fn(async () => {}),
  writeHostcfgSymlinks: jest.fn(async () => {}),
}));

const redis = require('../../../src/lib/redis');
const lmnClient = require('../../../src/lib/lmn-api-client');
const settingsService = require('../../../src/services/settings.service');
const { syncOnce } = require('../../../src/services/sync.service');

beforeAll(async () => {
  await fsp.mkdir(tmpDir, { recursive: true });
});

afterAll(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  jest.clearAllMocks();
  redis.getClient()._reset();
  settingsService.invalidateCache();
  // Seed Redis with school setting so settingsService.get('lmn_school') resolves
  redis.getClient()._store.set('config:lmn_school', 'gymnasium-sued');
  redis.getClient()._store.set('config:linbo_server_ip', '10.40.0.10');
  // Clean up tmpDir files
  try {
    const files = await fsp.readdir(tmpDir);
    for (const f of files) await fsp.rm(path.join(tmpDir, f), { recursive: true, force: true });
  } catch {}
});

// =============================================================================
// Tests: hostsChanged "all" branch — CACHE-01
// =============================================================================

describe('syncOnce -- hostsChanged "all" branch (CACHE-01)', () => {
  // Common delta returned by first getChanges call when server signals "all hosts changed"
  const DELTA_WITH_ALL = {
    nextCursor: 'cursor-after-all',
    hostsChanged: ['all'],
    startConfsChanged: [],
    configsChanged: [],
    deletedStartConfs: [],
    deletedHosts: [],
    dhcpChanged: false,
  };

  // Second getChanges call returns actual MAC addresses
  const FULL_SNAPSHOT_DELTA = {
    nextCursor: 'cursor-after-all',
    hostsChanged: ['AA:BB:CC:DD:EE:FF', '11:22:33:44:55:66'],
    startConfsChanged: [],
    configsChanged: [],
    deletedStartConfs: [],
    deletedHosts: [],
    dhcpChanged: false,
  };

  const HOSTS = [
    {
      mac: 'AA:BB:CC:DD:EE:FF',
      hostname: 'r200-pc01',
      ip: '10.0.200.1',
      hostgroup: 'ubuntu_efi',
    },
    {
      mac: '11:22:33:44:55:66',
      hostname: 'r200-pc02',
      ip: '10.0.200.2',
      hostgroup: 'ubuntu_efi',
    },
  ];

  it('passes school to second getChanges call when hostsChanged contains "all"', async () => {
    lmnClient.getChanges
      .mockResolvedValueOnce(DELTA_WITH_ALL)       // 1st call: returns "all"
      .mockResolvedValueOnce(FULL_SNAPSHOT_DELTA);  // 2nd call: full snapshot
    lmnClient.batchGetHosts.mockResolvedValue({ hosts: HOSTS });
    lmnClient.getGrubConfigs.mockResolvedValue({ configs: [], total: 0 });

    await syncOnce();

    // Must have called getChanges exactly twice
    expect(lmnClient.getChanges).toHaveBeenCalledTimes(2);
    // First call: with cursor '' (full sync) and school
    expect(lmnClient.getChanges).toHaveBeenNthCalledWith(1, '', 'gymnasium-sued');
    // Second call: '' (empty cursor for full snapshot) + school
    expect(lmnClient.getChanges).toHaveBeenNthCalledWith(2, '', 'gymnasium-sued');
  });

  it('uses school from settingsService.get("lmn_school")', async () => {
    // Override school to a different value
    redis.getClient()._store.set('config:lmn_school', 'realschule-nord');
    settingsService.invalidateCache();

    lmnClient.getChanges
      .mockResolvedValueOnce(DELTA_WITH_ALL)
      .mockResolvedValueOnce(FULL_SNAPSHOT_DELTA);
    lmnClient.batchGetHosts.mockResolvedValue({ hosts: HOSTS });
    lmnClient.getGrubConfigs.mockResolvedValue({ configs: [], total: 0 });

    await syncOnce();

    // Second getChanges call uses the updated school name
    expect(lmnClient.getChanges).toHaveBeenNthCalledWith(2, '', 'realschule-nord');
  });

  it('processes hosts returned from the second getChanges call', async () => {
    lmnClient.getChanges
      .mockResolvedValueOnce(DELTA_WITH_ALL)
      .mockResolvedValueOnce(FULL_SNAPSHOT_DELTA);
    lmnClient.batchGetHosts.mockResolvedValue({ hosts: HOSTS });
    lmnClient.getGrubConfigs.mockResolvedValue({ configs: [], total: 0 });

    const result = await syncOnce();

    // batchGetHosts should be called with the MACs from the second getChanges response + school
    expect(lmnClient.batchGetHosts).toHaveBeenCalledWith(
      ['AA:BB:CC:DD:EE:FF', '11:22:33:44:55:66'],
      'gymnasium-sued',
    );
    // Both hosts should have been processed during sync (stats counter)
    expect(result.stats.hosts).toBe(2);

    // Verify batchGetHosts was called exactly once (not skipped)
    expect(lmnClient.batchGetHosts).toHaveBeenCalledTimes(1);
  });
});
