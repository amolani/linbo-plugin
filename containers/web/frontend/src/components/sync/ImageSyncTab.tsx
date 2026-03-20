import { useState, useEffect, useCallback } from 'react';
import { Download, Upload, RefreshCw, X, Loader2, HardDrive, CheckCircle, Clock } from 'lucide-react';
import { syncApi } from '@/api/sync';
import type { ImageComparison, ImageSyncJob, ImageSyncQueue } from '@/api/sync';
import { useWsStore } from '@/stores/wsStore';
import { Button, Badge } from '@/components/ui';
import { notify } from '@/stores/notificationStore';
import type { WsEvent } from '@/types';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1048576) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${(bytesPerSec / 1048576).toFixed(1)} MB/s`;
}

function formatEta(seconds: number): string {
  if (seconds <= 0) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const statusConfig: Record<string, { variant: 'success' | 'warning' | 'info' | 'default'; label: string }> = {
  synced: { variant: 'success', label: 'Synchron' },
  outdated: { variant: 'warning', label: 'Veraltet' },
  remote_only: { variant: 'info', label: 'Nur Remote' },
  local_only: { variant: 'default', label: 'Nur Lokal' },
};

export function ImageSyncTab() {
  const [images, setImages] = useState<ImageComparison[]>([]);
  const [queue, setQueue] = useState<ImageSyncQueue>({ running: null, queued: [] });
  const [pushQueue, setPushQueue] = useState<ImageSyncQueue>({ running: null, queued: [] });
  const [isLoading, setIsLoading] = useState(true);
  const { subscribe } = useWsStore();

  const fetchData = useCallback(async () => {
    try {
      const [comparison, queueData, pushQueueData] = await Promise.all([
        syncApi.compareImages(),
        syncApi.getImageQueue(),
        syncApi.getPushQueue(),
      ]);
      setImages(comparison);
      setQueue(queueData);
      setPushQueue(pushQueueData);
    } catch (error) {
      console.error('Failed to fetch image data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Subscribe to image sync WS events
  useEffect(() => {
    const unsubs = [
      subscribe('image.sync.queued', (_e: WsEvent) => {
        syncApi.getImageQueue().then(setQueue).catch(() => {});
      }),
      subscribe('image.sync.started', (_e: WsEvent) => {
        syncApi.getImageQueue().then(setQueue).catch(() => {});
      }),
      subscribe('image.sync.progress', (e: WsEvent) => {
        const data = (e as unknown as { data?: ImageSyncJob }).data;
        if (data) {
          setQueue(prev => ({
            ...prev,
            running: prev.running?.jobId === data.jobId
              ? { ...prev.running, ...data, status: 'downloading' }
              : prev.running,
          }));
        }
      }),
      subscribe('image.sync.completed', (e: WsEvent) => {
        const data = (e as { data?: { imageName?: string } }).data;
        notify.success('Image heruntergeladen', data?.imageName || '');
        fetchData();
      }),
      subscribe('image.sync.failed', (e: WsEvent) => {
        const data = (e as { data?: { imageName?: string; error?: string } }).data;
        notify.error('Image-Download fehlgeschlagen', data?.error || data?.imageName);
        fetchData();
      }),
      subscribe('image.sync.cancelled', (_e: WsEvent) => {
        fetchData();
      }),
      // Push events
      subscribe('image.push.queued', (_e: WsEvent) => {
        syncApi.getPushQueue().then(setPushQueue).catch(() => {});
      }),
      subscribe('image.push.started', (_e: WsEvent) => {
        syncApi.getPushQueue().then(setPushQueue).catch(() => {});
      }),
      subscribe('image.push.progress', (e: WsEvent) => {
        const data = (e as unknown as { data?: ImageSyncJob }).data;
        if (data) {
          setPushQueue(prev => ({
            ...prev,
            running: prev.running?.jobId === data.jobId
              ? { ...prev.running, ...data, status: 'uploading' }
              : prev.running,
          }));
        }
      }),
      subscribe('image.push.completed', (e: WsEvent) => {
        const data = (e as { data?: { imageName?: string } }).data;
        notify.success('Image hochgeladen', data?.imageName || '');
        fetchData();
      }),
      subscribe('image.push.failed', (e: WsEvent) => {
        const data = (e as { data?: { imageName?: string; error?: string } }).data;
        notify.error('Image-Upload fehlgeschlagen', data?.error || data?.imageName);
        fetchData();
      }),
      subscribe('image.push.cancelled', (_e: WsEvent) => {
        fetchData();
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, [subscribe, fetchData]);

  const handlePullImage = async (imageName: string) => {
    try {
      await syncApi.pullImage(imageName);
      notify.info('Download gestartet', imageName);
      syncApi.getImageQueue().then(setQueue).catch(() => {});
    } catch (error: unknown) {
      const axErr = error as { response?: { data?: { error?: { message?: string } } } };
      const msg = axErr?.response?.data?.error?.message
        || (error instanceof Error ? error.message : 'Unbekannter Fehler');
      notify.error(`Download fehlgeschlagen: ${imageName}`, msg);
    }
  };

  const handlePushImage = async (imageName: string) => {
    try {
      await syncApi.pushImage(imageName);
      notify.info('Upload gestartet', imageName);
      syncApi.getPushQueue().then(setPushQueue).catch(() => {});
    } catch (error: unknown) {
      const axErr = error as { response?: { data?: { error?: { message?: string } } } };
      const msg = axErr?.response?.data?.error?.message
        || (error instanceof Error ? error.message : 'Unbekannter Fehler');
      notify.error(`Push fehlgeschlagen: ${imageName}`, msg);
    }
  };

  const handleCancel = async (jobId: string) => {
    try {
      await syncApi.cancelImageJob(jobId);
      notify.info('Download abgebrochen');
      fetchData();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Fehler';
      notify.error('Fehler', msg);
    }
  };

  const handleCancelPush = async (jobId: string) => {
    try {
      await syncApi.cancelPushJob(jobId);
      notify.info('Upload abgebrochen');
      fetchData();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Fehler';
      notify.error('Fehler', msg);
    }
  };

  const isJobRunning = (imageName: string) =>
    queue.running?.imageName === imageName ||
    queue.queued.some(j => j.imageName === imageName);

  const isPushRunning = (imageName: string) =>
    pushQueue.running?.imageName === imageName ||
    pushQueue.queued.some(j => j.imageName === imageName);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Active Download */}
      {queue.running && queue.running.status === 'downloading' && (
        <div className="bg-card shadow-sm rounded-lg p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
              <Download className="h-5 w-5 text-primary animate-pulse" />
              Download: {queue.running.imageName}
            </h3>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleCancel(queue.running!.jobId)}
            >
              <X className="h-4 w-4 mr-1" />
              Abbrechen
            </Button>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-secondary rounded-full h-3 mb-2">
            <div
              className="bg-primary rounded-full h-3 transition-all duration-500"
              style={{ width: `${queue.running.progress || 0}%` }}
            />
          </div>

          <div className="flex justify-between text-sm text-muted-foreground">
            <span>
              {formatBytes(queue.running.bytesDownloaded)} / {formatBytes(queue.running.totalBytes)}
              {' '}({queue.running.progress}%)
            </span>
            <span className="flex items-center gap-3">
              <span>{formatSpeed(queue.running.speed)}</span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {formatEta(queue.running.eta)}
              </span>
            </span>
          </div>
        </div>
      )}

      {/* Verifying state */}
      {queue.running && queue.running.status === 'verifying' && (
        <div className="bg-card shadow-sm rounded-lg p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-foreground">
              MD5-Verifizierung: {queue.running.imageName}...
            </span>
          </div>
        </div>
      )}

      {/* Queue */}
      {queue.queued.length > 0 && (
        <div className="bg-card shadow-sm rounded-lg p-4">
          <h4 className="text-sm font-medium text-muted-foreground mb-2">
            Warteschlange ({queue.queued.length})
          </h4>
          <div className="space-y-2">
            {queue.queued.map(job => (
              <div key={job.jobId} className="flex items-center justify-between text-sm">
                <span className="text-foreground flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  {job.imageName}
                </span>
                <button
                  onClick={() => handleCancel(job.jobId)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Upload */}
      {pushQueue.running && (pushQueue.running.status === 'uploading' || pushQueue.running.status === 'finalizing') && (
        <div className="bg-card shadow-sm rounded-lg p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary animate-pulse" />
              {pushQueue.running.status === 'finalizing' ? 'Finalisierung' : 'Upload'}: {pushQueue.running.imageName}
            </h3>
            <Button variant="secondary" size="sm" onClick={() => handleCancelPush(pushQueue.running!.jobId)}>
              <X className="h-4 w-4 mr-1" /> Abbrechen
            </Button>
          </div>
          <div className="w-full bg-secondary rounded-full h-3 mb-2">
            <div className="bg-primary rounded-full h-3 transition-all duration-500" style={{ width: `${pushQueue.running.progress || 0}%` }} />
          </div>
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>
              {formatBytes(pushQueue.running.bytesDownloaded || 0)} / {formatBytes(pushQueue.running.totalBytes)}
              {' '}({pushQueue.running.progress}%)
            </span>
            <span className="flex items-center gap-3">
              <span>{formatSpeed(pushQueue.running.speed)}</span>
              <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{formatEta(pushQueue.running.eta)}</span>
            </span>
          </div>
        </div>
      )}

      {/* Push Queue */}
      {pushQueue.queued.length > 0 && (
        <div className="bg-card shadow-sm rounded-lg p-4">
          <h4 className="text-sm font-medium text-muted-foreground mb-2">Upload-Warteschlange ({pushQueue.queued.length})</h4>
          <div className="space-y-2">
            {pushQueue.queued.map(job => (
              <div key={job.jobId} className="flex items-center justify-between text-sm">
                <span className="text-foreground flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" />{job.imageName}</span>
                <button onClick={() => handleCancelPush(job.jobId)} className="text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action bar + Comparison table */}
      <div className="bg-card shadow-sm rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-muted-foreground" />
            Images ({images.length})
          </h3>
          <Button variant="secondary" size="sm" onClick={fetchData}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Aktualisieren
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-card">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Remote
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Lokal
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Aktion
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {images.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                    Keine Images gefunden
                  </td>
                </tr>
              ) : (
                images.map(img => {
                  const config = statusConfig[img.status] || statusConfig.local_only;
                  const running = isJobRunning(img.name);

                  return (
                    <tr key={img.name} className="hover:bg-accent/50">
                      <td className="px-6 py-4 text-sm font-medium text-foreground">
                        {img.name}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {img.remote ? formatBytes(Number(img.remote.size || img.remote.imagesize || img.remote.totalSize || 0)) : '-'}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {img.local ? formatBytes(img.local.totalSize) : '-'}
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={config.variant} dot size="sm">
                          {config.label}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        {(img.status === 'remote_only' || img.status === 'outdated') && (
                          running ? (
                            <span className="flex items-center gap-1.5 text-sm text-primary">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              In Queue
                            </span>
                          ) : (
                            <button
                              onClick={() => handlePullImage(img.name)}
                              className="text-primary hover:text-primary/80 flex items-center gap-1 text-sm"
                            >
                              <Download className="h-4 w-4" />
                              {img.status === 'outdated' ? 'Aktualisieren' : 'Herunterladen'}
                            </button>
                          )
                        )}
                        {img.status === 'synced' && (
                          <span className="flex items-center gap-1.5 text-sm text-ciGreen">
                            <CheckCircle className="h-4 w-4" />
                            Aktuell
                          </span>
                        )}
                        {img.status === 'local_only' && (
                          isPushRunning(img.name) ? (
                            <span className="flex items-center gap-1.5 text-sm text-primary">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Push läuft
                            </span>
                          ) : (
                            <button
                              onClick={() => handlePushImage(img.name)}
                              className="text-primary hover:text-primary/80 flex items-center gap-1 text-sm"
                            >
                              <Upload className="h-4 w-4" />
                              Hochladen
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
