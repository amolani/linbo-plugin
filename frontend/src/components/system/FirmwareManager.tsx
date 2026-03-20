import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  Plus,
  Trash2,
  Search,
  Folder,
  FileText,
  Package,
  ChevronDown,
  ChevronRight,
  Cable,
  Monitor,
  Bluetooth,
  Wifi,
  Hammer,
  Lightbulb,
  Sparkles,
} from 'lucide-react';
import { systemApi } from '@/api/system';
import { useWsStore } from '@/stores/wsStore';
import type { FirmwareStatus, FirmwareEntry, FirmwareCatalogCategory, FirmwareCatalogVendor, FirmwareCatalogEntry } from '@/types';
import { ConfirmModal } from '@/components/ui';
import { WlanConfig } from './WlanConfig';
import { FirmwareDetect } from './FirmwareDetect';

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '-';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

const CATEGORY_ICONS: Record<string, typeof Wifi> = {
  wifi: Wifi,
  ethernet: Cable,
  gpu: Monitor,
  bluetooth: Bluetooth,
  autoscan: Search,
};

const TAB_ORDER = ['wifi', 'ethernet', 'gpu', 'bluetooth', 'manual', 'autoscan'];

export function FirmwareManager() {
  const [status, setStatus] = useState<FirmwareStatus | null>(null);
  const [catalog, setCatalog] = useState<FirmwareCatalogCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('wifi');

  // Manual tab state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addingEntry, setAddingEntry] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<FirmwareEntry | null>(null);
  const [manualEntry, setManualEntry] = useState('');

  // Catalog expansion
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());
  const [expandedData, setExpandedData] = useState<Record<string, FirmwareCatalogEntry>>({});
  const [loadingExpand, setLoadingExpand] = useState<string | null>(null);
  const [prefixSearch, setPrefixSearch] = useState<Record<string, string>>({});
  const [bulkAdding, setBulkAdding] = useState<string | null>(null);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [rebuildSuccess, setRebuildSuccess] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [addingRecommended, setAddingRecommended] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [statusData, catalogData] = await Promise.all([
        systemApi.getFirmwareStatus(),
        systemApi.getFirmwareCatalog(),
      ]);
      setStatus(statusData);
      setCatalog(catalogData);
      setError(null);
    } catch {
      setError('Daten konnten nicht geladen werden');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const { subscribe } = useWsStore();
  useEffect(() => {
    const unsubs = [
      subscribe('system.firmware_changed', () => fetchData()),
      subscribe('system.kernel_switched', () => fetchData()),
      subscribe('system.kernel_switch_started', () => fetchData()),
      subscribe('system.wlan_changed', () => fetchData()),
    ];
    return () => unsubs.forEach(fn => fn());
  }, [subscribe, fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Manual search
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const results = await systemApi.searchAvailableFirmware(query);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleAdd = async (entry: string) => {
    setAddingEntry(entry);
    try {
      await systemApi.addFirmwareEntry(entry);
      fetchData();
      setSearchResults(prev => prev.filter(r => r !== entry && r !== entry + '/'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Hinzufuegen fehlgeschlagen';
      setError(msg);
    } finally {
      setAddingEntry(null);
    }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    try {
      await systemApi.removeFirmwareEntry(removeTarget.entry);
      setRemoveTarget(null);
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Entfernen fehlgeschlagen';
      setError(msg);
      setRemoveTarget(null);
    }
  };

  const handleManualAdd = async () => {
    const entry = manualEntry.trim();
    if (!entry) return;
    await handleAdd(entry);
    setManualEntry('');
  };

  const handleRebuild = async () => {
    setIsRebuilding(true);
    setError(null);
    setRebuildSuccess(null);
    try {
      const result = await systemApi.updateLinbofs();
      if (result.success) {
        setRebuildSuccess('linbofs64 erfolgreich neu gebaut.');
      } else {
        setError('linbofs64 Build fehlgeschlagen.');
      }
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Rebuild fehlgeschlagen';
      setError(msg);
    } finally {
      setIsRebuilding(false);
    }
  };

  // Vendor expand (loads expandedFiles for prefix entries)
  const toggleVendor = async (vendorId: string) => {
    const newExpanded = new Set(expandedVendors);
    if (newExpanded.has(vendorId)) {
      newExpanded.delete(vendorId);
      setExpandedVendors(newExpanded);
      return;
    }
    newExpanded.add(vendorId);
    setExpandedVendors(newExpanded);

    // Check if any prefix entry needs expansion
    const vendor = catalog
      .flatMap(c => c.vendors)
      .find(v => v.id === vendorId);
    if (!vendor) return;

    const hasPrefixNeedingExpand = vendor.entries.some(
      e => e.type === 'prefix' && !expandedData[`${vendorId}:${e.path}`]
    );

    if (hasPrefixNeedingExpand) {
      setLoadingExpand(vendorId);
      try {
        const fullCatalog = await systemApi.getFirmwareCatalog(true);
        const fullVendor = fullCatalog
          .flatMap(c => c.vendors)
          .find(v => v.id === vendorId);
        if (fullVendor) {
          const newData = { ...expandedData };
          for (const entry of fullVendor.entries) {
            if (entry.type === 'prefix') {
              newData[`${vendorId}:${entry.path}`] = entry;
            }
          }
          setExpandedData(newData);
        }
      } catch {
        // Keep expanded but without data
      } finally {
        setLoadingExpand(null);
      }
    }
  };

  // Bulk add for prefix entries
  const handleBulkAdd = async (vendorId: string, entryPath: string, files: string[]) => {
    const unconfigured = files.filter(f => !configuredEntries.has(f));
    if (unconfigured.length === 0) return;

    setBulkAdding(`${vendorId}:${entryPath}`);
    try {
      await systemApi.bulkAddFirmwareEntries(unconfigured);
      fetchData();
      // Refresh expanded data
      const fullCatalog = await systemApi.getFirmwareCatalog(true);
      const fullVendor = fullCatalog
        .flatMap(c => c.vendors)
        .find(v => v.id === vendorId);
      if (fullVendor) {
        const newData = { ...expandedData };
        for (const entry of fullVendor.entries) {
          if (entry.type === 'prefix') {
            newData[`${vendorId}:${entry.path}`] = entry;
          }
        }
        setExpandedData(newData);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Bulk-Add fehlgeschlagen';
      setError(msg);
    } finally {
      setBulkAdding(null);
    }
  };

  const configuredEntries = useMemo(
    () => new Set(status?.entries.map(e => e.entry) || []),
    [status]
  );

  // Recommended firmware set for typical school PCs
  const RECOMMENDED_SET = ['i915', 'amdgpu', 'rtl_nic', 'intel', 'rtl_bt'];
  const recommendedMissing = RECOMMENDED_SET.filter(e => !configuredEntries.has(e));

  const handleAddRecommended = async () => {
    if (recommendedMissing.length === 0) return;
    setAddingRecommended(true);
    try {
      await systemApi.bulkAddFirmwareEntries(recommendedMissing);
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Hinzufuegen fehlgeschlagen';
      setError(msg);
    } finally {
      setAddingRecommended(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-card shadow-sm rounded-lg p-6">
        <div className="flex items-center space-x-2">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Lade Firmware-Status...</span>
        </div>
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="bg-card shadow-sm rounded-lg p-6">
        <div className="flex items-center space-x-2 text-destructive">
          <XCircle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!status) return null;

  const activeCatalogCategory = catalog.find(c => c.id === activeTab);

  return (
    <div className="space-y-6">
      {/* Tab Bar */}
      <div className="bg-card shadow-sm rounded-lg">
        <div className="flex items-center justify-between px-4 pt-4">
          <div className="flex items-center space-x-3">
            <div className="bg-orange-500 rounded-md p-2">
              <Package className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-foreground">Firmware & WLAN</h3>
              <div className="flex items-center space-x-2 text-sm">
                {status.rebuildRunning ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    <span className="text-primary">Rebuilding linbofs64...</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    {status.stats.total} {status.stats.total === 1 ? 'Eintrag' : 'Eintraege'}
                    {status.stats.missing > 0 && (
                      <span className="text-yellow-500"> ({status.stats.missing} nicht gefunden)</span>
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={fetchData}
            className="p-2 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary transition-colors"
            title="Aktualisieren"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border mt-4 px-4 overflow-x-auto">
          {TAB_ORDER.map(tabId => {
            const cat = catalog.find(c => c.id === tabId);
            const Icon = CATEGORY_ICONS[tabId] || Package;
            const label = cat?.name || (tabId === 'manual' ? 'Manuell' : tabId === 'autoscan' ? 'Auto-Scan' : tabId);
            return (
              <button
                key={tabId}
                onClick={() => setActiveTab(tabId)}
                className={`flex items-center space-x-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tabId
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        {/* Error message */}
        {error && (
          <div className="mx-4 mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
            <div className="flex items-center space-x-2">
              <XCircle className="h-4 w-4 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          </div>
        )}

        {/* Rebuild warning */}
        {status.rebuildRunning && (
          <div className="mx-4 mt-4 p-3 bg-primary/10 border border-primary/20 rounded-md">
            <div className="flex items-center space-x-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <p className="text-sm text-primary">
                linbofs64 wird neu gebaut. Aenderungen werden beim naechsten Rebuild wirksam.
              </p>
            </div>
          </div>
        )}

        {/* Help & Tips */}
        <div className="mx-4 mt-4">
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="flex items-center space-x-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Lightbulb className="h-3.5 w-3.5" />
            <span>{showHelp ? 'Tipps ausblenden' : 'Nicht sicher welche Firmware? Tipps anzeigen'}</span>
          </button>

          {showHelp && (
            <div className="mt-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md space-y-3">
              {/* Recommended set */}
              <div className="flex items-start space-x-2">
                <Sparkles className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-amber-200">
                  <p className="font-medium mb-1">Empfohlenes Basis-Set fuer Schul-PCs:</p>
                  <p className="text-xs text-amber-300 mb-2">
                    Intel/AMD GPU + Realtek Ethernet + Realtek Bluetooth — deckt die meisten Desktop-PCs und Notebooks ab.
                  </p>
                  {recommendedMissing.length > 0 ? (
                    <button
                      onClick={handleAddRecommended}
                      disabled={addingRecommended}
                      className="flex items-center space-x-1.5 px-3 py-1.5 text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 rounded transition-colors disabled:opacity-50"
                    >
                      {addingRecommended ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      <span>Empfohlenes Set hinzufuegen ({recommendedMissing.length} Eintraege)</span>
                    </button>
                  ) : (
                    <span className="flex items-center space-x-1 text-xs text-ciGreen">
                      <CheckCircle className="h-3.5 w-3.5" />
                      <span>Alle empfohlenen Eintraege sind bereits konfiguriert</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Tab Content */}
        <div className="p-4">
          {activeTab === 'wifi' && (
            <div className="space-y-6">
              {/* WLAN Config Card */}
              <WlanConfig />

              {/* WiFi Firmware Vendors */}
              {activeCatalogCategory && (
                <VendorList
                  vendors={activeCatalogCategory.vendors}
                  expandedVendors={expandedVendors}
                  expandedData={expandedData}
                  loadingExpand={loadingExpand}
                  prefixSearch={prefixSearch}
                  bulkAdding={bulkAdding}
                  addingEntry={addingEntry}
                  configuredEntries={configuredEntries}
                  onToggleVendor={toggleVendor}
                  onAdd={handleAdd}
                  onBulkAdd={handleBulkAdd}
                  onPrefixSearchChange={(key, val) => setPrefixSearch(prev => ({ ...prev, [key]: val }))}
                />
              )}
            </div>
          )}

          {activeTab !== 'wifi' && activeTab !== 'manual' && activeTab !== 'autoscan' && activeCatalogCategory && (
            <VendorList
              vendors={activeCatalogCategory.vendors}
              expandedVendors={expandedVendors}
              expandedData={expandedData}
              loadingExpand={loadingExpand}
              prefixSearch={prefixSearch}
              bulkAdding={bulkAdding}
              addingEntry={addingEntry}
              configuredEntries={configuredEntries}
              onToggleVendor={toggleVendor}
              onAdd={handleAdd}
              onBulkAdd={handleBulkAdd}
              onPrefixSearchChange={(key, val) => setPrefixSearch(prev => ({ ...prev, [key]: val }))}
            />
          )}

          {activeTab === 'autoscan' && (
            <FirmwareDetect
              configuredEntries={configuredEntries}
              onEntriesAdded={fetchData}
            />
          )}

          {activeTab === 'manual' && (
            <ManualTab
              searchQuery={searchQuery}
              searchResults={searchResults}
              isSearching={isSearching}
              addingEntry={addingEntry}
              manualEntry={manualEntry}
              configuredEntries={configuredEntries}
              onSearch={handleSearch}
              onAdd={handleAdd}
              onManualEntryChange={setManualEntry}
              onManualAdd={handleManualAdd}
              showSearch={showSearch}
              onShowSearch={setShowSearch}
            />
          )}
        </div>
      </div>

      {/* Active Entries Table (always visible) */}
      <div className="bg-card shadow-sm rounded-lg p-6">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-foreground">Aktive Eintraege</h4>
          {status.entries.length > 0 && (
            <button
              onClick={handleRebuild}
              disabled={isRebuilding || status.rebuildRunning}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isRebuilding || status.rebuildRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Hammer className="h-4 w-4" />
              )}
              <span>{isRebuilding ? 'Baue...' : 'linbofs64 neu bauen'}</span>
            </button>
          )}
        </div>

        {rebuildSuccess && (
          <div className="mb-3 p-3 bg-ciGreen/10 border border-ciGreen/20 rounded-md">
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-4 w-4 text-ciGreen" />
              <p className="text-sm text-ciGreen">{rebuildSuccess}</p>
            </div>
          </div>
        )}

        {status.entries.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="pb-2 font-medium">Pfad</th>
                    <th className="pb-2 font-medium">Typ</th>
                    <th className="pb-2 font-medium">Groesse</th>
                    <th className="pb-2 font-medium text-right">Status</th>
                    <th className="pb-2 font-medium text-right w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {status.entries.map((entry) => (
                    <tr key={entry.entry} className={!entry.exists ? 'opacity-60' : ''}>
                      <td className="py-2.5 font-mono text-xs text-foreground">
                        {entry.entry}
                      </td>
                      <td className="py-2.5 text-muted-foreground">
                        {entry.isDirectory ? (
                          <span className="inline-flex items-center space-x-1">
                            <Folder className="h-3.5 w-3.5" />
                            <span>Verzeichnis</span>
                          </span>
                        ) : entry.isFile ? (
                          <span className="inline-flex items-center space-x-1">
                            <FileText className="h-3.5 w-3.5" />
                            <span>{entry.isZst ? 'Datei (.zst)' : 'Datei'}</span>
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="py-2.5 text-muted-foreground">
                        {formatBytes(entry.size || 0)}
                      </td>
                      <td className="py-2.5 text-right">
                        {entry.exists ? (
                          <span className="inline-flex items-center space-x-1 text-ciGreen text-xs font-medium">
                            <CheckCircle className="h-3.5 w-3.5" />
                            <span>Verfuegbar</span>
                          </span>
                        ) : entry.error ? (
                          <span
                            className="inline-flex items-center space-x-1 text-destructive text-xs font-medium cursor-help"
                            title={entry.error}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            <span>Fehler</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 text-yellow-500 text-xs font-medium">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            <span>Nicht gefunden</span>
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          onClick={() => setRemoveTarget(entry)}
                          className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors"
                          title="Entfernen"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 pt-3 border-t border-border text-xs text-muted-foreground">
              {status.stats.existing} von {status.stats.total} Eintraegen verfuegbar
              {status.stats.directories > 0 && ` (${status.stats.directories} Verzeichnisse, ${status.stats.files} Dateien)`}
              {' '}&middot; Nach Aenderungen muss linbofs64 neu gebaut werden.
            </div>
          </>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Keine Firmware-Eintraege konfiguriert.</p>
            <p className="text-xs mt-1">
              Waehlen Sie Firmware aus den Kategorien oben oder fuegen Sie manuell Eintraege hinzu.
            </p>
          </div>
        )}
      </div>

      {/* Confirm Remove Modal */}
      {removeTarget && (
        <ConfirmModal
          isOpen={true}
          onClose={() => setRemoveTarget(null)}
          onConfirm={handleRemove}
          title="Firmware-Eintrag entfernen"
          message={`Firmware-Eintrag '${removeTarget.entry}' aus der Konfiguration entfernen? Die Firmware-Dateien auf dem Host werden nicht geloescht. Nach dem Entfernen muss linbofs64 neu gebaut werden.`}
          confirmLabel="Entfernen"
          variant="danger"
        />
      )}
    </div>
  );
}

// =============================================================================
// Vendor List Component
// =============================================================================

function VendorList({
  vendors,
  expandedVendors,
  expandedData,
  loadingExpand,
  prefixSearch,
  bulkAdding,
  addingEntry,
  configuredEntries,
  onToggleVendor,
  onAdd,
  onBulkAdd,
  onPrefixSearchChange,
}: {
  vendors: FirmwareCatalogVendor[];
  expandedVendors: Set<string>;
  expandedData: Record<string, FirmwareCatalogEntry>;
  loadingExpand: string | null;
  prefixSearch: Record<string, string>;
  bulkAdding: string | null;
  addingEntry: string | null;
  configuredEntries: Set<string>;
  onToggleVendor: (vendorId: string) => void;
  onAdd: (entry: string) => Promise<void>;
  onBulkAdd: (vendorId: string, entryPath: string, files: string[]) => Promise<void>;
  onPrefixSearchChange: (key: string, val: string) => void;
}) {
  return (
    <div className="space-y-2">
      {vendors.map(vendor => {
        const isExpanded = expandedVendors.has(vendor.id);
        const isLoading = loadingExpand === vendor.id;

        return (
          <div key={vendor.id} className="border border-border rounded-lg">
            {/* Vendor Header */}
            <button
              onClick={() => onToggleVendor(vendor.id)}
              className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-secondary/50 transition-colors rounded-lg"
            >
              <div className="flex items-center space-x-2">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <div>
                  <span className="font-medium text-foreground">{vendor.name}</span>
                  <p className="text-xs text-muted-foreground">{vendor.description}</p>
                </div>
              </div>
              <span className={`text-xs font-medium ${vendor.configuredCount > 0 ? 'text-ciGreen' : 'text-muted-foreground'}`}>
                {vendor.configuredCount}/{vendor.totalCount} konfiguriert
              </span>
            </button>

            {/* Vendor Content */}
            {isExpanded && (
              <div className="px-4 pb-3 space-y-2">
                {isLoading && (
                  <div className="flex items-center space-x-2 py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Lade Dateien...</span>
                  </div>
                )}

                {vendor.entries.map(entry => {
                  if (entry.type === 'dir') {
                    return (
                      <DirEntry
                        key={entry.path}
                        entry={entry}
                        isAdding={addingEntry === entry.path}
                        onAdd={() => onAdd(entry.path)}
                        onRemove={() => {/* handled by active entries table */}}
                      />
                    );
                  }

                  // Prefix entry
                  const dataKey = `${vendor.id}:${entry.path}`;
                  const expanded = expandedData[dataKey];
                  const searchKey = dataKey;
                  const searchTerm = prefixSearch[searchKey] || '';

                  return (
                    <PrefixEntry
                      key={entry.path}
                      entry={entry}
                      expanded={expanded}
                      searchTerm={searchTerm}
                      bulkAdding={bulkAdding === dataKey}
                      addingEntry={addingEntry}
                      configuredEntries={configuredEntries}
                      onSearchChange={(val) => onPrefixSearchChange(searchKey, val)}
                      onAdd={onAdd}
                      onBulkAdd={(files) => onBulkAdd(vendor.id, entry.path, files)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// Dir Entry Component
// =============================================================================

function DirEntry({
  entry,
  isAdding,
  onAdd,
}: {
  entry: FirmwareCatalogEntry;
  isAdding: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-md bg-secondary/30">
      <div className="flex items-center space-x-2">
        <Folder className="h-4 w-4 text-yellow-500 flex-shrink-0" />
        <span className="text-sm font-mono text-foreground">{entry.path}</span>
        <span className="text-xs text-muted-foreground">- {entry.description}</span>
        {!entry.available && (
          <span className="text-xs text-yellow-500">(nicht vorhanden)</span>
        )}
      </div>
      <div>
        {entry.configured ? (
          <span className="text-xs text-ciGreen font-medium flex items-center space-x-1">
            <CheckCircle className="h-3.5 w-3.5" />
            <span>Konfiguriert</span>
          </span>
        ) : entry.available ? (
          <button
            onClick={onAdd}
            disabled={isAdding}
            className="flex items-center space-x-1 px-2 py-1 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors disabled:opacity-50"
          >
            {isAdding ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Plus className="h-3 w-3" />
            )}
            <span>Hinzufuegen</span>
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Prefix Entry Component
// =============================================================================

function PrefixEntry({
  entry,
  expanded,
  searchTerm,
  bulkAdding,
  addingEntry,
  configuredEntries,
  onSearchChange,
  onAdd,
  onBulkAdd,
}: {
  entry: FirmwareCatalogEntry;
  expanded?: FirmwareCatalogEntry;
  searchTerm: string;
  bulkAdding: boolean;
  addingEntry: string | null;
  configuredEntries: Set<string>;
  onSearchChange: (val: string) => void;
  onAdd: (entry: string) => Promise<void>;
  onBulkAdd: (files: string[]) => Promise<void>;
}) {
  const files = expanded?.expandedFiles || [];
  const configuredFiles = expanded?.configuredFiles || [];
  const configuredSet = new Set(configuredFiles);

  const filteredFiles = searchTerm
    ? files.filter(f => f.toLowerCase().includes(searchTerm.toLowerCase()))
    : files;

  const unconfiguredFiles = files.filter(f => !configuredEntries.has(f));

  return (
    <div className="rounded-md bg-secondary/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          <FileText className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="text-sm font-mono text-foreground">{entry.path}*</span>
          <span className="text-xs text-muted-foreground">- {entry.description}</span>
        </div>
        <span className={`text-xs font-medium ${entry.configuredCount > 0 ? 'text-ciGreen' : 'text-muted-foreground'}`}>
          {entry.configuredCount}/{entry.totalCount}
        </span>
      </div>

      {files.length > 0 && (
        <>
          {/* Search + Bulk Actions */}
          <div className="flex items-center space-x-2 mb-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Dateien filtern..."
                value={searchTerm}
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-secondary border border-border rounded text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            {unconfiguredFiles.length > 0 && (
              <button
                onClick={() => onBulkAdd(files)}
                disabled={bulkAdding}
                className="flex items-center space-x-1 px-2 py-1.5 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {bulkAdding ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
                <span>Alle hinzufuegen ({unconfiguredFiles.length})</span>
              </button>
            )}
          </div>

          {/* File List */}
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {filteredFiles.map(file => {
              const isConfigured = configuredSet.has(file) || configuredEntries.has(file);
              return (
                <div
                  key={file}
                  className="flex items-center justify-between px-2 py-1 rounded hover:bg-secondary/80 group text-xs"
                >
                  <span className={`font-mono truncate ${isConfigured ? 'text-ciGreen' : 'text-foreground'}`}>
                    {file}
                  </span>
                  {isConfigured ? (
                    <CheckCircle className="h-3 w-3 text-ciGreen flex-shrink-0" />
                  ) : (
                    <button
                      onClick={() => onAdd(file)}
                      disabled={addingEntry === file}
                      className="flex-shrink-0 ml-1 px-1.5 py-0.5 bg-primary/10 hover:bg-primary/20 text-primary rounded opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                    >
                      {addingEntry === file ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Plus className="h-3 w-3" />
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {filteredFiles.length === 0 && searchTerm && (
            <p className="text-xs text-muted-foreground text-center py-2">
              Keine Dateien fuer &quot;{searchTerm}&quot; gefunden.
            </p>
          )}
        </>
      )}

      {files.length === 0 && !entry.available && (
        <p className="text-xs text-muted-foreground">Firmware nicht auf dem Host vorhanden.</p>
      )}
    </div>
  );
}

// =============================================================================
// Manual Tab Component
// =============================================================================

function ManualTab({
  searchQuery,
  searchResults,
  isSearching,
  addingEntry,
  manualEntry,
  configuredEntries,
  onSearch,
  onAdd,
  onManualEntryChange,
  onManualAdd,
}: {
  searchQuery: string;
  searchResults: string[];
  isSearching: boolean;
  addingEntry: string | null;
  manualEntry: string;
  configuredEntries: Set<string>;
  onSearch: (query: string) => void;
  onAdd: (entry: string) => Promise<void>;
  onManualEntryChange: (val: string) => void;
  onManualAdd: () => void;
  showSearch: boolean;
  onShowSearch: (show: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Firmware suchen (z.B. rtl_nic, iwlwifi, amdgpu)..."
          className="w-full pl-10 pr-4 py-2 bg-secondary border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          value={searchQuery}
          onChange={(e) => onSearch(e.target.value)}
        />
        {isSearching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Manual entry */}
      <div className="flex space-x-2">
        <input
          type="text"
          placeholder="Oder manuell eingeben: rtl_nic/rtl8168g-2.fw"
          className="flex-1 px-3 py-2 bg-secondary border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          value={manualEntry}
          onChange={(e) => onManualEntryChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onManualAdd()}
        />
        <button
          onClick={onManualAdd}
          disabled={!manualEntry.trim() || addingEntry !== null}
          className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Search Results */}
      {searchResults.length > 0 && (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {searchResults
            .filter(r => !configuredEntries.has(r.replace(/\/$/, '')))
            .map((result) => {
              const isDir = result.endsWith('/');
              const displayPath = isDir ? result.slice(0, -1) : result;
              return (
                <div
                  key={result}
                  className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-secondary group"
                >
                  <div className="flex items-center space-x-2 text-sm font-mono">
                    {isDir ? (
                      <Folder className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                    ) : (
                      <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    )}
                    <span className="text-foreground truncate">{displayPath}</span>
                  </div>
                  <button
                    onClick={() => onAdd(displayPath)}
                    disabled={addingEntry === displayPath}
                    className="flex-shrink-0 ml-2 px-2 py-1 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                  >
                    {addingEntry === displayPath ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}
                  </button>
                </div>
              );
            })}
          {searchResults.filter(r => !configuredEntries.has(r.replace(/\/$/, ''))).length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Alle Suchergebnisse sind bereits konfiguriert.
            </p>
          )}
        </div>
      )}
      {searchQuery.length >= 2 && !isSearching && searchResults.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Keine Firmware gefunden fuer &quot;{searchQuery}&quot;.
        </p>
      )}
      {searchQuery.length < 2 && searchQuery.length > 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Mindestens 2 Zeichen eingeben...
        </p>
      )}
    </div>
  );
}
