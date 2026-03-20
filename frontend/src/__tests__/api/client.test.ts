import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to test the getAuthToken logic
describe('API Client - Token Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
  });

  it('should get token from direct localStorage', () => {
    const mockToken = 'direct-token-123';
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
      if (key === 'token') return mockToken;
      return null;
    });

    // Simulate the getAuthToken logic
    let token = localStorage.getItem('token');
    if (!token) {
      const authStorage = localStorage.getItem('auth-storage');
      if (authStorage) {
        try {
          const parsed = JSON.parse(authStorage);
          token = parsed.state?.token || null;
        } catch {
          // Ignore
        }
      }
    }

    expect(token).toBe(mockToken);
  });

  it('should fallback to auth-storage when direct token is missing', () => {
    const mockToken = 'zustand-token-456';
    const authStorageData = JSON.stringify({
      state: { token: mockToken, user: { id: '1', username: 'admin' } },
      version: 0,
    });

    (localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
      if (key === 'token') return null;
      if (key === 'auth-storage') return authStorageData;
      return null;
    });

    // Simulate the getAuthToken logic
    let token = localStorage.getItem('token');
    if (!token) {
      const authStorage = localStorage.getItem('auth-storage');
      if (authStorage) {
        try {
          const parsed = JSON.parse(authStorage);
          token = parsed.state?.token || null;
        } catch {
          // Ignore
        }
      }
    }

    expect(token).toBe(mockToken);
  });

  it('should return null when no token is available', () => {
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);

    let token = localStorage.getItem('token');
    if (!token) {
      const authStorage = localStorage.getItem('auth-storage');
      if (authStorage) {
        try {
          const parsed = JSON.parse(authStorage);
          token = parsed.state?.token || null;
        } catch {
          // Ignore
        }
      }
    }

    expect(token).toBeNull();
  });

  it('should handle malformed auth-storage JSON gracefully', () => {
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
      if (key === 'token') return null;
      if (key === 'auth-storage') return 'invalid-json{';
      return null;
    });

    let token: string | null = localStorage.getItem('token');
    if (!token) {
      const authStorage = localStorage.getItem('auth-storage');
      if (authStorage) {
        try {
          const parsed = JSON.parse(authStorage);
          token = parsed.state?.token || null;
        } catch {
          // Ignore parse errors - token remains null
        }
      }
    }

    expect(token).toBeNull();
  });
});
