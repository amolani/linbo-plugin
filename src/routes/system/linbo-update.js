/**
 * LINBO Plugin - LINBO Update Sub-Router
 * 4 endpoints: linbo-version, linbo-update POST, linbo-update/status, linbo-update/cancel
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { auditAction } = require('../../middleware/audit');
const linboUpdateService = require('../../services/linbo-update.service');

/** Wrap async route handlers so rejected promises forward to Express error handler. */
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * @openapi
 * /system/linbo-version:
 *   get:
 *     tags: [LINBO Update]
 *     summary: Check installed and available LINBO versions
 *     description: Returns the currently installed LINBO version and checks for available updates.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Version information
 */
router.get(
  '/linbo-version',
  authenticateToken,
  async (req, res, next) => {
    try {
      const info = await linboUpdateService.checkVersion();
      res.json({ data: info });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/linbo-update:
 *   post:
 *     tags: [LINBO Update]
 *     summary: Start a LINBO package update
 *     description: >
 *       Initiates a background update that downloads, extracts, provisions,
 *       and rebuilds LINBO components. Requires admin role. Returns immediately
 *       while the update runs asynchronously.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Update started
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     started:
 *                       type: boolean
 *       400:
 *         description: No update available
 *       409:
 *         description: Update already in progress
 */
router.post(
  '/linbo-update',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.linbo_update'),
  async (req, res, next) => {
    try {
      // Start update in background
      linboUpdateService.startUpdate().catch((err) => {
        if (err.message !== 'Update cancelled') {
          console.error('[LinboUpdate] Update failed:', err.message);
        }
      });

      res.json({ data: { started: true } });
    } catch (error) {
      if (error.statusCode === 409) {
        return res.status(409).json({
          error: { code: 'UPDATE_IN_PROGRESS', message: error.message },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: { code: 'NO_UPDATE', message: error.message },
        });
      }
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/linbo-update/status:
 *   get:
 *     tags: [LINBO Update]
 *     summary: Get current LINBO update progress
 *     description: Returns the current state of a running or completed LINBO update.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Update status
 */
router.get(
  '/linbo-update/status',
  authenticateToken,
  async (req, res, next) => {
    try {
      const status = await linboUpdateService.getStatus();
      res.json({ data: status });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/linbo-update/cancel:
 *   post:
 *     tags: [LINBO Update]
 *     summary: Cancel a running LINBO update
 *     description: Cancels the currently running LINBO update process. Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Update cancelled
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     cancelled:
 *                       type: boolean
 */
router.post(
  '/linbo-update/cancel',
  authenticateToken,
  requireRole(['admin']),
  asyncHandler(async (req, res) => {
    linboUpdateService.cancelUpdate();
    res.json({ data: { cancelled: true } });
  })
);

module.exports = router;
