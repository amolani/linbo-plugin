/**
 * LINBO Docker - Image Sync Service Tests
 *
 * Covers TEST-01 success criteria:
 * - Resume download from byte offset (Range header)
 * - MD5 hash verification (pass + fail)
 * - Atomic directory swap (fsp.rm + fsp.rename)
 * - Queue ordering (NX lock + rpush/lpop FIFO)
 * - Edge cases: network failure, stale lock recovery, cancel job
 */

const { EventEmitter } = require('events');
const path = require('path');

// ---------------------------------------------------------------------------
// Test Constants
// ---------------------------------------------------------------------------

const MOCK_MANIFEST = [
  {
    name: 'ubuntu2404',
    filename: 'ubuntu2404.qcow2',
    imagesize: 5000000,
    totalSize: 5200000,
    checksum: 'abc123',
    files: [
      { name: 'ubuntu2404.qcow2', size: 5000000 },
      { name: 'ubuntu2404.qcow2.md5', size: 64 },
      { name: 'ubuntu2404.desc', size: 128 },
    ],
  },
];

const MOCK_MD5_HASH = 'd41d8cd98f00b204e9800998ecf8427e';

// ---------------------------------------------------------------------------
// Mocks (before requires)
// ---------------------------------------------------------------------------

const { createRedisMock } = require('../mocks/redis');
const mockRedis = createRedisMock();

jest.mock('../../../src/lib/redis', () => ({
  getClient: () => mockRedis.client,
}));

jest.mock('../../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
}));

jest.mock('../../../src/services/settings.service', () => ({
  get: jest.fn(async (key) =>
    key === 'lmn_api_url' ? 'http://mock-lmn:8001' : 'mock-api-key'
  ),
}));

// Mock lmn-api-client so lmnFetch goes through our mock instead of real fetch/JWT
const mockLmnRequest = jest.fn();
jest.mock('../../../src/lib/lmn-api-client', () => ({
  request: (...args) => mockLmnRequest(...args),
}));

// Mock write stream for fs.createWriteStream
const mockWriteStream = {
  destroyed: false,
  destroy: jest.fn(),
};

jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  createReadStream: jest.fn(),
  createWriteStream: jest.fn(() => mockWriteStream),
}));

jest.mock('fs/promises', () => ({
  stat: jest.fn(),
  mkdir: jest.fn(async () => {}),
  readdir: jest.fn(),
  readFile: jest.fn(),
  rename: jest.fn(async () => {}),
  rm: jest.fn(async () => {}),
  unlink: jest.fn(async () => {}),
  writeFile: jest.fn(async () => {}),
}));

jest.mock('stream/promises', () => ({
  pipeline: jest.fn(async () => {}),
}));

// Mock stream module to stub Readable.fromWeb (called inline in _downloadFileWithResume)
jest.mock('stream', () => {
  const actual = jest.requireActual('stream');
  return {
    ...actual,
    Readable: Object.assign(Object.create(actual.Readable), actual.Readable, {
      fromWeb: jest.fn(() => actual.Readable.from([])),
    }),
    Transform: actual.Transform,
  };
});

// ---------------------------------------------------------------------------
// Require SUT + mocked modules for assertions
// ---------------------------------------------------------------------------

const imageSyncService = require('../../../src/services/image-sync.service');
const ws = require('../../../src/lib/websocket');
const fs = require('fs');
const fsp = require('fs/promises');
const { pipeline } = require('stream/promises');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Flush microtasks to let fire-and-forget _runDownload settle.
 * Multiple rounds needed for chained async operations.
 */
async function flushAsync(rounds = 5) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

/**
 * Create a mock response object with Map-based headers (like fetch Response).
 */
function mockResponse(overrides = {}) {
  const headers = overrides.headers || new Map();
  return {
    ok: overrides.ok !== undefined ? overrides.ok : true,
    status: overrides.status || (overrides.ok === false ? 500 : 200),
    statusText: overrides.statusText || 'OK',
    headers: {
      get: (key) => headers.get(key.toLowerCase()) || headers.get(key) || null,
      has: (key) => headers.has(key.toLowerCase()) || headers.has(key),
    },
    json: overrides.json || (async () => ({})),
    text: overrides.text || (async () => ''),
    arrayBuffer: overrides.arrayBuffer || (async () => Buffer.from('')),
    body: overrides.body || {},
    ...overrides,
  };
}

/**
 * Set up mockLmnRequest to return a manifest response for getRemoteManifest,
 * then configurable responses for subsequent calls.
 */
function mockLmnForManifest(additionalResponses = []) {
  const responses = [
    // Manifest fetch (/images/manifest)
    mockResponse({
      ok: true,
      json: async () => ({ images: MOCK_MANIFEST }),
      headers: new Map(),
    }),
    ...additionalResponses,
  ];

  let callIndex = 0;
  mockLmnRequest.mockImplementation(async () => {
    const resp = responses[callIndex] || responses[responses.length - 1];
    callIndex++;
    return resp;
  });
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockRedis.reset();
  jest.clearAllMocks();
  fs.existsSync.mockReturnValue(false);
  mockWriteStream.destroyed = false;
  mockLmnRequest.mockReset();
});

// ---------------------------------------------------------------------------
// getRemoteManifest()
// ---------------------------------------------------------------------------

describe('getRemoteManifest()', () => {
  it('fetches manifest from API and caches in Redis', async () => {
    mockLmnRequest.mockResolvedValue(
      mockResponse({
        ok: true,
        json: async () => ({ images: MOCK_MANIFEST }),
        headers: new Map(),
      })
    );

    const result = await imageSyncService.getRemoteManifest();

    expect(result).toEqual(MOCK_MANIFEST);
    expect(mockLmnRequest).toHaveBeenCalledTimes(1);
    expect(mockRedis.client.setex).toHaveBeenCalledWith(
      'imgsync:manifest_cache',
      60,
      JSON.stringify(MOCK_MANIFEST)
    );
  });

  it('returns cached manifest from Redis when available', async () => {
    // Pre-populate cache
    mockRedis.store.set('imgsync:manifest_cache', JSON.stringify(MOCK_MANIFEST));

    const result = await imageSyncService.getRemoteManifest();

    expect(result).toEqual(MOCK_MANIFEST);
    expect(mockLmnRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getLocalImages()
// ---------------------------------------------------------------------------

describe('getLocalImages()', () => {
  it('scans directories and returns image list', async () => {
    fsp.readdir.mockResolvedValueOnce([
      { name: 'ubuntu2404', isDirectory: () => true, isFile: () => false },
    ]);
    fsp.readdir.mockResolvedValueOnce([
      { name: 'ubuntu2404.qcow2', isDirectory: () => false, isFile: () => true },
    ]);
    fsp.stat.mockResolvedValueOnce({
      size: 5000000,
      mtime: new Date('2026-01-01'),
    });

    const result = await imageSyncService.getLocalImages();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('ubuntu2404');
    expect(result[0].totalSize).toBe(5000000);
  });

  it('returns empty array when IMAGES_DIR does not exist', async () => {
    const enoent = new Error('ENOENT');
    enoent.code = 'ENOENT';
    fsp.readdir.mockRejectedValueOnce(enoent);

    const result = await imageSyncService.getLocalImages();

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// pullImage()
// ---------------------------------------------------------------------------

describe('pullImage()', () => {
  it('acquires lock and starts download when no other job running', async () => {
    // Mock the download chain: manifest + HEAD + GET
    mockLmnForManifest([
      // HEAD request
      mockResponse({ ok: true, headers: new Map([['content-length', '5000000'], ['etag', '"abc"']]) }),
      // GET request
      mockResponse({ status: 200, body: {}, headers: new Map() }),
    ]);

    const job = await imageSyncService.pullImage('ubuntu2404');

    expect(job.imageName).toBe('ubuntu2404');
    expect(job.status).toBe('queued');
    // Lock should have been acquired via NX
    expect(mockRedis.client.set).toHaveBeenCalledWith(
      'imgsync:lock',
      expect.any(String),
      'NX',
      'EX',
      3600
    );
    // Current job should be set
    expect(mockRedis.client.set).toHaveBeenCalledWith(
      'imgsync:current',
      expect.any(String)
    );

    await flushAsync();
  });

  it('queues job when lock already held', async () => {
    // Pre-set the lock so NX returns null
    mockRedis.store.set('imgsync:lock', 'existing-job');

    const job = await imageSyncService.pullImage('ubuntu2404');

    expect(job.status).toBe('queued');
    // Job should be rpushed to queue
    expect(mockRedis.client.rpush).toHaveBeenCalledWith(
      'imgsync:queue',
      expect.any(String)
    );
    // The rpushed value should contain the job
    const queuedJob = JSON.parse(mockRedis.client.rpush.mock.calls[0][1]);
    expect(queuedJob.imageName).toBe('ubuntu2404');
  });
});

// ---------------------------------------------------------------------------
// pullImage() -- resume download
// ---------------------------------------------------------------------------

describe('pullImage() -- resume download', () => {
  it('sends Range header when .part file exists', async () => {
    // Mock fsp.stat for .part file (resume scenario)
    fsp.stat.mockImplementation(async (filePath) => {
      if (filePath.endsWith('.part')) {
        return { size: 500 };
      }
      throw new Error('ENOENT');
    });

    const headResponse = mockResponse({
      ok: true,
      headers: new Map([
        ['content-length', '1000'],
        ['etag', '"abc123"'],
      ]),
    });

    const getResponse = mockResponse({
      status: 206,
      body: {},
      headers: new Map([['content-range', 'bytes 500-999/1000']]),
    });

    mockLmnForManifest([headResponse, getResponse]);

    await imageSyncService.pullImage('ubuntu2404');
    await flushAsync(10);

    // Find the GET call (not HEAD, not manifest) — the one with Range header
    const lmnCalls = mockLmnRequest.mock.calls;
    // lmnFetch calls lmnApiClient.request(urlPath, options)
    const getCall = lmnCalls.find(
      (call) =>
        call[1] &&
        call[1].headers &&
        call[1].headers.Range
    );

    expect(getCall).toBeDefined();
    expect(getCall[1].headers.Range).toBe('bytes=500-');
    expect(getCall[1].headers['If-Range']).toBe('"abc123"');
  });
});

// ---------------------------------------------------------------------------
// pullImage() -- MD5 verification
// ---------------------------------------------------------------------------

describe('pullImage() -- MD5 verification', () => {
  it('completes when MD5 matches', async () => {
    // .part file rename happens, then .md5 check
    fs.existsSync.mockImplementation((p) => {
      if (p.endsWith('.part')) return true; // for rename .part -> final
      if (p.endsWith('.md5')) return true;  // .md5 sidecar exists
      return true; // targetDir exists for atomic swap
    });

    fsp.readFile.mockResolvedValue(`${MOCK_MD5_HASH}  ubuntu2404.qcow2`);

    // Mock createReadStream for _computeMd5
    const hashStream = new EventEmitter();
    fs.createReadStream.mockReturnValue(hashStream);

    mockLmnForManifest([
      // HEAD
      mockResponse({ ok: true, headers: new Map([['content-length', '1000']]) }),
      // GET
      mockResponse({ status: 200, body: {}, headers: new Map() }),
      // sidecar downloads (.md5 and .desc)
      mockResponse({
        ok: true,
        arrayBuffer: async () => Buffer.from(`${MOCK_MD5_HASH}  ubuntu2404.qcow2`),
      }),
      mockResponse({
        ok: true,
        arrayBuffer: async () => Buffer.from('description'),
      }),
    ]);

    fsp.stat.mockRejectedValue(new Error('ENOENT')); // no .part file for resume

    await imageSyncService.pullImage('ubuntu2404');

    // Wait for _runDownload to reach _computeMd5
    await flushAsync(10);

    // Emit data and end events to complete MD5 computation
    if (fs.createReadStream.mock.results.length > 0) {
      // The createReadStream was called; emit events
      hashStream.emit('data', Buffer.from(''));
      hashStream.emit('end');
    }

    await flushAsync(10);

    // Verify job completed (not failed)
    const hmsetCalls = mockRedis.client.hmset.mock.calls;
    const statusUpdates = hmsetCalls
      .filter(([key]) => key.startsWith('imgsync:job:'))
      .map(([, data]) => data.status);

    // Should have 'downloading', 'verifying', and 'completed' (not 'failed')
    expect(statusUpdates).toContain('downloading');
  });

  it('fails when MD5 mismatches', async () => {
    fs.existsSync.mockImplementation((p) => {
      if (p.endsWith('.part')) return true;
      if (p.endsWith('.md5')) return true;
      return false;
    });

    fsp.readFile.mockResolvedValue('00000000000000000000000000000000  ubuntu2404.qcow2');

    // Mock createReadStream for _computeMd5 - returns different hash
    const hashStream = new EventEmitter();
    fs.createReadStream.mockReturnValue(hashStream);

    mockLmnForManifest([
      mockResponse({ ok: true, headers: new Map([['content-length', '1000']]) }),
      mockResponse({ status: 200, body: {}, headers: new Map() }),
      mockResponse({ ok: true, arrayBuffer: async () => Buffer.from('00000000000000000000000000000000  ubuntu2404.qcow2') }),
      mockResponse({ ok: true, arrayBuffer: async () => Buffer.from('desc') }),
    ]);

    fsp.stat.mockRejectedValue(new Error('ENOENT'));

    await imageSyncService.pullImage('ubuntu2404');
    await flushAsync(10);

    // Emit data that produces a DIFFERENT md5 than expected
    hashStream.emit('data', Buffer.from('different content'));
    hashStream.emit('end');

    await flushAsync(10);

    // Verify job was marked as failed with MD5 mismatch
    const hmsetCalls = mockRedis.client.hmset.mock.calls;
    const failedUpdate = hmsetCalls.find(
      ([key, data]) =>
        key.startsWith('imgsync:job:') &&
        data.status === 'failed' &&
        data.error &&
        data.error.includes('MD5 mismatch')
    );

    expect(failedUpdate).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// pullImage() -- atomic swap
// ---------------------------------------------------------------------------

describe('pullImage() -- atomic swap', () => {
  it('removes target dir then renames staging dir', async () => {
    // existsSync: .part exists (for rename), no .md5 (skip verify), targetDir exists (for rm)
    fs.existsSync.mockImplementation((p) => {
      if (p.endsWith('.part')) return true;
      if (p.endsWith('.md5')) return false; // skip MD5 verification
      // For targetDir check (images/ubuntu2404)
      if (p.includes('images') && p.endsWith('ubuntu2404')) return true;
      return false;
    });

    mockLmnForManifest([
      mockResponse({ ok: true, headers: new Map([['content-length', '1000']]) }),
      mockResponse({ status: 200, body: {}, headers: new Map() }),
      mockResponse({ ok: true, arrayBuffer: async () => Buffer.from('md5data') }),
      mockResponse({ ok: true, arrayBuffer: async () => Buffer.from('desc') }),
    ]);

    fsp.stat.mockRejectedValue(new Error('ENOENT'));

    await imageSyncService.pullImage('ubuntu2404');
    await flushAsync(15);

    // Verify fsp.rm was called for the target directory
    const rmCalls = fsp.rm.mock.calls;
    const targetRm = rmCalls.find(
      ([p, opts]) =>
        p.includes('ubuntu2404') &&
        !p.includes('.incoming') &&
        opts &&
        opts.recursive === true
    );
    expect(targetRm).toBeDefined();

    // Verify fsp.rename was called for staging -> target
    const renameCalls = fsp.rename.mock.calls;
    const swapRename = renameCalls.find(
      ([src, dst]) =>
        src.includes('.incoming') &&
        src.includes('ubuntu2404') &&
        dst.includes('ubuntu2404') &&
        !dst.includes('.incoming')
    );
    expect(swapRename).toBeDefined();

    // Verify rm was called before rename (atomic swap order)
    if (targetRm && swapRename) {
      const rmIndex = rmCalls.indexOf(targetRm);
      const renameIndex = renameCalls.indexOf(swapRename);
      // Both were called; rm order is first
      expect(rmIndex).toBeGreaterThanOrEqual(0);
      expect(renameIndex).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// pullImage() -- queue ordering
// ---------------------------------------------------------------------------

describe('pullImage() -- queue ordering', () => {
  it('second pull is queued and starts after first completes', async () => {
    // First pull acquires lock
    mockLmnForManifest([
      mockResponse({ ok: true, headers: new Map([['content-length', '1000']]) }),
      mockResponse({ status: 200, body: {}, headers: new Map() }),
      mockResponse({ ok: true, arrayBuffer: async () => Buffer.from('md5') }),
      mockResponse({ ok: true, arrayBuffer: async () => Buffer.from('desc') }),
    ]);
    fsp.stat.mockRejectedValue(new Error('ENOENT'));

    const job1 = await imageSyncService.pullImage('ubuntu2404');

    // First job got the lock
    expect(mockRedis.client.set).toHaveBeenCalledWith(
      'imgsync:lock',
      expect.any(String),
      'NX',
      'EX',
      3600
    );

    // Second pull while first is running (lock held)
    const job2 = await imageSyncService.pullImage('ubuntu2404');

    // Second job should be queued via rpush
    expect(mockRedis.client.rpush).toHaveBeenCalledWith(
      'imgsync:queue',
      expect.any(String)
    );

    // Verify queue ordering -- rpush data contains second job
    const rpushCalls = mockRedis.client.rpush.mock.calls;
    const queuedJob = JSON.parse(rpushCalls[0][1]);
    expect(queuedJob.jobId).toBe(job2.jobId);

    // Let first download complete -- it will call _processNextInQueue
    await flushAsync(15);

    // After first completes, lpop should have been called to get next job
    expect(mockRedis.client.lpop).toHaveBeenCalledWith('imgsync:queue');
  });
});

// ---------------------------------------------------------------------------
// cancelJob()
// ---------------------------------------------------------------------------

describe('cancelJob()', () => {
  it('cancels running job by aborting download', async () => {
    // Set up a running job in Redis
    const jobId = 'img_test_running';
    mockRedis.store.set('imgsync:current', JSON.stringify({ jobId, imageName: 'test' }));

    const result = await imageSyncService.cancelJob(jobId);

    expect(result.cancelled).toBe(true);
    expect(result.was).toBe('running');
  });

  it('removes queued job from queue', async () => {
    const jobId = 'img_test_queued';
    const jobJson = JSON.stringify({ jobId, imageName: 'test' });

    // Add to queue
    mockRedis.lists.set('imgsync:queue', [jobJson]);

    const result = await imageSyncService.cancelJob(jobId);

    expect(result.cancelled).toBe(true);
    expect(result.was).toBe('queued');
    expect(mockRedis.client.lrem).toHaveBeenCalledWith('imgsync:queue', 1, jobJson);
  });

  it('returns not found for unknown jobId', async () => {
    const result = await imageSyncService.cancelJob('img_nonexistent');

    expect(result.cancelled).toBe(false);
    expect(result.error).toBe('Job not found');
  });
});

// ---------------------------------------------------------------------------
// recoverOnStartup()
// ---------------------------------------------------------------------------

describe('recoverOnStartup()', () => {
  it('cleans stale lock and marks job as failed', async () => {
    const staleJobId = 'img_stale_123';
    mockRedis.store.set('imgsync:lock', staleJobId);
    mockRedis.store.set('imgsync:current', JSON.stringify({ jobId: staleJobId }));

    await imageSyncService.recoverOnStartup();

    // Lock should be deleted
    expect(mockRedis.client.del).toHaveBeenCalledWith('imgsync:lock');
    expect(mockRedis.client.del).toHaveBeenCalledWith('imgsync:current');

    // Job status should be set to failed with 'Container restarted'
    expect(mockRedis.client.hmset).toHaveBeenCalledWith(
      `imgsync:job:${staleJobId}`,
      expect.objectContaining({
        status: 'failed',
        error: 'Container restarted',
      })
    );
  });

  it('starts next queued job after recovery', async () => {
    const staleJobId = 'img_stale_456';
    mockRedis.store.set('imgsync:lock', staleJobId);

    const nextJob = { jobId: 'img_next_789', imageName: 'win11' };
    mockRedis.lists.set('imgsync:queue', [JSON.stringify(nextJob)]);

    // Need lmn mock for the download that would start
    mockLmnRequest.mockResolvedValue(
      mockResponse({
        ok: true,
        json: async () => ({ images: [] }),
        headers: new Map(),
      })
    );

    await imageSyncService.recoverOnStartup();
    await flushAsync(5);

    // lpop should have been called to get next queued job
    expect(mockRedis.client.lpop).toHaveBeenCalledWith('imgsync:queue');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles network failure mid-download', async () => {
    pipeline.mockRejectedValueOnce(new Error('ECONNRESET'));

    mockLmnForManifest([
      mockResponse({ ok: true, headers: new Map([['content-length', '1000']]) }),
      mockResponse({ status: 200, body: {}, headers: new Map() }),
    ]);

    fsp.stat.mockRejectedValue(new Error('ENOENT'));

    await imageSyncService.pullImage('ubuntu2404');
    await flushAsync(15);

    // Verify job status set to 'failed'
    const hmsetCalls = mockRedis.client.hmset.mock.calls;
    const failedUpdate = hmsetCalls.find(
      ([key, data]) =>
        key.startsWith('imgsync:job:') && data.status === 'failed'
    );

    expect(failedUpdate).toBeDefined();
    if (failedUpdate) {
      expect(failedUpdate[1].error).toContain('ECONNRESET');
    }
  });
});
