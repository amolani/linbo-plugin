/**
 * LINBO Plugin - Torrent Management Routes
 * Controls BitTorrent seeding for image distribution.
 *
 * Endpoints:
 *   GET  /torrent/status    — Active sessions
 *   POST /torrent/start     — Start seeding
 *   POST /torrent/stop      — Stop seeding
 *   POST /torrent/create    — Create .torrent file
 *   POST /torrent/check     — Verify torrent
 *   GET  /torrent/config    — Seeding config
 */

'use strict';

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const torrentService = require('../../services/torrent.service');
const ws = require('../../lib/websocket');

/**
 * @openapi
 * /system/torrent/status:
 *   get:
 *     tags: [Infrastructure]
 *     summary: Get active torrent seeding sessions
 *     responses:
 *       200: { description: Torrent status with active sessions }
 */
router.get('/torrent/status', authenticateToken, async (req, res, next) => {
  try {
    const result = await torrentService.status();
    res.json({ data: result });
  } catch (error) { next(error); }
});

/**
 * @openapi
 * /system/torrent/start:
 *   post:
 *     tags: [Infrastructure]
 *     summary: Start torrent seeding (all or specific image)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               image: { type: string, description: Image name (optional, all if omitted) }
 *     responses:
 *       200: { description: Torrent started }
 */
router.post('/torrent/start', authenticateToken, requireRole(['admin']), async (req, res, next) => {
  try {
    const result = await torrentService.start(req.body.image);
    ws.broadcast('system.torrent_started', { image: req.body.image || 'all' });
    res.json({ data: result });
  } catch (error) { next(error); }
});

/**
 * @openapi
 * /system/torrent/stop:
 *   post:
 *     tags: [Infrastructure]
 *     summary: Stop torrent seeding (all or specific image)
 */
router.post('/torrent/stop', authenticateToken, requireRole(['admin']), async (req, res, next) => {
  try {
    const result = await torrentService.stop(req.body.image);
    ws.broadcast('system.torrent_stopped', { image: req.body.image || 'all' });
    res.json({ data: result });
  } catch (error) { next(error); }
});

/**
 * @openapi
 * /system/torrent/create:
 *   post:
 *     tags: [Infrastructure]
 *     summary: Create .torrent file for an image
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [image]
 *             properties:
 *               image: { type: string }
 */
router.post('/torrent/create', authenticateToken, requireRole(['admin']), async (req, res, next) => {
  try {
    if (!req.body.image) {
      return res.status(400).json({ error: { code: 'MISSING_IMAGE', message: 'image field is required' } });
    }
    const result = await torrentService.create(req.body.image);
    res.json({ data: result });
  } catch (error) { next(error); }
});

/**
 * @openapi
 * /system/torrent/check:
 *   post:
 *     tags: [Infrastructure]
 *     summary: Verify torrent integrity for an image
 */
router.post('/torrent/check', authenticateToken, requireRole(['admin']), async (req, res, next) => {
  try {
    if (!req.body.image) {
      return res.status(400).json({ error: { code: 'MISSING_IMAGE', message: 'image field is required' } });
    }
    const result = await torrentService.check(req.body.image);
    res.json({ data: result });
  } catch (error) { next(error); }
});

/**
 * @openapi
 * /system/torrent/config:
 *   get:
 *     tags: [Infrastructure]
 *     summary: Get torrent seeding configuration
 */
router.get('/torrent/config', authenticateToken, async (req, res, next) => {
  try {
    const config = await torrentService.getConfig();
    res.json({ data: config });
  } catch (error) { next(error); }
});

module.exports = router;
