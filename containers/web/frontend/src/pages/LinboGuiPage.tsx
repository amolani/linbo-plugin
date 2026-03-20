import { useState, useEffect } from 'react';
import { syncApi } from '@/api/sync';
import type { SyncConfig } from '@/api/sync';
import { useIconCache } from '@/hooks/useIconCache';
import { LinboGuiPreview, LinboGuiAdminPreview } from '@/components/configs';
import { notify } from '@/stores/notificationStore';
import { useServerConfigStore } from '@/stores/serverConfigStore';
import type { LinboSettings, ConfigOs } from '@/types';

type OsEntryData = Omit<ConfigOs, 'id' | 'configId'>;
type ViewMode = 'client' | 'admin';

const defaultLinboSettings: LinboSettings = {
  server: useServerConfigStore.getState().serverIp || '10.0.0.1',
  cache: '/dev/sda4',
  downloadType: 'rsync',
};

export function LinboGuiPage() {
  const [configs, setConfigs] = useState<SyncConfig[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [osEntries, setOsEntries] = useState<OsEntryData[]>([]);
  const [linboSettings, setLinboSettings] = useState<LinboSettings>(defaultLinboSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('client');
  const iconCache = useIconCache();

  useEffect(() => {
    syncApi.getConfigs()
      .then(data => {
        setConfigs(data);
        if (data.length > 0) {
          setSelectedId(data[0].id);
        }
      })
      .catch(() => notify.error('Fehler beim Laden der Konfigurationen'))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    syncApi.getConfig(selectedId)
      .then(config => {
        // SyncConfig does not have linboSettings — use defaults
        setLinboSettings(defaultLinboSettings);
        setOsEntries((config.osEntries || []) as OsEntryData[]);
      })
      .catch(() => notify.error('Fehler beim Laden der Konfiguration'));
  }, [selectedId]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">LINBO GUI Preview</h1>
        <p className="text-muted-foreground">
          Vorschau der modernisierten LINBO Client-Oberflaeche
        </p>
      </div>

      {/* Controls: Config selector + View toggle */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-foreground">Konfiguration:</label>
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className="rounded-md border border-border bg-card text-foreground px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            disabled={isLoading}
          >
            {configs.length === 0 && (
              <option value="">
                {isLoading ? 'Lade...' : 'Keine Konfigurationen'}
              </option>
            )}
            {configs.map(c => (
              <option key={c.id} value={c.id}>
                {c.name || c.id}
              </option>
            ))}
          </select>
        </div>

        {/* View mode toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setViewMode('client')}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              viewMode === 'client'
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            Start
          </button>
          <button
            onClick={() => setViewMode('admin')}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              viewMode === 'admin'
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            Imaging
          </button>
        </div>
      </div>

      {/* Preview -- centered, max-w-4xl */}
      <div className="flex justify-center">
        <div className="w-full max-w-4xl">
          {viewMode === 'client' ? (
            <LinboGuiPreview
              osEntries={osEntries}
              linboSettings={linboSettings}
              getIconUrl={iconCache.getIconUrl}
            />
          ) : (
            <LinboGuiAdminPreview
              osEntries={osEntries}
              linboSettings={linboSettings}
              getIconUrl={iconCache.getIconUrl}
            />
          )}
        </div>
      </div>

      {/* Hint */}
      <p className="text-xs text-muted-foreground text-center">
        Diese Vorschau basiert auf echten Konfigurationsdaten.
        Aenderungen im Config-Editor werden hier nach Seitenreload sichtbar.
        {viewMode === 'client'
          ? ' Systemdaten (HDD, RAM, IP) sind Platzhalter — echte Werte folgen in Phase B.'
          : ' Image-Groessen und Daten sind Platzhalter — echte Werte folgen in Phase B.'
        }
      </p>
    </div>
  );
}
