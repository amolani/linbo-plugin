/**
 * LINBO Docker - Hooks Sub-Router
 * GET /system/hooks - list installed hooks with observability data
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const hookService = require('../../services/hook.service');

/**
 * @openapi
 * /system/hooks:
 *   get:
 *     tags: [Infrastructure]
 *     summary: List installed hooks with observability data
 *     description: >
 *       Returns all installed update-linbofs hooks (pre and post) with their
 *       type, executable status, and last exit codes.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of hooks with metadata
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
 *                       name:
 *                         type: string
 *                       type:
 *                         type: string
 *                         enum: [pre, post]
 *                       executable:
 *                         type: boolean
 */
router.get('/hooks', authenticateToken, async (req, res, next) => {
  try {
    const hooks = await hookService.getHooks();
    res.json({ data: hooks });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
