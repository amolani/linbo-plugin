/**
 * LINBO Plugin - Terminal Routes
 * REST endpoints for SSH terminal session management.
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const terminalService = require('../services/terminal.service');
const sshService = require('../services/ssh.service');

// All terminal endpoints require authentication
router.use(authenticateToken);

/**
 * @openapi
 * /terminal/sessions:
 *   get:
 *     tags: [Terminal]
 *     summary: List active SSH terminal sessions
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Array of active session objects }
 */
router.get('/sessions', (req, res) => {
  const sessions = terminalService.listSessions();
  res.json({ data: sessions });
});

/**
 * @openapi
 * /terminal/sessions/{id}:
 *   delete:
 *     tags: [Terminal]
 *     summary: Close a terminal session by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Terminal session ID
 *     responses:
 *       200: { description: Session closed successfully }
 *       404: { description: Session not found }
 */
router.delete('/sessions/:id', (req, res) => {
  const session = terminalService.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Session not found' },
    });
  }
  terminalService.destroySession(req.params.id);
  res.json({ data: { message: 'Session closed' } });
});

/**
 * @openapi
 * /terminal/test-connection:
 *   post:
 *     tags: [Terminal]
 *     summary: Test SSH connectivity to a LINBO client
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
 *                 description: IPv4 address of the LINBO client to test
 *                 example: "10.0.0.100"
 *     responses:
 *       200: { description: Connection test result with success flag }
 *       400: { description: hostIp is required }
 */
router.post('/test-connection', async (req, res) => {
  const { hostIp } = req.body;
  if (!hostIp) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'hostIp is required' },
    });
  }

  try {
    const result = await sshService.testConnection(hostIp);
    res.json({ data: result });
  } catch (err) {
    res.json({ data: { success: false, error: err.message } });
  }
});

module.exports = router;
