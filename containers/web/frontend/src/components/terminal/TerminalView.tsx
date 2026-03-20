import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

/** Global registry: sessionId → write function (used by TerminalPage output handler) */
const terminalWriters = new Map<string, (data: string) => void>();

export function getTerminalWriter(sessionId: string) {
  return terminalWriters.get(sessionId);
}

interface TerminalViewProps {
  sessionId: string | null;
  onInput: (sessionId: string, data: string) => void;
  onResize: (sessionId: string, cols: number, rows: number) => void;
  isActive: boolean;
}

export function TerminalView({ sessionId, onInput, onResize, isActive }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef(sessionId);

  // Keep sessionId ref current
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
      theme: {
        background: '#0a0a0a',
        foreground: '#e0e0e0',
        cursor: '#3b82f6',
        selectionBackground: '#3b82f680',
        black: '#1a1a1a',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e0e0e0',
        brightBlack: '#525252',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#fde047',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
      scrollback: 5000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);

    // Fit after opening
    try {
      fitAddon.fit();
    } catch {
      // Container might not be visible yet
    }

    // Handle user input
    term.onData((data) => {
      const sid = sessionIdRef.current;
      if (sid) onInput(sid, data);
    });

    termRef.current = term;
    fitRef.current = fitAddon;

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        const sid = sessionIdRef.current;
        if (sid) {
          onResize(sid, term.cols, term.rows);
        }
      } catch {
        // ignore
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit when tab becomes active
  useEffect(() => {
    if (isActive && fitRef.current) {
      // Small delay for DOM to settle
      const t = setTimeout(() => {
        try {
          fitRef.current?.fit();
          termRef.current?.focus();
        } catch {}
      }, 50);
      return () => clearTimeout(t);
    }
  }, [isActive]);

  // Register write handler in global map so parent can write output
  useEffect(() => {
    if (sessionId) {
      terminalWriters.set(sessionId, (data: string) => {
        termRef.current?.write(data);
      });
      return () => { terminalWriters.delete(sessionId); };
    }
  }, [sessionId]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ minHeight: '300px' }}
    />
  );
}
