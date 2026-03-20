/**
 * LINBO Plugin - Linbofs Sub-Router
 * 8 endpoints: update-linbofs, linbofs-status, linbofs-info, patch-status,
 * key-status, initialize-keys, generate-ssh-key, generate-dropbear-key
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { auditAction } = require('../../middleware/audit');
const ws = require('../../lib/websocket');
const linbofsService = require('../../services/linbofs.service');

/**
 * @openapi
 * /system/update-linbofs:
 *   post:
 *     tags: [Boot & linbofs]
 *     summary: Rebuild linbofs64 with current SSH keys and password hash
 *     description: >
 *       Triggers update-linbofs.sh which repacks the linbofs64 initramfs.
 *       Auto-detects the active kernel variant and passes env vars for module selection.
 *       Requires admin role. Broadcasts start/completion WebSocket events.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: linbofs64 updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     success:
 *                       type: boolean
 *                     message:
 *                       type: string
 *                     output:
 *                       type: string
 *                     duration:
 *                       type: number
 *       500:
 *         description: linbofs64 update failed
 */
router.post(
  '/update-linbofs',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.update_linbofs'),
  async (req, res, next) => {
    try {
      // Broadcast start event
      ws.broadcast('system.linbofs_update_started', {
        timestamp: new Date(),
      });

      const result = await linbofsService.updateLinbofs();

      // Broadcast completion event
      ws.broadcast('system.linbofs_updated', {
        success: result.success,
        duration: result.duration,
        timestamp: new Date(),
      });

      if (result.success) {
        res.json({
          data: {
            success: true,
            message: 'linbofs64 updated successfully',
            output: result.output,
            duration: result.duration,
          },
        });
      } else {
        res.status(500).json({
          error: {
            code: 'UPDATE_LINBOFS_FAILED',
            message: 'Failed to update linbofs64',
            details: result.errors,
            output: result.output,
          },
        });
      }
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/linbofs-status:
 *   get:
 *     tags: [Boot & linbofs]
 *     summary: Check linbofs64 configuration status
 *     description: >
 *       Returns combined status including file info, content verification,
 *       available SSH/Dropbear keys, and patch health. Status is one of:
 *       missing, invalid, not_configured, partial, or ready.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Comprehensive linbofs64 status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       enum: [missing, invalid, not_configured, partial, ready, unknown]
 *                     message:
 *                       type: string
 *                     file:
 *                       type: object
 *                     contents:
 *                       type: object
 *                     availableKeys:
 *                       type: object
 *                     patchHealth:
 *                       type: object
 */
router.get(
  '/linbofs-status',
  authenticateToken,
  async (req, res, next) => {
    try {
      const [fileInfo, verification, keyFiles, patchStatus] = await Promise.all([
        linbofsService.getLinbofsInfo(),
        linbofsService.verifyLinbofs(),
        linbofsService.checkKeyFiles(),
        linbofsService.getPatchStatus(),
      ]);

      // Determine overall status
      let status = 'unknown';
      let message = '';

      if (!fileInfo.exists) {
        status = 'missing';
        message = 'linbofs64 file not found';
      } else if (!verification.valid) {
        status = 'invalid';
        message = 'linbofs64 file is invalid or corrupted';
      } else if (!verification.hasPasswordHash) {
        status = 'not_configured';
        message = 'linbofs64 missing password hash - run update-linbofs';
      } else if (!verification.hasAuthorizedKeys && !verification.hasDropbearKey) {
        status = 'partial';
        message = 'linbofs64 missing SSH keys - run update-linbofs';
      } else {
        status = 'ready';
        message = 'linbofs64 is properly configured';
      }

      res.json({
        data: {
          status,
          message,
          file: fileInfo,
          contents: verification,
          availableKeys: keyFiles,
          patchHealth: patchStatus,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/linbofs-info:
 *   get:
 *     tags: [Boot & linbofs]
 *     summary: Get detailed linbofs64 file information
 *     description: Returns file existence, size, modification time, and MD5 hash of linbofs64.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: linbofs64 file metadata
 */
router.get(
  '/linbofs-info',
  authenticateToken,
  async (req, res, next) => {
    try {
      const info = await linbofsService.getLinbofsInfo();
      res.json({ data: info });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/patch-status:
 *   get:
 *     tags: [Boot & linbofs]
 *     summary: Get linbofs64 build/patch completion status
 *     description: Returns whether the linbofs64 has been successfully built with all required patches applied.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Patch status object
 */
router.get(
  '/patch-status',
  authenticateToken,
  async (req, res, next) => {
    try {
      const status = await linbofsService.getPatchStatus();
      res.json({ data: status });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/key-status:
 *   get:
 *     tags: [Boot & linbofs]
 *     summary: Check available SSH and Dropbear keys
 *     description: >
 *       Returns lists of available Dropbear keys, SSH keys, and public keys,
 *       along with boolean flags indicating their presence.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Key availability status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     hasDropbearKeys:
 *                       type: boolean
 *                     hasSshKeys:
 *                       type: boolean
 *                     hasPublicKeys:
 *                       type: boolean
 *                     dropbearKeys:
 *                       type: array
 *                       items:
 *                         type: string
 *                     sshKeys:
 *                       type: array
 *                       items:
 *                         type: string
 *                     publicKeys:
 *                       type: array
 *                       items:
 *                         type: string
 */
router.get(
  '/key-status',
  authenticateToken,
  async (req, res, next) => {
    try {
      const keyFiles = await linbofsService.checkKeyFiles();

      const status = {
        hasDropbearKeys: keyFiles.dropbearKeys.length > 0,
        hasSshKeys: keyFiles.sshKeys.length > 0,
        hasPublicKeys: keyFiles.publicKeys.length > 0,
        ...keyFiles,
      };

      res.json({ data: status });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/initialize-keys:
 *   post:
 *     tags: [Boot & linbofs]
 *     summary: Generate missing SSH and Dropbear keys
 *     description: >
 *       Creates any SSH and Dropbear keys that do not already exist.
 *       Requires admin role. Broadcasts system.keys_initialized WebSocket event.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Key initialization result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                     created:
 *                       type: array
 *                       items:
 *                         type: string
 *                     existing:
 *                       type: array
 *                       items:
 *                         type: string
 */
router.post(
  '/initialize-keys',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.initialize_keys'),
  async (req, res, next) => {
    try {
      const result = await linbofsService.initializeKeys();

      ws.broadcast('system.keys_initialized', {
        created: result.created,
        timestamp: new Date(),
      });

      res.json({
        data: {
          message: result.created.length > 0
            ? `Created ${result.created.length} key(s)`
            : 'All keys already exist',
          created: result.created,
          existing: result.existing,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/generate-ssh-key:
 *   post:
 *     tags: [Boot & linbofs]
 *     summary: Generate a specific SSH key pair
 *     description: Generates an SSH key pair of the specified type. Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [rsa, ed25519, ecdsa]
 *                 default: ed25519
 *     responses:
 *       200:
 *         description: Key generated or already exists
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                     created:
 *                       type: boolean
 *       400:
 *         description: Invalid key type
 */
router.post(
  '/generate-ssh-key',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.generate_ssh_key'),
  async (req, res, next) => {
    try {
      const { type = 'ed25519' } = req.body;

      if (!['rsa', 'ed25519', 'ecdsa'].includes(type)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_KEY_TYPE',
            message: 'Key type must be one of: rsa, ed25519, ecdsa',
          },
        });
      }

      const result = await linbofsService.generateSshKeyPair(type);

      res.json({
        data: {
          message: result.created ? 'Key generated' : 'Key already exists',
          ...result,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/generate-dropbear-key:
 *   post:
 *     tags: [Boot & linbofs]
 *     summary: Generate a specific Dropbear host key
 *     description: Generates a Dropbear key of the specified type. Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [rsa, ed25519, ecdsa]
 *                 default: ed25519
 *     responses:
 *       200:
 *         description: Key generated or already exists
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                     created:
 *                       type: boolean
 *       400:
 *         description: Invalid key type
 */
router.post(
  '/generate-dropbear-key',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.generate_dropbear_key'),
  async (req, res, next) => {
    try {
      const { type = 'ed25519' } = req.body;

      if (!['rsa', 'ed25519', 'ecdsa'].includes(type)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_KEY_TYPE',
            message: 'Key type must be one of: rsa, ed25519, ecdsa',
          },
        });
      }

      const result = await linbofsService.generateDropbearKey(type);

      res.json({
        data: {
          message: result.created ? 'Key generated' : 'Key already exists',
          ...result,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
