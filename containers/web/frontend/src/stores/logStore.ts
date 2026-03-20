import { create } from 'zustand';
import type { LogEntry, LogSeverity, LogCategory, LogTab, WsEvent } from '@/types';
import {
  classifySeverity,
  classifyCategory,
  formatLogSummary,
  classifyApiLogSeverity,
  classifyApiLogCategory,
  classifyContainerLogSeverity,
} from '@/lib/logClassifier';

// --- Constants ---

const MAX_ENTRIES = 10_000;
const INTERNAL_TYPES = new Set(['pong', 'subscribed']);

// --- Filter state ---

interface LogFilters {
  severities: Set<LogSeverity>;
  categories: Set<LogCategory>;
  search: string;
}

// --- Store interface ---

interface LogState {
  entries: LogEntry[];
  activeTab: LogTab;
  selectedContainer: string;
  isPanelOpen: boolean;
  panelHeight: number;
  isLiveTail: boolean;
  isCapturing: boolean;
  filters: LogFilters;

  // Entry counter for unique IDs
  _nextId: number;

  // Actions
  addWsEvent: (event: WsEvent) => void;
  addApiLogBatch: (batch: Array<{ level: string; message: string; timestamp: string }>) => void;
  addContainerLogBatch: (container: string, batch: Array<{ stream: string; message: string; timestamp: string }>) => void;
  clearEntries: (tab?: LogTab) => void;
  setActiveTab: (tab: LogTab) => void;
  setSelectedContainer: (name: string) => void;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  setPanelHeight: (h: number) => void;
  toggleLiveTail: () => void;
  toggleCapture: () => void;
  toggleSeverityFilter: (severity: LogSeverity) => void;
  toggleCategoryFilter: (category: LogCategory) => void;
  setSearch: (search: string) => void;
  resetFilters: () => void;
  togglePin: (id: number) => void;
}

// --- Helper: push to ring buffer ---

function pushToRingBuffer(entries: LogEntry[], newEntries: LogEntry[]): LogEntry[] {
  const combined = [...entries, ...newEntries];
  if (combined.length <= MAX_ENTRIES) return combined;
  return combined.slice(combined.length - MAX_ENTRIES);
}

// --- Default filters ---

const defaultFilters: LogFilters = {
  severities: new Set<LogSeverity>(),
  categories: new Set<LogCategory>(),
  search: '',
};

// --- Store ---

export const useLogStore = create<LogState>((set, get) => ({
  entries: [],
  activeTab: 'events',
  selectedContainer: '',
  isPanelOpen: false,
  panelHeight: 300,
  isLiveTail: true,
  isCapturing: true,
  filters: { ...defaultFilters, severities: new Set(), categories: new Set() },
  _nextId: 1,

  addWsEvent: (event: WsEvent) => {
    const state = get();
    if (!state.isCapturing) return;
    if (INTERNAL_TYPES.has(event.type)) return;

    const id = state._nextId;
    const entry: LogEntry = {
      id,
      timestamp: event.timestamp || new Date().toISOString(),
      receivedAt: Date.now(),
      tab: 'events',
      type: event.type,
      category: classifyCategory(event.type),
      severity: classifySeverity(event.type),
      summary: formatLogSummary(event.type, (event as unknown as Record<string, unknown>).data ?? (event as unknown as Record<string, unknown>).payload),
      data: (event as unknown as Record<string, unknown>).data ?? (event as unknown as Record<string, unknown>).payload,
      pinned: false,
    };

    set({
      entries: pushToRingBuffer(state.entries, [entry]),
      _nextId: id + 1,
    });
  },

  addApiLogBatch: (batch) => {
    const state = get();
    if (!state.isCapturing) return;

    let nextId = state._nextId;
    const newEntries: LogEntry[] = batch.map((item) => ({
      id: nextId++,
      timestamp: item.timestamp,
      receivedAt: Date.now(),
      tab: 'apiLogs' as LogTab,
      type: `console.${item.level}`,
      category: classifyApiLogCategory(item.message),
      severity: classifyApiLogSeverity(item.level),
      summary: item.message,
      data: { level: item.level, message: item.message },
      pinned: false,
    }));

    set({
      entries: pushToRingBuffer(state.entries, newEntries),
      _nextId: nextId,
    });
  },

  addContainerLogBatch: (container, batch) => {
    const state = get();
    if (!state.isCapturing) return;

    // Derive category from container name (e.g. "linbo-tftp" -> "tftp")
    const shortName = container.replace(/^linbo-/, '') as LogCategory;

    let nextId = state._nextId;
    const newEntries: LogEntry[] = batch.map((item) => ({
      id: nextId++,
      timestamp: item.timestamp,
      receivedAt: Date.now(),
      tab: 'container' as LogTab,
      source: container,
      type: item.stream,
      category: shortName,
      severity: classifyContainerLogSeverity(item.stream, item.message),
      summary: item.message,
      data: { stream: item.stream, message: item.message, container },
      pinned: false,
    }));

    set({
      entries: pushToRingBuffer(state.entries, newEntries),
      _nextId: nextId,
    });
  },

  clearEntries: (tab) => {
    if (tab) {
      set((state) => ({ entries: state.entries.filter((e) => e.tab !== tab) }));
    } else {
      set({ entries: [], _nextId: 1 });
    }
  },

  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedContainer: (name) => set({ selectedContainer: name }),
  togglePanel: () => set((s) => ({ isPanelOpen: !s.isPanelOpen })),
  setPanelOpen: (open) => set({ isPanelOpen: open }),
  setPanelHeight: (h) => set({ panelHeight: Math.max(150, Math.min(h, window.innerHeight * 0.6)) }),
  toggleLiveTail: () => set((s) => ({ isLiveTail: !s.isLiveTail })),
  toggleCapture: () => set((s) => ({ isCapturing: !s.isCapturing })),

  toggleSeverityFilter: (severity) =>
    set((state) => {
      const next = new Set(state.filters.severities);
      if (next.has(severity)) next.delete(severity);
      else next.add(severity);
      return { filters: { ...state.filters, severities: next } };
    }),

  toggleCategoryFilter: (category) =>
    set((state) => {
      const next = new Set(state.filters.categories);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return { filters: { ...state.filters, categories: next } };
    }),

  setSearch: (search) =>
    set((state) => ({ filters: { ...state.filters, search } })),

  resetFilters: () =>
    set({ filters: { ...defaultFilters, severities: new Set(), categories: new Set() } }),

  togglePin: (id) =>
    set((state) => ({
      entries: state.entries.map((e) =>
        e.id === id ? { ...e, pinned: !e.pinned } : e
      ),
    })),
}));

// --- Selectors ---

export function selectFilteredEntries(state: LogState): LogEntry[] {
  const { entries, activeTab, selectedContainer, filters } = state;
  const { severities, categories, search } = filters;
  const searchLower = search.toLowerCase();

  return entries.filter((e) => {
    if (e.tab !== activeTab) return false;
    if (activeTab === 'container' && selectedContainer && e.source !== selectedContainer) return false;
    if (severities.size > 0 && !severities.has(e.severity)) return false;
    if (categories.size > 0 && !categories.has(e.category)) return false;
    if (searchLower && !e.summary.toLowerCase().includes(searchLower) && !e.type.toLowerCase().includes(searchLower)) return false;
    return true;
  });
}

export function selectSeverityCounts(state: LogState): Record<LogSeverity, number> {
  const { entries, activeTab, selectedContainer } = state;
  const counts: Record<LogSeverity, number> = { error: 0, warn: 0, success: 0, info: 0, debug: 0 };
  for (const e of entries) {
    if (e.tab !== activeTab) continue;
    if (activeTab === 'container' && selectedContainer && e.source !== selectedContainer) continue;
    counts[e.severity]++;
  }
  return counts;
}
