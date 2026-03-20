/**
 * LINBO Docker - Driver Shell Escaping Tests
 */

const { shellEscapeExact, shellEscapeContains } = require('../../src/lib/driver-shell');

describe('driver-shell', () => {
  describe('shellEscapeExact()', () => {
    test('leaves normal text unchanged', () => {
      expect(shellEscapeExact('normal text')).toBe('normal text');
      expect(shellEscapeExact('Dell Inc.')).toBe('Dell Inc.');
    });

    test('escapes backslash', () => {
      expect(shellEscapeExact('back\\slash')).toBe('back\\\\slash');
    });

    test('escapes asterisk', () => {
      expect(shellEscapeExact('Model 400*G7')).toBe('Model 400\\*G7');
    });

    test('escapes question mark', () => {
      expect(shellEscapeExact('test?')).toBe('test\\?');
    });

    test('escapes square brackets', () => {
      expect(shellEscapeExact('HP [S/N:123]')).toBe('HP \\[S/N:123\\]');
    });

    test('escapes multiple pattern characters', () => {
      expect(shellEscapeExact('a*b?c[d]e\\f')).toBe('a\\*b\\?c\\[d\\]e\\\\f');
    });

    test('handles empty string', () => {
      expect(shellEscapeExact('')).toBe('');
    });
  });

  describe('shellEscapeContains()', () => {
    test('wraps with wildcards', () => {
      expect(shellEscapeContains('ThinkCentre')).toBe('*ThinkCentre*');
    });

    test('escapes inner characters and wraps', () => {
      expect(shellEscapeContains('Model [v2]')).toBe('*Model \\[v2\\]*');
    });

    test('handles empty string', () => {
      expect(shellEscapeContains('')).toBe('**');
    });
  });
});
