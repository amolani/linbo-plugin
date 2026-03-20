import { useState, useEffect, useCallback } from 'react';
import { Trash2, RefreshCw } from 'lucide-react';
import { operationsApi, ScheduledCommand } from '@/api/operations';
import { Button, ConfirmModal } from '@/components/ui';
import { notify } from '@/stores/notificationStore';

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ScheduledCommandsSection() {
  const [commands, setCommands] = useState<ScheduledCommand[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [cancelingHost, setCancelingHost] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<ScheduledCommand | null>(null);

  const fetchScheduled = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await operationsApi.listScheduled();
      setCommands(data);
    } catch {
      notify.error('Fehler beim Laden der geplanten Befehle');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchScheduled();
  }, [fetchScheduled]);

  const handleCancel = async () => {
    if (!confirmCancel) return;

    setCancelingHost(confirmCancel.hostname);
    try {
      await operationsApi.cancelScheduled(confirmCancel.hostname);
      notify.success('Befehl abgebrochen', confirmCancel.hostname);
      fetchScheduled();
    } catch {
      notify.error('Fehler beim Abbrechen');
    } finally {
      setCancelingHost(null);
      setConfirmCancel(null);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-card shadow-sm rounded-lg p-6">
        <div className="animate-pulse flex space-x-4">
          <div className="flex-1 space-y-4 py-1">
            <div className="h-4 bg-secondary rounded w-3/4"></div>
            <div className="h-4 bg-secondary rounded w-1/2"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card shadow-sm rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="font-medium text-foreground">Geplante Befehle (Onboot)</h3>
        <Button variant="ghost" size="sm" onClick={fetchScheduled}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {commands.length === 0 ? (
        <div className="p-6 text-center text-muted-foreground">
          Keine geplanten Befehle vorhanden
        </div>
      ) : (
        <div className="divide-y divide-border">
          {commands.map((cmd) => (
            <div
              key={cmd.hostname}
              className="px-4 py-3 flex items-center justify-between hover:bg-muted/50"
            >
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-foreground">{cmd.hostname}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(cmd.createdAt)}
                  </span>
                </div>
                <code className="text-sm text-muted-foreground font-mono">{cmd.commands}</code>
              </div>
              <button
                onClick={() => setConfirmCancel(cmd)}
                disabled={cancelingHost === cmd.hostname}
                className="p-2 text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        isOpen={!!confirmCancel}
        onClose={() => setConfirmCancel(null)}
        onConfirm={handleCancel}
        title="Befehl abbrechen"
        message={`Möchten Sie den geplanten Befehl für "${confirmCancel?.hostname}" wirklich abbrechen?`}
        confirmLabel="Abbrechen"
        variant="danger"
        loading={!!cancelingHost}
      />
    </div>
  );
}
