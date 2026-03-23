'use strict';

const path = require('path');
const {
  LINBO_DIR,
  DRIVERS_BASE,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_SIZE,
  sanitizeName,
  sanitizeRelativePath,
  resolveAndValidate,
  resolveDriverPath,
} = require('../../../src/lib/driver-path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe('constants', () => {
  it('exports LINBO_DIR as a non-empty string', () => {
    expect(typeof LINBO_DIR).toBe('string');
    expect(LINBO_DIR.length).toBeGreaterThan(0);
  });

  it('exports DRIVERS_BASE as a non-empty string', () => {
    expect(typeof DRIVERS_BASE).toBe('string');
    expect(DRIVERS_BASE.length).toBeGreaterThan(0);
  });

  it('exports MAX_ZIP_ENTRIES as 50000', () => {
    expect(MAX_ZIP_ENTRIES).toBe(50000);
  });

  it('exports MAX_ZIP_SIZE as 4GB', () => {
    expect(MAX_ZIP_SIZE).toBe(4 * 1024 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
// sanitizeName
// ---------------------------------------------------------------------------
describe('sanitizeName', () => {
  // --- Valid names --------------------------------------------------------
  describe('valid names', () => {
    it('accepts a simple alphanumeric name', () => {
      expect(sanitizeName('ubuntu22')).toBe('ubuntu22');
    });

    it('accepts a name with dots', () => {
      expect(sanitizeName('driver.v2')).toBe('driver.v2');
    });

    it('accepts a name with hyphens', () => {
      expect(sanitizeName('my-driver')).toBe('my-driver');
    });

    it('accepts a name with underscores', () => {
      expect(sanitizeName('my_driver')).toBe('my_driver');
    });

    it('accepts a single character name', () => {
      expect(sanitizeName('a')).toBe('a');
    });

    it('accepts a name of exactly 100 characters', () => {
      const name = 'a' + 'b'.repeat(99);
      expect(sanitizeName(name)).toBe(name);
    });

    it('trims leading/trailing whitespace', () => {
      expect(sanitizeName('  mydriver  ')).toBe('mydriver');
    });
  });

  // --- Invalid names ------------------------------------------------------
  describe('invalid names', () => {
    it('throws for null', () => {
      expect(() => sanitizeName(null)).toThrow();
    });

    it('throws for undefined', () => {
      expect(() => sanitizeName(undefined)).toThrow();
    });

    it('throws for empty string', () => {
      expect(() => sanitizeName('')).toThrow();
    });

    it('throws for whitespace-only string', () => {
      expect(() => sanitizeName('   ')).toThrow();
    });

    it('throws for a name starting with a dot', () => {
      expect(() => sanitizeName('.hidden')).toThrow();
    });

    it('throws for a name starting with a hyphen', () => {
      expect(() => sanitizeName('-flag')).toThrow();
    });

    it('throws for a name containing slashes', () => {
      expect(() => sanitizeName('foo/bar')).toThrow();
    });

    it('accepts a name containing consecutive dots (valid per regex)', () => {
      // "foo..bar" is valid — dots are allowed characters, ".." is only
      // dangerous in path segments, not in flat names
      expect(sanitizeName('foo..bar')).toBe('foo..bar');
    });

    it('throws for a name containing spaces', () => {
      expect(() => sanitizeName('foo bar')).toThrow();
    });

    it('throws for a name over 100 characters', () => {
      const long = 'a' + 'b'.repeat(100); // 101 chars total
      expect(() => sanitizeName(long)).toThrow();
    });

    it('throws for a non-string input (number)', () => {
      expect(() => sanitizeName(42)).toThrow();
    });

    it('sets statusCode 400 on the error', () => {
      try {
        sanitizeName('');
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// sanitizeRelativePath
// ---------------------------------------------------------------------------
describe('sanitizeRelativePath', () => {
  // --- Valid paths --------------------------------------------------------
  describe('valid paths', () => {
    it('accepts a simple filename', () => {
      expect(sanitizeRelativePath('file.sys')).toBe('file.sys');
    });

    it('accepts a nested relative path', () => {
      expect(sanitizeRelativePath('drivers/net/e1000.sys')).toBe('drivers/net/e1000.sys');
    });

    it('normalizes double slashes', () => {
      expect(sanitizeRelativePath('drivers//net//e1000.sys')).toBe('drivers/net/e1000.sys');
    });

    it('removes trailing slash', () => {
      expect(sanitizeRelativePath('drivers/net/')).toBe('drivers/net');
    });
  });

  // --- Invalid paths ------------------------------------------------------
  describe('invalid paths', () => {
    it('throws for null', () => {
      expect(() => sanitizeRelativePath(null)).toThrow();
    });

    it('throws for empty string', () => {
      expect(() => sanitizeRelativePath('')).toThrow();
    });

    it('throws for absolute path starting with /', () => {
      expect(() => sanitizeRelativePath('/etc/passwd')).toThrow(/absolute/i);
    });

    it('throws for backslashes', () => {
      expect(() => sanitizeRelativePath('drivers\\net\\e1000.sys')).toThrow(/backslash/i);
    });

    it('throws for NUL bytes', () => {
      expect(() => sanitizeRelativePath('file\0.sys')).toThrow(/NUL/i);
    });

    it('throws for ".." path traversal segment', () => {
      expect(() => sanitizeRelativePath('drivers/../../../etc/passwd')).toThrow(/traversal/i);
    });

    it('throws for ".." at the start', () => {
      expect(() => sanitizeRelativePath('../secret')).toThrow(/traversal/i);
    });

    it('sets statusCode 400 on the error', () => {
      try {
        sanitizeRelativePath('/abs');
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// resolveAndValidate
// ---------------------------------------------------------------------------
describe('resolveAndValidate', () => {
  it('resolves a valid profile path inside DRIVERS_BASE', async () => {
    const result = await resolveAndValidate('myprofile', 'sub', 'file.sys');
    const expected = path.resolve(DRIVERS_BASE, 'myprofile', 'sub', 'file.sys');
    expect(result).toBe(expected);
  });

  it('resolves a profile root directory', async () => {
    const result = await resolveAndValidate('myprofile');
    const expected = path.resolve(DRIVERS_BASE, 'myprofile');
    expect(result).toBe(expected);
  });

  it('rejects path traversal via ..', async () => {
    await expect(
      resolveAndValidate('myprofile', '..', '..', '..', 'etc', 'passwd')
    ).rejects.toThrow(/traversal/i);
  });

  it('rejects traversal that escapes DRIVERS_BASE', async () => {
    await expect(
      resolveAndValidate('..', 'escape')
    ).rejects.toThrow(/traversal/i);
  });

  it('sets statusCode 400 on traversal error', async () => {
    try {
      await resolveAndValidate('..', '..');
    } catch (err) {
      expect(err.statusCode).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveDriverPath
// ---------------------------------------------------------------------------
describe('resolveDriverPath', () => {
  it('joins profileName with DRIVERS_BASE', () => {
    const result = resolveDriverPath('myprofile');
    expect(result).toBe(path.join(DRIVERS_BASE, 'myprofile'));
  });

  it('joins additional segments', () => {
    const result = resolveDriverPath('myprofile', 'sub', 'file.sys');
    expect(result).toBe(path.join(DRIVERS_BASE, 'myprofile', 'sub', 'file.sys'));
  });

  it('does not validate the name (caller responsibility)', () => {
    // Even an unsafe name will produce a path without throwing
    expect(() => resolveDriverPath('../escape')).not.toThrow();
  });
});
