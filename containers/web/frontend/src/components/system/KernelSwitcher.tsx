import { useEffect, useState, useCallback } from 'react';
import {
  Cpu,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  Wrench,
} from 'lucide-react';
import { systemApi } from '@/api/system';
import { useWsStore } from '@/stores/wsStore';
import type { KernelStatus } from '@/types';
import { ConfirmModal } from '@/components/ui';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function KernelSwitcher() {
  const [status, setStatus] = useState<KernelStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await systemApi.getKernelStatus();
      setStatus(data);
      setError(null);

      // Start polling if rebuild is running
      if (data.rebuildRunning && !isPolling) {
        setIsPolling(true);
      } else if (!data.rebuildRunning && isPolling) {
        setIsPolling(false);
      }
    } catch (err) {
      setError('Kernel-Status konnte nicht geladen werden');
    } finally {
      setIsLoading(false);
    }
  }, [isPolling]);

  // Listen for WS events
  const { subscribe } = useWsStore();
  useEffect(() => {
    const unsubs = [
      subscribe('system.kernel_switched', () => fetchStatus()),
      subscribe('system.kernel_switch_failed', () => fetchStatus()),
      subscribe('system.kernel_switch_started', () => fetchStatus()),
    ];
    return () => unsubs.forEach(fn => fn());
  }, [subscribe, fetchStatus]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Poll during rebuild
  useEffect(() => {
    if (!isPolling) return;
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [isPolling, fetchStatus]);

  const handleSwitch = async (variant: string) => {
    setSwitchTarget(null);
    try {
      await systemApi.switchKernel(variant);
      setIsPolling(true);
      fetchStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Kernel-Wechsel fehlgeschlagen';
      setError(msg);
    }
  };

  const handleRepair = async (rebuild: boolean) => {
    try {
      await systemApi.repairKernelConfig(rebuild);
      if (rebuild) setIsPolling(true);
      fetchStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Reparatur fehlgeschlagen';
      setError(msg);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-card shadow-sm rounded-lg p-6">
        <div className="flex items-center space-x-2">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Lade Kernel-Status...</span>
        </div>
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="bg-card shadow-sm rounded-lg p-6">
        <div className="flex items-center space-x-2 text-destructive">
          <XCircle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!status) return null;

  const switchTargetVariant = status.variants.find(v => v.name === switchTarget);

  return (
    <div className="bg-card shadow-sm rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="bg-cyan-500 rounded-md p-2">
            <Cpu className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-foreground">LINBO Kernel</h3>
            <div className="flex items-center space-x-2 text-sm">
              {status.rebuildRunning ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span className="text-primary">Rebuilding linbofs64...</span>
                </>
              ) : (
                <>
                  <span className="text-muted-foreground">
                    Aktiv: <span className="font-medium text-foreground">{status.activeVariant}</span>
                    {' '}v{status.activeVersion}
                  </span>
                  <span className="inline-block w-2 h-2 rounded-full bg-ciGreen" />
                </>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={fetchStatus}
          className="p-2 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary transition-colors"
          title="Aktualisieren"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Warnings */}
      {status.configWarning && (
        <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
          <div className="flex items-start space-x-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-yellow-300">{status.configWarning}</p>
              <div className="flex space-x-2 mt-2">
                <button
                  onClick={() => handleRepair(false)}
                  className="text-xs px-2 py-1 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 rounded transition-colors"
                >
                  Nur reparieren
                </button>
                <button
                  onClick={() => handleRepair(true)}
                  className="text-xs px-2 py-1 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 rounded transition-colors"
                >
                  Reparieren + Rebuild
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!status.hasTemplate && (
        <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            <p className="text-sm text-yellow-300">
              Template fehlt: linbofs64.xz nicht gefunden
            </p>
          </div>
        </div>
      )}

      {status.lastError && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
          <div className="flex items-center space-x-2">
            <XCircle className="h-4 w-4 text-destructive" />
            <p className="text-sm text-destructive">Letzter Fehler: {status.lastError}</p>
          </div>
        </div>
      )}

      {/* Variants Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="pb-2 font-medium">Variante</th>
              <th className="pb-2 font-medium">Version</th>
              <th className="pb-2 font-medium">Kernel</th>
              <th className="pb-2 font-medium">Module</th>
              <th className="pb-2 font-medium text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {status.variants.map((v) => (
              <tr key={v.name} className={v.isActive ? 'bg-primary/5' : ''}>
                <td className="py-2.5 font-medium text-foreground capitalize">
                  {v.name}
                </td>
                <td className="py-2.5 text-muted-foreground">
                  {v.version !== 'unknown' ? v.version : (
                    <span className="text-yellow-500">-</span>
                  )}
                </td>
                <td className="py-2.5 text-muted-foreground">
                  {v.kernelSize > 0 ? formatBytes(v.kernelSize) : '-'}
                </td>
                <td className="py-2.5 text-muted-foreground">
                  {v.modulesSize > 0 ? formatBytes(v.modulesSize) : '-'}
                </td>
                <td className="py-2.5 text-right">
                  {v.isActive ? (
                    <span className="inline-flex items-center space-x-1 text-ciGreen text-xs font-medium">
                      <CheckCircle className="h-3.5 w-3.5" />
                      <span>Aktiv</span>
                    </span>
                  ) : v.available ? (
                    <button
                      onClick={() => setSwitchTarget(v.name)}
                      disabled={status.rebuildRunning}
                      className="text-xs px-3 py-1 bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Wechseln
                    </button>
                  ) : (
                    <span
                      className="text-xs text-yellow-500 cursor-help"
                      title={`Variante unvollständig: fehlende Dateien`}
                    >
                      Unvollständig
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* No variants available */}
      {status.variants.every(v => !v.available) && (
        <div className="mt-4 text-center text-sm text-muted-foreground">
          Keine Kernel-Varianten verfügbar. Boot-Files mit Kernel-Varianten erforderlich.
        </div>
      )}

      {/* Footer info */}
      <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
        <div>
          {status.lastSwitchAt && (
            <span>Letzter Wechsel: {formatDate(status.lastSwitchAt)}</span>
          )}
        </div>
        <div className="flex items-center space-x-3">
          {status.configWarning && (
            <button
              onClick={() => handleRepair(false)}
              className="flex items-center space-x-1 text-yellow-500 hover:text-yellow-400 transition-colors"
              title="Konfiguration reparieren"
            >
              <Wrench className="h-3.5 w-3.5" />
              <span>Reparieren</span>
            </button>
          )}
        </div>
      </div>

      {/* Confirm Switch Modal */}
      {switchTarget && switchTargetVariant && (
        <ConfirmModal
          isOpen={true}
          onClose={() => setSwitchTarget(null)}
          onConfirm={() => handleSwitch(switchTarget)}
          title="Kernel wechseln"
          message={`Kernel wechseln zu '${switchTarget}' v${switchTargetVariant.version}? Alle LINBO-Clients erhalten den neuen Kernel beim nächsten PXE-Boot.`}
          confirmLabel="Wechseln"
          variant="warning"
        />
      )}
    </div>
  );
}
