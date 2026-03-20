import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Download,
  RefreshCw,
  CheckCircle,
  XCircle,
  Loader2,
  Package,
  AlertTriangle,
} from 'lucide-react';
import { systemApi } from '@/api/system';
import type { LinboVersionInfo, LinboUpdateStatus } from '@/api/system';
import { useWsStore } from '@/stores/wsStore';
import { ConfirmModal } from '@/components/ui';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

const STATUS_LABELS: Record<string, string> = {
  preflight: 'Preflight-Check...',
  downloading: 'Herunterladen...',
  verifying: 'SHA256 verifizieren...',
  extracting: 'Paket extrahieren...',
  provisioning: 'Boot-Dateien installieren...',
  rebuilding: 'linbofs64 neu bauen...',
};

export function LinboUpdater() {
  const [versionInfo, setVersionInfo] = useState<LinboVersionInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<LinboUpdateStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isActive = updateStatus && !['idle', 'done', 'error', 'cancelled'].includes(updateStatus.status);

  const checkVersion = useCallback(async () => {
    setIsChecking(true);
    setCheckError(null);
    try {
      const info = await systemApi.checkLinboVersion();
      setVersionInfo(info);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Versionscheck fehlgeschlagen';
      setCheckError(msg);
    } finally {
      setIsChecking(false);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const status = await systemApi.getLinboUpdateStatus();
      setUpdateStatus(status);
      return status;
    } catch {
      return null;
    }
  }, []);

  // Initial load
  useEffect(() => {
    checkVersion();
    fetchStatus();
  }, [checkVersion, fetchStatus]);

  // Poll while active
  useEffect(() => {
    if (isActive && !pollRef.current) {
      pollRef.current = setInterval(fetchStatus, 3000);
    } else if (!isActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [isActive, fetchStatus]);

  // WS subscription for real-time updates
  useEffect(() => {
    const unsub = useWsStore.getState().subscribe('linbo.update.status', (event) => {
      const data = event.data as Partial<LinboUpdateStatus>;
      setUpdateStatus((prev) => ({
        status: data.status ?? prev?.status ?? 'idle',
        progress: data.progress ?? prev?.progress ?? 0,
        message: data.message ?? prev?.message ?? '',
        version: data.version ?? prev?.version,
      }));

      // Refresh version info after done
      if (data.status === 'done') {
        setTimeout(() => checkVersion(), 500);
      }
    });
    return unsub;
  }, [checkVersion]);

  const handleStartUpdate = async () => {
    setShowConfirm(false);
    setIsStarting(true);
    try {
      await systemApi.startLinboUpdate();
      // Status will be updated via WS/polling
      await fetchStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Update konnte nicht gestartet werden';
      setUpdateStatus({ status: 'error', progress: 0, message: msg, error: msg });
    } finally {
      setIsStarting(false);
    }
  };

  const handleCancel = async () => {
    try {
      await systemApi.cancelLinboUpdate();
    } catch {}
  };

  const handleReset = () => {
    setUpdateStatus(null);
    checkVersion();
  };

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-center gap-3 mb-4">
        <Package className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">LINBO Version</h2>
      </div>

      {/* Version info */}
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-24">Installiert:</span>
          <span className="font-mono text-foreground">
            {versionInfo ? versionInfo.installed : '...'}
          </span>
          {versionInfo?.installedFull && versionInfo.installedFull !== 'unknown' && (
            <span className="text-muted-foreground text-xs">
              ({versionInfo.installedFull.replace(/^LINBO\s+\S+:\s*/, '')})
            </span>
          )}
        </div>

        {versionInfo?.available && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-24">Verfügbar:</span>
            <span className="font-mono text-foreground">{versionInfo.available}</span>
            {versionInfo.updateAvailable && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
                <CheckCircle className="h-3 w-3" />
                Update verfügbar
              </span>
            )}
            {versionInfo.packageSize && (
              <span className="text-muted-foreground text-xs">
                ({formatBytes(versionInfo.packageSize)})
              </span>
            )}
          </div>
        )}

        {!versionInfo?.available && !isChecking && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-24">Verfügbar:</span>
            <span className="text-muted-foreground italic">Nicht geprüft</span>
          </div>
        )}
      </div>

      {checkError && (
        <div className="mt-3 flex items-center gap-2 text-sm text-destructive">
          <XCircle className="h-4 w-4 flex-shrink-0" />
          {checkError}
        </div>
      )}

      {/* Action buttons */}
      {!isActive && (
        <div className="mt-4 flex gap-3">
          <button
            onClick={checkVersion}
            disabled={isChecking}
            className="inline-flex items-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/80 disabled:opacity-50"
          >
            {isChecking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Auf Updates prüfen
          </button>

          {versionInfo?.updateAvailable && (
            <button
              onClick={() => setShowConfirm(true)}
              disabled={isStarting}
              className="inline-flex items-center gap-2 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {isStarting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Update starten
            </button>
          )}
        </div>
      )}

      {/* Progress */}
      {isActive && updateStatus && (
        <div className="mt-4 rounded-md border border-border bg-background p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">
              {STATUS_LABELS[updateStatus.status] || updateStatus.status}
            </span>
            <span className="text-xs text-muted-foreground">{updateStatus.progress}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${updateStatus.progress}%` }}
            />
          </div>
          {updateStatus.message && (
            <p className="mt-2 text-xs text-muted-foreground">{updateStatus.message}</p>
          )}
          <div className="mt-3 flex justify-end">
            <button
              onClick={handleCancel}
              className="inline-flex items-center gap-1 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/80"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* Done */}
      {updateStatus?.status === 'done' && (
        <div className="mt-4 rounded-md border border-green-500/20 bg-green-500/5 p-4">
          <div className="flex items-center gap-2 text-sm text-green-400">
            <CheckCircle className="h-4 w-4" />
            <span className="font-medium">
              LINBO wurde auf Version {updateStatus.version} aktualisiert
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Kernel-Varianten wurden aktualisiert. Boot-Dateien sind bereit.
          </p>
          <button
            onClick={handleReset}
            className="mt-3 inline-flex items-center gap-1 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/80"
          >
            <RefreshCw className="h-3 w-3" />
            Erneut prüfen
          </button>
        </div>
      )}

      {/* Error */}
      {updateStatus?.status === 'error' && (
        <div className="mt-4 rounded-md border border-destructive/20 bg-destructive/5 p-4">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">Update fehlgeschlagen</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {updateStatus.error || updateStatus.message}
          </p>
          <button
            onClick={handleReset}
            className="mt-3 inline-flex items-center gap-1 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/80"
          >
            <RefreshCw className="h-3 w-3" />
            Erneut versuchen
          </button>
        </div>
      )}

      {/* Cancelled */}
      {updateStatus?.status === 'cancelled' && (
        <div className="mt-4 rounded-md border border-yellow-500/20 bg-yellow-500/5 p-4">
          <div className="flex items-center gap-2 text-sm text-yellow-400">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">Update abgebrochen</span>
          </div>
          <button
            onClick={handleReset}
            className="mt-3 inline-flex items-center gap-1 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/80"
          >
            <RefreshCw className="h-3 w-3" />
            Erneut prüfen
          </button>
        </div>
      )}

      {/* Confirm modal */}
      <ConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleStartUpdate}
        title="LINBO Update"
        message={
          <>
            LINBO wird auf Version <strong>{versionInfo?.available}</strong> aktualisiert.
            Bootfiles werden neu gebaut. Dies kann einige Minuten dauern. Fortfahren?
          </>
        }
        confirmLabel="Update starten"
        variant="warning"
      />
    </div>
  );
}
