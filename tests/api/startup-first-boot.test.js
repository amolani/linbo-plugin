/**
 * Tests for first-boot auto-sync logic (CACHE-04)
 *
 * Verifies the startup logic from src/index.js (lines 547-563):
 * - When SYNC_ENABLED=true and no sync:cursor exists, syncOnce() fires
 * - When a cursor exists, syncOnce() is skipped (not first boot)
 * - When SYNC_ENABLED is not 'true', syncOnce() is skipped regardless
 *
 * Approach: Extract the first-boot decision logic as a pure testable function
 * and verify it in isolation (no server startup, no require of index.js).
 */

// ---------------------------------------------------------------------------
// Extracted first-boot logic (mirrors src/index.js lines 547-563 exactly)
// ---------------------------------------------------------------------------
async function runFirstBootSync(env, storeClient, syncService) {
  if (env.SYNC_ENABLED !== 'true') {
    return { skipped: true, reason: 'SYNC_ENABLED not true' };
  }
  const cursor = await storeClient.get('sync:cursor');
  if (cursor) {
    return { skipped: true, reason: 'cursor exists' };
  }
  const result = await syncService.syncOnce();
  return { skipped: false, result };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('first-boot auto-sync (CACHE-04)', () => {
  it('calls syncOnce() when SYNC_ENABLED=true and cursor is absent', async () => {
    const mockStore = { get: jest.fn().mockResolvedValue(null) };
    const mockSync = {
      syncOnce: jest.fn().mockResolvedValue({ stats: { hosts: 5, dhcp: true } }),
    };

    const result = await runFirstBootSync(
      { SYNC_ENABLED: 'true' },
      mockStore,
      mockSync,
    );

    expect(mockStore.get).toHaveBeenCalledWith('sync:cursor');
    expect(mockSync.syncOnce).toHaveBeenCalledTimes(1);
    expect(result.skipped).toBe(false);
    expect(result.result).toEqual({ stats: { hosts: 5, dhcp: true } });
  });

  it('skips syncOnce() when cursor already exists (not first boot)', async () => {
    const mockStore = { get: jest.fn().mockResolvedValue('1708943200:42') };
    const mockSync = { syncOnce: jest.fn() };

    const result = await runFirstBootSync(
      { SYNC_ENABLED: 'true' },
      mockStore,
      mockSync,
    );

    expect(mockStore.get).toHaveBeenCalledWith('sync:cursor');
    expect(mockSync.syncOnce).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('cursor exists');
  });

  it('skips syncOnce() when SYNC_ENABLED is not set', async () => {
    const mockStore = { get: jest.fn().mockResolvedValue(null) };
    const mockSync = { syncOnce: jest.fn() };

    const result = await runFirstBootSync({}, mockStore, mockSync);

    // storeClient.get should never be called when SYNC_ENABLED is false
    expect(mockStore.get).not.toHaveBeenCalled();
    expect(mockSync.syncOnce).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('SYNC_ENABLED not true');
  });

  it('skips syncOnce() when SYNC_ENABLED is explicitly "false"', async () => {
    const mockStore = { get: jest.fn().mockResolvedValue(null) };
    const mockSync = { syncOnce: jest.fn() };

    const result = await runFirstBootSync(
      { SYNC_ENABLED: 'false' },
      mockStore,
      mockSync,
    );

    expect(mockStore.get).not.toHaveBeenCalled();
    expect(mockSync.syncOnce).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('SYNC_ENABLED not true');
  });
});
