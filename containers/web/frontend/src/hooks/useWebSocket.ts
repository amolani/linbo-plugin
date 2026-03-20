import { useEffect, useRef } from 'react';
import { useWsStore } from '@/stores/wsStore';
import { notify } from '@/stores/notificationStore';
import type { WsEvent, WsNotificationEvent } from '@/types';

// Module-level — warns max 1x per page load
let legacyWarned = false;

/**
 * Extract event data with legacy fallback.
 * Prefers .data (current API contract), falls back to .payload (legacy).
 * Returns `unknown` — caller must cast/assert.
 */
export function getEventData(event: WsEvent): unknown {
  if ('data' in event && event.data != null) return event.data;
  if ('payload' in event && event.payload != null) {
    if (!legacyWarned) {
      console.warn('[WS] Legacy payload field used for event:', event.type, '— migrate to data');
      legacyWarned = true;
    }
    return event.payload;
  }
  return {};
}

export function useWebSocket() {
  const { connect, disconnect, isConnected, subscribe, send } = useWsStore();

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return { isConnected, subscribe, send };
}

export function useNotificationEvents() {
  const { subscribe } = useWsStore();

  useEffect(() => {
    const unsubscribe = subscribe('notification', (event: WsEvent) => {
      const data = getEventData(event) as WsNotificationEvent['data'];
      notify[data.level](data.title, data.message);
    });

    return unsubscribe;
  }, [subscribe]);
}

export function useWsEventHandler<T extends WsEvent>(
  eventType: string,
  handler: (event: T) => void
) {
  const { subscribe } = useWsStore();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unsubscribe = subscribe(eventType, (event: WsEvent) => {
      handlerRef.current(event as T);
    });
    return unsubscribe;
  }, [subscribe, eventType]);
}
