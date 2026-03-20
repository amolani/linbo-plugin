import { useState, useCallback } from 'react';
import { operationsApi } from '@/api/operations';
import type { SyncHost } from '@/api/sync';
import { notify } from '@/stores/notificationStore';

interface UseSyncHostActionsOptions {
  onActionComplete?: () => void;
}

export function useSyncHostActions(options?: UseSyncHostActionsOptions) {
  const [loadingActions, setLoadingActions] = useState<Set<string>>(new Set());

  const setLoading = useCallback((key: string, loading: boolean) => {
    setLoadingActions(prev => {
      const next = new Set(prev);
      loading ? next.add(key) : next.delete(key);
      return next;
    });
  }, []);

  const isLoading = useCallback(
    (hostname: string, action?: string): boolean =>
      action
        ? loadingActions.has(`${hostname}:${action}`)
        : [...loadingActions].some(k => k.startsWith(`${hostname}:`)),
    [loadingActions]
  );

  const wakeHost = useCallback(async (host: SyncHost) => {
    const key = `${host.hostname}:wake`;
    setLoading(key, true);
    try {
      await operationsApi.wake({ macs: [host.mac] });
      notify.success('Wake-on-LAN', `Magic Packet an ${host.hostname} gesendet`);
      options?.onActionComplete?.();
    } catch (error) {
      notify.error('WoL fehlgeschlagen', error instanceof Error ? error.message : 'Unbekannter Fehler');
    } finally {
      setLoading(key, false);
    }
  }, [setLoading, options]);

  const syncHost = useCallback(async (host: SyncHost) => {
    const key = `${host.hostname}:sync`;
    setLoading(key, true);
    try {
      await operationsApi.direct({ macs: [host.mac], commands: 'sync:1' });
      notify.success('Sync gestartet', `${host.hostname} synchronisiert`);
      options?.onActionComplete?.();
    } catch (error) {
      notify.error('Sync fehlgeschlagen', error instanceof Error ? error.message : 'Unbekannter Fehler');
    } finally {
      setLoading(key, false);
    }
  }, [setLoading, options]);

  const startHost = useCallback(async (host: SyncHost) => {
    const key = `${host.hostname}:start`;
    setLoading(key, true);
    try {
      await operationsApi.direct({ macs: [host.mac], commands: 'start:1' });
      notify.success('Start gesendet', `${host.hostname} wird gestartet`);
      options?.onActionComplete?.();
    } catch (error) {
      notify.error('Start fehlgeschlagen', error instanceof Error ? error.message : 'Unbekannter Fehler');
    } finally {
      setLoading(key, false);
    }
  }, [setLoading, options]);

  const rebootHost = useCallback(async (host: SyncHost) => {
    const key = `${host.hostname}:reboot`;
    setLoading(key, true);
    try {
      await operationsApi.direct({ macs: [host.mac], commands: 'reboot' });
      notify.success('Neustart gesendet', `${host.hostname} wird neu gestartet`);
      options?.onActionComplete?.();
    } catch (error) {
      notify.error('Neustart fehlgeschlagen', error instanceof Error ? error.message : 'Unbekannter Fehler');
    } finally {
      setLoading(key, false);
    }
  }, [setLoading, options]);

  const haltHost = useCallback(async (host: SyncHost) => {
    const key = `${host.hostname}:halt`;
    setLoading(key, true);
    try {
      await operationsApi.direct({ macs: [host.mac], commands: 'halt' });
      notify.success('Herunterfahren gesendet', `${host.hostname} wird heruntergefahren`);
      options?.onActionComplete?.();
    } catch (error) {
      notify.error('Herunterfahren fehlgeschlagen', error instanceof Error ? error.message : 'Unbekannter Fehler');
    } finally {
      setLoading(key, false);
    }
  }, [setLoading, options]);

  return {
    wakeHost,
    syncHost,
    startHost,
    rebootHost,
    haltHost,
    isLoading,
    loadingActions,
  };
}
