/**
 * LINBO Docker - Firmware Sub-Router
 * Endpoints: firmware-detect, firmware-entries, firmware-status,
 * firmware-available, firmware-catalog, firmware-entries/bulk
 */
const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { auditAction } = require('../../middleware/audit');
const ws = require('../../lib/websocket');
const { z } = require('zod');
const firmwareService = require('../../services/firmware.service');

const firmwareDetectSchema = z.object({
  hostIp: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, 'Invalid IPv4 address'),
});

const firmwareEntrySchema = z.object({
  entry: z.string().min(1).max(512),
});

const firmwareBulkSchema = z.object({
  entries: z.array(z.string().min(1).max(512)).min(1).max(500),
});

const firmwareSearchSchema = z.object({
  query: z.string().max(256).optional().default(''),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

/**
 * @openapi
 * /system/firmware-detect:
 *   post:
 *     tags: [Firmware]
 *     summary: Auto-detect missing firmware from a host via SSH
 *     description: Connects to a LINBO client via SSH and parses dmesg output to identify missing firmware files. Requires admin role.
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
 *                 format: ipv4
 *                 description: IPv4 address of the target host
 *     responses:
 *       200:
 *         description: Detected firmware list
 *       400:
 *         description: Invalid IP address
 *       502:
 *         description: SSH connection failed
 *       504:
 *         description: SSH connection timed out
 */
router.post(
  '/firmware-detect',
  authenticateToken,
  requireRole(['admin']),
  async (req, res, next) => {
    try {
      const parsed = firmwareDetectSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_IP',
            message: 'Invalid host IP address',
            details: parsed.error.issues,
          },
        });
      }

      const result = await firmwareService.detectFirmwareFromHost(parsed.data.hostIp);
      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 502) {
        return res.status(502).json({
          error: { code: 'SSH_FAILED', message: error.message },
        });
      }
      if (error.statusCode === 504) {
        return res.status(504).json({
          error: { code: 'SSH_TIMEOUT', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/firmware-entries:
 *   get:
 *     tags: [Firmware]
 *     summary: List configured firmware entries with validation status
 *     description: Returns all firmware entries from the configuration file, each with a validation status indicating whether the firmware file exists on the host.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of configured firmware entries
 */
router.get(
  '/firmware-entries',
  authenticateToken,
  async (req, res, next) => {
    try {
      const entries = await firmwareService.getFirmwareEntries();
      res.json({ data: entries });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/firmware-status:
 *   get:
 *     tags: [Firmware]
 *     summary: Get combined firmware status
 *     description: Returns firmware entries, statistics (total/valid/missing counts), and current linbofs rebuild state.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Combined firmware status
 */
router.get(
  '/firmware-status',
  authenticateToken,
  async (req, res, next) => {
    try {
      const status = await firmwareService.getFirmwareStatus();
      res.json({ data: status });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/firmware-entries:
 *   post:
 *     tags: [Firmware]
 *     summary: Add a firmware entry to the configuration
 *     description: Adds a single firmware path entry to the firmware configuration. Broadcasts system.firmware_changed WebSocket event. Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entry]
 *             properties:
 *               entry:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 512
 *                 description: Firmware file path to add
 *     responses:
 *       201:
 *         description: Firmware entry added
 *       400:
 *         description: Invalid entry
 *       404:
 *         description: Firmware file not found on filesystem
 *       409:
 *         description: Duplicate entry
 */
router.post(
  '/firmware-entries',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.firmware_add'),
  async (req, res, next) => {
    try {
      const parsed = firmwareEntrySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_ENTRY',
            message: 'Invalid firmware entry',
            details: parsed.error.issues,
          },
        });
      }

      const result = await firmwareService.addFirmwareEntry(parsed.data.entry);

      ws.broadcast('system.firmware_changed', {
        action: 'added',
        entry: result.entry,
        timestamp: new Date(),
      });

      res.status(201).json({ data: result });
    } catch (error) {
      if (error.statusCode === 409) {
        return res.status(409).json({
          error: { code: 'DUPLICATE_ENTRY', message: error.message },
        });
      }
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: { code: 'FIRMWARE_NOT_FOUND', message: error.message },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_ENTRY', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/firmware-entries/remove:
 *   post:
 *     tags: [Firmware]
 *     summary: Remove a firmware entry from the configuration
 *     description: Removes a single firmware path entry. Uses POST with body instead of DELETE to avoid URL encoding issues with firmware paths. Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entry]
 *             properties:
 *               entry:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 512
 *     responses:
 *       200:
 *         description: Firmware entry removed
 *       400:
 *         description: Invalid entry
 *       404:
 *         description: Entry not found in configuration
 */
router.post(
  '/firmware-entries/remove',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.firmware_remove'),
  async (req, res, next) => {
    try {
      const parsed = firmwareEntrySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_ENTRY',
            message: 'Invalid firmware entry',
            details: parsed.error.issues,
          },
        });
      }

      const result = await firmwareService.removeFirmwareEntry(parsed.data.entry);

      ws.broadcast('system.firmware_changed', {
        action: 'removed',
        entry: result.removed,
        timestamp: new Date(),
      });

      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: { code: 'ENTRY_NOT_FOUND', message: error.message },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_ENTRY', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/firmware-entries:
 *   delete:
 *     tags: [Firmware]
 *     summary: Remove a firmware entry (REST alias)
 *     description: >
 *       REST-style alias for POST /system/firmware-entries/remove.
 *       Accepts the firmware entry path in the request body. Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entry]
 *             properties:
 *               entry:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 512
 *     responses:
 *       200:
 *         description: Firmware entry removed
 *       400:
 *         description: Invalid entry
 *       404:
 *         description: Entry not found in configuration
 */
router.delete(
  '/firmware-entries',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.firmware_remove'),
  async (req, res, next) => {
    try {
      const parsed = firmwareEntrySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_ENTRY',
            message: 'Invalid firmware entry',
            details: parsed.error.issues,
          },
        });
      }

      const result = await firmwareService.removeFirmwareEntry(parsed.data.entry);

      ws.broadcast('system.firmware_changed', {
        action: 'removed',
        entry: result.removed,
        timestamp: new Date(),
      });

      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: { code: 'ENTRY_NOT_FOUND', message: error.message },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_ENTRY', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/firmware-available:
 *   get:
 *     tags: [Firmware]
 *     summary: Search available firmware files on the host filesystem
 *     description: Searches the host firmware directories for files matching the query string.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *           maxLength: 256
 *           default: ''
 *         description: Search filter string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 200
 *           default: 50
 *         description: Maximum number of results
 *     responses:
 *       200:
 *         description: List of matching firmware files
 *       400:
 *         description: Invalid search parameters
 */
router.get(
  '/firmware-available',
  authenticateToken,
  async (req, res, next) => {
    try {
      const parsed = firmwareSearchSchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_QUERY',
            message: 'Invalid search parameters',
            details: parsed.error.issues,
          },
        });
      }

      const results = await firmwareService.searchAvailableFirmware(
        parsed.data.query,
        parsed.data.limit
      );
      res.json({ data: results });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/firmware-catalog:
 *   get:
 *     tags: [Firmware]
 *     summary: Get firmware catalog with vendor categories
 *     description: Returns a structured firmware catalog grouped by vendor, with availability status. Optionally expands prefix entries to list individual files.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: expand
 *         schema:
 *           type: string
 *           enum: ['true', 'false']
 *         description: When "true", includes expandedFiles for prefix entries
 *     responses:
 *       200:
 *         description: Firmware catalog organized by vendor
 */
router.get(
  '/firmware-catalog',
  authenticateToken,
  async (req, res, next) => {
    try {
      const expand = req.query.expand === 'true';
      const catalog = await firmwareService.getFirmwareCatalog(expand);
      res.json({ data: catalog });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/firmware-entries/bulk:
 *   post:
 *     tags: [Firmware]
 *     summary: Add multiple firmware entries in one atomic write
 *     description: Adds up to 500 firmware entries atomically. Broadcasts system.firmware_changed WebSocket event if any entries are added. Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entries]
 *             properties:
 *               entries:
 *                 type: array
 *                 items:
 *                   type: string
 *                   minLength: 1
 *                   maxLength: 512
 *                 minItems: 1
 *                 maxItems: 500
 *     responses:
 *       200:
 *         description: Bulk add result with added/skipped counts
 *       400:
 *         description: Invalid entries
 */
router.post(
  '/firmware-entries/bulk',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.firmware_bulk_add'),
  async (req, res, next) => {
    try {
      const parsed = firmwareBulkSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_ENTRIES',
            message: 'Invalid bulk entries',
            details: parsed.error.issues,
          },
        });
      }

      const result = await firmwareService.addBulkFirmwareEntries(parsed.data.entries);

      if (result.added.length > 0) {
        ws.broadcast('system.firmware_changed', {
          action: 'bulk_added',
          count: result.added.length,
          timestamp: new Date(),
        });
      }

      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_ENTRIES', message: error.message },
        });
      }
      next(error);
    }
  }
);

module.exports = router;
