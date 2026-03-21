/**
 * LINBO Native — In-Memory Store with ioredis-Compatible Client Facade
 *
 * Replaces Redis with a zero-dependency in-process store that exposes
 * the identical API surface ioredis does. All 17 files that currently
 * call redis.getClient() work unchanged once redis.js delegates here.
 *
 * Data structures: 5 separate Maps (strings, sets, hashes, sorted sets, lists)
 * TTL strategy:    Lazy expiry — checked on every read
 * Persistence:     JSON snapshot via atomic-write.js
 * Exports:         { client, reset, flushToDisk, loadFromDisk }
 */

'use strict';

const { EventEmitter } = require('events');
const fsp = require('fs/promises');
const path = require('path');
const { atomicWrite } = require('./atomic-write');

// ---------------------------------------------------------------------------
// Snapshot path
// ---------------------------------------------------------------------------

const SNAPSHOT_PATH = process.env.STORE_SNAPSHOT || '/var/lib/linbo-native/store.json';

// ---------------------------------------------------------------------------
// Volatile key patterns — excluded from snapshot, never restored
// ---------------------------------------------------------------------------

const VOLATILE_KEY_PATTERNS = [
  /^host:status:/,
  /^ops:/,
  /^sync:isRunning$/,
  /^linbo:update:lock$/,
  /^linbofs:update:lock$/,
  /^grub:regen:lock$/,
  /^imgsync:lock$/,
  /^imgpush:lock$/,
  /^rl:/,
];

function isVolatile(key) {
  return VOLATILE_KEY_PATTERNS.some((p) => p.test(key));
}

// ---------------------------------------------------------------------------
// Internal data structures
// ---------------------------------------------------------------------------

let _strings = new Map();   // key -> { value: string, expiresAt: number|null }
let _sets    = new Map();   // key -> Set<string>
let _hashes  = new Map();   // key -> Map<field, string>
let _sorted  = new Map();   // key -> Array<{ score: number, member: string }>
let _lists   = new Map();   // key -> Array<string>

// TTL storage for non-string data structures (sets, hashes, sorted sets, lists)
// key -> { expiresAt: number|null }
let _ttls = new Map();

// ---------------------------------------------------------------------------
// TTL helpers
// ---------------------------------------------------------------------------

/**
 * Check if a string entry is expired. Returns true if expired.
 */
function _isStringExpired(entry) {
  if (!entry) return true;
  if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) return true;
  return false;
}

/**
 * Check if a non-string key has an expired TTL.
 */
function _isKeyExpired(key) {
  const ttl = _ttls.get(key);
  if (!ttl) return false;
  if (ttl.expiresAt !== null && ttl.expiresAt <= Date.now()) return true;
  return false;
}

/**
 * Clean up an expired non-string key from all maps.
 */
function _evictIfExpired(key) {
  if (_isKeyExpired(key)) {
    _sets.delete(key);
    _hashes.delete(key);
    _sorted.delete(key);
    _lists.delete(key);
    _ttls.delete(key);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Key iteration helper — yields all unique keys across all 5 maps
// ---------------------------------------------------------------------------

function _allKeys() {
  const keys = new Set();
  for (const key of _strings.keys()) {
    const entry = _strings.get(key);
    if (!_isStringExpired(entry)) keys.add(key);
  }
  for (const key of _sets.keys()) {
    if (!_isKeyExpired(key)) keys.add(key);
  }
  for (const key of _hashes.keys()) {
    if (!_isKeyExpired(key)) keys.add(key);
  }
  for (const key of _sorted.keys()) {
    if (!_isKeyExpired(key)) keys.add(key);
  }
  for (const key of _lists.keys()) {
    if (!_isKeyExpired(key)) keys.add(key);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Glob-to-regex helper for scanStream match patterns
// ---------------------------------------------------------------------------

function _globToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp('^' + escaped + '$');
}

// ---------------------------------------------------------------------------
// Client — ioredis-compatible facade
// ---------------------------------------------------------------------------

const client = {
  // Status property — MUST be 'ready' synchronously at module load time
  status: 'ready',

  // -------------------------------------------------------------------------
  // String operations
  // -------------------------------------------------------------------------

  /**
   * GET key — returns string value or null
   */
  async get(key) {
    const entry = _strings.get(key);
    if (!entry) return null;
    if (_isStringExpired(entry)) {
      _strings.delete(key);
      return null;
    }
    return entry.value;
  },

  /**
   * SET key value [...opts]
   * Supports:
   *   set(key, value)              — plain set, no TTL
   *   set(key, value, 'NX', 'EX', ttl)  — conditional set with TTL
   * Returns 'OK' on success, null if NX condition fails.
   */
  async set(key, value, ...opts) {
    const strValue = String(value);

    // Parse variadic options (ioredis convention)
    let nx = false;
    let exSeconds = null;

    for (let i = 0; i < opts.length; i++) {
      const opt = typeof opts[i] === 'string' ? opts[i].toUpperCase() : opts[i];
      if (opt === 'NX') {
        nx = true;
      } else if (opt === 'EX' && i + 1 < opts.length) {
        exSeconds = Number(opts[i + 1]);
        i++; // skip the TTL value
      }
    }

    // NX: only set if key does NOT exist (and is not expired)
    if (nx) {
      const existing = _strings.get(key);
      if (existing && !_isStringExpired(existing)) {
        return null; // key exists — NX fails
      }
    }

    const expiresAt = exSeconds != null ? Date.now() + exSeconds * 1000 : null;
    _strings.set(key, { value: strValue, expiresAt });
    return 'OK';
  },

  /**
   * SETEX key ttl value — set with TTL in seconds
   */
  async setex(key, ttl, value) {
    const expiresAt = Date.now() + Number(ttl) * 1000;
    _strings.set(key, { value: String(value), expiresAt });
    return 'OK';
  },

  /**
   * DEL ...keys — variadic delete from all data structures
   */
  async del(...keys) {
    // Flatten in case an array is passed
    const flatKeys = keys.flat();
    let count = 0;
    for (const key of flatKeys) {
      let found = false;
      if (_strings.delete(key)) found = true;
      if (_sets.delete(key)) found = true;
      if (_hashes.delete(key)) found = true;
      if (_sorted.delete(key)) found = true;
      if (_lists.delete(key)) found = true;
      _ttls.delete(key);
      if (found) count++;
    }
    return count;
  },

  /**
   * EXPIRE key ttl — set TTL on an existing key (any data type)
   * Returns 1 if key exists, 0 if not.
   */
  async expire(key, ttl) {
    const expiresAt = Date.now() + Number(ttl) * 1000;

    // Check string keys
    const strEntry = _strings.get(key);
    if (strEntry && !_isStringExpired(strEntry)) {
      strEntry.expiresAt = expiresAt;
      return 1;
    }

    // Check non-string keys (sets, hashes, sorted sets, lists)
    if ((_sets.has(key) || _hashes.has(key) || _sorted.has(key) || _lists.has(key)) && !_isKeyExpired(key)) {
      _ttls.set(key, { expiresAt });
      return 1;
    }

    return 0;
  },

  /**
   * EXISTS key — returns 1 if key present and not expired, 0 otherwise
   */
  async exists(key) {
    // Check strings
    const strEntry = _strings.get(key);
    if (strEntry) {
      if (_isStringExpired(strEntry)) {
        _strings.delete(key);
        return 0;
      }
      return 1;
    }

    // Check non-string with TTL
    if (_isKeyExpired(key)) {
      _evictIfExpired(key);
      return 0;
    }

    if (_sets.has(key) || _hashes.has(key) || _sorted.has(key) || _lists.has(key)) {
      return 1;
    }

    return 0;
  },

  /**
   * MGET ...keys — returns array with values and null for missing keys
   * Accepts: mget(k1, k2, k3) or mget([k1, k2, k3])
   */
  async mget(...keys) {
    // Handle both flat args and single array arg (ioredis convention)
    const flatKeys = keys.length === 1 && Array.isArray(keys[0]) ? keys[0] : keys;
    const results = [];
    for (const key of flatKeys) {
      results.push(await client.get(key));
    }
    return results;
  },

  // -------------------------------------------------------------------------
  // Set operations
  // -------------------------------------------------------------------------

  /**
   * SADD key ...members — add members to set
   */
  async sadd(key, ...members) {
    _evictIfExpired(key);
    if (!_sets.has(key)) _sets.set(key, new Set());
    const set = _sets.get(key);
    let added = 0;
    for (const m of members) {
      if (!set.has(String(m))) {
        set.add(String(m));
        added++;
      }
    }
    return added;
  },

  /**
   * SMEMBERS key — returns array of all set members
   */
  async smembers(key) {
    if (_evictIfExpired(key)) return [];
    const set = _sets.get(key);
    if (!set) return [];
    return Array.from(set);
  },

  /**
   * SISMEMBER key member — returns 1 if member in set, 0 otherwise
   */
  async sismember(key, member) {
    if (_evictIfExpired(key)) return 0;
    const set = _sets.get(key);
    if (!set) return 0;
    return set.has(String(member)) ? 1 : 0;
  },

  /**
   * SREM key ...members — remove members from set
   */
  async srem(key, ...members) {
    if (_evictIfExpired(key)) return 0;
    const set = _sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const m of members) {
      if (set.delete(String(m))) removed++;
    }
    if (set.size === 0) {
      _sets.delete(key);
      _ttls.delete(key);
    }
    return removed;
  },

  /**
   * SCARD key — returns set cardinality (number of members)
   */
  async scard(key) {
    if (_evictIfExpired(key)) return 0;
    const set = _sets.get(key);
    if (!set) return 0;
    return set.size;
  },

  // -------------------------------------------------------------------------
  // Hash operations
  // -------------------------------------------------------------------------

  /**
   * HMSET key obj — set multiple hash fields from a plain JS object
   */
  async hmset(key, obj) {
    _evictIfExpired(key);
    if (!_hashes.has(key)) _hashes.set(key, new Map());
    const hash = _hashes.get(key);
    for (const [field, value] of Object.entries(obj)) {
      hash.set(field, String(value));
    }
    return 'OK';
  },

  /**
   * HSET key field value — set a single hash field
   */
  async hset(key, field, value) {
    _evictIfExpired(key);
    if (!_hashes.has(key)) _hashes.set(key, new Map());
    _hashes.get(key).set(field, String(value));
    return 1;
  },

  /**
   * HGET key field — get a single hash field value, or null
   */
  async hget(key, field) {
    if (_evictIfExpired(key)) return null;
    const hash = _hashes.get(key);
    if (!hash) return null;
    const val = hash.get(field);
    return val !== undefined ? val : null;
  },

  /**
   * HGETALL key — returns plain JS object of all fields, or null if key missing
   */
  async hgetall(key) {
    if (_evictIfExpired(key)) return null;
    const hash = _hashes.get(key);
    if (!hash) return null;
    const obj = {};
    for (const [field, value] of hash) {
      obj[field] = value;
    }
    return obj;
  },

  // -------------------------------------------------------------------------
  // Sorted Set operations
  // -------------------------------------------------------------------------

  /**
   * ZADD key score member — add member with score to sorted set
   * If member already exists, update its score.
   */
  async zadd(key, score, member) {
    _evictIfExpired(key);
    if (!_sorted.has(key)) _sorted.set(key, []);
    const arr = _sorted.get(key);
    const strMember = String(member);
    const idx = arr.findIndex((e) => e.member === strMember);
    if (idx !== -1) {
      arr[idx].score = Number(score);
    } else {
      arr.push({ score: Number(score), member: strMember });
    }
    // Keep sorted ascending by score
    arr.sort((a, b) => a.score - b.score);
    return idx === -1 ? 1 : 0;
  },

  /**
   * ZREVRANGE key start stop — returns members sorted by score descending
   * stop=-1 means all elements to the end.
   */
  async zrevrange(key, start, stop) {
    if (_evictIfExpired(key)) return [];
    const arr = _sorted.get(key);
    if (!arr || arr.length === 0) return [];
    // Reverse a copy for descending order
    const desc = [...arr].reverse();
    const end = stop === -1 ? desc.length : stop + 1;
    return desc.slice(start, end).map((e) => e.member);
  },

  /**
   * ZREM key ...members — remove members from sorted set
   */
  async zrem(key, ...members) {
    if (_evictIfExpired(key)) return 0;
    const arr = _sorted.get(key);
    if (!arr) return 0;
    const memberSet = new Set(members.map(String));
    const before = arr.length;
    const filtered = arr.filter((e) => !memberSet.has(e.member));
    _sorted.set(key, filtered);
    if (filtered.length === 0) {
      _sorted.delete(key);
      _ttls.delete(key);
    }
    return before - filtered.length;
  },

  /**
   * ZREMRANGEBYRANK key start stop — remove elements by rank (ascending score order)
   * Ranks are 0-based. Negative stop means "from the end" (e.g., -N means keep last N).
   */
  async zremrangebyrank(key, start, stop) {
    if (_evictIfExpired(key)) return 0;
    const arr = _sorted.get(key);
    if (!arr) return 0;
    const len = arr.length;
    const resolvedStop = stop < 0 ? len + stop : stop;
    const toRemove = resolvedStop - start + 1;
    if (toRemove <= 0) return 0;
    const removed = arr.splice(start, toRemove);
    if (arr.length === 0) {
      _sorted.delete(key);
      _ttls.delete(key);
    }
    return removed.length;
  },

  // -------------------------------------------------------------------------
  // List operations
  // -------------------------------------------------------------------------

  /**
   * RPUSH key ...values — append values to list (right push)
   */
  async rpush(key, ...values) {
    _evictIfExpired(key);
    if (!_lists.has(key)) _lists.set(key, []);
    const list = _lists.get(key);
    for (const v of values) {
      list.push(String(v));
    }
    return list.length;
  },

  /**
   * LRANGE key start stop — returns list range
   * stop=-1 means all elements to the end.
   */
  async lrange(key, start, stop) {
    if (_evictIfExpired(key)) return [];
    const list = _lists.get(key);
    if (!list) return [];
    const end = stop === -1 ? list.length : stop + 1;
    return list.slice(start, end);
  },

  /**
   * LREM key count value — remove occurrences of value from list
   * count > 0: remove first N occurrences from head
   * count < 0: remove first |N| occurrences from tail
   * count = 0: remove ALL occurrences
   */
  async lrem(key, count, value) {
    if (_evictIfExpired(key)) return 0;
    const list = _lists.get(key);
    if (!list) return 0;
    const strValue = String(value);
    let removed = 0;

    if (count === 0) {
      // Remove all occurrences
      const filtered = list.filter((v) => v !== strValue);
      removed = list.length - filtered.length;
      _lists.set(key, filtered);
    } else if (count > 0) {
      // Remove first N from head
      const result = [];
      for (const v of list) {
        if (v === strValue && removed < count) {
          removed++;
        } else {
          result.push(v);
        }
      }
      _lists.set(key, result);
    } else {
      // Remove first |count| from tail (reverse, remove, reverse back)
      const absCount = Math.abs(count);
      const reversed = [...list].reverse();
      const result = [];
      for (const v of reversed) {
        if (v === strValue && removed < absCount) {
          removed++;
        } else {
          result.push(v);
        }
      }
      _lists.set(key, result.reverse());
    }

    const remaining = _lists.get(key);
    if (remaining && remaining.length === 0) {
      _lists.delete(key);
      _ttls.delete(key);
    }
    return removed;
  },

  /**
   * LPOP key — remove and return head element
   */
  async lpop(key) {
    if (_evictIfExpired(key)) return null;
    const list = _lists.get(key);
    if (!list || list.length === 0) return null;
    const val = list.shift();
    if (list.length === 0) {
      _lists.delete(key);
      _ttls.delete(key);
    }
    return val;
  },

  /**
   * LLEN key — returns list length
   */
  async llen(key) {
    if (_evictIfExpired(key)) return 0;
    const list = _lists.get(key);
    if (!list) return 0;
    return list.length;
  },

  // -------------------------------------------------------------------------
  // Pipeline — batch commands with ioredis-compatible [null, result] tuples
  // -------------------------------------------------------------------------

  /**
   * PIPELINE — returns a chainable pipe object
   * Supports two calling conventions:
   *   a) Chainable:  client.pipeline().get('k').set('k', 'v').exec()
   *   b) Array:      client.pipeline([['del', 'k1'], ['del', 'k2']]).exec()
   */
  pipeline(commands) {
    const queue = [];

    // If called with an array of commands, pre-populate the queue
    if (Array.isArray(commands)) {
      for (const cmd of commands) {
        const [method, ...args] = cmd;
        queue.push({ method, args });
      }
    }

    // Create a chainable proxy that queues method calls
    const pipe = new Proxy(
      {
        async exec() {
          const results = [];
          for (const { method, args } of queue) {
            try {
              const result = await client[method](...args);
              results.push([null, result]);
            } catch (err) {
              results.push([err, null]);
            }
          }
          return results;
        },
      },
      {
        get(target, prop) {
          // Return exec() directly
          if (prop === 'exec') return target.exec;
          // Return 'then' as undefined so pipeline is not treated as a Promise
          if (prop === 'then') return undefined;
          // Queue any other method call and return the proxy for chaining
          return (...args) => {
            queue.push({ method: prop, args });
            return pipe;
          };
        },
      },
    );

    return pipe;
  },

  // -------------------------------------------------------------------------
  // scanStream — EventEmitter-based key scanner
  // -------------------------------------------------------------------------

  /**
   * SCANSTREAM — returns EventEmitter that emits matching keys then ends
   * Supports: { match: 'pattern:*', count: 100 }
   * Has .pause(), .resume(), .destroy() methods (required by redis.js delPattern).
   */
  scanStream({ match = '*', count = 100 } = {}) {
    const emitter = new EventEmitter();

    // Readable-stream-like methods (required by delPattern in redis.js)
    emitter.pause = function () { return this; };
    emitter.resume = function () { return this; };
    emitter.destroy = function () { return this; };

    const regex = _globToRegex(match);

    process.nextTick(() => {
      try {
        const keys = [];
        for (const key of _allKeys()) {
          if (regex.test(key)) keys.push(key);
        }
        if (keys.length > 0) emitter.emit('data', keys);
        emitter.emit('end');
      } catch (err) {
        emitter.emit('error', err);
      }
    });

    return emitter;
  },

  // -------------------------------------------------------------------------
  // Pub/Sub — no-ops (no Redis pub/sub in native mode)
  // -------------------------------------------------------------------------

  async publish() {},
  async subscribe() {},

  // -------------------------------------------------------------------------
  // Raw command — throws to trigger rate-limit fallback
  // -------------------------------------------------------------------------

  async call(command, ...args) {
    throw new Error('store.js: call() not implemented — use in-memory rate limiting');
  },
};

// ---------------------------------------------------------------------------
// Snapshot persistence
// ---------------------------------------------------------------------------

/**
 * Flush store to disk as JSON snapshot.
 * Excludes volatile keys. Skips expired entries.
 * @param {string} [snapshotPath] — override path (useful for testing)
 */
async function flushToDisk(snapshotPath) {
  const filePath = snapshotPath || SNAPSHOT_PATH;
  const now = Date.now();

  const snap = {
    version: 1,
    timestamp: now,
    strings: [],
    sets: [],
    hashes: [],
    sortedSets: [],
    lists: [],
  };

  // Serialize strings (skip volatile, skip expired)
  for (const [key, entry] of _strings) {
    if (isVolatile(key)) continue;
    if (entry.expiresAt !== null && entry.expiresAt <= now) continue;
    snap.strings.push({ key, value: entry.value, expiresAt: entry.expiresAt });
  }

  // Serialize sets
  for (const [key, set] of _sets) {
    if (isVolatile(key)) continue;
    if (_isKeyExpired(key)) continue;
    const ttl = _ttls.get(key);
    snap.sets.push({
      key,
      members: Array.from(set),
      expiresAt: ttl ? ttl.expiresAt : null,
    });
  }

  // Serialize hashes
  for (const [key, hash] of _hashes) {
    if (isVolatile(key)) continue;
    if (_isKeyExpired(key)) continue;
    const obj = {};
    for (const [field, value] of hash) {
      obj[field] = value;
    }
    const ttl = _ttls.get(key);
    snap.hashes.push({
      key,
      fields: obj,
      expiresAt: ttl ? ttl.expiresAt : null,
    });
  }

  // Serialize sorted sets
  for (const [key, arr] of _sorted) {
    if (isVolatile(key)) continue;
    if (_isKeyExpired(key)) continue;
    const ttl = _ttls.get(key);
    snap.sortedSets.push({
      key,
      entries: arr.map((e) => ({ score: e.score, member: e.member })),
      expiresAt: ttl ? ttl.expiresAt : null,
    });
  }

  // Serialize lists
  for (const [key, list] of _lists) {
    if (isVolatile(key)) continue;
    if (_isKeyExpired(key)) continue;
    const ttl = _ttls.get(key);
    snap.lists.push({
      key,
      items: [...list],
      expiresAt: ttl ? ttl.expiresAt : null,
    });
  }

  await atomicWrite(filePath, JSON.stringify(snap, null, 2));
}

/**
 * Load store from disk snapshot.
 * Skips expired entries. Clears lock keys unconditionally.
 * Never restores volatile keys (host:status:*, ops:*, etc.)
 * @param {string} [snapshotPath] — override path (useful for testing)
 */
async function loadFromDisk(snapshotPath) {
  const filePath = snapshotPath || SNAPSHOT_PATH;
  const now = Date.now();

  let raw;
  try {
    raw = await fsp.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      // First boot — no snapshot yet, that is OK
      return;
    }
    console.warn('[Store] snapshot load failed:', err.message);
    return;
  }

  let snap;
  try {
    snap = JSON.parse(raw);
  } catch (err) {
    console.warn('[Store] snapshot parse failed:', err.message);
    return;
  }

  // Restore strings
  if (Array.isArray(snap.strings)) {
    for (const { key, value, expiresAt } of snap.strings) {
      if (isVolatile(key)) continue;
      if (expiresAt !== null && expiresAt <= now) continue;
      _strings.set(key, { value, expiresAt });
    }
  }

  // Restore sets
  if (Array.isArray(snap.sets)) {
    for (const { key, members, expiresAt } of snap.sets) {
      if (isVolatile(key)) continue;
      if (expiresAt !== null && expiresAt <= now) continue;
      _sets.set(key, new Set(members));
      if (expiresAt !== null) _ttls.set(key, { expiresAt });
    }
  }

  // Restore hashes
  if (Array.isArray(snap.hashes)) {
    for (const { key, fields, expiresAt } of snap.hashes) {
      if (isVolatile(key)) continue;
      if (expiresAt !== null && expiresAt <= now) continue;
      const map = new Map();
      for (const [field, value] of Object.entries(fields)) {
        map.set(field, value);
      }
      _hashes.set(key, map);
      if (expiresAt !== null) _ttls.set(key, { expiresAt });
    }
  }

  // Restore sorted sets
  if (Array.isArray(snap.sortedSets)) {
    for (const { key, entries, expiresAt } of snap.sortedSets) {
      if (isVolatile(key)) continue;
      if (expiresAt !== null && expiresAt <= now) continue;
      _sorted.set(
        key,
        entries.map((e) => ({ score: e.score, member: e.member })),
      );
      if (expiresAt !== null) _ttls.set(key, { expiresAt });
    }
  }

  // Restore lists
  if (Array.isArray(snap.lists)) {
    for (const { key, items, expiresAt } of snap.lists) {
      if (isVolatile(key)) continue;
      if (expiresAt !== null && expiresAt <= now) continue;
      _lists.set(key, [...items]);
      if (expiresAt !== null) _ttls.set(key, { expiresAt });
    }
  }

  // Always clear lock keys after restore (crash recovery — Pitfall 3)
  _strings.delete('sync:isRunning');
  _strings.delete('linbo:update:lock');
  _strings.delete('linbofs:update:lock');
  _strings.delete('grub:regen:lock');
  _strings.delete('imgsync:lock');
  _strings.delete('imgpush:lock');
}

// ---------------------------------------------------------------------------
// Reset — clears all data structures (for test isolation only)
// ---------------------------------------------------------------------------

function reset() {
  _strings.clear();
  _sets.clear();
  _hashes.clear();
  _sorted.clear();
  _lists.clear();
  _ttls.clear();
}

// ---------------------------------------------------------------------------
// Module-level startup: load snapshot (fire-and-forget)
// ---------------------------------------------------------------------------

loadFromDisk().catch((err) => {
  console.warn('[Store] startup snapshot load failed:', err.message);
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { client, reset, flushToDisk, loadFromDisk };
