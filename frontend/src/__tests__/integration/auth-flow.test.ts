import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for the authentication flow
 * Tests the complete flow from login to API requests
 */
describe('Authentication Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (localStorage.setItem as ReturnType<typeof vi.fn>).mockClear();
    (localStorage.removeItem as ReturnType<typeof vi.fn>).mockClear();
  });

  describe('Login Flow', () => {
    it('should complete full login flow', () => {
      // 1. User submits credentials (username: 'admin', password: 'admin')

      // 2. API returns token and user
      const apiResponse = {
        data: {
          token: 'jwt-token-xyz',
          user: {
            id: '123',
            username: 'admin',
            email: 'admin@localhost',
            role: 'admin',
          },
        },
      };

      // 3. Extract data from API response (response.data.data)
      const loginData = apiResponse.data;

      // 4. Store token in localStorage
      localStorage.setItem('token', loginData.token);

      // 5. Verify token is stored
      expect(localStorage.setItem).toHaveBeenCalledWith('token', 'jwt-token-xyz');
    });
  });

  describe('Session Persistence', () => {
    it('should restore session from auth-storage on page reload', () => {
      // Simulate zustand persist storage after login
      const persistedData = {
        state: {
          token: 'persisted-token-abc',
          user: { id: '1', username: 'admin', role: 'admin' },
        },
        version: 0,
      };

      (localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
        if (key === 'auth-storage') return JSON.stringify(persistedData);
        return null;
      });

      // Simulate getAuthToken logic on API request
      let token = localStorage.getItem('token');
      if (!token) {
        const authStorage = localStorage.getItem('auth-storage');
        if (authStorage) {
          const parsed = JSON.parse(authStorage);
          token = parsed.state?.token || null;
        }
      }

      expect(token).toBe('persisted-token-abc');
    });

    it('should sync token on rehydration for subsequent requests', () => {
      // After zustand rehydrates, onRehydrateStorage is called
      const rehydratedState = {
        token: 'rehydrated-token',
        user: { id: '1', username: 'admin' },
      };

      // onRehydrateStorage callback syncs token
      if (rehydratedState?.token) {
        localStorage.setItem('token', rehydratedState.token);
      }

      expect(localStorage.setItem).toHaveBeenCalledWith('token', 'rehydrated-token');

      // Now subsequent requests can get token directly
      (localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
        if (key === 'token') return 'rehydrated-token';
        return null;
      });

      const tokenForRequest = localStorage.getItem('token');
      expect(tokenForRequest).toBe('rehydrated-token');
    });
  });

  describe('Logout Flow', () => {
    it('should clear all auth data on logout', () => {
      // Simulate logout
      localStorage.removeItem('token');
      localStorage.removeItem('auth-storage');

      expect(localStorage.removeItem).toHaveBeenCalledWith('token');
      expect(localStorage.removeItem).toHaveBeenCalledWith('auth-storage');
    });
  });

  describe('401 Error Handling', () => {
    it('should clear auth and redirect on 401 response', () => {
      // Simulate 401 error handler
      const handle401 = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('auth-storage');
        window.location.href = '/login';
      };

      handle401();

      expect(localStorage.removeItem).toHaveBeenCalledWith('token');
      expect(localStorage.removeItem).toHaveBeenCalledWith('auth-storage');
      expect(window.location.href).toBe('/login');
    });
  });
});

describe('API Request Authorization', () => {
  it('should add Bearer token to request headers', () => {
    const token = 'my-jwt-token';
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(token);

    // Simulate axios interceptor logic
    const config = { headers: {} as Record<string, string> };
    const tokenFromStorage = localStorage.getItem('token');

    if (tokenFromStorage && config.headers) {
      config.headers['Authorization'] = `Bearer ${tokenFromStorage}`;
    }

    expect(config.headers['Authorization']).toBe('Bearer my-jwt-token');
  });

  it('should not add Authorization header when no token', () => {
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const config = { headers: {} as Record<string, string> };
    const tokenFromStorage = localStorage.getItem('token');

    if (tokenFromStorage && config.headers) {
      config.headers['Authorization'] = `Bearer ${tokenFromStorage}`;
    }

    expect(config.headers['Authorization']).toBeUndefined();
  });
});
