/**
 * LINBO Plugin - Audit Logging Middleware
 * Structural middleware (requestId, auditAction, auditWrites, getClientIp).
 * Audit persistence removed — no PostgreSQL/Prisma dependency.
 */

const { v4: uuidv4 } = require('uuid');

// Audit log ring buffer (in-memory, persisted via store snapshot)
const MAX_AUDIT_ENTRIES = 1000;
let _auditLog = [];

/**
 * Generate unique request ID
 */
function generateRequestId() {
  return uuidv4();
}

/**
 * Middleware: Add request ID to all requests
 */
function requestId(req, res, next) {
  req.requestId = req.headers['x-request-id'] || generateRequestId();
  res.setHeader('X-Request-ID', req.requestId);
  next();
}

/**
 * Create audit log entry — stores in ring buffer (max 1000 entries).
 * Persisted via store snapshot on disk.
 */
async function createAuditLog(entry) {
  if (!entry || !entry.action) return;

  const record = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    actor: entry.actor || 'anonymous',
    action: entry.action,
    targetType: entry.targetType || null,
    targetId: entry.targetId || null,
    targetName: entry.targetName || null,
    status: entry.status || 'success',
    errorMessage: entry.errorMessage || null,
    ipAddress: entry.ipAddress || null,
    requestId: entry.requestId || null,
  };

  _auditLog.push(record);

  // Ring buffer: trim oldest when exceeding max
  if (_auditLog.length > MAX_AUDIT_ENTRIES) {
    _auditLog = _auditLog.slice(-MAX_AUDIT_ENTRIES);
  }
}

/**
 * Extract client IP from request
 */
function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    null
  );
}

/**
 * Middleware factory: Audit specific actions
 * @param {string} action - Action name (e.g., 'host.create', 'config.update')
 * @param {object} options - Configuration options
 */
function auditAction(action, options = {}) {
  const {
    getTargetType = () => action.split('.')[0],
    getTargetId = (req) => req.params.id,
    getTargetName = () => null,
    getChanges = (req) => req.body,
  } = options;

  return async (req, res, next) => {
    // Store original json method
    const originalJson = res.json.bind(res);

    // Override json to capture response
    res.json = async (data) => {
      const status = res.statusCode >= 400 ? 'error' : 'success';
      const errorMessage = status === 'error' ? data?.error?.message : null;

      await createAuditLog({
        actor: req.user?.username || 'anonymous',
        actorType: 'user',
        action,
        targetType: getTargetType(req),
        targetId: getTargetId(req, data),
        targetName: getTargetName(req, data),
        changes: getChanges(req),
        status,
        errorMessage,
        ipAddress: getClientIp(req),
        userAgent: req.headers['user-agent'],
        requestId: req.requestId,
      });

      return originalJson(data);
    };

    next();
  };
}

/**
 * Middleware: Audit all write operations (POST, PUT, PATCH, DELETE)
 */
function auditWrites(req, res, next) {
  const method = req.method.toUpperCase();
  const writeMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];

  if (!writeMethods.includes(method)) {
    return next();
  }

  // Determine action from method and path
  const pathParts = req.path.split('/').filter(Boolean);
  const resource = pathParts[pathParts.length - 2] || pathParts[pathParts.length - 1];

  const actionMap = {
    POST: 'create',
    PUT: 'update',
    PATCH: 'update',
    DELETE: 'delete',
  };

  const action = `${resource}.${actionMap[method]}`;

  return auditAction(action, {
    getTargetId: (req, data) => req.params.id || data?.data?.id,
    getTargetName: (req, data) => data?.data?.name || data?.data?.hostname,
  })(req, res, next);
}

/**
 * Query audit logs from ring buffer (newest first, paginated).
 */
async function queryAuditLogs({ page = 1, limit = 50, action, actor } = {}) {
  let filtered = [..._auditLog].reverse(); // newest first

  if (action) filtered = filtered.filter(e => e.action.startsWith(action));
  if (actor) filtered = filtered.filter(e => e.actor === actor);

  const total = filtered.length;
  const pages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const data = filtered.slice(start, start + limit);

  return { data, pagination: { page, limit, total, pages } };
}

/**
 * Get the raw audit log array (for snapshot persistence).
 */
function getAuditLog() {
  return _auditLog;
}

/**
 * Restore audit log from snapshot.
 */
function restoreAuditLog(entries) {
  if (Array.isArray(entries)) {
    _auditLog = entries.slice(-MAX_AUDIT_ENTRIES);
  }
}

module.exports = {
  requestId,
  createAuditLog,
  getClientIp,
  auditAction,
  auditWrites,
  queryAuditLogs,
  getAuditLog,
  restoreAuditLog,
};
