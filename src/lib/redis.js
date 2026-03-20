/**
 * LINBO Native -- Store Client (Phase 4: Redis removed)
 * Delegates to src/lib/store.js -- in-memory Map with JSON snapshot.
 * All 17 importers use this module unchanged via getClient().
 */

'use strict';

const store = require('./store');

function getClient() { return store.client; }
function getSubscriber() { return store.client; }

async function disconnect() {
  await store.flushToDisk();
}

async function healthCheck() {
  return { status: 'healthy', message: 'store ready' };
}

async function get(key) {
  const value = await store.client.get(key);
  return value ? JSON.parse(value) : null;
}

async function set(key, value, ttl = null) {
  const serialized = JSON.stringify(value);
  if (ttl) {
    await store.client.setex(key, ttl, serialized);
  } else {
    await store.client.set(key, serialized);
  }
}

async function del(key) {
  await store.client.del(key);
}

async function delPattern(pattern) {
  const client = store.client;
  let deleted = 0;
  return new Promise((resolve, reject) => {
    const stream = client.scanStream({ match: pattern, count: 100 });
    stream.on('data', (keys) => {
      if (keys.length === 0) return;
      deleted += keys.length;
      stream.pause();
      client.pipeline(keys.map((k) => ['del', k])).exec()
        .then(() => stream.resume())
        .catch((err) => { stream.destroy(); reject(err); });
    });
    stream.on('end', () => resolve(deleted));
    stream.on('error', reject);
  });
}

async function publish(channel, message) {
  await store.client.publish(channel, JSON.stringify(message));
}

async function subscribe(channel, callback) {
  await store.client.subscribe(channel, callback);
}

module.exports = {
  getClient,
  getSubscriber,
  disconnect,
  healthCheck,
  get,
  set,
  del,
  delPattern,
  publish,
  subscribe,
};
