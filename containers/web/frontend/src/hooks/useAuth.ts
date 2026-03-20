import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

export function useAuth() {
  const {
    token,
    user,
    isAuthenticated,
    isLoading,
    error,
    login,
    logout,
    checkAuth,
    clearError,
  } = useAuthStore();

  return {
    token,
    user,
    isAuthenticated,
    isLoading,
    error,
    login,
    logout,
    checkAuth,
    clearError,
    isAdmin: user?.role === 'admin',
    isOperator: user?.role === 'admin' || user?.role === 'operator',
  };
}

export function useRequireAuth(redirectTo = '/login') {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading, checkAuth } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      checkAuth().then(() => {
        const { isAuthenticated: stillAuth } = useAuthStore.getState();
        if (!stillAuth) {
          navigate(redirectTo);
        }
      });
    }
  }, [isAuthenticated, isLoading, navigate, redirectTo, checkAuth]);

  return { isAuthenticated, isLoading };
}
