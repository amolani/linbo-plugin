import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDataInvalidation } from '@/hooks/useDataInvalidation';
import { useServerConfigStore } from '@/stores/serverConfigStore';
import { syncApi } from '@/api/sync';
import type { SyncHost } from '@/api/sync';
import { operationsApi } from '@/api/operations';
import type { ScheduledCommand } from '@/api/operations';
import { Button, Table, StatusBadge, Input, Select, Badge } from '@/components/ui';
import { QuickActionsDropdown, BulkActionBar, ScheduledBadge } from '@/components/hosts';
import type { Column } from '@/types';

export function HostsPage() {
  const { modeFetched, fetchMode } = useServerConfigStore();

  useEffect(() => {
    fetchMode();
  }, [fetchMode]);

  if (!modeFetched) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return <SyncHostsView />;
}

// ============================================================================
// Sync Mode: read-only hosts from LMN server
// ============================================================================

function SyncHostsView() {
  const [hosts, setHosts] = useState<SyncHost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [hostgroup, setHostgroup] = useState('');
  const [hostgroups, setHostgroups] = useState<string[]>([]);
  const [scheduledMap, setScheduledMap] = useState<Map<string, ScheduledCommand>>(new Map());

  const fetchHosts = useCallback(async () => {
    try {
      const params: { search?: string; hostgroup?: string } = {};
      if (search) params.search = search;
      if (hostgroup) params.hostgroup = hostgroup;
      const data = await syncApi.getHosts(params);
      setHosts(data);
      // Derive unique hostgroups for filter
      const groups = [...new Set(data.map((h) => h.hostgroup).filter(Boolean))];
      setHostgroups((prev) => (prev.length === 0 ? groups : prev));
    } catch (error) {
      console.error('Failed to fetch sync hosts:', error);
    } finally {
      setIsLoading(false);
    }
  }, [search, hostgroup]);

  const fetchScheduled = useCallback(async () => {
    try {
      const scheduled = await operationsApi.listScheduled();
      setScheduledMap(new Map(scheduled.map(s => [s.hostname, s])));
    } catch (error) {
      console.error('Failed to fetch scheduled commands:', error);
    }
  }, []);

  useDataInvalidation(['sync', 'host'], fetchHosts, { showToast: false });

  useEffect(() => {
    fetchHosts();
    fetchScheduled();
  }, [fetchHosts, fetchScheduled]);

  const handleActionComplete = useCallback(() => {
    fetchHosts();
    fetchScheduled();
  }, [fetchHosts, fetchScheduled]);

  const filteredHostsForBulk = useMemo(() => {
    if (!hostgroup) return [];
    return hosts.filter(h => h.hostgroup === hostgroup);
  }, [hosts, hostgroup]);

  const columns: Column<SyncHost>[] = [
    {
      key: 'hostname',
      header: 'Hostname',
      render: (host) => (
        <div>
          <div className="font-medium text-foreground">{host.hostname}</div>
          <div className="text-muted-foreground text-xs">{host.mac}</div>
        </div>
      ),
    },
    {
      key: 'ip',
      header: 'IP-Adresse',
      render: (host) => host.ip || '-',
    },
    {
      key: 'hostgroup',
      header: 'Gruppe',
      render: (host) => host.hostgroup || '-',
    },
    {
      key: 'runtimeStatus',
      header: 'Status',
      render: (host) => <StatusBadge status={host.runtimeStatus} />,
    },
    {
      key: 'scheduled',
      header: 'Geplant',
      render: (host) => {
        const cmd = scheduledMap.get(host.hostname);
        if (!cmd) return null;
        return (
          <ScheduledBadge
            hostname={host.hostname}
            command={cmd}
            onCancelled={fetchScheduled}
          />
        );
      },
    },
    {
      key: 'actions',
      header: '',
      render: (host) => (
        <QuickActionsDropdown
          host={host}
          onActionComplete={handleActionComplete}
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            Hosts
            <Badge variant="info" size="sm">Verwaltet durch LMN Server</Badge>
          </h1>
          <p className="text-muted-foreground">Hosts vom linuxmuster.net Server</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card shadow-sm rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input
            placeholder="Suche..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            value={hostgroup}
            onChange={(e) => setHostgroup(e.target.value)}
            options={[
              { value: '', label: 'Alle Gruppen' },
              ...hostgroups.map((g) => ({ value: g, label: g })),
            ]}
          />
          <Button
            variant="secondary"
            onClick={() => { setSearch(''); setHostgroup(''); }}
          >
            Filter zuruecksetzen
          </Button>
        </div>
      </div>

      {/* Bulk Action Bar */}
      {hostgroup && filteredHostsForBulk.length > 0 && (
        <BulkActionBar
          hostgroup={hostgroup}
          hosts={filteredHostsForBulk}
          onActionComplete={handleActionComplete}
        />
      )}

      {/* Table */}
      <div className="bg-card shadow-sm rounded-lg">
        <Table
          columns={columns}
          data={hosts}
          keyExtractor={(host) => host.mac}
          loading={isLoading}
          emptyMessage="Keine Hosts gefunden"
        />
      </div>
    </div>
  );
}
