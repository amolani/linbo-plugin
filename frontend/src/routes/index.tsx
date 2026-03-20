import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout';
import { ProtectedRoute } from './ProtectedRoute';

// Pages
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { HostsPage } from '@/pages/HostsPage';
import { ConfigsPage } from '@/pages/ConfigsPage';
import { ImagesPage } from '@/pages/ImagesPage';
import { OperationsPage } from '@/pages/OperationsPage';
import { KernelPage } from '@/pages/KernelPage';
import { FirmwarePage } from '@/pages/FirmwarePage';
import { DriversPage } from '@/pages/DriversPage';
import { InventoryPage } from '@/pages/InventoryPage';
import { GrubThemePage } from '@/pages/GrubThemePage';
import { LinboGuiPage } from '@/pages/LinboGuiPage';
import { SyncPage } from '@/pages/SyncPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { TerminalPage } from '@/pages/TerminalPage';
import { LogsPage } from '@/pages/LogsPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Single layout route — AppLayout stays mounted across navigation */}
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
  );
}
