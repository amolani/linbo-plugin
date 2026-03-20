import apiClient from './client';

interface ApiResponse<T> {
  data: T;
}

export interface TerminalSession {
  id: string;
  hostIp: string;
  userId: string;
  mode: 'pty' | 'exec';
  createdAt: string;
  lastActivity: string;
}

export interface ConnectionTestResult {
  success: boolean;
  connected?: boolean;
  error?: string;
}

export const terminalApi = {
  listSessions: async (): Promise<TerminalSession[]> => {
    const response = await apiClient.get<ApiResponse<TerminalSession[]>>('/terminal/sessions');
    return response.data.data;
  },

  closeSession: async (id: string): Promise<void> => {
    await apiClient.delete(`/terminal/sessions/${id}`);
  },

  testConnection: async (hostIp: string): Promise<ConnectionTestResult> => {
    const response = await apiClient.post<ApiResponse<ConnectionTestResult>>('/terminal/test-connection', { hostIp });
    return response.data.data;
  },
};
