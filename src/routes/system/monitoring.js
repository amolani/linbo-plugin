/**
 * LINBO Plugin - Monitoring Routes
 * Comprehensive system health checks accessible via API.
 *
 * Endpoints:
 *   GET /monitoring          — Full monitoring status (all checks)
 *   GET /monitoring/summary  — Quick pass/fail summary
 */

'use strict';

const express = require('express');
const router = express.Router();
const fsp = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { authenticateToken } = require('../../middleware/auth');

const execFileAsync = promisify(execFile);
const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';

/**
 * Run a single check. Returns { name, status, detail, critical }.
 */
async function runCheck(name, critical, fn) {
  try {
    const detail = await fn();
    return { name, status: 'ok', detail, critical };
  } catch (err) {
    return { name, status: critical ? 'fail' : 'warn', detail: err.message, critical };
  }
}

/**
 * Check if a systemd service is active.
 */
async function checkService(name) {
  const { stdout } = await execFileAsync('systemctl', ['is-active', name]);
  if (stdout.trim() !== 'active') throw new Error('inactive');
  return 'active';
}

/**
 * Run all monitoring checks.
 */
async function runAllChecks() {
  const checks = await Promise.all([
    // Critical services
    runCheck('linbo-api', true, () => checkService('linbo-api')),
    runCheck('tftpd-hpa', true, () => checkService('tftpd-hpa')),
    runCheck('rsync', true, () => checkService('rsync')),
    runCheck('isc-dhcp-server', true, () => checkService('isc-dhcp-server')),
    runCheck('nginx', false, () => checkService('nginx')),

    // API health
    runCheck('api-health', true, async () => {
      const http = require('http');
      return new Promise((resolve, reject) => {
        const req = http.get('http://localhost:3000/health', { timeout: 3000 }, (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => {
            try {
              const h = JSON.parse(data);
              resolve(h.status || 'unknown');
            } catch { resolve('ok'); }
          });
        });
        req.on('error', (_err) => reject(new Error('unreachable')));
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      });
    }),

    // Disk space
    runCheck('disk-srv-linbo', true, async () => {
      const stats = await fsp.statfs(LINBO_DIR);
      const freeGB = Math.round((stats.bfree * stats.bsize) / (1024 * 1024 * 1024) * 10) / 10;
      if (freeGB < 5) throw new Error(`${freeGB}GB free (<5GB)`);
      return `${freeGB}GB free`;
    }),

    // linbofs64
    runCheck('linbofs64', true, async () => {
      const stat = await fsp.stat(`${LINBO_DIR}/linbofs64`);
      const ageH = Math.round((Date.now() - stat.mtimeMs) / 3600000);
      return `${stat.size} bytes, ${ageH}h old`;
    }),

    // linbo64 kernel
    runCheck('linbo64-kernel', true, async () => {
      await fsp.access(`${LINBO_DIR}/linbo64`);
      return 'present';
    }),

    // GRUB boot files
    runCheck('grub-core-efi', true, async () => {
      await fsp.access(`${LINBO_DIR}/boot/grub/x86_64-efi/core.efi`);
      return 'present';
    }),

    // SSH client key
    runCheck('ssh-client-key', true, async () => {
      await fsp.access('/etc/linuxmuster/linbo/ssh_host_rsa_key_client');
      return 'present';
    }),

    // Store snapshot age
    runCheck('store-snapshot', false, async () => {
      const storePath = process.env.STORE_SNAPSHOT || '/var/lib/linbo-native/store.json';
      const stat = await fsp.stat(storePath);
      const ageMin = Math.round((Date.now() - stat.mtimeMs) / 60000);
      if (ageMin > 10) throw new Error(`${ageMin}min old (stale)`);
      return `${ageMin}min old`;
    }),

    // start.conf count
    runCheck('start-confs', false, async () => {
      const files = await fsp.readdir(LINBO_DIR);
      const count = files.filter(f => f.startsWith('start.conf.')).length;
      return `${count} configs`;
    }),

    // Images count
    runCheck('images', false, async () => {
      try {
        const dirs = await fsp.readdir(`${LINBO_DIR}/images`);
        return `${dirs.length} image dirs`;
      } catch { return '0 images'; }
    }),
  ]);

  const pass = checks.filter(c => c.status === 'ok').length;
  const warn = checks.filter(c => c.status === 'warn').length;
  const fail = checks.filter(c => c.status === 'fail').length;
  const healthy = fail === 0;

  return {
    timestamp: new Date().toISOString(),
    hostname: require('os').hostname(),
    healthy,
    checks: checks.length,
    pass,
    warn,
    fail,
    results: checks,
  };
}

/**
 * @openapi
 * /system/monitoring:
 *   get:
 *     tags: [Infrastructure]
 *     summary: Full monitoring status with all health checks
 *     responses:
 *       200: { description: Monitoring results }
 *       503: { description: Critical check failed }
 */
router.get('/monitoring', authenticateToken, async (req, res, next) => {
  try {
    const result = await runAllChecks();
    const statusCode = result.healthy ? 200 : 503;
    res.status(statusCode).json({ data: result });
  } catch (error) { next(error); }
});

/**
 * @openapi
 * /system/monitoring/summary:
 *   get:
 *     tags: [Infrastructure]
 *     summary: Quick pass/fail monitoring summary
 *     responses:
 *       200: { description: Healthy }
 *       503: { description: Unhealthy }
 */
router.get('/monitoring/summary', authenticateToken, async (req, res, next) => {
  try {
    const result = await runAllChecks();
    res.status(result.healthy ? 200 : 503).json({
      data: {
        healthy: result.healthy,
        checks: result.checks,
        pass: result.pass,
        warn: result.warn,
        fail: result.fail,
      },
    });
  } catch (error) { next(error); }
});

module.exports = router;
