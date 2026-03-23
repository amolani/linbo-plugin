/**
 * Tests for src/lib/startconf-parser.js
 *
 * Pure parsing logic — no mocking needed.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { parseStartConf } = require('../../../src/lib/startconf-parser');

const FIXTURE = fs.readFileSync(
  path.join(__dirname, '../../fixtures/startconf-sample.txt'),
  'utf8'
);

describe('parseStartConf', () => {
  // -------------------------------------------------------------------------
  // Happy path with full fixture
  // -------------------------------------------------------------------------
  describe('full start.conf fixture', () => {
    let result;

    beforeAll(() => {
      result = parseStartConf(FIXTURE);
    });

    it('returns an object with linbo, partitions, and os keys', () => {
      expect(result).toHaveProperty('linbo');
      expect(result).toHaveProperty('partitions');
      expect(result).toHaveProperty('os');
    });

    it('parses [LINBO] section keys (lowercase)', () => {
      expect(result.linbo.cache).toBe('/dev/sda3');
      expect(result.linbo.server).toBe('10.0.0.1');
      expect(result.linbo.group).toBe('focal');
      expect(result.linbo.roottimeout).toBe('600');
      expect(result.linbo.downloadtype).toBe('torrent');
    });

    it('preserves KernelOptions value including = signs', () => {
      expect(result.linbo.kerneloptions).toContain('server=10.0.0.1');
      expect(result.linbo.kerneloptions).toContain('dhcpretry=5');
    });

    it('parses three [Partition] sections', () => {
      expect(result.partitions).toHaveLength(3);
    });

    it('parses partition details correctly', () => {
      const [p1, p2, p3] = result.partitions;
      expect(p1.dev).toBe('/dev/sda1');
      expect(p1.label).toBe('ubuntu');
      expect(p1.fstype).toBe('ext4');
      expect(p2.label).toBe('swap');
      expect(p2.fstype).toBe('swap');
      expect(p3.label).toBe('cache');
    });

    it('parses one [OS] section', () => {
      expect(result.os).toHaveLength(1);
    });

    it('parses OS details correctly', () => {
      const os = result.os[0];
      expect(os.name).toBe('Ubuntu 22.04');
      expect(os.baseimage).toBe('ubuntu22.qcow2');
      expect(os.boot).toBe('/dev/sda1');
      expect(os.root).toBe('/dev/sda1');
      expect(os.startenabled).toBe('yes');
      expect(os.syncenabled).toBe('yes');
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe('edge cases', () => {
    it('returns empty structure for null input', () => {
      const result = parseStartConf(null);
      expect(result).toEqual({ linbo: {}, partitions: [], os: [] });
    });

    it('returns empty structure for undefined input', () => {
      const result = parseStartConf(undefined);
      expect(result).toEqual({ linbo: {}, partitions: [], os: [] });
    });

    it('returns empty structure for empty string', () => {
      const result = parseStartConf('');
      expect(result).toEqual({ linbo: {}, partitions: [], os: [] });
    });

    it('ignores comment lines', () => {
      const input = '# This is a comment\n[LINBO]\nServer = 10.0.0.1\n# Another comment\n';
      const result = parseStartConf(input);
      expect(result.linbo.server).toBe('10.0.0.1');
      expect(Object.keys(result.linbo)).toHaveLength(1);
    });

    it('ignores empty lines', () => {
      const input = '\n\n[LINBO]\n\nServer = 10.0.0.1\n\n';
      const result = parseStartConf(input);
      expect(result.linbo.server).toBe('10.0.0.1');
    });

    it('ignores lines before any section', () => {
      const input = 'OrphanKey = orphan_value\n[LINBO]\nServer = 10.0.0.1\n';
      const result = parseStartConf(input);
      expect(result.linbo.server).toBe('10.0.0.1');
      // orphan key should not appear anywhere
      expect(result.linbo).not.toHaveProperty('orphankey');
    });

    it('handles case-insensitive section headers', () => {
      const input = '[linbo]\nServer = 10.0.0.1\n[partition]\nDev = /dev/sda1\n[os]\nName = Test\n';
      const result = parseStartConf(input);
      expect(result.linbo.server).toBe('10.0.0.1');
      expect(result.partitions).toHaveLength(1);
      expect(result.os).toHaveLength(1);
    });

    it('handles multiple = in value (e.g. KernelOptions)', () => {
      const input = '[LINBO]\nKernelOptions = quiet server=10.0.0.1 foo=bar\n';
      const result = parseStartConf(input);
      expect(result.linbo.kerneloptions).toBe('quiet server=10.0.0.1 foo=bar');
    });

    it('trims whitespace around keys and values', () => {
      const input = '[LINBO]\n  Server  =  10.0.0.1  \n';
      const result = parseStartConf(input);
      expect(result.linbo.server).toBe('10.0.0.1');
    });

    it('lowercases all keys', () => {
      const input = '[LINBO]\nCamelCaseKey = value\nALLCAPS = value2\n';
      const result = parseStartConf(input);
      expect(result.linbo).toHaveProperty('camelcasekey');
      expect(result.linbo).toHaveProperty('allcaps');
    });

    it('handles only [LINBO] section without partitions or OS', () => {
      const input = '[LINBO]\nServer = 10.0.0.1\n';
      const result = parseStartConf(input);
      expect(result.linbo.server).toBe('10.0.0.1');
      expect(result.partitions).toEqual([]);
      expect(result.os).toEqual([]);
    });

    it('handles multiple OS entries', () => {
      const input = '[OS]\nName = Ubuntu\n[OS]\nName = Windows\n';
      const result = parseStartConf(input);
      expect(result.os).toHaveLength(2);
      expect(result.os[0].name).toBe('Ubuntu');
      expect(result.os[1].name).toBe('Windows');
    });

    it('handles lines without = inside a section (ignored)', () => {
      const input = '[LINBO]\nServer = 10.0.0.1\nThis line has no equals\nGroup = focal\n';
      const result = parseStartConf(input);
      expect(result.linbo.server).toBe('10.0.0.1');
      expect(result.linbo.group).toBe('focal');
      expect(Object.keys(result.linbo)).toHaveLength(2);
    });

    it('handles empty value after =', () => {
      const input = '[OS]\nVersion =\nName = Test\n';
      const result = parseStartConf(input);
      expect(result.os[0].version).toBe('');
      expect(result.os[0].name).toBe('Test');
    });
  });
});
