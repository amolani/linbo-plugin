/**
 * LINBO Plugin - Sync Operations Service
 * Redis-based operation tracking for sync mode (no Prisma dependency).
 *
 * Reuses pure-logic functions from:
 *   - linbo-commands.js: parseCommands, validateCommandString, formatCommandsForWrapper,
 *                        listScheduledCommands, cancelScheduledCommand, getOnbootCmdPath
 *   - ssh.service.js: executeCommand, testConnection
 *   - wol.service.js: sendWakeOnLan, sendWakeOnLanBulk
 *   - sync.service.js: loadAllHostsFromRedis, KEY
 */

const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const redis = require('../lib/redis');
const sshService = require('./ssh.service');
const wolService = require('./wol.service');
const ws = require('../lib/websocket');

// Reuse command parsing from linbo-commands (these are pure functions, no Prisma)
const {
  parseCommands,
  validateCommandString,
  formatCommandsForWrapper,
  listScheduledCommands,
  getOnbootCmdPath,
  mapCommand,
  FIRE_AND_FORGET,
} = require('../lib/linbo-commands');

// Reuse sync helpers
const { loadAllHostsFromRedis, KEY: SYNC_KEY } = require('./sync.service');

// Configuration
const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';
const LINBOCMD_DIR = path.join(LINBO_DIR, 'linbocmd');
const MAX_SSH_CONCURRENCY = parseInt(process.env.MAX_SSH_CONCURRENCY, 10) || 20;
const SSH_TIMEOUT = parseInt(process.env.SSH_TIMEOUT, 10) || 15000;
const OP_TTL = 86400; // 24h
const MAX_INDEX_SIZE = 200;

// Redis key constants
const OPS_KEY = {
  INDEX: 'ops:index',
  OP: 'ops:op:',           // ops:op:{id} -> Hash
  SESSIONS: ':sessions',   // ops:op:{id}:sessions -> Hash
};

// Hostname sanitization
const HOSTNAME_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Sanitize hostname for filesystem operations
 */
function sanitizeHostname(hostname) {
  if (!hostname || !HOSTNAME_RE.test(hostname)) {
    throw new Error(`Invalid hostname: ${hostname}`);
  }
  const resolved = path.resolve(LINBOCMD_DIR, `${hostname}.cmd`);
  if (!resolved.startsWith(path.resolve(LINBOCMD_DIR))) {
    throw new Error(`Path traversal detected: ${hostname}`);
  }
  return hostname;
}

/**
 * Manual concurrency pool (no npm dependency)
 * Reuse pattern from host-status.worker.js
 */
async function runWithConcurrency(items, fn, limit) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(limit, items.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Host Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve hosts from Redis based on filter criteria.
 * Priority: macs[] > hostnames[] > hostgroup/room
 */
async function resolveHosts(filter) {
  const client = redis.getClient();

  if (filter.macs && filter.macs.length > 0) {
    // Direct MAC lookup
    const pipeline = client.pipeline();
    for (const mac of filter.macs) {
      pipeline.get(`${SYNC_KEY.HOST}${mac}`);
    }
    const results = await pipeline.exec();
    const hosts = [];
    for (let i = 0; i < results.length; i++) {
      const [err, json] = results[i];
      if (!err && json) {
        hosts.push(JSON.parse(json));
      }
    }
    if (hosts.length === 0) {
      throw Object.assign(new Error('No hosts found for given MACs'), { statusCode: 404 });
    }
    return hosts;
  }

  if (filter.hostnames && filter.hostnames.length > 0) {
    const allHosts = await loadAllHostsFromRedis(client);
    const matchedHosts = allHosts.filter(h =>
      filter.hostnames.includes(h.hostname)
    );

    // Duplicate check: hostname matching multiple MACs
    const hostnameToMacs = {};
    for (const h of matchedHosts) {
      if (!hostnameToMacs[h.hostname]) hostnameToMacs[h.hostname] = [];
      hostnameToMacs[h.hostname].push(h.mac);
    }
    for (const [hostname, macs] of Object.entries(hostnameToMacs)) {
      if (macs.length > 1) {
        throw Object.assign(
          new Error(`Hostname '${hostname}' matches multiple MACs: ${macs.join(', ')}`),
          { statusCode: 409 }
        );
      }
    }

    if (matchedHosts.length === 0) {
      throw Object.assign(new Error('No hosts found for given hostnames'), { statusCode: 404 });
    }
    return matchedHosts;
  }

  if (filter.hostgroup || filter.room) {
    const allHosts = await loadAllHostsFromRedis(client);
    const filtered = allHosts.filter(h => {
      if (filter.hostgroup && h.hostgroup !== filter.hostgroup) return false;
      if (filter.room && h.room !== filter.room) return false;
      return true;
    });
    if (filtered.length === 0) {
      throw Object.assign(new Error('No hosts found for given filter'), { statusCode: 404 });
    }
    return filtered;
  }

  throw Object.assign(
    new Error('At least one filter (macs, hostnames, hostgroup, room) is required'),
    { statusCode: 400 }
  );
}

// ---------------------------------------------------------------------------
// Operation CRUD
// ---------------------------------------------------------------------------

/**
 * Create a new operation in Redis.
 */
async function createOperation(hosts, commands, opts = {}) {
  const client = redis.getClient();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const opData = {
    id,
    type: opts.type || 'direct',
    commands: JSON.stringify(Array.isArray(commands) ? commands : [commands]),
    targetHosts: JSON.stringify(hosts.map(h => h.hostname)),
    status: 'pending',
    cancelRequested: 'false',
    progress: '0',
    stats: JSON.stringify({ total: hosts.length, success: 0, failed: 0, cancelled: 0 }),
    createdAt: now,
    startedAt: '',
    completedAt: '',
  };

  // Sessions: hostname -> JSON
  const sessionsData = {};
  for (const h of hosts) {
    sessionsData[h.hostname] = JSON.stringify({
      mac: h.mac,
      ip: h.ip,
      status: 'queued',
      error: null,
      startedAt: null,
      completedAt: null,
    });
  }

  const opKey = `${OPS_KEY.OP}${id}`;
  const sessKey = `${opKey}${OPS_KEY.SESSIONS}`;

  const pipeline = client.pipeline();
  pipeline.hmset(opKey, opData);
  pipeline.expire(opKey, OP_TTL);
  if (Object.keys(sessionsData).length > 0) {
    pipeline.hmset(sessKey, sessionsData);
    pipeline.expire(sessKey, OP_TTL);
  }
  pipeline.zadd(OPS_KEY.INDEX, Date.now(), id);
  // Trim index to MAX_INDEX_SIZE
  pipeline.zremrangebyrank(OPS_KEY.INDEX, 0, -(MAX_INDEX_SIZE + 1));
  await pipeline.exec();

  return { id, ...opData, sessions: sessionsData };
}

/**
 * Get operation by ID with sessions.
 */
async function getOperation(id) {
  const client = redis.getClient();
  const opKey = `${OPS_KEY.OP}${id}`;

  const opData = await client.hgetall(opKey);
  if (!opData || Object.keys(opData).length === 0) {
    return null;
  }

  // Parse JSON fields
  const op = {
    ...opData,
    commands: safeJsonParse(opData.commands, []),
    targetHosts: safeJsonParse(opData.targetHosts, []),
    stats: safeJsonParse(opData.stats, {}),
    progress: parseInt(opData.progress, 10) || 0,
    cancelRequested: opData.cancelRequested === 'true',
  };

  // Load sessions
  const sessKey = `${opKey}${OPS_KEY.SESSIONS}`;
  const sessionsRaw = await client.hgetall(sessKey);
  const sessions = {};
  if (sessionsRaw) {
    for (const [hostname, json] of Object.entries(sessionsRaw)) {
      sessions[hostname] = safeJsonParse(json, {});
    }
  }
  op.sessions = sessions;

  return op;
}

/**
 * List operations with pagination and lazy cleanup.
 */
async function listOperations({ page = 1, limit = 25, status } = {}) {
  const client = redis.getClient();
  const offset = (page - 1) * limit;

  // Get all IDs (sorted by score desc = newest first)
  const allIds = await client.zrevrange(OPS_KEY.INDEX, 0, -1);
  if (allIds.length === 0) {
    return { data: [], pagination: { page, limit, total: 0, pages: 0 } };
  }

  // Pipeline EXISTS check for lazy cleanup
  const pipeline = client.pipeline();
  allIds.forEach(id => pipeline.exists(`${OPS_KEY.OP}${id}`));
  const existResults = await pipeline.exec();

  const deadIds = allIds.filter((id, i) => !existResults[i][1]);
  if (deadIds.length > 0) {
    await client.zrem(OPS_KEY.INDEX, ...deadIds);
  }

  const liveIds = allIds.filter((id, i) => existResults[i][1]);

  // If status filter, we need to load all ops and filter
  let filteredIds = liveIds;
  if (status) {
    const statusPipeline = client.pipeline();
    liveIds.forEach(id => statusPipeline.hget(`${OPS_KEY.OP}${id}`, 'status'));
    const statusResults = await statusPipeline.exec();
    filteredIds = liveIds.filter((_, i) => statusResults[i][1] === status);
  }

  const total = filteredIds.length;
  const pages = Math.ceil(total / limit);
  const pageIds = filteredIds.slice(offset, offset + limit);

  // Load operations
  const opPipeline = client.pipeline();
  pageIds.forEach(id => opPipeline.hgetall(`${OPS_KEY.OP}${id}`));
  const opResults = await opPipeline.exec();

  const data = opResults
    .map(([err, raw]) => {
      if (err || !raw || Object.keys(raw).length === 0) return null;
      return {
        ...raw,
        commands: safeJsonParse(raw.commands, []),
        targetHosts: safeJsonParse(raw.targetHosts, []),
        stats: safeJsonParse(raw.stats, {}),
        progress: parseInt(raw.progress, 10) || 0,
        cancelRequested: raw.cancelRequested === 'true',
      };
    })
    .filter(Boolean);

  return {
    data,
    pagination: { page, limit, total, pages },
  };
}

/**
 * Cancel an operation.
 */
async function cancelOperation(id) {
  const client = redis.getClient();
  const opKey = `${OPS_KEY.OP}${id}`;

  const opData = await client.hgetall(opKey);
  if (!opData || Object.keys(opData).length === 0) {
    throw Object.assign(new Error('Operation not found'), { statusCode: 404 });
  }

  if (['completed', 'failed', 'cancelled'].includes(opData.status)) {
    throw Object.assign(
      new Error(`Operation is already ${opData.status}`),
      { statusCode: 400 }
    );
  }

  // Set cancel flag + status
  await client.hmset(opKey, {
    cancelRequested: 'true',
    status: 'cancelling',
  });

  // Cancel all queued sessions
  const sessKey = `${opKey}${OPS_KEY.SESSIONS}`;
  const sessionsRaw = await client.hgetall(sessKey);
  if (sessionsRaw) {
    const pipeline = client.pipeline();
    for (const [hostname, json] of Object.entries(sessionsRaw)) {
      const sess = safeJsonParse(json, {});
      if (sess.status === 'queued') {
        sess.status = 'cancelled';
        sess.completedAt = new Date().toISOString();
        pipeline.hset(sessKey, hostname, JSON.stringify(sess));
      }
    }
    await pipeline.exec();
  }

  // WS broadcast
  try {
    ws.broadcast('operation.cancelling', { operationId: id });
  } catch { /* ignore */ }

  // Check if all sessions are now done
  await checkOperationCompletion(id);

  return { operationId: id, status: 'cancelling' };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Execute direct commands via SSH on hosts resolved from filter.
 */
async function executeDirectCommands(filter, cmdString, opts = {}) {
  // Validate
  const validation = validateCommandString(cmdString);
  if (!validation.valid) {
    throw Object.assign(new Error(validation.error), { statusCode: 400 });
  }

  // Resolve hosts
  const hosts = await resolveHosts(filter);

  // Create operation
  const op = await createOperation(hosts, cmdString, { type: 'direct' });
  const opId = op.id;
  const client = redis.getClient();
  const opKey = `${OPS_KEY.OP}${opId}`;
  const sessKey = `${opKey}${OPS_KEY.SESSIONS}`;

  // Mark as running
  await client.hmset(opKey, {
    status: 'running',
    startedAt: new Date().toISOString(),
  });

  // WS broadcast
  try {
    ws.broadcast('operation.started', {
      operationId: opId,
      type: 'direct',
      commands: cmdString,
      hostCount: hosts.length,
    });
  } catch { /* ignore */ }

  // Map commands (halt → poweroff) and format for linbo_wrapper
  const mappedCommands = validation.commands.map(c => ({ ...c, command: mapCommand(c.command) }));
  const wrapperCommands = formatCommandsForWrapper(mappedCommands);

  // Check if this is a fire-and-forget command (reboot/halt/poweroff — SSH dies before exit code)
  const isFireAndForget = validation.commands.some(c => FIRE_AND_FORGET.includes(c.command));

  // Execute SSH with concurrency pool
  const stats = { total: hosts.length, success: 0, failed: 0, cancelled: 0 };

  await runWithConcurrency(
    hosts,
    async (host) => {
      // Check cancel before starting
      const cancelFlag = await client.hget(opKey, 'cancelRequested');
      if (cancelFlag === 'true') {
        const sessJson = await client.hget(sessKey, host.hostname);
        const sess = safeJsonParse(sessJson, {});
        if (sess.status === 'queued') {
          sess.status = 'cancelled';
          sess.completedAt = new Date().toISOString();
          await client.hset(sessKey, host.hostname, JSON.stringify(sess));
          stats.cancelled++;
          return;
        }
      }

      const ip = host.ip;
      if (!ip) {
        await updateSession(sessKey, host.hostname, 'failed', 'No IP address', client);
        stats.failed++;
        broadcastSessionEvent(opId, host.hostname, 'failed', 'No IP address');
        return;
      }

      // Mark session as running
      await updateSession(sessKey, host.hostname, 'running', null, client);
      broadcastSessionEvent(opId, host.hostname, 'running');

      try {
        // Test connection
        const connTest = await sshService.testConnection(ip);
        if (!connTest.success) {
          throw new Error('Host not online');
        }

        // Execute command — fire-and-forget commands bypass linbo_wrapper
        // (halt→poweroff, reboot need direct execution for clean shutdown)
        const sshCommand = isFireAndForget
          ? mapCommand(validation.commands[0].command)
          : `/usr/bin/linbo_wrapper ${wrapperCommands}`;
        const result = await sshService.executeCommand(
          ip,
          sshCommand,
          { timeout: opts.timeout || SSH_TIMEOUT }
        );

        // Fire-and-forget commands (reboot/poweroff) kill SSH before exit code returns
        const success = isFireAndForget ? true : (result.code === 0);
        await updateSession(sessKey, host.hostname, success ? 'success' : 'failed',
          success ? null : (result.stderr || `Exit code ${result.code}`), client);

        if (success) stats.success++;
        else stats.failed++;

        broadcastSessionEvent(opId, host.hostname, success ? 'success' : 'failed');
      } catch (error) {
        await updateSession(sessKey, host.hostname, 'failed', error.message, client);
        stats.failed++;
        broadcastSessionEvent(opId, host.hostname, 'failed', error.message);
      }

      // Update progress
      const done = stats.success + stats.failed + stats.cancelled;
      const progress = Math.round((done / stats.total) * 100);
      await client.hmset(opKey, {
        progress: String(progress),
        stats: JSON.stringify(stats),
      });

      try {
        ws.broadcast('operation.progress', {
          operationId: opId,
          progress,
          completed: done,
          total: stats.total,
        });
      } catch { /* ignore */ }
    },
    MAX_SSH_CONCURRENCY
  );

  // Finalize
  const finalStatus = stats.failed === 0 && stats.cancelled === 0
    ? 'completed'
    : stats.success === 0 && stats.cancelled === 0
      ? 'failed'
      : stats.cancelled > 0 ? 'cancelled' : 'completed_with_errors';

  await client.hmset(opKey, {
    status: finalStatus,
    completedAt: new Date().toISOString(),
    progress: '100',
    stats: JSON.stringify(stats),
  });

  try {
    ws.broadcast('operation.completed', {
      operationId: opId,
      status: finalStatus,
      stats,
    });
  } catch { /* ignore */ }

  return {
    operationId: opId,
    status: finalStatus,
    stats,
  };
}

/**
 * Schedule onboot commands (.cmd files) for hosts from filter.
 */
async function scheduleOnbootCommands(filter, cmdString, opts = {}) {
  const validation = validateCommandString(cmdString);
  if (!validation.valid) {
    throw Object.assign(new Error(validation.error), { statusCode: 400 });
  }

  const hosts = await resolveHosts(filter);

  // Ensure linbocmd dir exists
  await fs.mkdir(LINBOCMD_DIR, { recursive: true }).catch(err => console.debug('[SyncOps] mkdir LINBOCMD_DIR failed:', err.message));

  // Build final command string with flags
  let finalCommands = cmdString;
  const flags = [];
  if (opts.noauto) flags.push('noauto');
  if (opts.disablegui) flags.push('disablegui');
  if (flags.length > 0) {
    finalCommands = `${flags.join(',')},${cmdString}`;
  }

  const results = { created: [], failed: [] };

  for (const host of hosts) {
    try {
      sanitizeHostname(host.hostname);
      const cmdPath = getOnbootCmdPath(host.hostname);
      await fs.writeFile(cmdPath, finalCommands, { mode: 0o644 });
      results.created.push(host.hostname);
    } catch (error) {
      results.failed.push({ hostname: host.hostname, error: error.message });
    }
  }

  try {
    ws.broadcast('onboot.scheduled', {
      commands: finalCommands,
      created: results.created,
      failed: results.failed.length,
    });
  } catch { /* ignore */ }

  return results;
}

/**
 * Wake hosts via WoL with optional follow-up commands.
 */
async function wakeHosts(filter, opts = {}) {
  const hosts = await resolveHosts(filter);

  // Send WoL
  const wolResults = await wolService.sendWakeOnLanBulk(
    hosts.map(h => h.mac)
  );

  try {
    ws.broadcast('wol.sent', {
      total: hosts.length,
      successful: wolResults.successful,
      failed: wolResults.failed,
    });
  } catch { /* ignore */ }

  // Schedule onboot commands if provided
  if (opts.commands && opts.onboot) {
    await scheduleOnbootCommands(
      filter,
      opts.commands,
      { noauto: opts.noauto, disablegui: opts.disablegui }
    );
  }

  // Direct execution after WoL wait
  if (opts.commands && !opts.onboot && opts.wait) {
    await new Promise(resolve => setTimeout(resolve, opts.wait * 1000));
    return executeDirectCommands(filter, opts.commands, { timeout: opts.timeout });
  }

  return {
    wolResults,
    hostCount: hosts.length,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeJsonParse(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

async function updateSession(sessKey, hostname, status, error, client) {
  const existing = await client.hget(sessKey, hostname);
  const sess = safeJsonParse(existing, {});
  sess.status = status;
  if (status === 'running') {
    sess.startedAt = new Date().toISOString();
  }
  if (['success', 'failed', 'cancelled'].includes(status)) {
    sess.completedAt = new Date().toISOString();
  }
  if (error) sess.error = error;
  await client.hset(sessKey, hostname, JSON.stringify(sess));
}

function broadcastSessionEvent(opId, hostname, status, error) {
  try {
    ws.broadcast('session.updated', {
      operationId: opId,
      hostname,
      status,
      error: error || undefined,
    });
  } catch { /* ignore */ }
}

async function checkOperationCompletion(opId) {
  const client = redis.getClient();
  const opKey = `${OPS_KEY.OP}${opId}`;
  const sessKey = `${opKey}${OPS_KEY.SESSIONS}`;

  const sessionsRaw = await client.hgetall(sessKey);
  if (!sessionsRaw) return;

  let allDone = true;
  const stats = { total: 0, success: 0, failed: 0, cancelled: 0 };

  for (const json of Object.values(sessionsRaw)) {
    const sess = safeJsonParse(json, {});
    stats.total++;
    if (sess.status === 'success') stats.success++;
    else if (sess.status === 'failed') stats.failed++;
    else if (sess.status === 'cancelled') stats.cancelled++;
    else allDone = false;
  }

  if (allDone && stats.total > 0) {
    const finalStatus = stats.cancelled > 0 ? 'cancelled' : 'completed';
    await client.hmset(opKey, {
      status: finalStatus,
      completedAt: new Date().toISOString(),
      progress: '100',
      stats: JSON.stringify(stats),
    });

    try {
      ws.broadcast('operation.completed', { operationId: opId, status: finalStatus, stats });
    } catch { /* ignore */ }
  }
}

module.exports = {
  // Host resolution
  resolveHosts,

  // Operation CRUD
  createOperation,
  getOperation,
  listOperations,
  cancelOperation,

  // Execution
  executeDirectCommands,
  scheduleOnbootCommands,
  wakeHosts,

  // Utilities
  sanitizeHostname,
  runWithConcurrency,

  // Re-exports from linbo-commands (pure functions)
  validateCommandString,
  listScheduledCommands,

  // Constants (for testing)
  OPS_KEY,
};
