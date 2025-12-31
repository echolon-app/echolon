import React from 'react';
import { Button, Tooltip } from '@/components/ui';
import { SidebarIcon, PanelLeftIcon, ConsoleIcon, ClearIcon, ThunderboltIcon } from '@/components/ui/icons';
import { useApp } from '@/contexts';
import './BottomBar.css';

export const BottomBar: React.FC = () => {
  const { 
    sidebarState,
    cycleSidebarState,
    leftPanelVisible,
    toggleLeftPanel,
    consoleVisible, 
    toggleConsole,
    consoleEntries,
    clearConsole,
    openShortcutsModal
  } = useApp();

  const getSidebarTooltip = () => {
    if (sidebarState === 'hidden') return 'Show sidebar';
    if (sidebarState === 'collapsed') return 'Expand sidebar';
    return 'Hide sidebar';
  };

  return (
    <div className="bottom-bar">
      <div className="bottom-bar__left">
        <Tooltip content={getSidebarTooltip()} position="top">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={cycleSidebarState}
            className={sidebarState !== 'hidden' ? 'active' : ''}
          >
            <SidebarIcon />
          </Button>
        </Tooltip>
        <Tooltip content={leftPanelVisible ? 'Hide collections panel' : 'Show collections panel'} position="top">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={toggleLeftPanel}
            className={leftPanelVisible ? 'active' : ''}
          >
            <PanelLeftIcon />
          </Button>
        </Tooltip>
      </div>

      <div className="bottom-bar__center">
        {/* Status messages can go here */}
      </div>

      <div className="bottom-bar__right">
        <Tooltip content={consoleVisible ? 'Hide console' : 'Show console'} position="top">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={toggleConsole}
            className={consoleVisible ? 'active' : ''}
          >
            <ConsoleIcon />
            {consoleEntries.length > 0 && (
              <span className="bottom-bar__badge">{consoleEntries.length}</span>
            )}
          </Button>
        </Tooltip>
        {consoleVisible && consoleEntries.length > 0 && (
          <Tooltip content="Clear console" position="top">
            <Button variant="ghost" size="sm" onClick={clearConsole}>
              <ClearIcon />
            </Button>
          </Tooltip>
        )}
        <Tooltip content="Keyboard shortcuts" position="top">
          <Button variant="ghost" size="sm" onClick={openShortcutsModal}>
            <ThunderboltIcon />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
};

export default BottomBar;

