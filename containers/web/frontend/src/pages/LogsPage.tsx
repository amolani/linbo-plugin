import { useState, useRef, useCallback, useEffect } from 'react';
import { ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLogStore, selectFilteredEntries } from '@/stores/logStore';
import { useApiLogCatchup } from '@/hooks/useApiLogStream';
import { useContainerList, useContainerLogStream } from '@/hooks/useContainerLogs';
import { exportAsJson } from '@/lib/logExport';
import { LogPanelToolbar } from '@/components/log/LogPanelToolbar';
import { LogEntryRow } from '@/components/log/LogEntryRow';
import { LogEntryDetail } from '@/components/log/LogEntryDetail';
import type { LogEntry, LogTab } from '@/types';

const TABS: Array<{ id: LogTab; label: string }> = [
  { id: 'events', label: 'Events' },
  { id: 'apiLogs', label: 'API Logs' },
  { id: 'container', label: 'Container' },
];

export function LogsPage() {
  const activeTab = useLogStore((s) => s.activeTab);
  const isLiveTail = useLogStore((s) => s.isLiveTail);
  const setActiveTab = useLogStore((s) => s.setActiveTab);
  const selectedContainer = useLogStore((s) => s.selectedContainer);
  const setSelectedContainer = useLogStore((s) => s.setSelectedContainer);

  const filteredEntries = useLogStore(selectFilteredEntries);

  useApiLogCatchup();
  useContainerLogStream();
  const { containers, available: dockerAvailable } = useContainerList();

  const [selectedEntry, setSelectedEntry] = useState<LogEntry | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    if (isLiveTail && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [filteredEntries.length, isLiveTail]);

  const handleEntryClick = useCallback((entry: LogEntry) => {
    setSelectedEntry((prev) => (prev?.id === entry.id ? null : entry));
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ScrollText className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Logs</h1>
        </div>
      </div>

      {/* Log viewer card */}
      <div className="flex flex-col flex-1 bg-[#0a0a0a] rounded-lg border border-border overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-center border-b border-border bg-[#0d0d0d] px-3 flex-shrink-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}

          {/* Container dropdown */}
          {activeTab === 'container' && dockerAvailable && (
            <select
              value={selectedContainer}
              onChange={(e) => setSelectedContainer(e.target.value)}
              className="ml-3 bg-[#1a1a1a] border border-border rounded text-sm text-foreground px-3 py-1.5 outline-none"
            >
              <option value="">Container wählen...</option>
              {containers.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          )}
          {activeTab === 'container' && !dockerAvailable && (
            <span className="ml-3 text-xs text-muted-foreground/50">Docker Socket nicht verfügbar</span>
          )}

          <div className="flex-1" />
          <span className="text-xs text-muted-foreground/50">
            {filteredEntries.length} Einträge
          </span>
        </div>

        {/* Toolbar */}
        <LogPanelToolbar onExport={() => exportAsJson(filteredEntries)} />

        {/* Content area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Log list */}
          <div
            ref={listRef}
            className="flex-1 overflow-y-auto overflow-x-hidden"
            onScroll={() => {
              if (!listRef.current) return;
              const { scrollTop, scrollHeight, clientHeight } = listRef.current;
              const atBottom = scrollHeight - scrollTop - clientHeight < 30;
              if (!atBottom && isLiveTail) {
                useLogStore.getState().toggleLiveTail();
              }
            }}
          >
            {filteredEntries.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground/50">
                Keine Log-Einträge
              </div>
            ) : (
              filteredEntries.map((entry) => (
                <LogEntryRow
                  key={entry.id}
                  entry={entry}
                  isSelected={selectedEntry?.id === entry.id}
                  onClick={handleEntryClick}
                />
              ))
            )}
          </div>

          {/* Detail sidebar */}
          {selectedEntry && (
            <LogEntryDetail
              entry={selectedEntry}
              onClose={() => setSelectedEntry(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
