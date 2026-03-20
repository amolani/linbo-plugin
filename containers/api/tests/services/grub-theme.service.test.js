/**
 * LINBO Docker - GRUB Theme Service Tests
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Set up test environment before requiring service
const TEST_DIR = path.join(os.tmpdir(), 'linbo-grub-theme-test-' + process.pid);
process.env.LINBO_DIR = TEST_DIR;

const grubThemeService = require('../../src/services/grub-theme.service');

// Minimal valid 1x1 PNG (68 bytes)
function createTestPng(width = 36, height = 36) {
  const buf = Buffer.alloc(33);
  // PNG signature
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(buf, 0);
  // IHDR chunk length (13 bytes)
  buf.writeUInt32BE(13, 8);
  // IHDR type
  Buffer.from('IHDR').copy(buf, 12);
  // Width and Height
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  // Bit depth, color type, compression, filter, interlace
  buf[24] = 8; // bit depth
  buf[25] = 2; // RGB
  buf[26] = 0; // compression
  buf[27] = 0; // filter
  buf[28] = 0; // interlace
  // CRC (simplified - not valid but sufficient for our validation)
  buf.writeUInt32BE(0, 29);
  return buf;
}

async function createTestPngFile(dir, name, width = 36, height = 36) {
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, createTestPng(width, height));
  return filePath;
}

beforeEach(async () => {
  const themeDir = path.join(TEST_DIR, 'boot/grub/themes/linbo');
  const iconsDir = path.join(themeDir, 'icons');
  await fs.mkdir(iconsDir, { recursive: true });

  // Create a dummy logo
  await createTestPngFile(themeDir, 'linbo_logo_big.png', 300, 300);

  // Create some default icons
  for (const base of ['ubuntu', 'win10']) {
    for (const suffix of grubThemeService.ICON_SUFFIXES) {
      await createTestPngFile(iconsDir, `${base}${suffix}.png`);
    }
  }

  // Clean up config file if exists
  const configFile = path.join(themeDir, 'theme-config.json');
  try { await fs.unlink(configFile); } catch {}

  // Clean up defaults dir
  const defaultsDir = path.join(themeDir, 'defaults');
  try {
    const files = await fs.readdir(defaultsDir);
    for (const f of files) await fs.unlink(path.join(defaultsDir, f));
    await fs.rmdir(defaultsDir);
  } catch {}

  // Reset internal state
  grubThemeService._resetForTest && grubThemeService._resetForTest();
});

afterAll(async () => {
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  } catch {}
});

// =============================================================================
// getThemeConfig
// =============================================================================

describe('getThemeConfig', () => {
  test('returns defaults when no config file exists', async () => {
    const config = await grubThemeService.getThemeConfig();
    expect(config.desktopColor).toBe('#2a4457');
    expect(config.itemColor).toBe('#cccccc');
    expect(config.selectedItemColor).toBe('#ffffff');
    expect(config.timeoutText).toBe('Starte in %d Sekunden ...');
    expect(config.iconWidth).toBe(36);
    expect(config.logoFile).toBe('linbo_logo_big.png');
  });

  test('reads existing config file', async () => {
    const themeDir = path.join(TEST_DIR, 'boot/grub/themes/linbo');
    await fs.writeFile(
      path.join(themeDir, 'theme-config.json'),
      JSON.stringify({ desktopColor: '#112233', itemColor: '#aabbcc' })
    );
    const config = await grubThemeService.getThemeConfig();
    expect(config.desktopColor).toBe('#112233');
    expect(config.itemColor).toBe('#aabbcc');
    // Defaults for unset values
    expect(config.selectedItemColor).toBe('#ffffff');
  });

  test('returns defaults for invalid JSON', async () => {
    const themeDir = path.join(TEST_DIR, 'boot/grub/themes/linbo');
    await fs.writeFile(path.join(themeDir, 'theme-config.json'), 'not json');
    const config = await grubThemeService.getThemeConfig();
    expect(config.desktopColor).toBe('#2a4457');
  });
});

// =============================================================================
// updateThemeConfig
// =============================================================================

describe('updateThemeConfig', () => {
  test('updates config and regenerates theme.txt', async () => {
    const result = await grubThemeService.updateThemeConfig({
      desktopColor: '#1a2b3c',
      itemColor: '#ddeeff',
    });
    expect(result.desktopColor).toBe('#1a2b3c');
    expect(result.itemColor).toBe('#ddeeff');

    // Verify theme.txt was generated
    const themeDir = path.join(TEST_DIR, 'boot/grub/themes/linbo');
    const themeTxt = await fs.readFile(path.join(themeDir, 'theme.txt'), 'utf8');
    expect(themeTxt).toContain('desktop-color: "#1a2b3c"');
    expect(themeTxt).toContain('item_color = "#ddeeff"');
  });

  test('rejects invalid hex color', async () => {
    await expect(
      grubThemeService.updateThemeConfig({ desktopColor: 'not-a-color' })
    ).rejects.toThrow();
  });

  test('sanitizes timeout text', async () => {
    const result = await grubThemeService.updateThemeConfig({
      timeoutText: 'Test\nLine2',
    });
    expect(result.timeoutText).toBe('TestLine2');
  });
});

// =============================================================================
// resetThemeConfig
// =============================================================================

describe('resetThemeConfig', () => {
  test('resets config to defaults', async () => {
    // First set custom config
    await grubThemeService.updateThemeConfig({ desktopColor: '#ff0000' });
    // Then reset
    const result = await grubThemeService.resetThemeConfig();
    expect(result.desktopColor).toBe('#2a4457');

    // Verify theme.txt was regenerated
    const themeDir = path.join(TEST_DIR, 'boot/grub/themes/linbo');
    const themeTxt = await fs.readFile(path.join(themeDir, 'theme.txt'), 'utf8');
    expect(themeTxt).toContain('desktop-color: "#2a4457"');
  });
});

// =============================================================================
// generateThemeTxtContent (Golden-File Test)
// =============================================================================

describe('generateThemeTxtContent', () => {
  test('generates deterministic theme.txt from default config', () => {
    const content = grubThemeService.generateThemeTxtContent(grubThemeService.DEFAULT_CONFIG);

    // All 13 schema values must appear
    expect(content).toContain('desktop-color: "#2a4457"');
    expect(content).toContain('item_color = "#cccccc"');
    expect(content).toContain('selected_item_color = "#ffffff"');
    expect(content).toContain('color = "#cccccc"'); // timeoutColor
    expect(content).toContain('text = "Starte in %d Sekunden ..."');
    expect(content).toContain('icon_width = 36');
    expect(content).toContain('icon_height = 36');
    expect(content).toContain('item_height = 40');
    expect(content).toContain('item_spacing = 12');
    expect(content).toContain('item_icon_space = 12');
    expect(content).toContain('file = "linbo_logo_big.png"');
    expect(content).toContain('width = 300');
    expect(content).toContain('height = 300');
  });

  test('generates correct output with custom values', () => {
    const config = {
      ...grubThemeService.DEFAULT_CONFIG,
      desktopColor: '#112233',
      iconWidth: 48,
      iconHeight: 48,
      logoWidth: 200,
      logoHeight: 150,
      timeoutText: 'Boot in %d sec',
    };
    const content = grubThemeService.generateThemeTxtContent(config);
    expect(content).toContain('desktop-color: "#112233"');
    expect(content).toContain('icon_width = 48');
    expect(content).toContain('icon_height = 48');
    expect(content).toContain('width = 200');
    expect(content).toContain('92%-200');
    expect(content).toContain('90%-150');
    expect(content).toContain('text = "Boot in %d sec"');
  });

  test('contains required GRUB structure elements', () => {
    const content = grubThemeService.generateThemeTxtContent(grubThemeService.DEFAULT_CONFIG);
    expect(content).toContain('+ image {');
    expect(content).toContain('+ boot_menu {');
    expect(content).toContain('+ label {');
    expect(content).toContain('id = "__timeout__"');
    expect(content).toContain('terminal-font: "Unifont Regular 16"');
    expect(content).toContain('selected_item_pixmap_style = "select_*.png"');
  });
});

// =============================================================================
// sanitizeTimeoutText
// =============================================================================

describe('sanitizeTimeoutText', () => {
  test('preserves %d placeholder', () => {
    expect(grubThemeService.sanitizeTimeoutText('Starte in %d Sekunden ...')).toBe('Starte in %d Sekunden ...');
  });

  test('preserves simple text with %d', () => {
    expect(grubThemeService.sanitizeTimeoutText('Boot in %d sec')).toBe('Boot in %d sec');
  });

  test('removes newlines', () => {
    expect(grubThemeService.sanitizeTimeoutText('Test\nLine2')).toBe('TestLine2');
  });

  test('removes carriage returns', () => {
    expect(grubThemeService.sanitizeTimeoutText('Test\rLine2')).toBe('TestLine2');
  });

  test('removes null bytes', () => {
    expect(grubThemeService.sanitizeTimeoutText('Test\0Line2')).toBe('TestLine2');
  });

  test('removes quotes', () => {
    expect(grubThemeService.sanitizeTimeoutText('Test"Quote')).toBe('TestQuote');
  });

  test('removes backslashes', () => {
    expect(grubThemeService.sanitizeTimeoutText('Test\\Path')).toBe('TestPath');
  });

  test('truncates to 200 characters', () => {
    const long = 'A'.repeat(300);
    expect(grubThemeService.sanitizeTimeoutText(long)).toHaveLength(200);
  });

  test('returns default for empty string', () => {
    expect(grubThemeService.sanitizeTimeoutText('')).toBe('Starte in %d Sekunden ...');
  });

  test('returns default for null', () => {
    expect(grubThemeService.sanitizeTimeoutText(null)).toBe('Starte in %d Sekunden ...');
  });
});

// =============================================================================
// validatePng
// =============================================================================

describe('validatePng', () => {
  test('validates valid icon PNG', () => {
    const result = grubThemeService.validatePng(createTestPng(36, 36), 'icon');
    expect(result).toEqual({ width: 36, height: 36 });
  });

  test('validates valid logo PNG', () => {
    const result = grubThemeService.validatePng(createTestPng(512, 512), 'logo');
    expect(result).toEqual({ width: 512, height: 512 });
  });

  test('rejects broken magic bytes', () => {
    const buf = Buffer.alloc(33);
    buf[0] = 0x00;
    expect(() => grubThemeService.validatePng(buf)).toThrow('Not a valid PNG');
  });

  test('rejects too-small buffer', () => {
    expect(() => grubThemeService.validatePng(Buffer.alloc(10))).toThrow('Not a valid PNG');
  });

  test('rejects icon too large (3000x3000)', () => {
    expect(() => grubThemeService.validatePng(createTestPng(3000, 3000), 'icon'))
      .toThrow('outside icon limits');
  });

  test('rejects icon too small (8x8)', () => {
    expect(() => grubThemeService.validatePng(createTestPng(8, 8), 'icon'))
      .toThrow('outside icon limits');
  });

  test('rejects logo too large (5000x5000)', () => {
    expect(() => grubThemeService.validatePng(createTestPng(5000, 5000), 'logo'))
      .toThrow('outside logo limits');
  });

  test('accepts logo at boundary (2048x2048)', () => {
    const result = grubThemeService.validatePng(createTestPng(2048, 2048), 'logo');
    expect(result).toEqual({ width: 2048, height: 2048 });
  });
});

// =============================================================================
// Path Security
// =============================================================================

describe('validateBaseName', () => {
  test('accepts valid base name', () => {
    expect(grubThemeService.validateBaseName('manjaro')).toBe('manjaro');
  });

  test('accepts name with hyphens and underscores', () => {
    expect(grubThemeService.validateBaseName('pop-os_22')).toBe('pop-os_22');
  });

  test('rejects path traversal ../etc/passwd', () => {
    expect(() => grubThemeService.validateBaseName('../etc/passwd')).toThrow('Invalid icon base name');
  });

  test('rejects name with dot', () => {
    expect(() => grubThemeService.validateBaseName('foo.bar')).toThrow('Invalid icon base name');
  });

  test('rejects name with slash', () => {
    expect(() => grubThemeService.validateBaseName('foo/bar')).toThrow('Invalid icon base name');
  });

  test('rejects empty string', () => {
    expect(() => grubThemeService.validateBaseName('')).toThrow('Invalid icon base name');
  });

  test('rejects single dot', () => {
    expect(() => grubThemeService.validateBaseName('.')).toThrow('Invalid icon base name');
  });

  test('rejects double dot', () => {
    expect(() => grubThemeService.validateBaseName('..')).toThrow('Invalid icon base name');
  });

  test('rejects uppercase', () => {
    expect(() => grubThemeService.validateBaseName('Ubuntu')).toThrow('Invalid icon base name');
  });
});

describe('validateIconFilename', () => {
  test('accepts valid icon filename', () => {
    const result = grubThemeService.validateIconFilename('ubuntu.png');
    expect(result).toContain('ubuntu.png');
  });

  test('accepts valid _start filename', () => {
    const result = grubThemeService.validateIconFilename('valid_name_start.png');
    expect(result).toContain('valid_name_start.png');
  });

  test('accepts _syncstart variant', () => {
    const result = grubThemeService.validateIconFilename('win10_syncstart.png');
    expect(result).toContain('win10_syncstart.png');
  });

  test('rejects path traversal', () => {
    expect(() => grubThemeService.validateIconFilename('../../theme-config.json'))
      .toThrow('Invalid icon filename');
  });

  test('rejects non-png extension', () => {
    expect(() => grubThemeService.validateIconFilename('test.jpg'))
      .toThrow('Invalid icon filename');
  });

  test('rejects empty string', () => {
    expect(() => grubThemeService.validateIconFilename(''))
      .toThrow('Invalid icon filename');
  });
});

// =============================================================================
// Icon Management
// =============================================================================

describe('listIcons', () => {
  test('lists icons grouped by base name', async () => {
    const icons = await grubThemeService.listIcons();
    expect(icons.length).toBeGreaterThanOrEqual(2);

    const ubuntu = icons.find(i => i.baseName === 'ubuntu');
    expect(ubuntu).toBeDefined();
    expect(ubuntu.isCustom).toBe(false);
    expect(ubuntu.variants).toHaveLength(4);
  });
});

describe('uploadIcon', () => {
  test('creates 4 variant files', async () => {
    const tmpDir = path.join(TEST_DIR, 'tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpFile = await createTestPngFile(tmpDir, 'upload.png');

    const result = await grubThemeService.uploadIcon(tmpFile, 'manjaro');
    expect(result.baseName).toBe('manjaro');
    expect(result.variants).toHaveLength(4);
    expect(result.variants).toContain('manjaro.png');
    expect(result.variants).toContain('manjaro_start.png');
    expect(result.variants).toContain('manjaro_syncstart.png');
    expect(result.variants).toContain('manjaro_newstart.png');

    // Verify all 4 files exist
    const iconsDir = path.join(TEST_DIR, 'boot/grub/themes/linbo/icons');
    for (const variant of result.variants) {
      const stat = await fs.stat(path.join(iconsDir, variant));
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  test('all 4 variants are byte-identical', async () => {
    const tmpDir = path.join(TEST_DIR, 'tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpFile = await createTestPngFile(tmpDir, 'upload2.png');
    const originalContent = await fs.readFile(tmpFile);

    await grubThemeService.uploadIcon(tmpFile, 'testicon');

    const iconsDir = path.join(TEST_DIR, 'boot/grub/themes/linbo/icons');
    for (const suffix of grubThemeService.ICON_SUFFIXES) {
      const content = await fs.readFile(path.join(iconsDir, `testicon${suffix}.png`));
      expect(content.equals(originalContent)).toBe(true);
    }
  });

  test('rejects invalid base name', async () => {
    await expect(
      grubThemeService.uploadIcon('/tmp/test.png', '../evil')
    ).rejects.toThrow('Invalid icon base name');
  });
});

describe('deleteCustomIcon', () => {
  test('deletes custom icon', async () => {
    // First upload
    const tmpDir = path.join(TEST_DIR, 'tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpFile = await createTestPngFile(tmpDir, 'del.png');
    await grubThemeService.uploadIcon(tmpFile, 'manjaro');

    // Then delete
    const result = await grubThemeService.deleteCustomIcon('manjaro');
    expect(result.baseName).toBe('manjaro');
    expect(result.deleted.length).toBeGreaterThan(0);

    // Verify files are gone
    const iconsDir = path.join(TEST_DIR, 'boot/grub/themes/linbo/icons');
    for (const suffix of grubThemeService.ICON_SUFFIXES) {
      await expect(
        fs.access(path.join(iconsDir, `manjaro${suffix}.png`))
      ).rejects.toThrow();
    }
  });

  test('rejects deletion of default icon ubuntu', async () => {
    await expect(
      grubThemeService.deleteCustomIcon('ubuntu')
    ).rejects.toThrow('Cannot delete default icon');
  });

  test('rejects deletion of default icon win10', async () => {
    await expect(
      grubThemeService.deleteCustomIcon('win10')
    ).rejects.toThrow('Cannot delete default icon');
  });
});

// =============================================================================
// Logo Management
// =============================================================================

describe('uploadLogo', () => {
  test('replaces logo file', async () => {
    const tmpDir = path.join(TEST_DIR, 'tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpFile = await createTestPngFile(tmpDir, 'logo.png', 512, 512);

    const result = await grubThemeService.uploadLogo(tmpFile);
    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result.file).toBe('linbo_logo_big.png');
  });

  test('rejects non-PNG file', async () => {
    const tmpDir = path.join(TEST_DIR, 'tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, 'bad.png');
    await fs.writeFile(tmpFile, 'not a png');

    await expect(grubThemeService.uploadLogo(tmpFile)).rejects.toThrow('Not a valid PNG');
  });
});

describe('resetLogo', () => {
  test('restores default logo', async () => {
    // Initialize defaults first
    await grubThemeService.getThemeConfig();

    const result = await grubThemeService.resetLogo();
    expect(result.reset).toBe(true);

    // Verify logo matches default
    const themeDir = path.join(TEST_DIR, 'boot/grub/themes/linbo');
    const defaultsDir = path.join(themeDir, 'defaults');
    const currentLogo = await fs.readFile(path.join(themeDir, 'linbo_logo_big.png'));
    const defaultLogo = await fs.readFile(path.join(defaultsDir, 'linbo_logo_big.png'));
    expect(currentLogo.equals(defaultLogo)).toBe(true);
  });
});

// =============================================================================
// ensureDefaults
// =============================================================================

describe('ensureDefaults', () => {
  test('creates defaults directory and files', async () => {
    await grubThemeService.getThemeConfig(); // triggers ensureDefaults

    const defaultsDir = path.join(TEST_DIR, 'boot/grub/themes/linbo/defaults');
    const files = await fs.readdir(defaultsDir);
    expect(files).toContain('linbo_logo_big.png');
    expect(files).toContain('theme-config-defaults.json');
  });

  test('is idempotent - second call does not fail', async () => {
    await grubThemeService.getThemeConfig();
    await grubThemeService.ensureDefaults();
    // No error thrown
  });
});

// =============================================================================
// Concurrency (Mutex)
// =============================================================================

describe('concurrency', () => {
  test('two parallel updateThemeConfig calls succeed', async () => {
    const [r1, r2] = await Promise.all([
      grubThemeService.updateThemeConfig({ desktopColor: '#111111' }),
      grubThemeService.updateThemeConfig({ desktopColor: '#222222' }),
    ]);

    // Both should succeed (one will overwrite the other)
    expect(r1.desktopColor).toBeDefined();
    expect(r2.desktopColor).toBeDefined();

    // Final state should be consistent
    const final = await grubThemeService.getThemeConfig();
    expect(['#111111', '#222222']).toContain(final.desktopColor);

    // Verify JSON is valid (not corrupted)
    const themeDir = path.join(TEST_DIR, 'boot/grub/themes/linbo');
    const raw = await fs.readFile(path.join(themeDir, 'theme-config.json'), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

// =============================================================================
// getThemeStatus
// =============================================================================

describe('getThemeStatus', () => {
  test('returns complete status', async () => {
    const status = await grubThemeService.getThemeStatus();
    expect(status.config).toBeDefined();
    expect(status.config.desktopColor).toBe('#2a4457');
    expect(status.logo).toBeDefined();
    expect(status.logo.file).toBe('linbo_logo_big.png');
    expect(status.icons).toBeDefined();
    expect(status.icons.total).toBeGreaterThanOrEqual(2);
  });
});
