'use strict';

const settingsService = require('../../../src/services/settings.service');
const { SETTINGS, VALIDATORS, invalidateCache } = settingsService;

// =============================================================================
// SETTINGS schema
// =============================================================================

describe('SETTINGS schema', () => {
  it('defines all expected keys', () => {
    const expected = [
      'sync_enabled', 'lmn_api_url', 'lmn_api_user', 'lmn_api_password',
      'linbo_server_ip', 'lmn_school', 'admin_password', 'admin_password_hash',
      'sync_interval',
    ];
    for (const key of expected) {
      expect(SETTINGS).toHaveProperty(key);
    }
  });
});

// =============================================================================
// VALIDATORS
// =============================================================================

describe('VALIDATORS', () => {
  describe('sync_enabled', () => {
    it('accepts "true"', () => {
      expect(VALIDATORS.sync_enabled('true')).toBe(true);
    });

    it('accepts "false"', () => {
      expect(VALIDATORS.sync_enabled('false')).toBe(true);
    });

    it('rejects "maybe"', () => {
      expect(VALIDATORS.sync_enabled('maybe')).toBe(false);
    });
  });

  describe('lmn_api_url', () => {
    it('accepts a valid HTTPS URL', () => {
      expect(VALIDATORS.lmn_api_url('https://10.0.0.11:8001')).toBe(true);
    });

    it('accepts a valid HTTP URL', () => {
      expect(VALIDATORS.lmn_api_url('http://example.com')).toBe(true);
    });

    it('rejects an invalid URL', () => {
      expect(VALIDATORS.lmn_api_url('not-a-url')).toBe(false);
    });
  });

  describe('linbo_server_ip', () => {
    it('accepts a valid IP', () => {
      expect(VALIDATORS.linbo_server_ip('10.0.0.1')).toBe(true);
    });

    it('rejects an invalid IP', () => {
      expect(VALIDATORS.linbo_server_ip('999.999.999.999')).toBe(false);
    });

    it('rejects a hostname', () => {
      expect(VALIDATORS.linbo_server_ip('example.com')).toBe(false);
    });
  });

  describe('lmn_school', () => {
    it('accepts a valid school name', () => {
      expect(VALIDATORS.lmn_school('default-school')).toBe(true);
    });

    it('rejects names starting with a dash', () => {
      expect(VALIDATORS.lmn_school('-invalid')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(VALIDATORS.lmn_school('')).toBe(false);
    });
  });

  describe('admin_password', () => {
    it('accepts 8+ characters', () => {
      expect(VALIDATORS.admin_password('testpass')).toBe(true);
    });

    it('rejects 7 characters', () => {
      expect(VALIDATORS.admin_password('abcdefg')).toBe(false);
    });
  });

  describe('sync_interval', () => {
    it('accepts "0"', () => {
      expect(VALIDATORS.sync_interval('0')).toBe(true);
    });

    it('accepts "300"', () => {
      expect(VALIDATORS.sync_interval('300')).toBe(true);
    });

    it('rejects "-1"', () => {
      expect(VALIDATORS.sync_interval('-1')).toBe(false);
    });

    it('rejects "abc"', () => {
      expect(VALIDATORS.sync_interval('abc')).toBe(false);
    });
  });
});

// =============================================================================
// get()
// =============================================================================

describe('settings.get()', () => {
  it('returns default for an unset key', async () => {
    const value = await settingsService.get('linbo_server_ip');
    expect(value).toBe('10.0.0.1');
  });

  it('returns stored value when set in redis', async () => {
    const redis = require('../../../src/lib/redis');
    const client = redis.getClient();
    await client.set('config:linbo_server_ip', '192.168.1.1');
    invalidateCache('linbo_server_ip');

    const value = await settingsService.get('linbo_server_ip');
    expect(value).toBe('192.168.1.1');
  });

  it('throws for unknown key', async () => {
    await expect(settingsService.get('nonexistent_key')).rejects.toThrow(/Unknown setting/);
  });
});

// =============================================================================
// set()
// =============================================================================

describe('settings.set()', () => {
  it('stores a value in redis', async () => {
    await settingsService.set('lmn_school', 'myschool');
    invalidateCache('lmn_school');
    const value = await settingsService.get('lmn_school');
    expect(value).toBe('myschool');
  });

  it('stores bcrypt hash for admin_password (not plaintext)', async () => {
    await settingsService.set('admin_password', 'test1234');
    invalidateCache('admin_password');

    const redis = require('../../../src/lib/redis');
    const client = redis.getClient();
    const stored = await client.get('config:admin_password_hash');
    expect(stored).not.toBe('test1234');
    expect(stored).toMatch(/^\$2[aby]\$/); // bcrypt hash prefix
  });

  it('throws read-only error for admin_password_hash', async () => {
    await expect(settingsService.set('admin_password_hash', 'somehash')).rejects.toThrow(/read-only|Cannot set admin_password_hash/);
  });

  it('throws validation error for invalid value', async () => {
    await expect(settingsService.set('linbo_server_ip', 'not-an-ip')).rejects.toThrow(/Invalid value/);
  });

  it('throws for unknown key', async () => {
    await expect(settingsService.set('bogus_key', 'value')).rejects.toThrow(/Unknown setting/);
  });
});

// =============================================================================
// reset()
// =============================================================================

describe('settings.reset()', () => {
  it('returns default value after reset', async () => {
    await settingsService.set('lmn_school', 'custom-school');
    invalidateCache('lmn_school');
    expect(await settingsService.get('lmn_school')).toBe('custom-school');

    await settingsService.reset('lmn_school');
    invalidateCache('lmn_school');
    expect(await settingsService.get('lmn_school')).toBe('default-school');
  });
});

// =============================================================================
// getAll()
// =============================================================================

describe('settings.getAll()', () => {
  it('returns an array of settings objects', async () => {
    const all = await settingsService.getAll();
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBeGreaterThan(0);
    // Each entry has at least key, source, isSet, description
    for (const entry of all) {
      expect(entry).toHaveProperty('key');
      expect(entry).toHaveProperty('source');
      expect(entry).toHaveProperty('isSet');
      expect(entry).toHaveProperty('description');
    }
  });

  it('masks lmn_api_password value', async () => {
    await settingsService.set('lmn_api_password', 'supersecret');
    invalidateCache('lmn_api_password');

    const all = await settingsService.getAll();
    const pwEntry = all.find(e => e.key === 'lmn_api_password');
    expect(pwEntry).toBeDefined();
    expect(pwEntry.valueMasked).toBeDefined();
    expect(pwEntry.valueMasked).not.toBe('supersecret');
    expect(pwEntry.valueMasked).toMatch(/^\*{4}/);
    expect(pwEntry).not.toHaveProperty('value');
  });

  it('skips writeOnly admin_password key', async () => {
    const all = await settingsService.getAll();
    const apEntry = all.find(e => e.key === 'admin_password');
    expect(apEntry).toBeUndefined();
  });
});

// =============================================================================
// checkAdminPassword()
// =============================================================================

describe('settings.checkAdminPassword()', () => {
  it('returns true for correct password after set', async () => {
    await settingsService.set('admin_password', 'mypassword');
    const result = await settingsService.checkAdminPassword('mypassword');
    expect(result).toBe(true);
  });

  it('returns false for wrong password', async () => {
    await settingsService.set('admin_password', 'mypassword');
    const result = await settingsService.checkAdminPassword('wrongpassword');
    expect(result).toBe(false);
  });

  it('falls back to ADMIN_PASSWORD env var when no hash stored', async () => {
    // Store is reset between tests, so no hash in redis.
    // Env var ADMIN_PASSWORD is set to 'testpassword' in jest.setup.js
    const result = await settingsService.checkAdminPassword('testpassword');
    expect(result).toBe(true);
  });
});
