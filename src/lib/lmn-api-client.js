/**
 * LINBO Plugin - LMN API Client
 * HTTP client for fetching LINBO data from linuxmuster-api (port 8001)
 * or the legacy Authority API (port 8400).
 *
 * Auth mode is auto-detected from the configured URL:
 *   - Port 8001 (linuxmuster-api): JWT auth via /v1/auth, paths under /v1/linbo/
 *   - Port 8400 (Authority API):   Static Bearer token, paths under /api/v1/linbo/
 */

const REQUEST_TIMEOUT = 10_000;
const MAX_RETRIES = 3;
const BASE_DELAY = 500;

let _settings;
function getSettings() {
  if (!_settings) _settings = require('../services/settings.service');
  return _settings;
}

// JWT token cache for linuxmuster-api mode
let _jwtToken = null;
let _jwtExpiry = 0;

/**
 * Get JWT token for linuxmuster-api via HTTP Basic Auth (cached, auto-refreshes).
 * linuxmuster-api uses GET /v1/auth/ with HTTP Basic Auth, returns a bare JWT string.
 * @param {string} baseUrl
 * @returns {Promise<string>}
 */
async function _getJwtToken(baseUrl) {
  // Return cached token if still valid (5min buffer)
  if (_jwtToken && Date.now() < _jwtExpiry - 300_000) {
    return _jwtToken;
  }

  const lmnUser = await getSettings().get('lmn_api_user');
  const lmnPass = await getSettings().get('lmn_api_password');

  if (!lmnUser || !lmnPass) {
    throw new Error(
      'lmn_api_user und lmn_api_password muessen in den Settings gesetzt werden.'
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  const basicAuth = Buffer.from(`${lmnUser}:${lmnPass}`).toString('base64');
  const response = await fetch(`${baseUrl}/v1/auth/`, {
    headers: { 'Authorization': `Basic ${basicAuth}` },
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`JWT login failed (${response.status}): ${body}`);
  }

  const raw = await response.text();
  _jwtToken = raw.replace(/^"|"$/g, '');
  _jwtExpiry = Date.now() + 3600 * 1000;

  return _jwtToken;
}

/**
 * Make an authenticated request to the LMN API with retries
 * @param {string} path - API path (without base URL, e.g., '/changes')
 * @param {object} options - fetch options
 * @returns {Promise<Response>}
 */
async function request(path, options = {}) {
  const lmnApiUrl = await getSettings().get('lmn_api_url');
  let token = await _getJwtToken(lmnApiUrl);

  const url = `${lmnApiUrl}/v1/linbo${path}`;
  const authHeader = { 'X-API-Key': token };
  const headers = {
    ...authHeader,
    'Accept': 'application/json',
    ...options.headers,
  };

  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      // On 401, clear token cache and retry once
      if (response.status === 401 && attempt === 0) {
        _jwtToken = null;
        _jwtExpiry = 0;
        token = await _getJwtToken(lmnApiUrl);
        headers['X-API-Key'] = token;
        continue;
      }

      // Don't retry on client errors (4xx) except 429
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return response;
      }

      // Retry on 429 and 5xx
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
        if (attempt < MAX_RETRIES - 1) {
          const delay = BASE_DELAY * Math.pow(2, attempt);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        return response;
      }

      return response;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Get changes since cursor (delta feed)
 * @param {string} cursor - Cursor from previous sync, or '' for full snapshot
 * @returns {Promise<{nextCursor, hostsChanged, startConfsChanged, configsChanged, dhcpChanged, deletedHosts, deletedStartConfs}>}
 */
async function getChanges(cursor = '', school = '') {
  const params = new URLSearchParams();
  params.set('since', cursor);
  if (school) params.set('school', school);
  const response = await request(`/changes?${params.toString()}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`getChanges failed (${response.status}): ${body}`);
  }
  return response.json();
}

/**
 * Maximum MACs per batch call — Authority API enforces a hard 500-MAC limit.
 */
const BATCH_SIZE = 500;

/**
 * Batch fetch host records by MAC address.
 * Chunks >500 MACs into sequential <=500-element API calls and merges results.
 * Treats HTTP 404 (no hosts matched) as empty batch, not as error.
 * @param {string[]} macs - Array of MAC addresses
 * @returns {Promise<{hosts: HostRecord[]}>}
 */
async function batchGetHosts(macs, school = '') {
  if (macs.length === 0) return { hosts: [] };
  const qs = school ? `?school=${encodeURIComponent(school)}` : '';

  const allHosts = [];
  for (let i = 0; i < macs.length; i += BATCH_SIZE) {
    const chunk = macs.slice(i, i + BATCH_SIZE);
    const response = await request(`/hosts:batch${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ macs: chunk }),
    });
    if (response.status === 404) {
      // No hosts matched in this chunk — normal for deleted hosts
      continue;
    }
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`batchGetHosts failed (${response.status}): ${body}`);
    }
    const data = await response.json();
    allHosts.push(...data.hosts);
  }
  return { hosts: allHosts };
}

/**
 * Batch fetch start.conf content by ID
 * @param {string[]} ids - Array of start.conf IDs (hostgroup names)
 * @returns {Promise<{startConfs: StartConfRecord[]}>}
 */
async function batchGetStartConfs(ids, school = '') {
  const qs = school ? `?school=${encodeURIComponent(school)}` : '';
  const response = await request(`/startconfs:batch${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`batchGetStartConfs failed (${response.status}): ${body}`);
  }
  return response.json();
}

/**
 * Batch fetch parsed config records by ID
 * @param {string[]} ids - Array of config IDs
 * @returns {Promise<{configs: ConfigRecord[]}>}
 */
async function batchGetConfigs(ids, school = '') {
  const qs = school ? `?school=${encodeURIComponent(school)}` : '';
  const response = await request(`/configs:batch${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`batchGetConfigs failed (${response.status}): ${body}`);
  }
  return response.json();
}

/**
 * Get DHCP dnsmasq-proxy export with ETag support
 * @param {string|null} etag - Previous ETag for conditional GET
 * @returns {Promise<{status: number, content: string|null, etag: string|null}>}
 */
async function getDhcpExport(etag = null) {
  const headers = { 'Accept': 'text/plain' };
  if (etag) {
    headers['If-None-Match'] = etag;
  }

  const response = await request('/dhcp/export/dnsmasq-proxy', { headers });

  if (response.status === 304) {
    return { status: 304, content: null, etag };
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`getDhcpExport failed (${response.status}): ${body}`);
  }

  const content = await response.text();
  const newEtag = response.headers.get('etag') || null;

  return { status: 200, content, etag: newEtag };
}

/**
 * Get ISC DHCP config for a school from the Authority API.
 * @param {string} school - School name (default: 'default-school')
 * @returns {Promise<{school: string, subnets: string, devices: string, subnetsUpdatedAt: string, devicesUpdatedAt: string}>}
 */
async function getIscDhcpConfig(school = 'default-school') {
  const qs = school ? `?school=${encodeURIComponent(school)}` : '';
  const response = await request(`/dhcp/export/isc-dhcp${qs}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`getIscDhcpConfig failed (${response.status}): ${body}`);
  }
  return response.json();
}

/**
 * Fetch all GRUB configs for a school from the Authority API.
 * @param {string} school - School name (default: 'default-school')
 * @returns {Promise<{configs: Array<{id, filename, content, updatedAt}>, school: string, total: number}>}
 */
async function getGrubConfigs(school = 'default-school') {
  const qs = school ? `?school=${encodeURIComponent(school)}` : '';
  const response = await request(`/grub-configs${qs}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`getGrubConfigs failed (${response.status}): ${body}`);
  }
  return response.json();
}

/**
 * Check LMN API health
 * Health endpoint lives at the API root (/health), not under the versioned
 * path prefix, so we call it directly instead of going through request().
 * @returns {Promise<{healthy: boolean, status?: string, version?: string}>}
 */
async function checkHealth() {
  try {
    const lmnApiUrl = await getSettings().get('lmn_api_url');
    const token = await _getJwtToken(lmnApiUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(`${lmnApiUrl}/v1/linbo/health`, {
      headers: { 'X-API-Key': token, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { healthy: false };
    }
    const data = await response.json();
    return { healthy: data.status === 'ok', status: data.status, version: data.version };
  } catch {
    return { healthy: false };
  }
}

module.exports = {
  request,
  getChanges,
  batchGetHosts,
  batchGetStartConfs,
  batchGetConfigs,
  getDhcpExport,
  getIscDhcpConfig,
  getGrubConfigs,
  checkHealth,
};
