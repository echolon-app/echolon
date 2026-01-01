import React, { useRef, useEffect } from 'react';
import { Button } from '@/components/ui';
import { 
  ClearIcon, InfoIcon, WarnIcon, ConsoleErrorIcon as ErrorIcon, SuccessIcon 
} from '@/components/ui/icons';
import { useApp } from '@/contexts';
import { ConsoleEntry } from '@/types';
import { formatTime } from '@/utils';
import './ConsolePanel.css';

const getIcon = (type: ConsoleEntry['type']) => {
  switch (type) {
    case 'info': return <InfoIcon />;
    case 'warn': return <WarnIcon />;
    case 'error': return <ErrorIcon />;
    case 'success': return <SuccessIcon />;
    default: return <InfoIcon />;
  }
};

export const ConsolePanel: React.FC = () => {
  const { consoleEntries, clearConsole } = useApp();
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries are added
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [consoleEntries.length]);


  return (
    <div className="console-panel">
      <div className="console-panel__header">
        <span className="console-panel__title">Console</span>
        <div className="console-panel__actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={clearConsole}
            disabled={consoleEntries.length === 0}
            icon={<ClearIcon />}
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="console-panel__content" ref={listRef}>
        {consoleEntries.length === 0 ? (
          <div className="console-panel__empty">
            <p>Console output will appear here</p>
          </div>
        ) : (
          consoleEntries.map(entry => (
            <div key={entry.id} className={`console-panel__entry console-panel__entry--${entry.type}`}>
              <span className="console-panel__entry-icon">{getIcon(entry.type)}</span>
              <span className="console-panel__entry-time">{formatTime(entry.timestamp)}</span>
              <span className="console-panel__entry-message">{entry.message}</span>
              {entry.details && (
                <pre className="console-panel__entry-details">{entry.details}</pre>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ConsolePanel;

