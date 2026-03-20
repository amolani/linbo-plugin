/**
 * LINBO Plugin - Driver Profile Routes
 * Full CRUD endpoints for match.conf-based driver profiles and files.
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { z } = require('zod');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { auditAction } = require('../middleware/audit');
const driversService = require('../services/drivers.service');
const hwinfoScanner = require('../services/hwinfo-scanner.service');
const redis = require('../lib/redis');

// =============================================================================
// Multer Configuration
// =============================================================================

const upload = multer({
  dest: path.join(os.tmpdir(), 'linbo-uploads'),
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024, // 2GB
    files: 1,
  },
});

/**
 * Clean up temp file after use
 */
async function cleanupTemp(filePath) {
  if (filePath) {
    await fs.unlink(filePath).catch(err => console.debug('[Drivers] cleanup: unlink temp file failed:', err.message));
  }
}

// =============================================================================
// Zod Schemas
// =============================================================================

const createProfileSchema = z.object({
  hostIp: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, 'Invalid IPv4 address'),
});

const fileDeleteSchema = z.object({
  path: z.string().min(1).max(1024),
});

const matchConfUpdateSchema = z.object({
  content: z.string().min(1).max(10240),
});

const imageAssignSchema = z.object({
  image: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
});

// =============================================================================
// Routes (static paths first, then parameterized)
// =============================================================================

/**
 * @openapi
 * /drivers/create-profile:
 *   post:
 *     tags: [Drivers]
 *     summary: Create a driver profile from a LINBO client's DMI data via SSH
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [hostIp]
 *             properties:
 *               hostIp:
 *                 type: string
 *                 description: IPv4 address of the LINBO client
 *                 example: "10.0.0.100"
 *     responses:
 *       201: { description: Profile created successfully }
 *       200: { description: Profile already existed }
 *       400: { description: Invalid IP address or profile name }
 *       502: { description: SSH connection failed }
 *       504: { description: SSH timeout }
 */
router.post(
  '/create-profile',
  authenticateToken,
  requireRole(['admin']),
  auditAction('drivers.create_profile'),
  async (req, res, next) => {
    try {
      const parsed = createProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'INVALID_IP', message: 'Invalid host IP address', details: parsed.error.issues },
        });
      }

      const { hostIp } = parsed.data;
      const result = await driversService.createProfile(hostIp);
      const status = result.created ? 201 : 200;
      res.status(status).json({ data: result });
    } catch (error) {
      if (error.message === 'Command timeout') {
        return res.status(504).json({
          error: { code: 'SSH_TIMEOUT', message: `SSH timeout connecting to ${req.body.hostIp}` },
        });
      }
      if (error.statusCode === 502) {
        return res.status(502).json({
          error: { code: 'SSH_FAILED', message: error.message },
        });
      }
      if (error.message && error.message.includes('SSH') || error.message && error.message.includes('Connection')) {
        return res.status(502).json({
          error: { code: 'SSH_FAILED', message: `SSH connection to ${req.body.hostIp} failed: ${error.message}` },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_NAME', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * @openapi
 * /drivers/available-images:
 *   get:
 *     tags: [Drivers]
 *     summary: List available images (subdirectories containing .qcow2 files)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Array of available image names }
 */
router.get(
  '/available-images',
  authenticateToken,
  async (req, res, next) => {
    try {
      const images = await driversService.listAvailableImages();
      res.json({ data: images });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /drivers/profiles:
 *   get:
 *     tags: [Drivers]
 *     summary: List all driver profiles (folders containing a match.conf)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Array of driver profile objects }
 */
router.get(
  '/profiles',
  authenticateToken,
  async (req, res, next) => {
    try {
      const profiles = await driversService.listProfiles();
      res.json({ data: profiles });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /drivers/profiles/{name}:
 *   get:
 *     tags: [Drivers]
 *     summary: Get match.conf data for a specific driver profile
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *         description: Driver profile name
 *     responses:
 *       200: { description: Parsed match.conf data }
 *       400: { description: Invalid profile name }
 *       404: { description: Profile not found }
 */
router.get(
  '/profiles/:name',
  authenticateToken,
  async (req, res, next) => {
    try {
      const data = await driversService.getMatchConf(req.params.name);
      res.json({ data });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: error.message },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_NAME', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * @openapi
 * /drivers/profiles/{name}:
 *   delete:
 *     tags: [Drivers]
 *     summary: Delete an entire driver profile folder
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *         description: Driver profile name
 *     responses:
 *       200: { description: Profile deleted successfully }
 *       400: { description: Invalid profile name }
 *       404: { description: Profile not found }
 */
router.delete(
  '/profiles/:name',
  authenticateToken,
  requireRole(['admin']),
  auditAction('drivers.profile_delete'),
  async (req, res, next) => {
    try {
      const result = await driversService.deleteProfile(req.params.name);
      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: error.message },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_NAME', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * @openapi
 * /drivers/profiles/{name}/files:
 *   get:
 *     tags: [Drivers]
 *     summary: List all files in a driver profile (excludes match.conf)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *         description: Driver profile name
 *     responses:
 *       200: { description: Array of file objects in the profile }
 *       400: { description: Invalid profile name }
 *       404: { description: Profile not found }
 */
router.get(
  '/profiles/:name/files',
  authenticateToken,
  async (req, res, next) => {
    try {
      const files = await driversService.listFiles(req.params.name);
      res.json({ data: files });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: error.message },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_NAME', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * @openapi
 * /drivers/profiles/{name}/upload:
 *   post:
 *     tags: [Drivers]
 *     summary: Upload a file to a driver profile
 *     description: Accepts multipart/form-data with a "file" field and an optional "path" field for the relative destination path.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *         description: Driver profile name
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               path:
 *                 type: string
 *                 description: Optional relative destination path within the profile
 *     responses:
 *       201: { description: File uploaded successfully }
 *       400: { description: No file uploaded or invalid path }
 *       404: { description: Profile not found }
 */
router.post(
  '/profiles/:name/upload',
  authenticateToken,
  requireRole(['admin']),
  upload.single('file'),
  auditAction('drivers.file_upload'),
  async (req, res, next) => {
    const tempPath = req.file?.path;
    try {
      if (!req.file) {
        return res.status(400).json({
          error: { code: 'NO_FILE', message: 'No file uploaded' },
        });
      }

      const relPath = req.body.path || req.file.originalname;
      const buffer = await fs.readFile(tempPath);
      const result = await driversService.uploadFile(req.params.name, relPath, buffer);

      res.status(201).json({ data: result });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({ error: { code: 'INVALID_PATH', message: error.message } });
      }
      if (error.statusCode === 404) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: error.message } });
      }
      next(error);
    } finally {
      await cleanupTemp(tempPath);
    }
  }
);

/**
 * @openapi
 * /drivers/profiles/{name}/extract:
 *   post:
 *     tags: [Drivers]
 *     summary: Extract an uploaded archive into a driver profile
 *     description: Accepts a ZIP, EXE, or 7z archive via multipart/form-data and extracts its contents into the profile folder.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *         description: Driver profile name
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Archive file (ZIP, EXE, or 7z)
 *     responses:
 *       200: { description: Archive extracted successfully }
 *       400: { description: No file uploaded or invalid archive format }
 *       404: { description: Profile not found }
 */
router.post(
  '/profiles/:name/extract',
  authenticateToken,
  requireRole(['admin']),
  upload.single('file'),
  auditAction('drivers.archive_extract'),
  async (req, res, next) => {
    const tempPath = req.file?.path;
    try {
      if (!req.file) {
        return res.status(400).json({
          error: { code: 'NO_FILE', message: 'No archive file uploaded' },
        });
      }

      const result = await driversService.extractArchive(
        req.params.name, tempPath, req.file.originalname
      );
      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({ error: { code: 'INVALID_ARCHIVE', message: error.message } });
      }
      if (error.statusCode === 404) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: error.message } });
      }
      next(error);
    } finally {
      await cleanupTemp(tempPath);
    }
  }
);

/**
 * @openapi
 * /drivers/profiles/{name}/files:
 *   delete:
 *     tags: [Drivers]
 *     summary: Delete a file from a driver profile
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *         description: Driver profile name
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [path]
 *             properties:
 *               path:
 *                 type: string
 *                 description: Relative path of the file to delete within the profile
 *     responses:
 *       200: { description: File deleted successfully }
 *       400: { description: Invalid file path }
 *       404: { description: Profile or file not found }
 */
router.delete(
  '/profiles/:name/files',
  authenticateToken,
  requireRole(['admin']),
  auditAction('drivers.file_delete'),
  async (req, res, next) => {
    try {
      const parsed = fileDeleteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'INVALID_PATH', message: 'Invalid file path', details: parsed.error.issues },
        });
      }

      const result = await driversService.deleteFile(req.params.name, parsed.data.path);
      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: error.message },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_PATH', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * @openapi
 * /drivers/profiles/{name}/match-conf:
 *   get:
 *     tags: [Drivers]
 *     summary: Get match.conf data and raw content for a profile
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *         description: Driver profile name
 *     responses:
 *       200: { description: Parsed match.conf data with raw content }
 *       400: { description: Invalid profile name }
 *       404: { description: Profile not found }
 */
router.get(
  '/profiles/:name/match-conf',
  authenticateToken,
  async (req, res, next) => {
    try {
      const data = await driversService.getMatchConf(req.params.name);
      res.json({ data });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: error.message },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_NAME', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * @openapi
 * /drivers/profiles/{name}/match-conf:
 *   put:
 *     tags: [Drivers]
 *     summary: Update match.conf content for a profile
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *         description: Driver profile name
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content:
 *                 type: string
 *                 description: Raw match.conf file content (max 10240 characters)
 *     responses:
 *       200: { description: match.conf updated successfully }
 *       400: { description: Invalid content }
 *       404: { description: Profile not found }
 */
router.put(
  '/profiles/:name/match-conf',
  authenticateToken,
  requireRole(['admin']),
  auditAction('drivers.match_conf_update'),
  async (req, res, next) => {
    try {
      const parsed = matchConfUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'INVALID_CONTENT', message: 'Invalid match.conf content', details: parsed.error.issues },
        });
      }

      const result = await driversService.updateMatchConf(req.params.name, parsed.data.content);
      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: error.message },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_CONTENT', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * @openapi
 * /drivers/profiles/{name}/image:
 *   put:
 *     tags: [Drivers]
 *     summary: Assign an image to a driver profile
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *         description: Driver profile name
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [image]
 *             properties:
 *               image:
 *                 type: string
 *                 description: Image name to assign (alphanumeric, dots, hyphens, underscores)
 *                 example: "win10-PC-Raum123"
 *     responses:
 *       200: { description: Image assigned to profile }
 *       400: { description: Invalid image name }
 *       404: { description: Profile not found }
 */
router.put(
  '/profiles/:name/image',
  authenticateToken,
  requireRole(['admin']),
  auditAction('drivers.image_assign'),
  async (req, res, next) => {
    try {
      const parsed = imageAssignSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'INVALID_IMAGE', message: 'Invalid image name', details: parsed.error.issues },
        });
      }

      const result = await driversService.setProfileImage(req.params.name, parsed.data.image);
      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: error.message },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_IMAGE', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * @openapi
 * /drivers/profiles/{name}/image:
 *   delete:
 *     tags: [Drivers]
 *     summary: Remove image assignment from a driver profile
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *         description: Driver profile name
 *     responses:
 *       200: { description: Image assignment removed }
 *       400: { description: Invalid profile name }
 *       404: { description: Profile not found }
 */
router.delete(
  '/profiles/:name/image',
  authenticateToken,
  requireRole(['admin']),
  auditAction('drivers.image_remove'),
  async (req, res, next) => {
    try {
      const result = await driversService.removeProfileImage(req.params.name);
      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: error.message },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_NAME', message: error.message },
        });
      }
      next(error);
    }
  }
);

// =============================================================================
// Hardware Info (cached + live SSH)
// =============================================================================

/**
 * @openapi
 * /drivers/hwinfo/all:
 *   get:
 *     tags: [Drivers]
 *     summary: Return all cached hardware info entries from Redis
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Array of cached hwinfo objects with MAC addresses }
 */
router.get('/hwinfo/all', authenticateToken, async (req, res, next) => {
  try {
    const client = redis.getClient();
    const entries = [];

    await new Promise((resolve, reject) => {
      const stream = client.scanStream({ match: 'hwinfo:*', count: 100 });

      stream.on('data', async (keys) => {
        if (keys.length === 0) return;
        stream.pause();
        try {
          for (const key of keys) {
            const raw = await client.get(key);
            if (raw) {
              const parsed = JSON.parse(raw);
              // Extract MAC from key name (hwinfo:AA:BB:CC:DD:EE:FF)
              const mac = key.substring('hwinfo:'.length);
              entries.push({ ...parsed, mac });
            }
          }
          stream.resume();
        } catch (err) {
          stream.destroy();
          reject(err);
        }
      });

      stream.on('end', () => resolve());
      stream.on('error', reject);
    });

    res.json({ data: entries });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /drivers/hwinfo/scan:
 *   post:
 *     tags: [Drivers]
 *     summary: Trigger a background hardware info scan of all online hosts
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Scan initiated with summary of hosts scanned }
 */
router.post(
  '/hwinfo/scan',
  authenticateToken,
  requireRole(['admin']),
  auditAction('drivers.hwinfo_scan'),
  async (req, res, next) => {
    try {
      const result = await hwinfoScanner.scanAllOnline();
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /drivers/hwinfo/{ip}:
 *   get:
 *     tags: [Drivers]
 *     summary: Get hardware info from a LINBO client (cache-first, live SSH fallback)
 *     description: Returns cached hwinfo if available. Use ?refresh=true to force a live SSH scan.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ip
 *         required: true
 *         schema: { type: string }
 *         description: IPv4 address of the LINBO client
 *         example: "10.0.0.100"
 *       - in: query
 *         name: refresh
 *         schema: { type: string, enum: ["true", "false"] }
 *         description: Set to "true" to bypass cache and perform a live SSH scan
 *     responses:
 *       200: { description: Hardware info object with cached flag }
 *       400: { description: Invalid IPv4 address }
 *       502: { description: SSH connection to client failed }
 */
router.get('/hwinfo/:ip', authenticateToken, async (req, res, next) => {
  try {
    const { ip } = req.params;
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid IPv4 address' } });
    }

    const refresh = req.query.refresh === 'true';

    // Look up host MAC from sync cache for caching
    const client = redis.getClient();
    let hostMac = null;
    const macs = await client.smembers('sync:host:index');
    for (const mac of macs) {
      const json = await client.get(`sync:host:${mac}`);
      if (json) {
        const h = JSON.parse(json);
        if (h.ip === ip) {
          hostMac = mac;
          break;
        }
      }
    }

    // Try cache first (if MAC found and not refreshing)
    if (hostMac && !refresh) {
      const cached = await redis.get(hwinfoScanner.HWINFO_KEY_PREFIX + hostMac);
      if (cached) {
        return res.json({ data: { ...cached, cached: true } });
      }
    }

    // Live SSH scan
    const sshService = require('../services/ssh.service');
    const cmd = hwinfoScanner._buildSshCommand();
    const result = await sshService.executeCommand(ip, cmd, { timeout: 15000 });
    const output = result.stdout || result.output || '';
    const parsed = hwinfoScanner._parseHwinfoOutput(output, ip);

    // Cache if MAC known
    if (hostMac) {
      await redis.set(hwinfoScanner.HWINFO_KEY_PREFIX + hostMac, parsed, hwinfoScanner.HWINFO_TTL);
    }

    res.json({ data: { ...parsed, cached: false } });
  } catch (error) {
    if (error.message?.includes('ECONNREFUSED') || error.message?.includes('ETIMEDOUT') || error.message?.includes('authentication')) {
      return res.status(502).json({
        error: { code: 'SSH_ERROR', message: `Cannot reach client ${req.params.ip}: ${error.message}` },
      });
    }
    next(error);
  }
});

module.exports = router;
