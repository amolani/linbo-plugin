import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { OperationStatusBadge } from '@/components/ui';
import { HostSessionRow } from './HostSessionRow';
import type { TrackedOperation, TrackedSession } from '@/stores/operationsTrackerStore';

interface OperationCardProps {
  operation: TrackedOperation;
}

const statusSortOrder: Record<string, number> = {
  running: 0,
  queued: 1,
  failed: 2,
  success: 3,
  cancelled: 4,
};

function sortSessions(sessions: TrackedSession[]): TrackedSession[] {
  return [...sessions].sort(
    (a, b) => (statusSortOrder[a.status] ?? 5) - (statusSortOrder[b.status] ?? 5)
  );
}

export function OperationCard({ operation }: OperationCardProps) {
  const sessions = useMemo(
    () => sortSessions(Object.values(operation.sessions)),
    [operation.sessions]
  );

  const completedCount = sessions.filter(
    (s) => s.status === 'success' || s.status === 'failed'
  ).length;

  const hasNoSessions = Object.keys(operation.sessions).length === 0;
  const isRunning = operation.status === 'running' || operation.status === 'pending';

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground text-sm">{operation.commands}</span>
        <OperationStatusBadge status={operation.status} />
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-secondary rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{ width: `${operation.progress}%` }}
        />
      </div>

      {/* Stats line */}
      <p className="text-xs text-muted-foreground">
        {completedCount} von {operation.hostCount} abgeschlossen
      </p>

      {/* Host list */}
      {hasNoSessions && isRunning ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Lade Hosts...</span>
        </div>
      ) : (
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {sessions.map((session) => (
            <HostSessionRow key={session.hostname} session={session} />
          ))}
        </div>
      )}
    </div>
  );
}
