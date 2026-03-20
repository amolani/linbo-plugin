import { useEffect, useRef, useCallback } from 'react';
import { useWsStore } from '@/stores/wsStore';
import { getEventData } from '@/hooks/useWebSocket';
import { notify } from '@/stores/notificationStore';
import type { WsEvent } from '@/types';

interface UseDataInvalidationOptions {
  debounceMs?: number;
  showToast?: boolean;
}

/**
 * Subscribe to WS entity change events and trigger a debounced refetch.
 *
 * Returns a `suppress(durationMs?)` function that the caller can invoke
 * before its own CRUD action to prevent the WS echo from triggering
 * a redundant refetch. Each hook instance has its own suppress state —
 * suppressing one instance does NOT affect other hooks for the same entity.
 *
 * Events per entity:
 * - Always: `${entity}.created`, `${entity}.updated`, `${entity}.deleted`
 * - config extra: `config.deployed`, `config.raw_updated`
 * - operation: `operation.started`, `operation.completed`, `operation.cancelled`
 *   (NOT operation.progress — AC3)
 * - Reconnect: `_reconnected` (AC4)
 *
 * AC2: Only 1 refetch per debounceMs window per hook instance.
 */
export function useDataInvalidation(
  entity: string | string[],
  refetchFn: () => void,
  options: UseDataInvalidationOptions = {}
): { suppress: (durationMs?: number) => void } {
  const { debounceMs = 500, showToast = false } = options;
  const { subscribe } = useWsStore();

  // Stable refs to avoid re-subscriptions on renders
  const refetchRef = useRef(refetchFn);
  refetchRef.current = refetchFn;

  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  // Per-instance suppress: when suppress() is called, WS-triggered refetch
  // is skipped until suppressedUntil has passed.
  const suppressedUntilRef = useRef(0);

  const suppress = useCallback((durationMs?: number) => {
    suppressedUntilRef.current = Date.now() + (durationMs ?? debounceMs * 2);
  }, [debounceMs]);

  useEffect(() => {
    const entities = Array.isArray(entity) ? entity : [entity];
    const timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };

    function scheduleRefetch() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        // Per-instance dedup: skip if this hook was recently suppressed
        if (Date.now() < suppressedUntilRef.current) {
          return;
        }
        refetchRef.current();
      }, debounceMs);
    }

    // Build event list
    const eventTypes: string[] = ['_reconnected'];
    for (const e of entities) {
      if (e === 'operation') {
        eventTypes.push('operation.started', 'operation.completed', 'operation.cancelled');
      } else {
        eventTypes.push(`${e}.created`, `${e}.updated`, `${e}.deleted`);
      }
      if (e === 'config') {
        eventTypes.push('config.deployed', 'config.raw_updated');
      }
    }

    const handler = (event: WsEvent) => {
      // Show toast for entity changes (not reconnect)
      if (showToastRef.current && event.type !== '_reconnected') {
        const data = getEventData(event) as { id?: string; name?: string };
        const label = data?.name ?? data?.id?.slice(0, 8) ?? '';
        const action = event.type.split('.').pop() ?? '';
        const entityName = event.type.split('.')[0] ?? '';

        const actionLabels: Record<string, string> = {
          created: 'erstellt',
          updated: 'aktualisiert',
          deleted: 'gelöscht',
          deployed: 'deployed',
          raw_updated: 'aktualisiert (raw)',
          started: 'gestartet',
          completed: 'abgeschlossen',
          cancelled: 'abgebrochen',
        };

        const entityLabels: Record<string, string> = {
          host: 'Host',
          room: 'Raum',
          config: 'Konfiguration',
          image: 'Image',
          operation: 'Operation',
        };

        const actionText = actionLabels[action] ?? action;
        const entityText = entityLabels[entityName] ?? entityName;

        if (label) {
          notify.info(`${entityText} ${actionText}`, label);
        }
      }

      scheduleRefetch();
    };

    // Subscribe to all relevant events
    const unsubscribes = eventTypes.map((et) => subscribe(et, handler));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [
    // Stringify entity array for stable deps
    Array.isArray(entity) ? entity.join(',') : entity,
    debounceMs,
    subscribe,
  ]);

  return { suppress };
}
