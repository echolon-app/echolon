import { useEffect, useCallback } from 'react';

type ShortcutHandler = () => void;

interface Shortcut {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: ShortcutHandler;
}

export function useShortcuts(shortcuts: Shortcut[]) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

      for (const shortcut of shortcuts) {
        const cmdMatch = isMac ? e.metaKey : e.ctrlKey;
        const metaMatch = shortcut.meta ? cmdMatch : true;
        const ctrlMatch = shortcut.ctrl ? e.ctrlKey : true;
        const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;
        const altMatch = shortcut.alt ? e.altKey : !e.altKey;

        if (
          e.key.toLowerCase() === shortcut.key.toLowerCase() &&
          metaMatch &&
          ctrlMatch &&
          shiftMatch &&
          altMatch
        ) {
          e.preventDefault();
          shortcut.handler();
          return;
        }
      }
    },
    [shortcuts]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

export function useGlobalShortcuts(handlers: {
  onSendRequest?: () => void;
  onOpenSettings?: () => void;
  onNewRequest?: () => void;
  onNewCollection?: () => void;
  onSaveRequest?: () => void;
  onOpenSearch?: () => void;
  onToggleSidebar?: () => void;
  onToggleConsole?: () => void;
}) {
  const shortcuts: Shortcut[] = [];

  if (handlers.onSendRequest) {
    shortcuts.push({
      key: 'Enter',
      meta: true,
      handler: handlers.onSendRequest,
    });
  }

  if (handlers.onOpenSettings) {
    shortcuts.push({
      key: ',',
      meta: true,
      handler: handlers.onOpenSettings,
    });
  }

  if (handlers.onNewRequest) {
    shortcuts.push({
      key: 'n',
      meta: true,
      handler: handlers.onNewRequest,
    });
  }

  if (handlers.onNewCollection) {
    shortcuts.push({
      key: 'n',
      meta: true,
      shift: true,
      handler: handlers.onNewCollection,
    });
  }

  if (handlers.onSaveRequest) {
    shortcuts.push({
      key: 's',
      meta: true,
      handler: handlers.onSaveRequest,
    });
  }

  if (handlers.onOpenSearch) {
    shortcuts.push({
      key: 'k',
      meta: true,
      handler: handlers.onOpenSearch,
    });
  }

  if (handlers.onToggleSidebar) {
    shortcuts.push({
      key: 'b',
      meta: true,
      handler: handlers.onToggleSidebar,
    });
  }

  if (handlers.onToggleConsole) {
    shortcuts.push({
      key: '`',
      meta: true,
      handler: handlers.onToggleConsole,
    });
  }

  useShortcuts(shortcuts);
}

export default useShortcuts;

