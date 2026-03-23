'use strict';

const { client, reset, gc } = require('../../../src/lib/store');

// ---------------------------------------------------------------------------
// String operations
// ---------------------------------------------------------------------------

describe('store — string operations', () => {
  it('get returns null for non-existent key', async () => {
    expect(await client.get('missing')).toBeNull();
  });

  it('set returns OK and get retrieves the value', async () => {
    const result = await client.set('k1', 'hello');
    expect(result).toBe('OK');
    expect(await client.get('k1')).toBe('hello');
  });

  it('set converts non-string values to strings', async () => {
    await client.set('num', 42);
    expect(await client.get('num')).toBe('42');
  });

  it('set with EX makes key expire', async () => {
    // Set key with a very short TTL that is already in the past
    await client.set('ttl-key', 'val', 'EX', 0);
    // 0 seconds means expiresAt = Date.now(), which is <= Date.now() on next read
    expect(await client.get('ttl-key')).toBeNull();
  });

  it('set with NX only sets if key does not exist', async () => {
    const first = await client.set('nx-key', 'first', 'NX');
    expect(first).toBe('OK');
    const second = await client.set('nx-key', 'second', 'NX');
    expect(second).toBeNull();
    expect(await client.get('nx-key')).toBe('first');
  });

  it('set with NX and EX combined', async () => {
    const result = await client.set('nx-ex', 'val', 'NX', 'EX', 60);
    expect(result).toBe('OK');
    expect(await client.get('nx-ex')).toBe('val');
    // Second NX attempt fails
    expect(await client.set('nx-ex', 'new', 'NX', 'EX', 60)).toBeNull();
  });

  it('del removes a key and returns count', async () => {
    await client.set('d1', 'v');
    const count = await client.del('d1');
    expect(count).toBe(1);
    expect(await client.get('d1')).toBeNull();
  });

  it('del returns 0 for non-existent key', async () => {
    expect(await client.del('nope')).toBe(0);
  });

  it('exists returns 1 for existing key, 0 for missing', async () => {
    await client.set('e1', 'v');
    expect(await client.exists('e1')).toBe(1);
    expect(await client.exists('nope')).toBe(0);
  });

  it('mget returns values and nulls in order', async () => {
    await client.set('m1', 'a');
    await client.set('m3', 'c');
    const result = await client.mget('m1', 'm2', 'm3');
    expect(result).toEqual(['a', null, 'c']);
  });
});

// ---------------------------------------------------------------------------
// Set operations
// ---------------------------------------------------------------------------

describe('store — set operations', () => {
  it('sadd adds members and returns count of new members', async () => {
    const added = await client.sadd('s1', 'a', 'b', 'c');
    expect(added).toBe(3);
  });

  it('sadd does not count duplicates', async () => {
    await client.sadd('s2', 'a', 'b');
    const added = await client.sadd('s2', 'b', 'c');
    expect(added).toBe(1); // only 'c' is new
  });

  it('smembers returns all members', async () => {
    await client.sadd('s3', 'x', 'y');
    const members = await client.smembers('s3');
    expect(members.sort()).toEqual(['x', 'y']);
  });

  it('smembers returns empty array for missing key', async () => {
    expect(await client.smembers('nope')).toEqual([]);
  });

  it('sismember returns 1 if member present, 0 otherwise', async () => {
    await client.sadd('s4', 'a');
    expect(await client.sismember('s4', 'a')).toBe(1);
    expect(await client.sismember('s4', 'z')).toBe(0);
  });

  it('srem removes a member and returns count', async () => {
    await client.sadd('s5', 'a', 'b', 'c');
    const removed = await client.srem('s5', 'b');
    expect(removed).toBe(1);
    expect(await client.smembers('s5')).toEqual(expect.not.arrayContaining(['b']));
  });

  it('scard returns set cardinality', async () => {
    await client.sadd('s6', 'a', 'b', 'c');
    expect(await client.scard('s6')).toBe(3);
  });

  it('scard returns 0 for missing key', async () => {
    expect(await client.scard('nope')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Hash operations
// ---------------------------------------------------------------------------

describe('store — hash operations', () => {
  it('hset sets a field and hget retrieves it', async () => {
    await client.hset('h1', 'field1', 'value1');
    expect(await client.hget('h1', 'field1')).toBe('value1');
  });

  it('hget returns null for missing field', async () => {
    await client.hset('h2', 'a', '1');
    expect(await client.hget('h2', 'missing')).toBeNull();
  });

  it('hget returns null for missing key', async () => {
    expect(await client.hget('nope', 'f')).toBeNull();
  });

  it('hgetall returns all fields as a plain object', async () => {
    await client.hset('h3', 'name', 'Alice');
    await client.hset('h3', 'age', '30');
    const obj = await client.hgetall('h3');
    expect(obj).toEqual({ name: 'Alice', age: '30' });
  });

  it('hgetall returns null for missing key', async () => {
    expect(await client.hgetall('nope')).toBeNull();
  });

  it('hmset sets multiple fields at once', async () => {
    const result = await client.hmset('h4', { x: '1', y: '2', z: '3' });
    expect(result).toBe('OK');
    expect(await client.hget('h4', 'y')).toBe('2');
  });
});

// ---------------------------------------------------------------------------
// Sorted set operations
// ---------------------------------------------------------------------------

describe('store — sorted set operations', () => {
  it('zadd adds a member and returns 1 for new member', async () => {
    const added = await client.zadd('z1', 10, 'alice');
    expect(added).toBe(1);
  });

  it('zadd returns 0 when updating existing member score', async () => {
    await client.zadd('z2', 10, 'alice');
    const result = await client.zadd('z2', 20, 'alice');
    expect(result).toBe(0);
  });

  it('zrevrange returns members in descending score order', async () => {
    await client.zadd('z3', 1, 'low');
    await client.zadd('z3', 3, 'high');
    await client.zadd('z3', 2, 'mid');
    const result = await client.zrevrange('z3', 0, -1);
    expect(result).toEqual(['high', 'mid', 'low']);
  });

  it('zrem removes a member and returns count', async () => {
    await client.zadd('z4', 1, 'a');
    await client.zadd('z4', 2, 'b');
    const removed = await client.zrem('z4', 'a');
    expect(removed).toBe(1);
    const remaining = await client.zrevrange('z4', 0, -1);
    expect(remaining).toEqual(['b']);
  });

  it('zrem returns 0 for non-existent member', async () => {
    await client.zadd('z5', 1, 'a');
    expect(await client.zrem('z5', 'nope')).toBe(0);
  });

  it('zrevrange returns empty array for missing key', async () => {
    expect(await client.zrevrange('nope', 0, -1)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// List operations
// ---------------------------------------------------------------------------

describe('store — list operations', () => {
  it('rpush appends values and returns list length', async () => {
    const len1 = await client.rpush('l1', 'a');
    expect(len1).toBe(1);
    const len2 = await client.rpush('l1', 'b');
    expect(len2).toBe(2);
  });

  it('lrange returns the requested range', async () => {
    await client.rpush('l2', 'a');
    await client.rpush('l2', 'b');
    await client.rpush('l2', 'c');
    expect(await client.lrange('l2', 0, -1)).toEqual(['a', 'b', 'c']);
    expect(await client.lrange('l2', 0, 1)).toEqual(['a', 'b']);
  });

  it('lrange returns empty array for missing key', async () => {
    expect(await client.lrange('nope', 0, -1)).toEqual([]);
  });

  it('llen returns list length', async () => {
    await client.rpush('l3', 'a');
    await client.rpush('l3', 'b');
    expect(await client.llen('l3')).toBe(2);
  });

  it('llen returns 0 for missing key', async () => {
    expect(await client.llen('nope')).toBe(0);
  });

  it('lpop removes and returns the head element', async () => {
    await client.rpush('l4', 'first');
    await client.rpush('l4', 'second');
    expect(await client.lpop('l4')).toBe('first');
    expect(await client.llen('l4')).toBe(1);
  });

  it('lpop returns null for missing key', async () => {
    expect(await client.lpop('nope')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TTL / expire
// ---------------------------------------------------------------------------

describe('store — TTL and expire', () => {
  it('expire returns 1 for existing key', async () => {
    await client.set('t1', 'val');
    expect(await client.expire('t1', 60)).toBe(1);
  });

  it('expire returns 0 for non-existent key', async () => {
    expect(await client.expire('nope', 60)).toBe(0);
  });

  it('expired string key is evicted on read', async () => {
    await client.set('t2', 'val', 'EX', 0);
    expect(await client.get('t2')).toBeNull();
    expect(await client.exists('t2')).toBe(0);
  });

  it('expire works on non-string data types (sets)', async () => {
    await client.sadd('ts1', 'member');
    expect(await client.expire('ts1', 60)).toBe(1);
  });

  it('setex sets a key with TTL', async () => {
    await client.setex('sx1', 60, 'val');
    expect(await client.get('sx1')).toBe('val');
  });
});

// ---------------------------------------------------------------------------
// scanStream
// ---------------------------------------------------------------------------

describe('store — scanStream', () => {
  it('emits matching keys and ends', (done) => {
    Promise.all([
      client.set('scan:a', '1'),
      client.set('scan:b', '2'),
      client.set('other', '3'),
    ]).then(() => {
      const stream = client.scanStream({ match: 'scan:*' });
      const collected = [];
      stream.on('data', (keys) => collected.push(...keys));
      stream.on('end', () => {
        expect(collected.sort()).toEqual(['scan:a', 'scan:b']);
        done();
      });
    });
  });

  it('emits empty when no keys match', (done) => {
    const stream = client.scanStream({ match: 'xyz:*' });
    const collected = [];
    stream.on('data', (keys) => collected.push(...keys));
    stream.on('end', () => {
      expect(collected).toEqual([]);
      done();
    });
  });
});

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

describe('store — pipeline', () => {
  it('executes batched commands and returns [null, result] tuples', async () => {
    await client.set('p1', 'v1');
    const results = await client.pipeline()
      .get('p1')
      .set('p2', 'v2')
      .get('p2')
      .exec();
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual([null, 'v1']);
    expect(results[1]).toEqual([null, 'OK']);
    expect(results[2]).toEqual([null, 'v2']);
  });

  it('accepts array-of-arrays syntax', async () => {
    await client.set('pa', 'va');
    const results = await client.pipeline([
      ['get', 'pa'],
      ['del', 'pa'],
    ]).exec();
    expect(results[0]).toEqual([null, 'va']);
    expect(results[1]).toEqual([null, 1]);
  });
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

describe('store — reset', () => {
  it('clears all data structures', async () => {
    await client.set('r1', 'v');
    await client.sadd('r2', 'a');
    await client.hset('r3', 'f', 'v');
    await client.zadd('r4', 1, 'm');
    await client.rpush('r5', 'x');

    reset();

    expect(await client.get('r1')).toBeNull();
    expect(await client.smembers('r2')).toEqual([]);
    expect(await client.hgetall('r3')).toBeNull();
    expect(await client.zrevrange('r4', 0, -1)).toEqual([]);
    expect(await client.lrange('r5', 0, -1)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// gc — garbage collection
// ---------------------------------------------------------------------------

describe('store — gc', () => {
  it('returns 0 when there are no expired keys', async () => {
    await client.set('gc1', 'val');
    expect(gc()).toBe(0);
  });

  it('evicts expired string keys', async () => {
    await client.set('gc2', 'val', 'EX', 0);
    // Key is stored but already expired (expiresAt <= Date.now())
    const evicted = gc();
    expect(evicted).toBeGreaterThanOrEqual(1);
    expect(await client.get('gc2')).toBeNull();
  });

  it('evicts expired non-string keys', async () => {
    await client.sadd('gc-set', 'a');
    await client.expire('gc-set', 0);
    const evicted = gc();
    expect(evicted).toBeGreaterThanOrEqual(1);
    expect(await client.smembers('gc-set')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// pub/sub — no-ops (native mode)
// ---------------------------------------------------------------------------

describe('store — pub/sub (no-ops)', () => {
  it('publish does not throw', async () => {
    await expect(client.publish('ch', 'msg')).resolves.not.toThrow();
  });

  it('subscribe does not throw', async () => {
    await expect(client.subscribe('ch')).resolves.not.toThrow();
  });
});
