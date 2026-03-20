import {
  Search,
  Pause,
  Play,
  Trash2,
  Download,
  ChevronsDown,
  Circle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLogStore, selectSeverityCounts } from '@/stores/logStore';
import { SEVERITY_DOT, SEVERITY_COLORS } from '@/lib/logClassifier';
import type { LogSeverity } from '@/types';

const SEVERITY_ORDER: LogSeverity[] = ['error', 'warn', 'success', 'info', 'debug'];
const SEVERITY_LABELS: Record<LogSeverity, string> = {
  error: 'Fehler',
  warn: 'Warnung',
  success: 'Erfolg',
  info: 'Info',
  debug: 'Debug',
};

interface LogPanelToolbarProps {
  onExport?: () => void;
}

export function LogPanelToolbar({ onExport }: LogPanelToolbarProps) {
  const activeTab = useLogStore((s) => s.activeTab);
  const isCapturing = useLogStore((s) => s.isCapturing);
  const isLiveTail = useLogStore((s) => s.isLiveTail);
  const search = useLogStore((s) => s.filters.search);
  const activeSeverities = useLogStore((s) => s.filters.severities);
  const toggleCapture = useLogStore((s) => s.toggleCapture);
  const toggleLiveTail = useLogStore((s) => s.toggleLiveTail);
  const clearEntries = useLogStore((s) => s.clearEntries);
  const setSearch = useLogStore((s) => s.setSearch);
  const toggleSeverityFilter = useLogStore((s) => s.toggleSeverityFilter);
  const counts = useLogStore(selectSeverityCounts);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-[#0d0d0d] flex-shrink-0">
      {/* Severity badges */}
      <div className="flex items-center gap-1">
        {SEVERITY_ORDER.map((sev) => {
          const active = activeSeverities.size === 0 || activeSeverities.has(sev);
          const count = counts[sev];
          return (
            <button
              key={sev}
              type="button"
              onClick={() => toggleSeverityFilter(sev)}
              className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors',
                active ? SEVERITY_COLORS[sev] : 'text-muted-foreground/40',
                active && 'bg-white/5',
                !active && 'opacity-50'
              )}
              title={SEVERITY_LABELS[sev]}
            >
              <Circle className={cn('h-2 w-2 fill-current', active ? SEVERITY_DOT[sev] : '')} />
              <span>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Separator */}
      <div className="w-px h-4 bg-border" />

      {/* Search */}
      <div className="flex items-center gap-1 flex-1 max-w-[250px]">
        <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Suchen..."
          className="bg-transparent border-none outline-none text-xs text-foreground placeholder:text-muted-foreground/50 w-full"
        />
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Action buttons */}
      <div className="flex items-center gap-1">
        {/* Live tail */}
        <button
          type="button"
          onClick={toggleLiveTail}
          className={cn(
            'p-1 rounded hover:bg-white/10 transition-colors',
            isLiveTail ? 'text-ciGreen' : 'text-muted-foreground'
          )}
          title={isLiveTail ? 'Auto-Scroll an' : 'Auto-Scroll aus'}
        >
          <ChevronsDown className="h-3.5 w-3.5" />
        </button>

        {/* Capture toggle */}
        <button
          type="button"
          onClick={toggleCapture}
          className={cn(
            'p-1 rounded hover:bg-white/10 transition-colors',
            isCapturing ? 'text-destructive' : 'text-muted-foreground'
          )}
          title={isCapturing ? 'Aufnahme pausieren' : 'Aufnahme fortsetzen'}
        >
          {isCapturing ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </button>

        {/* Clear */}
        <button
          type="button"
          onClick={() => clearEntries(activeTab)}
          className="p-1 rounded hover:bg-white/10 text-muted-foreground transition-colors"
          title="Logs löschen"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>

        {/* Export */}
        {onExport && (
          <button
            type="button"
            onClick={onExport}
            className="p-1 rounded hover:bg-white/10 text-muted-foreground transition-colors"
            title="Exportieren"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
