import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

const API_BASE_URL = '/api/v1';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Get token from localStorage - checks both direct storage and Zustand persist storage
 */
function getAuthToken(): string | null {
  // First try direct localStorage (set during login)
  let token = localStorage.getItem('token');

  // If not found, try to get from Zustand persist storage (after page reload)
  if (!token) {
    const authStorage = localStorage.getItem('auth-storage');
    if (authStorage) {
      try {
        const parsed = JSON.parse(authStorage);
        token = parsed.state?.token || null;
      } catch {
        // Ignore parse errors
      }
    }
  }

  return token;
}

/**
 * Store a new token in both localStorage locations.
 */
function setAuthToken(token: string) {
  localStorage.setItem('token', token);
  // Also update Zustand persist storage if it exists
  const authStorage = localStorage.getItem('auth-storage');
  if (authStorage) {
    try {
      const parsed = JSON.parse(authStorage);
      if (parsed.state) {
        parsed.state.token = token;
        localStorage.setItem('auth-storage', JSON.stringify(parsed));
      }
    } catch {
      // Ignore parse errors
    }
  }
}

// Request interceptor - add auth token
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = getAuthToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

// Token refresh state — prevent parallel refresh attempts
let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

/**
 * Attempt to refresh the JWT token using the /auth/refresh endpoint.
 * Returns the new token or null if refresh failed.
 */
async function refreshToken(): Promise<string | null> {
  const currentToken = getAuthToken();
  if (!currentToken) return null;

  try {
    // Use raw axios to avoid interceptor loop
    const res = await axios.post(`${API_BASE_URL}/auth/refresh`, null, {
      headers: { Authorization: `Bearer ${currentToken}` },
    });
    const newToken = res.data?.data?.token;
    if (newToken) {
      setAuthToken(newToken);
      return newToken;
    }
    return null;
  } catch {
    return null;
  }
}

// Response interceptor - attempt token refresh on 401, then retry once
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retried?: boolean };

    // Only attempt refresh for 401 responses that haven't been retried
    if (error.response?.status === 401 && originalRequest && !originalRequest._retried) {
      originalRequest._retried = true;

      // Deduplicate concurrent refresh attempts
      if (!isRefreshing) {
        isRefreshing = true;
        refreshPromise = refreshToken().finally(() => {
          isRefreshing = false;
          refreshPromise = null;
        });
      }

      const newToken = await refreshPromise;

      if (newToken) {
        // Retry the original request with new token
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(originalRequest);
      }

      // Refresh failed — force logout
      localStorage.removeItem('token');
      localStorage.removeItem('auth-storage');
      window.location.href = '/login';
    }

    return Promise.reject(error);
  }
);

export default apiClient;
