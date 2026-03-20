import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar, MobileSidebar } from './Sidebar';
import { Header } from './Header';
import { ToastContainer } from '@/components/ui';
import { useWebSocket, useNotificationEvents } from '@/hooks/useWebSocket';
import { useServerConfigStore } from '@/stores/serverConfigStore';
import { useLogCapture } from '@/hooks/useLogCapture';
import { useOperationsTracker } from '@/hooks/useOperationsTracker';
import { OperationsPanel } from '@/components/operations';

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const fetchMode = useServerConfigStore((s) => s.fetchMode);

  useWebSocket();
  useNotificationEvents();
  useLogCapture();
  useOperationsTracker();

  useEffect(() => {
    fetchMode();
  }, [fetchMode]);

  return (
    <div className="flex h-screen bg-background">
      <MobileSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <Sidebar />

      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen(true)} />

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>

      <ToastContainer />
      <OperationsPanel />
    </div>
  );
}
