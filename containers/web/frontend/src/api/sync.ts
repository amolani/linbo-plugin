import apiClient from './client';

// Types
export interface ServerMode {
  mode: 'sync' | 'offline';
  syncEnabled: boolean;
}

export interface SyncHost {
  hostname: string;
  mac: string;
  ip: string;
  hostgroup: string;
  room?: string;
  role?: string;
  pxeFlag?: string;
  runtimeStatus: 'online' | 'offline';
  lastSeen: string | null;
}

export interface SyncConfig {
  id: string;
  name?: string;
  server?: string;
  systemtype?: string;
  partitions?: unknown[];
  osEntries?: unknown[];
}

export interface SyncStats {
  hosts: { total: number; online: number; offline: number };
  configs: number;
  sync: {
    cursor: string | null;
    lastSyncAt: string | null;
    isRunning: boolean;
    lastError: string | null;
  };
  lmnApiHealthy: boolean;
  hostOfflineTimeoutSec: number;
}

export interface SyncStatus {
  cursor: string | null;
  lastSyncAt: string | null;
  isRunning: boolean;
  lastError: string | null;
  serverIp: string | null;
  hosts: number;
  configs: number;
  lmnApiHealthy: boolean;
  hostOfflineTimeoutSec: number;
}

// Image Sync Types
export interface ImageFile {
  name: string;
  size: number;
}

export interface RemoteImage {
  name: string;
  filename: string;
  size: number;
  totalSize: number;
  files: ImageFile[];
  timestamp?: string;
  imagesize?: string;
  checksum?: string;
  description?: string;
  base?: string;
  path?: string;
  md5?: string | null;
  sidecars?: string[];
  updatedAt?: string;
}

export interface LocalImage {
  name: string;
  totalSize: number;
  modifiedAt: string | null;
  files: ImageFile[];
}

export interface ImageComparison {
  name: string;
  remote: RemoteImage | null;
  local: LocalImage | null;
  status: 'synced' | 'outdated' | 'remote_only' | 'local_only';
  pushable?: boolean;
}

export interface ImageSyncJob {
  jobId: string;
  imageName: string;
  status: string;
  progress: number;
  speed: number;
  eta: number;
  bytesDownloaded: number;
  totalBytes: number;
  error?: string;
  startedAt?: string;
  queuedAt?: string;
}

export interface ImageSyncQueue {
  running: ImageSyncJob | null;
  queued: ImageSyncJob[];
}

interface ApiResponse<T> {
  data: T;
}

export const syncApi = {
  getMode: async (): Promise<ServerMode> => {
    const r = await apiClient.get<ApiResponse<ServerMode>>('/sync/mode');
    return r.data.data;
  },

  getStatus: async (): Promise<SyncStatus> => {
    const r = await apiClient.get<ApiResponse<SyncStatus>>('/sync/status');
    return r.data.data;
  },

  getHosts: async (params?: { search?: string; hostgroup?: string }): Promise<SyncHost[]> => {
    const r = await apiClient.get<ApiResponse<SyncHost[]>>('/sync/hosts', { params });
    return r.data.data;
  },

  getHost: async (mac: string): Promise<SyncHost> => {
    const r = await apiClient.get<ApiResponse<SyncHost>>(`/sync/hosts/${mac}`);
    return r.data.data;
  },

  getConfigs: async (): Promise<SyncConfig[]> => {
    const r = await apiClient.get<ApiResponse<SyncConfig[]>>('/sync/configs');
    return r.data.data;
  },

  getConfig: async (id: string): Promise<SyncConfig> => {
    const r = await apiClient.get<ApiResponse<SyncConfig>>(`/sync/configs/${id}`);
    return r.data.data;
  },

  getConfigPreview: async (id: string): Promise<string> => {
    const r = await apiClient.get<ApiResponse<{ content: string }>>(`/sync/configs/${id}/preview`);
    return r.data.data.content;
  },

  getStats: async (): Promise<SyncStats> => {
    const r = await apiClient.get<ApiResponse<SyncStats>>('/sync/stats');
    return r.data.data;
  },

  trigger: async (): Promise<{
    message: string;
    stats: {
      startConfs: number;
      configs: number;
      hosts: number;
      deletedStartConfs: number;
      deletedHosts: number;
      dhcp: boolean;
      grub: boolean;
    };
  }> => {
    const r = await apiClient.post<ApiResponse<{
      message: string;
      stats: {
        startConfs: number;
        configs: number;
        hosts: number;
        deletedStartConfs: number;
        deletedHosts: number;
        dhcp: boolean;
        grub: boolean;
      };
    }>>('/sync/trigger');
    return r.data.data;
  },

  reset: async (): Promise<{ message: string }> => {
    const r = await apiClient.post<ApiResponse<{ message: string }>>('/sync/reset');
    return r.data.data;
  },

  // Image Sync endpoints
  compareImages: async (): Promise<ImageComparison[]> => {
    const r = await apiClient.get<ApiResponse<ImageComparison[]>>('/sync/images/compare');
    return r.data.data;
  },

  pullImage: async (imageName: string): Promise<ImageSyncJob> => {
    const r = await apiClient.post<ApiResponse<ImageSyncJob>>('/sync/images/pull', { imageName });
    return r.data.data;
  },

  pullAllImages: async (): Promise<{ jobs: ImageSyncJob[]; count: number }> => {
    const r = await apiClient.post<ApiResponse<{ jobs: ImageSyncJob[]; count: number }>>('/sync/images/pull', { all: true });
    return r.data.data;
  },

  getImageQueue: async (): Promise<ImageSyncQueue> => {
    const r = await apiClient.get<ApiResponse<ImageSyncQueue>>('/sync/images/queue');
    return r.data.data;
  },

  cancelImageJob: async (jobId: string): Promise<{ cancelled: boolean; was?: string }> => {
    const r = await apiClient.delete<ApiResponse<{ cancelled: boolean; was?: string }>>(`/sync/images/queue/${jobId}`);
    return r.data.data;
  },

  // Image Push endpoints
  pushImage: async (imageName: string): Promise<ImageSyncJob> => {
    const r = await apiClient.post<ApiResponse<ImageSyncJob>>('/sync/images/push', { imageName });
    return r.data.data;
  },

  pushAllImages: async (): Promise<{ jobs: ImageSyncJob[]; count: number }> => {
    const r = await apiClient.post<ApiResponse<{ jobs: ImageSyncJob[]; count: number }>>('/sync/images/push', { all: true });
    return r.data.data;
  },

  getPushQueue: async (): Promise<ImageSyncQueue> => {
    const r = await apiClient.get<ApiResponse<ImageSyncQueue>>('/sync/images/push/queue');
    return r.data.data;
  },

  cancelPushJob: async (jobId: string): Promise<{ cancelled: boolean; was?: string }> => {
    const r = await apiClient.delete<ApiResponse<{ cancelled: boolean; was?: string }>>(`/sync/images/push/queue/${jobId}`);
    return r.data.data;
  },

  testPushConnection: async (): Promise<{ connected: boolean; imageCount?: number; error?: string }> => {
    const r = await apiClient.post<ApiResponse<{ connected: boolean; imageCount?: number; error?: string }>>('/sync/images/push/test');
    return r.data.data;
  },
};
