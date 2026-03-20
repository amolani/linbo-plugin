import { useEffect } from 'react';
import { useLogStore } from '@/stores/logStore';
import { apiClient } from '@/api/client';

/**
 * Fetches recent API logs on mount (catchup) for the API Logs tab.
 * WS streaming of api.log.batch is already handled by useLogCapture.
 */
export function useApiLogCatchup() {
  const activeTab = useLogStore((s) => s.activeTab);

  useEffect(() => {
    if (activeTab !== 'apiLogs') return;

    let cancelled = false;

    async function fetchCatchup() {
      try {
        const res = await apiClient.get('/system/logs', { params: { limit: 200 } });
        if (cancelled) return;
        const entries = res.data?.entries;
        if (Array.isArray(entries) && entries.length > 0) {
          useLogStore.getState().addApiLogBatch(entries);
        }
      } catch {
        // Silent fail — catchup is best-effort
      }
    }

    fetchCatchup();
    return () => { cancelled = true; };
  }, [activeTab]);
}
