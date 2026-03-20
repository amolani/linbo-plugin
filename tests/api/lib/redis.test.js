/**
 * LINBO Docker - Redis Delegate Tests (Phase 4: store.js backend)
 *
 * Tests that redis.js correctly delegates to store.js.
 * No ioredis mock needed — store.js is the real in-memory backend.
 */

const store = require('../../../src/lib/store');
const redis = require('../../../src/lib/redis');

describe('redis.js delegate to store.js', () => {
  beforeEach(() => {
    store.reset();
  });

  // --- getClient / getSubscriber ---

  describe('getClient / getSubscriber', () => {
    test('getClient() returns store.client', () => {
      expect(redis.getClient()).toBe(store.client);
    });

    test('getSubscriber() returns store.client (same object)', () => {
      expect(redis.getSubscriber()).toBe(store.client);
    });

    test('getClient().status is "ready"', () => {
      expect(redis.getClient().status).toBe('ready');
    });
  });

  // --- disconnect ---

  describe('disconnect', () => {
    test('disconnect() calls store.flushToDisk()', async () => {
      const spy = jest.spyOn(store, 'flushToDisk').mockResolvedValue();
      await redis.disconnect();
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });

  // --- healthCheck ---

  describe('healthCheck', () => {
    test('healthCheck() returns healthy status', async () => {
      const result = await redis.healthCheck();
      expect(result).toEqual({ status: 'healthy', message: 'store ready' });
    });
  });

  // --- get / set / del ---

  describe('get / set / del wrappers', () => {
    test('get() returns null for missing key', async () => {
      const val = await redis.get('nonexistent');
      expect(val).toBeNull();
    });

    test('set() then get() round-trips JSON', async () => {
      await redis.set('test:obj', { name: 'Alice', age: 30 });
      const val = await redis.get('test:obj');
      expect(val).toEqual({ name: 'Alice', age: 30 });
    });

    test('set() with TTL uses setex', async () => {
      await redis.set('test:ttl', 'value', 60);
      const val = await redis.get('test:ttl');
      expect(val).toBe('value');
    });

    test('del() removes the key', async () => {
      await redis.set('test:del', 'bye');
      await redis.del('test:del');
      const val = await redis.get('test:del');
      expect(val).toBeNull();
    });

    test('get() returns parsed JSON for arrays', async () => {
      await redis.set('test:arr', [1, 2, 3]);
      const val = await redis.get('test:arr');
      expect(val).toEqual([1, 2, 3]);
    });
  });

  // --- delPattern ---

  describe('delPattern', () => {
    test('returns 0 when no keys match', async () => {
      const count = await redis.delPattern('nonexistent:*');
      expect(count).toBe(0);
    });

    test('deletes all keys matching pattern', async () => {
      const client = store.client;
      await client.set('host:1', 'a');
      await client.set('host:2', 'b');
      await client.set('host:3', 'c');
      await client.set('other:1', 'x');

      const count = await redis.delPattern('host:*');
      expect(count).toBe(3);

      // Verify host keys are gone
      expect(await client.get('host:1')).toBeNull();
      expect(await client.get('host:2')).toBeNull();
      expect(await client.get('host:3')).toBeNull();
      // Other key untouched
      expect(await client.get('other:1')).toBe('x');
    });

    test('returns 0 when stream emits empty set', async () => {
      // No keys in store at all
      const count = await redis.delPattern('empty:*');
      expect(count).toBe(0);
    });
  });

  // --- publish / subscribe ---

  describe('publish / subscribe (no-ops)', () => {
    test('publish() does not throw', async () => {
      await expect(redis.publish('test-channel', { hello: 'world' })).resolves.not.toThrow();
    });

    test('subscribe() does not throw', async () => {
      await expect(redis.subscribe('test-channel', () => {})).resolves.not.toThrow();
    });
  });

  // --- No ioredis dependency ---

  describe('no ioredis dependency', () => {
    test('redis.js source does not contain ioredis require', () => {
      const fs = require('fs');
      const source = fs.readFileSync(require.resolve('../../../src/lib/redis'), 'utf8');
      expect(source).not.toMatch(/require\(['"]ioredis['"]\)/);
    });

    test('redis.js source requires ./store', () => {
      const fs = require('fs');
      const source = fs.readFileSync(require.resolve('../../../src/lib/redis'), 'utf8');
      expect(source).toMatch(/require\(['"]\.\/store['"]\)/);
    });
  });
});
