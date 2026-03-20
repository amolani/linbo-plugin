import apiClient from './client';
import type { LoginRequest, LoginResponse, User } from '@/types';

// API response wrapper type
interface ApiResponse<T> {
  data: T;
}

export const authApi = {
  login: async (credentials: LoginRequest): Promise<LoginResponse> => {
    const response = await apiClient.post<ApiResponse<LoginResponse>>('/auth/login', credentials);
    return response.data.data;
  },

  logout: async (): Promise<void> => {
    await apiClient.post('/auth/logout');
  },

  me: async (): Promise<User> => {
    const response = await apiClient.get<ApiResponse<User>>('/auth/me');
    return response.data.data;
  },

  changePassword: async (oldPassword: string, newPassword: string): Promise<void> => {
    await apiClient.put('/auth/password', { oldPassword, newPassword });
  },

  register: async (data: { username: string; password: string; email?: string; role?: string }): Promise<User> => {
    const response = await apiClient.post<ApiResponse<User>>('/auth/register', data);
    return response.data.data;
  },
};
