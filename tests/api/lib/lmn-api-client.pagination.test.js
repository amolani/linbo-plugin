/**
 * Tests for batchGetHosts chunked pagination (REL-01)
 *
 * Verifies that batchGetHosts splits >500 MACs into sequential
 * <=500-element API calls, merges results, and treats 404 as empty batch.
 */

// Mock settings service before requiring the module
jest.mock('../../../src/services/settings.service', () => ({
  get: jest.fn(async (key) => {
    if (key === 'lmn_api_url') return 'http://localhost:8001';
    if (key === 'lmn_api_user') return 'testuser';
    if (key === 'lmn_api_password') return 'testpass';
    return null;
  }),
}));

// Track fetch calls
let fetchCalls = [];
let fetchResponses = [];

// Mock global fetch
global.fetch = jest.fn(async (url, options) => {
  const call = { url, options };
  fetchCalls.push(call);

  // Handle JWT auth endpoint
  if (url.includes('/v1/auth/')) {
    return {
      ok: true,
      status: 200,
      text: async () => '"test-jwt-token"',
    };
  }

  // Handle batch hosts endpoint
  if (url.includes('/hosts:batch')) {
    const body = JSON.parse(options.body);
    const responseIndex = fetchCalls.filter(c =>
      c.url.includes('/hosts:batch')
    ).length - 1;

    // Use custom response if provided, otherwise generate default
    if (fetchResponses[responseIndex]) {
      return fetchResponses[responseIndex];
    }

    // Default: return hosts matching the requested MACs
    const hosts = body.macs.map(mac => ({
      mac,
      hostname: `host-${mac}`,
      ip: `10.0.0.${parseInt(mac.split(':').pop(), 16) || 1}`,
      hostgroup: 'default',
    }));

    return {
      ok: true,
      status: 200,
      json: async () => ({ hosts }),
    };
  }

  return { ok: false, status: 404, text: async () => 'Not found' };
});

// Clear module cache to ensure fresh import with mocks
const { batchGetHosts } = require('../../../src/lib/lmn-api-client');

beforeEach(() => {
  fetchCalls = [];
  fetchResponses = [];
  jest.clearAllMocks();
});

function getBatchCalls() {
  return fetchCalls.filter(c => c.url.includes('/hosts:batch'));
}

function generateMacs(count) {
  const macs = [];
  for (let i = 0; i < count; i++) {
    const hex = i.toString(16).padStart(4, '0').toUpperCase();
    macs.push(`AA:BB:CC:DD:${hex.slice(0, 2)}:${hex.slice(2, 4)}`);
  }
  return macs;
}

// =============================================================================
// Tests
// =============================================================================

describe('batchGetHosts chunked pagination (REL-01)', () => {
  test('empty array returns { hosts: [] } without HTTP calls', async () => {
    const result = await batchGetHosts([]);
    expect(result).toEqual({ hosts: [] });
    expect(getBatchCalls()).toHaveLength(0);
  });

  test('500 MACs makes exactly 1 API call', async () => {
    const macs = generateMacs(500);
    const result = await batchGetHosts(macs);
    expect(getBatchCalls()).toHaveLength(1);
    expect(result.hosts).toHaveLength(500);
  });

  test('501 MACs makes exactly 2 API calls (500 + 1)', async () => {
    const macs = generateMacs(501);
    const result = await batchGetHosts(macs);
    expect(getBatchCalls()).toHaveLength(2);
    expect(result.hosts).toHaveLength(501);

    // Verify first batch has 500 MACs, second has 1
    const calls = getBatchCalls();
    const batch1Body = JSON.parse(calls[0].options.body);
    const batch2Body = JSON.parse(calls[1].options.body);
    expect(batch1Body.macs).toHaveLength(500);
    expect(batch2Body.macs).toHaveLength(1);
  });

  test('1500 MACs makes exactly 3 API calls (500 + 500 + 500)', async () => {
    const macs = generateMacs(1500);
    const result = await batchGetHosts(macs);
    expect(getBatchCalls()).toHaveLength(3);
    expect(result.hosts).toHaveLength(1500);
  });

  test('merges hosts from all batch responses into single { hosts: [...] }', async () => {
    const macs = generateMacs(501);
    const result = await batchGetHosts(macs);

    // All 501 hosts should be in one array
    expect(result.hosts).toHaveLength(501);
    // First and last hosts should be from different batches
    expect(result.hosts[0].mac).toBe(macs[0]);
    expect(result.hosts[500].mac).toBe(macs[500]);
  });

  test('treats HTTP 404 response as empty batch (continues, no error)', async () => {
    // 3 batches: first succeeds, second returns 404, third succeeds
    const macs = generateMacs(1500);

    fetchResponses[0] = {
      ok: true,
      status: 200,
      json: async () => ({
        hosts: macs.slice(0, 500).map(mac => ({ mac, hostname: `host-${mac}` })),
      }),
    };
    fetchResponses[1] = {
      ok: false,
      status: 404,
      text: async () => 'No hosts found for given MACs',
    };
    fetchResponses[2] = {
      ok: true,
      status: 200,
      json: async () => ({
        hosts: macs.slice(1000, 1500).map(mac => ({ mac, hostname: `host-${mac}` })),
      }),
    };

    const result = await batchGetHosts(macs);

    // 500 from batch 1 + 0 from batch 2 (404) + 500 from batch 3
    expect(result.hosts).toHaveLength(1000);
    expect(getBatchCalls()).toHaveLength(3);
  });

  test('throws on non-404 error (e.g., 500) from any batch', async () => {
    const macs = generateMacs(1000);

    // Track batch call count (excluding auth calls and retries)
    let batchCallCount = 0;
    global.fetch = jest.fn(async (url, options) => {
      fetchCalls.push({ url, options });

      // Handle JWT auth endpoint
      if (url.includes('/v1/auth/')) {
        return { ok: true, status: 200, text: async () => '"test-jwt-token"' };
      }

      if (url.includes('/hosts:batch')) {
        batchCallCount++;
        // First batch (call 1) succeeds
        if (batchCallCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ hosts: macs.slice(0, 500).map(mac => ({ mac })) }),
          };
        }
        // Second batch and all retries return 500
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'Server error',
        };
      }

      return { ok: false, status: 404, text: async () => 'Not found' };
    });

    await expect(batchGetHosts(macs)).rejects.toThrow('batchGetHosts failed (500)');
  });
});
