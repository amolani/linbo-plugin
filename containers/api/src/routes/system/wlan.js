/**
 * LINBO Docker - WLAN Sub-Router
 * 3 endpoints: wlan-config GET/PUT/DELETE
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { auditAction } = require('../../middleware/audit');
const { z } = require('zod');
const firmwareService = require('../../services/firmware.service');

const wlanConfigSchema = z.object({
  ssid: z.string().min(1).max(32),
  keyMgmt: z.enum(['WPA-PSK', 'NONE']),
  psk: z.string().max(128).optional(),
  scanSsid: z.boolean().optional(),
});

/**
 * @openapi
 * /system/wlan-config:
 *   get:
 *     tags: [Infrastructure]
 *     summary: Get current WLAN configuration
 *     description: Returns WLAN status and settings. The PSK value is never included in the response.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: WLAN configuration (PSK redacted)
 */
router.get(
  '/wlan-config',
  authenticateToken,
  async (req, res, next) => {
    try {
      const config = await firmwareService.getWlanConfig();
      res.json({ data: config });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/wlan-config:
 *   put:
 *     tags: [Infrastructure]
 *     summary: Update WLAN configuration
 *     description: Sets the WLAN SSID, key management, and optional PSK. PSK is redacted in audit logs. Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ssid, keyMgmt]
 *             properties:
 *               ssid:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 32
 *               keyMgmt:
 *                 type: string
 *                 enum: [WPA-PSK, NONE]
 *               psk:
 *                 type: string
 *                 maxLength: 128
 *               scanSsid:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Updated WLAN configuration
 *       400:
 *         description: Invalid WLAN configuration
 */
router.put(
  '/wlan-config',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.wlan_update', {
    getChanges: (req) => ({
      ssid: req.body.ssid,
      keyMgmt: req.body.keyMgmt,
      psk: req.body.psk ? '[REDACTED]' : undefined,
    }),
  }),
  async (req, res, next) => {
    try {
      const parsed = wlanConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_CONFIG',
            message: 'Invalid WLAN configuration',
            details: parsed.error.issues,
          },
        });
      }

      await firmwareService.setWlanConfig(parsed.data);
      const config = await firmwareService.getWlanConfig();
      res.json({ data: config });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'INVALID_CONFIG', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/wlan-config:
 *   delete:
 *     tags: [Infrastructure]
 *     summary: Disable WLAN
 *     description: Removes the wpa_supplicant.conf file to disable WLAN on boot clients. Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: WLAN disabled
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     enabled:
 *                       type: boolean
 *                       example: false
 */
router.delete(
  '/wlan-config',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.wlan_delete'),
  async (req, res, next) => {
    try {
      await firmwareService.disableWlan();
      res.json({ data: { enabled: false } });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
