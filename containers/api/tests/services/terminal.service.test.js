/**
 * LINBO Docker - Terminal Service Tests
 * Tests for interactive SSH session management (TEST-02)
 *
 * Covers: session create/destroy lifecycle, PTY-to-exec fallback,
 * idle timeout triggers cleanup, destroyAll with no orphans,
 * max sessions, resize on exec-mode, writeToSession.
 */

// Set MAX_SESSIONS low before module loads (reads env at require-time)
process.env.TERMINAL_MAX_SESSIONS = '2';

// Mock fs BEFORE requiring terminal.service (module loads key at require-time)
jest.mock('fs', () => ({
  readFileSync: jest.fn(() => Buffer.from('mock-ssh-key')),
  existsSync: jest.fn(() => true),
}));

// Mock uuid with predictable counter (prefixed with 'mock' for Jest hoisting)
let mockUuidCounter = 0;
jest.mock('uuid', () => ({
  v4: jest.fn(() => `mock-session-${++mockUuidCounter}`),
}));

// Module-scoped variables to control mock behavior (prefixed with 'mock' for Jest)
let mockLastClient = null;
let mockShellBehavior = 'success'; // 'success' | 'pty-fail' | 'exec-fail-too'
let mockConnectBehavior = 'success'; // 'success' | 'error'

jest.mock('ssh2', () => ({
  Client: jest.fn().mockImplementation(() => {
    const EventEmitter = require('events');
    const client = new EventEmitter();

    client.connect = jest.fn(function () {
      if (mockConnectBehavior === 'error') {
        setTimeout(() => this.emit('error', new Error('Connection refused')), 0);
      } else {
        setTimeout(() => this.emit('ready'), 0);
      }
    });

    client.shell = jest.fn(function (opts, callback) {
      if (mockShellBehavior === 'pty-fail' || mockShellBehavior === 'exec-fail-too') {
        callback(new Error('PTY not available'));
        return;
      }
      const stream = new EventEmitter();
      stream.write = jest.fn();
      stream.end = jest.fn();
      stream.setWindow = jest.fn();
      stream.stderr = new EventEmitter();
      callback(null, stream);
    });

    client.exec = jest.fn(function (cmd, callback) {
      if (mockShellBehavior === 'exec-fail-too') {
        callback(new Error('Exec also failed'));
        return;
      }
      const stream = new EventEmitter();
      stream.write = jest.fn();
      stream.end = jest.fn();
      stream.stderr = new EventEmitter();
      // No setWindow on exec streams
      callback(null, stream);
    });

    client.end = jest.fn();

    mockLastClient = client;
    return client;
  }),
}));

// Now require the service (after all mocks are set up)
const {
  createSession,
  writeToSession,
  resizeSession,
  destroySession,
  listSessions,
  getSession,
  destroyAll,
} = require('../../src/services/terminal.service');

describe('Terminal Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUuidCounter = 0;
    mockShellBehavior = 'success';
    mockConnectBehavior = 'success';
    mockLastClient = null;
    destroyAll();
  });

  afterAll(() => {
    destroyAll();
  });

  // Helper to create a session with default callbacks
  function createTestSession(overrides = {}) {
    return createSession(
      overrides.hostIp || '10.0.0.100',
      overrides.userId || 'test-user',
      {
        cols: overrides.cols || 80,
        rows: overrides.rows || 24,
        onData: overrides.onData || jest.fn(),
        onClose: overrides.onClose || jest.fn(),
        onError: overrides.onError || jest.fn(),
      }
    );
  }

  describe('createSession()', () => {
    test('creates a PTY session and returns sessionId', async () => {
      const sessionId = await createTestSession();

      expect(typeof sessionId).toBe('string');
      expect(sessionId).toBe('mock-session-1');

      const sessions = listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('mock-session-1');
      expect(sessions[0].hostIp).toBe('10.0.0.100');
      expect(sessions[0].userId).toBe('test-user');
      expect(sessions[0].mode).toBe('pty');
    });

    test('falls back to exec mode when PTY fails', async () => {
      mockShellBehavior = 'pty-fail';

      const sessionId = await createTestSession();

      expect(typeof sessionId).toBe('string');
      const session = getSession(sessionId);
      expect(session).not.toBeNull();
      expect(session.mode).toBe('exec');

      // Verify client.exec was called with 'sh'
      expect(mockLastClient.exec).toHaveBeenCalledWith('sh', expect.any(Function));
    });

    test('rejects when connection fails', async () => {
      mockConnectBehavior = 'error';

      await expect(createTestSession()).rejects.toThrow('Connection refused');
    });

    test('rejects when max sessions reached', async () => {
      // MAX_SESSIONS = 2 (set via env at top of file)
      await createTestSession({ hostIp: '10.0.0.101' });
      await createTestSession({ hostIp: '10.0.0.102' });

      await expect(createTestSession({ hostIp: '10.0.0.103' })).rejects.toThrow(
        'Maximum sessions (2) reached'
      );
    });

    test('rejects when both PTY and exec fail', async () => {
      mockShellBehavior = 'exec-fail-too';

      await expect(createTestSession()).rejects.toThrow('Exec also failed');
    });
  });

  describe('writeToSession()', () => {
    test('writes data to session stream', async () => {
      const sessionId = await createTestSession();
      const session = getSession(sessionId);

      writeToSession(sessionId, 'test data');

      expect(session.stream.write).toHaveBeenCalledWith('test data');
    });

    test('throws when session not found', () => {
      expect(() => writeToSession('nonexistent', 'data')).toThrow('Session not found');
    });
  });

  describe('resizeSession()', () => {
    test('calls setWindow on PTY session', async () => {
      const sessionId = await createTestSession();
      const session = getSession(sessionId);

      resizeSession(sessionId, 120, 40);

      // Note: setWindow args are (rows, cols, 0, 0)
      expect(session.stream.setWindow).toHaveBeenCalledWith(40, 120, 0, 0);
    });

    test('does not call setWindow on exec session', async () => {
      mockShellBehavior = 'pty-fail';
      const sessionId = await createTestSession();
      const session = getSession(sessionId);

      // exec streams have no setWindow, and mode check skips it
      resizeSession(sessionId, 120, 40);

      // The code checks: session.mode === 'pty' && session.stream.setWindow
      // exec mode skips the setWindow call entirely
      expect(session.mode).toBe('exec');
    });

    test('throws when session not found', () => {
      expect(() => resizeSession('nonexistent', 80, 24)).toThrow('Session not found');
    });
  });

  describe('destroySession()', () => {
    test('removes session and calls onClose callback', async () => {
      const onClose = jest.fn();
      const sessionId = await createTestSession({ onClose });

      destroySession(sessionId);

      expect(getSession(sessionId)).toBeNull();
      expect(onClose).toHaveBeenCalledWith('destroyed by user');
    });

    test('calls client.end during cleanup', async () => {
      const sessionId = await createTestSession();
      const client = mockLastClient;

      destroySession(sessionId);

      expect(client.end).toHaveBeenCalled();
    });
  });

  describe('idle timeout', () => {
    test('destroys session after idle timeout', async () => {
      jest.useFakeTimers();

      const onClose = jest.fn();

      // Create session - the ssh2 mock uses setTimeout(fn, 0) for 'ready'
      const sessionPromise = createTestSession({ onClose });
      jest.advanceTimersByTime(1); // Trigger the 'ready' event
      const sessionId = await sessionPromise;

      expect(getSession(sessionId)).not.toBeNull();

      // Advance past the idle timeout (30 minutes)
      jest.advanceTimersByTime(30 * 60 * 1000);

      expect(getSession(sessionId)).toBeNull();
      expect(onClose).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('destroyAll()', () => {
    test('destroys all sessions with no orphans', async () => {
      const onClose1 = jest.fn();
      const onClose2 = jest.fn();

      await createTestSession({ hostIp: '10.0.0.101', onClose: onClose1 });
      await createTestSession({ hostIp: '10.0.0.102', onClose: onClose2 });

      expect(listSessions()).toHaveLength(2);

      destroyAll();

      expect(listSessions()).toHaveLength(0);
      expect(onClose1).toHaveBeenCalledWith('server shutdown');
      expect(onClose2).toHaveBeenCalledWith('server shutdown');
    });

    test('handles empty sessions map gracefully', () => {
      // No sessions created -- should not throw
      expect(() => destroyAll()).not.toThrow();
      expect(listSessions()).toHaveLength(0);
    });
  });

  describe('listSessions()', () => {
    test('returns session metadata without internals', async () => {
      await createTestSession({ hostIp: '10.0.0.101', userId: 'admin' });

      const sessions = listSessions();
      expect(sessions).toHaveLength(1);

      const session = sessions[0];
      expect(session).toHaveProperty('id');
      expect(session).toHaveProperty('hostIp', '10.0.0.101');
      expect(session).toHaveProperty('userId', 'admin');
      expect(session).toHaveProperty('mode', 'pty');
      expect(session).toHaveProperty('createdAt');
      expect(session).toHaveProperty('lastActivity');
      // Should NOT expose internal objects
      expect(session).not.toHaveProperty('client');
      expect(session).not.toHaveProperty('stream');
      expect(session).not.toHaveProperty('onData');
    });
  });

  describe('getSession()', () => {
    test('returns null for unknown session', () => {
      expect(getSession('nonexistent')).toBeNull();
    });
  });
});
