/**
 * LINBO Plugin - Settings Routes
 *
 * GET    /settings              — All settings (secrets masked)
 * PUT    /settings/:key         — Update setting (admin)
 * DELETE /settings/:key         — Reset setting to default (admin)
 * POST   /settings/test-connection — Test authority API connection (admin)
 */

const express = require('express');
const router = express.Router();
const settings = require('../services/settings.service');
const auth = require('../middleware/auth');

const authenticate = auth.authenticateToken;
const requireAdmin = auth.requireRole(['admin']);

// Auth on all routes
router.use(authenticate);

/**
 * @openapi
 * /settings:
 *   get:
 *     tags: [Settings]
 *     summary: Get all settings with secrets masked
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Array of setting objects with source and masked values }
 */
router.get('/', async (req, res, next) => {
  try {
    const data = await settings.getAll();
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /settings/test-connection:
 *   post:
 *     tags: [Settings]
 *     summary: Test LMN Authority API connectivity
 *     description: Tests connection to linuxmuster-api via JWT auth (HTTP Basic). Optionally pass url, user, and password to test before saving.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               url: { type: string, description: Override LMN API URL to test }
 *               user: { type: string, description: Override LMN API user }
 *               password: { type: string, description: Override LMN API password }
 *     responses:
 *       200: { description: Connection test result with reachable, healthy, version, and latency }
 */
router.post('/test-connection', requireAdmin, async (req, res, next) => {
  try {
    const url = req.body.url || await settings.get('lmn_api_url');

    const start = Date.now();
    let reachable = false;
    let healthy = false;
    let version = null;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      // JWT auth via HTTP Basic Auth: GET /v1/auth/
      const user = req.body.user || await settings.get('lmn_api_user');
      const pass = req.body.password || await settings.get('lmn_api_password');
      let token;
      const basicAuth = Buffer.from(`${user}:${pass}`).toString('base64');
      const loginResp = await fetch(`${url}/v1/auth/`, {
        headers: { 'Authorization': `Basic ${basicAuth}` },
        signal: controller.signal,
      });
      if (loginResp.ok) {
        const raw = await loginResp.text();
        token = raw.replace(/^"|"$/g, '');
      }

      const response = await fetch(`${url}/v1/linbo/health`, {
        headers: { 'X-API-Key': token, 'Accept': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      reachable = true;
      if (response.ok) {
        const data = await response.json();
        healthy = data.status === 'ok';
        version = data.version || null;
      }
    } catch {
      // reachable stays false
    }

    const latency = Date.now() - start;
    res.json({ data: { reachable, healthy, version, latency } });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /settings/{key}:
 *   put:
 *     tags: [Settings]
 *     summary: Update a setting value
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *         description: Setting key (e.g. lmn_api_url, linbo_server_ip, admin_password)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [value]
 *             properties:
 *               value: { type: string, description: New value for the setting }
 *     responses:
 *       200: { description: Updated setting with masked value if secret }
 *       400: { description: Unknown setting key or invalid value }
 */
router.put('/:key', requireAdmin, async (req, res, next) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined || value === null) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'value is required' },
      });
    }

    await settings.set(key, value);

    // Return the updated setting (via getAll to get proper masking)
    const all = await settings.getAll();
    // For admin_password, the stored key is admin_password_hash
    const lookupKey = key === 'admin_password' ? 'admin_password_hash' : key;
    const updated = all.find(s => s.key === lookupKey);

    res.json({ data: updated || { key: lookupKey, source: 'redis' } });
  } catch (err) {
    if (err.message.startsWith('Unknown setting') || err.message.startsWith('Cannot set') || err.message.startsWith('Invalid value') || err.message.startsWith('Setting')) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: err.message },
      });
    }
    next(err);
  }
});

/**
 * @openapi
 * /settings/{key}:
 *   delete:
 *     tags: [Settings]
 *     summary: Reset a setting to its default value
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *         description: Setting key to reset
 *     responses:
 *       200: { description: Setting reset confirmation with key }
 *       400: { description: Unknown setting key }
 */
router.delete('/:key', requireAdmin, async (req, res, next) => {
  try {
    const { key } = req.params;
    await settings.reset(key);
    res.json({ data: { success: true, key } });
  } catch (err) {
    if (err.message.startsWith('Unknown setting')) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: err.message },
      });
    }
    next(err);
  }
});

module.exports = router;
