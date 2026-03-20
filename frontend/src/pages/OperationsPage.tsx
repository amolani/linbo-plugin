import { useState, useEffect, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { operationsApi } from '@/api/operations';
import { Table, Pagination, OperationStatusBadge, Modal, Button, Select } from '@/components/ui';
import { RemoteCommandModal, ScheduledCommandsSection } from '@/components/operations';
import { notify } from '@/stores/notificationStore';
import { useServerConfigStore } from '@/stores/serverConfigStore';
import { useWsEventHandler, getEventData } from '@/hooks/useWebSocket';
import { useDataInvalidation } from '@/hooks/useDataInvalidation';
import type { Operation, Session, Column, WsOperationProgressEvent } from '@/types';

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(start: string, end?: string): string {
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  const diff = endDate.getTime() - startDate.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function OperationsPage() {
  const [operations, setOperations] = useState<Operation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalPages, setTotalPages] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedOperation, setSelectedOperation] = useState<Operation | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isRemoteModalOpen, setIsRemoteModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'operations' | 'scheduled'>('operations');
  const { isSyncMode } = useServerConfigStore();

  const fetchOperations = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await operationsApi.list({
        page,
        limit,
        status: statusFilter || undefined,
      });
      setOperations(data.data || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 0);
    } catch (error) {
      console.error('Operations fetch error:', error);
      setOperations([]);
      setTotal(0);
      setTotalPages(0);
    } finally {
      setIsLoading(false);
    }
  }, [page, limit, statusFilter]);

  useEffect(() => {
    fetchOperations();
  }, [fetchOperations]);

  // Listen for real-time progress updates (AC3: direct state update, no refetch)
  useWsEventHandler<WsOperationProgressEvent>('operation.progress', (event) => {
    const data = getEventData(event) as WsOperationProgressEvent['data'];
    setOperations((prev) =>
      prev.map((op) =>
        op.id === data.operationId ? { ...op, progress: data.progress, stats: data.stats } : op
      )
    );
  });

  // Reactive: refetch on operation lifecycle events (NOT progress — AC3)
  const { suppress: suppressOpInvalidation } = useDataInvalidation('operation', fetchOperations, { showToast: false });

  const handleViewDetails = async (operationId: string) => {
    try {
      const operation = await operationsApi.get(operationId);
      setSelectedOperation(operation);
      setIsDetailOpen(true);
    } catch (error) {
      notify.error('Fehler beim Laden der Details');
    }
  };

  const handleCancel = async (operationId: string) => {
    try {
      suppressOpInvalidation();
      await operationsApi.cancel(operationId);
      notify.success('Operation abgebrochen');
      fetchOperations();
    } catch (error) {
      notify.error('Fehler beim Abbrechen');
    }
  };

  const columns: Column<Operation>[] = [
    {
      key: 'id',
      header: 'ID',
      render: (op) => (
        <span className="font-mono text-xs">{op.id.substring(0, 8)}</span>
      ),
    },
    {
      key: 'commands',
      header: 'Befehle',
      render: (op) => (
        <span className="font-medium">{op.commands.join(', ')}</span>
      ),
    },
    {
      key: 'hosts',
      header: 'Hosts',
      render: (op) => op.targetHosts.length,
    },
    {
      key: 'status',
      header: 'Status',
      render: (op) => <OperationStatusBadge status={op.status} />,
    },
    {
      key: 'progress',
      header: 'Fortschritt',
      render: (op) => (
        <div className="w-24">
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                op.status === 'failed' ? 'bg-destructive' : 'bg-primary'
              }`}
              style={{ width: `${op.progress}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">{op.progress}%</span>
        </div>
      ),
    },
    {
      key: 'createdAt',
      header: 'Gestartet',
      render: (op) => (
        <div>
          <div>{formatDate(op.createdAt)}</div>
          {op.startedAt && (
            <div className="text-xs text-muted-foreground">
              Dauer: {formatDuration(op.startedAt, op.completedAt || undefined)}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Aktionen',
      render: (op) => (
        <div className="flex space-x-2">
          <button
            onClick={() => handleViewDetails(op.id)}
            className="text-primary hover:text-primary/80 text-sm"
          >
            Details
          </button>
          {(op.status === 'pending' || op.status === 'running') && (
            <button
              onClick={() => handleCancel(op.id)}
              className="text-destructive hover:text-destructive/80 text-sm"
            >
              Abbrechen
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">Operationen</h1>
            {isSyncMode && (
              <span className="px-2 py-0.5 text-xs font-medium rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                Sync-Modus
              </span>
            )}
          </div>
          <p className="text-muted-foreground">Remote-Befehle und Operationsübersicht</p>
        </div>
        <Button onClick={() => setIsRemoteModalOpen(true)}>
          <Plus className="h-5 w-5 mr-2" />
          Remote-Befehl
        </Button>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('operations')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'operations'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            Operationen
          </button>
          <button
            onClick={() => setActiveTab('scheduled')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'scheduled'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            Geplante Befehle
          </button>
        </nav>
      </div>

      {activeTab === 'operations' ? (
        <>
          {/* Filters */}
          <div className="bg-card shadow-sm rounded-lg p-4">
            <div className="flex items-center space-x-4">
              <Select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                options={[
                  { value: '', label: 'Alle Status' },
                  { value: 'pending', label: 'Ausstehend' },
                  { value: 'running', label: 'Läuft' },
                  { value: 'completed', label: 'Abgeschlossen' },
                  { value: 'failed', label: 'Fehlgeschlagen' },
                  { value: 'cancelled', label: 'Abgebrochen' },
                ]}
              />
              <Button variant="secondary" onClick={fetchOperations}>
                Aktualisieren
              </Button>
            </div>
          </div>

          {/* Empty State or Table */}
          {!isLoading && operations.length === 0 ? (
            <div className="bg-card shadow-sm rounded-lg p-12 text-center">
              <div className="text-muted-foreground space-y-2">
                <p className="text-lg font-medium">Noch keine Operationen</p>
                <p className="text-sm">
                  Remote-Befehle die ueber die Host-Seite oder den Button oben ausgefuehrt werden, erscheinen hier als Audit-Log.
                </p>
                <p className="text-xs mt-4">
                  Starte einen Befehl ueber <strong>Hosts</strong> → Quick Actions oder klicke oben auf <strong>Remote-Befehl</strong>.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-card shadow-sm rounded-lg overflow-hidden">
              <Table
                columns={columns}
                data={operations}
                keyExtractor={(op) => op.id}
                loading={isLoading}
                emptyMessage="Keine Operationen gefunden"
              />
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                limit={limit}
                onPageChange={setPage}
                onLimitChange={setLimit}
              />
            </div>
          )}
        </>
      ) : (
        <ScheduledCommandsSection />
      )}

      {/* Detail Modal */}
      <Modal
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        title="Operation Details"
        size="lg"
      >
        {selectedOperation && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Status</dt>
                <dd className="mt-1">
                  <OperationStatusBadge status={selectedOperation.status} />
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Fortschritt</dt>
                <dd className="mt-1 text-sm text-foreground">
                  {selectedOperation.progress}%
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Befehle</dt>
                <dd className="mt-1 text-sm text-foreground">
                  {selectedOperation.commands.join(', ')}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Gestartet</dt>
                <dd className="mt-1 text-sm text-foreground">
                  {formatDate(selectedOperation.createdAt)}
                </dd>
              </div>
            </div>

            {selectedOperation.stats && (
              <div className="border-t border-border pt-4">
                <h4 className="font-medium text-foreground mb-3">Statistiken</h4>
                <div className="grid grid-cols-4 gap-4 text-center">
                  <div className="bg-secondary rounded p-3">
                    <div className="text-2xl font-bold text-foreground">
                      {selectedOperation.stats.total}
                    </div>
                    <div className="text-xs text-muted-foreground">Gesamt</div>
                  </div>
                  <div className="bg-primary/10 rounded p-3">
                    <div className="text-2xl font-bold text-primary">
                      {selectedOperation.stats.inProgress}
                    </div>
                    <div className="text-xs text-muted-foreground">Laufend</div>
                  </div>
                  <div className="bg-ciGreen/20 rounded p-3">
                    <div className="text-2xl font-bold text-ciGreen">
                      {selectedOperation.stats.completed}
                    </div>
                    <div className="text-xs text-muted-foreground">Abgeschlossen</div>
                  </div>
                  <div className="bg-destructive/10 rounded p-3">
                    <div className="text-2xl font-bold text-destructive">
                      {selectedOperation.stats.failed}
                    </div>
                    <div className="text-xs text-muted-foreground">Fehlgeschlagen</div>
                  </div>
                </div>
              </div>
            )}

            {selectedOperation.sessions && selectedOperation.sessions.length > 0 && (
              <div className="border-t border-border pt-4">
                <h4 className="font-medium text-foreground mb-3">Sessions</h4>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {selectedOperation.sessions.map((session: Session) => (
                    <div
                      key={session.id}
                      className="flex items-center justify-between p-3 bg-secondary rounded"
                    >
                      <div>
                        <span className="font-medium">
                          {session.hostname || session.hostId?.substring(0, 8)}
                        </span>
                      </div>
                      <div className="flex items-center space-x-3">
                        <div className="w-20">
                          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${session.progress}%` }}
                            />
                          </div>
                        </div>
                        <OperationStatusBadge status={session.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-4 border-t border-border">
              <Button variant="secondary" onClick={() => setIsDetailOpen(false)}>
                Schließen
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Remote Command Modal */}
      <RemoteCommandModal
        isOpen={isRemoteModalOpen}
        onClose={() => setIsRemoteModalOpen(false)}
        onSuccess={() => {
          fetchOperations();
          if (activeTab === 'scheduled') {
            // Will auto-refresh via the ScheduledCommandsSection
          }
        }}
      />
    </div>
  );
}
