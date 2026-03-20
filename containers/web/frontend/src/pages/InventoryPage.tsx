import { useState, useEffect, useCallback } from 'react';
import {
  Cpu, HardDrive, MemoryStick, Network, Monitor, Server,
  Loader2, AlertCircle, ChevronDown, ChevronRight, Search,
  CircuitBoard, ScanLine, RefreshCw,
} from 'lucide-react';
import { syncApi } from '@/api/sync';
import type { SyncHost } from '@/api/sync';
import { driversApi } from '@/api/drivers';
import type { HwinfoData, HwinfoAllEntry } from '@/api/drivers';
import { notify } from '@/stores/notificationStore';
import { cn } from '@/lib/utils';

interface ParsedDisk {
  name: string;
  size: string;
  model: string;
}

interface ParsedNetIf {
  name: string;
  mac: string;
}

function parseDiskLines(raw: string): ParsedDisk[] {
  if (!raw || !raw.trim()) return [];
  return raw.split('\n').filter(Boolean).map(line => {
    const parts = line.trim().split(/\s+/);
    return {
      name: parts[0] || '',
      size: parts[1] || '',
      model: parts.slice(2).join(' ') || '',
    };
  });
}

function parseNetworkLines(raw: string): ParsedNetIf[] {
  if (!raw || !raw.trim()) return [];
  return raw.split('\n').filter(Boolean).map(line => {
    const [name, mac] = line.split(':').map(s => s.trim());
    return { name: name || '', mac: mac || '' };
  });
}

export function InventoryPage() {
  const [hosts, setHosts] = useState<SyncHost[]>([]);
  const [loadingHosts, setLoadingHosts] = useState(true);
  const [selectedIp, setSelectedIp] = useState<string | null>(null);
  const [hwinfoByMac, setHwinfoByMac] = useState<Record<string, HwinfoAllEntry>>({});
  const [refreshingIp, setRefreshingIp] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyOnline, setOnlyOnline] = useState(true);
  const [hwinfoExpanded, setHwinfoExpanded] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoadingHosts(true);
      const [allHosts, allHwinfo] = await Promise.all([
        syncApi.getHosts(),
        driversApi.getHwinfoAll().catch(() => [] as HwinfoAllEntry[]),
      ]);
      setHosts(allHosts);

      // Build map by MAC
      const byMac: Record<string, HwinfoAllEntry> = {};
      for (const entry of allHwinfo) {
        byMac[entry.mac] = entry;
      }
      setHwinfoByMac(byMac);
    } catch {
      notify.error('Fehler', 'Daten konnten nicht geladen werden');
    } finally {
      setLoadingHosts(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSelectHost = useCallback(async (host: SyncHost) => {
    const { ip, mac } = host;
    if (selectedIp === ip) {
      setSelectedIp(null);
      return;
    }

    setSelectedIp(ip);
    setHwinfoExpanded(false);

    // If we already have cached data, show it immediately
    if (hwinfoByMac[mac]) return;

    // If online and no cached data, auto-fetch via SSH
    if (host.runtimeStatus === 'online') {
      setRefreshingIp(ip);
      setErrors(prev => {
        const next = { ...prev };
        delete next[ip];
        return next;
      });

      try {
        const data = await driversApi.getHwinfo(ip);
        setHwinfoByMac(prev => ({ ...prev, [mac]: { ...data, mac } }));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Client nicht erreichbar';
        setErrors(prev => ({ ...prev, [ip]: message }));
      } finally {
        setRefreshingIp(null);
      }
    }
  }, [selectedIp, hwinfoByMac]);

  const handleRefreshHost = useCallback(async (host: SyncHost) => {
    const { ip, mac } = host;
    setRefreshingIp(ip);
    setErrors(prev => {
      const next = { ...prev };
      delete next[ip];
      return next;
    });

    try {
      const data = await driversApi.getHwinfo(ip, true);
      setHwinfoByMac(prev => ({ ...prev, [mac]: { ...data, mac } }));
      notify.success('Aktualisiert', `Hardware-Daten fuer ${host.hostname} aktualisiert`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Client nicht erreichbar';
      setErrors(prev => ({ ...prev, [ip]: message }));
    } finally {
      setRefreshingIp(null);
    }
  }, []);

  const handleScanAll = useCallback(async () => {
    setScanning(true);
    try {
      const result = await driversApi.triggerHwinfoScan();
      notify.success(
        'Scan abgeschlossen',
        `${result.scanned} gescannt, ${result.skipped} uebersprungen, ${result.failed} fehlgeschlagen`
      );
      // Reload cached data after scan
      const allHwinfo = await driversApi.getHwinfoAll().catch(() => [] as HwinfoAllEntry[]);
      const byMac: Record<string, HwinfoAllEntry> = {};
      for (const entry of allHwinfo) {
        byMac[entry.mac] = entry;
      }
      setHwinfoByMac(byMac);
    } catch {
      notify.error('Fehler', 'Scan konnte nicht gestartet werden');
    } finally {
      setScanning(false);
    }
  }, []);

  const onlineHosts = hosts.filter(h => h.runtimeStatus === 'online');
  const cachedCount = Object.keys(hwinfoByMac).length;

  const filteredHosts = hosts.filter(h => {
    if (onlyOnline && h.runtimeStatus !== 'online') return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      h.hostname.toLowerCase().includes(q) ||
      h.ip.toLowerCase().includes(q) ||
      h.mac.toLowerCase().includes(q) ||
      (h.hostgroup || '').toLowerCase().includes(q) ||
      (h.room || '').toLowerCase().includes(q)
    );
  });

  if (loadingHosts) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Hardware-Inventar</h1>
        <p className="text-muted-foreground mt-1">
          Hardware-Informationen aller LINBO-Clients. Daten werden automatisch beim Booten erfasst und 7 Tage gecacht.
        </p>
      </div>

      {/* Search, scan button and stats */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Host suchen (Name, IP, MAC, Gruppe)..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <button
          onClick={() => setOnlyOnline(!onlyOnline)}
          className={cn(
            'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md border transition-colors',
            onlyOnline
              ? 'border-green-500/50 bg-green-500/10 text-green-400 hover:bg-green-500/20'
              : 'border-border bg-background text-muted-foreground hover:bg-muted/50'
          )}
        >
          <div className={cn('h-2 w-2 rounded-full', onlyOnline ? 'bg-green-500' : 'bg-muted-foreground')} />
          {onlyOnline ? 'Nur Online' : 'Alle Hosts'}
        </button>
        <button
          onClick={handleScanAll}
          disabled={scanning}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md border border-border bg-background hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {scanning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ScanLine className="h-4 w-4" />
          )}
          Alle scannen
        </button>
        <div className="flex items-center gap-2 text-sm text-muted-foreground flex-shrink-0">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          {onlineHosts.length} online
          <span className="text-muted-foreground/50">/ {hosts.length} gesamt</span>
          <span className="text-muted-foreground/50">/ {cachedCount} mit HW-Daten</span>
        </div>
      </div>

      {/* Host List */}
      {filteredHosts.length === 0 ? (
        <div className="border border-dashed rounded-lg p-12 text-center text-muted-foreground">
          <Monitor className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p className="font-medium">
            {hosts.length === 0
              ? 'Keine LINBO-Clients gefunden'
              : 'Keine Hosts gefunden'}
          </p>
          <p className="text-sm mt-1">
            {hosts.length === 0
              ? 'Starten Sie einen Client im LINBO-Modus, um dessen Hardware abzufragen.'
              : 'Versuchen Sie einen anderen Suchbegriff.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredHosts.map(host => {
            const isSelected = selectedIp === host.ip;
            const data = hwinfoByMac[host.mac];
            const isRefreshing = refreshingIp === host.ip;
            const error = errors[host.ip];
            const isOnline = host.runtimeStatus === 'online';

            return (
              <div key={host.mac} className="border rounded-lg bg-card overflow-hidden">
                {/* Host Row */}
                <button
                  onClick={() => handleSelectHost(host)}
                  className="w-full text-left p-4 hover:bg-muted/30 transition-colors flex items-center gap-4"
                >
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isSelected ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div className={cn(
                      'h-2 w-2 rounded-full',
                      isOnline ? 'bg-green-500' : 'bg-gray-400'
                    )} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-foreground">{host.hostname}</span>
                      <span className="text-sm text-muted-foreground font-mono">{host.ip}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                      <span className="font-mono">{host.mac}</span>
                      {host.hostgroup && (
                        <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {host.hostgroup}
                        </span>
                      )}
                      {host.room && (
                        <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {host.room}
                        </span>
                      )}
                    </div>
                  </div>

                  {data && !isSelected && (
                    <div className="hidden md:flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0">
                      <span>{data.dmi.vendor}</span>
                      <span>{data.dmi.product}</span>
                      <span>{data.ram.totalGb} GB</span>
                    </div>
                  )}
                </button>

                {/* Expanded Detail View */}
                {isSelected && (
                  <div className="border-t p-4">
                    {isRefreshing && (
                      <div className="flex items-center justify-center py-12 gap-3">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        <span className="text-muted-foreground">
                          Verbinde per SSH mit {host.ip}...
                        </span>
                      </div>
                    )}

                    {error && (
                      <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                        <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
                        <div>
                          <p className="font-medium text-destructive">Client nicht erreichbar</p>
                          <p className="text-sm text-destructive/80 mt-0.5">{error}</p>
                        </div>
                      </div>
                    )}

                    {!data && !isRefreshing && !error && !isOnline && (
                      <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/30 border border-border">
                        <Monitor className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        <p className="text-sm text-muted-foreground">
                          Keine gecachten Hardware-Daten. Host muss online sein fuer eine Abfrage.
                        </p>
                      </div>
                    )}

                    {data && !isRefreshing && (
                      <>
                        {/* Refresh button header */}
                        <div className="flex items-center justify-between mb-4">
                          <span className="text-xs text-muted-foreground/60">
                            Erfasst: {new Date(data.timestamp).toLocaleString('de-DE')}
                            {data.cached !== false && ' (Cache)'}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRefreshHost(host);
                            }}
                            disabled={!isOnline || isRefreshing}
                            className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded border border-border hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title={isOnline ? 'Daten per SSH aktualisieren' : 'Host ist offline'}
                          >
                            <RefreshCw className="h-3 w-3" />
                            Aktualisieren
                          </button>
                        </div>
                        <HwinfoDetail
                          data={data}
                          hwinfoExpanded={hwinfoExpanded}
                          onToggleHwinfo={() => setHwinfoExpanded(prev => !prev)}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface HwinfoDetailProps {
  data: HwinfoData;
  hwinfoExpanded: boolean;
  onToggleHwinfo: () => void;
}

function HwinfoDetail({ data, hwinfoExpanded, onToggleHwinfo }: HwinfoDetailProps) {
  const disks = parseDiskLines(data.disks);
  const netIfs = parseNetworkLines(data.network);

  return (
    <div className="space-y-4">
      {/* Top row: DMI + CPU + RAM */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* DMI */}
        <InfoCard
          icon={Server}
          title="System (DMI)"
          items={[
            { label: 'Hersteller', value: data.dmi.vendor },
            { label: 'Produkt', value: data.dmi.product },
            { label: 'Seriennummer', value: data.dmi.serial },
            { label: 'BIOS', value: data.dmi.biosVersion },
          ]}
        />

        {/* CPU */}
        <InfoCard
          icon={Cpu}
          title="Prozessor"
          items={[
            { label: 'Modell', value: data.cpu.model },
            { label: 'Kerne', value: String(data.cpu.cores) },
          ]}
        />

        {/* RAM */}
        <InfoCard
          icon={MemoryStick}
          title="Arbeitsspeicher"
          items={[
            { label: 'Gesamt', value: `${data.ram.totalGb} GB` },
            { label: 'MB', value: `${data.ram.totalMb.toLocaleString()} MB` },
          ]}
        />
      </div>

      {/* Bottom row: Network + Disks */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Network */}
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center gap-2 mb-3">
            <Network className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-medium text-foreground">Netzwerk</h3>
          </div>
          {netIfs.length > 0 ? (
            <div className="space-y-2">
              {netIfs.map((iface, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{iface.name}</span>
                  <span className="font-mono text-foreground text-xs">{iface.mac}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Keine Netzwerk-Daten</p>
          )}
        </div>

        {/* Disks */}
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center gap-2 mb-3">
            <HardDrive className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-medium text-foreground">Festplatten</h3>
          </div>
          {disks.length > 0 ? (
            <div className="space-y-2">
              {disks.map((disk, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-foreground">{disk.name}</span>
                    <span className="text-muted-foreground">{disk.size}</span>
                  </div>
                  <span className="text-muted-foreground text-xs truncate max-w-[200px]" title={disk.model}>
                    {disk.model}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Keine Festplatten-Daten</p>
          )}
        </div>
      </div>

      {/* PCI Devices */}
      {data.pci && data.pci.trim() && (
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center gap-2 mb-3">
            <CircuitBoard className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-medium text-foreground">PCI-Geraete</h3>
          </div>
          <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap max-h-48 overflow-y-auto bg-muted/30 rounded p-3">
            {data.pci}
          </pre>
        </div>
      )}

      {/* hwinfo --short (collapsible) */}
      {data.hwinfo && data.hwinfo.trim() && (
        <div className="border rounded-lg bg-card overflow-hidden">
          <button
            onClick={onToggleHwinfo}
            className="w-full flex items-center gap-2 p-4 hover:bg-muted/30 transition-colors text-left"
          >
            {hwinfoExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <Monitor className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-medium text-foreground">hwinfo --short (Rohdaten)</h3>
          </button>
          {hwinfoExpanded && (
            <div className="border-t px-4 pb-4">
              <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap max-h-96 overflow-y-auto bg-muted/30 rounded p-3 mt-3">
                {data.hwinfo}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface InfoCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  items: { label: string; value: string }[];
}

function InfoCard({ icon: Icon, title, items }: InfoCardProps) {
  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
      </div>
      <dl className="space-y-1.5">
        {items.map(item => (
          <div key={item.label} className="flex items-start justify-between text-sm gap-2">
            <dt className="text-muted-foreground flex-shrink-0">{item.label}</dt>
            <dd className={cn(
              'text-foreground text-right truncate',
              item.value.length > 20 ? 'text-xs' : ''
            )} title={item.value}>
              {item.value || '-'}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
