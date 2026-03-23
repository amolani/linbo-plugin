/**
 * Tests for src/lib/driver-shell.js
 *
 * Pure shell escaping logic — no mocking needed.
 */

'use strict';

const {
  shellEscapeExact,
  shellEscapeContains,
} = require('../../../src/lib/driver-shell');

// ---------------------------------------------------------------------------
// shellEscapeExact
// ---------------------------------------------------------------------------
describe('shellEscapeExact', () => {
  it('escapes backslash', () => {
    expect(shellEscapeExact('a\\b')).toBe('a\\\\b');
  });

  it('escapes asterisk', () => {
    expect(shellEscapeExact('foo*bar')).toBe('foo\\*bar');
  });

  it('escapes question mark', () => {
    expect(shellEscapeExact('file?.txt')).toBe('file\\?.txt');
  });

  it('escapes square brackets', () => {
    expect(shellEscapeExact('[abc]')).toBe('\\[abc\\]');
  });

  it('escapes all special chars in a single string', () => {
    expect(shellEscapeExact('\\*?[]')).toBe('\\\\\\*\\?\\[\\]');
  });

  it('preserves strings without special characters', () => {
    expect(shellEscapeExact('hello-world_123')).toBe('hello-world_123');
  });

  it('handles empty string', () => {
    expect(shellEscapeExact('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// shellEscapeContains
// ---------------------------------------------------------------------------
describe('shellEscapeContains', () => {
  it('wraps simple string with wildcards', () => {
    expect(shellEscapeContains('hello')).toBe('*hello*');
  });

  it('wraps and escapes special characters', () => {
    expect(shellEscapeContains('foo*bar')).toBe('*foo\\*bar*');
  });

  it('handles empty string (two wildcards)', () => {
    expect(shellEscapeContains('')).toBe('**');
  });
});
