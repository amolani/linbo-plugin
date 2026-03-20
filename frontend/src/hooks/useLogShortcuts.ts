import { useEffect } from 'react';
import { useLogStore } from '@/stores/logStore';

/**
 * Registers global keyboard shortcuts for the log panel.
 * Ctrl+Shift+L: Toggle panel
 * Escape: Close panel (when open)
 */
export function useLogShortcuts() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl+Shift+L — toggle log panel
      if (e.ctrlKey && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        useLogStore.getState().togglePanel();
        return;
      }

      // Escape — close panel if open
      if (e.key === 'Escape' && useLogStore.getState().isPanelOpen) {
        // Don't close if focus is inside a modal or input
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
        useLogStore.getState().setPanelOpen(false);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
}
