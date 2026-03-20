import { useState, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Monitor,
  Settings,
  HardDrive,
  ClipboardList,
  Cpu,
  Package,
  Wrench,
  ScanSearch,
  Palette,
  MonitorSmartphone,
  TerminalSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Wifi,
  WifiOff,
  LogOut,
  X,
  RefreshCw,
  Loader2,
  Server,
  ScrollText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useWsStore } from '@/stores/wsStore';
import { useServerConfigStore } from '@/stores/serverConfigStore';
import { syncApi } from '@/api/sync';
import { notify } from '@/stores/notificationStore';
import { OperationsButton } from '@/components/operations';

const mainNavigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Hosts', href: '/hosts', icon: Monitor },
];

const configNavigation = [
  { name: 'Konfigurationen', href: '/configs', icon: Settings },
  { name: 'Images', href: '/images', icon: HardDrive },
];

const systemNavigation = [
  { name: 'Server', href: '/server', icon: Server },
  { name: 'Sync', href: '/sync', icon: RefreshCw },
  { name: 'Operationen', href: '/operations', icon: ClipboardList },
  { name: 'Kernel', href: '/kernel', icon: Cpu },
  { name: 'Firmware', href: '/firmware', icon: Package },
  { name: 'Treiber', href: '/drivers', icon: Wrench },
  { name: 'Inventar', href: '/inventory', icon: ScanSearch },
  { name: 'GRUB Theme', href: '/grub-theme', icon: Palette },
  { name: 'LINBO GUI', href: '/linbo-gui', icon: MonitorSmartphone },
  { name: 'Terminal', href: '/terminal', icon: TerminalSquare },
  { name: 'Logs', href: '/logs', icon: ScrollText },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const { user, logout } = useAuth();
  const { isConnected } = useWsStore();
  const { isSyncMode } = useServerConfigStore();

  const handleQuickSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const result = await syncApi.trigger();
      const s = result.stats;
      notify.success('Sync abgeschlossen', `${s.hosts} Hosts, ${s.configs} Configs, ${s.startConfs} start.confs`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Sync fehlgeschlagen';
      notify.error('Sync Fehler', msg);
    } finally {
      setIsSyncing(false);
    }
  }, []);

  return (
    <div className="hidden lg:flex lg:flex-shrink-0">
      <div className={cn('flex flex-col transition-all duration-300', collapsed ? 'w-16' : 'w-64')}>
        <div className="flex flex-col flex-grow bg-card border-r border-border overflow-y-auto">
          {/* Logo */}
          <div className="flex items-center flex-shrink-0 h-16 px-4">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
              <Monitor className="h-5 w-5 text-primary-foreground" />
            </div>
            {!collapsed && (
              <span className="ml-3 text-lg font-bold text-foreground">LINBO Docker</span>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-2 py-4 space-y-6">
            <NavSection items={mainNavigation} collapsed={collapsed} />

            <div>
              {!collapsed && (
                <p className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Konfiguration
                </p>
              )}
              {collapsed && <div className="border-t border-border mx-2 mb-2" />}
              <NavSection items={configNavigation} collapsed={collapsed} />
            </div>

            <div>
              {!collapsed && (
                <p className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  System
                </p>
              )}
              {collapsed && <div className="border-t border-border mx-2 mb-2" />}
              <NavSection items={systemNavigation} collapsed={collapsed} />
            </div>
          </nav>

          {/* Footer */}
          <div className="flex-shrink-0 border-t border-border p-2 space-y-1">
            {/* Quick Sync Button (sync mode only) */}
            {isSyncMode && (
              <button
                onClick={handleQuickSync}
                disabled={isSyncing}
                className={cn(
                  'flex items-center w-full px-3 py-2 text-sm font-medium rounded-md transition-colors',
                  isSyncing
                    ? 'bg-primary/20 text-primary cursor-wait'
                    : 'text-primary hover:bg-primary/10',
                  collapsed ? 'justify-center' : ''
                )}
                title={collapsed ? 'Jetzt synchronisieren' : undefined}
              >
                {isSyncing ? (
                  <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 flex-shrink-0" />
                )}
                {!collapsed && (
                  <span className="ml-3">{isSyncing ? 'Synchronisiere...' : 'Jetzt syncen'}</span>
                )}
              </button>
            )}

            {/* Operations Button */}
            <OperationsButton collapsed={collapsed} />

            {/* WebSocket Status */}
            <div className={cn(
              'flex items-center px-3 py-2 text-xs rounded-md',
              collapsed ? 'justify-center' : ''
            )}>
              {isConnected ? (
                <Wifi className="h-4 w-4 text-ciGreen flex-shrink-0" />
              ) : (
                <WifiOff className="h-4 w-4 text-destructive flex-shrink-0" />
              )}
              {!collapsed && (
                <span className={cn('ml-2', isConnected ? 'text-ciGreen' : 'text-destructive')}>
                  {isConnected ? 'Verbunden' : 'Getrennt'}
                </span>
              )}
            </div>

            {/* User & Logout */}
            <button
              onClick={() => logout()}
              className={cn(
                'flex items-center w-full px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-md transition-colors',
                collapsed ? 'justify-center' : ''
              )}
              title={collapsed ? `${user?.username} - Abmelden` : undefined}
            >
              <LogOut className="h-4 w-4 flex-shrink-0" />
              {!collapsed && (
                <span className="ml-3 truncate">{user?.username} &middot; Abmelden</span>
              )}
            </button>

            {/* Version */}
            {!collapsed && (
              <div className="px-3 py-1 text-xs text-muted-foreground/60" title={`Build: ${__BUILD_DATE__}`}>
                v{__APP_VERSION__}
              </div>
            )}

            {/* Collapse Toggle */}
            <button
              onClick={() => setCollapsed(!collapsed)}
              className={cn(
                'flex items-center w-full px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-md transition-colors',
                collapsed ? 'justify-center' : ''
              )}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4 flex-shrink-0" />
              ) : (
                <>
                  <PanelLeftClose className="h-4 w-4 flex-shrink-0" />
                  <span className="ml-3">Einklappen</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NavSection({ items, collapsed }: { items: typeof mainNavigation; collapsed: boolean }) {
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <NavLink
          key={item.name}
          to={item.href}
          className={({ isActive }) =>
            cn(
              'group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              collapsed ? 'justify-center' : ''
            )
          }
          title={collapsed ? item.name : undefined}
        >
          <item.icon className={cn('flex-shrink-0 h-5 w-5', !collapsed && 'mr-3')} aria-hidden="true" />
          {!collapsed && item.name}
        </NavLink>
      ))}
    </div>
  );
}

export function MobileSidebar({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen) return null;

  const allNavigation = [...mainNavigation, ...configNavigation, ...systemNavigation];

  return (
    <div className="lg:hidden">
      <div className="fixed inset-0 z-40 flex">
        <div
          className="fixed inset-0 bg-black/60"
          onClick={onClose}
        />
        <div className="relative flex-1 flex flex-col max-w-xs w-full bg-card border-r border-border">
          <div className="absolute top-0 right-0 -mr-12 pt-2">
            <button
              type="button"
              className="ml-1 flex items-center justify-center h-10 w-10 rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white"
              onClick={onClose}
            >
              <span className="sr-only">Schließen</span>
              <X className="h-6 w-6 text-white" />
            </button>
          </div>
          <div className="flex-1 h-0 pt-5 pb-4 overflow-y-auto">
            <div className="flex items-center flex-shrink-0 px-4">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Monitor className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="ml-3 text-lg font-bold text-foreground">LINBO Docker</span>
            </div>
            <nav className="mt-8 px-2 space-y-1">
              {allNavigation.map((item) => (
                <NavLink
                  key={item.name}
                  to={item.href}
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center px-3 py-2 text-base font-medium rounded-md transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    )
                  }
                >
                  <item.icon className="mr-4 flex-shrink-0 h-5 w-5" aria-hidden="true" />
                  {item.name}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex-shrink-0 border-t border-border p-4">
            <div className="text-xs text-muted-foreground/60" title={`Build: ${__BUILD_DATE__}`}>
              v{__APP_VERSION__}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

