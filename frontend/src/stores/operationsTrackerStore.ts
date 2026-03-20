import { create } from 'zustand';
import { operationsApi } from '@/api/operations';

export interface TrackedSession {
  hostname: string;
  mac?: string;
  ip?: string;
  status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface TrackedOperation {
  id: string;
  commands: string;
  type: string;
  hostCount: number;
  progress: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'completed_with_errors' | 'cancelling';
  sessions: Record<string, TrackedSession>;
  createdAt: string;
  completedAt: string | null;
}

interface OperationsTrackerState {
  operations: Record<string, TrackedOperation>;
  activeCount: number;
  isPanelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  trackOperation: (op: TrackedOperation) => void;
  updateSession: (operationId: string, hostname: string, status: string, error?: string) => void;
  updateProgress: (operationId: string, progress: number, completed: number, total: number) => void;
  completeOperation: (operationId: string, status: string, stats: { total: number; success: number; failed: number; cancelled: number }) => void;
  clearCompleted: () => void;
  hydrateFromApi: (operationId: string) => Promise<void>;
}

function countActive(operations: Record<string, TrackedOperation>): number {
  return Object.values(operations).filter(
    (op) => op.status === 'pending' || op.status === 'running'
  ).length;
}

export const useOperationsTrackerStore = create<OperationsTrackerState>((set, get) => ({
  operations: {},
  activeCount: 0,
  isPanelOpen: false,

  openPanel: () => set({ isPanelOpen: true }),
  closePanel: () => set({ isPanelOpen: false }),

  trackOperation: (op: TrackedOperation) => {
    set((state) => {
      const operations = { ...state.operations, [op.id]: op };
      return { operations, activeCount: countActive(operations) };
    });
  },

  updateSession: (operationId: string, hostname: string, status: string, error?: string) => {
    set((state) => {
      const op = state.operations[operationId];
      if (!op) return state;

      const existingSession = op.sessions[hostname];
      const updatedSession: TrackedSession = {
        hostname,
        mac: existingSession?.mac,
        ip: existingSession?.ip,
        status: status as TrackedSession['status'],
        error: error ?? existingSession?.error ?? null,
        startedAt: existingSession?.startedAt ?? (status === 'running' ? new Date().toISOString() : null),
        completedAt: ['success', 'failed', 'cancelled'].includes(status)
          ? new Date().toISOString()
          : existingSession?.completedAt ?? null,
      };

      const operations = {
        ...state.operations,
        [operationId]: {
          ...op,
          sessions: { ...op.sessions, [hostname]: updatedSession },
        },
      };
      return { operations };
    });
  },

  updateProgress: (operationId: string, progress: number, _completed: number, _total: number) => {
    set((state) => {
      const op = state.operations[operationId];
      if (!op) return state;

      const operations = {
        ...state.operations,
        [operationId]: { ...op, progress },
      };
      return { operations };
    });
  },

  completeOperation: (operationId: string, status: string, stats: { total: number; success: number; failed: number; cancelled: number }) => {
    set((state) => {
      const op = state.operations[operationId];
      if (!op) return state;

      const operations = {
        ...state.operations,
        [operationId]: {
          ...op,
          status: status as TrackedOperation['status'],
          progress: 100,
          completedAt: new Date().toISOString(),
          hostCount: stats.total || op.hostCount,
        },
      };
      return { operations, activeCount: countActive(operations) };
    });

    // Auto-eviction: remove completed operations after 5 minutes
    setTimeout(() => {
      const currentOp = get().operations[operationId];
      if (currentOp && currentOp.status !== 'running' && currentOp.status !== 'pending') {
        set((state) => {
          const { [operationId]: _removed, ...remaining } = state.operations;
          return { operations: remaining, activeCount: countActive(remaining) };
        });
      }
    }, 5 * 60 * 1000);
  },

  clearCompleted: () => {
    set((state) => {
      const operations: Record<string, TrackedOperation> = {};
      for (const [id, op] of Object.entries(state.operations)) {
        if (op.status === 'pending' || op.status === 'running') {
          operations[id] = op;
        }
      }
      return { operations, activeCount: countActive(operations) };
    });
  },

  hydrateFromApi: async (operationId: string) => {
    try {
      const apiOp = await operationsApi.get(operationId);
      set((state) => {
        const existingOp = state.operations[operationId];
        if (!existingOp) return state;

        // Merge API data into tracked operation
        const sessions: Record<string, TrackedSession> = { ...existingOp.sessions };

        // The REST API returns sessions as Record<hostname, session> or as array
        const apiSessions = apiOp.sessions;
        if (apiSessions && typeof apiSessions === 'object') {
          // Handle both array and record formats
          const sessionEntries = Array.isArray(apiSessions)
            ? apiSessions
            : Object.values(apiSessions);

          for (const s of sessionEntries) {
            const sessionData = s as {
              hostname?: string;
              mac?: string;
              ip?: string;
              ipAddress?: string;
              status?: string;
              error?: string;
              startedAt?: string;
              completedAt?: string;
            };
            const hostname = sessionData.hostname;
            if (!hostname) continue;

            // Merge: WS data takes precedence if already present
            const existing = sessions[hostname];
            sessions[hostname] = {
              hostname,
              mac: existing?.mac ?? sessionData.mac,
              ip: existing?.ip ?? sessionData.ip ?? sessionData.ipAddress,
              status: existing?.status ?? (sessionData.status as TrackedSession['status']) ?? 'queued',
              error: existing?.error ?? sessionData.error ?? null,
              startedAt: existing?.startedAt ?? sessionData.startedAt ?? null,
              completedAt: existing?.completedAt ?? sessionData.completedAt ?? null,
            };
          }
        }

        const operations = {
          ...state.operations,
          [operationId]: {
            ...existingOp,
            sessions,
            commands: apiOp.commands?.join(', ') ?? existingOp.commands,
            hostCount: apiOp.targetHosts?.length ?? existingOp.hostCount,
            progress: apiOp.progress ?? existingOp.progress,
            status: (apiOp.status as TrackedOperation['status']) ?? existingOp.status,
          },
        };
        return { operations, activeCount: countActive(operations) };
      });
    } catch (err) {
      console.warn('[OperationsTracker] Failed to hydrate operation', operationId, err);
    }
  },
}));
