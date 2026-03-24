/**
 * Tests for O(1) findHostByIp via secondary Redis index (REL-03)
 *
 * Verifies findHostByIp resolves via 2 Redis GET calls
 * (sync:host:ip:{ip} then sync:host:{mac}) instead of O(n) smembers + loop.
 */

// Set env before importing modules (internal.js requires INTERNAL_API_KEY)
if (!process.env.INTERNAL_API_KEY) process.env.INTERNAL_API_KEY = 'test-internal-key';

// Mock websocket
jest.mock('../../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
  getServer: jest.fn(),
}));

// Mock redis with a Map-based store
const store = new Map();
const sets = new Map();
const mockClient = {
  get: jest.fn(async (key) => store.get(key) || null),
  set: jest.fn(async (key, val) => { store.set(key, val); }),
  del: jest.fn(async (key) => { store.delete(key); }),
  sadd: jest.fn(async (key, ...members) => {
    if (!sets.has(key)) sets.set(key, new Set());
    for (const m of members.flat()) sets.get(key).add(m);
  }),
  srem: jest.fn(async (key, ...members) => {
    const s = sets.get(key);
    if (s) for (const m of members.flat()) s.delete(m);
  }),
  smembers: jest.fn(async (key) => [...(sets.get(key) || [])]),
  hset: jest.fn().mockResolvedValue('OK'),
  expire: jest.fn().mockResolvedValue(1),
  _store: store,
  _sets: sets,
  _reset: () => { store.clear(); sets.clear(); },
};

jest.mock('../../../src/lib/redis', () => ({
  getClient: () => mockClient,
}));

const router = require('../../../src/routes/internal');
const { findHostByIp } = router._testExports;

// =============================================================================
// Tests
// =============================================================================

describe('findHostByIp O(1) via secondary index (REL-03)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    sets.clear();
  });

  test('returns parsed host when IP index and host key both exist (exactly 2 GET calls)', async () => {
    const host = {
      mac: 'AA:BB:CC:DD:EE:FF',
      hostname: 'r100-pc01',
      ip: '10.0.0.50',
      hostgroup: 'win11',
    };

    // Pre-populate Redis store with secondary index and host data
    store.set('sync:host:ip:10.0.0.50', 'AA:BB:CC:DD:EE:FF');
    store.set('sync:host:AA:BB:CC:DD:EE:FF', JSON.stringify(host));

    const result = await findHostByIp('10.0.0.50');

    expect(result).toEqual(host);
    // Exactly 2 GET calls: IP index lookup + host data lookup
    expect(mockClient.get).toHaveBeenCalledTimes(2);
    expect(mockClient.get).toHaveBeenCalledWith('sync:host:ip:10.0.0.50');
    expect(mockClient.get).toHaveBeenCalledWith('sync:host:AA:BB:CC:DD:EE:FF');
  });

  test('returns null when no IP index key exists (exactly 1 GET call)', async () => {
    // No entries in store — IP not found
    const result = await findHostByIp('10.0.0.99');

    expect(result).toBeNull();
    // Exactly 1 GET call: IP index lookup returns null, no second call needed
    expect(mockClient.get).toHaveBeenCalledTimes(1);
    expect(mockClient.get).toHaveBeenCalledWith('sync:host:ip:10.0.0.99');
  });

  test('returns null when IP key exists but host key is missing (exactly 2 GET calls)', async () => {
    // IP index exists but the host data was deleted (stale index)
    store.set('sync:host:ip:10.0.0.50', 'AA:BB:CC:DD:EE:FF');
    // No host data for this MAC

    const result = await findHostByIp('10.0.0.50');

    expect(result).toBeNull();
    // 2 GET calls: IP index found MAC, but host data not found
    expect(mockClient.get).toHaveBeenCalledTimes(2);
  });

  test('returns null and logs once when Redis throws an error', async () => {
    // Override get to throw
    const originalGet = mockClient.get;
    mockClient.get = jest.fn().mockRejectedValue(new Error('Redis connection lost'));

    const consoleSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});

    const result = await findHostByIp('10.0.0.50');

    expect(result).toBeNull();
    // Should have logged the error
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Internal] Redis host lookup failed:'),
      expect.stringContaining('Redis connection lost'),
    );

    consoleSpy.mockRestore();
    mockClient.get = originalGet;
  });

  test('does NOT call smembers (no O(n) scan)', async () => {
    // Even with data in the host index set, smembers should never be called
    sets.set('sync:host:index', new Set(['AA:BB:CC:DD:EE:FF', 'BB:CC:DD:EE:FF:00']));
    store.set('sync:host:ip:10.0.0.50', 'AA:BB:CC:DD:EE:FF');
    store.set('sync:host:AA:BB:CC:DD:EE:FF', JSON.stringify({
      mac: 'AA:BB:CC:DD:EE:FF', hostname: 'pc01', ip: '10.0.0.50',
    }));

    await findHostByIp('10.0.0.50');

    expect(mockClient.smembers).not.toHaveBeenCalled();
  });
});
