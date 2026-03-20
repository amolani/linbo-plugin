import apiClient from './client';
import type { KernelVariant, KernelStatus, KernelSwitchResponse, FirmwareEntry, FirmwareStatus, FirmwareCatalogCategory, BulkAddResult, WlanConfig, GrubThemeConfig, GrubThemeStatus, GrubIcon } from '@/types';

interface ApiResponse<T> {
  data: T;
}

export interface LinboVersionInfo {
  installed: string;
  installedFull: string;
  available: string | null;
  updateAvailable: boolean;
  packageSize?: number;
  sha256?: string;
  filename?: string;
}

export interface DetectedFirmwareFile {
  filename: string;
  availableOnDisk: boolean;
  alreadyConfigured: boolean;
  suggestedEntry: string;
}

export interface DetectedDriver {
  driver: string;
  category: string | null;
  catalogVendor: string | null;
  firmwareFiles: DetectedFirmwareFile[];
}

export interface FirmwareDetectionResult {
  host: string;
  detectedDrivers: DetectedDriver[];
  summary: {
    totalMissingFiles: number;
    availableToAdd: number;
    alreadyConfigured: number;
  };
}

export interface LinboUpdateStatus {
  status: 'idle' | 'checking' | 'downloading' | 'verifying' | 'extracting' | 'provisioning' | 'rebuilding' | 'done' | 'error' | 'cancelled';
  progress: number;
  message: string;
  version?: string;
  startedAt?: string;
  error?: string;
}

export const systemApi = {
  getKernelVariants: async (): Promise<KernelVariant[]> => {
    const response = await apiClient.get<ApiResponse<KernelVariant[]>>('/system/kernel-variants');
    return response.data.data;
  },

  getKernelStatus: async (): Promise<KernelStatus> => {
    const response = await apiClient.get<ApiResponse<KernelStatus>>('/system/kernel-status');
    return response.data.data;
  },

  switchKernel: async (variant: string): Promise<KernelSwitchResponse> => {
    const response = await apiClient.post<ApiResponse<KernelSwitchResponse>>('/system/kernel-switch', { variant });
    return response.data.data;
  },

  repairKernelConfig: async (rebuild = false): Promise<{ message: string; variant: string; jobId?: string }> => {
    const response = await apiClient.post<ApiResponse<{ message: string; variant: string; jobId?: string }>>('/system/kernel-repair', { rebuild });
    return response.data.data;
  },

  updateLinbofs: async (): Promise<{ success: boolean; message: string; output?: string; duration?: number }> => {
    const response = await apiClient.post<ApiResponse<{ success: boolean; message: string; output?: string; duration?: number }>>('/system/update-linbofs');
    return response.data.data;
  },

  getLinbofsStatus: async (): Promise<{ status: string; message: string }> => {
    const response = await apiClient.get<ApiResponse<{ status: string; message: string }>>('/system/linbofs-status');
    return response.data.data;
  },

  // Firmware Auto-Detection
  detectFirmware: async (hostIp: string): Promise<FirmwareDetectionResult> => {
    const response = await apiClient.post<ApiResponse<FirmwareDetectionResult>>('/system/firmware-detect', { hostIp });
    return response.data.data;
  },

  // Firmware Management
  getFirmwareEntries: async (): Promise<FirmwareEntry[]> => {
    const response = await apiClient.get<ApiResponse<FirmwareEntry[]>>('/system/firmware-entries');
    return response.data.data;
  },

  getFirmwareStatus: async (): Promise<FirmwareStatus> => {
    const response = await apiClient.get<ApiResponse<FirmwareStatus>>('/system/firmware-status');
    return response.data.data;
  },

  addFirmwareEntry: async (entry: string): Promise<FirmwareEntry> => {
    const response = await apiClient.post<ApiResponse<FirmwareEntry>>('/system/firmware-entries', { entry });
    return response.data.data;
  },

  removeFirmwareEntry: async (entry: string): Promise<{ removed: string }> => {
    const response = await apiClient.post<ApiResponse<{ removed: string }>>('/system/firmware-entries/remove', { entry });
    return response.data.data;
  },

  searchAvailableFirmware: async (query: string, limit = 50): Promise<string[]> => {
    const response = await apiClient.get<ApiResponse<string[]>>('/system/firmware-available', {
      params: { query, limit },
    });
    return response.data.data;
  },

  // Firmware Catalog
  getFirmwareCatalog: async (expand = false): Promise<FirmwareCatalogCategory[]> => {
    const response = await apiClient.get<ApiResponse<FirmwareCatalogCategory[]>>('/system/firmware-catalog', {
      params: expand ? { expand: 'true' } : {},
    });
    return response.data.data;
  },

  bulkAddFirmwareEntries: async (entries: string[]): Promise<BulkAddResult> => {
    const response = await apiClient.post<ApiResponse<BulkAddResult>>('/system/firmware-entries/bulk', { entries });
    return response.data.data;
  },

  // WLAN Configuration
  getWlanConfig: async (): Promise<WlanConfig> => {
    const response = await apiClient.get<ApiResponse<WlanConfig>>('/system/wlan-config');
    return response.data.data;
  },

  setWlanConfig: async (config: { ssid: string; keyMgmt: string; psk?: string }): Promise<WlanConfig> => {
    const response = await apiClient.put<ApiResponse<WlanConfig>>('/system/wlan-config', config);
    return response.data.data;
  },

  deleteWlanConfig: async (): Promise<void> => {
    await apiClient.delete('/system/wlan-config');
  },

  // GRUB Theme
  getGrubThemeStatus: async (): Promise<GrubThemeStatus> => {
    const response = await apiClient.get<ApiResponse<GrubThemeStatus>>('/system/grub-theme');
    return response.data.data;
  },

  updateGrubTheme: async (config: Partial<GrubThemeConfig>): Promise<GrubThemeConfig> => {
    const response = await apiClient.put<ApiResponse<GrubThemeConfig>>('/system/grub-theme', config);
    return response.data.data;
  },

  resetGrubTheme: async (): Promise<GrubThemeConfig> => {
    const response = await apiClient.post<ApiResponse<GrubThemeConfig>>('/system/grub-theme/reset');
    return response.data.data;
  },

  getGrubThemeIcons: async (): Promise<GrubIcon[]> => {
    const response = await apiClient.get<ApiResponse<GrubIcon[]>>('/system/grub-theme/icons');
    return response.data.data;
  },

  uploadGrubThemeIcon: async (file: File, baseName: string): Promise<void> => {
    const formData = new FormData();
    formData.append('icon', file);
    formData.append('baseName', baseName);
    await apiClient.post('/system/grub-theme/icons', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  deleteGrubThemeIcon: async (baseName: string): Promise<void> => {
    await apiClient.delete(`/system/grub-theme/icons/${baseName}`);
  },

  uploadGrubThemeLogo: async (file: File): Promise<void> => {
    const formData = new FormData();
    formData.append('logo', file);
    await apiClient.post('/system/grub-theme/logo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  resetGrubThemeLogo: async (): Promise<void> => {
    await apiClient.post('/system/grub-theme/logo/reset');
  },

  // LINBO Version & Update
  checkLinboVersion: async (): Promise<LinboVersionInfo> => {
    const response = await apiClient.get<ApiResponse<LinboVersionInfo>>('/system/linbo-version');
    return response.data.data;
  },

  startLinboUpdate: async (): Promise<{ started: boolean }> => {
    const response = await apiClient.post<ApiResponse<{ started: boolean }>>('/system/linbo-update');
    return response.data.data;
  },

  getLinboUpdateStatus: async (): Promise<LinboUpdateStatus> => {
    const response = await apiClient.get<ApiResponse<LinboUpdateStatus>>('/system/linbo-update/status');
    return response.data.data;
  },

  cancelLinboUpdate: async (): Promise<{ cancelled: boolean }> => {
    const response = await apiClient.post<ApiResponse<{ cancelled: boolean }>>('/system/linbo-update/cancel');
    return response.data.data;
  },
};
