import { useState } from 'react';
import { Clock } from 'lucide-react';
import { Badge, ConfirmModal } from '@/components/ui';
import { operationsApi } from '@/api/operations';
import type { ScheduledCommand } from '@/api/operations';
import { notify } from '@/stores/notificationStore';

interface ScheduledBadgeProps {
  hostname: string;
  command: ScheduledCommand;
  onCancelled?: () => void;
}

export function ScheduledBadge({ hostname, command, onCancelled }: ScheduledBadgeProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const handleCancel = async () => {
    setIsCancelling(true);
    try {
      await operationsApi.cancelScheduled(hostname);
      notify.success('Befehl abgebrochen', `Geplanter Befehl "${command.commands}" fuer "${hostname}" abgebrochen`);
      onCancelled?.();
    } catch (error) {
      notify.error('Fehler', error instanceof Error ? error.message : 'Unbekannter Fehler');
    } finally {
      setIsCancelling(false);
      setShowConfirm(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="cursor-pointer hover:opacity-80 transition-opacity"
        title="Klicken zum Abbrechen"
        onClick={() => setShowConfirm(true)}
      >
        <Badge variant="warning" size="sm">
          <Clock className="h-3 w-3 mr-1 inline" />
          {command.commands}
        </Badge>
      </button>

      <ConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleCancel}
        title="Geplanten Befehl abbrechen"
        message={`Befehl "${command.commands}" fuer "${hostname}" abbrechen?`}
        confirmLabel="Abbrechen"
        variant="warning"
        loading={isCancelling}
      />
    </>
  );
}
