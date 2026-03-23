'use strict';

const bcrypt = require('bcryptjs');
const { client } = require('../../src/lib/store');

/**
 * Seed an admin password hash into the store.
 * Used by auth integration tests that need a valid login.
 *
 * @param {string} [password='testpassword'] - Plaintext password to hash
 * @returns {Promise<string>} The bcrypt hash that was stored
 */
async function seedAdminPassword(password = 'testpassword') {
  const hash = await bcrypt.hash(password, 10);
  await client.set('config:admin_password_hash', hash);
  return hash;
}

/**
 * Seed a host entry into the store (mimics sync cache structure).
 *
 * @param {string} mac - MAC address (key suffix)
 * @param {object} data - Host data fields to store as a hash
 * @returns {Promise<void>}
 */
async function seedHost(mac, data) {
  const key = `sync:host:${mac}`;
  await client.hmset(key, data);
  await client.sadd('sync:hosts', mac);
}

/**
 * Returns the raw store client for direct manipulation in tests.
 */
function getStoreClient() {
  return client;
}

module.exports = { seedAdminPassword, seedHost, getStoreClient };
