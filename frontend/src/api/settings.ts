import apiClient from './client';

// Types
export interface SettingEntry {
  key: string;
  value?: string;
  valueMasked?: string;
  isSet: boolean;
  source: 'redis' | 'env' | 'default';
  description: string;
}

export interface ConnectionTestResult {
  reachable: boolean;
  healthy: boolean;
  version?: string;
  latency: number;
}

export const settingsApi = {
  getAll: async (): Promise<SettingEntry[]> => {
    const res = await apiClient.get('/settings');
    return res.data.data;
  },

  set: async (key: string, value: string): Promise<SettingEntry> => {
    const res = await apiClient.put(`/settings/${key}`, { value });
    return res.data.data;
  },

  reset: async (key: string): Promise<{ success: boolean }> => {
    const res = await apiClient.delete(`/settings/${key}`);
    return res.data.data;
  },

  testConnection: async (url?: string, key?: string): Promise<ConnectionTestResult> => {
    const body: Record<string, string> = {};
    if (url) body.url = url;
    if (key) body.key = key;
    const res = await apiClient.post('/settings/test-connection', body);
    return res.data.data;
  },
};
