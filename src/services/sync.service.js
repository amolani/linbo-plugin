/**
 * LINBO Docker - Sync Service (DB-free)
 *
 * Syncs data from the LMN Authority API to local files + Redis cache.
 * Triggered manually via POST /api/v1/sync/trigger.
 *
 * Data flow:
 *   1. Fetch delta changes from LMN Authority API
 *   2. Write start.conf files (with server= rewrite) + MD5 + symlinks
 *   3. Cache configs/hosts in Redis
 *   4. Write GRUB configs from Authority API
 *   5. Write ISC DHCP config files to /etc/dhcp/ and restart isc-dhcp-server
 */

const fsp = require('fs/promises');
const path = require('path');
const redis = require('../lib/redis');
const lmnClient = require('../lib/lmn-api-client');
const { atomicWrite, atomicWriteWithMd5, safeUnlink, forceSymlink } = require('../lib/atomic-write');
const { rewriteServerField } = require('../lib/startconf-rewrite');
const grubGenerator = require('./grub-generator');
const grubSync = require('./grub-sync');
const ws = require('../lib/websocket');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';
const DHCP_CONFIG_DIR = process.env.DHCP_CONFIG_DIR || '/etc/dhcp';

// Redis key prefixes
const KEY = {
  CURSOR: 'sync:cursor',
  LAST_SYNC: 'sync:lastSyncAt',
  LAST_ERROR: 'sync:lastError',
  IS_RUNNING: 'sync:isRunning',
  SERVER_IP: 'sync:server_ip',
  HOST: 'sync:host:',        // sync:host:{mac} → JSON
  HOST_INDEX: 'sync:host:index',  // SET of all known MACs
  CONFIG: 'sync:config:',    // sync:config:{id} → JSON
  CONFIG_INDEX: 'sync:config:index', // SET of all known config IDs
  HOST_IP: 'sync:host:ip:',        // secondary index ip → mac (REL-03)
  NEXT_RUN_AT: 'sync:nextRunAt',   // timer persistence (REL-02)
};

/**
 * Run a single sync cycle. Idempotent — safe to call multiple times.
 * @returns {Promise<{success: boolean, stats: object}>}
 */
async function syncOnce() {
  const client = redis.getClient();

  // Guard: only one sync at a time
  const running = await client.get(KEY.IS_RUNNING);
  if (running === 'true') {
    throw new Error('Sync already in progress');
  }

  await client.set(KEY.IS_RUNNING, 'true');
  const startTime = Date.now();

  // Broadcast sync started
  try { ws.broadcast('sync.started', { timestamp: new Date().toISOString() }); } catch {} // WS broadcast: no clients is normal

  try {
    // 1. Read cursor (empty = full snapshot)
    const cursor = await client.get(KEY.CURSOR) || '';
    const isFullSync = !cursor;

    const settingsService = require('./settings.service');
    const serverIp = await settingsService.get('linbo_server_ip');
    const school = await settingsService.get('lmn_school');

    console.log(`[Sync] Starting ${isFullSync ? 'FULL' : 'incremental'} sync (cursor: ${cursor || '(empty)'}, school: ${school})`);

    // 2. Fetch changes
    const delta = await lmnClient.getChanges(cursor, school);

    const stats = {
      startConfs: 0,
      configs: 0,
      hosts: 0,
      deletedStartConfs: 0,
      deletedHosts: 0,
      dhcp: false,
      dhcpRestartSkipped: false,
      grub: false,
    };

    // Check if server IP changed → force full rewrite of start.confs
    const lastServerIp = await client.get(KEY.SERVER_IP);
    const serverIpChanged = lastServerIp && lastServerIp !== serverIp;
    if (serverIpChanged) {
      console.log(`[Sync] Server IP changed (${lastServerIp} → ${serverIp}), will rewrite all start.confs`);
    }

    // 3. Sync start.confs (raw content + server= rewrite)
    if (delta.startConfsChanged.length > 0) {
      const { startConfs } = await lmnClient.batchGetStartConfs(delta.startConfsChanged, school);
      for (const sc of startConfs) {
        const rewritten = rewriteServerField(sc.content, serverIp);
        const filepath = path.join(LINBO_DIR, `start.conf.${sc.id}`);
        await atomicWriteWithMd5(filepath, rewritten);
        stats.startConfs++;
      }
      console.log(`[Sync] Wrote ${stats.startConfs} start.conf files`);
      try { ws.broadcast('sync.progress', { phase: 'startConfs', stats: { startConfs: stats.startConfs } }); } catch {} // WS broadcast: no clients is normal
    }

    // 4. Sync configs (parsed, cached in Redis for GRUB generator)
    // Merge startConfsChanged into configsChanged — a start.conf change always
    // means the parsed config changed too (they derive from the same file).
    const allConfigsChanged = [...new Set([...delta.configsChanged, ...delta.startConfsChanged])];
    if (allConfigsChanged.length > 0) {
      try {
        const { configs } = await lmnClient.batchGetConfigs(allConfigsChanged, school);
        for (const config of configs) {
          await client.set(`${KEY.CONFIG}${config.id}`, JSON.stringify(config));
          await client.sadd(KEY.CONFIG_INDEX, config.id);
          stats.configs++;
        }
        console.log(`[Sync] Cached ${stats.configs} config records`);
      } catch (err) {
        // 404 = no GRUB configs found (e.g. new groups without hosts yet)
        if (!err.message.includes('404')) throw err;
        console.log('[Sync] No GRUB configs found for changed groups (new groups without hosts?)');
      }
    }

    // 4b. Ensure every written start.conf has a config entry in Redis.
    // New groups may not have a GRUB .cfg yet (no hosts assigned), but the
    // frontend needs them in the config index to list the group.
    if (delta.startConfsChanged.length > 0) {
      for (const scId of delta.startConfsChanged) {
        const exists = await client.sismember(KEY.CONFIG_INDEX, scId);
        if (!exists) {
          const record = { id: scId, content: null, updatedAt: new Date().toISOString() };
          await client.set(`${KEY.CONFIG}${scId}`, JSON.stringify(record));
          await client.sadd(KEY.CONFIG_INDEX, scId);
          stats.configs++;
        }
      }
    }

    // 5. Sync hosts (cached in Redis, create start.conf symlinks)
    // The authority API may return ["all"] instead of individual MACs when too many
    // hosts changed — in that case, re-fetch ALL hosts via a full-snapshot request.
    let hostsToSync = delta.hostsChanged;
    if (Array.isArray(hostsToSync) && hostsToSync.includes('all')) {
      console.log('[Sync] hostsChanged contains "all" — fetching full host list');
      const fullDelta = await lmnClient.getChanges('');
      hostsToSync = Array.isArray(fullDelta.hostsChanged)
        ? fullDelta.hostsChanged.filter(m => m !== 'all')
        : [];
    }
    if (hostsToSync.length > 0) {
      const { hosts } = await lmnClient.batchGetHosts(hostsToSync, school);
      for (const host of hosts) {
        // Clean up old IP index if host IP changed (REL-03)
        const existingJson = await client.get(`${KEY.HOST}${host.mac}`);
        if (existingJson) {
          const existing = JSON.parse(existingJson);
          if (existing.ip && existing.ip !== host.ip) {
            await client.del(`${KEY.HOST_IP}${existing.ip}`);
          }
        }

        await client.set(`${KEY.HOST}${host.mac}`, JSON.stringify(host));
        await client.sadd(KEY.HOST_INDEX, host.mac);

        // Write secondary IP index (REL-03)
        if (host.ip) {
          await client.set(`${KEY.HOST_IP}${host.ip}`, host.mac);
        }

        // Create start.conf symlinks
        const groupFile = `start.conf.${host.hostgroup}`;
        if (host.ip) {
          await forceSymlink(groupFile, path.join(LINBO_DIR, `start.conf-${host.ip}`));
        }
        if (host.mac) {
          const macLower = host.mac.toLowerCase();
          await forceSymlink(groupFile, path.join(LINBO_DIR, `start.conf-${macLower}`));
        }
        stats.hosts++;
      }
      console.log(`[Sync] Cached ${stats.hosts} host records + symlinks`);
      try { ws.broadcast('sync.progress', { phase: 'hosts', stats: { hosts: stats.hosts } }); } catch {} // WS broadcast: no clients is normal
    }

    // 6. Handle deletions — start.confs
    if (delta.deletedStartConfs.length > 0) {
      for (const id of delta.deletedStartConfs) {
        await safeUnlink(path.join(LINBO_DIR, `start.conf.${id}`));
        await safeUnlink(path.join(LINBO_DIR, `start.conf.${id}.md5`));
        await client.del(`${KEY.CONFIG}${id}`);
        await client.srem(KEY.CONFIG_INDEX, id);
        stats.deletedStartConfs++;
      }
      console.log(`[Sync] Deleted ${stats.deletedStartConfs} start.conf files`);
    }

    // 7. Handle deletions — hosts
    if (delta.deletedHosts.length > 0) {
      for (const mac of delta.deletedHosts) {
        // Read host data before deleting to clean up symlinks + IP index
        const hostJson = await client.get(`${KEY.HOST}${mac}`);
        if (hostJson) {
          const host = JSON.parse(hostJson);
          if (host.ip) {
            await safeUnlink(path.join(LINBO_DIR, `start.conf-${host.ip}`));
            await client.del(`${KEY.HOST_IP}${host.ip}`);
          }
          if (host.mac) await safeUnlink(path.join(LINBO_DIR, `start.conf-${host.mac.toLowerCase()}`));
        }
        await client.del(`${KEY.HOST}${mac}`);
        await client.srem(KEY.HOST_INDEX, mac);
        stats.deletedHosts++;
      }
      console.log(`[Sync] Deleted ${stats.deletedHosts} host records + symlinks`);
    }

    // 8. Incremental deletion detection via universe lists
    //    The server may include allStartConfIds / allHostMacs / allConfigIds
    //    listing every entity it currently knows about. Anything locally cached
    //    but NOT in these lists has been deleted on the server.
    if (!isFullSync) {
      await reconcileUniverseLists(client, delta, stats);
    }

    // 9. Full snapshot reconciliation — delete local items NOT in the response
    if (isFullSync) {
      await reconcileFullSnapshot(client, delta, stats);
    }

    // 10. ISC DHCP config sync (subnets.conf + devices/{school}.conf -> /etc/dhcp/)
    if (delta.dhcpChanged) {
      try {
        const dhcpResult = await lmnClient.getIscDhcpConfig(school);
        const devicesDir = path.join(DHCP_CONFIG_DIR, 'devices');
        await fsp.mkdir(devicesDir, { recursive: true });

        if (dhcpResult.subnets != null) {
          await atomicWrite(path.join(DHCP_CONFIG_DIR, 'subnets.conf'), dhcpResult.subnets);
          console.log('[Sync] Wrote subnets.conf to', DHCP_CONFIG_DIR);
        }
        if (dhcpResult.devices != null) {
          await atomicWrite(path.join(devicesDir, `${school}.conf`), dhcpResult.devices);
          console.log(`[Sync] Wrote devices/${school}.conf to`, devicesDir);
        }

        // Regenerate devices.conf as aggregator of all per-school include files
        const schoolFiles = await fsp.readdir(devicesDir);
        const includeLines = schoolFiles
          .filter(f => f.endsWith('.conf'))
          .sort()
          .map(f => `include "${path.join(devicesDir, f)}";`);
        const devicesConfContent = [
          '# devices.conf — includes per-school device reservations',
          '# Regenerated by linbo-api sync — do not edit manually',
          ...includeLines,
        ].join('\n') + '\n';
        await atomicWrite(path.join(DHCP_CONFIG_DIR, 'devices.conf'), devicesConfContent);

        // Validate config then restart isc-dhcp-server (SIGHUP kills native dhcpd — must use restart)
        const dhcpdConf = path.join(DHCP_CONFIG_DIR, 'dhcpd.conf');
        try {
          await execFileAsync('sudo', ['/usr/sbin/dhcpd', '-t', '-cf', dhcpdConf]);
          console.log('[Sync] dhcpd config test passed');
        } catch (testErr) {
          console.error('[Sync] DHCP config test failed:', testErr.stderr || testErr.message);
          console.error('[Sync] NOT restarting isc-dhcp-server to avoid breaking active DHCP');
          stats.dhcp = true; // files written, but dhcpd not restarted
          stats.dhcpRestartSkipped = true;
        }
        if (!stats.dhcpRestartSkipped) {
          try {
            await execFileAsync('sudo', ['/bin/systemctl', 'restart', 'isc-dhcp-server']);
            console.log('[Sync] isc-dhcp-server restarted successfully');
          } catch (restartErr) {
            console.error('[Sync] DHCP restart failed:', restartErr.stderr || restartErr.message);
          }
        }

        stats.dhcp = true;
        console.log(`[Sync] ISC DHCP config updated for school '${school}'`);
      } catch (err) {
        console.error('[Sync] ISC DHCP config sync failed:', err.message);
      }
    }

    // 11. Sync GRUB configs from Authority API (replaces template generation)
    const hasChanges = stats.startConfs > 0 || stats.configs > 0 || stats.hosts > 0
      || stats.deletedStartConfs > 0 || stats.deletedHosts > 0;

    if (hasChanges || isFullSync) {
      try {
        const grubResult = await lmnClient.getGrubConfigs(school);
        await grubSync.writeGrubConfigs(grubResult.configs, serverIp);
        console.log(`[Sync] Wrote ${grubResult.total} GRUB config files from Authority API`);
      } catch (err) {
        // Log but don't fail the sync — GRUB configs may not exist yet for new schools
        console.error('[Sync] GRUB config sync failed:', err.message);
      }

      // Hostcfg symlinks (GRUB-03) from already-cached host data
      const allHosts = await loadAllHostsFromRedis(client);
      await grubSync.writeHostcfgSymlinks(allHosts);

      stats.grub = true;
    }

    // 12. Save cursor + metadata
    await client.set(KEY.CURSOR, delta.nextCursor);
    await client.set(KEY.SERVER_IP, serverIp);
    await client.set(KEY.LAST_SYNC, new Date().toISOString());
    await client.set(KEY.LAST_ERROR, '');

    const elapsed = Date.now() - startTime;
    console.log(`[Sync] Completed in ${elapsed}ms: ${JSON.stringify(stats)}`);

    // Broadcast completion event
    try { ws.broadcast('sync.completed', { stats, elapsed, cursor: delta.nextCursor }); } catch {} // WS broadcast: no clients is normal

    return { success: true, stats };
  } catch (err) {
    console.error('[Sync] Failed:', err.message);
    await client.set(KEY.LAST_ERROR, err.message);
    // Do NOT update cursor on failure — next trigger retries
    try { ws.broadcast('sync.failed', { error: err.message }); } catch {} // WS broadcast: no clients is normal
    throw err;
  } finally {
    await client.set(KEY.IS_RUNNING, 'false');
  }
}

/**
 * Incremental deletion detection using universe lists.
 * When the server includes allStartConfIds / allHostMacs / allConfigIds,
 * we compare against local state and remove anything not on the server.
 */
async function reconcileUniverseLists(client, delta, stats) {
  // Start.conf files: compare allStartConfIds against files on disk
  if (Array.isArray(delta.allStartConfIds)) {
    const serverIds = new Set(delta.allStartConfIds);
    try {
      const files = await fsp.readdir(LINBO_DIR);
      for (const file of files) {
        if (!file.startsWith('start.conf.') || file.endsWith('.md5') || file.endsWith('.bak')) continue;
        const confId = file.replace('start.conf.', '');
        if (!serverIds.has(confId)) {
          await safeUnlink(path.join(LINBO_DIR, file));
          await safeUnlink(path.join(LINBO_DIR, `${file}.md5`));
          await client.del(`${KEY.CONFIG}${confId}`);
          await client.srem(KEY.CONFIG_INDEX, confId);
          stats.deletedStartConfs++;
          console.log(`[Sync] Deleted start.conf: ${confId}`);
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('[Sync] Universe list start.conf cleanup error:', err.message);
    }
  }

  // Hosts: compare allHostMacs against Redis host index
  if (Array.isArray(delta.allHostMacs)) {
    const serverMacs = new Set(delta.allHostMacs);
    const existingMacs = await client.smembers(KEY.HOST_INDEX);
    for (const mac of existingMacs) {
      if (!serverMacs.has(mac)) {
        // Read host data to clean up symlinks + IP index
        const hostJson = await client.get(`${KEY.HOST}${mac}`);
        if (hostJson) {
          const host = JSON.parse(hostJson);
          if (host.ip) {
            await safeUnlink(path.join(LINBO_DIR, `start.conf-${host.ip}`));
            await client.del(`${KEY.HOST_IP}${host.ip}`);
          }
          if (host.mac) await safeUnlink(path.join(LINBO_DIR, `start.conf-${host.mac.toLowerCase()}`));
        }
        await client.del(`${KEY.HOST}${mac}`);
        await client.srem(KEY.HOST_INDEX, mac);
        stats.deletedHosts++;
        console.log(`[Sync] Deleted host: ${mac}`);
      }
    }
  }

  // Configs: compare against Redis config index.
  // A valid config can come from either a GRUB .cfg (allConfigIds) OR a
  // start.conf without hosts (allStartConfIds). Merge both sets so new
  // groups without GRUB configs are not immediately deleted.
  if (Array.isArray(delta.allConfigIds) || Array.isArray(delta.allStartConfIds)) {
    const serverIds = new Set([
      ...(delta.allConfigIds || []),
      ...(delta.allStartConfIds || []),
    ]);
    const existingIds = await client.smembers(KEY.CONFIG_INDEX);
    for (const id of existingIds) {
      if (!serverIds.has(id)) {
        await client.del(`${KEY.CONFIG}${id}`);
        await client.srem(KEY.CONFIG_INDEX, id);
        console.log(`[Sync] Deleted config: ${id}`);
      }
    }
  }

  if (stats.deletedStartConfs > 0 || stats.deletedHosts > 0) {
    console.log(`[Sync] Universe list reconciliation: ${stats.deletedStartConfs} start.confs, ${stats.deletedHosts} hosts deleted`);
  }
}

/**
 * Full snapshot reconciliation: delete local items NOT in the response.
 */
async function reconcileFullSnapshot(client, delta, stats) {
  console.log('[Sync] Running full snapshot reconciliation...');

  // Reconcile start.conf files on disk
  const validConfIds = new Set(delta.startConfsChanged);
  try {
    const files = await fsp.readdir(LINBO_DIR);
    for (const file of files) {
      if (!file.startsWith('start.conf.') || file.endsWith('.md5') || file.endsWith('.bak')) continue;
      const confId = file.replace('start.conf.', '');
      if (!validConfIds.has(confId)) {
        await safeUnlink(path.join(LINBO_DIR, file));
        await safeUnlink(path.join(LINBO_DIR, `${file}.md5`));
        console.log(`[Sync] Reconcile: removed stale ${file}`);
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[Sync] Reconcile readdir error:', err.message);
  }

  // Reconcile host Redis entries
  const validMacs = new Set(delta.hostsChanged);
  const existingMacs = await client.smembers(KEY.HOST_INDEX);
  for (const mac of existingMacs) {
    if (!validMacs.has(mac)) {
      const hostJson = await client.get(`${KEY.HOST}${mac}`);
      if (hostJson) {
        const host = JSON.parse(hostJson);
        if (host.ip) {
          await safeUnlink(path.join(LINBO_DIR, `start.conf-${host.ip}`));
          await client.del(`${KEY.HOST_IP}${host.ip}`);
        }
        if (host.mac) await safeUnlink(path.join(LINBO_DIR, `start.conf-${host.mac.toLowerCase()}`));
      }
      await client.del(`${KEY.HOST}${mac}`);
      await client.srem(KEY.HOST_INDEX, mac);
    }
  }

  // Reconcile config Redis entries — include both configsChanged (GRUB configs)
  // and startConfsChanged (start.conf groups that may not have GRUB configs yet)
  const validConfigIds = new Set([...delta.configsChanged, ...delta.startConfsChanged]);
  const existingConfigIds = await client.smembers(KEY.CONFIG_INDEX);
  for (const id of existingConfigIds) {
    if (!validConfigIds.has(id)) {
      await client.del(`${KEY.CONFIG}${id}`);
      await client.srem(KEY.CONFIG_INDEX, id);
    }
  }

  // Clean up stale start.conf-{ip} and start.conf-{mac} symlinks
  try {
    const files = await fsp.readdir(LINBO_DIR);
    const validIps = new Set();
    const validMacLower = new Set();

    // Build sets of valid IPs and MACs from the current host data
    for (const mac of delta.hostsChanged) {
      const hostJson = await client.get(`${KEY.HOST}${mac}`);
      if (hostJson) {
        const host = JSON.parse(hostJson);
        if (host.ip) validIps.add(host.ip);
        if (host.mac) validMacLower.add(host.mac.toLowerCase());
      }
    }

    for (const file of files) {
      if (!file.startsWith('start.conf-')) continue;
      const suffix = file.replace('start.conf-', '');
      // It's an IP symlink if suffix looks like an IP, else MAC
      if (suffix.includes('.')) {
        if (!validIps.has(suffix)) {
          await safeUnlink(path.join(LINBO_DIR, file));
        }
      } else if (suffix.includes(':')) {
        if (!validMacLower.has(suffix)) {
          await safeUnlink(path.join(LINBO_DIR, file));
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[Sync] Reconcile symlink cleanup error:', err.message);
  }
}

/**
 * Load all hosts from Redis cache.
 */
async function loadAllHostsFromRedis(client) {
  const macs = await client.smembers(KEY.HOST_INDEX);
  if (macs.length === 0) return [];

  const pipeline = client.pipeline();
  for (const mac of macs) {
    pipeline.get(`${KEY.HOST}${mac}`);
  }
  const results = await pipeline.exec();
  return results
    .filter(([err, val]) => !err && val)
    .map(([, val]) => JSON.parse(val));
}

/**
 * Load all configs from Redis cache.
 */
async function loadAllConfigsFromRedis(client) {
  const ids = await client.smembers(KEY.CONFIG_INDEX);
  if (ids.length === 0) return [];

  const pipeline = client.pipeline();
  for (const id of ids) {
    pipeline.get(`${KEY.CONFIG}${id}`);
  }
  const results = await pipeline.exec();
  return results
    .filter(([err, val]) => !err && val)
    .map(([, val]) => JSON.parse(val));
}

/**
 * Get current sync status.
 */
async function getSyncStatus() {
  const client = redis.getClient();
  const [cursor, lastSyncAt, lastError, isRunning, serverIp] = await client.mget(
    KEY.CURSOR, KEY.LAST_SYNC, KEY.LAST_ERROR, KEY.IS_RUNNING, KEY.SERVER_IP,
  );

  const hostCount = await client.scard(KEY.HOST_INDEX);
  const configCount = await client.scard(KEY.CONFIG_INDEX);

  let lmnApiHealthy = false;
  try {
    const health = await lmnClient.checkHealth();
    lmnApiHealthy = health.healthy;
  } catch (err) { console.debug('[Sync] LMN API health check failed:', err.message); }

  const hostOfflineTimeoutSec = Number(
    await client.get('config:hostOfflineTimeoutSec') || 300,
  );

  return {
    cursor: cursor || null,
    lastSyncAt: lastSyncAt || null,
    lastError: lastError || null,
    isRunning: isRunning === 'true',
    serverIp: serverIp || null,
    hosts: Number(hostCount),
    configs: Number(configCount),
    lmnApiHealthy,
    hostOfflineTimeoutSec,
  };
}

/**
 * Reset sync: clear cursor to force full snapshot on next trigger.
 */
async function resetSync() {
  const client = redis.getClient();
  await client.del(KEY.CURSOR);
  console.log('[Sync] Cursor reset — next sync will be a full snapshot');
}

module.exports = {
  syncOnce,
  getSyncStatus,
  resetSync,
  // Exported for testing
  loadAllHostsFromRedis,
  loadAllConfigsFromRedis,
  reconcileFullSnapshot,
  reconcileUniverseLists,
  KEY,
};
