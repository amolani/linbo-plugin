/**
 * LINBO Docker - Shared Redis Mock
 *
 * Map-backed in-memory Redis mock for unit tests.
 * Supports key-value (get/set/del/setex/expire/hmset/hgetall)
 * and list operations (rpush/lpop/lpush/lrange/lrem).
 *
 * Reusable across service tests and Phase 8 WebSocket integration tests.
 */

function createRedisMock() {
  const store = new Map();
  const lists = new Map();

  const client = {
    get: jest.fn(async (key) => store.get(key) || null),

    set: jest.fn(async (key, val, ...args) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, val);
      return 'OK';
    }),

    setex: jest.fn(async (key, ttl, val) => {
      store.set(key, val);
      return 'OK';
    }),

    del: jest.fn(async (...keys) => {
      keys.flat().forEach((k) => {
        store.delete(k);
        lists.delete(k);
      });
    }),

    expire: jest.fn(async () => 1),

    hmset: jest.fn(async (key, data) => {
      store.set(key, data);
    }),

    hgetall: jest.fn(async (key) => store.get(key) || null),

    rpush: jest.fn(async (key, val) => {
      if (!lists.has(key)) lists.set(key, []);
      lists.get(key).push(val);
      return lists.get(key).length;
    }),

    lpush: jest.fn(async (key, val) => {
      if (!lists.has(key)) lists.set(key, []);
      lists.get(key).unshift(val);
      return lists.get(key).length;
    }),

    lpop: jest.fn(async (key) => {
      const list = lists.get(key);
      return list && list.length > 0 ? list.shift() : null;
    }),

    lrange: jest.fn(async (key, start, stop) => {
      const list = lists.get(key) || [];
      return list.slice(start, stop === -1 ? undefined : stop + 1);
    }),

    lrem: jest.fn(async (key, count, val) => {
      const list = lists.get(key);
      if (!list) return 0;
      const idx = list.indexOf(val);
      if (idx !== -1) {
        list.splice(idx, 1);
        return 1;
      }
      return 0;
    }),

    status: 'ready',
  };

  function reset() {
    store.clear();
    lists.clear();
    Object.values(client).forEach((v) => {
      if (jest.isMockFunction(v)) v.mockClear();
    });
  }

  return { client, store, lists, reset };
}

module.exports = { createRedisMock };
