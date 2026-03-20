/**
 * LINBO Docker - WebSocket Integration Tests
 *
 * Tests WS auth (JWT + internal key), heartbeat keep-alive,
 * channel subscription broadcasting, and application-level ping/pong.
 *
 * Spins up a real Express + WS server on a random port per run.
 */

const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

// Constants matching globalSetup.js
const TEST_JWT_SECRET = 'test_jwt_secret_for_testing_only';
const TEST_INTERNAL_KEY = 'test-internal-api-key';

// Set env vars BEFORE requiring modules that read them at load time
process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.INTERNAL_API_KEY = TEST_INTERNAL_KEY;

const websocket = require('../../src/lib/websocket');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Connect a ws client and return it with a message queue.
 * Starts buffering messages from the moment the socket opens so no
 * messages are lost to race conditions.
 * Rejects if the server sends a 401 (ws emits 'error').
 */
function connectWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messageQueue = [];
    let messageWaiter = null;

    ws.on('message', (raw) => {
      const parsed = JSON.parse(raw.toString());
      if (messageWaiter) {
        const { resolve: r, timer } = messageWaiter;
        messageWaiter = null;
        clearTimeout(timer);
        r(parsed);
      } else {
        messageQueue.push(parsed);
      }
    });

    /**
     * Get the next message. Returns immediately if one is already queued,
     * otherwise waits up to `timeout` ms.
     */
    ws.nextMessage = (timeout = 2000) => {
      if (messageQueue.length > 0) {
        return Promise.resolve(messageQueue.shift());
      }
      return new Promise((r, rej) => {
        const timer = setTimeout(() => {
          messageWaiter = null;
          rej(new Error('nextMessage timed out'));
        }, timeout);
        messageWaiter = { resolve: r, timer };
      });
    };

    ws.once('open', () => resolve(ws));
    ws.once('error', (err) => reject(err));
  });
}

// ---------------------------------------------------------------------------
// Server setup / teardown
// ---------------------------------------------------------------------------

let server;
let wss;
let heartbeatInterval;
let port;

/** Mirrors production index.js verifyWsToken */
function verifyWsToken(token) {
  if (!token) return null;
  if (TEST_INTERNAL_KEY && token === TEST_INTERNAL_KEY) {
    return { id: 'internal', username: 'internal-service', role: 'admin' };
  }
  try {
    return jwt.verify(token, TEST_JWT_SECRET);
  } catch {
    return null;
  }
}

beforeAll((done) => {
  const app = express();
  server = http.createServer(app);
  wss = new WebSocket.Server({ noServer: true });

  // ---- Connection handler (mirrors production) ----
  wss.on('connection', (ws) => {
    ws.channels = [];
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw);
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
        }
      } catch {
        // ignore parse errors
      }
    });

    // Welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Welcome',
      timestamp: new Date().toISOString(),
    }));
  });

  // ---- Heartbeat: 150ms for fast tests ----
  heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 150);

  // ---- Upgrade handler (mirrors production) ----
  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url, `http://${request.headers.host}`);
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }

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
  });

  // ---- Initialize websocket utility (broadcastToChannels) ----
  websocket.init(wss);

  // ---- Listen on random port ----
  server.listen(0, () => {
    port = server.address().port;
    done();
  });
});

afterAll((done) => {
  clearInterval(heartbeatInterval);

  // Terminate every connected client
  wss.clients.forEach((client) => client.terminate());

  wss.close(() => {
    server.close(() => done());
  });
});

// ---------------------------------------------------------------------------
// Helper: sign a valid JWT for tests
// ---------------------------------------------------------------------------
function signToken(payload = {}) {
  return jwt.sign(
    { id: 1, username: 'testuser', role: 'admin', ...payload },
    TEST_JWT_SECRET,
    { expiresIn: '1h' },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Connection Authentication', () => {
  test('connection with valid JWT succeeds', async () => {
    const token = signToken();
    const ws = await connectWs(`ws://localhost:${port}/ws?token=${token}`);
    const msg = await ws.nextMessage();

    expect(msg.type).toBe('connected');
    expect(msg.message).toBeDefined();
    ws.close();
  });

  test('connection with internal API key succeeds', async () => {
    const ws = await connectWs(`ws://localhost:${port}/ws?token=${TEST_INTERNAL_KEY}`);
    const msg = await ws.nextMessage();

    expect(msg.type).toBe('connected');
    ws.close();
  });

  test('connection without token is rejected', async () => {
    await expect(connectWs(`ws://localhost:${port}/ws`)).rejects.toThrow();
  });

  test('connection with invalid token is rejected', async () => {
    await expect(
      connectWs(`ws://localhost:${port}/ws?token=garbage`),
    ).rejects.toThrow();
  });
});

describe('Heartbeat', () => {
  test('heartbeat keeps connection alive across multiple cycles', async () => {
    const token = signToken();
    const ws = await connectWs(`ws://localhost:${port}/ws?token=${token}`);
    await ws.nextMessage(); // consume welcome

    // Wait > 2 heartbeat intervals (2 * 150ms = 300ms, use 400ms)
    await new Promise((r) => setTimeout(r, 400));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  test('missed heartbeat terminates connection', async () => {
    const token = signToken();
    const ws = await connectWs(`ws://localhost:${port}/ws?token=${token}`);
    await ws.nextMessage(); // consume welcome

    // Find the matching server-side client and mark isAlive = false
    for (const client of wss.clients) {
      client.isAlive = false;
    }

    // Wait for the next heartbeat cycle to terminate it
    await new Promise((resolve) => {
      ws.on('close', resolve);
      // Safety timeout so the test doesn't hang
      setTimeout(resolve, 500);
    });

    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });
});

describe('Channel Subscription', () => {
  test('subscribing to specific channel delivers targeted broadcasts', async () => {
    const token = signToken();
    const ws = await connectWs(`ws://localhost:${port}/ws?token=${token}`);
    await ws.nextMessage(); // welcome

    // Subscribe
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['room:lab1'] }));
    const ack = await ws.nextMessage();
    expect(ack.type).toBe('subscribed');
    expect(ack.channels).toEqual(['room:lab1']);

    // Broadcast
    websocket.broadcastToChannels('test.event', { msg: 'hello' }, ['room:lab1']);
    const msg = await ws.nextMessage();
    expect(msg.type).toBe('test.event');
    expect(msg.data.msg).toBe('hello');

    ws.close();
  });

  test('wildcard subscription receives all channel broadcasts', async () => {
    const token = signToken();
    const ws = await connectWs(`ws://localhost:${port}/ws?token=${token}`);
    await ws.nextMessage(); // welcome

    ws.send(JSON.stringify({ type: 'subscribe', channels: ['*'] }));
    await ws.nextMessage(); // subscribed ack

    websocket.broadcastToChannels('any.event', { x: 1 }, ['room:lab2']);
    const msg = await ws.nextMessage();
    expect(msg.type).toBe('any.event');
    expect(msg.data.x).toBe(1);

    ws.close();
  });

  test('unsubscribed client does not receive channel broadcasts', async () => {
    const token = signToken();

    // Client 1 subscribes to room:lab1
    const ws1 = await connectWs(`ws://localhost:${port}/ws?token=${token}`);
    await ws1.nextMessage(); // welcome
    ws1.send(JSON.stringify({ type: 'subscribe', channels: ['room:lab1'] }));
    await ws1.nextMessage(); // subscribed ack

    // Client 2 does NOT subscribe
    const ws2 = await connectWs(`ws://localhost:${port}/ws?token=${token}`);
    await ws2.nextMessage(); // welcome

    // Broadcast to room:lab1
    websocket.broadcastToChannels('targeted.event', { v: 42 }, ['room:lab1']);

    // Client 1 should receive
    const msg1 = await ws1.nextMessage();
    expect(msg1.type).toBe('targeted.event');

    // Client 2 should NOT receive (short timeout)
    const noMsg = await ws2.nextMessage(300).catch(() => null);
    expect(noMsg).toBeNull();

    ws1.close();
    ws2.close();
  });
});

describe('Application-level Ping', () => {
  test('ping message receives pong response', async () => {
    const token = signToken();
    const ws = await connectWs(`ws://localhost:${port}/ws?token=${token}`);
    await ws.nextMessage(); // welcome

    ws.send(JSON.stringify({ type: 'ping' }));
    const msg = await ws.nextMessage();
    expect(msg.type).toBe('pong');
    expect(msg.timestamp).toBeDefined();

    ws.close();
  });
});
