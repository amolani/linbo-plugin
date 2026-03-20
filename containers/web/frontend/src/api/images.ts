import apiClient from './client';
import type { Image } from '@/types';

export interface CreateImageData {
  filename: string;
  type: 'base' | 'differential' | 'rsync';
  description?: string;
  backingImage?: string;
}

export interface UpdateImageData {
  description?: string;
  status?: 'available' | 'uploading' | 'verifying' | 'error';
}

export interface ImageInfo {
  filename: string;
  size: number;
  checksum: string;
  createdAt: string;
  modifiedAt: string;
}

// API response wrapper type
interface ApiResponse<T> {
  data: T;
}

export const imagesApi = {
  list: async (includeSidecars = false): Promise<Image[]> => {
    const params = includeSidecars ? '?includeSidecars=true' : '';
    const response = await apiClient.get<ApiResponse<Image[]>>(`/images${params}`);
    return response.data.data;
  },

  get: async (id: string): Promise<Image> => {
    const response = await apiClient.get<ApiResponse<Image>>(`/images/${id}`);
    return response.data.data;
  },

  create: async (data: CreateImageData): Promise<Image> => {
    const response = await apiClient.post<ApiResponse<Image>>('/images', data);
    return response.data.data;
  },

  register: async (filename: string): Promise<Image> => {
    const response = await apiClient.post<ApiResponse<Image>>('/images/register', { filename });
    return response.data.data;
  },

  update: async (id: string, data: UpdateImageData): Promise<Image> => {
    const response = await apiClient.patch<ApiResponse<Image>>(`/images/${id}`, data);
    return response.data.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/images/${id}`);
  },

  verify: async (id: string): Promise<{ valid: boolean; checksum: string }> => {
    const response = await apiClient.post<ApiResponse<{ valid: boolean; checksum: string }>>(
      `/images/${id}/verify`
    );
    return response.data.data;
  },

  getInfo: async (id: string): Promise<ImageInfo> => {
    const response = await apiClient.get<ApiResponse<ImageInfo>>(`/images/${id}/info`);
    return response.data.data;
  },

  getSidecar: async (id: string, type: string): Promise<{ type: string; content: string; size: number; modifiedAt: string }> => {
    const response = await apiClient.get<ApiResponse<{ type: string; content: string; size: number; modifiedAt: string }>>(`/images/${id}/sidecars/${type}`);
    return response.data.data;
  },

  updateSidecar: async (id: string, type: string, content: string): Promise<void> => {
    await apiClient.put(`/images/${id}/sidecars/${type}`, { content });
  },
};
