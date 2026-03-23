'use strict';

const request = require('supertest');
const { createTestApp } = require('../../setup/test-app');
const { createAdminToken, createViewerToken } = require('../../setup/test-auth');
const { getStoreClient } = require('../../setup/test-store');

let app;
let adminToken;
let viewerToken;

beforeAll(async () => {
  app = await createTestApp();
});

beforeEach(() => {
  adminToken = createAdminToken();
  viewerToken = createViewerToken();
});

// ---------------------------------------------------------------------------
// GET /api/v1/settings
// ---------------------------------------------------------------------------
describe('GET /api/v1/settings', () => {
  it('returns 200 with an array of settings', async () => {
    const res = await request(app)
      .get('/api/v1/settings')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('includes expected setting keys', async () => {
    const res = await request(app)
      .get('/api/v1/settings')
      .set('Authorization', `Bearer ${adminToken}`);

    const keys = res.body.data.map((s) => s.key);
    expect(keys).toContain('linbo_server_ip');
    expect(keys).toContain('lmn_api_url');
    expect(keys).toContain('lmn_api_password');
    expect(keys).toContain('sync_enabled');
  });

  it('masks lmn_api_password with valueMasked property', async () => {
    // Seed a password value so masking is visible
    const client = getStoreClient();
    await client.set('config:lmn_api_password', 'supersecret123');

    const res = await request(app)
      .get('/api/v1/settings')
      .set('Authorization', `Bearer ${adminToken}`);

    const pwSetting = res.body.data.find((s) => s.key === 'lmn_api_password');
    expect(pwSetting).toBeDefined();
    expect(pwSetting).toHaveProperty('valueMasked');
    expect(pwSetting).not.toHaveProperty('value');
    // Should mask all but last 4 chars
    expect(pwSetting.valueMasked).toBe('****t123');
  });

  it('excludes admin_password (writeOnly) from the list', async () => {
    const res = await request(app)
      .get('/api/v1/settings')
      .set('Authorization', `Bearer ${adminToken}`);

    const keys = res.body.data.map((s) => s.key);
    expect(keys).not.toContain('admin_password');
  });

  it('includes admin_password_hash with isSet flag but no raw value', async () => {
    const res = await request(app)
      .get('/api/v1/settings')
      .set('Authorization', `Bearer ${adminToken}`);

    const hashSetting = res.body.data.find((s) => s.key === 'admin_password_hash');
    expect(hashSetting).toBeDefined();
    expect(hashSetting).toHaveProperty('isSet');
    // Should not expose the hash value directly
    expect(hashSetting).not.toHaveProperty('valueMasked');
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .get('/api/v1/settings');

    expect(res.status).toBe(401);
    expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED');
  });

  it('allows viewer role to read settings', async () => {
    const res = await request(app)
      .get('/api/v1/settings')
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/v1/settings/:key
// ---------------------------------------------------------------------------
describe('PUT /api/v1/settings/:key', () => {
  it('updates linbo_server_ip with a valid IP', async () => {
    const res = await request(app)
      .put('/api/v1/settings/linbo_server_ip')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: '192.168.1.100' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('key', 'linbo_server_ip');
    expect(res.body.data).toHaveProperty('source', 'redis');
  });

  it('returns 400 for an invalid IP address', async () => {
    const res = await request(app)
      .put('/api/v1/settings/linbo_server_ip')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 'not-an-ip' });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('returns 400 for an unknown setting key', async () => {
    const res = await request(app)
      .put('/api/v1/settings/unknown_key')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 'whatever' });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/Unknown setting/i);
  });

  it('returns 400 when value is missing from body', async () => {
    const res = await request(app)
      .put('/api/v1/settings/linbo_server_ip')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('stores a bcrypt hash when setting admin_password', async () => {
    const res = await request(app)
      .put('/api/v1/settings/admin_password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 'newSecurePass' });

    expect(res.status).toBe(200);

    // Verify the stored value is a bcrypt hash, not plaintext
    const client = getStoreClient();
    const stored = await client.get('config:admin_password_hash');
    expect(stored).toBeDefined();
    expect(stored).toMatch(/^\$2[aby]\$/); // bcrypt hash prefix
  });

  it('returns 400 when setting admin_password_hash directly (readOnly)', async () => {
    const res = await request(app)
      .put('/api/v1/settings/admin_password_hash')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 'should-not-work' });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('returns 403 when viewer tries to update a setting', async () => {
    const res = await request(app)
      .put('/api/v1/settings/linbo_server_ip')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ value: '10.0.0.5' });

    expect(res.status).toBe(403);
    expect(res.body.error).toHaveProperty('code', 'FORBIDDEN');
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .put('/api/v1/settings/linbo_server_ip')
      .send({ value: '10.0.0.5' });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/settings/:key
// ---------------------------------------------------------------------------
describe('DELETE /api/v1/settings/:key', () => {
  it('resets a setting to its default value', async () => {
    // First set a custom value
    await request(app)
      .put('/api/v1/settings/linbo_server_ip')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: '192.168.99.99' });

    // Then reset it
    const res = await request(app)
      .delete('/api/v1/settings/linbo_server_ip')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ success: true, key: 'linbo_server_ip' });

    // Verify the value reverted to default by reading settings
    const getRes = await request(app)
      .get('/api/v1/settings')
      .set('Authorization', `Bearer ${adminToken}`);

    const setting = getRes.body.data.find((s) => s.key === 'linbo_server_ip');
    expect(setting.source).toBe('default');
  });

  it('returns 400 for an unknown setting key', async () => {
    const res = await request(app)
      .delete('/api/v1/settings/unknown_key')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/Unknown setting/i);
  });

  it('returns 403 when viewer tries to delete a setting', async () => {
    const res = await request(app)
      .delete('/api/v1/settings/linbo_server_ip')
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toHaveProperty('code', 'FORBIDDEN');
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .delete('/api/v1/settings/linbo_server_ip');

    expect(res.status).toBe(401);
  });
});
