import { useEffect, useState } from 'react';
import { useLogStore } from '@/stores/logStore';
import { useWsStore } from '@/stores/wsStore';
import { apiClient } from '@/api/client';

interface ContainerInfo {
  name: string;
  id: string;
  state: string;
  status: string;
  image: string;
}

/**
 * Fetches available Docker containers.
 */
export function useContainerList() {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    async function fetch() {
      try {
        const res = await apiClient.get('/system/containers');
        setContainers(res.data?.containers || []);
        setAvailable(res.data?.available ?? false);
      } catch {
        setContainers([]);
        setAvailable(false);
      }
    }
    fetch();
  }, []);

  return { containers, available };
}

/**
 * Subscribes to container log streaming via WebSocket.
 * Sends subscribe/unsubscribe messages and fetches catchup on mount.
 */
export function useContainerLogStream() {
  const activeTab = useLogStore((s) => s.activeTab);
  const selectedContainer = useLogStore((s) => s.selectedContainer);

  useEffect(() => {
    if (activeTab !== 'container' || !selectedContainer) return;

    const ws = useWsStore.getState();

    // Subscribe to container logs
    ws.send({
      type: 'container.logs.subscribe',
      data: { container: selectedContainer },
    });

    // Fetch catchup logs
    apiClient
      .get(`/system/containers/${selectedContainer}/logs`, { params: { tail: 200 } })
      .then((res) => {
        const entries = res.data?.entries;
        if (Array.isArray(entries) && entries.length > 0) {
          useLogStore.getState().addContainerLogBatch(selectedContainer, entries);
        }
      })
      .catch(() => {});

    // Cleanup: unsubscribe on container change or tab change
    return () => {
      ws.send({
        type: 'container.logs.unsubscribe',
        data: { container: selectedContainer },
      });
    };
  }, [activeTab, selectedContainer]);
}
