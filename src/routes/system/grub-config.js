/**
 * LINBO Plugin - GRUB Config Sub-Router
 * Uses grub-generator.js (DB-free) with Redis sync cache for host/config data.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { auditAction } = require('../../middleware/audit');
const ws = require('../../lib/websocket');
const grubGenerator = require('../../services/grub-generator');
const redisLib = require('../../lib/redis');

const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';
const GRUB_DIR = path.join(LINBO_DIR, 'boot/grub');
const HOSTCFG_DIR = path.join(GRUB_DIR, 'hostcfg');

/**
 * Load hosts and configs from Redis sync cache.
 * Returns { hosts, configs } arrays compatible with grub-generator.
 */
async function loadFromRedisCache() {
  const client = redisLib.getClient();

  // Load hosts
  const macs = await client.smembers('sync:host:index');
  const hosts = [];
  for (const mac of macs) {
    const json = await client.get(`sync:host:${mac}`);
    if (json) {
      const host = JSON.parse(json);
      hosts.push({
        mac: host.mac,
        hostname: host.hostname,
        ip: host.ip,
        hostgroup: host.hostgroup || host.config,
        pxeEnabled: host.pxeEnabled !== false,
      });
    }
  }

  // Load configs
  const configIds = await client.smembers('sync:config:index');
  const configs = [];
  for (const id of configIds) {
    const json = await client.get(`sync:config:${id}`);
    if (json) {
      const config = JSON.parse(json);
      if (config.content !== null) {
        configs.push({
          id,
          osEntries: config.osEntries || [],
          partitions: config.partitions || [],
          grubPolicy: config.grubPolicy || {},
        });
      }
    }
  }

  return { hosts, configs };
}

/**
 * @openapi
 * /system/regenerate-grub-configs:
 *   post:
 *     tags: [GRUB]
 *     summary: Regenerate all GRUB configs from Redis sync cache
 *     description: >
 *       Loads hosts and configs from the Redis sync cache and regenerates all GRUB
 *       configuration files and host symlinks. Broadcasts system.grub_configs_regenerated
 *       WebSocket event. Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Regeneration result with counts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                     configs:
 *                       type: integer
 *                       description: Number of config files generated
 *                     hosts:
 *                       type: integer
 *                       description: Number of host symlinks created
 */
router.post(
  '/regenerate-grub-configs',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.regenerate_grub_configs'),
  async (req, res, next) => {
    try {
      const { hosts, configs } = await loadFromRedisCache();
      const result = await grubGenerator.regenerateAll(hosts, configs);

      ws.broadcast('system.grub_configs_regenerated', {
        configs: result.configs,
        hosts: result.hosts,
        timestamp: new Date(),
      });

      res.json({
        data: {
          message: `Generated ${result.configs} config files and ${result.hosts} host symlinks`,
          ...result,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/grub-configs:
 *   get:
 *     tags: [GRUB]
 *     summary: List all GRUB config files
 *     description: >
 *       Reads the GRUB directory on the filesystem and returns all config files
 *       and host configs with symlink information.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: GRUB config and host config listings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     configs:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: Config names (without .cfg extension)
 *                     hosts:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           isSymlink:
 *                             type: boolean
 *                           target:
 *                             type: string
 */
router.get(
  '/grub-configs',
  authenticateToken,
  async (req, res, next) => {
    try {
      const configs = [];
      const hosts = [];

      // List config GRUB files
      try {
        const files = await fs.readdir(GRUB_DIR);
        for (const file of files) {
          if (file.endsWith('.cfg') && file !== 'grub.cfg') {
            configs.push(file.replace('.cfg', ''));
          }
        }
      } catch (error) {
        // Directory doesn't exist
      }

      // List host configs with symlink info
      try {
        const files = await fs.readdir(HOSTCFG_DIR);
        for (const file of files) {
          if (file.endsWith('.cfg')) {
            const filepath = path.join(HOSTCFG_DIR, file);
            const name = file.replace('.cfg', '');
            try {
              const stat = await fs.lstat(filepath);
              if (stat.isSymbolicLink()) {
                const target = await fs.readlink(filepath);
                hosts.push({ name, isSymlink: true, target });
              } else {
                hosts.push({ name, isSymlink: false });
              }
            } catch (error) {
              hosts.push({ name, isSymlink: false, error: error.message });
            }
          }
        }
      } catch (error) {
        // Directory doesn't exist
      }

      res.json({ data: { configs, hosts } });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /system/cleanup-grub-configs:
 *   post:
 *     tags: [GRUB]
 *     summary: Remove orphaned GRUB config files
 *     description: >
 *       Compares GRUB config files on the filesystem against the Redis sync cache
 *       and removes any configs or host configs that are no longer referenced.
 *       Requires admin role.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cleanup result with lists of removed items
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                     removedConfigs:
 *                       type: array
 *                       items:
 *                         type: string
 *                     removedHosts:
 *                       type: array
 *                       items:
 *                         type: string
 */
router.post(
  '/cleanup-grub-configs',
  authenticateToken,
  requireRole(['admin']),
  auditAction('system.cleanup_grub_configs'),
  async (req, res, next) => {
    try {
      const { hosts, configs } = await loadFromRedisCache();
      const validConfigs = new Set(configs.map(c => c.id));
      const validHosts = new Set(hosts.map(h => h.hostname).filter(Boolean));

      const removedConfigs = [];
      const removedHosts = [];

      // Check config GRUB files
      try {
        const files = await fs.readdir(GRUB_DIR);
        for (const file of files) {
          if (file.endsWith('.cfg') && file !== 'grub.cfg') {
            const configName = file.replace('.cfg', '');
            if (!validConfigs.has(configName)) {
              await fs.unlink(path.join(GRUB_DIR, file)).catch(() => {});
              removedConfigs.push(configName);
            }
          }
        }
      } catch (error) {
        // Directory doesn't exist
      }

      // Check host configs
      try {
        const files = await fs.readdir(HOSTCFG_DIR);
        for (const file of files) {
          if (file.endsWith('.cfg')) {
            const hostname = file.replace('.cfg', '');
            if (!validHosts.has(hostname)) {
              await fs.unlink(path.join(HOSTCFG_DIR, file)).catch(() => {});
              removedHosts.push(hostname);
            }
          }
        }
      } catch (error) {
        // Directory doesn't exist
      }

      res.json({
        data: {
          message: `Removed ${removedConfigs.length} config files and ${removedHosts.length} host configs`,
          removedConfigs,
          removedHosts,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
