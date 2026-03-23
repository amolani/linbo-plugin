/**
 * Tests for src/lib/startconf-rewrite.js
 *
 * Pure rewriting logic — no mocking needed.
 */

'use strict';

const { rewriteServerField } = require('../../../src/lib/startconf-rewrite');

describe('rewriteServerField', () => {
  // ---- Null / falsy inputs ------------------------------------------------
  describe('null and falsy inputs', () => {
    it('returns content unchanged when newServerIp is null', () => {
      const content = '[LINBO]\nServer = 10.0.0.1\n';
      expect(rewriteServerField(content, null)).toBe(content);
    });

    it('returns content unchanged when newServerIp is empty string', () => {
      const content = '[LINBO]\nServer = 10.0.0.1\n';
      expect(rewriteServerField(content, '')).toBe(content);
    });

    it('returns content unchanged when content is null', () => {
      expect(rewriteServerField(null, '10.0.0.2')).toBeNull();
    });

    it('returns content unchanged when content is empty string', () => {
      expect(rewriteServerField('', '10.0.0.2')).toBe('');
    });
  });

  // ---- Basic Server = rewrite in [LINBO] ----------------------------------
  describe('Server field rewrite in [LINBO] section', () => {
    it('replaces Server = X.X.X.X in [LINBO] section', () => {
      const content = '[LINBO]\nServer = 10.0.0.1\nGroup = focal\n';
      const result = rewriteServerField(content, '10.0.0.99');
      expect(result).toContain('Server = 10.0.0.99');
      expect(result).toContain('Group = focal');
    });

    it('handles case-insensitive Server key', () => {
      const content = '[LINBO]\nserver = 10.0.0.1\n';
      const result = rewriteServerField(content, '192.168.1.1');
      expect(result).toContain('server = 192.168.1.1');
    });

    it('handles case-insensitive [LINBO] header', () => {
      const content = '[linbo]\nServer = 10.0.0.1\n';
      const result = rewriteServerField(content, '10.0.0.5');
      expect(result).toContain('Server = 10.0.0.5');
    });
  });

  // ---- KernelOptions server= rewrite --------------------------------------
  describe('KernelOptions server= rewrite in [LINBO] section', () => {
    it('replaces server=X.X.X.X in KernelOptions line', () => {
      const content = '[LINBO]\nKernelOptions = quiet server=10.0.0.1 dhcpretry=5\n';
      const result = rewriteServerField(content, '10.0.0.50');
      expect(result).toContain('server=10.0.0.50');
      expect(result).toContain('dhcpretry=5');
    });

    it('replaces multiple server= occurrences in a single KernelOptions line', () => {
      const content = '[LINBO]\nKernelOptions = server=10.0.0.1 foo server=10.0.0.1\n';
      const result = rewriteServerField(content, '10.0.0.99');
      const matches = result.match(/server=10\.0\.0\.99/g);
      expect(matches).toHaveLength(2);
    });
  });

  // ---- Does NOT touch other sections --------------------------------------
  describe('leaves other sections untouched', () => {
    it('does not rewrite Server in [OS] section', () => {
      const content = [
        '[LINBO]',
        'Server = 10.0.0.1',
        '[OS]',
        'Server = 10.0.0.1',
        '',
      ].join('\n');
      const result = rewriteServerField(content, '10.0.0.99');
      const lines = result.split('\n');
      // [LINBO] Server should be rewritten
      expect(lines[1]).toContain('10.0.0.99');
      // [OS] Server should remain unchanged
      expect(lines[3]).toContain('10.0.0.1');
    });

    it('does not rewrite Server in [Partition] section', () => {
      const content = [
        '[LINBO]',
        'Server = 10.0.0.1',
        '[Partition]',
        'Server = 10.0.0.1',
        '',
      ].join('\n');
      const result = rewriteServerField(content, '10.0.0.99');
      const lines = result.split('\n');
      expect(lines[1]).toContain('10.0.0.99');
      expect(lines[3]).toContain('10.0.0.1');
    });
  });

  // ---- No [LINBO] section present -----------------------------------------
  describe('no [LINBO] section', () => {
    it('returns content unchanged when there is no [LINBO] section', () => {
      const content = '[OS]\nServer = 10.0.0.1\nName = Ubuntu\n';
      const result = rewriteServerField(content, '10.0.0.99');
      expect(result).toBe(content);
    });
  });
});
