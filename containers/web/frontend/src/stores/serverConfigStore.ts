import { create } from 'zustand';
import axios from 'axios';
import { syncApi } from '@/api/sync';

interface ServerConfigState {
  serverIp: string;
  fetched: boolean;
  mode: 'sync' | 'offline';
  isSyncMode: boolean;
  modeFetched: boolean;
  fetchServerConfig: () => Promise<void>;
  fetchMode: () => Promise<void>;
}

export const useServerConfigStore = create<ServerConfigState>()((set, get) => ({
  serverIp: '10.0.0.1',
  fetched: false,
  mode: 'offline',
  isSyncMode: false,
  modeFetched: false,

  fetchServerConfig: async () => {
    if (get().fetched) return;
    try {
      const res = await axios.get('/health');
      if (res.data?.serverIp) {
        set({ serverIp: res.data.serverIp, fetched: true });
      }
    } catch {
      // Fallback bleibt 10.0.0.1
      set({ fetched: true });
    }
  },

  fetchMode: async () => {
    if (get().modeFetched) return;
    try {
      const data = await syncApi.getMode();
      set({
        mode: data.mode,
        isSyncMode: data.mode === 'sync',
        modeFetched: true,
      });
    } catch {
      // Default to offline on error
      set({ mode: 'offline', isSyncMode: false, modeFetched: true });
    }
  },
}));
