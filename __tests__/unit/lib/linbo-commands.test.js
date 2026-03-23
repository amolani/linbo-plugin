/**
 * Tests for src/lib/linbo-commands.js
 *
 * Pure command parsing logic — no mocking needed.
 */

'use strict';

const path = require('path');
const {
  parseCommands,
  validateCommandString,
  formatCommandsForWrapper,
  mapCommand,
  getOnbootCmdPath,
  KNOWN_COMMANDS,
  DOWNLOAD_TYPES,
  SPECIAL_FLAGS,
  FIRE_AND_FORGET,
} = require('../../../src/lib/linbo-commands');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe('constants', () => {
  it('exports KNOWN_COMMANDS as a non-empty array', () => {
    expect(Array.isArray(KNOWN_COMMANDS)).toBe(true);
    expect(KNOWN_COMMANDS.length).toBeGreaterThan(0);
  });

  it('KNOWN_COMMANDS contains essential commands', () => {
    const expected = [
      'label', 'partition', 'format', 'initcache', 'new', 'sync',
      'postsync', 'start', 'prestart', 'create_image', 'create_qdiff',
      'upload_image', 'upload_qdiff', 'reboot', 'halt', 'poweroff',
    ];
    expected.forEach(cmd => {
      expect(KNOWN_COMMANDS).toContain(cmd);
    });
  });

  it('exports DOWNLOAD_TYPES with multicast, rsync, torrent', () => {
    expect(DOWNLOAD_TYPES).toEqual(['multicast', 'rsync', 'torrent']);
  });

  it('exports SPECIAL_FLAGS with noauto and disablegui', () => {
    expect(SPECIAL_FLAGS).toEqual(['noauto', 'disablegui']);
  });

  it('exports FIRE_AND_FORGET with reboot, halt, poweroff', () => {
    expect(FIRE_AND_FORGET).toEqual(['reboot', 'halt', 'poweroff']);
  });
});

// ---------------------------------------------------------------------------
// parseCommands
// ---------------------------------------------------------------------------
describe('parseCommands', () => {
  // ---- Happy path: single commands --------------------------------------
  describe('single commands', () => {
    it('parses "sync:1" into a single command with OS number', () => {
      const result = parseCommands('sync:1');
      expect(result).toEqual([{ command: 'sync', params: [1] }]);
    });

    it('parses "start:2" with OS number 2', () => {
      const result = parseCommands('start:2');
      expect(result).toEqual([{ command: 'start', params: [2] }]);
    });

    it('parses "format:3" with partition number 3', () => {
      const result = parseCommands('format:3');
      expect(result).toEqual([{ command: 'format', params: [3] }]);
    });

    it('parses "initcache:torrent" with download type', () => {
      const result = parseCommands('initcache:torrent');
      expect(result).toEqual([{ command: 'initcache', params: ['torrent'] }]);
    });

    it('parses "initcache:multicast" with download type', () => {
      const result = parseCommands('initcache:multicast');
      expect(result).toEqual([{ command: 'initcache', params: ['multicast'] }]);
    });

    it('parses "reboot" without params', () => {
      const result = parseCommands('reboot');
      expect(result).toEqual([{ command: 'reboot', params: [] }]);
    });

    it('parses "poweroff" without params', () => {
      const result = parseCommands('poweroff');
      expect(result).toEqual([{ command: 'poweroff', params: [] }]);
    });

    it('parses "halt" without params', () => {
      const result = parseCommands('halt');
      expect(result).toEqual([{ command: 'halt', params: [] }]);
    });

    it('parses "partition" without params', () => {
      const result = parseCommands('partition');
      expect(result).toEqual([{ command: 'partition', params: [] }]);
    });

    it('parses "label" without params', () => {
      const result = parseCommands('label');
      expect(result).toEqual([{ command: 'label', params: [] }]);
    });
  });

  // ---- OS-number commands -----------------------------------------------
  describe('OS-number commands', () => {
    const osCommands = ['new', 'sync', 'postsync', 'start', 'prestart', 'upload_image', 'upload_qdiff'];

    osCommands.forEach(cmd => {
      it(`parses "${cmd}:1" with OS number 1`, () => {
        const result = parseCommands(`${cmd}:1`);
        expect(result).toEqual([{ command: cmd, params: [1] }]);
      });
    });
  });

  // ---- create_image / create_qdiff --------------------------------------
  describe('create_image and create_qdiff', () => {
    it('parses "create_image:1" with OS number only', () => {
      const result = parseCommands('create_image:1');
      expect(result).toEqual([{ command: 'create_image', params: [1] }]);
    });

    it('parses "create_image:2:my description" with OS number and description', () => {
      const result = parseCommands('create_image:2:my description');
      expect(result).toEqual([{ command: 'create_image', params: [2, 'my description'] }]);
    });

    it('parses "create_qdiff:1:snapshot note" with OS number and description', () => {
      const result = parseCommands('create_qdiff:1:snapshot note');
      expect(result).toEqual([{ command: 'create_qdiff', params: [1, 'snapshot note'] }]);
    });

    it('strips surrounding quotes from description', () => {
      const result = parseCommands('create_image:1:"quoted desc"');
      expect(result).toEqual([{ command: 'create_image', params: [1, 'quoted desc'] }]);
    });
  });

  // ---- Chained commands -------------------------------------------------
  describe('chained commands', () => {
    it('parses "sync:1,start:1" into two commands', () => {
      const result = parseCommands('sync:1,start:1');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ command: 'sync', params: [1] });
      expect(result[1]).toEqual({ command: 'start', params: [1] });
    });

    it('parses "partition,format:1,sync:1,start:1" into four commands', () => {
      const result = parseCommands('partition,format:1,sync:1,start:1');
      expect(result).toHaveLength(4);
      expect(result[0].command).toBe('partition');
      expect(result[1]).toEqual({ command: 'format', params: [1] });
      expect(result[2]).toEqual({ command: 'sync', params: [1] });
      expect(result[3]).toEqual({ command: 'start', params: [1] });
    });

    it('parses "initcache:rsync,sync:2,start:2"', () => {
      const result = parseCommands('initcache:rsync,sync:2,start:2');
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ command: 'initcache', params: ['rsync'] });
      expect(result[1]).toEqual({ command: 'sync', params: [2] });
      expect(result[2]).toEqual({ command: 'start', params: [2] });
    });
  });

  // ---- Special flags ----------------------------------------------------
  describe('special flags', () => {
    it('parses "noauto" as a flag with no params', () => {
      const result = parseCommands('noauto');
      expect(result).toEqual([{ command: 'noauto', params: [] }]);
    });

    it('parses "disablegui" as a flag with no params', () => {
      const result = parseCommands('disablegui');
      expect(result).toEqual([{ command: 'disablegui', params: [] }]);
    });

    it('parses flags mixed with commands: "noauto,sync:1,start:1"', () => {
      const result = parseCommands('noauto,sync:1,start:1');
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ command: 'noauto', params: [] });
      expect(result[1]).toEqual({ command: 'sync', params: [1] });
      expect(result[2]).toEqual({ command: 'start', params: [1] });
    });
  });

  // ---- Case insensitivity -----------------------------------------------
  describe('case handling', () => {
    it('lowercases command names', () => {
      const result = parseCommands('SYNC:1');
      expect(result[0].command).toBe('sync');
    });

    it('lowercases download types for initcache', () => {
      const result = parseCommands('initcache:TORRENT');
      expect(result[0].params[0]).toBe('torrent');
    });
  });

  // ---- Whitespace handling ----------------------------------------------
  describe('whitespace handling', () => {
    it('trims leading and trailing whitespace', () => {
      const result = parseCommands('  sync:1  ');
      expect(result).toEqual([{ command: 'sync', params: [1] }]);
    });
  });

  // ---- Error cases ------------------------------------------------------
  describe('error cases', () => {
    it('throws on null input', () => {
      expect(() => parseCommands(null)).toThrow('Invalid command string');
    });

    it('throws on undefined input', () => {
      expect(() => parseCommands(undefined)).toThrow('Invalid command string');
    });

    it('throws on empty string', () => {
      expect(() => parseCommands('')).toThrow('Invalid command string');
    });

    it('throws on non-string input (number)', () => {
      expect(() => parseCommands(42)).toThrow('Invalid command string');
    });

    it('throws on non-string input (object)', () => {
      expect(() => parseCommands({})).toThrow('Invalid command string');
    });

    it('throws on unknown command', () => {
      expect(() => parseCommands('foobar')).toThrow('Unknown command: foobar');
    });

    it('throws on invalid OS number (0)', () => {
      expect(() => parseCommands('sync:0')).toThrow('Invalid OS number for sync');
    });

    it('throws on invalid OS number (negative)', () => {
      expect(() => parseCommands('start:-1')).toThrow('Invalid OS number for start');
    });

    it('throws on invalid OS number (non-numeric)', () => {
      expect(() => parseCommands('sync:abc')).toThrow('Invalid OS number for sync');
    });

    it('throws on invalid partition number for format (0)', () => {
      expect(() => parseCommands('format:0')).toThrow('Invalid partition number for format');
    });

    it('throws on invalid download type for initcache', () => {
      expect(() => parseCommands('initcache:ftp')).toThrow('Invalid download type for initcache');
    });

    it('throws on invalid OS number for create_image', () => {
      expect(() => parseCommands('create_image:abc')).toThrow('Invalid OS number for create_image');
    });
  });
});

// ---------------------------------------------------------------------------
// validateCommandString
// ---------------------------------------------------------------------------
describe('validateCommandString', () => {
  it('returns valid=true for a valid command string', () => {
    const result = validateCommandString('sync:1,start:1');
    expect(result.valid).toBe(true);
    expect(result.commands).toHaveLength(2);
    expect(result.commands[0]).toEqual({ command: 'sync', params: [1] });
  });

  it('returns valid=true for a single flag', () => {
    const result = validateCommandString('noauto');
    expect(result.valid).toBe(true);
    expect(result.commands).toHaveLength(1);
  });

  it('returns valid=false with error for invalid input', () => {
    const result = validateCommandString('bogus');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Unknown command/);
  });

  it('returns valid=false for empty string', () => {
    const result = validateCommandString('');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Invalid command string/);
  });

  it('returns valid=false for null', () => {
    const result = validateCommandString(null);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Invalid command string/);
  });
});

// ---------------------------------------------------------------------------
// formatCommandsForWrapper
// ---------------------------------------------------------------------------
describe('formatCommandsForWrapper', () => {
  it('formats a single command without params', () => {
    const formatted = formatCommandsForWrapper([{ command: 'reboot', params: [] }]);
    expect(formatted).toBe('reboot');
  });

  it('formats a single command with one param', () => {
    const formatted = formatCommandsForWrapper([{ command: 'sync', params: [1] }]);
    expect(formatted).toBe('sync:1');
  });

  it('formats chained commands', () => {
    const formatted = formatCommandsForWrapper([
      { command: 'sync', params: [1] },
      { command: 'start', params: [1] },
    ]);
    expect(formatted).toBe('sync:1,start:1');
  });

  it('formats create_image with description using escaped quotes', () => {
    const formatted = formatCommandsForWrapper([
      { command: 'create_image', params: [1, 'my desc'] },
    ]);
    expect(formatted).toBe('create_image:1:\\"my desc\\"');
  });

  it('formats create_qdiff with description using escaped quotes', () => {
    const formatted = formatCommandsForWrapper([
      { command: 'create_qdiff', params: [2, 'snapshot'] },
    ]);
    expect(formatted).toBe('create_qdiff:2:\\"snapshot\\"');
  });

  it('round-trips a simple command string', () => {
    const original = 'sync:1,start:1';
    const parsed = parseCommands(original);
    const formatted = formatCommandsForWrapper(parsed);
    expect(formatted).toBe(original);
  });

  it('round-trips a command with flag and params', () => {
    const original = 'noauto,sync:1,start:1';
    const parsed = parseCommands(original);
    const formatted = formatCommandsForWrapper(parsed);
    expect(formatted).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// mapCommand
// ---------------------------------------------------------------------------
describe('mapCommand', () => {
  it('maps "halt" to "poweroff"', () => {
    expect(mapCommand('halt')).toBe('poweroff');
  });

  it('passes "reboot" through unchanged', () => {
    expect(mapCommand('reboot')).toBe('reboot');
  });

  it('passes "sync" through unchanged', () => {
    expect(mapCommand('sync')).toBe('sync');
  });

  it('passes "poweroff" through unchanged', () => {
    expect(mapCommand('poweroff')).toBe('poweroff');
  });
});

// ---------------------------------------------------------------------------
// getOnbootCmdPath
// ---------------------------------------------------------------------------
describe('getOnbootCmdPath', () => {
  it('returns correct path for a hostname', () => {
    const result = getOnbootCmdPath('pc01');
    // LINBO_DIR is /tmp/linbo-test from jest.setup.js
    expect(result).toBe(path.join('/tmp/linbo-test', 'linbocmd', 'pc01.cmd'));
  });

  it('returns correct path for a different hostname', () => {
    const result = getOnbootCmdPath('workstation-42');
    expect(result).toBe(path.join('/tmp/linbo-test', 'linbocmd', 'workstation-42.cmd'));
  });
});
