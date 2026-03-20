import { useState, useCallback, useEffect } from 'react';
import { Terminal as TerminalIcon, Plus, X, Loader2, Wifi, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { notify } from '@/stores/notificationStore';
import { useTerminalWs } from '@/hooks/useTerminalWs';
import { terminalApi } from '@/api/terminal';
import { TerminalView, getTerminalWriter } from '@/components/terminal/TerminalView';
import type { TerminalWsMessage } from '@/hooks/useTerminalWs';

interface Tab {
  id: string;
  hostIp: string;
  sessionId: string | null;
  status: 'connecting' | 'open' | 'closed' | 'error';
  error?: string;
  mode?: 'pty' | 'exec';
}

export function TerminalPage() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [hostIp, setHostIp] = useState('');
  const [isTesting, setIsTesting] = useState(false);

  const { connect, disconnect, send, onMessage, isConnected } = useTerminalWs();

  // Connect WS on mount
  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  // Handle messages from terminal WS
  useEffect(() => {
    const unsub = onMessage((msg: TerminalWsMessage) => {
      switch (msg.type) {
        case 'terminal.opened': {
          setTabs((prev) =>
            prev.map((t) =>
              t.hostIp === msg.hostIp && t.status === 'connecting'
                ? { ...t, sessionId: msg.sessionId!, status: 'open' }
                : t
            )
          );
          break;
        }

        case 'terminal.output': {
          const writer = getTerminalWriter(msg.sessionId!);
          if (writer) writer(msg.data!);
          break;
        }

        case 'terminal.closed': {
          setTabs((prev) =>
            prev.map((t) =>
              t.sessionId === msg.sessionId
                ? { ...t, status: 'closed', error: msg.reason }
                : t
            )
          );
          break;
        }

        case 'terminal.error': {
          if (msg.sessionId) {
            setTabs((prev) =>
              prev.map((t) =>
                t.sessionId === msg.sessionId || (t.status === 'connecting' && !t.sessionId)
                  ? { ...t, status: 'error', error: msg.error }
                  : t
              )
            );
          } else {
            notify.error('Terminal Fehler', msg.error || 'Unbekannter Fehler');
          }
          break;
        }
      }
    });

    return unsub;
  }, [onMessage]);

  const openTerminal = useCallback(
    (ip: string) => {
      if (!ip.trim()) return;
      if (!isConnected) {
        notify.error('Nicht verbunden', 'Terminal WebSocket ist nicht verbunden');
        return;
      }

      const tabId = `tab-${Date.now()}`;
      const newTab: Tab = {
        id: tabId,
        hostIp: ip.trim(),
        sessionId: null,
        status: 'connecting',
      };

      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(tabId);

      send({
        type: 'terminal.open',
        hostIp: ip.trim(),
        cols: 80,
        rows: 24,
      });
    },
    [isConnected, send]
  );

  const closeTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab?.sessionId && tab.status === 'open') {
        send({ type: 'terminal.close', sessionId: tab.sessionId });
      }

      setTabs((prev) => prev.filter((t) => t.id !== tabId));

      if (activeTabId === tabId) {
        setActiveTabId(() => {
          const remaining = tabs.filter((t) => t.id !== tabId);
          return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
        });
      }
    },
    [tabs, activeTabId, send]
  );

  const handleInput = useCallback(
    (sessionId: string, data: string) => {
      send({ type: 'terminal.input', sessionId, data });
    },
    [send]
  );

  const handleResize = useCallback(
    (sessionId: string, cols: number, rows: number) => {
      send({ type: 'terminal.resize', sessionId, cols, rows });
    },
    [send]
  );

  const handleTestConnection = useCallback(async () => {
    if (!hostIp.trim()) return;
    setIsTesting(true);
    try {
      const result = await terminalApi.testConnection(hostIp.trim());
      if (result.success && result.connected) {
        notify.success('Verbindung OK', `SSH zu ${hostIp} erfolgreich`);
      } else {
        notify.error('Verbindung fehlgeschlagen', result.error || 'SSH nicht erreichbar');
      }
    } catch (err) {
      notify.error('Fehler', err instanceof Error ? err.message : 'Verbindungstest fehlgeschlagen');
    } finally {
      setIsTesting(false);
    }
  }, [hostIp]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && hostIp.trim()) {
        e.preventDefault();
        openTerminal(hostIp);
        setHostIp('');
      }
    },
    [hostIp, openTerminal]
  );

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <TerminalIcon className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">Terminal</h1>
          <span className="flex items-center gap-1.5 text-xs">
            {isConnected ? (
              <>
                <Wifi className="h-3 w-3 text-ciGreen" />
                <span className="text-ciGreen">Verbunden</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3 text-destructive" />
                <span className="text-destructive">Getrennt</span>
              </>
            )}
          </span>
        </div>

        {/* Connect bar */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={hostIp}
            onChange={(e) => setHostIp(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Host-IP (z.B. 10.0.0.100)"
            className="w-56 px-3 py-1.5 text-sm bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={handleTestConnection}
            disabled={!hostIp.trim() || isTesting}
            className="px-3 py-1.5 text-sm border border-border rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 transition-colors"
          >
            {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
          </button>
          <button
            onClick={() => {
              openTerminal(hostIp);
              setHostIp('');
            }}
            disabled={!hostIp.trim() || !isConnected}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Verbinden
          </button>
        </div>
      </div>

      {/* Tabs */}
      {tabs.length > 0 && (
        <div className="flex items-center border-b border-border bg-card overflow-x-auto">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm border-r border-border cursor-pointer select-none min-w-0',
                activeTabId === tab.id
                  ? 'bg-background text-foreground border-b-2 border-b-primary'
                  : 'text-muted-foreground hover:bg-accent/50'
              )}
              onClick={() => setActiveTabId(tab.id)}
            >
              <span
                className={cn(
                  'h-2 w-2 rounded-full flex-shrink-0',
                  tab.status === 'open' && 'bg-ciGreen',
                  tab.status === 'connecting' && 'bg-yellow-500 animate-pulse',
                  tab.status === 'closed' && 'bg-muted-foreground',
                  tab.status === 'error' && 'bg-destructive'
                )}
              />
              <span className="truncate max-w-[120px]">{tab.hostIp}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="flex-shrink-0 p-0.5 rounded hover:bg-accent"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Terminal area */}
      <div className="flex-1 bg-[#0a0a0a] relative overflow-hidden">
        {tabs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <TerminalIcon className="h-16 w-16 mb-4 opacity-20" />
            <p className="text-lg mb-2">Kein Terminal geoeffnet</p>
            <p className="text-sm">Host-IP eingeben und verbinden, um eine SSH-Session zu starten.</p>
          </div>
        ) : (
          tabs.map((tab) => (
            <div
              key={tab.id}
              className={cn(
                'absolute inset-0',
                activeTabId === tab.id ? 'block' : 'hidden'
              )}
            >
              {tab.status === 'connecting' && (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin mr-3" />
                  <span>Verbinde zu {tab.hostIp}...</span>
                </div>
              )}
              {tab.status === 'error' && (
                <div className="flex flex-col items-center justify-center h-full text-destructive">
                  <p className="text-lg mb-2">Verbindung fehlgeschlagen</p>
                  <p className="text-sm text-muted-foreground">{tab.error}</p>
                  <button
                    onClick={() => {
                      closeTab(tab.id);
                      openTerminal(tab.hostIp);
                    }}
                    className="mt-4 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                  >
                    Erneut versuchen
                  </button>
                </div>
              )}
              {tab.status === 'closed' && (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <p className="text-lg mb-2">Verbindung geschlossen</p>
                  <p className="text-sm">{tab.error || 'Session beendet'}</p>
                  <button
                    onClick={() => {
                      closeTab(tab.id);
                      openTerminal(tab.hostIp);
                    }}
                    className="mt-4 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                  >
                    Neu verbinden
                  </button>
                </div>
              )}
              {(tab.status === 'open' || tab.status === 'connecting') && tab.sessionId && (
                <TerminalView
                  sessionId={tab.sessionId}
                  onInput={handleInput}
                  onResize={handleResize}
                  isActive={activeTabId === tab.id}
                />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
