'use strict';

const {
  createMagicPacket,
  isValidMac,
  normalizeMac,
} = require('../../../src/services/wol.service');

// =============================================================================
// createMagicPacket
// =============================================================================

describe('createMagicPacket', () => {
  it('returns a Buffer of exactly 102 bytes', () => {
    const pkt = createMagicPacket('AA:BB:CC:DD:EE:FF');
    expect(Buffer.isBuffer(pkt)).toBe(true);
    expect(pkt.length).toBe(102);
  });

  it('first 6 bytes are all 0xFF', () => {
    const pkt = createMagicPacket('AA:BB:CC:DD:EE:FF');
    for (let i = 0; i < 6; i++) {
      expect(pkt[i]).toBe(0xff);
    }
  });

  it('MAC is repeated 16 times starting at byte 6', () => {
    const pkt = createMagicPacket('AA:BB:CC:DD:EE:FF');
    const expectedMac = [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff];
    for (let rep = 0; rep < 16; rep++) {
      for (let b = 0; b < 6; b++) {
        expect(pkt[6 + rep * 6 + b]).toBe(expectedMac[b]);
      }
    }
  });

  it('accepts colon-separated MAC', () => {
    const pkt = createMagicPacket('11:22:33:44:55:66');
    expect(pkt.length).toBe(102);
    expect(pkt[6]).toBe(0x11);
    expect(pkt[11]).toBe(0x66);
  });

  it('accepts dash-separated MAC', () => {
    const pkt = createMagicPacket('11-22-33-44-55-66');
    expect(pkt.length).toBe(102);
    expect(pkt[6]).toBe(0x11);
    expect(pkt[11]).toBe(0x66);
  });

  it('throws on MAC that is too short', () => {
    expect(() => createMagicPacket('AA:BB:CC')).toThrow(/Invalid MAC/);
  });

  it('throws on MAC with non-hex characters', () => {
    expect(() => createMagicPacket('GG:HH:II:JJ:KK:LL')).toThrow(/Invalid MAC/);
  });

  it('throws on empty string', () => {
    expect(() => createMagicPacket('')).toThrow(/Invalid MAC/);
  });

  it('throws on null/undefined', () => {
    expect(() => createMagicPacket(null)).toThrow();
    expect(() => createMagicPacket(undefined)).toThrow();
  });
});

// =============================================================================
// isValidMac
// =============================================================================

describe('isValidMac', () => {
  it('returns true for colon-separated uppercase MAC', () => {
    expect(isValidMac('AA:BB:CC:DD:EE:FF')).toBe(true);
  });

  it('returns true for dash-separated lowercase MAC', () => {
    expect(isValidMac('aa-bb-cc-dd-ee-ff')).toBe(true);
  });

  it('returns false for MAC without separators', () => {
    expect(isValidMac('AABBCCDDEEFF')).toBe(false);
  });

  it('returns false for non-hex characters', () => {
    expect(isValidMac('GG:HH:II:JJ:KK:LL')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isValidMac(null)).toBe(false);
  });
});

// =============================================================================
// normalizeMac
// =============================================================================

describe('normalizeMac', () => {
  it('converts colon-separated uppercase to lowercase colons', () => {
    expect(normalizeMac('AA:BB:CC:DD:EE:FF')).toBe('aa:bb:cc:dd:ee:ff');
  });

  it('converts dash-separated uppercase to lowercase colons', () => {
    expect(normalizeMac('AA-BB-CC-DD-EE-FF')).toBe('aa:bb:cc:dd:ee:ff');
  });

  it('leaves already-lowercase colon-separated unchanged', () => {
    expect(normalizeMac('aa:bb:cc:dd:ee:ff')).toBe('aa:bb:cc:dd:ee:ff');
  });
});
