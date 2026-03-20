import { useEffect } from 'react';
import { useWsStore } from '@/stores/wsStore';
import { useOperationsTrackerStore } from '@/stores/operationsTrackerStore';
import { getEventData } from '@/hooks/useWebSocket';
import type { WsEvent } from '@/types';

export function useOperationsTracker() {
  const subscribe = useWsStore((s) => s.subscribe);

  useEffect(() => {
    const store = useOperationsTrackerStore.getState();

    const unsubs = [
      subscribe('operation.started', (event: WsEvent) => {
        const data = getEventData(event) as {
          operationId: string;
          type: string;
          commands: string;
          hostCount: number;
        };
        store.trackOperation({
          id: data.operationId,
          commands: data.commands,
          type: data.type,
          hostCount: data.hostCount,
          progress: 0,
          status: 'running',
          sessions: {},
          createdAt: event.timestamp,
          completedAt: null,
        });
        // Immediately hydrate from REST to get the full host list with mac/ip
        store.hydrateFromApi(data.operationId);
      }),

      subscribe('session.updated', (event: WsEvent) => {
        const data = getEventData(event) as {
          operationId: string;
          hostname: string;
          status: string;
          error?: string;
        };
        store.updateSession(data.operationId, data.hostname, data.status, data.error);
      }),

      subscribe('operation.progress', (event: WsEvent) => {
        const data = getEventData(event) as {
          operationId: string;
          progress: number;
          completed: number;
          total: number;
        };
        store.updateProgress(data.operationId, data.progress, data.completed, data.total);
      }),

      subscribe('operation.completed', (event: WsEvent) => {
        const data = getEventData(event) as {
          operationId: string;
          status: string;
          stats: { total: number; success: number; failed: number; cancelled: number };
        };
        store.completeOperation(data.operationId, data.status, data.stats);
      }),

      subscribe('_reconnected', () => {
        // Re-hydrate any running operations from REST
        const ops = useOperationsTrackerStore.getState().operations;
        for (const [id, op] of Object.entries(ops)) {
          if (op.status === 'running' || op.status === 'pending') {
            store.hydrateFromApi(id);
          }
        }
      }),
    ];

    return () => unsubs.forEach((fn) => fn());
  }, [subscribe]);
}
