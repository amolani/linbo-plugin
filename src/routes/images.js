/**
 * LINBO Plugin - Images Routes
 * Image management via filesystem scanning (no database).
 *
 * Production layout: /srv/linbo/images/<base>/<base>.qcow2
 *
 * All endpoints operate on the filesystem directly.
 * No Prisma/PostgreSQL dependency.
 */

const express = require('express');
const router = express.Router();

const { authenticateToken, requireRole } = require('../middleware/auth');

// Audit middleware: optional
let auditAction;
try {
  auditAction = require('../middleware/audit').auditAction;
} catch {
  auditAction = () => (req, res, next) => next();
}

let redis, ws;
try {
  redis = require('../lib/redis');
  ws = require('../lib/websocket');
} catch {
  redis = { delPattern: async () => {} };
  ws = { broadcast: () => {} };
}

const fs = require('fs').promises;
const path = require('path');
const {
  IMAGE_EXTS,
  IMAGE_SUPPLEMENTS,
  IMAGES_DIR,
  LINBO_DIR,
  READABLE_TYPES,
  WRITABLE_TYPES,
  parseMainFilename,
  resolveImagePath,
  resolveImageDir,
  resolveSidecarPath,
  resolveSupplementPath,
  toRelativePath,
} = require('../lib/image-path');

/**
 * Scan filesystem for images.
 * Returns array of image objects built from filesystem metadata.
 */
async function scanFilesystemImages() {
  const images = [];

  // Scan canonical subdirectories in IMAGES_DIR
  try {
    const entries = await fs.readdir(IMAGES_DIR, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && e.name !== 'tmp' && e.name !== 'backups');

    for (const dir of dirs) {
      try {
        const files = await fs.readdir(path.join(IMAGES_DIR, dir.name));
        const imageFiles = files.filter(f => IMAGE_EXTS.some(ext => f.endsWith(ext)));

        for (const f of imageFiles) {
          try {
            parseMainFilename(f); // validate
          } catch {
            continue;
          }

          const filePath = path.join(IMAGES_DIR, dir.name, f);
          let fileStats = null;
          try {
            fileStats = await fs.stat(filePath);
          } catch { /* ignore */ }

          images.push({
            id: f, // use filename as ID in filesystem mode
            filename: f,
            type: f.includes('.qdiff') ? 'differential' : 'base',
            path: `images/${dir.name}/${f}`,
            absolutePath: filePath,
            size: fileStats ? fileStats.size : null,
            status: 'available',
            fileExists: true,
            modifiedAt: fileStats ? fileStats.mtime : null,
            createdAt: fileStats ? fileStats.birthtime : null,
          });
        }
      } catch (err) {
        console.warn(`[Images] Failed to read subdir ${dir.name}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[Images] Failed to scan images directory:', err.message);
  }

  // Scan legacy flat images in LINBO_DIR
  try {
    const flatFiles = await fs.readdir(LINBO_DIR);
    const legacyImages = flatFiles.filter(f => IMAGE_EXTS.some(ext => f.endsWith(ext)));

    for (const f of legacyImages) {
      // Skip if already found in canonical location
      if (images.some(i => i.filename === f)) continue;

      const filePath = path.join(LINBO_DIR, f);
      let fileStats = null;
      try {
        fileStats = await fs.stat(filePath);
      } catch { /* ignore */ }

      images.push({
        id: f,
        filename: f,
        type: f.includes('.qdiff') ? 'differential' : 'base',
        path: f,
        absolutePath: filePath,
        size: fileStats ? fileStats.size : null,
        status: 'legacy',
        fileExists: true,
        modifiedAt: fileStats ? fileStats.mtime : null,
        createdAt: fileStats ? fileStats.birthtime : null,
      });
    }
  } catch { /* LINBO_DIR read error */ }

  return images;
}

/**
 * @openapi
 * /images:
 *   get:
 *     tags: [Images]
 *     summary: List all images via filesystem scan
 *     description: |
 *       Scans the images directory and legacy LINBO directory for image files
 *       (.qcow2, .qdiff, .cloop). Returns an array of image objects with a
 *       summary breakdown by type. No database dependency.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of image objects with summary statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, description: Image filename }
 *                       filename: { type: string }
 *                       type: { type: string, enum: [base, differential] }
 *                       path: { type: string, description: Relative path }
 *                       absolutePath: { type: string }
 *                       size: { type: integer, nullable: true }
 *                       status: { type: string, enum: [available, legacy] }
 *                       fileExists: { type: boolean }
 *                       modifiedAt: { type: string, format: date-time, nullable: true }
 *                       createdAt: { type: string, format: date-time, nullable: true }
 *                 summary:
 *                   type: object
 *                   properties:
 *                     total: { type: integer }
 *                     registered: { type: integer }
 *                     unregistered: { type: integer }
 *                     imagesDir: { type: string }
 *                     byType:
 *                       type: object
 *                       properties:
 *                         base: { type: integer }
 *                         differential: { type: integer }
 *                         torrent: { type: integer }
 *       401: { description: Unauthorized - invalid or missing token }
 */
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const images = await scanFilesystemImages();
    const summary = {
      total: images.length,
      registered: 0,
      unregistered: images.length,
      imagesDir: IMAGES_DIR,
      byType: {
        base: images.filter(i => i.type === 'base').length,
        differential: images.filter(i => i.type === 'differential').length,
        torrent: 0,
      },
    };
    return res.json({ data: images, summary });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /images/{id}:
 *   get:
 *     tags: [Images]
 *     summary: Get single image details
 *     description: |
 *       Returns detailed information for a single image identified by its filename.
 *       Includes file stats and sidecar file availability (info, desc, torrent,
 *       macct, md5, reg, prestart, postsync).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Image filename (e.g. ubuntu22.qcow2)
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Image details with sidecar status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     filename: { type: string }
 *                     type: { type: string, enum: [base, differential] }
 *                     path: { type: string }
 *                     absolutePath: { type: string }
 *                     fileExists: { type: boolean }
 *                     size: { type: integer }
 *                     fileSize: { type: integer }
 *                     modifiedAt: { type: string, format: date-time }
 *                     createdAt: { type: string, format: date-time }
 *                     sidecars: { type: object, description: Sidecar existence and metadata keyed by type }
 *                     usedBy: { type: array, items: { type: object } }
 *       401: { description: Unauthorized }
 *       404: { description: Image not found }
 */
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const filename = req.params.id;
    let absPath;
    try {
      absPath = resolveImagePath(filename);
    } catch {
      return res.status(404).json({
        error: { code: 'IMAGE_NOT_FOUND', message: 'Image not found' },
      });
    }

    let stats;
    try {
      stats = await fs.stat(absPath);
    } catch {
      return res.status(404).json({
        error: { code: 'IMAGE_NOT_FOUND', message: 'Image file not found on disk' },
      });
    }

    const sidecars = await getSidecarDetails({ filename });

    return res.json({
      data: {
        id: filename,
        filename,
        type: filename.includes('.qdiff') ? 'differential' : 'base',
        path: toRelativePath(filename),
        absolutePath: absPath,
        fileExists: true,
        size: stats.size,
        fileSize: stats.size,
        modifiedAt: stats.mtime,
        createdAt: stats.birthtime,
        sidecars,
        usedBy: [],
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /images/{id}/verify:
 *   post:
 *     tags: [Images]
 *     summary: Verify image checksum
 *     description: |
 *       Computes the SHA-256 hash of the image file and compares it against
 *       the stored checksum in the .md5 sidecar file. Returns whether the
 *       checksums match along with both values.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Image filename (e.g. ubuntu22.qcow2)
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Verification result with stored and computed checksums
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     isValid: { type: boolean }
 *                     storedChecksum: { type: string }
 *                     computedChecksum: { type: string }
 *                     filename: { type: string }
 *       400: { description: No .md5 checksum file found for this image }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden - requires admin or operator role }
 *       404: { description: Image not found or image file not found on disk }
 */
router.post(
  '/:id/verify',
  authenticateToken,
  requireRole(['admin', 'operator']),
  async (req, res, next) => {
    try {
      const filename = req.params.id;
      let verifyPath;
      try {
        verifyPath = resolveImagePath(filename);
      } catch {
        return res.status(404).json({
          error: { code: 'IMAGE_NOT_FOUND', message: 'Image not found' },
        });
      }

      // Read .md5 sidecar for stored checksum
      let storedChecksum;
      try {
        const md5Path = resolveSidecarPath(filename, '.md5');
        const md5Content = await fs.readFile(md5Path, 'utf8');
        storedChecksum = md5Content.trim().split(/\s+/)[0];
      } catch {
        return res.status(400).json({
          error: { code: 'NO_CHECKSUM', message: 'No .md5 checksum file found for this image' },
        });
      }

      // Compute checksum
      const crypto = require('crypto');
      const stream = require('fs').createReadStream(verifyPath);
      const hash = crypto.createHash('sha256');

      await new Promise((resolve, reject) => {
        stream.on('data', data => hash.update(data));
        stream.on('end', resolve);
        stream.on('error', reject);
      });

      const computedChecksum = hash.digest('hex');
      const isValid = computedChecksum === storedChecksum;

      res.json({
        data: {
          isValid,
          storedChecksum,
          computedChecksum,
          filename,
        },
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'Image file not found on disk',
          },
        });
      }
      next(error);
    }
  }
);

/**
 * @openapi
 * /images/{id}/info:
 *   get:
 *     tags: [Images]
 *     summary: Get detailed image file info
 *     description: |
 *       Returns detailed filesystem metadata for the image file, including
 *       size with human-readable formatting, timestamps, and image type.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Image filename (e.g. ubuntu22.qcow2)
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Detailed image file information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     filename: { type: string }
 *                     type: { type: string, enum: [base, differential] }
 *                     path: { type: string, description: Relative path }
 *                     absolutePath: { type: string }
 *                     size: { type: integer, description: Size in bytes }
 *                     sizeFormatted: { type: string, description: Human-readable size }
 *                     modifiedAt: { type: string, format: date-time }
 *                     createdAt: { type: string, format: date-time }
 *                     backingImage: { type: string, nullable: true }
 *       401: { description: Unauthorized }
 *       404: { description: Image not found or file not found on disk }
 */
router.get(
  '/:id/info',
  authenticateToken,
  async (req, res, next) => {
    try {
      const filename = req.params.id;
      let infoPath, relPath;
      try {
        infoPath = resolveImagePath(filename);
        relPath = toRelativePath(filename);
      } catch {
        return res.status(404).json({
          error: { code: 'IMAGE_NOT_FOUND', message: 'Image not found' },
        });
      }

      const type = filename.includes('.qdiff') ? 'differential' : 'base';

      let stats;
      try {
        stats = await fs.stat(infoPath);
      } catch {
        return res.status(404).json({
          error: { code: 'FILE_NOT_FOUND', message: 'Image file not found on disk' },
        });
      }

      res.json({
        data: {
          filename,
          type,
          path: relPath,
          absolutePath: infoPath,
          size: stats.size,
          sizeFormatted: formatBytes(stats.size),
          modifiedAt: stats.mtime,
          createdAt: stats.birthtime,
          backingImage: null,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /images/{id}:
 *   delete:
 *     tags: [Images]
 *     summary: Delete an image from the filesystem
 *     description: |
 *       Deletes an image identified by filename. By default only removes the
 *       logical reference. Pass ?deleteFile=true to recursively delete the
 *       entire image directory (including all sidecars). Invalidates the
 *       images cache and broadcasts an image.deleted WebSocket event.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Image filename (e.g. ubuntu22.qcow2)
 *         schema: { type: string }
 *       - name: deleteFile
 *         in: query
 *         required: false
 *         description: Set to "true" to physically remove the image directory
 *         schema: { type: string, enum: ["true", "false"] }
 *     responses:
 *       200:
 *         description: Image deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     message: { type: string }
 *                     fileDeleted: { type: boolean, description: Whether the directory was physically removed }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden - requires admin role }
 *       404: { description: Image not found or file not found on disk }
 */
router.delete(
  '/:id',
  authenticateToken,
  requireRole(['admin']),
  auditAction('image.delete'),
  async (req, res, next) => {
    try {
      const filename = req.params.id;
      const { deleteFile } = req.query;

      // Verify the image exists
      let absPath;
      try {
        absPath = resolveImagePath(filename);
      } catch {
        return res.status(404).json({
          error: { code: 'IMAGE_NOT_FOUND', message: 'Image not found' },
        });
      }

      try {
        await fs.stat(absPath);
      } catch {
        return res.status(404).json({
          error: { code: 'IMAGE_NOT_FOUND', message: 'Image file not found on disk' },
        });
      }

      let fileDeleted = false;
      if (deleteFile === 'true') {
        try {
          const imageDir = resolveImageDir(filename);
          await fs.rm(imageDir, { recursive: true, force: true });
          console.log(`[Images] Deleted image directory: ${imageDir}`);
          fileDeleted = true;
        } catch (err) {
          console.error(`[Images] Failed to delete image directory:`, err.message);
        }
      }

      // Invalidate cache
      await redis.delPattern('images:*');

      // Broadcast WS event for reactive frontend
      ws.broadcast('image.deleted', { id: filename });

      res.json({
        data: {
          message: 'Image deleted successfully',
          fileDeleted,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// =============================================================================
// Sidecar helpers
// =============================================================================

const MAX_SIDECAR_READ_SIZE = 1 * 1024 * 1024; // 1 MB
const MAX_SIDECAR_WRITE_SIZE = 200 * 1024; // 200 KB

/**
 * Get full sidecar details for a single image (filesystem truth).
 */
async function getSidecarDetails(image) {
  const sidecars = {};
  const sidecarExts = ['.info', '.desc', '.torrent', '.macct', '.md5'];
  const supplementExts = ['.reg', '.prestart', '.postsync'];

  // Sidecars appended to image filename
  for (const ext of sidecarExts) {
    const type = ext.slice(1); // remove leading dot
    try {
      const filePath = resolveSidecarPath(image.filename, ext);
      const stats = await fs.stat(filePath);
      sidecars[type] = { exists: true, size: stats.size, modifiedAt: stats.mtime.toISOString() };
    } catch {
      sidecars[type] = { exists: false };
    }
  }

  // Supplements appended to base name
  for (const ext of supplementExts) {
    const type = ext.slice(1);
    try {
      const filePath = resolveSupplementPath(image.filename, ext);
      const stats = await fs.stat(filePath);
      sidecars[type] = { exists: true, size: stats.size, modifiedAt: stats.mtime.toISOString() };
    } catch {
      sidecars[type] = { exists: false };
    }
  }

  return sidecars;
}

/**
 * Resolve the filesystem path for a sidecar type.
 */
function resolveSidecarTypePath(imageFilename, type) {
  const sidecarTypes = ['info', 'desc', 'torrent', 'macct', 'md5'];
  const supplementTypes = ['reg', 'prestart', 'postsync'];

  if (sidecarTypes.includes(type)) {
    return resolveSidecarPath(imageFilename, '.' + type);
  } else if (supplementTypes.includes(type)) {
    return resolveSupplementPath(imageFilename, '.' + type);
  }
  return null;
}

/**
 * @openapi
 * /images/{id}/sidecars/{type}:
 *   get:
 *     tags: [Images]
 *     summary: Read sidecar file content
 *     description: |
 *       Reads the content of a sidecar or supplement file associated with an image.
 *       Readable types: desc, info, reg, prestart, postsync. Files larger than 1 MB
 *       are rejected with 413. Sidecar files (.info, .desc) are appended to the
 *       image filename; supplement files (.reg, .prestart, .postsync) are appended
 *       to the base name.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Image filename (e.g. ubuntu22.qcow2)
 *         schema: { type: string }
 *       - name: type
 *         in: path
 *         required: true
 *         description: Sidecar type to read
 *         schema: { type: string, enum: [desc, info, reg, prestart, postsync] }
 *     responses:
 *       200:
 *         description: Sidecar file content
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     type: { type: string }
 *                     content: { type: string, description: UTF-8 file content }
 *                     size: { type: integer }
 *                     modifiedAt: { type: string, format: date-time }
 *       400: { description: Invalid sidecar type }
 *       401: { description: Unauthorized }
 *       404: { description: Image not found or sidecar file not found }
 *       413: { description: Sidecar file exceeds 1 MB read limit }
 */
router.get(
  '/:id/sidecars/:type',
  authenticateToken,
  async (req, res, next) => {
    try {
      const { type } = req.params;

      if (!READABLE_TYPES.includes(type)) {
        return res.status(400).json({
          error: { code: 'INVALID_TYPE', message: `Invalid sidecar type. Allowed: ${READABLE_TYPES.join(', ')}` },
        });
      }

      const imageFilename = req.params.id;
      try {
        parseMainFilename(imageFilename);
      } catch {
        return res.status(404).json({ error: { code: 'IMAGE_NOT_FOUND', message: 'Image not found' } });
      }

      const filePath = resolveSidecarTypePath(imageFilename, type);
      if (!filePath) {
        return res.status(400).json({ error: { code: 'INVALID_TYPE', message: 'Unknown sidecar type' } });
      }

      let stats;
      try {
        stats = await fs.stat(filePath);
      } catch {
        return res.status(404).json({ error: { code: 'FILE_NOT_FOUND', message: `Sidecar file .${type} not found` } });
      }

      if (stats.size > MAX_SIDECAR_READ_SIZE) {
        return res.status(413).json({
          error: { code: 'FILE_TOO_LARGE', message: 'File too large for API, access via filesystem' },
        });
      }

      const content = await fs.readFile(filePath, 'utf8');

      res.json({
        data: { type, content, size: stats.size, modifiedAt: stats.mtime.toISOString() },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /images/{id}/sidecars/{type}:
 *   put:
 *     tags: [Images]
 *     summary: Write sidecar file content
 *     description: |
 *       Creates or overwrites a sidecar or supplement file for an image.
 *       Writable types: desc, reg, prestart, postsync. Content must be a
 *       UTF-8 string no larger than 200 KB. Ensures the image directory
 *       exists before writing. Invalidates the images cache and broadcasts
 *       an image.updated WebSocket event.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Image filename (e.g. ubuntu22.qcow2)
 *         schema: { type: string }
 *       - name: type
 *         in: path
 *         required: true
 *         description: Sidecar type to write
 *         schema: { type: string, enum: [desc, reg, prestart, postsync] }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content: { type: string, description: UTF-8 text content to write, maxLength: 204800 }
 *     responses:
 *       200:
 *         description: Sidecar updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     type: { type: string }
 *                     size: { type: integer, description: Written content size in bytes }
 *                     message: { type: string }
 *       400: { description: Invalid sidecar type, missing content, or content exceeds 200 KB limit }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden - requires admin or operator role }
 *       404: { description: Image not found }
 */
router.put(
  '/:id/sidecars/:type',
  authenticateToken,
  requireRole(['admin', 'operator']),
  auditAction('image.sidecar.update', {
    getTargetName: (req) => `${req.params.type}`,
  }),
  async (req, res, next) => {
    try {
      const { type } = req.params;
      const imageFilename = req.params.id;

      if (!WRITABLE_TYPES.includes(type)) {
        return res.status(400).json({
          error: { code: 'INVALID_TYPE', message: `Type not writable. Allowed: ${WRITABLE_TYPES.join(', ')}` },
        });
      }

      const { content } = req.body;
      if (content === undefined || typeof content !== 'string') {
        return res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'content (string) is required' },
        });
      }

      if (Buffer.byteLength(content, 'utf8') > MAX_SIDECAR_WRITE_SIZE) {
        return res.status(400).json({
          error: { code: 'CONTENT_TOO_LARGE', message: `Content exceeds ${MAX_SIDECAR_WRITE_SIZE / 1024}KB limit` },
        });
      }

      // Validate the image filename
      try {
        parseMainFilename(imageFilename);
      } catch {
        return res.status(404).json({ error: { code: 'IMAGE_NOT_FOUND', message: 'Image not found' } });
      }

      const filePath = resolveSidecarTypePath(imageFilename, type);
      if (!filePath) {
        return res.status(400).json({ error: { code: 'INVALID_TYPE', message: 'Unknown sidecar type' } });
      }

      // Ensure directory exists
      const imageDir = resolveImageDir(imageFilename);
      await fs.mkdir(imageDir, { recursive: true });

      // Write file
      await fs.writeFile(filePath, content, 'utf8');

      // Invalidate cache
      await redis.delPattern('images:*');

      ws.broadcast('image.updated', { id: imageFilename, name: imageFilename, sidecar: type });

      res.json({
        data: { type, size: Buffer.byteLength(content, 'utf8'), message: 'Sidecar updated' },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Format bytes to human readable
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

module.exports = router;
