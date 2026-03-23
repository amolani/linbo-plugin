/**
 * LINBO Plugin - System Routes Aggregator
 * Mounts all system sub-routers.
 */

const express = require('express');
const router = express.Router();

router.use('/', require('./linbofs'));
router.use('/', require('./kernel'));
router.use('/', require('./firmware'));
router.use('/', require('./wlan'));
router.use('/', require('./grub-theme'));
router.use('/', require('./grub-config'));
router.use('/', require('./linbo-update'));
router.use('/', require('./hooks'));
router.use('/', require('./torrent'));
router.use('/', require('./multicast'));
router.use('/', require('./boot-logs'));
router.use('/', require('./monitoring'));

// --- API Log Catchup Endpoint ---
/**
 * @openapi
 * /system/logs:
 *   get:
 *     tags: [Infrastructure]
 *     summary: Get recent API log entries
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 200
 *           maximum: 2000
 *         description: Number of recent log entries to return
 *     responses:
 *       200:
 *         description: Array of recent log entries
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 entries:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get('/logs', (req, res) => {
  const logStream = require('../../lib/logStream');
  const limit = Math.min(parseInt(req.query.limit) || 200, 2000);
  res.json({ entries: logStream.getRecentLogs(limit) });
});

// --- Service Log Endpoints ---
/**
 * @openapi
 * /system/containers:
 *   get:
 *     tags: [Infrastructure]
 *     summary: List system services
 *     description: Returns a list of running system services. Returns available=false if journald is not available.
 *     responses:
 *       200:
 *         description: Service list with availability flag
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 containers:
 *                   type: array
 *                   items:
 *                     type: object
 *                 available:
 *                   type: boolean
 */
router.get('/containers', async (req, res) => {
  const containerLogs = require('../../lib/containerLogs');
  if (!containerLogs.isAvailable()) {
    return res.json({ containers: [], available: false });
  }
  const containers = await containerLogs.listContainers();
  res.json({ containers, available: true });
});

/**
 * @openapi
 * /system/containers/{name}/logs:
 *   get:
 *     tags: [Infrastructure]
 *     summary: Get logs for a specific system service
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Container name
 *       - in: query
 *         name: tail
 *         schema:
 *           type: integer
 *           default: 200
 *           maximum: 2000
 *         description: Number of recent log lines to return
 *     responses:
 *       200:
 *         description: Log entries for the container
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 entries:
 *                   type: array
 *                   items:
 *                     type: object
 *                 container:
 *                   type: string
 *       503:
 *         description: Journald not available
 */
router.get('/containers/:name/logs', async (req, res) => {
  const containerLogs = require('../../lib/containerLogs');
  if (!containerLogs.isAvailable()) {
    return res.status(503).json({ error: 'Journald not available' });
  }
  const tail = Math.min(parseInt(req.query.tail) || 200, 2000);
  const entries = await containerLogs.getRecentLogs(req.params.name, tail);
  res.json({ entries, container: req.params.name });
});

module.exports = router;
