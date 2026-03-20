import type { Host, Column } from '@/types';
import { Table, Pagination, StatusBadge } from '@/components/ui';

interface HostTableProps {
  hosts: Host[];
  selectedHosts: string[];
  isLoading: boolean;
  sort: string;
  order: 'asc' | 'desc';
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onSort: (key: string) => void;
  onSelect: (id: string) => void;
  onSelectAll: () => void;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
  onWakeOnLan: (id: string) => void;
  onSync: (id: string) => void;
  onStart: (id: string) => void;
  onEdit: (host: Host) => void;
  onDelete: (host: Host) => void;
  isActionLoading: boolean;
}

export function HostTable({
  hosts,
  selectedHosts,
  isLoading,
  sort,
  order,
  page,
  totalPages,
  total,
  limit,
  onSort,
  onSelect,
  onSelectAll,
  onPageChange,
  onLimitChange,
  onWakeOnLan,
  onSync,
  onStart,
  onEdit,
  onDelete,
  isActionLoading,
}: HostTableProps) {
  const columns: Column<Host>[] = [
    {
      key: 'hostname',
      header: 'Hostname',
      sortable: true,
      render: (host) => (
        <div>
          <div className="font-medium text-foreground">{host.hostname}</div>
          <div className="text-muted-foreground text-xs">{host.macAddress}</div>
        </div>
      ),
    },
    {
      key: 'ipAddress',
      header: 'IP-Adresse',
      sortable: true,
      render: (host) => host.ipAddress || '-',
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (host) => <StatusBadge status={host.status} />,
    },
    {
      key: 'room',
      header: 'Raum',
      render: (host) => host.room?.name || '-',
    },
    {
      key: 'config',
      header: 'Konfiguration',
      render: (host) => host.config?.name || '-',
    },
    {
      key: 'actions',
      header: 'Aktionen',
      render: (host) => (
        <div className="flex space-x-2">
          <button
            onClick={() => onWakeOnLan(host.id)}
            className="text-primary hover:text-primary text-sm"
            disabled={isActionLoading}
          >
            WoL
          </button>
          <button
            onClick={() => onSync(host.id)}
            className="text-primary hover:text-primary text-sm"
            disabled={isActionLoading || host.status !== 'online'}
          >
            Sync
          </button>
          <button
            onClick={() => onStart(host.id)}
            className="text-primary hover:text-primary text-sm"
            disabled={isActionLoading || host.status !== 'online'}
          >
            Start
          </button>
          <button
            onClick={() => onEdit(host)}
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            Bearbeiten
          </button>
          <button
            onClick={() => onDelete(host)}
            className="text-destructive hover:text-destructive text-sm"
          >
            Löschen
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="bg-card shadow-sm rounded-lg overflow-hidden">
      <Table
        columns={columns}
        data={hosts}
        keyExtractor={(host) => host.id}
        loading={isLoading}
        selectable
        selectedKeys={selectedHosts}
        onSelect={onSelect}
        onSelectAll={onSelectAll}
        sortKey={sort}
        sortOrder={order}
        onSort={onSort}
        emptyMessage="Keine Hosts gefunden"
      />
      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        limit={limit}
        onPageChange={onPageChange}
        onLimitChange={onLimitChange}
      />
    </div>
  );
}
