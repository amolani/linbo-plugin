/**
 * LINBO Docker - Redis Client
 * Used for caching, session storage, and pub/sub
 */

const Redis = require('ioredis');

let redis = null;
let subscriber = null;

/**
 * Create Redis client with configuration
 */
function createClient() {
  const config = {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB, 10) || 0,
    retryStrategy(times) {
      const delay = Math.min(times * 500, 5000);
      console.log(`Redis reconnecting in ${delay}ms...`);
      return delay;
    },
    maxRetriesPerRequest: 3,
  };

  return new Redis(config);
}

/**
 * Get or create the main Redis client
 */
function getClient() {
  if (!redis) {
    redis = createClient();

    redis.on('connect', () => {
      console.log('Redis connected');
    });

    redis.on('error', (err) => {
      console.error('Redis error:', err.message);
    });

    redis.on('close', () => {
      console.log('Redis connection closed');
    });
  }
  return redis;
}

/**
 * Get or create a subscriber client for pub/sub
 */
function getSubscriber() {
  if (!subscriber) {
    subscriber = createClient();

    subscriber.on('error', (err) => {
      console.error('Redis subscriber error:', err.message);
    });
  }
  return subscriber;
}

/**
 * Disconnect all Redis clients
 */
async function disconnect() {
  const promises = [];
  if (redis) {
    promises.push(redis.quit());
    redis = null;
  }
  if (subscriber) {
    promises.push(subscriber.quit());
    subscriber = null;
  }
  await Promise.all(promises);
  console.log('Redis disconnected');
}

/**
 * Health check - verify Redis connection
 */
async function healthCheck() {
  try {
    const client = getClient();
    const pong = await client.ping();
    return { status: 'healthy', message: pong };
  } catch (error) {
    return { status: 'unhealthy', message: error.message };
  }
}

// Cache helpers

/**
 * Get cached value
 * @param {string} key - Cache key
 */
async function get(key) {
  const client = getClient();
  const value = await client.get(key);
  return value ? JSON.parse(value) : null;
}

/**
 * Set cached value with optional TTL
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {number} ttl - Time to live in seconds (optional)
 */
async function set(key, value, ttl = null) {
  const client = getClient();
  const serialized = JSON.stringify(value);
  if (ttl) {
    await client.setex(key, ttl, serialized);
  } else {
    await client.set(key, serialized);
  }
}

/**
 * Delete cached value
 * @param {string} key - Cache key
 */
async function del(key) {
  const client = getClient();
  await client.del(key);
}

/**
 * Delete all keys matching pattern
 * @param {string} pattern - Key pattern (e.g., "hosts:*")
 */
async function delPattern(pattern) {
  const client = getClient();
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

/**
 * Publish message to channel
 * @param {string} channel - Channel name
 * @param {any} message - Message to publish
 */
async function publish(channel, message) {
  const client = getClient();
  await client.publish(channel, JSON.stringify(message));
}

/**
 * Subscribe to channel
 * @param {string} channel - Channel name
 * @param {function} callback - Message handler
 */
async function subscribe(channel, callback) {
  const sub = getSubscriber();
  await sub.subscribe(channel);
  sub.on('message', (ch, message) => {
    if (ch === channel) {
      try {
        callback(JSON.parse(message));
      } catch {
        callback(message);
      }
    }
  });
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
