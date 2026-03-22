import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout';
import { ProtectedRoute } from './ProtectedRoute';

// Eagerly loaded (needed immediately)
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';

// Lazy-loaded pages (code-split into separate chunks)
const HostsPage = lazy(() => import('@/pages/HostsPage').then(m => ({ default: m.HostsPage })));
const ConfigsPage = lazy(() => import('@/pages/ConfigsPage').then(m => ({ default: m.ConfigsPage })));
const ImagesPage = lazy(() => import('@/pages/ImagesPage').then(m => ({ default: m.ImagesPage })));
const OperationsPage = lazy(() => import('@/pages/OperationsPage').then(m => ({ default: m.OperationsPage })));
const KernelPage = lazy(() => import('@/pages/KernelPage').then(m => ({ default: m.KernelPage })));
const FirmwarePage = lazy(() => import('@/pages/FirmwarePage').then(m => ({ default: m.FirmwarePage })));
const DriversPage = lazy(() => import('@/pages/DriversPage').then(m => ({ default: m.DriversPage })));
const InventoryPage = lazy(() => import('@/pages/InventoryPage').then(m => ({ default: m.InventoryPage })));
const GrubThemePage = lazy(() => import('@/pages/GrubThemePage').then(m => ({ default: m.GrubThemePage })));
const LinboGuiPage = lazy(() => import('@/pages/LinboGuiPage').then(m => ({ default: m.LinboGuiPage })));
const SyncPage = lazy(() => import('@/pages/SyncPage').then(m => ({ default: m.SyncPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const TerminalPage = lazy(() => import('@/pages/TerminalPage').then(m => ({ default: m.TerminalPage })));
const LogsPage = lazy(() => import('@/pages/LogsPage').then(m => ({ default: m.LogsPage })));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-muted-foreground text-sm">Laden...</div>
    </div>
  );
}

export function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="hosts" element={<HostsPage />} />
          <Route path="configs" element={<ConfigsPage />} />
          <Route path="images" element={<ImagesPage />} />
          <Route path="operations" element={<OperationsPage />} />
          <Route path="kernel" element={<KernelPage />} />
          <Route path="firmware" element={<FirmwarePage />} />
          <Route path="drivers" element={<DriversPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="grub-theme" element={<GrubThemePage />} />
          <Route path="linbo-gui" element={<LinboGuiPage />} />
          <Route path="server" element={<SettingsPage />} />
          <Route path="sync" element={<SyncPage />} />
          <Route path="terminal" element={<TerminalPage />} />
          <Route path="logs" element={<LogsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
