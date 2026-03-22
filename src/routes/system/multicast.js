/**
 * LINBO Plugin - Multicast Management Routes
 * Controls multicast image distribution sessions.
 *
 * Endpoints:
 *   GET  /multicast/status  — Active sessions
 *   POST /multicast/start   — Start multicast
 *   POST /multicast/stop    — Stop multicast
 *   GET  /multicast/config  — Multicast config
 *   GET  /multicast/list    — Image→Port mapping
 */

'use strict';

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const multicastService = require('../../services/multicast.service');
const ws = require('../../lib/websocket');

/**
 * @openapi
 * /system/multicast/status:
 *   get:
 *     tags: [Infrastructure]
 *     summary: Get active multicast distribution sessions
 *     responses:
 *       200: { description: Multicast status }
 */
router.get('/multicast/status', authenticateToken, async (req, res, next) => {
  try {
    const result = await multicastService.status();
    res.json({ data: result });
  } catch (error) { next(error); }
});

/**
 * @openapi
 * /system/multicast/start:
 *   post:
 *     tags: [Infrastructure]
 *     summary: Start multicast distribution for all images
 *     responses:
 *       200: { description: Multicast started }
 */
router.post('/multicast/start', authenticateToken, requireRole(['admin']), async (req, res, next) => {
  try {
    const result = await multicastService.start();
    ws.broadcast('system.multicast_started', {});
    res.json({ data: result });
  } catch (error) { next(error); }
});

/**
 * @openapi
 * /system/multicast/stop:
 *   post:
 *     tags: [Infrastructure]
 *     summary: Stop all multicast sessions
 */
router.post('/multicast/stop', authenticateToken, requireRole(['admin']), async (req, res, next) => {
  try {
    const result = await multicastService.stop();
    ws.broadcast('system.multicast_stopped', {});
    res.json({ data: result });
  } catch (error) { next(error); }
});

/**
 * @openapi
 * /system/multicast/config:
 *   get:
 *     tags: [Infrastructure]
 *     summary: Get multicast configuration (PORTBASE, MINCLIENTS, etc.)
 */
router.get('/multicast/config', authenticateToken, async (req, res, next) => {
  try {
    const config = await multicastService.getConfig();
    res.json({ data: config });
  } catch (error) { next(error); }
});

/**
 * @openapi
 * /system/multicast/list:
 *   get:
 *     tags: [Infrastructure]
 *     summary: Get multicast image-to-port mapping
 */
router.get('/multicast/list', authenticateToken, async (req, res, next) => {
  try {
    const list = await multicastService.getMulticastList();
    res.json({ data: list });
  } catch (error) { next(error); }
});

module.exports = router;
