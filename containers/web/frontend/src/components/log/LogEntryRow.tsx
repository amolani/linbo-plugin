import { memo } from 'react';
import { cn } from '@/lib/utils';
import { SEVERITY_DOT, SEVERITY_COLORS, CATEGORY_LABELS } from '@/lib/logClassifier';
import type { LogEntry } from '@/types';

interface LogEntryRowProps {
  entry: LogEntry;
  isSelected: boolean;
  onClick: (entry: LogEntry) => void;
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  } catch {
    return ts;
  }
}

export const LogEntryRow = memo(function LogEntryRow({ entry, isSelected, onClick }: LogEntryRowProps) {
  const categoryLabel = CATEGORY_LABELS[entry.category] || entry.category;

  return (
    <button
      type="button"
      className={cn(
        'flex items-center w-full gap-2 px-3 py-0.5 text-left font-mono text-xs leading-6 hover:bg-white/5 transition-colors',
        isSelected && 'bg-white/10',
        entry.pinned && 'border-l-2 border-primary'
      )}
      onClick={() => onClick(entry)}
    >
      {/* Timestamp */}
      <span className="text-muted-foreground/70 flex-shrink-0 w-[90px]">
        {formatTime(entry.timestamp)}
      </span>

      {/* Severity dot */}
      <span className={cn('w-2 h-2 rounded-full flex-shrink-0', SEVERITY_DOT[entry.severity])} />

      {/* Category badge */}
      <span className={cn(
        'text-[10px] font-semibold uppercase px-1.5 py-0 rounded flex-shrink-0 min-w-[48px] text-center',
        SEVERITY_COLORS[entry.severity],
        'bg-white/5'
      )}>
        {categoryLabel}
      </span>

      {/* Summary */}
      <span className={cn('truncate', SEVERITY_COLORS[entry.severity])}>
        {entry.summary}
      </span>
    </button>
  );
});
