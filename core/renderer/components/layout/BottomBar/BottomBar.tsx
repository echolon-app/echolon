import React from 'react';
import { Button, Tooltip } from '@/components/ui';
import { SidebarIcon, PanelLeftIcon, ConsoleIcon, ClearIcon, ThunderboltIcon, MailIcon, BookIcon } from '@/components/ui/icons';
import { useApp, useMocking, useUpdateOptional, useWebModeOptional } from '@/contexts';
import { APP_VERSION } from '@/utils/environment';
import './BottomBar.css';

export const BottomBar: React.FC = () => {
  const { 
    sidebarState,
    sidebarView,
    cycleSidebarState,
    leftPanelVisible,
    toggleLeftPanel,
    consoleVisible, 
    toggleConsole,
    consoleEntries,
    clearConsole,
    openShortcutsModal,
    openSettingsModal
  } = useApp();
  
  const { capturedRequests, activeMockApiId } = useMocking();
  const update = useUpdateOptional();
  const webMode = useWebModeOptional();
  const isWebMode = webMode?.isWebMode ?? false;
  const viewMode = webMode?.viewMode ?? 'tabs';
  
  // In reference view mode (web), hide sidebar toggle buttons
  const hideToggleButtons = isWebMode && viewMode === 'reference';

  const handleSupportClick = async () => {
    const version = APP_VERSION || 'unknown';
    const platform = navigator.platform || 'unknown';
    const userAgent = navigator.userAgent || 'unknown';
    
    // Extract OS info from userAgent
    let osInfo = 'Unknown OS';
    if (userAgent.includes('Mac')) {
      const match = userAgent.match(/Mac OS X ([0-9_]+)/);
      osInfo = match ? `macOS ${match[1].replace(/_/g, '.')}` : 'macOS';
    } else if (userAgent.includes('Windows')) {
      const match = userAgent.match(/Windows NT ([0-9.]+)/);
      osInfo = match ? `Windows NT ${match[1]}` : 'Windows';
    } else if (userAgent.includes('Linux')) {
      osInfo = 'Linux';
    }

    const subject = encodeURIComponent(`Echolon-In-App-Support ${version}`);
    const body = encodeURIComponent(
`--- System Information ---
App Version: ${version}
Operating System: ${osInfo}
Platform: ${platform}
User Agent: ${userAgent}

--- Issue Description ---
Please describe the issue you're experiencing:

1. What were you trying to do?


2. What happened instead?


3. Steps to reproduce the issue:


4. Any error messages shown:


--- Additional Context ---
(Add any screenshots or additional information that might help)
`
    );
    
    const mailtoUrl = `mailto:support@echolon.app?subject=${subject}&body=${body}`;
    
    if (window.electronAPI?.openExternal) {
      await window.electronAPI.openExternal(mailtoUrl);
    } else {
      window.open(mailtoUrl, '_blank');
    }
  };

  const handleVersionClick = () => {
    // In web mode, open About tab; in desktop, open Updates tab
    openSettingsModal(isWebMode ? 'about' : 'updates');
  };

  const handleBusinessClick = async () => {
    const url = 'https://echolon.app/pricing?utm-source=app-footer';
    if (window.electronAPI?.openExternal) {
      await window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  const handleDocsClick = async () => {
    const url = 'https://docs.echolon.app';
    if (window.electronAPI?.openExternal) {
      await window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };
  
  // Get requests for active mock API
  const activeRequests = activeMockApiId 
    ? capturedRequests.filter(r => r.mockApiId === activeMockApiId)
    : [];

  const getSidebarTooltip = () => {
    if (sidebarState === 'hidden') return 'Show sidebar';
    if (sidebarState === 'collapsed') return 'Expand sidebar';
    return 'Hide sidebar';
  };

  // Check if there's an update available
  const hasUpdateAvailable = update && (update.status === 'available' || update.status === 'downloaded');

  return (
    <div className="bottom-bar">
      <div className="bottom-bar__left">
        {/* Sidebar toggle - hidden in reference view mode (web) */}
        {!hideToggleButtons && (
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
        )}
        {/* Left panel toggle - always visible */}
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
        <Tooltip content="Contact support" position="top">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleSupportClick}
          >
            <MailIcon />
          </Button>
        </Tooltip>
      </div>

      <div className="bottom-bar__center">
        {sidebarView === 'mocking' && (
          <span className="bottom-bar__status">
            {activeRequests.length} {activeRequests.length === 1 ? 'request' : 'requests'}
          </span>
        )}
        {isWebMode ? (
          <a 
            className="bottom-bar__business-link"
            href="https://echolon.app?utm_source=web-viewer"
            target="_blank"
            rel="noopener noreferrer"
          >
            Publish your own specs?
          </a>
        ) : (
          <button 
            className="bottom-bar__business-link"
            onClick={handleBusinessClick}
          >
            🚀 Echolon Business
          </button>
        )}
      </div>

      <div className="bottom-bar__right">
        {/* Version indicator */}
        <Tooltip 
          content={isWebMode ? 'About' : (hasUpdateAvailable ? `Update v${update.updateInfo?.version} available` : 'Update settings')} 
          position="top"
        >
          <button 
            className={`bottom-bar__version ${hasUpdateAvailable ? 'bottom-bar__version--update' : ''}`}
            onClick={handleVersionClick}
          >
            <span>v{APP_VERSION}</span>
            {hasUpdateAvailable && <span className="bottom-bar__version-dot" />}
          </button>
        </Tooltip>

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
        <Tooltip content="Documentation" position="top">
          <Button variant="ghost" size="sm" onClick={handleDocsClick}>
            <BookIcon />
          </Button>
        </Tooltip>
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
