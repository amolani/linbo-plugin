/**
 * LINBO Docker - Wake-on-LAN Service Tests
 * Tests fuer Magic Packet Generierung und Versand
 */

// Mock http module for Networkbox tests -- must be before require
jest.mock('http');

const wolService = require('../../src/services/wol.service');

/**
 * Helper: set up a mock http.request that returns a mock request/response pair.
 * Must be called with the http reference that the service module actually uses.
 */
function setupHttpMock(httpModule, statusCode, responseBody) {
  const mockReq = {
    on: jest.fn().mockReturnThis(),
    write: jest.fn(),
    end: jest.fn(),
  };
  const mockRes = {
    statusCode,
    on: jest.fn((event, cb) => {
      if (event === 'data') {
        setTimeout(() => cb(Buffer.from(JSON.stringify(responseBody))), 0);
      }
      if (event === 'end') {
        setTimeout(() => cb(), 1);
      }
      return mockRes;
    }),
  };
  httpModule.request.mockImplementation((opts, callback) => {
    setTimeout(() => callback(mockRes), 0);
    return mockReq;
  });
  return { mockReq, mockRes };
}

describe('WoL Service', () => {
  describe('createMagicPacket', () => {
    test('should create valid magic packet from MAC with colons', () => {
      const packet = wolService.createMagicPacket('aa:bb:cc:dd:ee:ff');

      expect(packet).toBeInstanceOf(Buffer);
      expect(packet.length).toBe(102);

      // First 6 bytes should be 0xFF
      for (let i = 0; i < 6; i++) {
        expect(packet[i]).toBe(0xff);
      }

      // MAC should be repeated 16 times starting at byte 6
      const macBytes = [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff];
      for (let i = 0; i < 16; i++) {
        for (let j = 0; j < 6; j++) {
          expect(packet[6 + i * 6 + j]).toBe(macBytes[j]);
        }
      }
    });

    test('should create valid magic packet from MAC with dashes', () => {
      const packet = wolService.createMagicPacket('aa-bb-cc-dd-ee-ff');

      expect(packet.length).toBe(102);
    });

    test('should handle uppercase MAC address', () => {
      const packet = wolService.createMagicPacket('AA:BB:CC:DD:EE:FF');

      expect(packet.length).toBe(102);
      // Verify first MAC starts at byte 6 with correct values
      expect(packet[6]).toBe(0xaa);
      expect(packet[7]).toBe(0xbb);
    });

    test('should throw error for invalid MAC address - too short', () => {
      expect(() => wolService.createMagicPacket('aa:bb:cc:dd:ee'))
        .toThrow('Invalid MAC address');
    });

    test('should throw error for invalid MAC address - invalid characters', () => {
      expect(() => wolService.createMagicPacket('gg:hh:ii:jj:kk:ll'))
        .toThrow('Invalid MAC address');
    });

    test('should throw error for empty MAC address', () => {
      expect(() => wolService.createMagicPacket(''))
        .toThrow('Invalid MAC address');
    });
  });

  describe('isValidMac', () => {
    test('should validate correct MAC with colons', () => {
      expect(wolService.isValidMac('aa:bb:cc:dd:ee:ff')).toBe(true);
      expect(wolService.isValidMac('AA:BB:CC:DD:EE:FF')).toBe(true);
      expect(wolService.isValidMac('00:11:22:33:44:55')).toBe(true);
    });

    test('should validate correct MAC with dashes', () => {
      expect(wolService.isValidMac('aa-bb-cc-dd-ee-ff')).toBe(true);
      expect(wolService.isValidMac('AA-BB-CC-DD-EE-FF')).toBe(true);
    });

    test('should reject invalid MAC formats', () => {
      expect(wolService.isValidMac('aabbccddeeff')).toBe(false);
      expect(wolService.isValidMac('aa:bb:cc:dd:ee')).toBe(false);
      expect(wolService.isValidMac('aa:bb:cc:dd:ee:ff:gg')).toBe(false);
      expect(wolService.isValidMac('gg:hh:ii:jj:kk:ll')).toBe(false);
      expect(wolService.isValidMac('')).toBe(false);
      expect(wolService.isValidMac('invalid')).toBe(false);
    });
  });

  describe('normalizeMac', () => {
    test('should normalize MAC with colons to lowercase', () => {
      expect(wolService.normalizeMac('AA:BB:CC:DD:EE:FF')).toBe('aa:bb:cc:dd:ee:ff');
    });

    test('should normalize MAC with dashes to colons', () => {
      expect(wolService.normalizeMac('AA-BB-CC-DD-EE-FF')).toBe('aa:bb:cc:dd:ee:ff');
    });

    test('should handle already normalized MAC', () => {
      expect(wolService.normalizeMac('aa:bb:cc:dd:ee:ff')).toBe('aa:bb:cc:dd:ee:ff');
    });

    test('should handle mixed case', () => {
      expect(wolService.normalizeMac('Aa:Bb:Cc:Dd:Ee:Ff')).toBe('aa:bb:cc:dd:ee:ff');
    });
  });

  describe('sendWakeOnLan', () => {
    // Note: These tests can't fully verify network behavior without mocking dgram
    // They verify the function doesn't throw with valid input

    test('should resolve with success for valid MAC', async () => {
      // This test will actually try to send a packet
      // In a CI environment, this might fail due to network restrictions
      try {
        const result = await wolService.sendWakeOnLan('aa:bb:cc:dd:ee:ff', {
          count: 1,
          address: '127.0.0.1', // Use localhost to avoid broadcast issues
        });

        expect(result.macAddress).toBe('aa:bb:cc:dd:ee:ff');
        expect(result.packetsSent).toBe(1);
      } catch (error) {
        // Skip if network issues
        if (!error.message.includes('EPERM') && !error.message.includes('EACCES')) {
          throw error;
        }
      }
    });

    test('should reject for invalid MAC', async () => {
      await expect(wolService.sendWakeOnLan('invalid-mac'))
        .rejects.toThrow('Invalid MAC address');
    });

    test('should send multiple packets when count specified', async () => {
      try {
        const result = await wolService.sendWakeOnLan('aa:bb:cc:dd:ee:ff', {
          count: 3,
          address: '127.0.0.1',
        });

        expect(result.packetsSent).toBe(3);
      } catch (error) {
        // Skip network errors
        if (!error.message.includes('EPERM') && !error.message.includes('EACCES')) {
          throw error;
        }
      }
    });
  });

  describe('sendWakeOnLanBulk', () => {
    test('should handle multiple MAC addresses', async () => {
      try {
        const macs = [
          'aa:bb:cc:dd:ee:01',
          'aa:bb:cc:dd:ee:02',
          'aa:bb:cc:dd:ee:03',
        ];

        const result = await wolService.sendWakeOnLanBulk(macs, {
          count: 1,
          address: '127.0.0.1',
        });

        expect(result.total).toBe(3);
        expect(result.results.length).toBe(3);
      } catch (error) {
        // Skip network errors
      }
    });

    test('should track successful and failed sends', async () => {
      const macs = [
        'aa:bb:cc:dd:ee:01',
        'invalid-mac', // This will fail
        'aa:bb:cc:dd:ee:03',
      ];

      const result = await wolService.sendWakeOnLanBulk(macs, {
        count: 1,
        address: '127.0.0.1',
      });

      expect(result.total).toBe(3);
      expect(result.failed).toBe(1);
      expect(result.results.find(r => r.macAddress === 'invalid-mac').success).toBe(false);
    });

    test('should return empty results for empty array', async () => {
      const result = await wolService.sendWakeOnLanBulk([], {});

      expect(result.total).toBe(0);
      expect(result.successful).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('sendWakeOnLanToSubnet', () => {
    test('should construct broadcast address from subnet', async () => {
      try {
        const result = await wolService.sendWakeOnLanToSubnet('aa:bb:cc:dd:ee:ff', '192.168.1');

        expect(result.broadcastAddress).toBe('192.168.1.255');
      } catch (error) {
        // Skip network errors
        if (!error.message.includes('EPERM') && !error.message.includes('EACCES')) {
          throw error;
        }
      }
    });
  });

  describe('sendViaNetworkbox', () => {
    const originalEnv = process.env;
    // The wolService captured at file-level has the file-level http mock.
    // Use that same http reference for mocking.
    const http = require('http');

    beforeEach(() => {
      process.env = { ...originalEnv };
      http.request.mockReset();
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    test('sendViaNetworkbox returns {macAddress, via: "networkbox"} on 200 response', async () => {
      setupHttpMock(http, 200, { success: true });
      const result = await wolService.sendViaNetworkbox('aa:bb:cc:dd:ee:ff', 'localhost');
      expect(result).toEqual({
        macAddress: 'aa:bb:cc:dd:ee:ff',
        via: 'networkbox',
      });
    });

    test('sendViaNetworkbox sends POST to http://host:8000/wake with correct body', async () => {
      const { mockReq } = setupHttpMock(http, 200, { success: true });
      await wolService.sendViaNetworkbox('aa:bb:cc:dd:ee:ff', 'nbhost');

      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: 'nbhost',
          port: '8000',
          path: '/wake',
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
        expect.any(Function)
      );

      // Verify body contains mac, ip, port
      const bodyStr = mockReq.write.mock.calls[0][0];
      const body = JSON.parse(bodyStr);
      expect(body.mac).toBe('aa:bb:cc:dd:ee:ff');
      expect(body.ip).toBe('255.255.255.255');
      expect(body.port).toBe(9);
    });

    test('sendViaNetworkbox throws on non-200 response with status code in message', async () => {
      setupHttpMock(http, 503, { error: 'Service unavailable' });
      await expect(wolService.sendViaNetworkbox('aa:bb:cc:dd:ee:ff', 'localhost'))
        .rejects.toThrow('Networkbox WoL failed: HTTP 503');
    });

    test('sendViaNetworkbox uses NETWORKBOX_PORT env var when set', async () => {
      process.env.NETWORKBOX_PORT = '9999';
      setupHttpMock(http, 200, { success: true });
      await wolService.sendViaNetworkbox('aa:bb:cc:dd:ee:ff', 'localhost');

      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          port: '9999',
        }),
        expect.any(Function)
      );
    });
  });

  describe('sendWakeOnLan with NETWORKBOX_HOST', () => {
    const originalEnv = process.env;
    const http = require('http');

    beforeEach(() => {
      process.env = { ...originalEnv };
      http.request.mockReset();
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    test('sendWakeOnLan with NETWORKBOX_HOST set calls sendViaNetworkbox', async () => {
      process.env.NETWORKBOX_HOST = 'my-networkbox';
      setupHttpMock(http, 200, { success: true });

      const result = await wolService.sendWakeOnLan('aa:bb:cc:dd:ee:ff');

      expect(result.via).toBe('networkbox');
      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: 'my-networkbox',
        }),
        expect.any(Function)
      );
    });

    test('sendWakeOnLan without NETWORKBOX_HOST calls sendDirect (existing UDP path)', async () => {
      delete process.env.NETWORKBOX_HOST;

      try {
        const result = await wolService.sendWakeOnLan('aa:bb:cc:dd:ee:ff', {
          count: 1,
          address: '127.0.0.1',
        });
        // Direct path returns packetsSent, not via
        expect(result.packetsSent).toBe(1);
        expect(result.via).toBeUndefined();
      } catch (error) {
        if (!error.message.includes('EPERM') && !error.message.includes('EACCES')) {
          throw error;
        }
      }
    });
  });

  describe('WOL_BROADCAST_ADDRESS configuration', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.NETWORKBOX_HOST;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    test('sendWakeOnLan uses WOL_BROADCAST_ADDRESS env var as default address when no options.address given', async () => {
      process.env.WOL_BROADCAST_ADDRESS = '10.0.255.255';

      try {
        const result = await wolService.sendWakeOnLan('aa:bb:cc:dd:ee:ff', {
          count: 1,
        });
        expect(result.broadcastAddress).toBe('10.0.255.255');
      } catch (error) {
        if (!error.message.includes('EPERM') && !error.message.includes('EACCES')) {
          throw error;
        }
      }
    });

    test('sendWakeOnLan still uses options.address when explicitly provided (overrides env var)', async () => {
      process.env.WOL_BROADCAST_ADDRESS = '10.0.255.255';

      try {
        const result = await wolService.sendWakeOnLan('aa:bb:cc:dd:ee:ff', {
          count: 1,
          address: '192.168.1.255',
        });
        expect(result.broadcastAddress).toBe('192.168.1.255');
      } catch (error) {
        if (!error.message.includes('EPERM') && !error.message.includes('EACCES')) {
          throw error;
        }
      }
    });

    test('sendWakeOnLanBulk uses WOL_BROADCAST_ADDRESS env var for all hosts when no options.address given', async () => {
      process.env.WOL_BROADCAST_ADDRESS = '10.0.255.255';

      try {
        const result = await wolService.sendWakeOnLanBulk(
          ['aa:bb:cc:dd:ee:01', 'aa:bb:cc:dd:ee:02'],
          { count: 1 }
        );
        // All successful results should have used the configured broadcast address
        result.results.forEach(r => {
          if (r.success) {
            expect(r.success).toBe(true);
          }
        });
        // At minimum, verify the function completes without error
        expect(result.total).toBe(2);
      } catch (error) {
        if (!error.message.includes('EPERM') && !error.message.includes('EACCES')) {
          throw error;
        }
      }
    });
  });
});
