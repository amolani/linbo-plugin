'use strict';

const {
  loginSchema,
  macAddressSchema,
  ipAddressSchema,
  paginationSchema,
  createHostSchema,
  createImageSchema,
  createOperationSchema,
  sendCommandSchema,
  dhcpExportQuerySchema,
  validateBody,
  validateQuery,
  validateParams,
} = require('../../../src/middleware/validate');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockReq = (overrides = {}) => ({ body: {}, query: {}, params: {}, ...overrides });
const mockRes = () => {
  const res = { statusCode: 200 };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn(() => res);
  return res;
};

// ---------------------------------------------------------------------------
// loginSchema
// ---------------------------------------------------------------------------

describe('loginSchema', () => {
  test('accepts valid credentials', () => {
    const result = loginSchema.safeParse({ username: 'admin', password: 'secret' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ username: 'admin', password: 'secret' });
  });

  test('rejects empty username', () => {
    const result = loginSchema.safeParse({ username: '', password: 'secret' });
    expect(result.success).toBe(false);
  });

  test('rejects empty password', () => {
    const result = loginSchema.safeParse({ username: 'admin', password: '' });
    expect(result.success).toBe(false);
  });

  test('rejects username longer than 255 characters', () => {
    const result = loginSchema.safeParse({ username: 'a'.repeat(256), password: 'secret' });
    expect(result.success).toBe(false);
  });

  test('rejects password longer than 256 characters', () => {
    const result = loginSchema.safeParse({ username: 'admin', password: 'p'.repeat(257) });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// macAddressSchema
// ---------------------------------------------------------------------------

describe('macAddressSchema', () => {
  test('accepts valid MAC with colons', () => {
    expect(macAddressSchema.parse('AA:BB:CC:DD:EE:FF')).toBe('AA:BB:CC:DD:EE:FF');
  });

  test('accepts valid MAC with dashes', () => {
    expect(macAddressSchema.parse('AA-BB-CC-DD-EE-FF')).toBe('AA-BB-CC-DD-EE-FF');
  });

  test('accepts lowercase hex', () => {
    expect(macAddressSchema.parse('aa:bb:cc:dd:ee:ff')).toBe('aa:bb:cc:dd:ee:ff');
  });

  test('accepts mixed case', () => {
    expect(macAddressSchema.parse('aA:Bb:cC:Dd:eE:fF')).toBe('aA:Bb:cC:Dd:eE:fF');
  });

  test('rejects MAC without separators', () => {
    const result = macAddressSchema.safeParse('AABBCCDDEEFF');
    expect(result.success).toBe(false);
  });

  test('rejects invalid hex characters', () => {
    const result = macAddressSchema.safeParse('GG:HH:II:JJ:KK:LL');
    expect(result.success).toBe(false);
  });

  test('rejects too-short MAC', () => {
    const result = macAddressSchema.safeParse('AA:BB:CC:DD:EE');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ipAddressSchema
// ---------------------------------------------------------------------------

describe('ipAddressSchema', () => {
  test('accepts valid IPv4 address', () => {
    expect(ipAddressSchema.parse('192.168.1.1')).toBe('192.168.1.1');
  });

  test('accepts 0.0.0.0', () => {
    expect(ipAddressSchema.parse('0.0.0.0')).toBe('0.0.0.0');
  });

  test('accepts 255.255.255.255', () => {
    expect(ipAddressSchema.parse('255.255.255.255')).toBe('255.255.255.255');
  });

  test('rejects octet > 255', () => {
    const result = ipAddressSchema.safeParse('999.0.0.1');
    expect(result.success).toBe(false);
  });

  test('rejects incomplete address', () => {
    const result = ipAddressSchema.safeParse('192.168.1');
    expect(result.success).toBe(false);
  });

  test('rejects letters in address', () => {
    const result = ipAddressSchema.safeParse('abc.def.ghi.jkl');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// paginationSchema
// ---------------------------------------------------------------------------

describe('paginationSchema', () => {
  test('applies defaults when empty object given', () => {
    const result = paginationSchema.parse({});
    expect(result).toEqual({ page: 1, limit: 50, sortOrder: 'asc' });
  });

  test('coerces string numbers to integers', () => {
    const result = paginationSchema.parse({ page: '3', limit: '25' });
    expect(result.page).toBe(3);
    expect(result.limit).toBe(25);
  });

  test('rejects limit greater than 100', () => {
    const result = paginationSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  test('accepts sortOrder desc', () => {
    const result = paginationSchema.parse({ sortOrder: 'desc' });
    expect(result.sortOrder).toBe('desc');
  });

  test('rejects invalid sortOrder', () => {
    const result = paginationSchema.safeParse({ sortOrder: 'random' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createHostSchema
// ---------------------------------------------------------------------------

describe('createHostSchema', () => {
  const validHost = {
    hostname: 'pc01',
    macAddress: 'AA:BB:CC:DD:EE:FF',
  };

  test('accepts valid host with minimal fields', () => {
    const result = createHostSchema.parse(validHost);
    expect(result.hostname).toBe('pc01');
    expect(result.macAddress).toBe('AA:BB:CC:DD:EE:FF');
    expect(result.status).toBe('offline');
  });

  test('rejects hostname longer than 15 characters', () => {
    const result = createHostSchema.safeParse({
      ...validHost,
      hostname: 'a'.repeat(16),
    });
    expect(result.success).toBe(false);
  });

  test('rejects hostname starting with a dash', () => {
    const result = createHostSchema.safeParse({
      ...validHost,
      hostname: '-invalid',
    });
    expect(result.success).toBe(false);
  });

  test('accepts hostname with dashes in the middle', () => {
    const result = createHostSchema.parse({ ...validHost, hostname: 'pc-lab-01' });
    expect(result.hostname).toBe('pc-lab-01');
  });

  test('accepts optional ipAddress', () => {
    const result = createHostSchema.parse({ ...validHost, ipAddress: '10.0.0.5' });
    expect(result.ipAddress).toBe('10.0.0.5');
  });
});

// ---------------------------------------------------------------------------
// createImageSchema
// ---------------------------------------------------------------------------

describe('createImageSchema', () => {
  test('accepts valid base image', () => {
    const result = createImageSchema.parse({
      filename: 'ubuntu.qcow2',
      type: 'base',
    });
    expect(result.filename).toBe('ubuntu.qcow2');
    expect(result.type).toBe('base');
    expect(result.status).toBe('available');
  });

  test('accepts differential type', () => {
    const result = createImageSchema.parse({ filename: 'diff.img', type: 'differential' });
    expect(result.type).toBe('differential');
  });

  test('accepts torrent type', () => {
    const result = createImageSchema.parse({ filename: 'img.torrent', type: 'torrent' });
    expect(result.type).toBe('torrent');
  });

  test('rejects invalid type', () => {
    const result = createImageSchema.safeParse({ filename: 'img.qcow2', type: 'snapshot' });
    expect(result.success).toBe(false);
  });

  test('rejects empty filename', () => {
    const result = createImageSchema.safeParse({ filename: '', type: 'base' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createOperationSchema
// ---------------------------------------------------------------------------

describe('createOperationSchema', () => {
  const validUUID = '550e8400-e29b-41d4-a716-446655440000';

  test('accepts valid operation', () => {
    const result = createOperationSchema.parse({
      targetHosts: [validUUID],
      commands: ['sync'],
    });
    expect(result.targetHosts).toHaveLength(1);
    expect(result.commands).toEqual(['sync']);
  });

  test('rejects empty targetHosts array', () => {
    const result = createOperationSchema.safeParse({
      targetHosts: [],
      commands: ['sync'],
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty commands array', () => {
    const result = createOperationSchema.safeParse({
      targetHosts: [validUUID],
      commands: [],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sendCommandSchema
// ---------------------------------------------------------------------------

describe('sendCommandSchema', () => {
  const validUUID = '550e8400-e29b-41d4-a716-446655440000';

  test('accepts valid sync command', () => {
    const result = sendCommandSchema.parse({
      targetHosts: [validUUID],
      command: 'sync',
    });
    expect(result.command).toBe('sync');
    expect(result.forceNew).toBe(false);
  });

  test.each(['sync', 'start', 'reboot', 'shutdown', 'wake'])('accepts command %s', (cmd) => {
    const result = sendCommandSchema.safeParse({
      targetHosts: [validUUID],
      command: cmd,
    });
    expect(result.success).toBe(true);
  });

  test('rejects unknown command', () => {
    const result = sendCommandSchema.safeParse({
      targetHosts: [validUUID],
      command: 'format',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dhcpExportQuerySchema
// ---------------------------------------------------------------------------

describe('dhcpExportQuerySchema', () => {
  test('applies defaults when empty', () => {
    const result = dhcpExportQuerySchema.parse({});
    expect(result.pxeOnly).toBe(false);
    expect(result.includeHeader).toBe(true);
  });

  test('pxeOnly "true" string becomes boolean true', () => {
    const result = dhcpExportQuerySchema.parse({ pxeOnly: 'true' });
    expect(result.pxeOnly).toBe(true);
  });

  test('pxeOnly "false" string becomes boolean false', () => {
    const result = dhcpExportQuerySchema.parse({ pxeOnly: 'false' });
    expect(result.pxeOnly).toBe(false);
  });

  test('includeHeader "false" string becomes boolean false', () => {
    const result = dhcpExportQuerySchema.parse({ includeHeader: 'false' });
    expect(result.includeHeader).toBe(false);
  });

  test('includeHeader "true" string stays boolean true', () => {
    const result = dhcpExportQuerySchema.parse({ includeHeader: 'true' });
    expect(result.includeHeader).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateBody middleware
// ---------------------------------------------------------------------------

describe('validateBody()', () => {
  test('parses valid body, replaces req.body, and calls next', () => {
    const middleware = validateBody(loginSchema);
    const req = mockReq({ body: { username: 'admin', password: 'secret' } });
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({ username: 'admin', password: 'secret' });
  });

  test('returns 400 VALIDATION_ERROR with details on invalid body', () => {
    const middleware = validateBody(loginSchema);
    const req = mockReq({ body: { username: '', password: '' } });
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: expect.arrayContaining([
            expect.objectContaining({ field: expect.any(String), message: expect.any(String) }),
          ]),
        }),
      })
    );
  });

  test('applies schema defaults to body', () => {
    const middleware = validateBody(paginationSchema);
    const req = mockReq({ body: {} });
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.page).toBe(1);
    expect(req.body.limit).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// validateQuery middleware
// ---------------------------------------------------------------------------

describe('validateQuery()', () => {
  test('parses valid query and calls next', () => {
    const middleware = validateQuery(paginationSchema);
    const req = mockReq({ query: { page: '2', limit: '10' } });
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.query.page).toBe(2);
    expect(req.query.limit).toBe(10);
  });

  test('returns 400 on invalid query', () => {
    const middleware = validateQuery(paginationSchema);
    const req = mockReq({ query: { limit: '999' } });
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message: 'Query validation failed',
        }),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// validateParams middleware
// ---------------------------------------------------------------------------

describe('validateParams()', () => {
  const { z } = require('zod');
  const idParamSchema = z.object({ id: z.string().uuid() });

  test('parses valid params and calls next', () => {
    const middleware = validateParams(idParamSchema);
    const req = mockReq({ params: { id: '550e8400-e29b-41d4-a716-446655440000' } });
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.params.id).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  test('returns 400 on invalid params', () => {
    const middleware = validateParams(idParamSchema);
    const req = mockReq({ params: { id: 'not-a-uuid' } });
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message: 'Parameter validation failed',
        }),
      })
    );
  });
});
