import { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Plus,
  Wifi,
  Monitor,
  Cable,
  Bluetooth,
  Package,
  RefreshCw,
} from 'lucide-react';
import { systemApi } from '@/api/system';
import { syncApi } from '@/api/sync';
import type { FirmwareDetectionResult, DetectedDriver } from '@/api/system';
import type { SyncHost } from '@/api/sync';

const CATEGORY_ICONS: Record<string, typeof Wifi> = {
  wifi: Wifi,
  ethernet: Cable,
  gpu: Monitor,
  bluetooth: Bluetooth,
};

interface FirmwareDetectProps {
  configuredEntries: Set<string>;
  onEntriesAdded: () => void;
}

export function FirmwareDetect({ configuredEntries, onEntriesAdded }: FirmwareDetectProps) {
  const [hostIp, setHostIp] = useState('');
  const [onlineHosts, setOnlineHosts] = useState<SyncHost[]>([]);
  const [loadingHosts, setLoadingHosts] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<FirmwareDetectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingEntries, setAddingEntries] = useState<Set<string>>(new Set());
  const [bulkAdding, setBulkAdding] = useState(false);

  const loadOnlineHosts = useCallback(async () => {
    setLoadingHosts(true);
    try {
      const allHosts = await syncApi.getHosts();
      setOnlineHosts(allHosts.filter(h => h.runtimeStatus === 'online'));
    } catch {
      setOnlineHosts([]);
    } finally {
      setLoadingHosts(false);
    }
  }, []);

  useEffect(() => {
    loadOnlineHosts();
  }, [loadOnlineHosts]);

  const handleScan = async () => {
    if (!hostIp.trim()) return;
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      const data = await systemApi.detectFirmware(hostIp.trim());
      setResult(data);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
        setError(axiosErr.response?.data?.error?.message || 'Scan fehlgeschlagen');
      } else {
        setError(err instanceof Error ? err.message : 'Scan fehlgeschlagen');
      }
    } finally {
      setScanning(false);
    }
  };

  const handleAddSingle = async (entry: string) => {
    setAddingEntries(prev => new Set(prev).add(entry));
    try {
      await systemApi.addFirmwareEntry(entry);
      onEntriesAdded();
      if (hostIp.trim()) {
        const data = await systemApi.detectFirmware(hostIp.trim());
        setResult(data);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Hinzufuegen fehlgeschlagen';
      setError(msg);
    } finally {
      setAddingEntries(prev => {
        const next = new Set(prev);
        next.delete(entry);
        return next;
      });
    }
  };

  const handleBulkAdd = async () => {
    if (!result) return;
    const entriesToAdd: string[] = [];
    const seen = new Set<string>();
    for (const driver of result.detectedDrivers) {
      for (const file of driver.firmwareFiles) {
        if (!file.alreadyConfigured && file.availableOnDisk && !seen.has(file.suggestedEntry)) {
          seen.add(file.suggestedEntry);
          entriesToAdd.push(file.suggestedEntry);
        }
      }
    }
    if (entriesToAdd.length === 0) return;

    setBulkAdding(true);
    try {
      await systemApi.bulkAddFirmwareEntries(entriesToAdd);
      onEntriesAdded();
      if (hostIp.trim()) {
        const data = await systemApi.detectFirmware(hostIp.trim());
        setResult(data);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Bulk-Add fehlgeschlagen';
      setError(msg);
    } finally {
      setBulkAdding(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Description */}
      <p className="text-sm text-muted-foreground">
        Verbindet sich per SSH mit einem LINBO-Client, liest fehlende Firmware aus <code className="text-xs bg-secondary px-1 py-0.5 rounded">dmesg</code> aus und gleicht sie mit dem Katalog ab.
      </p>

      {/* IP Input + Host Picker + Scan Button */}
      <div className="flex items-center space-x-2">
        <input
          type="text"
          placeholder="Client-IP (z.B. 10.0.152.111)"
          value={hostIp}
          onChange={(e) => setHostIp(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleScan()}
          className="flex-1 px-3 py-2 bg-secondary border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {onlineHosts.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) setHostIp(e.target.value);
            }}
            className="px-3 py-2 bg-secondary border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">
              {loadingHosts ? 'Lade...' : `Online-Hosts (${onlineHosts.length})`}
            </option>
            {onlineHosts.map(h => (
              <option key={h.mac} value={h.ip || ''}>
                {h.hostname} ({h.ip})
              </option>
            ))}
          </select>
        )}
        <button
          onClick={handleScan}
          disabled={!hostIp.trim() || scanning}
          className="flex items-center space-x-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {scanning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          <span>{scanning ? 'Scanne...' : 'Scannen'}</span>
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
            <button
              onClick={handleScan}
              disabled={scanning}
              className="text-xs text-destructive hover:underline"
            >
              Erneut versuchen
            </button>
          </div>
        </div>
      )}

      {/* Scanning indicator */}
      {scanning && (
        <div className="flex items-center space-x-2 py-4 justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Verbinde mit {hostIp} und lese dmesg...</span>
        </div>
      )}

      {/* Results */}
      {result && !scanning && (
        <div className="space-y-4">
          {result.summary.totalMissingFiles === 0 ? (
            <div className="p-4 bg-ciGreen/10 border border-ciGreen/20 rounded-md">
              <div className="flex items-center space-x-2">
                <CheckCircle className="h-5 w-5 text-ciGreen" />
                <div>
                  <p className="text-sm font-medium text-ciGreen">Keine fehlende Firmware erkannt</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Der Client {result.host} hat keine Firmware-Fehler in dmesg.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Summary Bar */}
              <div className="flex items-center justify-between p-3 bg-secondary/50 border border-border rounded-md">
                <div className="text-sm text-foreground">
                  <span className="font-medium">{result.summary.totalMissingFiles}</span> fehlende Firmware-Datei{result.summary.totalMissingFiles !== 1 ? 'en' : ''}
                  {result.summary.availableToAdd > 0 && (
                    <span className="text-ciGreen ml-1">
                      &middot; {result.summary.availableToAdd} hinzufuegbar
                    </span>
                  )}
                  {result.summary.alreadyConfigured > 0 && (
                    <span className="text-muted-foreground ml-1">
                      &middot; {result.summary.alreadyConfigured} bereits konfiguriert
                    </span>
                  )}
                </div>
                {result.summary.availableToAdd > 0 && (
                  <button
                    onClick={handleBulkAdd}
                    disabled={bulkAdding}
                    className="flex items-center space-x-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {bulkAdding ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    <span>Alle hinzufuegen ({result.summary.availableToAdd})</span>
                  </button>
                )}
              </div>

              {/* Driver List */}
              <div className="space-y-2">
                {result.detectedDrivers.map((driver) => (
                  <DriverCard
                    key={driver.driver}
                    driver={driver}
                    addingEntries={addingEntries}
                    configuredEntries={configuredEntries}
                    onAdd={handleAddSingle}
                  />
                ))}
              </div>
            </>
          )}

          {/* Rescan */}
          <div className="flex justify-end">
            <button
              onClick={handleScan}
              disabled={scanning}
              className="flex items-center space-x-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
              <span>Erneut scannen</span>
            </button>
          </div>
        </div>
      )}

      {/* Empty state (before first scan) */}
      {!result && !scanning && !error && (
        <div className="text-center py-8 text-muted-foreground">
          <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>IP-Adresse eines LINBO-Clients eingeben und scannen.</p>
          <p className="text-xs mt-1">Der Client muss online und per SSH erreichbar sein (Port 2222).</p>
        </div>
      )}
    </div>
  );
}

function DriverCard({
  driver,
  addingEntries,
  configuredEntries,
  onAdd,
}: {
  driver: DetectedDriver;
  addingEntries: Set<string>;
  configuredEntries: Set<string>;
  onAdd: (entry: string) => void;
}) {
  const Icon = driver.category ? (CATEGORY_ICONS[driver.category] || Package) : Package;

  return (
    <div className="border border-border rounded-lg p-3">
      {/* Driver Header */}
      <div className="flex items-center space-x-2 mb-2">
        <Icon className="h-4 w-4 text-primary flex-shrink-0" />
        <span className="text-sm font-medium text-foreground">{driver.driver}</span>
        {driver.catalogVendor && (
          <span className="text-xs text-muted-foreground">({driver.catalogVendor})</span>
        )}
        {driver.category && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-primary rounded">
            {driver.category}
          </span>
        )}
      </div>

      {/* File List */}
      <div className="space-y-1 ml-6">
        {driver.firmwareFiles.map((file) => {
          const isConfigured = file.alreadyConfigured || configuredEntries.has(file.suggestedEntry);
          const isAdding = addingEntries.has(file.suggestedEntry);

          return (
            <div key={file.filename} className="flex items-center justify-between py-1 group">
              <span className="text-xs font-mono text-foreground truncate">{file.filename}</span>
              <div className="flex items-center space-x-2 flex-shrink-0 ml-2">
                {!file.availableOnDisk && (
                  <span className="text-yellow-500 flex items-center space-x-1" title="Nicht auf Disk vorhanden">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span className="text-[10px]">nicht vorhanden</span>
                  </span>
                )}
                {isConfigured ? (
                  <span className="text-ciGreen flex items-center space-x-1">
                    <CheckCircle className="h-3.5 w-3.5" />
                    <span className="text-[10px] font-medium">konfiguriert</span>
                  </span>
                ) : file.availableOnDisk ? (
                  <button
                    onClick={() => onAdd(file.suggestedEntry)}
                    disabled={isAdding}
                    className="flex items-center space-x-1 px-2 py-0.5 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors disabled:opacity-50"
                  >
                    {isAdding ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}
                    <span>Hinzufuegen</span>
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">nicht verfuegbar</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
