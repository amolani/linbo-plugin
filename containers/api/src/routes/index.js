/**
 * LINBO Docker - Route Aggregator
 * All routes are sync-mode only (no Prisma/PostgreSQL).
 *
 * Exports an async factory function: await createRouter()
 * Must be called after Redis is connected.
 */

const express = require('express');

async function createRouter() {
  const router = express.Router();

  // ---------------------------------------------------------------------------
  // Routes (all sync-mode compatible, no Prisma dependency)
  // ---------------------------------------------------------------------------
  router.use('/auth', require('./auth'));
  router.use('/sync', require('./sync'));
  router.use('/internal', require('./internal'));
  router.use('/system', require('./system'));
  router.use('/drivers', require('./drivers'));
  router.use('/settings', require('./settings'));
  router.use('/terminal', require('./terminal'));
  router.use('/images', require('./images'));
  router.use('/operations', require('./sync-operations'));

  // API info endpoint
  router.get('/', (req, res) => {
    res.json({
      message: 'LINBO Docker API',
      version: 'v1',
      mode: 'sync',
      endpoints: {
        auth: {
          'POST /auth/login': 'Authenticate and get JWT token',
          'POST /auth/logout': 'Logout (invalidate token)',
          'GET /auth/me': 'Get current user info',
        },
        images: {
          'GET /images': 'List all images',
          'GET /images/:id': 'Get image details',
          'POST /images/:id/verify': 'Verify checksum',
          'GET /images/:id/info': 'Get detailed file info',
        },
        sync: {
          'GET /sync/mode': 'Get current operating mode (no auth)',
          'GET /sync/status': 'Get sync status (cursor, counts, LMN API health)',
          'GET /sync/hosts': 'List hosts from sync cache',
          'GET /sync/hosts/:mac': 'Get single host from sync cache',
          'GET /sync/configs': 'List configs from sync cache',
          'GET /sync/configs/:id': 'Get single config from sync cache',
          'GET /sync/configs/:id/preview': 'Preview start.conf file content',
          'GET /sync/stats': 'Aggregated sync statistics',
          'POST /sync/trigger': 'Trigger sync from LMN Authority API (admin)',
          'POST /sync/reset': 'Reset cursor for full re-sync (admin)',
        },
        operations: {
          'GET /operations': 'List operations (Redis-based)',
          'GET /operations/:id': 'Get operation with sessions',
          'GET /operations/scheduled': 'List scheduled onboot commands',
          'POST /operations/validate-commands': 'Validate command string',
          'POST /operations/direct': 'Execute commands via SSH (admin)',
          'POST /operations/schedule': 'Schedule onboot commands (admin)',
          'DELETE /operations/scheduled/:hostname': 'Cancel scheduled command (admin)',
          'POST /operations/wake': 'Wake hosts via WoL (admin)',
          'POST /operations/:id/cancel': 'Cancel operation (admin)',
        },
        system: {
          'POST /system/update-linbofs': 'Update linbofs64 with keys',
          'GET /system/linbofs-status': 'Check linbofs64 configuration',
          'GET /system/linbofs-info': 'Get linbofs64 file info',
          'GET /system/key-status': 'Check available SSH keys',
          'POST /system/initialize-keys': 'Generate missing SSH keys',
          'POST /system/generate-ssh-key': 'Generate specific SSH key',
          'POST /system/generate-dropbear-key': 'Generate Dropbear key',
          'POST /system/regenerate-grub-configs': 'Regenerate GRUB configs',
          'GET /system/linbo-version': 'Check installed and available LINBO version',
          'POST /system/linbo-update': 'Start LINBO update (admin)',
          'GET /system/linbo-update/status': 'Get update progress',
          'POST /system/linbo-update/cancel': 'Cancel running update (admin)',
        },
        settings: {
          'GET /settings': 'Get all settings (secrets masked)',
          'PUT /settings/:key': 'Update setting (admin)',
          'DELETE /settings/:key': 'Reset setting to default (admin)',
          'POST /settings/test-connection': 'Test authority API connection (admin)',
        },
        terminal: {
          'GET /terminal/sessions': 'List active terminal sessions',
          'DELETE /terminal/sessions/:id': 'Close a terminal session',
          'POST /terminal/test-connection': 'Test SSH connectivity to a host',
        },
        drivers: {
          'POST /drivers/create-profile': 'Create driver profile from LINBO client DMI (admin)',
          'GET /drivers/profiles': 'List driver profiles with match.conf',
          'GET /drivers/profiles/:name': 'Get match.conf for a profile',
          'DELETE /drivers/profiles/:name': 'Delete driver profile (admin)',
          'GET /drivers/profiles/:name/files': 'List files in a profile',
          'POST /drivers/profiles/:name/upload': 'Upload file to profile (admin)',
          'POST /drivers/profiles/:name/extract': 'Extract archive into profile (admin)',
          'DELETE /drivers/profiles/:name/files': 'Delete file from profile (admin)',
          'GET /drivers/profiles/:name/match-conf': 'Get match.conf data and raw content',
          'PUT /drivers/profiles/:name/match-conf': 'Update match.conf content (admin)',
          'GET /drivers/hwinfo/all': 'Get all cached hwinfo entries',
          'GET /drivers/hwinfo/:ip': 'Get hwinfo (cache-first, ?refresh=true for live)',
          'POST /drivers/hwinfo/scan': 'Trigger background hwinfo scan of online hosts (admin)',
        },
      },
      documentation: { swagger: '/docs', openapi: '/openapi.json' },
    });
  });

  return router;
}

module.exports = createRouter;
