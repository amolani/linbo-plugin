import { useState } from 'react';
import { Wifi, RefreshCw, Power } from 'lucide-react';
import { Button, ConfirmModal } from '@/components/ui';
import { operationsApi } from '@/api/operations';
import { notify } from '@/stores/notificationStore';
import type { SyncHost } from '@/api/sync';

interface BulkActionBarProps {
  hostgroup: string;
  hosts: SyncHost[];
  onActionComplete?: () => void;
}

export function BulkActionBar({ hostgroup, hosts, onActionComplete }: BulkActionBarProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [showHaltConfirm, setShowHaltConfirm] = useState(false);

  const onlineCount = hosts.filter(h => h.runtimeStatus === 'online').length;
  const totalCount = hosts.length;

  const handleWakeAll = async () => {
    setLoadingAction('wake');
    try {
      await operationsApi.wake({ hostgroup });
      notify.success('Wake-on-LAN', `Magic Packets an alle ${totalCount} Hosts in "${hostgroup}" gesendet`);
      onActionComplete?.();
    } catch (error) {
      notify.error('WoL fehlgeschlagen', error instanceof Error ? error.message : 'Unbekannter Fehler');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSyncAll = async () => {
    setLoadingAction('sync');
    try {
      await operationsApi.direct({ hostgroup, commands: 'sync:1' });
      notify.success('Sync gestartet', `Alle online Hosts in "${hostgroup}" synchronisieren`);
      onActionComplete?.();
    } catch (error) {
      notify.error('Sync fehlgeschlagen', error instanceof Error ? error.message : 'Unbekannter Fehler');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleHaltAll = async () => {
    setLoadingAction('halt');
    try {
      await operationsApi.direct({ hostgroup, commands: 'halt' });
      notify.success('Herunterfahren gesendet', `Alle online Hosts in "${hostgroup}" werden heruntergefahren`);
      onActionComplete?.();
    } catch (error) {
      notify.error('Herunterfahren fehlgeschlagen', error instanceof Error ? error.message : 'Unbekannter Fehler');
    } finally {
      setLoadingAction(null);
      setShowHaltConfirm(false);
    }
  };

  return (
    <>
      <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 flex items-center justify-between sticky top-0 z-10">
        <span className="text-sm font-medium text-foreground">
          &quot;{hostgroup}&quot; &mdash; {totalCount} Hosts ({onlineCount} online)
        </span>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleWakeAll}
            loading={loadingAction === 'wake'}
            disabled={loadingAction !== null && loadingAction !== 'wake'}
          >
            <Wifi className="h-4 w-4 mr-1.5" />
            WoL alle
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={handleSyncAll}
            loading={loadingAction === 'sync'}
            disabled={onlineCount === 0 || (loadingAction !== null && loadingAction !== 'sync')}
          >
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Sync alle
          </Button>

          <Button
            size="sm"
            variant="destructive"
            onClick={() => setShowHaltConfirm(true)}
            loading={loadingAction === 'halt'}
            disabled={onlineCount === 0 || (loadingAction !== null && loadingAction !== 'halt')}
          >
            <Power className="h-4 w-4 mr-1.5" />
            Halt alle
          </Button>
        </div>
      </div>

      <ConfirmModal
        isOpen={showHaltConfirm}
        onClose={() => setShowHaltConfirm(false)}
        onConfirm={handleHaltAll}
        title="Alle herunterfahren"
        message={`Alle ${onlineCount} online Hosts in "${hostgroup}" herunterfahren?`}
        confirmLabel="Alle herunterfahren"
        variant="danger"
        loading={loadingAction === 'halt'}
      />
    </>
  );
}
