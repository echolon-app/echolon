import React, { useState, useRef, useEffect, useCallback } from 'react';
import { TopBar } from '../TopBar';
import { LeftSidebar } from '../LeftSidebar';
import { BottomBar } from '../BottomBar';
import { StorageBanner } from '@/components/ui';
import { useApp, useFileStorage, useWebModeOptional } from '@/contexts';
import { storageManager } from '@/services';
import './MainLayout.css';

interface MainLayoutProps {
  leftPanel: React.ReactNode;
  centerPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  consolePanel: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
  leftPanel,
  centerPanel,
  rightPanel,
  consolePanel,
}) => {
  const { sidebarState, leftPanelVisible, consoleVisible, codePanelVisible } = useApp();
  const { isWebMode, isWebFileSystemEnabled, enableWebFileSystem } = useFileStorage();
  const webMode = useWebModeOptional();
  const readonly = webMode?.readonly ?? false;
  const viewMode = webMode?.viewMode ?? 'tabs';
  
  // In reference view mode (web), hide only the sidebar (not the left panel)
  const isReferenceView = isWebMode && viewMode === 'reference';
  const sidebarVisible = sidebarState !== 'hidden' && !isReferenceView;
  
  // Resizable panel widths - load from localStorage
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    return storageManager.getPanelSizes().leftPanelWidth;
  });
  const [consoleHeight, setConsoleHeight] = useState(() => {
    return storageManager.getPanelSizes().consoleHeight;
  });
  const [codePanelWidth, setCodePanelWidth] = useState(() => {
    return storageManager.getPanelSizes().codePanelWidth || 400;
  });
  
  // Resize state
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingConsole, setIsResizingConsole] = useState(false);
  const [isResizingCodePanel, setIsResizingCodePanel] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle left panel resize
  const handleLeftResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingLeft(true);
  }, []);

  // Handle console resize
  const handleConsoleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingConsole(true);
  }, []);

  // Handle code panel resize
  const handleCodePanelResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingCodePanel(true);
  }, []);

  useEffect(() => {
    let newLeftWidth = leftPanelWidth;
    let newConsoleHeight = consoleHeight;
    let newCodePanelWidth = codePanelWidth;

    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingLeft) {
        const container = containerRef.current;
        if (!container) return;
        
        const containerRect = container.getBoundingClientRect();
        // Account for the left sidebar (48px)
        newLeftWidth = Math.max(200, Math.min(e.clientX - containerRect.left, 500));
        setLeftPanelWidth(newLeftWidth);
      }

      if (isResizingConsole) {
        const container = containerRef.current;
        if (!container) return;
        
        const containerRect = container.getBoundingClientRect();
        newConsoleHeight = Math.max(100, Math.min(containerRect.bottom - e.clientY, 500));
        setConsoleHeight(newConsoleHeight);
      }

      if (isResizingCodePanel) {
        const container = containerRef.current;
        if (!container) return;
        
        const containerRect = container.getBoundingClientRect();
        // Calculate width from right edge (resize from left side of the panel)
        newCodePanelWidth = Math.max(280, Math.min(containerRect.right - e.clientX, 700));
        setCodePanelWidth(newCodePanelWidth);
      }
    };

    const handleMouseUp = () => {
      // Save to localStorage when resize ends
      if (isResizingLeft) {
        storageManager.setPanelSizes({ leftPanelWidth: newLeftWidth });
      }
      if (isResizingConsole) {
        storageManager.setPanelSizes({ consoleHeight: newConsoleHeight });
      }
      if (isResizingCodePanel) {
        storageManager.setPanelSizes({ codePanelWidth: newCodePanelWidth });
      }
      setIsResizingLeft(false);
      setIsResizingConsole(false);
      setIsResizingCodePanel(false);
    };

    if (isResizingLeft || isResizingConsole || isResizingCodePanel) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = (isResizingLeft || isResizingCodePanel) ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingLeft, isResizingConsole, isResizingCodePanel, leftPanelWidth, consoleHeight, codePanelWidth]);

  return (
    <div className="main-layout">
      <StorageBanner
        onEnableStorage={enableWebFileSystem}
        isStorageEnabled={isWebFileSystemEnabled}
        isWebMode={isWebMode}
        readonly={readonly}
      />
      <TopBar />
      
      <div className="main-layout__body">
        {sidebarVisible && <LeftSidebar />}
        
        <div className="main-layout__content" ref={containerRef}>
          <div className="main-layout__panels">
            {leftPanelVisible && (
              <>
                <div 
                  className="main-layout__left-panel"
                  style={{ width: leftPanelWidth }}
                >
                  {leftPanel}
                </div>
                <div 
                  className={`main-layout__divider main-layout__divider--vertical ${isResizingLeft ? 'active' : ''}`}
                  onMouseDown={handleLeftResizeMouseDown}
                />
              </>
            )}
            
            <div className="main-layout__center-panel">
              {centerPanel}
            </div>
            
            {codePanelVisible && (
              <>
                <div 
                  className={`main-layout__divider main-layout__divider--vertical ${isResizingCodePanel ? 'active' : ''}`}
                  onMouseDown={handleCodePanelResizeMouseDown}
                />
                <div 
                  className="main-layout__right-panel main-layout__right-panel--code"
                  style={{ width: codePanelWidth }}
                >
                  {rightPanel}
                </div>
              </>
            )}
          </div>
          
          {consoleVisible && (
            <>
              <div 
                className={`main-layout__divider main-layout__divider--horizontal ${isResizingConsole ? 'active' : ''}`}
                onMouseDown={handleConsoleResizeMouseDown}
              />
              <div 
                className="main-layout__console"
                style={{ height: consoleHeight }}
              >
                {consolePanel}
              </div>
            </>
          )}
        </div>
      </div>
      
      <BottomBar />
    </div>
  );
};

export default MainLayout;
