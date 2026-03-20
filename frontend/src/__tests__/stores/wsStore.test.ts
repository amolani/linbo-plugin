import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// MockWebSocket class
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  url: string;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    mockWsInstances.push(this);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

let mockWsInstances: MockWebSocket[] = [];

// Stub WebSocket globally before importing the store
vi.stubGlobal('WebSocket', MockWebSocket);

// Ensure localStorage.getItem returns a token so connect() builds the URL
(localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('test-token');

// Now import the store (WS_URL computed at module load)
import { useWsStore } from '@/stores/wsStore';

describe('wsStore - reconnect logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockWsInstances = [];
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('test-token');
    useWsStore.setState({
      socket: null,
      isConnected: false,
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      listeners: new Map(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should attempt reconnect on close when under maxReconnectAttempts', () => {
    useWsStore.getState().connect();
    expect(mockWsInstances).toHaveLength(1);

    // Open then close the first connection
    mockWsInstances[0].simulateOpen();
    mockWsInstances[0].simulateClose();

    // Advance past RECONNECT_DELAY (3000ms)
    vi.advanceTimersByTime(3000);

    // A second WebSocket should have been created (reconnect attempt)
    expect(mockWsInstances).toHaveLength(2);
  });

  it('should stop reconnecting after maxReconnectAttempts', () => {
    useWsStore.setState({ maxReconnectAttempts: 1 });

    useWsStore.getState().connect();
    expect(mockWsInstances).toHaveLength(1);

    // Open then close -> triggers first reconnect
    mockWsInstances[0].simulateOpen();
    mockWsInstances[0].simulateClose();
    vi.advanceTimersByTime(3000);
    expect(mockWsInstances).toHaveLength(2);

    // Close the second connection -> reconnectAttempts is now 1 (== maxReconnectAttempts)
    // The onclose handler captured reconnectAttempts=1 from the state at connect() time
    mockWsInstances[1].simulateClose();
    vi.advanceTimersByTime(3000);

    // Should NOT create a third connection
    expect(mockWsInstances).toHaveLength(2);
  });

  it('should reset reconnectAttempts on successful reconnect', () => {
    useWsStore.getState().connect();
    mockWsInstances[0].simulateOpen();
    mockWsInstances[0].simulateClose();

    vi.advanceTimersByTime(3000);
    expect(mockWsInstances).toHaveLength(2);

    // Simulate successful reconnection
    mockWsInstances[1].simulateOpen();

    // reconnectAttempts should be reset to 0
    expect(useWsStore.getState().reconnectAttempts).toBe(0);
  });
});

describe('wsStore - subscribe and emit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockWsInstances = [];
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('test-token');
    useWsStore.setState({
      socket: null,
      isConnected: false,
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      listeners: new Map(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribe adds listener and unsubscribe removes it', () => {
    const callback = vi.fn();
    const unsubscribe = useWsStore.getState().subscribe('test.event', callback);

    const listeners = useWsStore.getState().listeners;
    expect(listeners.has('test.event')).toBe(true);
    expect(listeners.get('test.event')!.has(callback)).toBe(true);

    // Unsubscribe
    unsubscribe();

    const listenersAfter = useWsStore.getState().listeners;
    expect(listenersAfter.has('test.event')).toBe(false);
  });

  it('emit dispatches to specific and wildcard listeners', () => {
    const specificCb = vi.fn();
    const wildcardCb = vi.fn();

    useWsStore.getState().subscribe('host.status', specificCb);
    useWsStore.getState().subscribe('*', wildcardCb);

    // Connect and open to set up the onmessage handler
    useWsStore.getState().connect();
    const ws = mockWsInstances[0];
    ws.simulateOpen();

    // Simulate incoming message
    const event = {
      type: 'host.status',
      data: { hostId: 'h1', status: 'online' },
      timestamp: new Date().toISOString(),
    };
    ws.simulateMessage(event);

    expect(specificCb).toHaveBeenCalledTimes(1);
    expect(specificCb).toHaveBeenCalledWith(expect.objectContaining({ type: 'host.status' }));
    expect(wildcardCb).toHaveBeenCalledTimes(1);
    expect(wildcardCb).toHaveBeenCalledWith(expect.objectContaining({ type: 'host.status' }));
  });
});

describe('wsStore - send', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockWsInstances = [];
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('test-token');
    useWsStore.setState({
      socket: null,
      isConnected: false,
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      listeners: new Map(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('send serializes and sends when connected', () => {
    useWsStore.getState().connect();
    const ws = mockWsInstances[0];
    ws.simulateOpen();

    useWsStore.getState().send({ type: 'test', data: 'hello' });

    expect(ws.sentMessages).toHaveLength(1);
    expect(JSON.parse(ws.sentMessages[0])).toEqual({ type: 'test', data: 'hello' });
  });
});
