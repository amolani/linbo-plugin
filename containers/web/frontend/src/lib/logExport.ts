import type { LogEntry } from '@/types';

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export function exportAsJson(entries: LogEntry[]) {
  const data = entries.map(({ id, timestamp, type, category, severity, summary, data, source }) => ({
    id, timestamp, type, category, severity, summary, source, data,
  }));
  downloadFile(`linbo-logs-${timestamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

export function exportAsText(entries: LogEntry[]) {
  const lines = entries.map((e) => {
    const ts = new Date(e.timestamp).toLocaleString('de-DE');
    const sev = e.severity.toUpperCase().padEnd(7);
    const cat = `[${e.category}]`.padEnd(16);
    return `${ts}  ${sev}  ${cat}  ${e.summary}`;
  });
  downloadFile(`linbo-logs-${timestamp()}.log`, lines.join('\n'), 'text/plain');
}
