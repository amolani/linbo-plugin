import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

interface ProtectedRouteProps {
  children: ReactNode;
  requiredRole?: 'admin' | 'operator' | 'viewer';
}

const ROLE_LEVELS: Record<string, number> = { admin: 3, operator: 2, viewer: 1 };

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { isAuthenticated, token, user } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated && !token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Role-based access check (frontend UX only — backend enforces authoritatively)
  if (requiredRole && user?.role) {
    const userLevel = ROLE_LEVELS[user.role] ?? 0;
    const requiredLevel = ROLE_LEVELS[requiredRole] ?? 0;
    if (userLevel < requiredLevel) {
      return <Navigate to="/" replace />;
    }
  }

  return <>{children}</>;
}
