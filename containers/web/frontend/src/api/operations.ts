import apiClient from './client';
import type { Operation, PaginatedResponse } from '@/types';

export interface CreateOperationData {
  targetHosts: string[];
  commands: string[];
  options?: Record<string, unknown>;
}

export interface SendCommandData {
  hostIds: string[];
  command: string;
  args?: string[];
}

// Remote Command types (Phase 7c)
export interface DirectCommandRequest {
  hostIds?: string[];
  roomId?: string;
  configId?: string;
  // Sync-mode filters
  macs?: string[];
  hostnames?: string[];
  hostgroup?: string;
  room?: string;
  commands: string;
  options?: {
    wakeOnLan?: boolean;
    wolDelay?: number;
    disableGui?: boolean;
  };
}

export interface ScheduleCommandRequest {
  hostIds?: string[];
  roomId?: string;
  configId?: string;
  // Sync-mode filters
  macs?: string[];
  hostnames?: string[];
  hostgroup?: string;
  room?: string;
  commands: string;
  options?: {
    wakeOnLan?: boolean;
    wolDelay?: number;
    noAuto?: boolean;
    disableGui?: boolean;
  };
}

export interface ScheduledCommand {
  hostname: string;
  commands: string;
  createdAt: string;
  filePath: string;
}

export interface CommandValidationResult {
  valid: boolean;
  commands: Array<{
    command: string;
    args?: string;
    valid: boolean;
    error?: string;
  }>;
  errors: string[];
}

// Known LINBO commands for the command builder
export interface LinboCommand {
  value: string;
  label: string;
  description: string;
  hasArg?: boolean;
  argLabel?: string;
  argOptions?: string[];
}

export const LINBO_COMMANDS: LinboCommand[] = [
  { value: 'partition', label: 'Partition', description: 'Partitionstabelle schreiben' },
  { value: 'label', label: 'Label', description: 'Partitionen labeln' },
  { value: 'format', label: 'Format', description: 'Partitionen formatieren', hasArg: true, argLabel: 'Partition #' },
  { value: 'initcache', label: 'Init Cache', description: 'Cache initialisieren', hasArg: true, argLabel: 'Download-Typ', argOptions: ['rsync', 'multicast', 'torrent'] },
  { value: 'sync', label: 'Sync', description: 'OS synchronisieren', hasArg: true, argLabel: 'OS #' },
  { value: 'new', label: 'New (Clean)', description: 'Neuinstallation (Format + Sync)', hasArg: true, argLabel: 'OS #' },
  { value: 'start', label: 'Start', description: 'OS starten', hasArg: true, argLabel: 'OS #' },
  { value: 'create_image', label: 'Create Image', description: 'Image erstellen', hasArg: true, argLabel: 'OS #' },
  { value: 'upload_image', label: 'Upload Image', description: 'Image hochladen', hasArg: true, argLabel: 'OS #' },
  { value: 'reboot', label: 'Reboot', description: 'Client neu starten' },
  { value: 'halt', label: 'Halt', description: 'Client herunterfahren' },
  { value: 'noauto', label: 'No Auto', description: 'Auto-Aktionen deaktivieren' },
  { value: 'disablegui', label: 'Disable GUI', description: 'GUI deaktivieren' },
];

export interface WakeRequest {
  // Standalone mode
  hostIds?: string[];
  roomId?: string;
  configId?: string;
  // Sync mode
  macs?: string[];
  hostnames?: string[];
  hostgroup?: string;
  room?: string;
  delay?: number;
}

// API response wrapper types
interface ApiResponse<T> {
  data: T;
}

interface PaginatedApiResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export const operationsApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<PaginatedResponse<Operation>> => {
    const response = await apiClient.get<PaginatedApiResponse<Operation>>('/operations', {
      params: {
        page: params?.page || 1,
        limit: params?.limit || 25,
        status: params?.status,
      },
    });
    // Transform API response to match PaginatedResponse type
    return {
      data: response.data.data,
      total: response.data.pagination.total,
      page: response.data.pagination.page,
      limit: response.data.pagination.limit,
      totalPages: response.data.pagination.pages,
    };
  },

  get: async (id: string): Promise<Operation> => {
    const response = await apiClient.get<ApiResponse<Operation>>(`/operations/${id}`);
    return response.data.data;
  },

  create: async (data: CreateOperationData): Promise<Operation> => {
    const response = await apiClient.post<ApiResponse<Operation>>('/operations', data);
    return response.data.data;
  },

  sendCommand: async (data: SendCommandData): Promise<{ operationId: string }> => {
    const response = await apiClient.post<ApiResponse<{ operationId: string }>>(
      '/operations/send-command',
      data
    );
    return response.data.data;
  },

  update: async (id: string, data: Partial<Operation>): Promise<Operation> => {
    const response = await apiClient.patch<ApiResponse<Operation>>(`/operations/${id}`, data);
    return response.data.data;
  },

  cancel: async (id: string): Promise<{ success: boolean }> => {
    const response = await apiClient.post<ApiResponse<{ success: boolean }>>(`/operations/${id}/cancel`);
    return response.data.data;
  },

  // Remote Commands (Phase 7c)
  direct: async (data: DirectCommandRequest): Promise<Operation> => {
    const response = await apiClient.post<ApiResponse<Operation>>('/operations/direct', data);
    return response.data.data;
  },

  schedule: async (data: ScheduleCommandRequest): Promise<{ scheduled: number; hosts: string[] }> => {
    const response = await apiClient.post<ApiResponse<{ scheduled: number; hosts: string[] }>>('/operations/schedule', data);
    return response.data.data;
  },

  listScheduled: async (): Promise<ScheduledCommand[]> => {
    const response = await apiClient.get<ApiResponse<ScheduledCommand[]>>('/operations/scheduled');
    return response.data.data;
  },

  cancelScheduled: async (hostname: string): Promise<{ success: boolean }> => {
    const response = await apiClient.delete<ApiResponse<{ success: boolean }>>(`/operations/scheduled/${hostname}`);
    return response.data.data;
  },

  validateCommands: async (commands: string): Promise<CommandValidationResult> => {
    const response = await apiClient.post<ApiResponse<CommandValidationResult>>('/operations/validate-commands', { commands });
    return response.data.data;
  },

  wake: async (data: WakeRequest): Promise<{ sent: number; hosts: string[] }> => {
    const response = await apiClient.post<ApiResponse<{ sent: number; hosts: string[] }>>('/operations/wake', data);
    return response.data.data;
  },
};
