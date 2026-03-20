/**
 * LINBO Native - API Server
 * Main entry point with in-memory store and modular routes (sync-only, no Prisma/PostgreSQL)
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');

// Load environment variables
require('dotenv').config();

// BigInt JSON serialization support
BigInt.prototype.toJSON = function () { return Number(this); };

// Import libraries
const redis = require('./lib/redis');
const websocket = require('./lib/websocket');
const WebSocket = require('ws');

// Import route factory (async — called after store is ready)
const createRouter = require('./routes');

// Import verifyToken for WebSocket auth (used in upgrade handler)
const { verifyToken } = require('./middleware/auth');

/**
 * Verify a WebSocket token (JWT or INTERNAL_API_KEY).
 * Returns user object on success, null on failure.
 * Used by the upgrade handler for /ws authentication.
 */
function verifyWsToken(token) {
  if (!token) return null;

  // Check INTERNAL_API_KEY first (plain string comparison)
  const internalKey = process.env.INTERNAL_API_KEY;
  if (internalKey && token === internalKey) {
    return { id: 'internal', username: 'internal-service', role: 'admin' };
  }

  // Then try JWT verification
  try {
    return verifyToken(token);
  } catch (err) {
    return null;
  }
}

// =============================================================================
// Express App Setup
// =============================================================================
const app = express();
const server = http.createServer(app);

// Trust proxies in private networks (reverse proxy)
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

// =============================================================================
// Middleware
// =============================================================================
app.use(helmet({
  contentSecurityPolicy: false, // Disable for API + Swagger UI
  crossOriginEmbedderPolicy: false, // Required for Swagger UI assets
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:8080',
  credentials: true,
}));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Add request ID for tracking
app.use((req, res, next) => {
  req.requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  res.setHeader('X-Request-ID', req.requestId);
  next();
});

// =============================================================================
// Swagger / OpenAPI Documentation
// =============================================================================
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'LINBO Plugin API',
      version: process.env.npm_package_version || '1.0.0',
      description: 'REST API for LINBO Plugin — the modern caching server replacement for linuxmuster.net 7.3. Provides host management, image sync, remote operations, DHCP/GRUB config distribution, and real-time monitoring via WebSocket.',
      contact: { name: 'LINBO Plugin', url: 'https://github.com/amolani/linbo-docker' },
    },
    servers: [{ url: '/api/v1', description: 'API v1' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Authentication (JWT)' },
      { name: 'Hosts & Configs', description: 'Synced hosts, start.conf configs, sync status (school-aware)' },
      { name: 'Images', description: 'QCOW2 image management, pull/push, sidecars' },
      { name: 'Operations', description: 'Remote commands (SSH, WoL, onboot)' },
      { name: 'Drivers', description: 'Driver profiles with DMI matching' },
      { name: 'Boot & linbofs', description: 'linbofs64 build, SSH/Dropbear keys, patch status' },
      { name: 'LINBO Update', description: 'LINBO package version check and update' },
      { name: 'Kernel', description: 'Kernel variant management (stable/longterm/legacy)' },
      { name: 'Firmware', description: 'Client firmware detection and management' },
      { name: 'GRUB', description: 'GRUB config generation and theme customization' },
      { name: 'Settings', description: 'Server configuration and LMN API connection' },
      { name: 'Terminal', description: 'SSH terminal sessions to LINBO clients' },
      { name: 'Infrastructure', description: 'System services, logs, hooks, WLAN' },
    ],
  },
  apis: ['./src/routes/*.js', './src/routes/system/*.js'],
});

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'LINBO Plugin API Docs',
  customCss: '.swagger-ui .topbar { display: none }',
}));
app.get('/openapi.json', (req, res) => res.json(swaggerSpec));

// =============================================================================
// Health Check Endpoints
// =============================================================================
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime(),
    serverIp: process.env.LINBO_SERVER_IP || '10.0.0.1',
    services: {
      api: 'up',
      store: 'up',
      websocket: 'unknown',
    },
  };

  // Check WebSocket
  const wss = websocket.getServer();
  if (wss) {
    health.services.websocket = 'up';
    health.websocketClients = wss.clients.size;
  } else {
    health.services.websocket = 'down';
  }

  // Check LINBO filesystem (API-07)
  const fs = require('fs');
  try {
    fs.accessSync('/srv/linbo', fs.constants.R_OK);
    health.services.linbo = 'up';
  } catch {
    health.services.linbo = 'down';
    health.status = 'degraded';
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

app.get('/ready', (req, res) => {
  res.json({ status: 'ready', timestamp: new Date().toISOString() });
});

// =============================================================================
// Startup Secrets Validation
// =============================================================================

// Known insecure default values that MUST be changed in production
const JWT_SECRET_DEFAULTS = [
  'linbo-docker-secret-change-in-production',
  'your_jwt_secret_here_change_in_production',
  'your_jwt_secret_here_change_me_in_production_use_openssl_rand',
  'development_secret_change_in_production',
];

const INTERNAL_KEY_DEFAULTS = [
  'linbo-internal-secret',
  'linbo-internal-secret-change-in-production',
];

/**
 * Validate that secrets are not using insecure defaults in production.
 */
function validateSecrets() {
  const env = process.env.NODE_ENV || 'development';
  if (env === 'test') return;

  const issues = [];

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.trim() === '') {
    issues.push('JWT_SECRET is not set');
  } else if (JWT_SECRET_DEFAULTS.includes(jwtSecret)) {
    issues.push('JWT_SECRET is using a known default value');
  }

  const internalKey = process.env.INTERNAL_API_KEY;
  if (!internalKey || internalKey.trim() === '') {
    issues.push('INTERNAL_API_KEY is not set');
  } else if (INTERNAL_KEY_DEFAULTS.includes(internalKey)) {
    issues.push('INTERNAL_API_KEY is using a known default value');
  }

  const corsOrigin = process.env.CORS_ORIGIN;
  if (corsOrigin === '*') {
    console.warn('[security] WARNING: CORS_ORIGIN is set to wildcard "*". This allows any website to make API requests. Set a specific origin for production.');
  }

  if (issues.length === 0) return;

  if (env === 'production') {
    console.error(`FATAL: Insecure secrets detected in production mode:`);
    for (const issue of issues) {
      console.error(`  - ${issue}`);
    }
    console.error('Set secure values for JWT_SECRET and INTERNAL_API_KEY before running in production.');
    process.exit(1);
  } else {
    for (const issue of issues) {
      console.warn(`[secrets] WARNING: ${issue} (acceptable in ${env} mode)`);
    }
  }
}

// =============================================================================
// Server Startup
// =============================================================================
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

async function startServer() {
  console.log('Starting LINBO Plugin API Server (sync-only mode)...\n');

  // Validate secrets before proceeding
  validateSecrets();

  // Store initialized synchronously (no Redis connection needed)
  console.log('Store initialized (in-memory, no Redis)');

  // Mount API routes (after Redis is ready)
  console.log('Mounting API routes...');
  const apiRoutes = await createRouter();
  app.use('/api/v1', apiRoutes);

  // 404 Handler (must be after route mounting)
  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.path} not found`,
        requestId: req.requestId,
      },
    });
  });

  // Global Error Handler (must be after route mounting)
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);

    if (err.name === 'ZodError') {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: err.errors,
          requestId: req.requestId,
        },
      });
    }

    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: {
          code: 'AUTH_ERROR',
          message: err.message,
          requestId: req.requestId,
        },
      });
    }

    res.status(err.status || 500).json({
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: err.message || 'Internal server error',
        requestId: req.requestId,
      },
    });
  });

  // Initialize WebSocket Server (noServer to avoid conflict with terminal WS)
  console.log('Initializing WebSocket...');
  const wss = new WebSocket.Server({ noServer: true });

  // Setup WebSocket connection handling
  wss.on('connection', (ws, req) => {
    console.log('WebSocket client connected from:', req.socket.remoteAddress);
    ws.channels = [];
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);

        if (data.type === 'subscribe') {
          ws.channels = data.channels || [];
          ws.send(JSON.stringify({
            type: 'subscribed',
            channels: ws.channels,
            timestamp: new Date().toISOString(),
          }));
        } else if (data.type === 'ping') {
          ws.send(JSON.stringify({
            type: 'pong',
            timestamp: new Date().toISOString(),
          }));
        } else if (data.type === 'container.logs.subscribe' && data.data?.container) {
          const containerLogs = require('./lib/containerLogs');
          containerLogs.subscribe(data.data.container, ws);
        } else if (data.type === 'container.logs.unsubscribe' && data.data?.container) {
          const containerLogs = require('./lib/containerLogs');
          containerLogs.unsubscribe(data.data.container, ws);
        }
      } catch (err) {
        console.error('WebSocket message error:', err.message);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
      const containerLogs = require('./lib/containerLogs');
      containerLogs.unsubscribeAll(ws);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err.message);
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Connected to LINBO Plugin API WebSocket',
      timestamp: new Date().toISOString(),
    }));
  });

  // Heartbeat: ping clients every 30s, terminate dead connections
  const wsHeartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
  wss.on('close', () => clearInterval(wsHeartbeat));

  // Initialize websocket utilities with server instance
  websocket.init(wss);
  console.log('  WebSocket initialized');

  // Initialize log stream (captures console.* and broadcasts via WS)
  const logStream = require('./lib/logStream');
  logStream.init(websocket.broadcast);
  console.log('  Log Stream initialized');

  // Initialize container log streaming (journald required)
  const containerLogs = require('./lib/containerLogs');
  containerLogs.init(websocket.broadcast, wss);
  if (containerLogs.isAvailable()) {
    console.log('  Container Logs: ready');
  } else {
    console.log('  Container Logs: unavailable (journald not available)');
  }

  // Initialize Terminal WebSocket Server (noServer to avoid conflict with main WS)
  const terminalService = require('./services/terminal.service');
  const terminalWss = new WebSocket.Server({ noServer: true });

  terminalWss.on('connection', (ws, req) => {
    // Authenticate via ?token= query param
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    let user;
    try {
      user = verifyToken(token);
    } catch (err) {
      ws.close(4001, 'Authentication failed');
      return;
    }

    console.log(`[Terminal WS] Client connected: ${user.username}`);

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        ws.send(JSON.stringify({ type: 'terminal.error', error: 'Invalid JSON' }));
        return;
      }

      try {
        switch (msg.type) {
          case 'terminal.open': {
            const { hostIp, cols, rows } = msg;
            if (!hostIp) {
              ws.send(JSON.stringify({ type: 'terminal.error', error: 'hostIp required' }));
              return;
            }
            const sessionId = await terminalService.createSession(hostIp, user.id || user.username, {
              cols: cols || 80,
              rows: rows || 24,
              onData: (data) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'terminal.output', sessionId, data }));
                }
              },
              onClose: (reason) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'terminal.closed', sessionId, reason }));
                }
              },
              onError: (error) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'terminal.error', sessionId, error }));
                }
              },
            });
            ws.send(JSON.stringify({ type: 'terminal.opened', sessionId, hostIp }));
            break;
          }

          case 'terminal.input': {
            const { sessionId, data } = msg;
            if (!sessionId || data == null) return;
            terminalService.writeToSession(sessionId, data);
            break;
          }

          case 'terminal.resize': {
            const { sessionId, cols, rows } = msg;
            if (!sessionId) return;
            terminalService.resizeSession(sessionId, cols || 80, rows || 24);
            break;
          }

          case 'terminal.close': {
            const { sessionId } = msg;
            if (!sessionId) return;
            terminalService.destroySession(sessionId);
            break;
          }

          default:
            ws.send(JSON.stringify({ type: 'terminal.error', error: `Unknown message type: ${msg.type}` }));
        }
      } catch (err) {
        ws.send(JSON.stringify({
          type: 'terminal.error',
          sessionId: msg.sessionId,
          error: err.message,
        }));
      }
    });

    ws.on('close', () => {
      console.log(`[Terminal WS] Client disconnected: ${user.username}`);
      for (const s of terminalService.listSessions()) {
        if (s.userId === (user.id || user.username)) {
          terminalService.destroySession(s.id);
        }
      }
    });
  });

  server._terminalWss = terminalWss;
  console.log('  Terminal WebSocket initialized');

  // Route HTTP upgrade requests to the correct WebSocket server
  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url, `http://${request.headers.host}`);

    if (pathname === '/ws/terminal') {
      terminalWss.handleUpgrade(request, socket, head, (ws) => {
        terminalWss.emit('connection', ws, request);
      });
    } else if (pathname === '/ws') {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const token = url.searchParams.get('token');
      const user = verifyWsToken(token);

      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.user = user;
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  // Image sync startup recovery (clean stale locks from crashed containers)
  try {
    const imageSyncService = require('./services/image-sync.service');
    await imageSyncService.recoverOnStartup();
    console.log('  Image Sync recovery complete');
  } catch (err) {
    console.warn('  Image Sync recovery skipped:', err.message);
  }

  try {
    const imagePushService = require('./services/image-push.service');
    await imagePushService.recoverOnStartup();
    console.log('  Image Push recovery complete');
  } catch (err) {
    console.warn('  Image Push recovery skipped:', err.message);
  }

  // Auto-Sync Timer
  try {
    const settingsService = require('./services/settings.service');
    await settingsService.applySyncInterval();
    console.log('  Auto-Sync Timer initialized');
  } catch (err) {
    console.warn('  Auto-Sync Timer init skipped:', err.message);
  }

  // First-boot auto-sync: if sync is enabled but never ran, trigger immediately.
  // This ensures DHCP configs (subnets.conf, devices/{school}.conf) are written
  // before the DHCP container needs them.
  if (process.env.SYNC_ENABLED === 'true') {
    try {
      const storeClient = redis.getClient();
      const cursor = await storeClient.get('sync:cursor');
      if (!cursor) {
        console.log('  First boot detected (no sync cursor) — triggering initial sync...');
        const syncService = require('./services/sync.service');
        const result = await syncService.syncOnce();
        console.log(`  Initial sync complete: ${result.stats.hosts} hosts, dhcp=${result.stats.dhcp}`);
      }
    } catch (err) {
      console.warn('  First-boot sync failed:', err.message, '(will retry on next interval)');
    }
  }

  // Host Status Worker (port-scan hosts from Redis sync cache)
  if (process.env.HOST_STATUS_WORKER !== 'false') {
    const hostStatusWorker = require('./workers/host-status.worker');
    hostStatusWorker.startWorker();
    console.log('  Host Status Worker started');
    server._hostStatusWorker = hostStatusWorker;
  }

  // Ensure gui/ symlinks exist (needed for new LINBO client versions)
  try {
    const sanityFs = require('fs');
    const LINBO_DIR_STARTUP = process.env.LINBO_DIR || '/srv/linbo';
    const guiDir = `${LINBO_DIR_STARTUP}/gui`;
    if (!sanityFs.existsSync(guiDir)) sanityFs.mkdirSync(guiDir, { recursive: true });
    const guiArchive = `${LINBO_DIR_STARTUP}/linbo_gui64_7.tar.lz`;
    if (sanityFs.existsSync(guiArchive)) {
      const guiLink = `${guiDir}/linbo_gui64_7.tar.lz`;
      if (!sanityFs.existsSync(guiLink)) sanityFs.symlinkSync(guiArchive, guiLink);
      const md5 = `${guiArchive}.md5`;
      const md5Link = `${guiDir}/linbo_gui64_7.tar.lz.md5`;
      if (sanityFs.existsSync(md5) && !sanityFs.existsSync(md5Link)) sanityFs.symlinkSync(md5, md5Link);
    }
    const iconsDir = `${LINBO_DIR_STARTUP}/icons`;
    const iconsLink = `${guiDir}/icons`;
    if (sanityFs.existsSync(iconsDir) && !sanityFs.existsSync(iconsLink)) {
      sanityFs.symlinkSync(iconsDir, iconsLink);
    }
    console.log('  GUI symlinks: verified');
  } catch (err) {
    console.warn('  GUI symlinks check failed:', err.message);
  }

  // Startup sanity check: verify critical directories exist
  const sanityFs = require('fs');
  const { LINBO_DIR, IMAGES_DIR } = require('./lib/image-path');
  const CONFIG_DIR = process.env.CONFIG_DIR || '/etc/linuxmuster/linbo';
  const HOOKS_DIR = process.env.HOOKSDIR || `${CONFIG_DIR}/hooks`;
  const criticalPaths = [
    { path: LINBO_DIR, desc: 'LINBO root' },
    { path: `${LINBO_DIR}/boot/grub`, desc: 'GRUB config dir' },
    { path: `${LINBO_DIR}/dhcp`, desc: 'DHCP config dir' },
    { path: `${LINBO_DIR}/dhcp/devices`, desc: 'DHCP devices dir' },
    { path: IMAGES_DIR, desc: 'Images dir' },
    { path: `${HOOKS_DIR}/update-linbofs.pre.d`, desc: 'Pre-hooks dir' },
    { path: `${HOOKS_DIR}/update-linbofs.post.d`, desc: 'Post-hooks dir' },
  ];
  for (const { path: p, desc } of criticalPaths) {
    if (!sanityFs.existsSync(p)) {
      try {
        sanityFs.mkdirSync(p, { recursive: true, mode: 0o755 });
        console.log(`  ${desc}: ${p} (created)`);
      } catch (mkErr) {
        console.warn(`  WARNING: ${desc} missing and could not create: ${p} — ${mkErr.message}`);
      }
    } else {
      try {
        const st = sanityFs.statSync(p);
        if (st.isDirectory() && (st.mode & 0o111) === 0) {
          sanityFs.chmodSync(p, 0o755);
          console.log(`  ${desc}: ${p} (fixed permissions)`);
        } else {
          console.log(`  ${desc}: ${p} ok`);
        }
      } catch {
        console.log(`  ${desc}: ${p} ok`);
      }
    }
  }

  // Auto-rebuild linbofs64 if init container downloaded fresh boot files
  try {
    const LINBO_DIR_REBUILD = process.env.LINBO_DIR || '/srv/linbo';
    const rebuildMarker = `${LINBO_DIR_REBUILD}/.needs-rebuild`;
    const runningMarker = `${LINBO_DIR_REBUILD}/.needs-rebuild.running`;

    if (sanityFs.existsSync(rebuildMarker)) {
      console.log('  Rebuild marker found — triggering linbofs64 rebuild...');

      // Wait for SSH keys + rsyncd.secrets to be readable (race condition on fresh deploy)
      // SSH container generates keys after API starts — need to wait for them
      const secretsPath = process.env.RSYNC_SECRETS || '/etc/linuxmuster/linbo/rsyncd.secrets';
      const clientKeyPath = '/etc/linuxmuster/linbo/ssh_host_rsa_key_client';
      const dropbearKeyPath = '/etc/linuxmuster/linbo/dropbear_rsa_host_key';
      const maxWait = 30;
      let waited = 0;
      const waitForSecrets = () => new Promise((resolve) => {
        const check = () => {
          try {
            // Check all required files exist and are readable
            const secretsOk = sanityFs.existsSync(secretsPath) && sanityFs.readFileSync(secretsPath, 'utf8').includes('linbo:');
            const clientKeyOk = sanityFs.existsSync(clientKeyPath) && sanityFs.statSync(clientKeyPath).size > 0;
            const dropbearOk = sanityFs.existsSync(dropbearKeyPath) && sanityFs.statSync(dropbearKeyPath).size > 0;

            if (secretsOk && clientKeyOk && dropbearOk) {
              if (waited > 0) console.log(`  All keys + secrets readable after ${waited}s`);
              resolve(true);
              return;
            }
          } catch {}
          waited++;
          if (waited >= maxWait) { console.warn(`  rsyncd.secrets not readable after ${maxWait}s — proceeding anyway`); resolve(false); return; }
          setTimeout(check, 1000);
        };
        check();
      });

      waitForSecrets().then(() => {
        sanityFs.renameSync(rebuildMarker, runningMarker);
        const linbofsService = require('./services/linbofs.service');
        return linbofsService.updateLinbofs();
      }).then(result => {
        if (result.success) {
          console.log('[AutoRebuild] linbofs64 rebuilt successfully');
          try { sanityFs.unlinkSync(runningMarker); } catch (err) { console.debug('[AutoRebuild] cleanup:', err.message); }
        } else {
          console.error('[AutoRebuild] FAILED:', result.errors);
          try { sanityFs.renameSync(runningMarker, rebuildMarker); } catch (err) { console.debug('[AutoRebuild] restore marker:', err.message); }
        }
      }).catch(err => {
        console.error('[AutoRebuild] Error:', err.message);
        try { sanityFs.renameSync(runningMarker, rebuildMarker); } catch (err2) { console.debug('[AutoRebuild] restore marker:', err2.message); }
      });
    } else if (sanityFs.existsSync(runningMarker)) {
      console.log('  Previous rebuild was interrupted — retrying...');
      sanityFs.renameSync(runningMarker, rebuildMarker);
    }
  } catch (err) {
    console.warn('  Auto-rebuild check failed:', err.message);
  }

  // Start HTTP server
  server.listen(PORT, HOST, () => {
    console.log(`
LINBO Plugin API Server (sync-only)
  REST API:     http://${HOST}:${PORT}/api/v1
  API Docs:     http://${HOST}:${PORT}/docs
  OpenAPI JSON: http://${HOST}:${PORT}/openapi.json
  WebSocket:    ws://${HOST}:${PORT}/ws
  Health:       http://${HOST}:${PORT}/health
  Environment:  ${process.env.NODE_ENV || 'development'}
    `);
  });
}

// =============================================================================
// Graceful Shutdown
// =============================================================================
async function shutdown(signal) {
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);

  server.close(async () => {
    console.log('HTTP server closed');

    // Stop Host Status Worker
    if (server._hostStatusWorker) {
      server._hostStatusWorker.stopWorker();
      console.log('Host Status Worker stopped');
    }

    // Close terminal sessions
    try {
      const termService = require('./services/terminal.service');
      termService.destroyAll();
      console.log('Terminal sessions closed');
    } catch (err) {
      console.debug('[Shutdown] terminal cleanup failed:', err.message);
    }

    // Close Terminal WebSocket connections
    if (server._terminalWss) {
      server._terminalWss.clients.forEach((client) => {
        client.close(1001, 'Server shutting down');
      });
    }

    // Close WebSocket connections
    const wss = websocket.getServer();
    if (wss) {
      wss.clients.forEach((client) => {
        client.close(1001, 'Server shutting down');
      });
      console.log('WebSocket connections closed');
    }

    // Flush store snapshot to disk
    try {
      await redis.disconnect();
      console.log('Store snapshot saved');
    } catch (err) {
      console.error('Store flush error:', err.message);
    }

    console.log('Graceful shutdown complete');
    process.exit(0);
  });

  // Force shutdown after timeout
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the server
startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Export for testing
module.exports = { app, server };

// Test helpers
module.exports._testing = { validateSecrets, verifyWsToken };
