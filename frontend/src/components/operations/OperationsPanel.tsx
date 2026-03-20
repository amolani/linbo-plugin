import { useMemo } from 'react';
import { Modal } from '@/components/ui';
import { Button } from '@/components/ui';
import { useOperationsTrackerStore } from '@/stores/operationsTrackerStore';
import { OperationCard } from './OperationCard';
import type { TrackedOperation } from '@/stores/operationsTrackerStore';

const statusSortOrder: Record<string, number> = {
  running: 0,
  pending: 1,
  cancelling: 2,
  completed_with_errors: 3,
  completed: 4,
  failed: 5,
  cancelled: 6,
};

function sortOperations(operations: Record<string, TrackedOperation>): TrackedOperation[] {
  return Object.values(operations).sort(
    (a, b) => (statusSortOrder[a.status] ?? 7) - (statusSortOrder[b.status] ?? 7)
  );
}

export function OperationsPanel() {
  const isPanelOpen = useOperationsTrackerStore((s) => s.isPanelOpen);
  const closePanel = useOperationsTrackerStore((s) => s.closePanel);
  const operations = useOperationsTrackerStore((s) => s.operations);
  const clearCompleted = useOperationsTrackerStore((s) => s.clearCompleted);

  const sortedOperations = useMemo(() => sortOperations(operations), [operations]);

  const hasCompleted = useMemo(
    () =>
      Object.values(operations).some(
        (op) =>
          op.status === 'completed' ||
          op.status === 'failed' ||
          op.status === 'cancelled' ||
          op.status === 'completed_with_errors'
      ),
    [operations]
  );

  const isEmpty = sortedOperations.length === 0;

  return (
    <Modal isOpen={isPanelOpen} onClose={closePanel} title="Operationen" size="lg">
      {isEmpty ? (
        <div className="py-8 text-center text-muted-foreground text-sm">
          Keine aktiven Operationen
        </div>
      ) : (
        <div className="space-y-4">
          {sortedOperations.map((op) => (
            <OperationCard key={op.id} operation={op} />
          ))}
        </div>
      )}

      {hasCompleted && (
        <div className="mt-4 flex justify-end border-t border-border pt-4">
          <Button variant="secondary" size="sm" onClick={clearCompleted}>
            Abgeschlossene entfernen
          </Button>
        </div>
      )}
    </Modal>
  );
}
