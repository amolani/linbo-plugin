import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Play, RotateCcw, Eye, AlertTriangle, HardDrive, Settings } from 'lucide-react';
import { syncApi } from '@/api/sync';
import type { SyncStatus, SyncConfig } from '@/api/sync';
import { useDataInvalidation } from '@/hooks/useDataInvalidation';
import { useWsStore } from '@/stores/wsStore';
import { Button, Modal, ConfirmModal, Badge } from '@/components/ui';
import { notify } from '@/stores/notificationStore';
import { ImageSyncTab } from '@/components/sync/ImageSyncTab';
import type { WsEvent } from '@/types';

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function SyncPage() {
  const [activeTab, setActiveTab] = useState<'configs' | 'images'>('configs');
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [configs, setConfigs] = useState<SyncConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTriggering, setIsTriggering] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  const [previewName, setPreviewName] = useState('');
  const { subscribe } = useWsStore();

  const fetchStatus = useCallback(async () => {
    try {
      const [statusData, configsData] = await Promise.all([
        syncApi.getStatus(),
        syncApi.getConfigs(),
      ]);
      setStatus(statusData);
      setConfigs(configsData);
    } catch (error) {
      console.error('Failed to fetch sync status:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useDataInvalidation(['sync'], fetchStatus, { showToast: false, debounceMs: 1000 });

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Subscribe to sync WS events for real-time feedback
  useEffect(() => {
    const unsubs = [
      subscribe('sync.started', (_e: WsEvent) => {
        setStatus((prev) => prev ? { ...prev, isRunning: true } : prev);
      }),
      subscribe('sync.completed', (_e: WsEvent) => {
        setStatus((prev) => prev ? { ...prev, isRunning: false } : prev);
        fetchStatus();
        notify.success('Sync abgeschlossen');
      }),
      subscribe('sync.failed', (e: WsEvent) => {
        const data = (e as { data?: { error?: string } }).data;
        setStatus((prev) => prev ? { ...prev, isRunning: false, lastError: data?.error || 'Unbekannter Fehler' } : prev);
        notify.error('Sync fehlgeschlagen', data?.error);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, fetchStatus]);

  const handleTrigger = async () => {
    setIsTriggering(true);
    try {
      await syncApi.trigger();
      notify.success('Sync gestartet');
      setStatus((prev) => prev ? { ...prev, isRunning: true } : prev);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Sync konnte nicht gestartet werden';
      notify.error('Fehler', msg);
    } finally {
      setIsTriggering(false);
    }
  };

  const handleReset = async () => {
    setIsResetting(true);
    try {
      await syncApi.reset();
      notify.success('Reset abgeschlossen', 'Full Sync wird ausgefuehrt');
      setResetConfirmOpen(false);
      fetchStatus();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Reset fehlgeschlagen';
      notify.error('Fehler', msg);
    } finally {
      setIsResetting(false);
    }
  };

  const handlePreview = async (config: SyncConfig) => {
    try {
      const content = await syncApi.getConfigPreview(config.id);
      setPreviewContent(content);
      setPreviewName(config.name || config.id);
      setPreviewOpen(true);
    } catch (error) {
      notify.error('Fehler beim Laden der Vorschau');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">LMN Server Sync</h1>
          <p className="text-muted-foreground">
            Synchronisation mit dem linuxmuster.net Server
          </p>
        </div>
        <div className="flex space-x-2">
          <Button
            variant="secondary"
            onClick={() => setResetConfirmOpen(true)}
            disabled={status?.isRunning}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset + Full Sync
          </Button>
          <Button
            onClick={handleTrigger}
            loading={isTriggering}
            disabled={status?.isRunning}
          >
            <Play className="h-4 w-4 mr-2" />
            Sync starten
          </Button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex space-x-1 bg-card rounded-lg p-1 shadow-sm">
        <button
          onClick={() => setActiveTab('configs')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'configs'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
          }`}
        >
          <Settings className="h-4 w-4" />
          Konfigurationen
        </button>
        <button
          onClick={() => setActiveTab('images')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'images'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
          }`}
        >
          <HardDrive className="h-4 w-4" />
          Images
        </button>
      </div>

      {/* Image Sync Tab */}
      {activeTab === 'images' && <ImageSyncTab />}

      {/* Config Sync Tab */}
      {activeTab === 'configs' && <>

      {/* Status Card */}
      <div className="bg-card shadow-sm rounded-lg p-6">
        <h3 className="text-lg font-medium text-foreground mb-4 flex items-center gap-2">
          <RefreshCw className={`h-5 w-5 ${status?.isRunning ? 'animate-spin text-primary' : 'text-muted-foreground'}`} />
          Sync Status
        </h3>

        {status?.lastError && (
          <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/30 flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">Letzter Fehler</p>
              <p className="text-sm text-destructive/80">{status.lastError}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">LMN API</span>
            {status?.lmnApiHealthy ? (
              <Badge variant="success" dot>Verbunden</Badge>
            ) : (
              <Badge variant="error" dot>Nicht erreichbar</Badge>
            )}
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Letzter Sync</span>
            <span className="text-sm text-foreground">
              {status?.lastSyncAt ? formatDate(status.lastSyncAt) : 'Noch nie'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Hosts</span>
            <span className="text-sm font-medium text-foreground">{status?.hosts ?? 0}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Konfigurationen</span>
            <span className="text-sm font-medium text-foreground">{status?.configs ?? 0}</span>
          </div>
        </div>
      </div>

      {/* Synced Configs Table */}
      <div className="bg-card shadow-sm rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-lg font-medium text-foreground">
            Synchronisierte Konfigurationen ({configs.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-card">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Name / Gruppe
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Betriebssysteme
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Partitionen
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Aktionen
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {configs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                    Keine Konfigurationen synchronisiert
                  </td>
                </tr>
              ) : (
                configs.map((config) => (
                  <tr key={config.id} className="hover:bg-accent/50">
                    <td className="px-6 py-4 text-sm font-mono text-foreground">
                      {config.id}
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground">
                      {config.name || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground">
                      {config.osEntries?.length ?? 0}
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground">
                      {config.partitions?.length ?? 0}
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => handlePreview(config)}
                        className="text-primary hover:text-primary/80 flex items-center gap-1 text-sm"
                      >
                        <Eye className="h-4 w-4" />
                        Vorschau
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      </>}

      {/* Reset Confirmation */}
      <ConfirmModal
        isOpen={resetConfirmOpen}
        onClose={() => setResetConfirmOpen(false)}
        onConfirm={handleReset}
        title="Reset + Full Sync"
        message="Das ueberschreibt alle lokalen Boot-Dateien. Fortfahren?"
        confirmLabel="Zuruecksetzen"
        variant="danger"
        loading={isResetting}
      />

      {/* Config Preview Modal */}
      <Modal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={`start.conf Vorschau: ${previewName}`}
        size="lg"
      >
        <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm font-mono max-h-96">
          {previewContent}
        </pre>
        <div className="flex justify-end pt-4">
          <Button variant="secondary" onClick={() => setPreviewOpen(false)}>
            Schliessen
          </Button>
        </div>
      </Modal>
    </div>
  );
}
