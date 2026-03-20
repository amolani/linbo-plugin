import { Pin, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { SEVERITY_COLORS, CATEGORY_LABELS } from '@/lib/logClassifier';
import { useLogStore } from '@/stores/logStore';
import type { LogEntry } from '@/types';

interface LogEntryDetailProps {
  entry: LogEntry;
  onClose: () => void;
}

export function LogEntryDetail({ entry, onClose }: LogEntryDetailProps) {
  const [copied, setCopied] = useState(false);
  const togglePin = useLogStore((s) => s.togglePin);

  const jsonStr = entry.data != null
    ? JSON.stringify(entry.data, null, 2)
    : 'null';

  async function handleCopy() {
    await navigator.clipboard.writeText(jsonStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="border-l border-border bg-[#111] flex flex-col w-[380px] flex-shrink-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold text-muted-foreground">Detail</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => togglePin(entry.id)}
            className={cn(
              'p-1 rounded hover:bg-white/10 transition-colors',
              entry.pinned ? 'text-primary' : 'text-muted-foreground'
            )}
            title={entry.pinned ? 'Unpin' : 'Pin'}
          >
            <Pin className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded hover:bg-white/10 text-muted-foreground transition-colors"
            title="Kopieren"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-ciGreen" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 text-muted-foreground text-xs"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Meta */}
      <div className="px-3 py-2 space-y-1 text-xs border-b border-border">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Typ</span>
          <span className="font-mono">{entry.type}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Zeit</span>
          <span className="font-mono">{new Date(entry.timestamp).toLocaleString('de-DE')}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Severity</span>
          <span className={cn('font-semibold', SEVERITY_COLORS[entry.severity])}>{entry.severity}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Kategorie</span>
          <span>{CATEGORY_LABELS[entry.category] || entry.category}</span>
        </div>
        {entry.source && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Container</span>
            <span className="font-mono">{entry.source}</span>
          </div>
        )}
      </div>

      {/* JSON Payload */}
      <div className="flex-1 overflow-auto p-3">
        <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-words">
          {jsonStr}
        </pre>
      </div>
    </div>
  );
}
