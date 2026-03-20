import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Monitor,
  Settings,
  Cpu,
  ArrowRight,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { syncApi } from '@/api/sync';
import { systemApi } from '@/api/system';
import { useDataInvalidation } from '@/hooks/useDataInvalidation';
import { useServerConfigStore } from '@/stores/serverConfigStore';
import type { DashboardStats, KernelStatus } from '@/types';
import { Badge } from '@/components/ui';

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DashboardPage() {
  const { modeFetched, fetchMode } = useServerConfigStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [kernelStatus, setKernelStatus] = useState<KernelStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [syncHealthy, setSyncHealthy] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  useEffect(() => {
    fetchMode();
  }, [fetchMode]);

  const fetchData = useCallback(async () => {
    try {
      const [syncStats, kernelData] = await Promise.all([
        syncApi.getStats(),
        systemApi.getKernelStatus().catch(() => null),
      ]);
      setStats({
        hosts: {
          total: syncStats.hosts.total,
          online: syncStats.hosts.online,
          offline: syncStats.hosts.offline,
          syncing: 0,
        },
        configs: syncStats.configs,
        rooms: 0,
        images: { total: 0, totalSize: 0 },
        operations: { total: 0, running: 0, completed: 0, failed: 0 },
      });
      setSyncHealthy(syncStats.lmnApiHealthy);
      setLastSyncAt(syncStats.sync.lastSyncAt);
      setKernelStatus(kernelData);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Reactive: refetch dashboard on any entity change
  useDataInvalidation(
    ['sync', 'host', 'config'],
    fetchData,
    { showToast: false, debounceMs: 1000 },
  );

  useEffect(() => {
    if (modeFetched) {
      fetchData();
    }
  }, [fetchData, modeFetched]);

  if (!modeFetched || isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">Uebersicht ueber das LINBO System</p>
      </div>

      {/* Sync Status Banner */}
      <Link
        to="/sync"
        className="block bg-card overflow-hidden shadow-sm rounded-lg hover:shadow-md transition-shadow border border-primary/30"
      >
        <div className="p-5 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-primary rounded-md p-3">
              <RefreshCw className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-muted-foreground">LMN Server Sync</h3>
                <Badge variant="info" size="sm">Sync-Modus</Badge>
              </div>
              <div className="flex items-center gap-3 mt-1">
                {syncHealthy ? (
                  <span className="flex items-center gap-1 text-sm text-ciGreen">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Verbunden
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-sm text-destructive">
                    <XCircle className="h-3.5 w-3.5" />
                    Nicht erreichbar
                  </span>
                )}
                {lastSyncAt && (
                  <span className="text-sm text-muted-foreground">
                    Letzter Sync: {formatDate(lastSyncAt)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <ArrowRight className="h-5 w-5 text-muted-foreground" />
        </div>
      </Link>

      {/* Stat Cards - sync mode: only Hosts + Configs */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-2">
        <Link
          to="/hosts"
          className="bg-card overflow-hidden shadow-sm rounded-lg hover:shadow-md transition-shadow"
        >
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-ciGreen rounded-md p-3">
                <Monitor className="h-6 w-6 text-white" aria-hidden="true" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-muted-foreground truncate">
                    Hosts Online
                  </dt>
                  <dd className="flex items-baseline">
                    <div className="text-2xl font-semibold text-foreground">
                      {stats?.hosts.online || 0}
                    </div>
                    <span className="ml-2 text-sm text-muted-foreground">
                      / {stats?.hosts.total || 0}
                    </span>
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </Link>
        <Link
          to="/configs"
          className="bg-card overflow-hidden shadow-sm rounded-lg hover:shadow-md transition-shadow"
        >
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-purple-500 rounded-md p-3">
                <Settings className="h-6 w-6 text-white" aria-hidden="true" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-muted-foreground truncate">
                    Konfigurationen
                  </dt>
                  <dd className="flex items-baseline">
                    <div className="text-2xl font-semibold text-foreground">
                      {stats?.configs || 0}
                    </div>
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </Link>
      </div>

      {/* Host Status Overview */}
      <div className="bg-card shadow-sm rounded-lg p-6">
        <h3 className="text-lg font-medium text-foreground mb-4">Host Status</h3>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Online</span>
            <span className="font-medium text-ciGreen">
              {stats?.hosts.online || 0}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Offline</span>
            <span className="font-medium text-muted-foreground">
              {stats?.hosts.offline || 0}
            </span>
          </div>
          <div className="h-2 bg-secondary rounded-full mt-4 overflow-hidden">
            {stats && stats.hosts.total > 0 && (
              <div
                className="h-full bg-ciGreen float-left"
                style={{
                  width: `${(stats.hosts.online / stats.hosts.total) * 100}%`,
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Kernel Status Card */}
      {kernelStatus && (
        <Link
          to="/kernel"
          className="block bg-card shadow-sm rounded-lg hover:shadow-md transition-shadow"
        >
          <div className="p-5 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-cyan-500 rounded-md p-3">
                <Cpu className="h-6 w-6 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">LINBO Kernel</h3>
                <div className="flex items-center space-x-2">
                  <span className="text-lg font-semibold text-foreground capitalize">
                    {kernelStatus.activeVariant}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    v{kernelStatus.activeVersion}
                  </span>
                  <span className="inline-block w-2 h-2 rounded-full bg-ciGreen" />
                </div>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
          </div>
        </Link>
      )}
    </div>
  );
}
