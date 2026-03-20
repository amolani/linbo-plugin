import { useState, useRef, useCallback, useEffect } from 'react';
import { X, ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLogStore, selectFilteredEntries } from '@/stores/logStore';
import { useApiLogCatchup } from '@/hooks/useApiLogStream';
import { useContainerList, useContainerLogStream } from '@/hooks/useContainerLogs';
import { exportAsJson } from '@/lib/logExport';
import { LogPanelToolbar } from './LogPanelToolbar';
import { LogEntryRow } from './LogEntryRow';
import { LogEntryDetail } from './LogEntryDetail';
import type { LogEntry, LogTab } from '@/types';

const TABS: Array<{ id: LogTab; label: string }> = [
  { id: 'events', label: 'Events' },
  { id: 'apiLogs', label: 'API Logs' },
  { id: 'container', label: 'Container' },
];

export function LogPanel() {
  const isPanelOpen = useLogStore((s) => s.isPanelOpen);
  const panelHeight = useLogStore((s) => s.panelHeight);
  const activeTab = useLogStore((s) => s.activeTab);
  const isLiveTail = useLogStore((s) => s.isLiveTail);
  const setPanelHeight = useLogStore((s) => s.setPanelHeight);
  const setActiveTab = useLogStore((s) => s.setActiveTab);
  const setPanelOpen = useLogStore((s) => s.setPanelOpen);
  const selectedContainer = useLogStore((s) => s.selectedContainer);
  const setSelectedContainer = useLogStore((s) => s.setSelectedContainer);

  const filteredEntries = useLogStore(selectFilteredEntries);

  // Data hooks
  useApiLogCatchup();
  useContainerLogStream();
  const { containers, available: dockerAvailable } = useContainerList();

  const [selectedEntry, setSelectedEntry] = useState<LogEntry | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  // Auto-scroll to bottom on new entries when live tail is active
  useEffect(() => {
    if (isLiveTail && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [filteredEntries.length, isLiveTail]);

  // Drag handle for resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startY = e.clientY;
    const startHeight = panelHeight;

    function onMouseMove(ev: MouseEvent) {
      if (!isDragging.current) return;
      const delta = startY - ev.clientY;
      setPanelHeight(startHeight + delta);
    }

    function onMouseUp() {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [panelHeight, setPanelHeight]);

  const handleEntryClick = useCallback((entry: LogEntry) => {
    setSelectedEntry((prev) => (prev?.id === entry.id ? null : entry));
  }, []);

  if (!isPanelOpen) return null;

  return (
    <div
      className="flex flex-col border-t border-border bg-[#0a0a0a] flex-shrink-0"
      style={{ height: panelHeight }}
    >
      {/* Drag handle */}
      <div
        className="h-1 cursor-row-resize hover:bg-primary/40 transition-colors flex-shrink-0"
        onMouseDown={handleMouseDown}
      />

      {/* Tab bar */}
      <div className="flex items-center border-b border-border bg-[#0d0d0d] px-2 flex-shrink-0">
        <ScrollText className="h-4 w-4 text-muted-foreground mr-2 flex-shrink-0" />

        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}

        {/* Container dropdown (only visible on container tab) */}
        {activeTab === 'container' && dockerAvailable && (
          <select
            value={selectedContainer}
            onChange={(e) => setSelectedContainer(e.target.value)}
            className="ml-2 bg-[#1a1a1a] border border-border rounded text-xs text-foreground px-2 py-1 outline-none"
          >
            <option value="">Container wählen...</option>
            {containers.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        )}
        {activeTab === 'container' && !dockerAvailable && (
          <span className="ml-2 text-[10px] text-muted-foreground/50">Docker Socket nicht verfügbar</span>
        )}

        {/* Spacer + Close */}
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground/50 mr-2">
          {filteredEntries.length} Einträge
        </span>
        <button
          type="button"
          onClick={() => setPanelOpen(false)}
          className="p-1 rounded hover:bg-white/10 text-muted-foreground transition-colors"
          title="Schließen"
        >
          <X className="h-3.5 w-3.5" />
        </button>
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
            // Disable live tail if user scrolls up
            if (!listRef.current) return;
            const { scrollTop, scrollHeight, clientHeight } = listRef.current;
            const atBottom = scrollHeight - scrollTop - clientHeight < 30;
            if (!atBottom && isLiveTail) {
              useLogStore.getState().toggleLiveTail();
            }
          }}
        >
          {filteredEntries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground/50">
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
  );
}
