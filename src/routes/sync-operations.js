/**
 * LINBO Plugin - Sync Operations Routes
 * Operations endpoints for sync mode (Redis-based, no Prisma).
 *
 * Endpoints:
 *   GET  /              — List operations (paginated)
 *   GET  /:id           — Get operation with sessions
 *   GET  /scheduled     — List scheduled onboot commands
 *   POST /validate-commands — Validate command string
 *   POST /direct        — Execute commands directly via SSH
 *   POST /schedule      — Schedule onboot commands (.cmd files)
 *   DELETE /scheduled/:hostname — Cancel scheduled command
 *   POST /wake          — Wake hosts via WoL
 *   POST /:id/cancel    — Cancel running operation
 */

const express = require('express');
const router = express.Router();
const syncOps = require('../services/sync-operations.service');

const {
  validateCommandString,
  listScheduledCommands,
  sanitizeHostname,
} = syncOps;

// Auth middleware
const auth = require('../middleware/auth');
const authenticate = auth.authenticateToken;
const requireAdmin = auth.requireRole(['admin']);

// All routes require authentication
router.use(authenticate);

// ---------------------------------------------------------------------------
// GET /operations — List operations
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /operations:
 *   get:
 *     tags: [Operations]
 *     summary: List operations (paginated)
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 25 }
 *         description: Items per page
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *         description: Filter by operation status
 *     responses:
 *       200: { description: Paginated list of operations }
 */
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 25, status } = req.query;
    const result = await syncOps.listOperations({
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 25,
      status: status || undefined,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /operations/scheduled — List scheduled onboot commands
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /operations/scheduled:
 *   get:
 *     tags: [Operations]
 *     summary: List scheduled onboot commands
 *     responses:
 *       200:
 *         description: Array of scheduled .cmd file entries
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get('/scheduled', async (req, res, next) => {
  try {
    const scheduled = await listScheduledCommands();
    res.json({ data: scheduled });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /operations/validate-commands — Validate command string
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /operations/validate-commands:
 *   post:
 *     tags: [Operations]
 *     summary: Validate a LINBO command string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [commands]
 *             properties:
 *               commands:
 *                 type: string
 *                 description: LINBO command string to validate
 *     responses:
 *       200:
 *         description: Validation result with parsed commands, known commands and special flags
 *       400:
 *         description: Missing commands field
 */
router.post('/validate-commands', async (req, res, next) => {
  try {
    const { commands } = req.body;
    if (!commands) {
      return res.status(400).json({
        error: {
          code: 'MISSING_COMMANDS',
          message: 'commands field is required',
        },
      });
    }

    const result = validateCommandString(commands);
    const { KNOWN_COMMANDS, SPECIAL_FLAGS } = require('../lib/linbo-commands');

    res.json({
      data: {
        valid: result.valid,
        error: result.error,
        parsed: result.commands,
        knownCommands: KNOWN_COMMANDS,
        specialFlags: SPECIAL_FLAGS,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /operations/direct — Execute commands directly via SSH
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /operations/direct:
 *   post:
 *     tags: [Operations]
 *     summary: Execute LINBO commands directly via SSH on target hosts
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [commands]
 *             properties:
 *               macs:
 *                 type: array
 *                 items: { type: string }
 *                 description: Filter by MAC addresses
 *               hostnames:
 *                 type: array
 *                 items: { type: string }
 *                 description: Filter by hostnames
 *               hostgroup:
 *                 type: string
 *                 description: Filter by host group
 *               room:
 *                 type: string
 *                 description: Filter by room
 *               commands:
 *                 type: string
 *                 description: LINBO command string to execute
 *               options:
 *                 type: object
 *                 description: Additional execution options
 *     responses:
 *       200:
 *         description: Operation result with per-host session outcomes
 *       400:
 *         description: Missing or invalid commands, or no host filter provided
 *       403:
 *         description: Admin role required
 */
router.post('/direct', requireAdmin, async (req, res, next) => {
  try {
    const { macs, hostnames, hostgroup, room, commands, options = {} } = req.body;

    if (!commands) {
      return res.status(400).json({
        error: { code: 'MISSING_COMMANDS', message: 'commands field is required' },
      });
    }

    const validation = validateCommandString(commands);
    if (!validation.valid) {
      return res.status(400).json({
        error: { code: 'INVALID_COMMANDS', message: validation.error },
      });
    }

    const filter = buildFilter({ macs, hostnames, hostgroup, room });
    if (!filter) {
      return res.status(400).json({
        error: { code: 'NO_FILTER', message: 'At least one filter (macs, hostnames, hostgroup, room) is required' },
      });
    }

    const result = await syncOps.executeDirectCommands(filter, commands, options);
    res.json({ data: result });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: { code: 'OPERATION_ERROR', message: error.message },
      });
    }
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /operations/schedule — Schedule onboot commands (.cmd files)
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /operations/schedule:
 *   post:
 *     tags: [Operations]
 *     summary: Schedule onboot commands by writing .cmd files for target hosts
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [commands]
 *             properties:
 *               macs:
 *                 type: array
 *                 items: { type: string }
 *                 description: Filter by MAC addresses
 *               hostnames:
 *                 type: array
 *                 items: { type: string }
 *                 description: Filter by hostnames
 *               hostgroup:
 *                 type: string
 *                 description: Filter by host group
 *               room:
 *                 type: string
 *                 description: Filter by room
 *               commands:
 *                 type: string
 *                 description: LINBO command string to schedule
 *               options:
 *                 type: object
 *                 description: Additional scheduling options
 *     responses:
 *       201:
 *         description: Commands scheduled successfully
 *       400:
 *         description: Missing or invalid commands, or no host filter provided
 *       403:
 *         description: Admin role required
 */
router.post('/schedule', requireAdmin, async (req, res, next) => {
  try {
    const { macs, hostnames, hostgroup, room, commands, options = {} } = req.body;

    if (!commands) {
      return res.status(400).json({
        error: { code: 'MISSING_COMMANDS', message: 'commands field is required' },
      });
    }

    const validation = validateCommandString(commands);
    if (!validation.valid) {
      return res.status(400).json({
        error: { code: 'INVALID_COMMANDS', message: validation.error },
      });
    }

    const filter = buildFilter({ macs, hostnames, hostgroup, room });
    if (!filter) {
      return res.status(400).json({
        error: { code: 'NO_FILTER', message: 'At least one filter (macs, hostnames, hostgroup, room) is required' },
      });
    }

    const result = await syncOps.scheduleOnbootCommands(filter, commands, options);
    res.status(201).json({ data: result });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: { code: 'OPERATION_ERROR', message: error.message },
      });
    }
    next(error);
  }
});

// ---------------------------------------------------------------------------
// DELETE /operations/scheduled/:hostname — Cancel scheduled command
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /operations/scheduled/{hostname}:
 *   delete:
 *     tags: [Operations]
 *     summary: Cancel a scheduled onboot command for a specific host
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: hostname
 *         required: true
 *         schema: { type: string }
 *         description: Hostname whose scheduled command should be cancelled
 *     responses:
 *       200:
 *         description: Scheduled command cancelled successfully
 *       400:
 *         description: Invalid hostname
 *       403:
 *         description: Admin role required
 *       404:
 *         description: No scheduled command found for the given hostname
 */
router.delete('/scheduled/:hostname', requireAdmin, async (req, res, next) => {
  try {
    sanitizeHostname(req.params.hostname);

    const { getOnbootCmdPath } = require('../lib/linbo-commands');
    const fsPromises = require('fs').promises;
    const cmdPath = getOnbootCmdPath(req.params.hostname);
    let deleted = false;
    try {
      await fsPromises.unlink(cmdPath);
      deleted = true;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    if (!deleted) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `No scheduled command found for host: ${req.params.hostname}`,
        },
      });
    }

    res.json({
      data: {
        message: 'Scheduled command cancelled',
        hostname: req.params.hostname,
      },
    });
  } catch (error) {
    if (error.message && error.message.includes('Invalid hostname')) {
      return res.status(400).json({
        error: { code: 'INVALID_HOSTNAME', message: error.message },
      });
    }
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /operations/wake — Wake hosts via WoL
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /operations/wake:
 *   post:
 *     tags: [Operations]
 *     summary: Wake hosts via Wake-on-LAN, optionally scheduling commands
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               macs:
 *                 type: array
 *                 items: { type: string }
 *                 description: Filter by MAC addresses
 *               hostnames:
 *                 type: array
 *                 items: { type: string }
 *                 description: Filter by hostnames
 *               hostgroup:
 *                 type: string
 *                 description: Filter by host group
 *               room:
 *                 type: string
 *                 description: Filter by room
 *               wait:
 *                 type: boolean
 *                 description: Whether to wait for hosts to come online
 *               commands:
 *                 type: string
 *                 description: LINBO commands to execute after wake
 *               onboot:
 *                 type: boolean
 *                 default: false
 *                 description: Schedule commands as onboot .cmd files
 *               noauto:
 *                 type: boolean
 *                 default: false
 *                 description: Disable autostart on woken hosts
 *               disablegui:
 *                 type: boolean
 *                 default: false
 *                 description: Disable GUI on woken hosts
 *     responses:
 *       200:
 *         description: WoL packets sent with optional command scheduling result
 *       400:
 *         description: Invalid commands or no host filter provided
 *       403:
 *         description: Admin role required
 */
router.post('/wake', requireAdmin, async (req, res, next) => {
  try {
    const {
      macs,
      hostnames,
      hostgroup,
      room,
      wait,
      commands,
      onboot = false,
      noauto = false,
      disablegui = false,
    } = req.body;

    // Validate commands if provided
    if (commands) {
      const validation = validateCommandString(commands);
      if (!validation.valid) {
        return res.status(400).json({
          error: { code: 'INVALID_COMMANDS', message: validation.error },
        });
      }
    }

    const filter = buildFilter({ macs, hostnames, hostgroup, room });
    if (!filter) {
      return res.status(400).json({
        error: { code: 'NO_FILTER', message: 'At least one filter (macs, hostnames, hostgroup, room) is required' },
      });
    }

    const result = await syncOps.wakeHosts(filter, {
      wait,
      commands,
      onboot,
      noauto,
      disablegui,
    });

    res.json({ data: result });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: { code: 'OPERATION_ERROR', message: error.message },
      });
    }
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /operations/:id — Get single operation with sessions
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /operations/{id}:
 *   get:
 *     tags: [Operations]
 *     summary: Get a single operation with its sessions
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Operation ID
 *     responses:
 *       200:
 *         description: Operation details including session data
 *       404:
 *         description: Operation not found
 */
router.get('/:id', async (req, res, next) => {
  try {
    const op = await syncOps.getOperation(req.params.id);

    if (!op) {
      return res.status(404).json({
        error: {
          code: 'OPERATION_NOT_FOUND',
          message: 'Operation not found',
        },
      });
    }

    res.json({ data: op });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /operations/:id/cancel — Cancel running operation
// ---------------------------------------------------------------------------
/**
 * @openapi
 * /operations/{id}/cancel:
 *   post:
 *     tags: [Operations]
 *     summary: Cancel a running operation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Operation ID to cancel
 *     responses:
 *       200:
 *         description: Operation cancelled successfully
 *       403:
 *         description: Admin role required
 */
router.post('/:id/cancel', requireAdmin, async (req, res, next) => {
  try {
    const result = await syncOps.cancelOperation(req.params.id);
    res.json({ data: result });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: { code: 'OPERATION_ERROR', message: error.message },
      });
    }
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Build filter object from request body.
 * Returns null if no valid filter found.
 */
function buildFilter({ macs, hostnames, hostgroup, room }) {
  if (macs && Array.isArray(macs) && macs.length > 0) {
    return { macs };
  }
  if (hostnames && Array.isArray(hostnames) && hostnames.length > 0) {
    return { hostnames };
  }
  if (hostgroup) {
    return { hostgroup, ...(room ? { room } : {}) };
  }
  if (room) {
    return { room };
  }
  return null;
}

module.exports = router;
