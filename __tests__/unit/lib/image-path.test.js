'use strict';

const path = require('path');
const {
  IMAGE_EXTS,
  IMAGE_SIDECARS,
  IMAGE_SUPPLEMENTS,
  READABLE_TYPES,
  WRITABLE_TYPES,
  INFO_KEYS,
  LINBO_DIR,
  IMAGES_DIR,
  FILENAME_RE,
  MAX_BASE_LEN,
  parseMainFilename,
  resolveImageDir,
  resolveSidecarPath,
  parseSidecarFilename,
  resolveSupplementPath,
  toRelativePath,
  resolveFromDbPath,
} = require('../../../src/lib/image-path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe('constants', () => {
  it('IMAGE_EXTS contains .qcow2, .qdiff, .cloop', () => {
    expect(IMAGE_EXTS).toEqual(expect.arrayContaining(['.qcow2', '.qdiff', '.cloop']));
  });

  it('IMAGE_SIDECARS contains standard sidecar extensions', () => {
    expect(IMAGE_SIDECARS).toEqual(expect.arrayContaining(['.info', '.desc', '.torrent', '.md5']));
  });

  it('IMAGE_SUPPLEMENTS lists .reg, .prestart, .postsync', () => {
    expect(IMAGE_SUPPLEMENTS).toEqual(['.reg', '.prestart', '.postsync']);
  });

  it('READABLE_TYPES is an array of strings', () => {
    expect(Array.isArray(READABLE_TYPES)).toBe(true);
    expect(READABLE_TYPES.length).toBeGreaterThan(0);
  });

  it('WRITABLE_TYPES is a subset of READABLE_TYPES', () => {
    for (const t of WRITABLE_TYPES) {
      expect(READABLE_TYPES).toContain(t);
    }
  });

  it('INFO_KEYS contains expected keys', () => {
    expect(INFO_KEYS).toEqual(expect.arrayContaining(['timestamp', 'image', 'imagesize']));
  });

  it('LINBO_DIR reflects test environment', () => {
    expect(LINBO_DIR).toBe('/tmp/linbo-test');
  });

  it('IMAGES_DIR is LINBO_DIR/images', () => {
    expect(IMAGES_DIR).toBe(path.join(LINBO_DIR, 'images'));
  });

  it('FILENAME_RE matches safe characters', () => {
    expect(FILENAME_RE.test('ubuntu22.qcow2')).toBe(true);
    expect(FILENAME_RE.test('my file.qcow2')).toBe(false);
  });

  it('MAX_BASE_LEN is 100', () => {
    expect(MAX_BASE_LEN).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// parseMainFilename
// ---------------------------------------------------------------------------
describe('parseMainFilename', () => {
  // --- Valid filenames ----------------------------------------------------
  describe('valid filenames', () => {
    it('parses a .qcow2 filename', () => {
      const result = parseMainFilename('ubuntu22.qcow2');
      expect(result).toEqual({ base: 'ubuntu22', ext: '.qcow2', filename: 'ubuntu22.qcow2' });
    });

    it('parses a .qdiff filename', () => {
      const result = parseMainFilename('win10.qdiff');
      expect(result).toEqual({ base: 'win10', ext: '.qdiff', filename: 'win10.qdiff' });
    });

    it('parses a .cloop filename', () => {
      const result = parseMainFilename('legacy.cloop');
      expect(result).toEqual({ base: 'legacy', ext: '.cloop', filename: 'legacy.cloop' });
    });

    it('handles filename with hyphens and dots in base', () => {
      const result = parseMainFilename('my-image.v2.qcow2');
      expect(result.base).toBe('my-image.v2');
      expect(result.ext).toBe('.qcow2');
    });

    it('handles base of exactly MAX_BASE_LEN characters', () => {
      const base = 'a'.repeat(MAX_BASE_LEN);
      const filename = base + '.qcow2';
      const result = parseMainFilename(filename);
      expect(result.base).toBe(base);
    });
  });

  // --- Invalid filenames --------------------------------------------------
  describe('invalid filenames', () => {
    it('throws for null', () => {
      expect(() => parseMainFilename(null)).toThrow(/invalid/i);
    });

    it('throws for undefined', () => {
      expect(() => parseMainFilename(undefined)).toThrow(/invalid/i);
    });

    it('throws for empty string', () => {
      expect(() => parseMainFilename('')).toThrow(/invalid/i);
    });

    it('throws for unsupported extension', () => {
      expect(() => parseMainFilename('image.iso')).toThrow(/unsupported extension/i);
    });

    it('throws for filename with spaces', () => {
      expect(() => parseMainFilename('my image.qcow2')).toThrow(/unsafe/i);
    });

    it('throws for filename with special characters', () => {
      expect(() => parseMainFilename('img@host.qcow2')).toThrow(/unsafe/i);
    });

    it('throws for empty base (just extension)', () => {
      expect(() => parseMainFilename('.qcow2')).toThrow(/unsafe|empty/i);
    });

    it('throws for base "." (dot + extension)', () => {
      // "..qcow2" has base "." — but it fails FILENAME_RE first because ".." prefix
      // Actually "..qcow2" matches FILENAME_RE (/^[a-zA-Z0-9._-]+$/) so it gets to base check
      expect(() => parseMainFilename('..qcow2')).toThrow();
    });

    it('throws when base exceeds MAX_BASE_LEN', () => {
      const base = 'a'.repeat(MAX_BASE_LEN + 1);
      expect(() => parseMainFilename(base + '.qcow2')).toThrow(/too long/i);
    });

    it('throws for non-string input', () => {
      expect(() => parseMainFilename(42)).toThrow(/invalid/i);
    });
  });
});

// ---------------------------------------------------------------------------
// resolveImageDir
// ---------------------------------------------------------------------------
describe('resolveImageDir', () => {
  it('returns IMAGES_DIR/<base>/', () => {
    const result = resolveImageDir('ubuntu22.qcow2');
    expect(result).toBe(path.join(IMAGES_DIR, 'ubuntu22'));
  });

  it('uses the base part, not the full filename', () => {
    const result = resolveImageDir('win10.qdiff');
    expect(result).toBe(path.join(IMAGES_DIR, 'win10'));
  });

  it('throws for an invalid filename', () => {
    expect(() => resolveImageDir('bad file.txt')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolveSidecarPath
// ---------------------------------------------------------------------------
describe('resolveSidecarPath', () => {
  it('returns IMAGES_DIR/<base>/<filename><suffix>', () => {
    const result = resolveSidecarPath('ubuntu22.qcow2', '.md5');
    expect(result).toBe(path.join(IMAGES_DIR, 'ubuntu22', 'ubuntu22.qcow2.md5'));
  });

  it('works with .info suffix', () => {
    const result = resolveSidecarPath('win10.qdiff', '.info');
    expect(result).toBe(path.join(IMAGES_DIR, 'win10', 'win10.qdiff.info'));
  });

  it('works with arbitrary suffix strings', () => {
    const result = resolveSidecarPath('legacy.cloop', '.custom');
    expect(result).toBe(path.join(IMAGES_DIR, 'legacy', 'legacy.cloop.custom'));
  });
});

// ---------------------------------------------------------------------------
// parseSidecarFilename
// ---------------------------------------------------------------------------
describe('parseSidecarFilename', () => {
  it('parses a valid sidecar filename', () => {
    const result = parseSidecarFilename('ubuntu22.qcow2.info');
    expect(result).toEqual({ imageFilename: 'ubuntu22.qcow2', sidecarExt: '.info' });
  });

  it('parses .md5 sidecar', () => {
    const result = parseSidecarFilename('win10.qdiff.md5');
    expect(result).toEqual({ imageFilename: 'win10.qdiff', sidecarExt: '.md5' });
  });

  it('parses .desc sidecar', () => {
    const result = parseSidecarFilename('legacy.cloop.desc');
    expect(result).toEqual({ imageFilename: 'legacy.cloop', sidecarExt: '.desc' });
  });

  it('returns null for null input', () => {
    expect(parseSidecarFilename(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseSidecarFilename('')).toBeNull();
  });

  it('returns null for filename with spaces', () => {
    expect(parseSidecarFilename('bad file.qcow2.info')).toBeNull();
  });

  it('returns null for a plain image filename (no sidecar ext)', () => {
    expect(parseSidecarFilename('ubuntu22.qcow2')).toBeNull();
  });

  it('returns null for an invalid image base within the sidecar', () => {
    // ".qcow2.info" — empty base after stripping sidecar ext
    expect(parseSidecarFilename('.qcow2.info')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveSupplementPath
// ---------------------------------------------------------------------------
describe('resolveSupplementPath', () => {
  it('resolves .reg supplement path', () => {
    const result = resolveSupplementPath('ubuntu22.qcow2', '.reg');
    expect(result).toBe(path.join(IMAGES_DIR, 'ubuntu22', 'ubuntu22.reg'));
  });

  it('resolves .prestart supplement path', () => {
    const result = resolveSupplementPath('ubuntu22.qcow2', '.prestart');
    expect(result).toBe(path.join(IMAGES_DIR, 'ubuntu22', 'ubuntu22.prestart'));
  });

  it('resolves .postsync supplement path', () => {
    const result = resolveSupplementPath('ubuntu22.qcow2', '.postsync');
    expect(result).toBe(path.join(IMAGES_DIR, 'ubuntu22', 'ubuntu22.postsync'));
  });

  it('throws for an invalid supplement suffix', () => {
    expect(() => resolveSupplementPath('ubuntu22.qcow2', '.exe')).toThrow(/invalid supplement/i);
  });

  it('throws for an empty suffix', () => {
    expect(() => resolveSupplementPath('ubuntu22.qcow2', '')).toThrow(/invalid supplement/i);
  });
});

// ---------------------------------------------------------------------------
// toRelativePath
// ---------------------------------------------------------------------------
describe('toRelativePath', () => {
  it('returns images/<base>/<filename>', () => {
    expect(toRelativePath('ubuntu22.qcow2')).toBe('images/ubuntu22/ubuntu22.qcow2');
  });

  it('works with .qdiff extension', () => {
    expect(toRelativePath('win10.qdiff')).toBe('images/win10/win10.qdiff');
  });

  it('works with .cloop extension', () => {
    expect(toRelativePath('legacy.cloop')).toBe('images/legacy/legacy.cloop');
  });

  it('throws for invalid filename', () => {
    expect(() => toRelativePath('bad file.txt')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolveFromDbPath
// ---------------------------------------------------------------------------
describe('resolveFromDbPath', () => {
  // --- Valid paths --------------------------------------------------------
  describe('valid paths', () => {
    it('resolves a standard relative DB path', () => {
      const result = resolveFromDbPath('images/ubuntu22/ubuntu22.qcow2');
      expect(result).toBe(path.join(LINBO_DIR, 'images', 'ubuntu22', 'ubuntu22.qcow2'));
    });

    it('resolves a legacy flat path without images/ prefix', () => {
      const result = resolveFromDbPath('ubuntu22.qcow2');
      expect(result).toBe(path.join(LINBO_DIR, 'ubuntu22.qcow2'));
    });

    it('normalizes a legacy absolute path within LINBO_DIR', () => {
      const absPath = LINBO_DIR + '/images/ubuntu22/ubuntu22.qcow2';
      const result = resolveFromDbPath(absPath);
      expect(result).toBe(path.join(LINBO_DIR, 'images', 'ubuntu22', 'ubuntu22.qcow2'));
    });
  });

  // --- Invalid paths ------------------------------------------------------
  describe('invalid paths', () => {
    it('throws for null', () => {
      expect(() => resolveFromDbPath(null)).toThrow(/invalid/i);
    });

    it('throws for empty string', () => {
      expect(() => resolveFromDbPath('')).toThrow(/invalid/i);
    });

    it('throws for backslashes', () => {
      expect(() => resolveFromDbPath('images\\ubuntu22\\ubuntu22.qcow2')).toThrow(/backslash/i);
    });

    it('throws for ".." path traversal segment', () => {
      expect(() => resolveFromDbPath('images/../../../etc/passwd')).toThrow(/unsafe/i);
    });

    it('throws for absolute path outside LINBO_DIR', () => {
      expect(() => resolveFromDbPath('/etc/passwd')).toThrow(/outside/i);
    });

    it('throws for path with empty segments', () => {
      // Double slash creates an empty segment
      expect(() => resolveFromDbPath('images//ubuntu22')).toThrow(/unsafe/i);
    });

    it('throws for path with "." segment', () => {
      expect(() => resolveFromDbPath('images/./ubuntu22')).toThrow(/unsafe/i);
    });
  });
});
