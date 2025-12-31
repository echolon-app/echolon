import React, { useEffect, useRef } from 'react';
import { MainLayout } from '@/components/layout';
import { LeftPanel, CenterPanel, RightPanel, ConsolePanel, CodePanel, MockingPanel, APIReferencePanel } from '@/components/panels';
import { SettingsModal, ImportModal, GlobalSearchModal, NewCollectionModal, NewEnvironmentModal, MoveCollectionModal, ShortcutsModal } from '@/components/modals';
import { useApp, useRequest, useDataLoader, useToast, useCollections } from '@/contexts';
import { useGlobalShortcuts } from '@/hooks';
import { isElectron } from '@/utils';
import './styles/index.css';

// Set data attribute for CSS styling based on environment
document.documentElement.setAttribute('data-electron', isElectron() ? 'true' : 'false');


// Hide the loading screen
const hideLoader = () => {
  const loader = document.getElementById('app-loader');
  if (loader) {
    loader.classList.add('hidden');
    // Remove from DOM after animation
    setTimeout(() => {
      loader.remove();
    }, 200);
  }
};

export const App: React.FC = () => {
  const { 
    openSettingsModal, 
    openGlobalSearch,
    cycleSidebarState,
    toggleConsole,
    showCodePanel,
    codePanelVisible,
    sidebarView,
    viewMode,
    isWebMode,
    logToConsole,
    settings
  } = useApp();
  const { sendRequest, addTab, addCollectionTab } = useRequest();
  const { isLoading: dataLoading, timings } = useDataLoader();
  const { addToast } = useToast();
  const { collections } = useCollections();
  const startupToastShown = useRef(false);
  
  // Store collections in a ref so event handler has latest version
  const collectionsRef = useRef(collections);
  useEffect(() => {
    collectionsRef.current = collections;
  }, [collections]);
  
  // Store addCollectionTab in a ref for event handler
  const addCollectionTabRef = useRef(addCollectionTab);
  useEffect(() => {
    addCollectionTabRef.current = addCollectionTab;
  }, [addCollectionTab]);

  // Global keyboard shortcuts
  useGlobalShortcuts({
    onSendRequest: sendRequest,
    onOpenSettings: openSettingsModal,
    onNewRequest: () => addTab(),
    onOpenSearch: openGlobalSearch,
    onToggleSidebar: cycleSidebarState,
    onToggleConsole: toggleConsole,
  });

  // Listen for menu events from main process
  useEffect(() => {
    const unsubscribers: (() => void)[] = [];

    if (window.electronAPI) {
      unsubscribers.push(
        window.electronAPI.onSendRequest(() => {
          sendRequest();
        }),
        window.electronAPI.onNewRequest(() => {
          addTab();
        })
      );
    }

    return () => unsubscribers.forEach(unsub => unsub());
  }, [sendRequest, addTab]);

  // Log app start
  useEffect(() => {
    logToConsole('info', 'Echolon started successfully');
  }, [logToConsole]);

  // Listen for sync changes and show notification
  useEffect(() => {
    const handleSyncChanges = (event: CustomEvent<{ collectionId: string; collectionName: string; changesCount: number }>) => {
      const { collectionId, collectionName, changesCount } = event.detail;
      
      // Show toast notification with click action
      addToast({
        type: 'info',
        message: `API spec updated: ${collectionName}`,
        description: `${changesCount} change${changesCount !== 1 ? 's' : ''} detected from remote`,
        duration: 10000, // Show for 10 seconds
        actionLabel: 'Click to review changes',
        onClick: () => {
          // Find the collection and open its sync tab
          const collection = collectionsRef.current.find(c => c.id === collectionId);
          if (collection) {
            addCollectionTabRef.current(collection, 'sync');
          }
        }
      });
      
      // Also show native notification if supported and permitted
      if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification('API Spec Updated', {
          body: `${collectionName}: ${changesCount} change${changesCount !== 1 ? 's' : ''} detected`,
          icon: '/icon.png',
          tag: `sync-${collectionId}`, // Prevent duplicate notifications
        });
        
        notification.onclick = () => {
          window.focus();
          const collection = collectionsRef.current.find(c => c.id === collectionId);
          if (collection) {
            addCollectionTabRef.current(collection, 'sync');
          }
          notification.close();
        };
      }
    };

    window.addEventListener('echolon:sync-changes-detected', handleSyncChanges as EventListener);
    
    // Request notification permission on mount (non-blocking)
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    return () => {
      window.removeEventListener('echolon:sync-changes-detected', handleSyncChanges as EventListener);
    };
  }, [addToast]);

  // Hide loader and show startup time when data is loaded
  useEffect(() => {
    if (!dataLoading && !startupToastShown.current) {
      // Hide the loading screen
      hideLoader();
      
      // Show startup time toast if debug mode is enabled
      if (settings.debugMode && timings) {
        const startTime = (window as { __APP_START_TIME__?: number }).__APP_START_TIME__;
        const totalFromClick = startTime ? Math.round(performance.now() - startTime) : null;
        
        // Build detailed timing message
        const details = [
          `Data loading: ${timings.total}ms`,
          `  - File storage init: ${timings.fileStorageInit}ms`,
          `  - Workspaces: ${timings.workspaces}ms`,
          `  - Collections: ${timings.collections}ms`,
          `  - Environments: ${timings.environments}ms`,
          `  - Config: ${timings.config}ms`,
        ];
        
        if (totalFromClick) {
          details.unshift(`Total startup: ${totalFromClick}ms`);
        }
        
        addToast({ 
          type: 'info', 
          message: details.join('\n'), 
          description: 'Startup Timing',
          duration: 10000 // Show for 10 seconds
        });
        
        // Also log to console for easier debugging
        console.log('[Startup Timing]', {
          totalFromClick,
          dataLoading: timings.total,
          breakdown: {
            fileStorageInit: timings.fileStorageInit,
            workspaces: timings.workspaces,
            collections: timings.collections,
            environments: timings.environments,
            config: timings.config,
          }
        });
      }
      
      startupToastShown.current = true;
    }
  }, [dataLoading, settings.debugMode, timings, addToast]);

  // Determine which panel to show in center
  // In web mode with reference view, show API Reference Panel
  // Otherwise show the standard CenterPanel or MockingPanel
  const centerPanelContent = (() => {
    // Mocking panel takes precedence (but only in Electron)
    if (sidebarView === 'mocking' && !isWebMode) {
      return <MockingPanel />;
    }
    
    // Reference view - show vertical list of all requests
    if (viewMode === 'reference') {
      return <APIReferencePanel />;
    }
    
    // Default tabs view
    return <CenterPanel onShowCodePanel={showCodePanel} />;
  })();

  return (
    <>
      <MainLayout
        leftPanel={<LeftPanel />}
        centerPanel={centerPanelContent}
        rightPanel={codePanelVisible ? <CodePanel /> : <RightPanel />}
        consolePanel={<ConsolePanel />}
      />
      
      {/* Modals */}
      <SettingsModal />
      <ImportModal />
      <GlobalSearchModal />
      <NewCollectionModal />
      <NewEnvironmentModal />
      <MoveCollectionModal />
      <ShortcutsModal />
      
      {/* Code Panel Slide-in */}
      {codePanelVisible && (
        <div className="code-panel-overlay" />
      )}
    </>
  );
};

export default App;
