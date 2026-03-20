/**
 * LINBO Docker - store.js RED Test Suite
 *
 * Tests the complete in-memory Redis replacement API surface.
 * All tests must FAIL until src/lib/store.js is implemented (Plan 02).
 *
 * Covers: API-02 (Redis replacement), API-03 (host status volatility)
 */

const store = require('../../../src/lib/store');

describe('store.js — in-memory Redis replacement', () => {
  let client;

  beforeEach(() => {
    store.reset();
    client = store.client;
  });

  // --- client.status ---
  describe('client.status', () => {
    test('client.status equals "ready" immediately after require', () => {
      expect(client.status).toBe('ready');
    });
  });

  // --- String operations ---
  describe('String operations', () => {
    test('get() returns null for missing key', async () => {
      const val = await client.get('nonexistent');
      expect(val).toBeNull();
    });

    test('set(key, value) then get(key) returns value', async () => {
      await client.set('mykey', 'hello');
      const val = await client.get('mykey');
      expect(val).toBe('hello');
    });

    test('del(key) removes key; subsequent get() returns null', async () => {
      await client.set('delme', 'value');
      await client.del('delme');
      const val = await client.get('delme');
      expect(val).toBeNull();
    });

    test('del() accepts multiple keys', async () => {
      await client.set('k1', 'v1');
      await client.set('k2', 'v2');
      await client.del('k1', 'k2');
      expect(await client.get('k1')).toBeNull();
      expect(await client.get('k2')).toBeNull();
    });

    test('exists(key) returns 1 when present, 0 when missing', async () => {
      await client.set('present', 'yes');
      expect(await client.exists('present')).toBe(1);
      expect(await client.exists('missing')).toBe(0);
    });

    test('mget() returns array with values and null for missing keys', async () => {
      await client.set('a', '1');
      await client.set('c', '3');
      const result = await client.mget('a', 'b', 'c');
      expect(result).toEqual(['1', null, '3']);
    });
  });

  // --- NX/EX set variant ---
  describe('NX/EX set variant', () => {
    test('set(key, value, NX, EX, ttl) returns OK when key does not exist', async () => {
      const result = await client.set('lock', 'owner1', 'NX', 'EX', 10);
      expect(result).toBe('OK');
    });

    test('set(key, value, NX, EX, ttl) returns null when key already exists', async () => {
      await client.set('lock', 'owner1');
      const result = await client.set('lock', 'owner2', 'NX', 'EX', 10);
      expect(result).toBeNull();
    });
  });

  // --- TTL expiry ---
  describe('TTL expiry', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('setex(key, ttl, value) stores value then expires after TTL', async () => {
      await client.setex('temp', 5, 'data');
      expect(await client.get('temp')).toBe('data');

      // Advance past TTL
      jest.advanceTimersByTime(6000);

      expect(await client.get('temp')).toBeNull();
    });

    test('expire(key, ttl) sets TTL on existing key', async () => {
      await client.set('aging', 'value');
      await client.expire('aging', 3);

      expect(await client.get('aging')).toBe('value');

      // Advance past TTL
      jest.advanceTimersByTime(4000);

      expect(await client.get('aging')).toBeNull();
    });

    test('expired key returns 0 for exists()', async () => {
      await client.setex('willdie', 2, 'val');
      expect(await client.exists('willdie')).toBe(1);

      jest.advanceTimersByTime(3000);

      expect(await client.exists('willdie')).toBe(0);
    });
  });

  // --- Set operations ---
  describe('Set operations', () => {
    test('sadd/smembers adds and retrieves set members', async () => {
      await client.sadd('myset', 'a', 'b', 'c');
      const members = await client.smembers('myset');
      expect(members.sort()).toEqual(['a', 'b', 'c']);
    });

    test('sismember returns 1 for member, 0 for non-member', async () => {
      await client.sadd('myset', 'x');
      expect(await client.sismember('myset', 'x')).toBe(1);
      expect(await client.sismember('myset', 'y')).toBe(0);
    });

    test('srem removes member from set', async () => {
      await client.sadd('myset', 'a', 'b', 'c');
      await client.srem('myset', 'b');
      const members = await client.smembers('myset');
      expect(members.sort()).toEqual(['a', 'c']);
    });

    test('scard returns set cardinality', async () => {
      await client.sadd('myset', 'a', 'b', 'c');
      expect(await client.scard('myset')).toBe(3);
    });

    test('smembers returns empty array for missing set', async () => {
      const members = await client.smembers('nosuchset');
      expect(members).toEqual([]);
    });
  });

  // --- Hash operations ---
  describe('Hash operations', () => {
    test('hmset + hgetall stores and retrieves hash', async () => {
      await client.hmset('myhash', { name: 'Alice', age: '30' });
      const result = await client.hgetall('myhash');
      expect(result).toEqual({ name: 'Alice', age: '30' });
    });

    test('hgetall returns null for missing key', async () => {
      const result = await client.hgetall('nosuchhash');
      expect(result).toBeNull();
    });

    test('hset sets single field; hget retrieves it', async () => {
      await client.hset('myhash', 'field1', 'value1');
      const val = await client.hget('myhash', 'field1');
      expect(val).toBe('value1');
    });

    test('hget returns null for missing field', async () => {
      await client.hmset('myhash', { a: '1' });
      const val = await client.hget('myhash', 'missingfield');
      expect(val).toBeNull();
    });

    test('hget returns null for missing key', async () => {
      const val = await client.hget('nosuchhash', 'field');
      expect(val).toBeNull();
    });
  });

  // --- Sorted Set operations ---
  describe('Sorted Set operations', () => {
    test('zadd + zrevrange stores and retrieves by score descending', async () => {
      await client.zadd('zset', 1, 'low');
      await client.zadd('zset', 3, 'high');
      await client.zadd('zset', 2, 'mid');
      const result = await client.zrevrange('zset', 0, -1);
      expect(result).toEqual(['high', 'mid', 'low']);
    });

    test('zrem removes member from sorted set', async () => {
      await client.zadd('zset', 1, 'a');
      await client.zadd('zset', 2, 'b');
      await client.zadd('zset', 3, 'c');
      await client.zrem('zset', 'b');
      const result = await client.zrevrange('zset', 0, -1);
      expect(result).toEqual(['c', 'a']);
    });

    test('zremrangebyrank trims sorted set by rank', async () => {
      // Add 5 items sorted by score ascending
      await client.zadd('zset', 1, 'a');
      await client.zadd('zset', 2, 'b');
      await client.zadd('zset', 3, 'c');
      await client.zadd('zset', 4, 'd');
      await client.zadd('zset', 5, 'e');
      // Remove ranks 0 to 1 (lowest 2 scores: a, b)
      await client.zremrangebyrank('zset', 0, 1);
      const result = await client.zrevrange('zset', 0, -1);
      expect(result).toEqual(['e', 'd', 'c']);
    });

    test('zrevrange with start/stop limits result', async () => {
      await client.zadd('zset', 1, 'a');
      await client.zadd('zset', 2, 'b');
      await client.zadd('zset', 3, 'c');
      await client.zadd('zset', 4, 'd');
      // Get only top 2 (indices 0 and 1 of descending order)
      const result = await client.zrevrange('zset', 0, 1);
      expect(result).toEqual(['d', 'c']);
    });
  });

  // --- List operations ---
  describe('List operations', () => {
    test('rpush + lrange stores and retrieves list', async () => {
      await client.rpush('mylist', 'a', 'b', 'c');
      const result = await client.lrange('mylist', 0, -1);
      expect(result).toEqual(['a', 'b', 'c']);
    });

    test('lrem removes element from list', async () => {
      await client.rpush('mylist', 'x', 'y', 'z', 'y');
      // Remove first occurrence of 'y' (count=1 means remove 1 from head)
      await client.lrem('mylist', 1, 'y');
      const result = await client.lrange('mylist', 0, -1);
      expect(result).toEqual(['x', 'z', 'y']);
    });

    test('lrem with count=0 removes all occurrences', async () => {
      await client.rpush('mylist', 'a', 'b', 'a', 'c', 'a');
      await client.lrem('mylist', 0, 'a');
      const result = await client.lrange('mylist', 0, -1);
      expect(result).toEqual(['b', 'c']);
    });

    test('lrange returns empty array for missing list', async () => {
      const result = await client.lrange('nosuchlist', 0, -1);
      expect(result).toEqual([]);
    });
  });

  // --- pipeline() ---
  describe('pipeline()', () => {
    test('pipeline().exec() returns Array<[null, result]> tuples', async () => {
      await client.set('p1', 'val1');
      await client.set('p2', 'val2');

      const pipe = client.pipeline();
      pipe.get('p1');
      pipe.get('p2');
      pipe.get('nonexistent');
      const results = await pipe.exec();

      expect(results).toEqual([
        [null, 'val1'],
        [null, 'val2'],
        [null, null],
      ]);
    });

    test('pipeline chains multiple set/get operations', async () => {
      const pipe = client.pipeline();
      pipe.set('chain1', 'a');
      pipe.set('chain2', 'b');
      pipe.get('chain1');
      pipe.get('chain2');
      const results = await pipe.exec();

      // set returns undefined/OK, get returns value
      expect(results[2]).toEqual([null, 'a']);
      expect(results[3]).toEqual([null, 'b']);
    });

    test('pipeline is chainable', () => {
      const pipe = client.pipeline();
      const returned = pipe.set('k', 'v');
      expect(returned).toBe(pipe);
    });
  });

  // --- scanStream() ---
  describe('scanStream()', () => {
    test('scanStream({match}) emits matching keys then end', (done) => {
      // Set up some keys
      Promise.all([
        client.set('foo:1', 'a'),
        client.set('foo:2', 'b'),
        client.set('bar:1', 'c'),
      ]).then(() => {
        const stream = client.scanStream({ match: 'foo:*' });
        const collected = [];

        stream.on('data', (keys) => {
          collected.push(...keys);
        });

        stream.on('end', () => {
          expect(collected.sort()).toEqual(['foo:1', 'foo:2']);
          done();
        });
      });
    });

    test('scanStream has .pause() and .resume() methods', () => {
      const stream = client.scanStream({ match: '*' });
      expect(typeof stream.pause).toBe('function');
      expect(typeof stream.resume).toBe('function');
    });

    test('scanStream has .destroy() method', () => {
      const stream = client.scanStream({ match: '*' });
      expect(typeof stream.destroy).toBe('function');
    });
  });

  // --- publish/subscribe/call ---
  describe('publish/subscribe/call', () => {
    test('publish() is a no-op (does not throw)', async () => {
      await expect(client.publish('channel', 'msg')).resolves.not.toThrow();
    });

    test('subscribe() is a no-op (does not throw)', async () => {
      await expect(client.subscribe('channel', () => {})).resolves.not.toThrow();
    });

    test('call() throws an Error (rate-limit fallback path)', async () => {
      await expect(client.call('EVALSHA', 'abc')).rejects.toThrow();
    });
  });
});
