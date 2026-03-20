import { useEffect } from 'react';
import { useWsStore } from '@/stores/wsStore';
import { useLogStore } from '@/stores/logStore';
import type { WsEvent } from '@/types';

/**
 * Subscribes to ALL WebSocket events via wildcard and feeds them into the logStore.
 * Must be called once in AppLayout (stays mounted across navigation).
 */
export function useLogCapture() {
  useEffect(() => {
    const unsubscribe = useWsStore.getState().subscribe('*', (event: WsEvent) => {
      // api.log.batch events go to the API Logs tab
      if (event.type === 'api.log.batch') {
        const data = (event as unknown as Record<string, unknown>).data as {
          entries?: Array<{ level: string; message: string; timestamp: string }>;
        } | undefined;
        if (data?.entries) {
          useLogStore.getState().addApiLogBatch(data.entries);
        }
        return;
      }

      // container.log.batch events go to the Container tab
      if (event.type === 'container.log.batch') {
        const data = (event as unknown as Record<string, unknown>).data as {
          container?: string;
          entries?: Array<{ stream: string; message: string; timestamp: string }>;
        } | undefined;
        if (data?.container && data?.entries) {
          useLogStore.getState().addContainerLogBatch(data.container, data.entries);
        }
        return;
      }

      // Everything else goes to the Events tab
      useLogStore.getState().addWsEvent(event);
    });

    return unsubscribe;
  }, []);
}
