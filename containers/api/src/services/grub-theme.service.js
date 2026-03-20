/**
 * LINBO Docker - GRUB Theme Service
 * Manage GRUB boot menu appearance: colors, logo, icons, theme.txt generation
 */

const fs = require('fs').promises;
const path = require('path');
const { z } = require('zod');

const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';
const THEME_DIR = path.join(LINBO_DIR, 'boot/grub/themes/linbo');
const ICONS_DIR = path.join(THEME_DIR, 'icons');
const DEFAULTS_DIR = path.join(THEME_DIR, 'defaults');
const CONFIG_FILE = path.join(THEME_DIR, 'theme-config.json');

const ICON_SUFFIXES = ['', '_start', '_syncstart', '_newstart'];

const DEFAULT_ICON_BASENAMES = new Set([
  'arch', 'centos', 'debian', 'fedora', 'gentoo', 'kubuntu',
  'linbo', 'linux', 'linuxmint', 'lubuntu', 'opensuse',
  'ubuntu', 'unknown', 'win', 'win10', 'xubuntu',
]);

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

// =============================================================================
// Zod Schema
// =============================================================================

const hexColorRegex = /^#[0-9a-fA-F]{6}$/;

const themeConfigSchema = z.object({
  desktopColor: z.string().regex(hexColorRegex).default('#2a4457'),
  itemColor: z.string().regex(hexColorRegex).default('#cccccc'),
  selectedItemColor: z.string().regex(hexColorRegex).default('#ffffff'),
  timeoutColor: z.string().regex(hexColorRegex).default('#cccccc'),
  timeoutText: z.string().max(200).default('Starte in %d Sekunden ...'),
  iconWidth: z.number().int().min(16).max(128).default(36),
  iconHeight: z.number().int().min(16).max(128).default(36),
  itemHeight: z.number().int().min(20).max(120).default(40),
  itemSpacing: z.number().int().min(0).max(60).default(12),
  itemIconSpace: z.number().int().min(0).max(60).default(12),
  logoFile: z.string().max(200).default('linbo_logo_big.png'),
  logoWidth: z.number().int().min(50).max(1024).default(300),
  logoHeight: z.number().int().min(50).max(1024).default(300),
});

const DEFAULT_CONFIG = themeConfigSchema.parse({});

// =============================================================================
// Promise-Mutex (same pattern as firmware-scanner.js)
// =============================================================================

let _writePromise = null;

async function withWriteLock(fn) {
  while (_writePromise) await _writePromise;
  let resolve;
  _writePromise = new Promise(r => { resolve = r; });
  try {
    return await fn();
  } finally {
    _writePromise = null;
    resolve();
  }
}

// =============================================================================
// Path Security
// =============================================================================

function validateBaseName(baseName) {
  if (!/^[a-z0-9_-]{1,50}$/.test(baseName)) {
    throw Object.assign(new Error('Invalid icon base name'), { statusCode: 400 });
  }
  return baseName;
}

function validateIconFilename(filename) {
  if (!/^[a-z0-9_-]{1,50}(_start|_syncstart|_newstart)?\.png$/.test(filename)) {
    throw Object.assign(new Error('Invalid icon filename'), { statusCode: 400 });
  }
  const resolved = path.resolve(ICONS_DIR, filename);
  if (!resolved.startsWith(ICONS_DIR + path.sep)) {
    throw Object.assign(new Error('Path traversal detected'), { statusCode: 400 });
  }
  return resolved;
}

// =============================================================================
// PNG Validation
// =============================================================================

function validatePng(buffer, type = 'icon') {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_MAGIC)) {
    throw Object.assign(new Error('Not a valid PNG file'), { statusCode: 400 });
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const limits = type === 'logo'
    ? { minW: 32, maxW: 2048, minH: 32, maxH: 2048 }
    : { minW: 16, maxW: 256, minH: 16, maxH: 256 };
  if (width < limits.minW || width > limits.maxW || height < limits.minH || height > limits.maxH) {
    throw Object.assign(
      new Error(`PNG ${width}x${height} outside ${type} limits (${limits.minW}-${limits.maxW}x${limits.minH}-${limits.maxH})`),
      { statusCode: 400 }
    );
  }
  return { width, height };
}

// =============================================================================
// Sanitize
// =============================================================================

function sanitizeTimeoutText(text) {
  if (!text || typeof text !== 'string') return DEFAULT_CONFIG.timeoutText;
  return text
    .replace(/[\n\r\0]/g, '')
    .replace(/"/g, '')
    .replace(/\\/g, '')
    .trim()
    .slice(0, 200) || DEFAULT_CONFIG.timeoutText;
}

// =============================================================================
// Defaults Management
// =============================================================================

let _defaultsInitialized = false;

/**
 * Ensure defaults directory exists with shipped originals.
 * Idempotent, does NOT use withWriteLock (to avoid deadlock when called
 * from getThemeConfig inside a locked updateThemeConfig).
 * mkdir recursive + access-guard makes this safe without explicit lock.
 */
async function ensureDefaults() {
  if (_defaultsInitialized) return;
  await fs.mkdir(DEFAULTS_DIR, { recursive: true });
  const logoDefault = path.join(DEFAULTS_DIR, 'linbo_logo_big.png');
  try {
    await fs.access(logoDefault);
  } catch {
    const shipped = path.join(THEME_DIR, 'linbo_logo_big.png');
    try {
      await fs.copyFile(shipped, logoDefault);
    } catch {
      // Logo may not exist yet (fresh install)
    }
    await fs.writeFile(
      path.join(DEFAULTS_DIR, 'theme-config-defaults.json'),
      JSON.stringify(DEFAULT_CONFIG, null, 2)
    );
  }
  _defaultsInitialized = true;
}

// =============================================================================
// Theme Config CRUD
// =============================================================================

async function getThemeConfig() {
  await ensureDefaults();
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return themeConfigSchema.parse(parsed);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { ...DEFAULT_CONFIG };
    }
    // If parse fails, return defaults
    if (err instanceof z.ZodError || err instanceof SyntaxError) {
      console.error('[GrubThemeService] Invalid config, returning defaults:', err.message);
      return { ...DEFAULT_CONFIG };
    }
    throw err;
  }
}

async function updateThemeConfig(updates) {
  return withWriteLock(async () => {
    const current = await getThemeConfig();
    const merged = { ...current, ...updates };
    // Sanitize timeout text
    merged.timeoutText = sanitizeTimeoutText(merged.timeoutText);
    // Validate with Zod
    const validated = themeConfigSchema.parse(merged);
    // Atomic write
    const tmp = CONFIG_FILE + '.tmp.' + process.pid;
    await fs.writeFile(tmp, JSON.stringify(validated, null, 2));
    await fs.rename(tmp, CONFIG_FILE);
    // Regenerate theme.txt
    await generateThemeTxt(validated);
    return validated;
  });
}

async function resetThemeConfig() {
  return withWriteLock(async () => {
    const defaultsFile = path.join(DEFAULTS_DIR, 'theme-config-defaults.json');
    let defaults;
    try {
      const raw = await fs.readFile(defaultsFile, 'utf8');
      defaults = themeConfigSchema.parse(JSON.parse(raw));
    } catch {
      defaults = { ...DEFAULT_CONFIG };
    }
    const tmp = CONFIG_FILE + '.tmp.' + process.pid;
    await fs.writeFile(tmp, JSON.stringify(defaults, null, 2));
    await fs.rename(tmp, CONFIG_FILE);
    await generateThemeTxt(defaults);
    return defaults;
  });
}

// =============================================================================
// theme.txt Generation
// =============================================================================

function generateThemeTxtContent(config) {
  return `# GRUB2 gfxmenu linbo theme
# Auto-generated by linbo-docker

title-text: ""
desktop-color: "${config.desktopColor}"
terminal-font: "Unifont Regular 16"
terminal-box: "terminal_box_*.png"
terminal-left: "0"
terminal-top: "0"
terminal-width: "100%"
terminal-height: "100%"
terminal-border: "0"

+ image { left = 92%-${config.logoWidth} top = 90%-${config.logoHeight} width = ${config.logoWidth} height = ${config.logoHeight} file = "${config.logoFile}" }

+ boot_menu {
  left = 8%
  top = 5%
  width = 84%-${config.logoWidth}
  height = 85%
  item_font = "Unifont Regular 16"
  item_color = "${config.itemColor}"
  selected_item_color = "${config.selectedItemColor}"
  icon_width = ${config.iconWidth}
  icon_height = ${config.iconHeight}
  item_icon_space = ${config.itemIconSpace}
  item_height = ${config.itemHeight}
  item_spacing = ${config.itemSpacing}
  selected_item_pixmap_style = "select_*.png"
  scrollbar_thumb = "select_*.png"
  scrollbar_frame = "select_*.png"
  scrollbar_width = 10
}

+ label {
  top = 87%
  left = 8%+24
  width = 84%-${config.logoWidth}
  align = "left"
  id = "__timeout__"
  text = "${config.timeoutText}"
  color = "${config.timeoutColor}"
  font = "Unifont Regular 16"
}
`;
}

async function generateThemeTxt(config) {
  const content = generateThemeTxtContent(config);
  const themeTxtPath = path.join(THEME_DIR, 'theme.txt');
  const tmp = themeTxtPath + '.tmp.' + process.pid;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, themeTxtPath);
  return content;
}

// =============================================================================
// Theme Status
// =============================================================================

async function getThemeStatus() {
  const config = await getThemeConfig();

  let logoInfo = null;
  try {
    const logoPath = path.join(THEME_DIR, config.logoFile);
    const stat = await fs.stat(logoPath);
    logoInfo = { size: stat.size, modifiedAt: stat.mtime.toISOString() };
  } catch { /* logo not found */ }

  let hasDefault = false;
  try {
    await fs.access(path.join(DEFAULTS_DIR, 'linbo_logo_big.png'));
    hasDefault = true;
  } catch { /* no default */ }

  let isCustomLogo = false;
  if (hasDefault && logoInfo) {
    try {
      const defaultStat = await fs.stat(path.join(DEFAULTS_DIR, 'linbo_logo_big.png'));
      isCustomLogo = defaultStat.size !== logoInfo.size;
    } catch {
      isCustomLogo = false;
    }
  }

  const icons = await listIcons();

  return {
    config,
    logo: {
      file: config.logoFile,
      ...logoInfo,
      isCustom: isCustomLogo,
      hasDefault,
    },
    icons: {
      total: icons.length,
      custom: icons.filter(i => i.isCustom).length,
      default: icons.filter(i => !i.isCustom).length,
    },
  };
}

// =============================================================================
// Icon Management
// =============================================================================

async function listIcons() {
  try {
    const files = await fs.readdir(ICONS_DIR);
    const pngFiles = files.filter(f => f.endsWith('.png'));

    // Group by base name
    const baseNames = new Map();
    for (const file of pngFiles) {
      const base = file
        .replace('.png', '')
        .replace(/_(?:start|syncstart|newstart)$/, '');
      if (!baseNames.has(base)) {
        baseNames.set(base, []);
      }
      baseNames.get(base).push(file);
    }

    const result = [];
    for (const [baseName, variants] of baseNames) {
      result.push({
        baseName,
        variants,
        isCustom: !DEFAULT_ICON_BASENAMES.has(baseName),
      });
    }

    return result.sort((a, b) => a.baseName.localeCompare(b.baseName));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function uploadIcon(tempPath, baseName) {
  return withWriteLock(async () => {
    validateBaseName(baseName);
    const buffer = await fs.readFile(tempPath);
    validatePng(buffer, 'icon');

    await fs.mkdir(ICONS_DIR, { recursive: true });

    for (const suffix of ICON_SUFFIXES) {
      const filename = `${baseName}${suffix}.png`;
      const destPath = path.join(ICONS_DIR, filename);
      await fs.copyFile(tempPath, destPath);
    }

    console.log(`[GrubThemeService] Uploaded icon: ${baseName} (4 variants)`);
    return { baseName, variants: ICON_SUFFIXES.map(s => `${baseName}${s}.png`) };
  });
}

async function deleteCustomIcon(baseName) {
  return withWriteLock(async () => {
    validateBaseName(baseName);
    if (DEFAULT_ICON_BASENAMES.has(baseName)) {
      throw Object.assign(
        new Error('Cannot delete default icon'),
        { statusCode: 400 }
      );
    }

    const deleted = [];
    for (const suffix of ICON_SUFFIXES) {
      const filename = `${baseName}${suffix}.png`;
      const filePath = path.join(ICONS_DIR, filename);
      try {
        await fs.unlink(filePath);
        deleted.push(filename);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }

    console.log(`[GrubThemeService] Deleted custom icon: ${baseName} (${deleted.length} files)`);
    return { baseName, deleted };
  });
}

async function getIconFile(filename) {
  const resolved = validateIconFilename(filename);
  try {
    const stat = await fs.stat(resolved);
    return { path: resolved, size: stat.size, modifiedAt: stat.mtime };
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw Object.assign(new Error('Icon not found'), { statusCode: 404 });
    }
    throw err;
  }
}

// =============================================================================
// Logo Management
// =============================================================================

async function uploadLogo(tempPath) {
  return withWriteLock(async () => {
    const buffer = await fs.readFile(tempPath);
    const { width, height } = validatePng(buffer, 'logo');

    const destPath = path.join(THEME_DIR, 'linbo_logo_big.png');
    await fs.copyFile(tempPath, destPath);

    // Update config logoFile if needed
    const config = await getThemeConfig();
    if (config.logoFile !== 'linbo_logo_big.png') {
      await updateThemeConfigInternal({ ...config, logoFile: 'linbo_logo_big.png' });
    }

    console.log(`[GrubThemeService] Uploaded logo: ${width}x${height}`);
    return { width, height, file: 'linbo_logo_big.png' };
  });
}

async function resetLogo() {
  return withWriteLock(async () => {
    const defaultLogo = path.join(DEFAULTS_DIR, 'linbo_logo_big.png');
    const destPath = path.join(THEME_DIR, 'linbo_logo_big.png');
    try {
      await fs.access(defaultLogo);
    } catch {
      throw Object.assign(new Error('No default logo available'), { statusCode: 404 });
    }
    await fs.copyFile(defaultLogo, destPath);
    console.log('[GrubThemeService] Reset logo to default');
    return { file: 'linbo_logo_big.png', reset: true };
  });
}

async function getLogoFile() {
  const config = await getThemeConfig();
  const logoPath = path.join(THEME_DIR, config.logoFile);
  try {
    const stat = await fs.stat(logoPath);
    return { path: logoPath, size: stat.size, modifiedAt: stat.mtime };
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw Object.assign(new Error('Logo not found'), { statusCode: 404 });
    }
    throw err;
  }
}

// Internal config update without outer lock (already inside withWriteLock)
async function updateThemeConfigInternal(config) {
  const validated = themeConfigSchema.parse(config);
  const tmp = CONFIG_FILE + '.tmp.' + process.pid;
  await fs.writeFile(tmp, JSON.stringify(validated, null, 2));
  await fs.rename(tmp, CONFIG_FILE);
  await generateThemeTxt(validated);
  return validated;
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  // Config
  getThemeConfig,
  updateThemeConfig,
  resetThemeConfig,
  getThemeStatus,

  // Icons
  listIcons,
  uploadIcon,
  deleteCustomIcon,
  getIconFile,

  // Logo
  uploadLogo,
  resetLogo,
  getLogoFile,

  // Generation
  generateThemeTxtContent,

  // Validation (exported for testing)
  validatePng,
  sanitizeTimeoutText,
  validateBaseName,
  validateIconFilename,

  // Constants (exported for testing)
  ICON_SUFFIXES,
  DEFAULT_ICON_BASENAMES,
  DEFAULT_CONFIG,
  THEME_DIR,
  ICONS_DIR,
  DEFAULTS_DIR,

  // Lock (exported for testing)
  withWriteLock,

  // Internal
  ensureDefaults,

  // Test helpers
  _resetForTest() {
    _defaultsInitialized = false;
    _writePromise = null;
  },
};
