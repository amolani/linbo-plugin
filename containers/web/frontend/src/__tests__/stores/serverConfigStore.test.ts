import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useServerConfigStore } from '@/stores/serverConfigStore';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    create: vi.fn(() => ({
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    })),
  },
}));

vi.mock('@/api/sync', () => ({
  syncApi: { getMode: vi.fn() },
}));

import axios from 'axios';
import { syncApi } from '@/api/sync';

describe('serverConfigStore - fetchServerConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useServerConfigStore.setState({
      serverIp: '10.0.0.1',
      fetched: false,
      mode: 'offline',
      isSyncMode: false,
      modeFetched: false,
    });
  });

  it('should fetch config on first call and set serverIp', async () => {
    (axios.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { serverIp: '10.0.0.13' },
    });

    await useServerConfigStore.getState().fetchServerConfig();

    const state = useServerConfigStore.getState();
    expect(state.serverIp).toBe('10.0.0.13');
    expect(state.fetched).toBe(true);
    expect(axios.get).toHaveBeenCalledWith('/health');
  });

  it('should return cached on second call without fetching', async () => {
    useServerConfigStore.setState({ fetched: true, serverIp: '10.0.0.13' });

    await useServerConfigStore.getState().fetchServerConfig();

    expect(axios.get).not.toHaveBeenCalled();
  });

  it('should fallback to defaults on error', async () => {
    (axios.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    await useServerConfigStore.getState().fetchServerConfig();

    const state = useServerConfigStore.getState();
    expect(state.serverIp).toBe('10.0.0.1');
    expect(state.fetched).toBe(true);
  });
});

describe('serverConfigStore - fetchMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useServerConfigStore.setState({
      serverIp: '10.0.0.1',
      fetched: false,
      mode: 'offline',
      isSyncMode: false,
      modeFetched: false,
    });
  });

  it('should fetch mode and set isSyncMode', async () => {
    (syncApi.getMode as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      mode: 'sync',
      syncEnabled: true,
    });

    await useServerConfigStore.getState().fetchMode();

    const state = useServerConfigStore.getState();
    expect(state.mode).toBe('sync');
    expect(state.isSyncMode).toBe(true);
    expect(state.modeFetched).toBe(true);
  });

  it('should fallback to offline on error', async () => {
    (syncApi.getMode as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('API error'));

    await useServerConfigStore.getState().fetchMode();

    const state = useServerConfigStore.getState();
    expect(state.mode).toBe('offline');
    expect(state.isSyncMode).toBe(false);
    expect(state.modeFetched).toBe(true);
  });
});
