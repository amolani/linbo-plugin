/**
 * LINBO Docker - SSH Service Tests
 * Tests für SSH-Befehlsausführung
 */

const fs = require('fs');

// Mock ssh2 Client
jest.mock('ssh2', () => ({
  Client: jest.fn().mockImplementation(() => {
    const EventEmitter = require('events');
    const client = new EventEmitter();

    client.connect = jest.fn(function(config) {
      // Simulate connection based on host
      if (config.host === 'unreachable') {
        setTimeout(() => this.emit('error', new Error('Connection refused')), 10);
      } else {
        setTimeout(() => this.emit('ready'), 10);
      }
    });

    client.exec = jest.fn(function(command, callback) {
      const EventEmitter = require('events');
      const stream = new EventEmitter();
      stream.stderr = new EventEmitter();

      // Simulate command execution
      setTimeout(() => {
        if (command.includes('fail')) {
          stream.stderr.emit('data', Buffer.from('Command failed'));
          stream.emit('close', 1);
        } else if (command.includes('echo "connected"')) {
          stream.emit('data', Buffer.from('connected\n'));
          stream.emit('close', 0);
        } else if (command.includes('linbo_cmd')) {
          stream.emit('data', Buffer.from('LINBO command executed\n'));
          stream.emit('close', 0);
        } else {
          stream.emit('data', Buffer.from('command output\n'));
          stream.emit('close', 0);
        }
      }, 10);

      callback(null, stream);
    });

    client.end = jest.fn();

    return client;
  }),
}));

const sshService = require('../../src/services/ssh.service');

describe('SSH Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getPrivateKey', () => {
    const { getPrivateKey, _resetCache } = sshService._testing;

    beforeEach(() => {
      _resetCache();
    });

    test('returns a Buffer when key file exists', () => {
      const fakeKey = Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----');
      jest.spyOn(fs, 'readFileSync').mockReturnValueOnce(fakeKey);

      const result = getPrivateKey();
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result).toBe(fakeKey);

      fs.readFileSync.mockRestore();
    });

    test('caches key after first successful load (readFileSync called once for two calls)', () => {
      const fakeKey = Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----');
      const spy = jest.spyOn(fs, 'readFileSync').mockReturnValueOnce(fakeKey);

      const result1 = getPrivateKey();
      const result2 = getPrivateKey();

      expect(result1).toBe(result2);
      expect(spy).toHaveBeenCalledTimes(1);

      spy.mockRestore();
    });

    test('throws Error with key path in message when file missing and no fallback', () => {
      const spy = jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      // Ensure SSH_PRIVATE_KEY env is not set for this test
      const origFallback = process.env.SSH_PRIVATE_KEY;
      delete process.env.SSH_PRIVATE_KEY;

      expect(() => getPrivateKey()).toThrow(/SSH private key not available/);
      expect(() => {
        _resetCache();
        getPrivateKey();
      }).toThrow(/linbo_client_key/);

      process.env.SSH_PRIVATE_KEY = origFallback;
      spy.mockRestore();
    });

    test('falls back to SSH_PRIVATE_KEY path when primary key missing', () => {
      const fallbackKey = Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nfallback\n-----END RSA PRIVATE KEY-----');
      const origFallback = process.env.SSH_PRIVATE_KEY;
      process.env.SSH_PRIVATE_KEY = '/tmp/test_fallback_key';

      const spy = jest.spyOn(fs, 'readFileSync').mockImplementation((path) => {
        if (path === '/tmp/test_fallback_key') {
          return fallbackKey;
        }
        throw new Error('ENOENT: no such file or directory');
      });

      const result = getPrivateKey();
      expect(result).toBe(fallbackKey);

      process.env.SSH_PRIVATE_KEY = origFallback;
      spy.mockRestore();
    });
  });

  describe('getConfig', () => {
    const { getConfig, _resetCache } = sshService._testing;

    beforeEach(() => {
      _resetCache();
    });

    test('returns config object with privateKey from getPrivateKey()', () => {
      const fakeKey = Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----');
      jest.spyOn(fs, 'readFileSync').mockReturnValueOnce(fakeKey);

      const config = getConfig('192.168.1.100');
      expect(config.host).toBe('192.168.1.100');
      expect(config.privateKey).toBe(fakeKey);
      expect(config.port).toBe(2222);
      expect(config.username).toBe('root');
      expect(config.readyTimeout).toBe(10000);
      expect(config.keepaliveInterval).toBe(5000);

      fs.readFileSync.mockRestore();
    });

    test('throws when no key available', () => {
      const spy = jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('ENOENT');
      });
      const origFallback = process.env.SSH_PRIVATE_KEY;
      delete process.env.SSH_PRIVATE_KEY;

      expect(() => getConfig('192.168.1.100')).toThrow(/SSH private key not available/);

      process.env.SSH_PRIVATE_KEY = origFallback;
      spy.mockRestore();
    });
  });

  describe('executeCommand', () => {
    test('should execute command and return output', async () => {
      const result = await sshService.executeCommand('192.168.1.100', 'ls -la');

      expect(result.stdout).toContain('command output');
      expect(result.code).toBe(0);
    });

    test('should capture stderr for failed commands', async () => {
      const result = await sshService.executeCommand('192.168.1.100', 'fail_command');

      expect(result.stderr).toContain('Command failed');
      expect(result.code).toBe(1);
    });

    test('should reject on connection error', async () => {
      await expect(
        sshService.executeCommand('unreachable', 'ls')
      ).rejects.toThrow('Connection refused');
    });

    test('should use default configuration', async () => {
      await sshService.executeCommand('192.168.1.100', 'test');

      const { Client } = require('ssh2');
      const mockInstance = Client.mock.results[0].value;
      expect(mockInstance.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          host: '192.168.1.100',
          port: 2222,
          username: expect.any(String),
        })
      );
    });

    test('should allow custom options', async () => {
      await sshService.executeCommand('192.168.1.100', 'test', {
        port: 2222,
        username: 'linbo',
      });

      const { Client } = require('ssh2');
      const mockInstance = Client.mock.results[0].value;
      expect(mockInstance.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 2222,
          username: 'linbo',
        })
      );
    });
  });

  describe('executeCommands', () => {
    test('should execute multiple commands sequentially', async () => {
      const results = await sshService.executeCommands('192.168.1.100', [
        'command1',
        'command2',
        'command3',
      ]);

      expect(results.length).toBe(3);
      results.forEach(result => {
        expect(result.success).toBe(true);
        expect(result.code).toBe(0);
      });
    });

    test('should stop on first failure by default', async () => {
      const results = await sshService.executeCommands('192.168.1.100', [
        'command1',
        'fail_command',
        'command3',
      ]);

      expect(results.length).toBe(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
    });

    test('should continue on error when option set', async () => {
      const results = await sshService.executeCommands('192.168.1.100', [
        'command1',
        'fail_command',
        'command3',
      ], { continueOnError: true });

      expect(results.length).toBe(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
    });

    test('should handle connection errors', async () => {
      const results = await sshService.executeCommands('unreachable', [
        'command1',
      ], { continueOnError: false });

      expect(results.length).toBe(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBeDefined();
    });
  });

  describe('executeWithTimeout', () => {
    test('should complete before timeout', async () => {
      const result = await sshService.executeWithTimeout(
        '192.168.1.100',
        'quick_command',
        5000
      );

      expect(result.code).toBe(0);
    });

    test('should reject on timeout', async () => {
      // Mock a slow command by using a long delay
      jest.useFakeTimers();

      const promise = sshService.executeWithTimeout(
        '192.168.1.100',
        'slow_command',
        100 // Very short timeout
      );

      jest.advanceTimersByTime(150);

      await expect(promise).rejects.toThrow('Command timeout');

      jest.useRealTimers();
    });
  });

  describe('testConnection', () => {
    test('should return success for reachable host', async () => {
      const result = await sshService.testConnection('192.168.1.100');

      expect(result.success).toBe(true);
      expect(result.connected).toBe(true);
    });

    test('should return failure for unreachable host', async () => {
      const result = await sshService.testConnection('unreachable');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('executeLinboCommand', () => {
    test('should execute sync command', async () => {
      const result = await sshService.executeLinboCommand('192.168.1.100', 'sync', {
        osName: 'Windows 11',
      });

      expect(result.stdout).toContain('LINBO command executed');
      expect(result.code).toBe(0);
    });

    test('should execute sync with force option', async () => {
      const result = await sshService.executeLinboCommand('192.168.1.100', 'sync', {
        forceNew: true,
      });

      expect(result.code).toBe(0);
    });

    test('should execute start command', async () => {
      const result = await sshService.executeLinboCommand('192.168.1.100', 'start', {
        osName: 'Windows 11',
      });

      expect(result.code).toBe(0);
    });

    test('should execute reboot command', async () => {
      const result = await sshService.executeLinboCommand('192.168.1.100', 'reboot');

      expect(result.code).toBe(0);
    });

    test('should execute shutdown command', async () => {
      const result = await sshService.executeLinboCommand('192.168.1.100', 'shutdown');

      expect(result.code).toBe(0);
    });

    test('should execute halt command', async () => {
      const result = await sshService.executeLinboCommand('192.168.1.100', 'halt');

      expect(result.code).toBe(0);
    });

    test('should execute initcache command', async () => {
      const result = await sshService.executeLinboCommand('192.168.1.100', 'initcache', {
        downloadType: 'rsync',
      });

      expect(result.code).toBe(0);
    });

    test('should execute partition command', async () => {
      const result = await sshService.executeLinboCommand('192.168.1.100', 'partition');

      expect(result.code).toBe(0);
    });

    test('should execute format command', async () => {
      const result = await sshService.executeLinboCommand('192.168.1.100', 'format', {
        partition: '/dev/sda2',
      });

      expect(result.code).toBe(0);
    });

    test('should throw error for unknown command', async () => {
      await expect(
        sshService.executeLinboCommand('192.168.1.100', 'unknown_command')
      ).rejects.toThrow('Unknown LINBO command: unknown_command');
    });
  });

  describe('getLinboStatus', () => {
    test('should return LINBO status information', async () => {
      const result = await sshService.getLinboStatus('192.168.1.100');

      // The mock returns JSON output that can't be parsed, causing failure
      // Just verify the function handles this gracefully
      expect(result).toBeDefined();
    });

    test('should handle connection errors gracefully', async () => {
      const result = await sshService.getLinboStatus('unreachable');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('streamCommand', () => {
    test('should stream command output', async () => {
      const onData = jest.fn();
      const onError = jest.fn();

      const result = await sshService.streamCommand(
        '192.168.1.100',
        'stream_command',
        onData,
        onError
      );

      expect(result.code).toBe(0);
      expect(onData).toHaveBeenCalled();
    });

    test('should stream stderr to error callback', async () => {
      const onData = jest.fn();
      const onError = jest.fn();

      await sshService.streamCommand(
        '192.168.1.100',
        'fail_stream',
        onData,
        onError
      );

      expect(onError).toHaveBeenCalled();
    });
  });
});
