import { useState, useEffect, useCallback } from 'react';
import { Eye } from 'lucide-react';
import { syncApi } from '@/api/sync';
import type { SyncConfig } from '@/api/sync';
import { useDataInvalidation } from '@/hooks/useDataInvalidation';
import { useServerConfigStore } from '@/stores/serverConfigStore';
import { Button, Table, Modal, Badge } from '@/components/ui';
import { notify } from '@/stores/notificationStore';
import type { Column } from '@/types';

export function ConfigsPage() {
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

  return <SyncConfigsView />;
}

// ============================================================================
// Sync Mode: read-only configs from LMN server
// ============================================================================

function SyncConfigsView() {
  const [configs, setConfigs] = useState<SyncConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  const [previewName, setPreviewName] = useState('');

  const fetchConfigs = useCallback(async () => {
    try {
      const data = await syncApi.getConfigs();
      setConfigs(data);
    } catch (error) {
      notify.error('Fehler beim Laden der Konfigurationen');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useDataInvalidation(['sync', 'config'], fetchConfigs, { showToast: false });

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  const handlePreview = async (config: SyncConfig) => {
    try {
      const content = await syncApi.getConfigPreview(config.id);
      setPreviewContent(content);
      setPreviewName(config.name || config.id);
      setPreviewOpen(true);
    } catch (error) {
      notify.error('Fehler beim Laden der Vorschau');
    }
  };

  const columns: Column<SyncConfig>[] = [
    {
      key: 'id',
      header: 'ID',
      render: (config) => (
        <span className="font-mono text-sm">{config.id}</span>
      ),
    },
    {
      key: 'name',
      header: 'Name / Gruppe',
      render: (config) => config.name || '-',
    },
    {
      key: 'osEntries',
      header: 'Betriebssysteme',
      render: (config) => config.osEntries?.length ?? 0,
    },
    {
      key: 'partitions',
      header: 'Partitionen',
      render: (config) => config.partitions?.length ?? 0,
    },
    {
      key: 'actions',
      header: 'Aktionen',
      render: (config) => (
        <button
          onClick={() => handlePreview(config)}
          className="text-primary hover:text-primary/80 flex items-center gap-1 text-sm"
        >
          <Eye className="h-4 w-4" />
          Vorschau
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            Konfigurationen
            <Badge variant="info" size="sm">Synchronisiert von LMN</Badge>
          </h1>
          <p className="text-muted-foreground">
            start.conf Konfigurationen vom linuxmuster.net Server
          </p>
        </div>
      </div>

      <div className="bg-card shadow-sm rounded-lg overflow-hidden">
        <Table
          columns={columns}
          data={configs}
          keyExtractor={(config) => config.id}
          loading={isLoading}
          emptyMessage="Keine Konfigurationen synchronisiert"
        />
      </div>

      {/* Preview Modal */}
      <Modal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={`start.conf Vorschau: ${previewName}`}
        size="lg"
      >
        <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm font-mono max-h-96">
          {previewContent}
        </pre>
        <div className="flex justify-end pt-4">
          <Button variant="secondary" onClick={() => setPreviewOpen(false)}>
            Schliessen
          </Button>
        </div>
      </Modal>
    </div>
  );
}
