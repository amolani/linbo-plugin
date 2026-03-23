'use strict';

const {
  requestId,
  createAuditLog,
  getClientIp,
  queryAuditLogs,
  getAuditLog,
  restoreAuditLog,
  auditAction,
  auditWrites,
} = require('../../../src/middleware/audit');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockReq = (overrides = {}) => ({
  method: 'GET',
  path: '/',
  headers: {},
  params: {},
  body: {},
  ...overrides,
});

const mockRes = () => {
  const res = { statusCode: 200 };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn();
  return res;
};

// ---------------------------------------------------------------------------
// Reset audit log between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  restoreAuditLog([]);
});

// ---------------------------------------------------------------------------
// requestId
// ---------------------------------------------------------------------------

describe('requestId()', () => {
  test('generates a UUID when no X-Request-ID header present', () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    requestId(req, res, next);

    expect(req.requestId).toBeDefined();
    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(next).toHaveBeenCalled();
  });

  test('uses existing X-Request-ID header if present', () => {
    const req = mockReq({ headers: { 'x-request-id': 'custom-id-123' } });
    const res = mockRes();
    const next = jest.fn();

    requestId(req, res, next);

    expect(req.requestId).toBe('custom-id-123');
  });

  test('sets X-Request-ID response header', () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    requestId(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', req.requestId);
  });
});

// ---------------------------------------------------------------------------
// createAuditLog
// ---------------------------------------------------------------------------

describe('createAuditLog()', () => {
  test('adds an entry to the audit log', async () => {
    await createAuditLog({ action: 'host.create', actor: 'admin' });

    const log = getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      action: 'host.create',
      actor: 'admin',
      status: 'success',
    });
    expect(log[0].id).toBeDefined();
    expect(log[0].timestamp).toBeDefined();
  });

  test('ignores null entry', async () => {
    await createAuditLog(null);
    expect(getAuditLog()).toHaveLength(0);
  });

  test('ignores entry without action', async () => {
    await createAuditLog({ actor: 'admin' });
    expect(getAuditLog()).toHaveLength(0);
  });

  test('ring buffer caps at 1000 entries', async () => {
    // Seed with 1000 entries
    const entries = Array.from({ length: 1000 }, (_, i) => ({
      id: `id-${i}`,
      action: `action-${i}`,
      timestamp: new Date().toISOString(),
      actor: 'system',
    }));
    restoreAuditLog(entries);
    expect(getAuditLog()).toHaveLength(1000);

    // Adding one more should trim the oldest
    await createAuditLog({ action: 'overflow' });

    const log = getAuditLog();
    expect(log).toHaveLength(1000);
    expect(log[log.length - 1].action).toBe('overflow');
  });
});

// ---------------------------------------------------------------------------
// getClientIp
// ---------------------------------------------------------------------------

describe('getClientIp()', () => {
  test('extracts first IP from x-forwarded-for (comma-separated)', () => {
    const req = mockReq({ headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' } });
    expect(getClientIp(req)).toBe('10.0.0.1');
  });

  test('trims whitespace from x-forwarded-for', () => {
    const req = mockReq({ headers: { 'x-forwarded-for': '  10.0.0.1  ' } });
    expect(getClientIp(req)).toBe('10.0.0.1');
  });

  test('falls back to x-real-ip', () => {
    const req = mockReq({ headers: { 'x-real-ip': '10.0.0.5' } });
    expect(getClientIp(req)).toBe('10.0.0.5');
  });

  test('falls back to socket.remoteAddress', () => {
    const req = mockReq({ socket: { remoteAddress: '127.0.0.1' } });
    expect(getClientIp(req)).toBe('127.0.0.1');
  });

  test('returns null when no IP source available', () => {
    const req = mockReq();
    expect(getClientIp(req)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// queryAuditLogs
// ---------------------------------------------------------------------------

describe('queryAuditLogs()', () => {
  beforeEach(async () => {
    await createAuditLog({ action: 'host.create', actor: 'admin' });
    await createAuditLog({ action: 'host.update', actor: 'admin' });
    await createAuditLog({ action: 'config.create', actor: 'operator' });
  });

  test('returns entries newest first', async () => {
    const { data } = await queryAuditLogs();
    expect(data[0].action).toBe('config.create');
    expect(data[2].action).toBe('host.create');
  });

  test('returns correct pagination', async () => {
    const { pagination } = await queryAuditLogs({ page: 1, limit: 2 });
    expect(pagination).toMatchObject({ page: 1, limit: 2, total: 3, pages: 2 });
  });

  test('filters by action prefix', async () => {
    const { data } = await queryAuditLogs({ action: 'host' });
    expect(data).toHaveLength(2);
    expect(data.every(e => e.action.startsWith('host'))).toBe(true);
  });

  test('filters by actor', async () => {
    const { data } = await queryAuditLogs({ actor: 'operator' });
    expect(data).toHaveLength(1);
    expect(data[0].actor).toBe('operator');
  });
});

// ---------------------------------------------------------------------------
// getAuditLog
// ---------------------------------------------------------------------------

describe('getAuditLog()', () => {
  test('returns the raw array reference', () => {
    const log = getAuditLog();
    expect(Array.isArray(log)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// restoreAuditLog
// ---------------------------------------------------------------------------

describe('restoreAuditLog()', () => {
  test('restores entries from an array', () => {
    const entries = [
      { id: '1', action: 'test', timestamp: new Date().toISOString(), actor: 'admin' },
      { id: '2', action: 'test2', timestamp: new Date().toISOString(), actor: 'admin' },
    ];
    restoreAuditLog(entries);
    expect(getAuditLog()).toHaveLength(2);
  });

  test('caps restored entries at MAX_AUDIT_ENTRIES (1000)', () => {
    const entries = Array.from({ length: 1200 }, (_, i) => ({
      id: `id-${i}`,
      action: `action-${i}`,
      timestamp: new Date().toISOString(),
      actor: 'system',
    }));
    restoreAuditLog(entries);
    expect(getAuditLog()).toHaveLength(1000);
  });
});

// ---------------------------------------------------------------------------
// auditWrites
// ---------------------------------------------------------------------------

describe('auditWrites()', () => {
  test('skips GET requests and calls next directly', () => {
    const req = mockReq({ method: 'GET', path: '/api/hosts' });
    const res = mockRes();
    const next = jest.fn();

    auditWrites(req, res, next);

    expect(next).toHaveBeenCalled();
    // res.json should not be overridden for GET
    expect(res.json).not.toHaveBeenCalled();
  });

  test('processes POST requests (intercepts res.json)', async () => {
    const req = mockReq({
      method: 'POST',
      path: '/api/hosts',
      params: {},
      user: { username: 'admin' },
    });
    const res = mockRes();
    const next = jest.fn();

    await auditWrites(req, res, next);

    expect(next).toHaveBeenCalled();
    // res.json should now be overridden (wrapped by auditAction)
    // Calling the wrapped json should create an audit entry
    await res.json({ data: { id: 'new-id', hostname: 'pc01' } });

    const log = getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].action).toContain('create');
  });
});
