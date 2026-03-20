import apiClient from './client';

export interface DriverProfile {
  folder: string;
  vendor: string;
  product: string;
  hasDrivers: boolean;
  fileCount: number;
  totalSize: number;
  image: string | null;
}

export interface AvailableImage {
  name: string;
  filename: string;
}

export interface CreateProfileResult {
  created: boolean;
  folder: string;
  vendor: string;
  product: string;
}

export interface DriverFileEntry {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
}

export interface MatchConfData {
  folder: string;
  vendor: string;
  products: string[];
  raw: string;
}

export interface HwinfoData {
  ip: string;
  timestamp: string;
  dmi: {
    vendor: string;
    product: string;
    serial: string;
    biosVersion: string;
  };
  cpu: {
    model: string;
    cores: number;
  };
  ram: {
    totalKb: number;
    totalMb: number;
    totalGb: number;
  };
  network: string;
  disks: string;
  pci: string;
  hwinfo: string;
  raw: string;
  cached?: boolean;
}

export interface HwinfoAllEntry extends HwinfoData {
  mac: string;
}

export interface HwinfoScanResult {
  scanned: number;
  skipped: number;
  failed: number;
}

interface ApiResponse<T> {
  data: T;
}

export const driversApi = {
  createProfile: async (hostIp: string): Promise<CreateProfileResult> => {
    const response = await apiClient.post<ApiResponse<CreateProfileResult>>(
      '/drivers/create-profile',
      { hostIp }
    );
    return response.data.data;
  },

  listProfiles: async (): Promise<DriverProfile[]> => {
    const response = await apiClient.get<ApiResponse<DriverProfile[]>>(
      '/drivers/profiles'
    );
    return response.data.data;
  },

  getProfileFiles: async (name: string): Promise<DriverFileEntry[]> => {
    const response = await apiClient.get<ApiResponse<DriverFileEntry[]>>(
      `/drivers/profiles/${encodeURIComponent(name)}/files`
    );
    return response.data.data;
  },

  uploadFile: async (name: string, file: File, relPath?: string): Promise<{ path: string; size: number }> => {
    const formData = new FormData();
    formData.append('file', file);
    if (relPath) formData.append('path', relPath);

    const response = await apiClient.post<ApiResponse<{ path: string; size: number }>>(
      `/drivers/profiles/${encodeURIComponent(name)}/upload`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return response.data.data;
  },

  extractArchive: async (
    name: string, file: File,
    onProgress?: (pct: number) => void,
  ): Promise<{ entryCount: number; totalUncompressed: number }> => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await apiClient.post<ApiResponse<{ entryCount: number; totalUncompressed: number }>>(
      `/drivers/profiles/${encodeURIComponent(name)}/extract`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (onProgress && e.total)
            onProgress(Math.round((e.loaded / e.total) * 100));
        },
      },
    );
    return response.data.data;
  },

  deleteFile: async (name: string, filePath: string): Promise<void> => {
    await apiClient.delete(
      `/drivers/profiles/${encodeURIComponent(name)}/files`,
      { data: { path: filePath } }
    );
  },

  deleteProfile: async (name: string): Promise<void> => {
    await apiClient.delete(`/drivers/profiles/${encodeURIComponent(name)}`);
  },

  getMatchConf: async (name: string): Promise<MatchConfData> => {
    const response = await apiClient.get<ApiResponse<MatchConfData>>(
      `/drivers/profiles/${encodeURIComponent(name)}/match-conf`
    );
    return response.data.data;
  },

  updateMatchConf: async (name: string, content: string): Promise<MatchConfData> => {
    const response = await apiClient.put<ApiResponse<MatchConfData>>(
      `/drivers/profiles/${encodeURIComponent(name)}/match-conf`,
      { content }
    );
    return response.data.data;
  },

  getAvailableImages: async (): Promise<AvailableImage[]> => {
    const response = await apiClient.get<ApiResponse<AvailableImage[]>>('/drivers/available-images');
    return response.data.data;
  },

  setProfileImage: async (name: string, image: string): Promise<{ folder: string; image: string }> => {
    const response = await apiClient.put<ApiResponse<{ folder: string; image: string }>>(
      `/drivers/profiles/${encodeURIComponent(name)}/image`,
      { image }
    );
    return response.data.data;
  },

  removeProfileImage: async (name: string): Promise<{ folder: string; image: null }> => {
    const response = await apiClient.delete<ApiResponse<{ folder: string; image: null }>>(
      `/drivers/profiles/${encodeURIComponent(name)}/image`
    );
    return response.data.data;
  },

  getHwinfo: async (ip: string, refresh = false): Promise<HwinfoData> => {
    const query = refresh ? '?refresh=true' : '';
    const response = await apiClient.get<ApiResponse<HwinfoData>>(
      `/drivers/hwinfo/${encodeURIComponent(ip)}${query}`
    );
    return response.data.data;
  },

  getHwinfoAll: async (): Promise<HwinfoAllEntry[]> => {
    const response = await apiClient.get<ApiResponse<HwinfoAllEntry[]>>('/drivers/hwinfo/all');
    return response.data.data;
  },

  triggerHwinfoScan: async (): Promise<HwinfoScanResult> => {
    const response = await apiClient.post<ApiResponse<HwinfoScanResult>>('/drivers/hwinfo/scan');
    return response.data.data;
  },
};
