/**
 * LINBO Docker - GRUB Theme Sub-Router
 * 10 endpoints: grub-theme GET/PUT/reset, icons list/serve/upload/delete,
 * logo serve/upload/reset
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { auditAction } = require('../../middleware/audit');
const ws = require('../../lib/websocket');
const { z } = require('zod');
const multer = require('multer');
const path = require('path');
const os = require('os');
const fsSync = require('fs');
const fs = require('fs').promises;
const grubThemeService = require('../../services/grub-theme.service');

// Multer for theme file uploads (logo + icons)
const themeUpload = multer({
  dest: path.join(os.tmpdir(), 'linbo-theme-uploads'),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

async function cleanupTemp(filePath) {
  if (filePath) {
    await fs.unlink(filePath).catch(err => console.debug('[GrubTheme] cleanup: unlink temp file failed:', err.message));
  }
}

const grubThemeConfigSchema = z.object({
  desktopColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  itemColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  selectedItemColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  timeoutColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  timeoutText: z.string().max(200).optional(),
  iconWidth: z.number().int().min(16).max(128).optional(),
  iconHeight: z.number().int().min(16).max(128).optional(),
  itemHeight: z.number().int().min(20).max(120).optional(),
  itemSpacing: z.number().int().min(0).max(60).optional(),
  itemIconSpace: z.number().int().min(0).max(60).optional(),
  logoFile: z.string().max(200).optional(),
  logoWidth: z.number().int().min(50).max(1024).optional(),
  logoHeight: z.number().int().min(50).max(1024).optional(),
});

/**
 * @openapi
 * /system/grub-theme:
 *   get:
 *     tags: [GRUB]
 *     summary: Get GRUB theme status
 *     description: Returns the current theme configuration, logo info, and icon counts. Response includes Cache-Control no-store header.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Theme status including config, logo info, and icon counts
 */
router.get(
  '/grub-theme',
  authenticateToken,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      const status = await grubThemeService.getThemeStatus();
      res.json({ data: status });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/grub-theme:
 *   put:
 *     tags: [GRUB]
 *     summary: Update GRUB theme configuration
 *     description: Updates theme colors, icon/item sizes, timeout text, and logo settings. Broadcasts system.grub_theme_updated WebSocket event. Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               desktopColor:
 *                 type: string
 *                 pattern: '^#[0-9a-fA-F]{6}$'
 *               itemColor:
 *                 type: string
 *                 pattern: '^#[0-9a-fA-F]{6}$'
 *               selectedItemColor:
 *                 type: string
 *                 pattern: '^#[0-9a-fA-F]{6}$'
 *               timeoutColor:
 *                 type: string
 *                 pattern: '^#[0-9a-fA-F]{6}$'
 *               timeoutText:
 *                 type: string
 *                 maxLength: 200
 *               iconWidth:
 *                 type: integer
 *                 minimum: 16
 *                 maximum: 128
 *               iconHeight:
 *                 type: integer
 *                 minimum: 16
 *                 maximum: 128
 *               itemHeight:
 *                 type: integer
 *                 minimum: 20
 *                 maximum: 120
 *               itemSpacing:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 60
 *               itemIconSpace:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 60
 *               logoFile:
 *                 type: string
 *                 maxLength: 200
 *               logoWidth:
 *                 type: integer
 *                 minimum: 50
 *                 maximum: 1024
 *               logoHeight:
 *                 type: integer
 *                 minimum: 50
 *                 maximum: 1024
 *     responses:
 *       200:
 *         description: Updated theme configuration
 *       400:
 *         description: Invalid theme configuration
 */
router.put(
  '/grub-theme',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.grub_theme_update'),
  async (req, res, next) => {
    try {
      const parsed = grubThemeConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_CONFIG',
            message: 'Invalid theme configuration',
            details: parsed.error.issues,
          },
        });
      }
      const config = await grubThemeService.updateThemeConfig(parsed.data);
      ws.broadcast('system.grub_theme_updated', { timestamp: new Date() });
      res.json({ data: config });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/grub-theme/reset:
 *   post:
 *     tags: [GRUB]
 *     summary: Reset GRUB theme configuration to defaults
 *     description: Resets all theme config values (colors, sizes, text) to defaults. Custom icons and logo are not affected. Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Default theme configuration
 */
router.post(
  '/grub-theme/reset',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.grub_theme_reset'),
  async (req, res, next) => {
    try {
      const config = await grubThemeService.resetThemeConfig();
      ws.broadcast('system.grub_theme_reset', { timestamp: new Date() });
      res.json({ data: config });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/grub-theme/icons:
 *   get:
 *     tags: [GRUB]
 *     summary: List all GRUB theme icons
 *     description: Returns all icons grouped by base name, with variant information (base, _start, _syncstart, _newstart). Response includes Cache-Control no-store header.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Icons grouped by base name
 */
router.get(
  '/grub-theme/icons',
  authenticateToken,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      const icons = await grubThemeService.listIcons();
      res.json({ data: icons });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/grub-theme/icons/{filename}:
 *   get:
 *     tags: [GRUB]
 *     summary: Serve a single icon PNG file
 *     description: Returns the raw PNG image data for the specified icon file. Includes ETag and Cache-Control headers.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *         description: Icon filename (e.g. "windows.png")
 *     responses:
 *       200:
 *         description: PNG image data
 *         content:
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Invalid filename
 *       404:
 *         description: Icon not found
 */
router.get(
  '/grub-theme/icons/:filename',
  authenticateToken,
  async (req, res, next) => {
    try {
      const { filename } = req.params;
      const icon = await grubThemeService.getIconFile(filename);
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=300');
      res.set('ETag', `"${icon.size}-${icon.modifiedAt.getTime()}"`);
      const stream = fsSync.createReadStream(icon.path);
      stream.pipe(res);
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: { code: 'ICON_NOT_FOUND', message: error.message },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_FILENAME', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/grub-theme/icons:
 *   post:
 *     tags: [GRUB]
 *     summary: Upload a custom icon
 *     description: >
 *       Uploads a PNG icon and creates 4 variants (base, _start, _syncstart, _newstart).
 *       Requires multipart form with "icon" file field and "baseName" text field.
 *       Max file size 2 MB. Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [icon, baseName]
 *             properties:
 *               icon:
 *                 type: string
 *                 format: binary
 *                 description: PNG icon file (max 2 MB)
 *               baseName:
 *                 type: string
 *                 description: Base name for the icon variants
 *     responses:
 *       201:
 *         description: Icon uploaded and variants created
 *       400:
 *         description: No file uploaded, missing baseName, or invalid icon
 */
router.post(
  '/grub-theme/icons',
  authenticateToken,
  requireRole(['admin']),
  themeUpload.single('icon'),
  auditAction('system.grub_theme_icon_upload'),
  async (req, res, next) => {
    const tempPath = req.file?.path;
    try {
      if (!req.file) {
        return res.status(400).json({
          error: { code: 'NO_FILE', message: 'No icon file uploaded' },
        });
      }
      const baseName = req.body.baseName;
      if (!baseName) {
        return res.status(400).json({
          error: { code: 'MISSING_BASENAME', message: 'baseName is required' },
        });
      }
      const result = await grubThemeService.uploadIcon(tempPath, baseName);
      ws.broadcast('system.grub_theme_icon_uploaded', {
        baseName: result.baseName,
        timestamp: new Date(),
      });
      res.status(201).json({ data: result });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_ICON', message: error.message },
        });
      }
      next(error);
    } finally {
      await cleanupTemp(tempPath);
    }
  }
);

/**
 * @openapi
 * /system/grub-theme/icons/{baseName}:
 *   delete:
 *     tags: [GRUB]
 *     summary: Delete a custom icon and all its variants
 *     description: Removes all 4 icon variants (base, _start, _syncstart, _newstart) for the given base name. Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: baseName
 *         required: true
 *         schema:
 *           type: string
 *         description: Base name of the icon to delete
 *     responses:
 *       200:
 *         description: Icon variants deleted
 *       400:
 *         description: Invalid operation (e.g. built-in icon)
 */
router.delete(
  '/grub-theme/icons/:baseName',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.grub_theme_icon_delete'),
  async (req, res, next) => {
    try {
      const { baseName } = req.params;
      const result = await grubThemeService.deleteCustomIcon(baseName);
      ws.broadcast('system.grub_theme_icon_deleted', {
        baseName: result.baseName,
        timestamp: new Date(),
      });
      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_OPERATION', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/grub-theme/logo:
 *   get:
 *     tags: [GRUB]
 *     summary: Serve the current logo PNG file
 *     description: Returns the raw PNG image data for the current GRUB theme logo. Includes ETag and Cache-Control headers.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: PNG image data
 *         content:
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Logo file not found
 */
router.get(
  '/grub-theme/logo',
  authenticateToken,
  async (req, res, next) => {
    try {
      const logo = await grubThemeService.getLogoFile();
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=300');
      res.set('ETag', `"${logo.size}-${logo.modifiedAt.getTime()}"`);
      const stream = fsSync.createReadStream(logo.path);
      stream.pipe(res);
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: { code: 'LOGO_NOT_FOUND', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/grub-theme/logo:
 *   post:
 *     tags: [GRUB]
 *     summary: Upload a custom logo PNG
 *     description: Uploads a custom PNG logo for the GRUB theme. Max file size 2 MB. Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [logo]
 *             properties:
 *               logo:
 *                 type: string
 *                 format: binary
 *                 description: PNG logo file (max 2 MB)
 *     responses:
 *       201:
 *         description: Logo uploaded successfully
 *       400:
 *         description: No file uploaded or invalid logo
 */
router.post(
  '/grub-theme/logo',
  authenticateToken,
  requireRole(['admin']),
  themeUpload.single('logo'),
  auditAction('system.grub_theme_logo_upload'),
  async (req, res, next) => {
    const tempPath = req.file?.path;
    try {
      if (!req.file) {
        return res.status(400).json({
          error: { code: 'NO_FILE', message: 'No logo file uploaded' },
        });
      }
      const result = await grubThemeService.uploadLogo(tempPath);
      ws.broadcast('system.grub_theme_logo_updated', { timestamp: new Date() });
      res.status(201).json({ data: result });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_LOGO', message: error.message },
        });
      }
      next(error);
    } finally {
      await cleanupTemp(tempPath);
    }
  }
);

/**
 * @openapi
 * /system/grub-theme/logo/reset:
 *   post:
 *     tags: [GRUB]
 *     summary: Reset logo to the shipped default
 *     description: Replaces the current logo with the built-in default logo. Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logo reset to default
 *       404:
 *         description: Default logo not found
 */
router.post(
  '/grub-theme/logo/reset',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.grub_theme_logo_reset'),
  async (req, res, next) => {
    try {
      const result = await grubThemeService.resetLogo();
      ws.broadcast('system.grub_theme_logo_reset', { timestamp: new Date() });
      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: { code: 'NO_DEFAULT', message: error.message },
        });
      }
      next(error);
    }
  }
);

module.exports = router;
