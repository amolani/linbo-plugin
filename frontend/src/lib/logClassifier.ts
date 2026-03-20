import type { LogSeverity, LogCategory } from '@/types';

// --- Severity classification ---

const ERROR_SUFFIXES = ['.failed', '.error'];
const WARN_SUFFIXES = ['.cancelled', '.cancelling', '.retrying'];
const SUCCESS_SUFFIXES = ['.completed', '.created', '.deployed', '.switched', '.updated', '.initialized', '.deleted', '.reset'];
const DEBUG_TYPES = new Set(['connected', 'subscribed', 'pong', '_reconnected']);

export function classifySeverity(eventType: string): LogSeverity {
  if (DEBUG_TYPES.has(eventType)) return 'debug';
  if (eventType.includes('.progress')) return 'debug';
  for (const s of ERROR_SUFFIXES) if (eventType.endsWith(s)) return 'error';
  for (const s of WARN_SUFFIXES) if (eventType.endsWith(s)) return 'warn';
  for (const s of SUCCESS_SUFFIXES) if (eventType.endsWith(s)) return 'success';
  return 'info';
}

// --- Category classification ---

const KNOWN_PREFIXES: LogCategory[] = [
  'host', 'operation', 'session', 'sync', 'config',
  'image', 'system', 'provision', 'patchclass', 'drivers', 'rsync',
  'macct', 'room', 'notification',
];

export function classifyCategory(eventType: string): LogCategory {
  if (eventType === 'notification') return 'notification';
  const prefix = eventType.split('.')[0];
  if (KNOWN_PREFIXES.includes(prefix as LogCategory)) return prefix as LogCategory;
  return 'other';
}

// --- Category display ---

export const CATEGORY_LABELS: Partial<Record<LogCategory, string>> = {
  host: 'Host',
  operation: 'Operation',
  session: 'Session',
  sync: 'Sync',
  config: 'Config',
  image: 'Image',
  system: 'System',
  provision: 'Provision',
  patchclass: 'Treiber',
  drivers: 'Treiber',
  rsync: 'Rsync',
  macct: 'Macct',
  room: 'Raum',
  notification: 'Benachrichtigung',
  other: 'Sonstige',
  http: 'HTTP',
  api: 'API',
  ws: 'WebSocket',
  redis: 'Redis',
  db: 'Datenbank',
  worker: 'Worker',
  tftp: 'TFTP',
  ssh: 'SSH',
  dhcp: 'DHCP',
  init: 'Init',
  cache: 'Cache',
  web: 'Web',
};

export const SEVERITY_COLORS: Record<LogSeverity, string> = {
  error: 'text-destructive',
  warn: 'text-yellow-400',
  success: 'text-ciGreen',
  info: 'text-primary',
  debug: 'text-muted-foreground',
};

export const SEVERITY_BG: Record<LogSeverity, string> = {
  error: 'bg-destructive/20',
  warn: 'bg-yellow-400/20',
  success: 'bg-ciGreen/20',
  info: 'bg-primary/20',
  debug: 'bg-muted/20',
};

export const SEVERITY_DOT: Record<LogSeverity, string> = {
  error: 'bg-destructive',
  warn: 'bg-yellow-400',
  success: 'bg-ciGreen',
  info: 'bg-primary',
  debug: 'bg-muted-foreground',
};

// --- Summary generator ---

export function formatLogSummary(eventType: string, data: unknown): string {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  // Host events
  if (eventType === 'host.status.changed') {
    return `Host ${d.hostname || d.hostId || '?'} ist jetzt ${d.status}`;
  }
  if (eventType === 'host.created') return `Host ${d.hostname || d.name || '?'} erstellt`;
  if (eventType === 'host.deleted') return `Host ${d.hostname || d.name || '?'} gelöscht`;

  // Sync events
  if (eventType === 'sync.started') return 'Synchronisation gestartet';
  if (eventType === 'sync.completed') {
    const s = d.stats as Record<string, unknown> | undefined;
    return s ? `Sync abgeschlossen: ${s.hosts} Hosts, ${s.configs} Configs` : 'Sync abgeschlossen';
  }
  if (eventType === 'sync.failed') return `Sync fehlgeschlagen: ${d.error || 'Unbekannt'}`;
  if (eventType === 'sync.progress') return `Sync: ${d.progress || 0}%`;

  // Image sync/push events
  if (eventType.startsWith('image.sync.')) {
    const img = d.imageName || d.filename || '?';
    if (eventType === 'image.sync.progress') return `Image-Sync ${img}: ${d.percent || d.progress || 0}%`;
    if (eventType === 'image.sync.completed') return `Image-Sync ${img} abgeschlossen`;
    if (eventType === 'image.sync.failed') return `Image-Sync ${img} fehlgeschlagen`;
    if (eventType === 'image.sync.started') return `Image-Sync ${img} gestartet`;
    if (eventType === 'image.sync.queued') return `Image-Sync ${img} in Warteschlange`;
    if (eventType === 'image.sync.cancelled') return `Image-Sync ${img} abgebrochen`;
  }
  if (eventType.startsWith('image.push.')) {
    const img = d.imageName || d.filename || '?';
    if (eventType === 'image.push.progress') return `Image-Push ${img}: ${d.percent || d.progress || 0}%`;
    if (eventType === 'image.push.completed') return `Image-Push ${img} abgeschlossen`;
    if (eventType === 'image.push.failed') return `Image-Push ${img} fehlgeschlagen`;
    if (eventType === 'image.push.started') return `Image-Push ${img} gestartet`;
  }

  // Operation events
  if (eventType === 'operation.started') return `Operation ${d.operationId || '?'} gestartet`;
  if (eventType === 'operation.completed') return `Operation ${d.operationId || '?'} abgeschlossen`;
  if (eventType === 'operation.failed') return `Operation fehlgeschlagen: ${d.error || 'Unbekannt'}`;
  if (eventType === 'operation.progress') return `Operation: ${d.progress || 0}%`;

  // Config events
  if (eventType === 'config.deployed') return `Config ${d.name || d.id || '?'} deployed`;
  if (eventType === 'config.created') return `Config ${d.name || '?'} erstellt`;
  if (eventType === 'config.updated') return `Config ${d.name || '?'} aktualisiert`;
  if (eventType === 'config.deleted') return `Config ${d.name || '?'} gelöscht`;

  // System events
  if (eventType === 'system.kernel_switched') return `Kernel gewechselt zu ${d.variant || '?'}`;
  if (eventType === 'system.kernel_switch_failed') return `Kernel-Wechsel fehlgeschlagen: ${d.error || '?'}`;
  if (eventType === 'system.linbofs_updated') return 'linbofs64 aktualisiert';
  if (eventType === 'system.firmware_changed') return 'Firmware-Konfiguration geändert';
  if (eventType.startsWith('system.grub_theme_')) return `GRUB Theme: ${eventType.split('system.grub_theme_')[1]}`;

  // Notification
  if (eventType === 'notification') {
    const level = d.level || 'info';
    return `[${level}] ${d.title || d.message || 'Benachrichtigung'}`;
  }

  // Provision / macct
  if (eventType.startsWith('provision.')) return `Provision ${d.hostname || d.hostId || '?'}: ${eventType.split('.').pop()}`;
  if (eventType.startsWith('macct.')) return `Machine Account ${d.hostname || '?'}: ${eventType.split('.').pop()}`;

  // Room events
  if (eventType.startsWith('room.')) return `Raum ${d.name || d.id || '?'}: ${eventType.split('.').pop()}`;

  // Internal/meta
  if (eventType === 'connected') return 'WebSocket verbunden';
  if (eventType === 'subscribed') return 'Channels abonniert';
  if (eventType === '_reconnected') return 'WebSocket wiederverbunden';

  // Fallback: use event type as summary
  return eventType;
}

// --- API log severity from console method ---

export function classifyApiLogSeverity(level: string): LogSeverity {
  switch (level) {
    case 'error': return 'error';
    case 'warn': return 'warn';
    case 'debug': return 'debug';
    default: return 'info';
  }
}

// --- API log category heuristic ---

// --- Container log severity (smarter than just stderr=error) ---

// Patterns that look like errors but are harmless noise
const HARMLESS_STDERR_PATTERNS = [
  /\/health\s+HTTP/,                          // Health check requests
  /\[notice\]/,                               // nginx notice level
  /\[warn\]/,                                 // nginx warn (not error)
  /worker process \d+ exiting/,               // nginx graceful shutdown
  /signal \d+ .* received/,                   // nginx signal handling
  /reopen/i,                                  // log reopen
  /\bstarting\b/i,                            // service starting
  /\blistening\b/i,                           // service listening
];

// Patterns that are definitely real errors
const REAL_ERROR_PATTERNS = [
  /segfault|segmentation fault/i,
  /out of memory|OOM/i,
  /panic|fatal/i,
  /ENOSPC|No space left/i,
  /permission denied/i,
  /\bcorrupt/i,
];

export function classifyContainerLogSeverity(stream: string, message: string): LogSeverity {
  // stdout is always info
  if (stream !== 'stderr') return 'info';

  // Check for definitely-real errors first
  for (const p of REAL_ERROR_PATTERNS) {
    if (p.test(message)) return 'error';
  }

  // Check for known harmless patterns → downgrade to debug
  for (const p of HARMLESS_STDERR_PATTERNS) {
    if (p.test(message)) return 'debug';
  }

  // nginx "connect() failed" to upstream during restart → warn, not error
  if (/connect\(\) failed.*upstream/.test(message)) return 'warn';

  // Remaining stderr → warn (not error — stderr ≠ error)
  return 'warn';
}

// --- API log category heuristic ---

export function classifyApiLogCategory(message: string): LogCategory {
  if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s/.test(message)) return 'http';
  if (/\[ws\]|\[WS\]|websocket/i.test(message)) return 'ws';
  if (/\[redis\]|redis/i.test(message)) return 'redis';
  if (/\[prisma\]|\[db\]|database/i.test(message)) return 'db';
  if (/\[worker\]|worker/i.test(message)) return 'worker';
  return 'api';
}
