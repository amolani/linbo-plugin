import { Link } from 'react-router-dom';
import type { Operation } from '@/types';
import { OperationStatusBadge } from '@/components/ui';

interface RecentOperationsProps {
  operations: Operation[];
  isLoading: boolean;
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

export function RecentOperations({ operations, isLoading }: RecentOperationsProps) {
  if (isLoading) {
    return (
      <div className="bg-card shadow-sm rounded-lg">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-lg font-medium text-foreground">Letzte Operationen</h3>
        </div>
        <div className="divide-y divide-border">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="px-6 py-4 animate-pulse">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <div className="h-4 bg-border rounded w-32" />
                  <div className="h-3 bg-border rounded w-24" />
                </div>
                <div className="h-6 bg-border rounded w-20" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card shadow-sm rounded-lg">
      <div className="px-6 py-4 border-b border-border">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium text-foreground">Letzte Operationen</h3>
          <Link
            to="/operations"
            className="text-sm text-primary hover:text-primary"
          >
            Alle anzeigen
          </Link>
        </div>
      </div>
      <div className="divide-y divide-border">
        {operations.length === 0 ? (
          <div className="px-6 py-8 text-center text-muted-foreground">
            Keine Operationen vorhanden
          </div>
        ) : (
          operations.map((op) => (
            <div
              key={op.id}
              className="px-6 py-4 flex items-center justify-between hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium text-foreground">
                  {op.commands.join(', ')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {op.targetHosts.length} Host(s) - {formatDate(op.createdAt)}
                </p>
              </div>
              <div className="flex items-center space-x-4">
                {op.status === 'running' && (
                  <div className="w-24">
                    <div className="h-2 bg-border rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${op.progress}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 text-center">
                      {op.progress}%
                    </p>
                  </div>
                )}
                <OperationStatusBadge status={op.status} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
