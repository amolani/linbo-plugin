import { useRef, useCallback, useEffect, useState } from 'react';

const WS_BASE = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/terminal`;

export interface TerminalWsMessage {
  type: string;
  sessionId?: string;
  hostIp?: string;
  data?: string;
  reason?: string;
  error?: string;
  cols?: number;
  rows?: number;
}

type MessageHandler = (msg: TerminalWsMessage) => void;

export function useTerminalWs() {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  const [isConnected, setIsConnected] = useState(false);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const token = localStorage.getItem('token');
    if (!token) return;

    const ws = new WebSocket(`${WS_BASE}?token=${token}`);

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onclose = () => {
      setIsConnected(false);
      wsRef.current = null;
    };

    ws.onerror = () => {
      setIsConnected(false);
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data) as TerminalWsMessage;
        handlersRef.current.forEach((h) => h(msg));
      } catch {
        // ignore
      }
    };

    wsRef.current = ws;
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setIsConnected(false);
  }, []);

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const onMessage = useCallback((handler: MessageHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  return { connect, disconnect, send, onMessage, isConnected };
}
