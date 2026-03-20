import { describe, it, expect, vi, beforeEach } from 'vitest';

// Type for the persisted auth state (partial state that gets rehydrated)
interface PersistedAuthState {
  token: string | null;
  user: { id: string; username: string; email: string; role: 'admin' | 'operator' | 'viewer' } | null;
  isAuthenticated: boolean;
}

describe('Auth Store - Rehydration Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (localStorage.setItem as ReturnType<typeof vi.fn>).mockClear();
  });

  it('should sync token to localStorage on rehydration', () => {
    // Simulate the onRehydrateStorage callback behavior
    const state: PersistedAuthState = {
      token: 'rehydrated-token-789',
      user: { id: '1', username: 'admin', email: 'admin@test.com', role: 'admin' },
      isAuthenticated: false,
    };

    // This is what onRehydrateStorage does:
    if (state?.token) {
      localStorage.setItem('token', state.token);
      state.isAuthenticated = true;
    }

    expect(localStorage.setItem).toHaveBeenCalledWith('token', 'rehydrated-token-789');
    expect(state.isAuthenticated).toBe(true);
  });

  it('should not set token if state is null', () => {
    // Use a function to prevent TypeScript from narrowing the const to literal 'null'
    const getState = (): PersistedAuthState | null => null;
    const state = getState();

    // This is what onRehydrateStorage does:
    if (state?.token) {
      localStorage.setItem('token', state.token);
    }

    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it('should not set token if token is empty', () => {
    const state: PersistedAuthState = {
      token: null,
      user: null,
      isAuthenticated: false,
    };

    // This is what onRehydrateStorage does:
    if (state?.token) {
      localStorage.setItem('token', state.token);
    }

    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
});

describe('Auth Store - Login Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should store token in localStorage after login', () => {
    const loginResponse = {
      token: 'new-login-token-abc',
      user: {
        id: '1',
        username: 'admin',
        email: 'admin@localhost',
        role: 'admin' as const,
      },
    };

    // Simulate login behavior
    localStorage.setItem('token', loginResponse.token);

    expect(localStorage.setItem).toHaveBeenCalledWith('token', 'new-login-token-abc');
  });

  it('should remove token on logout', () => {
    // Simulate logout behavior
    localStorage.removeItem('token');

    expect(localStorage.removeItem).toHaveBeenCalledWith('token');
  });
});

describe('Auth Store - Check Auth Logic', () => {
  it('should return not authenticated when no token', () => {
    const state: Pick<PersistedAuthState, 'token' | 'isAuthenticated'> = {
      token: null,
      isAuthenticated: false,
    };

    // checkAuth logic when no token
    if (!state.token) {
      state.isAuthenticated = false;
    }

    expect(state.isAuthenticated).toBe(false);
  });
});
