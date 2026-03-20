/**
 * LINBO Docker - Image Path Module Tests
 * Tests for parseMainFilename, resolve*, toRelativePath, resolveFromDbPath
 */

const path = require('path');

// Set ENV before importing the module
const TEST_LINBO_DIR = '/srv/linbo';
const TEST_IMAGES_DIR = '/srv/linbo/images';
process.env.LINBO_DIR = TEST_LINBO_DIR;
process.env.IMAGES_DIR = TEST_IMAGES_DIR;

const {
  IMAGE_EXTS,
  IMAGE_SIDECARS,
  IMAGE_SUPPLEMENTS,
  READABLE_TYPES,
  WRITABLE_TYPES,
  INFO_KEYS,
  LINBO_DIR,
  IMAGES_DIR,
  parseMainFilename,
  resolveImageDir,
  resolveImagePath,
  resolveSidecarPath,
  parseSidecarFilename,
  resolveSupplementPath,
  toRelativePath,
  resolveFromDbPath,
} = require('../../src/lib/image-path');

describe('Image Path Module', () => {

  // ===========================================================================
  // Constants
  // ===========================================================================
  describe('Constants', () => {
    test('LINBO_DIR matches ENV', () => {
      expect(LINBO_DIR).toBe(TEST_LINBO_DIR);
    });

    test('IMAGES_DIR matches ENV', () => {
      expect(IMAGES_DIR).toBe(TEST_IMAGES_DIR);
    });

    test('IMAGE_EXTS contains expected extensions', () => {
      expect(IMAGE_EXTS).toContain('.qcow2');
      expect(IMAGE_EXTS).toContain('.qdiff');
      expect(IMAGE_EXTS).toContain('.cloop');
    });
  });

  // ===========================================================================
  // parseMainFilename
  // ===========================================================================
  describe('parseMainFilename', () => {
    test('parses valid qcow2 filename', () => {
      const result = parseMainFilename('ubuntu22.qcow2');
      expect(result).toEqual({
        base: 'ubuntu22',
        ext: '.qcow2',
        filename: 'ubuntu22.qcow2',
      });
    });

    test('parses valid qdiff filename', () => {
      const result = parseMainFilename('win11_pro.qdiff');
      expect(result).toEqual({
        base: 'win11_pro',
        ext: '.qdiff',
        filename: 'win11_pro.qdiff',
      });
    });

    test('parses valid cloop filename', () => {
      const result = parseMainFilename('legacy.cloop');
      expect(result).toEqual({
        base: 'legacy',
        ext: '.cloop',
        filename: 'legacy.cloop',
      });
    });

    test('handles dots in base name', () => {
      const result = parseMainFilename('ubuntu.22.04.qcow2');
      expect(result.base).toBe('ubuntu.22.04');
      expect(result.ext).toBe('.qcow2');
    });

    test('handles hyphens and underscores', () => {
      const result = parseMainFilename('my-image_v2.qcow2');
      expect(result.base).toBe('my-image_v2');
    });

    test('rejects null', () => {
      expect(() => parseMainFilename(null)).toThrow('Invalid image filename');
    });

    test('rejects undefined', () => {
      expect(() => parseMainFilename(undefined)).toThrow('Invalid image filename');
    });

    test('rejects empty string', () => {
      expect(() => parseMainFilename('')).toThrow('Invalid image filename');
    });

    test('rejects non-string', () => {
      expect(() => parseMainFilename(123)).toThrow('Invalid image filename');
    });

    test('rejects unsupported extension', () => {
      expect(() => parseMainFilename('image.vmdk')).toThrow('unsupported extension');
    });

    test('rejects extension-only filename', () => {
      expect(() => parseMainFilename('.qcow2')).toThrow('Empty base in filename');
    });

    test('rejects traversal via ..', () => {
      expect(() => parseMainFilename('..qcow2')).toThrow(); // invalid by regex
    });

    test('rejects filename with slash', () => {
      expect(() => parseMainFilename('sub/image.qcow2')).toThrow('Unsafe filename');
    });

    test('rejects filename with space', () => {
      expect(() => parseMainFilename('my image.qcow2')).toThrow('Unsafe filename');
    });

    test('rejects filename with backslash', () => {
      expect(() => parseMainFilename('dir\\image.qcow2')).toThrow('Unsafe filename');
    });

    test('rejects base that is "."', () => {
      // ".qcow2" is caught by FILENAME_RE (starts with .)
      expect(() => parseMainFilename('.qcow2')).toThrow();
    });

    test('rejects overly long base name', () => {
      const longBase = 'a'.repeat(101);
      expect(() => parseMainFilename(`${longBase}.qcow2`)).toThrow('Base too long');
    });

    test('accepts base name at max length', () => {
      const maxBase = 'a'.repeat(100);
      const result = parseMainFilename(`${maxBase}.qcow2`);
      expect(result.base).toBe(maxBase);
    });
  });

  // ===========================================================================
  // resolveImageDir
  // ===========================================================================
  describe('resolveImageDir', () => {
    test('returns correct directory path', () => {
      expect(resolveImageDir('ubuntu22.qcow2')).toBe(
        path.join(TEST_IMAGES_DIR, 'ubuntu22')
      );
    });

    test('uses base name as directory', () => {
      expect(resolveImageDir('win11_pro.qdiff')).toBe(
        path.join(TEST_IMAGES_DIR, 'win11_pro')
      );
    });

    test('throws on invalid filename', () => {
      expect(() => resolveImageDir('bad file.qcow2')).toThrow('Unsafe filename');
    });
  });

  // ===========================================================================
  // resolveImagePath
  // ===========================================================================
  describe('resolveImagePath', () => {
    test('returns correct full path', () => {
      expect(resolveImagePath('ubuntu22.qcow2')).toBe(
        path.join(TEST_IMAGES_DIR, 'ubuntu22', 'ubuntu22.qcow2')
      );
    });

    test('returns correct path for qdiff', () => {
      expect(resolveImagePath('win11.qdiff')).toBe(
        path.join(TEST_IMAGES_DIR, 'win11', 'win11.qdiff')
      );
    });

    test('throws on invalid filename', () => {
      expect(() => resolveImagePath('')).toThrow();
    });
  });

  // ===========================================================================
  // resolveSidecarPath
  // ===========================================================================
  describe('resolveSidecarPath', () => {
    test('returns correct .md5 sidecar path', () => {
      expect(resolveSidecarPath('ubuntu22.qcow2', '.md5')).toBe(
        path.join(TEST_IMAGES_DIR, 'ubuntu22', 'ubuntu22.qcow2.md5')
      );
    });

    test('returns correct .info sidecar path', () => {
      expect(resolveSidecarPath('ubuntu22.qcow2', '.info')).toBe(
        path.join(TEST_IMAGES_DIR, 'ubuntu22', 'ubuntu22.qcow2.info')
      );
    });

    test('returns correct .desc sidecar path', () => {
      expect(resolveSidecarPath('win11.qcow2', '.desc')).toBe(
        path.join(TEST_IMAGES_DIR, 'win11', 'win11.qcow2.desc')
      );
    });

    test('returns correct .torrent sidecar path', () => {
      expect(resolveSidecarPath('ubuntu22.qcow2', '.torrent')).toBe(
        path.join(TEST_IMAGES_DIR, 'ubuntu22', 'ubuntu22.qcow2.torrent')
      );
    });

    test('throws on invalid filename', () => {
      expect(() => resolveSidecarPath('invalid.vmdk', '.md5')).toThrow();
    });
  });

  // ===========================================================================
  // toRelativePath
  // ===========================================================================
  describe('toRelativePath', () => {
    test('returns correct relative path for qcow2', () => {
      expect(toRelativePath('ubuntu22.qcow2')).toBe('images/ubuntu22/ubuntu22.qcow2');
    });

    test('returns correct relative path for qdiff', () => {
      expect(toRelativePath('win11.qdiff')).toBe('images/win11/win11.qdiff');
    });

    test('returns correct relative path for cloop', () => {
      expect(toRelativePath('legacy.cloop')).toBe('images/legacy/legacy.cloop');
    });

    test('throws on invalid filename', () => {
      expect(() => toRelativePath('bad file.qcow2')).toThrow();
    });
  });

  // ===========================================================================
  // resolveFromDbPath
  // ===========================================================================
  describe('resolveFromDbPath', () => {
    test('resolves canonical relative path', () => {
      expect(resolveFromDbPath('images/ubuntu22/ubuntu22.qcow2')).toBe(
        path.join(TEST_LINBO_DIR, 'images/ubuntu22/ubuntu22.qcow2')
      );
    });

    test('resolves legacy absolute path with LINBO_DIR prefix', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = resolveFromDbPath('/srv/linbo/images/ubuntu22/ubuntu22.qcow2');
      expect(result).toBe(path.join(TEST_LINBO_DIR, 'images/ubuntu22/ubuntu22.qcow2'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Absolute DB path'));
      warnSpy.mockRestore();
    });

    test('resolves legacy flat path (no images/ prefix)', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = resolveFromDbPath('ubuntu22.qcow2');
      expect(result).toBe(path.join(TEST_LINBO_DIR, 'ubuntu22.qcow2'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Legacy flat DB path'));
      warnSpy.mockRestore();
    });

    test('throws on null', () => {
      expect(() => resolveFromDbPath(null)).toThrow('Invalid DB path');
    });

    test('throws on empty string', () => {
      expect(() => resolveFromDbPath('')).toThrow('Invalid DB path');
    });

    test('throws on absolute path outside LINBO_DIR', () => {
      expect(() => resolveFromDbPath('/etc/passwd')).toThrow('Absolute path outside LINBO_DIR');
    });

    test('throws on backslash path', () => {
      expect(() => resolveFromDbPath('images\\ubuntu22\\ubuntu22.qcow2')).toThrow('Backslashes not allowed');
    });

    test('throws on double-dot traversal', () => {
      expect(() => resolveFromDbPath('images/../../../etc/passwd')).toThrow('Unsafe DB path segment');
    });

    test('throws on empty segment (double slash)', () => {
      expect(() => resolveFromDbPath('images//ubuntu22/ubuntu22.qcow2')).toThrow('Unsafe DB path segment');
    });

    test('throws on dot segment', () => {
      expect(() => resolveFromDbPath('images/./ubuntu22/ubuntu22.qcow2')).toThrow('Unsafe DB path segment');
    });

    test('resolves absolute path that was under LINBO_DIR (legacy compat)', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = resolveFromDbPath('/srv/linbo/oldimage.qcow2');
      // After stripping LINBO_DIR prefix: "oldimage.qcow2" (no images/ prefix → legacy flat)
      expect(result).toBe(path.join(TEST_LINBO_DIR, 'oldimage.qcow2'));
      warnSpy.mockRestore();
    });
  });

  // ===========================================================================
  // New constants
  // ===========================================================================
  describe('Sidecar Constants', () => {
    test('IMAGE_SIDECARS contains expected extensions', () => {
      expect(IMAGE_SIDECARS).toContain('.info');
      expect(IMAGE_SIDECARS).toContain('.desc');
      expect(IMAGE_SIDECARS).toContain('.torrent');
      expect(IMAGE_SIDECARS).toContain('.macct');
      expect(IMAGE_SIDECARS).toContain('.md5');
    });

    test('IMAGE_SUPPLEMENTS contains expected extensions', () => {
      expect(IMAGE_SUPPLEMENTS).toContain('.reg');
      expect(IMAGE_SUPPLEMENTS).toContain('.prestart');
      expect(IMAGE_SUPPLEMENTS).toContain('.postsync');
    });

    test('READABLE_TYPES are correct', () => {
      expect(READABLE_TYPES).toEqual(['desc', 'info', 'reg', 'prestart', 'postsync']);
    });

    test('WRITABLE_TYPES excludes info', () => {
      expect(WRITABLE_TYPES).toContain('desc');
      expect(WRITABLE_TYPES).toContain('reg');
      expect(WRITABLE_TYPES).toContain('prestart');
      expect(WRITABLE_TYPES).toContain('postsync');
      expect(WRITABLE_TYPES).not.toContain('info');
    });

    test('INFO_KEYS are correct', () => {
      expect(INFO_KEYS).toEqual(['timestamp', 'image', 'imagesize', 'partition', 'partitionsize']);
    });
  });

  // ===========================================================================
  // parseSidecarFilename
  // ===========================================================================
  describe('parseSidecarFilename', () => {
    test('parses ubuntu.qcow2.info correctly', () => {
      const result = parseSidecarFilename('ubuntu.qcow2.info');
      expect(result).toEqual({ imageFilename: 'ubuntu.qcow2', sidecarExt: '.info' });
    });

    test('parses ubuntu.qdiff.desc correctly', () => {
      const result = parseSidecarFilename('ubuntu.qdiff.desc');
      expect(result).toEqual({ imageFilename: 'ubuntu.qdiff', sidecarExt: '.desc' });
    });

    test('parses ubuntu.cloop.torrent correctly', () => {
      const result = parseSidecarFilename('ubuntu.cloop.torrent');
      expect(result).toEqual({ imageFilename: 'ubuntu.cloop', sidecarExt: '.torrent' });
    });

    test('parses .macct sidecar', () => {
      const result = parseSidecarFilename('win11.qcow2.macct');
      expect(result).toEqual({ imageFilename: 'win11.qcow2', sidecarExt: '.macct' });
    });

    test('parses .md5 sidecar', () => {
      const result = parseSidecarFilename('test.qcow2.md5');
      expect(result).toEqual({ imageFilename: 'test.qcow2', sidecarExt: '.md5' });
    });

    test('returns null for traversal attempt', () => {
      expect(parseSidecarFilename('../../etc/passwd')).toBeNull();
    });

    test('returns null for unsupported image extension', () => {
      expect(parseSidecarFilename('ubuntu.vmdk.info')).toBeNull();
    });

    test('returns null for null input', () => {
      expect(parseSidecarFilename(null)).toBeNull();
    });

    test('returns null for undefined input', () => {
      expect(parseSidecarFilename(undefined)).toBeNull();
    });

    test('returns null for empty string', () => {
      expect(parseSidecarFilename('')).toBeNull();
    });

    test('returns null for non-string input', () => {
      expect(parseSidecarFilename(42)).toBeNull();
    });

    test('returns null for main image file (not a sidecar)', () => {
      expect(parseSidecarFilename('ubuntu.qcow2')).toBeNull();
    });

    test('returns null for filename with spaces', () => {
      expect(parseSidecarFilename('ubuntu image.qcow2.info')).toBeNull();
    });

    test('handles complex base name with dots', () => {
      const result = parseSidecarFilename('ubuntu.22.04.qcow2.info');
      expect(result).toEqual({ imageFilename: 'ubuntu.22.04.qcow2', sidecarExt: '.info' });
    });
  });

  // ===========================================================================
  // resolveSupplementPath
  // ===========================================================================
  describe('resolveSupplementPath', () => {
    test('resolves .reg path correctly', () => {
      expect(resolveSupplementPath('ubuntu.qcow2', '.reg')).toBe(
        path.join(TEST_IMAGES_DIR, 'ubuntu', 'ubuntu.reg')
      );
    });

    test('resolves .prestart path correctly', () => {
      expect(resolveSupplementPath('win11.qcow2', '.prestart')).toBe(
        path.join(TEST_IMAGES_DIR, 'win11', 'win11.prestart')
      );
    });

    test('resolves .postsync path correctly', () => {
      expect(resolveSupplementPath('test.qcow2', '.postsync')).toBe(
        path.join(TEST_IMAGES_DIR, 'test', 'test.postsync')
      );
    });

    test('throws for invalid supplement suffix', () => {
      expect(() => resolveSupplementPath('x.qcow2', '.exe')).toThrow('Invalid supplement suffix');
    });

    test('throws for sidecar suffix (not a supplement)', () => {
      expect(() => resolveSupplementPath('x.qcow2', '.info')).toThrow('Invalid supplement suffix');
    });

    test('throws for invalid image filename', () => {
      expect(() => resolveSupplementPath('invalid.vmdk', '.reg')).toThrow();
    });
  });

  // ===========================================================================
  // Integration: round-trip tests
  // ===========================================================================
  describe('Round-trip', () => {
    test('toRelativePath → resolveFromDbPath gives resolveImagePath', () => {
      const filename = 'ubuntu22.qcow2';
      const relPath = toRelativePath(filename);
      const absFromDb = resolveFromDbPath(relPath);
      const absFromFilename = resolveImagePath(filename);
      expect(absFromDb).toBe(absFromFilename);
    });

    test('works for qdiff files', () => {
      const filename = 'win11.qdiff';
      const relPath = toRelativePath(filename);
      const absFromDb = resolveFromDbPath(relPath);
      const absFromFilename = resolveImagePath(filename);
      expect(absFromDb).toBe(absFromFilename);
    });

    test('resolveImageDir is parent of resolveImagePath', () => {
      const filename = 'myimage.qcow2';
      const dir = resolveImageDir(filename);
      const full = resolveImagePath(filename);
      expect(path.dirname(full)).toBe(dir);
    });

    test('resolveSidecarPath shares directory with resolveImagePath', () => {
      const filename = 'test.qcow2';
      const imgPath = resolveImagePath(filename);
      const sidecar = resolveSidecarPath(filename, '.md5');
      expect(path.dirname(sidecar)).toBe(path.dirname(imgPath));
      expect(sidecar).toBe(imgPath + '.md5');
    });
  });
});
