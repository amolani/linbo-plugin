/**
 * LINBO Docker - Redis delPattern Tests
 * Tests for SCAN-based delPattern replacing KEYS command
 */

const { EventEmitter } = require('events');

// Mock ioredis before requiring redis module
const mockPipeline = {
  del: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue([]),
};

const mockClient = {
  scanStream: jest.fn(),
  pipeline: jest.fn(() => mockPipeline),
  on: jest.fn().mockReturnThis(),
};

jest.mock('ioredis', () => {
  return jest.fn(() => mockClient);
});

const redis = require('../../src/lib/redis');

describe('redis delPattern', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPipeline.del.mockReturnThis();
    mockPipeline.exec.mockResolvedValue([]);
  });

  /**
   * Helper: create a controllable scanStream emitter
   */
  function createScanStream(batches) {
    const emitter = new EventEmitter();
    // Track pause/resume
    emitter.pause = jest.fn();
    emitter.resume = jest.fn();
    emitter.destroy = jest.fn();

    mockClient.scanStream.mockReturnValue(emitter);

    // Emit batches async to allow the listener to attach
    process.nextTick(() => {
      for (const batch of batches) {
        emitter.emit('data', batch);
      }
      emitter.emit('end');
    });

    return emitter;
  }

  test('should return 0 when no keys match pattern', async () => {
    createScanStream([]);

    const count = await redis.delPattern('nonexistent:*');

    expect(count).toBe(0);
    expect(mockClient.scanStream).toHaveBeenCalledWith({
      match: 'nonexistent:*',
      count: 100,
    });
    // No pipeline created for empty result
    expect(mockClient.pipeline).not.toHaveBeenCalled();
  });

  test('should return 0 when stream emits empty array', async () => {
    createScanStream([[]]);

    const count = await redis.delPattern('empty:*');

    expect(count).toBe(0);
    // Empty batch should be skipped -- no pipeline created
    expect(mockClient.pipeline).not.toHaveBeenCalled();
  });

  test('should delete single batch of 3 keys and return 3', async () => {
    const keys = ['host:1', 'host:2', 'host:3'];
    const stream = createScanStream([keys]);

    const count = await redis.delPattern('host:*');

    expect(count).toBe(3);
    expect(mockClient.pipeline).toHaveBeenCalledWith(
      keys.map(k => ['del', k])
    );
    expect(mockPipeline.exec).toHaveBeenCalledTimes(1);
    // Stream should be paused during pipeline exec
    expect(stream.pause).toHaveBeenCalled();
  });

  test('should accumulate count across multiple batches', async () => {
    // Two separate batches
    const batch1 = ['img:1', 'img:2'];
    const batch2 = ['img:3', 'img:4', 'img:5'];

    // Need async handling for pause/resume across batches
    const emitter = new EventEmitter();
    emitter.pause = jest.fn();
    emitter.resume = jest.fn();
    emitter.destroy = jest.fn();

    mockClient.scanStream.mockReturnValue(emitter);

    // When pause is called, we need to hold, then on exec completion, resume emits next batch
    let batchIndex = 0;
    const batches = [batch1, batch2];

    mockPipeline.exec.mockImplementation(() => {
      return new Promise(resolve => {
        process.nextTick(() => {
          resolve([]);
          // After exec resolves and stream.resume() is called, emit next batch or end
          process.nextTick(() => {
            batchIndex++;
            if (batchIndex < batches.length) {
              emitter.emit('data', batches[batchIndex]);
            } else {
              emitter.emit('end');
            }
          });
        });
      });
    });

    // Start the first batch
    process.nextTick(() => {
      emitter.emit('data', batches[0]);
    });

    const count = await redis.delPattern('img:*');

    expect(count).toBe(5);
    expect(mockClient.pipeline).toHaveBeenCalledTimes(2);
  });

  test('should propagate pipeline errors', async () => {
    const keys = ['err:1'];
    const emitter = new EventEmitter();
    emitter.pause = jest.fn();
    emitter.resume = jest.fn();
    emitter.destroy = jest.fn();

    mockClient.scanStream.mockReturnValue(emitter);
    mockPipeline.exec.mockRejectedValue(new Error('Pipeline failed'));

    process.nextTick(() => {
      emitter.emit('data', keys);
    });

    await expect(redis.delPattern('err:*')).rejects.toThrow('Pipeline failed');
    expect(emitter.destroy).toHaveBeenCalled();
  });

  test('should propagate stream errors', async () => {
    const emitter = new EventEmitter();
    emitter.pause = jest.fn();
    emitter.resume = jest.fn();
    emitter.destroy = jest.fn();

    mockClient.scanStream.mockReturnValue(emitter);

    process.nextTick(() => {
      emitter.emit('error', new Error('Stream error'));
    });

    await expect(redis.delPattern('broken:*')).rejects.toThrow('Stream error');
  });

  test('should use scanStream not client.keys', async () => {
    createScanStream([]);

    await redis.delPattern('test:*');

    expect(mockClient.scanStream).toHaveBeenCalled();
    // client.keys should not exist on mock (never called)
    expect(mockClient.keys).toBeUndefined();
  });
});
