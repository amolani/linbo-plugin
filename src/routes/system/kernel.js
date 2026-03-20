/**
 * LINBO Plugin - Kernel Sub-Router
 * 5 endpoints: kernel-variants, kernel-active, kernel-status, kernel-switch, kernel-repair
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { auditAction } = require('../../middleware/audit');
const ws = require('../../lib/websocket');
const { z } = require('zod');
const kernelService = require('../../services/kernel.service');

const kernelSwitchSchema = z.object({
  variant: z.enum(['stable', 'longterm', 'legacy']),
});

const kernelRepairSchema = z.object({
  rebuild: z.boolean().optional().default(false),
});

/**
 * @openapi
 * /system/kernel-variants:
 *   get:
 *     tags: [Kernel]
 *     summary: List available kernel variants
 *     description: Returns all available kernel variants (stable, longterm, legacy) with their versions and file sizes.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of kernel variants with version info
 */
router.get(
  '/kernel-variants',
  authenticateToken,
  async (req, res, next) => {
    try {
      const variants = await kernelService.listKernelVariants();
      res.json({ data: variants });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/kernel-active:
 *   get:
 *     tags: [Kernel]
 *     summary: Get the currently active kernel variant
 *     description: Returns which kernel variant (stable, longterm, or legacy) is currently selected as active.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active kernel variant information
 */
router.get(
  '/kernel-active',
  authenticateToken,
  async (req, res, next) => {
    try {
      const active = await kernelService.getActiveKernel();
      res.json({ data: active });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/kernel-status:
 *   get:
 *     tags: [Kernel]
 *     summary: Get combined kernel status
 *     description: Returns all kernel variants, the currently active variant, and the current linbofs rebuild state in a single response.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Combined kernel status
 */
router.get(
  '/kernel-status',
  authenticateToken,
  async (req, res, next) => {
    try {
      const status = await kernelService.getKernelStatus();
      res.json({ data: status });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/kernel-switch:
 *   post:
 *     tags: [Kernel]
 *     summary: Switch to a different kernel variant
 *     description: >
 *       Switches the active kernel to the specified variant and triggers a linbofs64 rebuild.
 *       Broadcasts WebSocket events for start, success, and failure. Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [variant]
 *             properties:
 *               variant:
 *                 type: string
 *                 enum: [stable, longterm, legacy]
 *     responses:
 *       200:
 *         description: Kernel switch initiated with job ID
 *       400:
 *         description: Invalid kernel variant
 *       409:
 *         description: A linbofs rebuild is already in progress
 */
router.post(
  '/kernel-switch',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.kernel_switch'),
  async (req, res, next) => {
    try {
      const parsed = kernelSwitchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'INVALID_VARIANT',
            message: 'Invalid kernel variant',
            details: parsed.error.issues,
          },
        });
      }

      const { variant } = parsed.data;

      ws.broadcast('system.kernel_switch_started', {
        variant,
        timestamp: new Date(),
      });

      const result = await kernelService.switchKernel(variant);

      // Monitor rebuild completion for WS events (best-effort)
      (async () => {
        const startTime = Date.now();
        const maxWait = 300000; // 5 minutes
        while (Date.now() - startTime < maxWait) {
          await new Promise(r => setTimeout(r, 2000));
          const state = await kernelService.readKernelState();
          if (state.rebuildStatus !== 'running') {
            if (state.rebuildStatus === 'completed') {
              ws.broadcast('system.kernel_switched', {
                variant,
                jobId: result.jobId,
                timestamp: new Date(),
              });
            } else {
              ws.broadcast('system.kernel_switch_failed', {
                variant,
                jobId: result.jobId,
                error: state.lastError,
                timestamp: new Date(),
              });
            }
            break;
          }
        }
      })().catch(err => console.warn('[Kernel] background rebuild failed:', err.message));

      res.json({ data: result });
    } catch (error) {
      if (error.statusCode === 409) {
        return res.status(409).json({
          error: {
            code: 'REBUILD_IN_PROGRESS',
            message: error.message,
          },
        });
      }
      if (error.statusCode === 400) {
        return res.status(400).json({
          error: {
            code: 'INVALID_VARIANT',
            message: error.message,
          },
        });
      }
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/kernel-repair:
 *   post:
 *     tags: [Kernel]
 *     summary: Repair kernel configuration
 *     description: >
 *       Resets the custom_kernel setting to "stable" to heal a broken configuration.
 *       Optionally triggers a linbofs rebuild after repair. Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rebuild:
 *                 type: boolean
 *                 default: false
 *                 description: Whether to trigger a linbofs rebuild after repair
 *     responses:
 *       200:
 *         description: Config repaired, optionally with rebuild job ID
 *       409:
 *         description: A linbofs rebuild is already in progress
 */
router.post(
  '/kernel-repair',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.kernel_repair'),
  async (req, res, next) => {
    try {
      const parsed = kernelRepairSchema.safeParse(req.body || {});
      const rebuild = parsed.success ? parsed.data.rebuild : false;

      const repairResult = await kernelService.repairConfig();

      if (rebuild) {
        // Trigger rebuild after repair
        const switchResult = await kernelService.switchKernel('stable');
        return res.json({
          data: {
            message: 'Config repaired and rebuild started',
            variant: repairResult.variant,
            jobId: switchResult.jobId,
          },
        });
      }

      res.json({
        data: {
          message: 'Config repaired (no rebuild)',
          variant: repairResult.variant,
        },
      });
    } catch (error) {
      if (error.statusCode === 409) {
        return res.status(409).json({
          error: {
            code: 'REBUILD_IN_PROGRESS',
            message: error.message,
          },
        });
      }
      next(error);
    }
  }
);

module.exports = router;
