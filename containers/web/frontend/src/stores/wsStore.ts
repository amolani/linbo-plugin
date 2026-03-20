import { create } from 'zustand';
import type { WsEvent } from '@/types';

interface WsState {
  socket: WebSocket | null;
  isConnected: boolean;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  listeners: Map<string, Set<(event: WsEvent) => void>>;
  connect: () => void;
  disconnect: () => void;
  subscribe: (eventType: string, callback: (event: WsEvent) => void) => () => void;
  send: (message: object) => void;
}

const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
const RECONNECT_DELAY = 3000;

// Module-level rate limiter for WS parse errors (AC1)
let lastWsError = 0;

// Guard against duplicate visibilitychange listeners
let visibilityListenerAdded = false;

export const useWsStore = create<WsState>((set, get) => {
  // Centralized emit — closure over get()
  function emit(event: WsEvent) {
    const { listeners } = get();
    const run = (cbs?: Set<(e: WsEvent) => void>) =>
      cbs?.forEach((cb) => {
        try {
          cb(event);
        } catch (e) {
          console.error('[WS] listener failed', event.type, e);
        }
      });
    run(listeners.get(event.type));
    run(listeners.get('*'));
  }

  return {
    socket: null,
    isConnected: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    listeners: new Map(),

    connect: () => {
      const { socket, maxReconnectAttempts, reconnectAttempts } = get();

      if (socket?.readyState === WebSocket.OPEN) {
        return;
      }

      const token = localStorage.getItem('token');
      const wsUrl = token ? `${WS_URL}?token=${token}` : WS_URL;

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        const wasReconnect = get().reconnectAttempts > 0;
        set({ socket: ws, isConnected: true, reconnectAttempts: 0 });
        if (wasReconnect) {
          // Delay to let server-side state settle, then signal reconnect (AC4)
          setTimeout(() => {
            emit({ type: '_reconnected', data: {}, timestamp: new Date().toISOString() } as WsEvent);
          }, 500);
        }
      };

      ws.onclose = () => {
        set({ isConnected: false });

        // Attempt to reconnect
        if (reconnectAttempts < maxReconnectAttempts) {
          setTimeout(() => {
            set((state) => ({ reconnectAttempts: state.reconnectAttempts + 1 }));
            get().connect();
          }, RECONNECT_DELAY);
        }
      };

      ws.onerror = () => {
        set({ isConnected: false });
      };

      ws.onmessage = (msg) => {
        const raw = typeof msg.data === 'string' ? msg.data : '';
        try {
          const parsed = JSON.parse(raw) as WsEvent;
          emit(parsed);
        } catch (err) {
          const now = Date.now();
          if (now - lastWsError > 60_000) {
            const typeMatch = raw.match(/"type"\s*:\s*"([^"]+)"/);
            const typeHint = typeMatch?.[1] ?? 'unknown';
            console.warn(
              '[WS] Event parse/dispatch failed:',
              err,
              '| type:',
              typeHint,
              '| raw:',
              raw.slice(0, 200)
            );
            lastWsError = now;
          }
        }
      };

      // Register visibilitychange listener once (AC4)
      if (!visibilityListenerAdded) {
        visibilityListenerAdded = true;
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && get().isConnected) {
            emit({ type: '_reconnected', data: {}, timestamp: new Date().toISOString() } as WsEvent);
          }
        });
      }

      set({ socket: ws });
    },

    disconnect: () => {
      const { socket } = get();
      if (socket) {
        socket.close();
        set({ socket: null, isConnected: false });
      }
    },

    subscribe: (eventType: string, callback: (event: WsEvent) => void) => {
      const { listeners } = get();

      if (!listeners.has(eventType)) {
        listeners.set(eventType, new Set());
      }

      listeners.get(eventType)!.add(callback);
      set({ listeners: new Map(listeners) });

      // Return unsubscribe function
      return () => {
        const { listeners } = get();
        const typeListeners = listeners.get(eventType);
        if (typeListeners) {
          typeListeners.delete(callback);
          if (typeListeners.size === 0) {
            listeners.delete(eventType);
          }
          set({ listeners: new Map(listeners) });
        }
      };
    },

    send: (message: object) => {
      const { socket, isConnected } = get();
      if (socket && isConnected) {
        socket.send(JSON.stringify(message));
      }
    },
  };
});
