import React, { createContext, useContext, useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Tab, Request, RequestExecution, HistoryEntry, Environment, Collection, WebSocketConnection, Workspace } from '@/types';
import { storageManager, requestService, fileStorageManager, webFileSystemManager } from '@/services';
import { useEnvironments } from './EnvironmentsContext';
import { useCollections } from './CollectionsContext';
import { useWorkspace } from './WorkspaceContext';
import { useWebModeOptional } from './WebModeContext';
import { useFileStorageOptional } from './FileStorageContext';
import { v4 as uuidv4 } from 'uuid';

interface RequestContextValue {
  tabs: Tab[];
  workspaceTabs: Tab[]; // Tabs filtered by the active workspace
  activeTabId: string | null;
  activeTab: Tab | null;
  currentExecution: RequestExecution | null;
  isLoading: boolean;
  history: HistoryEntry[];
  canGoBack: boolean;
  canGoForward: boolean;
  addTab: (request?: Request) => void;
  addSampleTab: () => void;
  addCollectionTab: (collection: Collection, initialSubTab?: string) => void;
  addEnvironmentTab: (environment: Environment) => void;
  addWebSocketTab: (websocket?: WebSocketConnection) => void;
  addWorkspaceTab: (workspace: Workspace, initialSubTab?: string) => void;
  addDiffTab: (filePath: string, oldContent: string, newContent: string, status: 'added' | 'modified' | 'deleted') => void;
  updateWebSocket: (tabId: string, updates: Partial<WebSocketConnection>) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<Tab>) => void;
  renameTab: (tabId: string, newTitle: string) => void;
  reorderTabs: (tabs: Tab[]) => void;
  updateRequest: (tabId: string, updates: Partial<Request>) => void;
  sendRequest: () => Promise<void>;
  clearResponse: () => void;
  getRequestHistory: (requestId: string) => HistoryEntry[];
  clearHistory: () => void;
  goBack: () => void;
  goForward: () => void;
}

const RequestContext = createContext<RequestContextValue | null>(null);

export const RequestProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const webMode = useWebModeOptional();
  const isWebMode = webMode?.isWebMode ?? false;
  const fileStorage = useFileStorageOptional();
  const isWebFileSystemEnabled = fileStorage?.isWebFileSystemEnabled ?? false;
  
  // Get the appropriate storage manager based on mode
  const getStorageManager = useCallback(() => {
    if (isWebMode && isWebFileSystemEnabled) {
      return webFileSystemManager;
    }
    if (isWebMode) {
      return null; // No file storage in web mode without file system
    }
    return fileStorageManager;
  }, [isWebMode, isWebFileSystemEnabled]);
  
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const savedTabs = storageManager.getTabs();
     /*if (savedTabs.length === 0) {
      // Create a default tab with sample request
     const sampleRequest = requestService.createSampleRequest();
      return [{
        id: uuidv4(),
        type: 'request',
        title: sampleRequest.name,
        request: sampleRequest,
        isDirty: false,
      }];
    }*/
    // Reset WebSocket tabs to disconnected state (connections can't be restored)
    // Also ensure settings exist for migrated tabs
    return savedTabs.map(tab => {
      if (tab.type === 'websocket' && tab.websocket) {
        return {
          ...tab,
          websocket: {
            ...tab.websocket,
            status: 'disconnected' as const,
            settings: tab.websocket.settings || {
              handshakeTimeout: 0,
              reconnectionAttempts: 0,
              reconnectionInterval: 5000,
              maxMessageSize: 10,
            },
          },
        };
      }
      return tab;
    });
  });

  const [activeTabId, setActiveTabIdState] = useState<string | null>(() => {
    // Restore active tab from storage, fall back to first tab
    const savedActiveTabId = storageManager.getActiveTabId();
    if (savedActiveTabId && tabs.some(t => t.id === savedActiveTabId)) {
      return savedActiveTabId;
    }
    return tabs[0]?.id || null;
  });
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  
  // Navigation history for back/forward
  const [navHistory, setNavHistory] = useState<string[]>(() => tabs[0]?.id ? [tabs[0].id] : []);
  const [navIndex, setNavIndex] = useState(0);
  const isNavigatingRef = useRef(false);

  const canGoBack = navIndex > 0;
  const canGoForward = navIndex < navHistory.length - 1;

  const { activeEnvironment, environments } = useEnvironments();
  const { collections, allCollections } = useCollections();
  const { activeWorkspaceId, activeWorkspace } = useWorkspace();

  const activeTab = tabs.find(t => t.id === activeTabId) || null;
  
  // Per-tab loading state and execution (derived from active tab)
  const isLoading = activeTab?.isLoading ?? false;
  const currentExecution = activeTab?.execution ?? null;

  // Migrate legacy tabs without workspaceId to the active workspace
  React.useEffect(() => {
    if (!activeWorkspaceId) return;
    
    setTabs(prevTabs => {
      let hasChanges = false;
      const updatedTabs = prevTabs.map(tab => {
        // Request tabs: assign workspaceId if missing
        if (tab.type === 'request' && !tab.workspaceId && !tab.request?.workspaceId) {
          hasChanges = true;
          return {
            ...tab,
            workspaceId: activeWorkspaceId,
            request: tab.request ? { ...tab.request, workspaceId: activeWorkspaceId } : tab.request,
          };
        }
        
        // WebSocket tabs: assign workspaceId if missing
        if (tab.type === 'websocket' && !tab.workspaceId) {
          hasChanges = true;
          return {
            ...tab,
            workspaceId: activeWorkspaceId,
          };
        }
        
        return tab;
      });
      
      return hasChanges ? updatedTabs : prevTabs;
    });
  }, [activeWorkspaceId]);

  // Filter tabs by active workspace
  const workspaceTabs = useMemo(() => {
    if (!activeWorkspaceId) return tabs;
    
    return tabs.filter(tab => {
      // Request tabs: filter by workspaceId on the tab or request
      if (tab.type === 'request') {
        return tab.workspaceId === activeWorkspaceId || 
               tab.request?.workspaceId === activeWorkspaceId;
      }
      
      // Collection tabs: filter by collection's workspaceId
      if (tab.type === 'collection' && tab.collectionId) {
        const collection = allCollections.find(c => c.id === tab.collectionId);
        return collection?.workspaceId === activeWorkspaceId;
      }
      
      // Workspace tabs: only show for matching workspace
      if (tab.type === 'workspace') {
        return tab.workspaceId === activeWorkspaceId;
      }
      
      // WebSocket tabs: filter by workspaceId
      if (tab.type === 'websocket') {
        return tab.workspaceId === activeWorkspaceId;
      }
      
      // Environment tabs: show everywhere (global environments)
      if (tab.type === 'environment') {
        return true;
      }
      
      return true;
    });
  }, [tabs, activeWorkspaceId, allCollections]);

  // Persist tabs on change
  React.useEffect(() => {
    storageManager.setTabs(tabs);
  }, [tabs]);

  // Persist active tab on change
  React.useEffect(() => {
    storageManager.setActiveTabId(activeTabId);
  }, [activeTabId]);

  // Load history from disk when workspace changes or file system becomes available
  useEffect(() => {
    const loadHistory = async () => {
      if (!activeWorkspace?.name) {
        setHistoryLoaded(true);
        return;
      }
      
      const manager = getStorageManager();
      if (!manager) {
        // No file storage available (web mode without file system)
        setHistoryLoaded(true);
        return;
      }
      
      try {
        const config = await manager.readConfig();
        // Check if history persistence is enabled (default: true)
        if (config?.settings?.persistHistory !== false) {
          const savedHistory = await manager.readHistory<HistoryEntry[]>(activeWorkspace.name);
          if (savedHistory && Array.isArray(savedHistory)) {
            setHistory(savedHistory);
          } else {
            setHistory([]);
          }
        }
      } catch (error) {
        console.error('Failed to load history from disk:', error);
      } finally {
        setHistoryLoaded(true);
      }
    };
    
    // Reset history loaded state when workspace changes or file system state changes
    setHistoryLoaded(false);
    loadHistory();
  }, [activeWorkspace?.name, isWebFileSystemEnabled, getStorageManager]);

  // Persist history to disk when it changes (debounced)
  const historyDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedWorkspaceRef = useRef<string | null>(null);
  
  useEffect(() => {
    // Don't save until initial load is complete
    if (!historyLoaded || !activeWorkspace?.name) return;
    
    const manager = getStorageManager();
    if (!manager) {
      // No file storage available (web mode without file system)
      return;
    }
    
    // Debounce writes to avoid excessive disk I/O
    if (historyDebounceRef.current) {
      clearTimeout(historyDebounceRef.current);
    }
    
    const workspaceName = activeWorkspace.name;
    lastSavedWorkspaceRef.current = workspaceName;
    
    historyDebounceRef.current = setTimeout(async () => {
      // Don't save if workspace changed during debounce
      if (lastSavedWorkspaceRef.current !== workspaceName) return;
      
      try {
        const config = await manager.readConfig();
        // Check if history persistence is enabled (default: true)
        if (config?.settings?.persistHistory !== false) {
          await manager.writeHistory(workspaceName, history);
        }
      } catch (error) {
        console.error('Failed to save history to disk:', error);
      }
    }, 500);
    
    return () => {
      if (historyDebounceRef.current) {
        clearTimeout(historyDebounceRef.current);
      }
    };
  }, [history, historyLoaded, activeWorkspace?.name, getStorageManager]);

  // Check for pending tab request (from sample collection creation on first app start)
  // Uses polling since CollectionsContext sets this after RequestContext mounts
  React.useEffect(() => {
    const PENDING_KEY = 'echolonPendingTabRequest';
    let attempts = 0;
    const maxAttempts = 30; // Check for up to 3 seconds
    
    const checkPendingRequest = () => {
      const pendingRequestJson = localStorage.getItem(PENDING_KEY);
      if (pendingRequestJson) {
        try {
          const pendingRequest = JSON.parse(pendingRequestJson) as Request;
          // Clear immediately to prevent duplicate tabs
          localStorage.removeItem(PENDING_KEY);
          
          const newTab: Tab = {
            id: uuidv4(),
            type: 'request',
            title: pendingRequest.name || 'New Request',
            request: pendingRequest,
            workspaceId: pendingRequest.workspaceId,
            isDirty: false,
          };
          setTabs(prev => [...prev, newTab]);
          setActiveTabIdState(newTab.id);
          return true; // Found and processed
        } catch (e) {
          console.error('Failed to parse pending tab request:', e);
          localStorage.removeItem(PENDING_KEY);
          return true; // Error, stop checking
        }
      }
      return false; // Not found yet
    };
    
    // Check immediately
    if (checkPendingRequest()) return;
    
    // Poll for a few seconds in case sample collection is being imported
    const interval = setInterval(() => {
      attempts++;
      if (checkPendingRequest() || attempts >= maxAttempts) {
        clearInterval(interval);
      }
    }, 100);
    
    return () => clearInterval(interval);
  }, []);

  // Helper to update active tab with navigation history tracking
  const setActiveTabId = useCallback((tabId: string) => {
    setActiveTabIdState(tabId);
    // Note: No need to clear execution - it's now stored per-tab
    
    // Add to navigation history if not navigating via back/forward
    if (!isNavigatingRef.current) {
      setNavHistory(prev => {
        // Slice history at current index and add new entry
        const newHistory = [...prev.slice(0, navIndex + 1), tabId];
        // Limit history size to prevent memory issues
        if (newHistory.length > 50) {
          return newHistory.slice(1);
        }
        return newHistory;
      });
      setNavIndex(prev => Math.min(prev + 1, 49));
    }
  }, [navIndex]);

  const addTab = useCallback((request?: Request) => {
    const newRequest = request || requestService.createEmptyRequest();
    // Set workspaceId on the request if not already set
    if (!newRequest.workspaceId && activeWorkspaceId) {
      newRequest.workspaceId = activeWorkspaceId;
    }
    const newTab: Tab = {
      id: uuidv4(),
      type: 'request',
      title: newRequest.name || 'New Request',
      request: newRequest,
      workspaceId: activeWorkspaceId || undefined,
      isDirty: false,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [setActiveTabId, activeWorkspaceId]);

  const addSampleTab = useCallback(() => {
    const sampleRequest = requestService.createSampleRequest();
    // Set workspaceId on the sample request
    if (activeWorkspaceId) {
      sampleRequest.workspaceId = activeWorkspaceId;
    }
    const newTab: Tab = {
      id: uuidv4(),
      type: 'request',
      title: sampleRequest.name,
      request: sampleRequest,
      workspaceId: activeWorkspaceId || undefined,
      isDirty: false,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [setActiveTabId, activeWorkspaceId]);

  const addCollectionTab = useCallback((collection: Collection, initialSubTab?: string) => {
    // Check if a tab for this collection already exists
    const existingTab = tabs.find(t => t.type === 'collection' && t.collectionId === collection.id);
    if (existingTab) {
      // Update the initialSubTab if provided (to navigate to a specific tab)
      if (initialSubTab) {
        setTabs(prev => prev.map(t => 
          t.id === existingTab.id ? { ...t, initialSubTab } : t
        ));
      }
      setActiveTabId(existingTab.id);
      return;
    }

    const newTab: Tab = {
      id: uuidv4(),
      type: 'collection',
      title: collection.name,
      collectionId: collection.id,
      isDirty: false,
      initialSubTab,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [tabs]);

  const addEnvironmentTab = useCallback((environment: Environment) => {
    // Check if a tab for this environment already exists
    const existingTab = tabs.find(t => t.type === 'environment' && t.environmentId === environment.id);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }

    const newTab: Tab = {
      id: uuidv4(),
      type: 'environment',
      title: environment.name,
      environmentId: environment.id,
      isDirty: false,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [tabs, setActiveTabId]);

  const addWebSocketTab = useCallback((websocket?: WebSocketConnection) => {
    const newWebSocket: WebSocketConnection = websocket || {
      id: uuidv4(),
      name: 'New WebSocket',
      url: 'wss://echo.websocket.org',
      status: 'disconnected',
      headers: [],
      queryParams: [],
      messages: [],
      messageToSend: '',
      settings: {
        handshakeTimeout: 0,
        reconnectionAttempts: 0,
        reconnectionInterval: 5000,
        maxMessageSize: 10,
      },
    };

    const newTab: Tab = {
      id: uuidv4(),
      type: 'websocket',
      title: newWebSocket.name,
      websocket: newWebSocket,
      workspaceId: activeWorkspaceId || undefined,
      isDirty: false,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [setActiveTabId, activeWorkspaceId]);

  const updateWebSocket = useCallback((tabId: string, updates: Partial<WebSocketConnection>) => {
    const settings = storageManager.getSettings();
    setTabs(prev =>
      prev.map(t => {
        if (t.id !== tabId || !t.websocket) return t;
        return {
          ...t,
          websocket: { ...t.websocket, ...updates },
          title: updates.name || t.title,
          isDirty: !settings.autoSave, // Only mark dirty if auto-save is disabled
        };
      })
    );
  }, []);

  const addWorkspaceTab = useCallback((workspace: Workspace, initialSubTab?: string) => {
    // Check if a tab for this workspace already exists
    const existingTab = tabs.find(t => t.type === 'workspace' && t.workspaceId === workspace.id);
    if (existingTab) {
      // Update the initialSubTab if provided (to navigate to a specific tab)
      if (initialSubTab) {
        setTabs(prev => prev.map(t => 
          t.id === existingTab.id ? { ...t, initialSubTab } : t
        ));
      }
      setActiveTabId(existingTab.id);
      return;
    }

    const newTab: Tab = {
      id: uuidv4(),
      type: 'workspace',
      title: workspace.name,
      workspaceId: workspace.id,
      isDirty: false,
      initialSubTab,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [tabs, setActiveTabId]);

  const addDiffTab = useCallback((
    filePath: string,
    oldContent: string,
    newContent: string,
    status: 'added' | 'modified' | 'deleted'
  ) => {
    // Check if a tab for this file diff already exists
    const existingTab = tabs.find(t => t.type === 'diff' && t.diff?.filePath === filePath);
    if (existingTab) {
      // Update the diff content and make it active
      setTabs(prev => prev.map(t => 
        t.id === existingTab.id ? { ...t, diff: { filePath, oldContent, newContent, status } } : t
      ));
      setActiveTabId(existingTab.id);
      return;
    }

    const fileName = filePath.split('/').pop() || filePath;
    const newTab: Tab = {
      id: uuidv4(),
      type: 'diff',
      title: `Diff: ${fileName}`,
      workspaceId: activeWorkspaceId || undefined,
      isDirty: false,
      diff: { filePath, oldContent, newContent, status },
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [tabs, setActiveTabId, activeWorkspaceId]);

  const closeTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const newTabs = prev.filter(t => t.id !== tabId);
      const currentActiveTabId = activeTabId;
      
      // If closing the active tab, switch to another
      if (currentActiveTabId === tabId) {
        const closingIndex = prev.findIndex(t => t.id === tabId);
        const newActiveTab = newTabs[closingIndex] || newTabs[closingIndex - 1] || null;
        
        if (newActiveTab) {
          setActiveTabIdState(newActiveTab.id);
        } else {
          // No tabs left - clear the active tab to show welcome screen
          setActiveTabIdState(null as unknown as string);
        }
      }
      
      return newTabs;
    });
    
    // Clean up navigation history - remove closed tab
    setNavHistory(prev => prev.filter(id => id !== tabId));
  }, [activeTabId]);

  const setActiveTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, [setActiveTabId]);

  const goBack = useCallback(() => {
    if (!canGoBack) return;
    
    const newIndex = navIndex - 1;
    const targetTabId = navHistory[newIndex];
    
    // Check if the tab still exists
    setTabs(currentTabs => {
      if (currentTabs.some(t => t.id === targetTabId)) {
        isNavigatingRef.current = true;
        setNavIndex(newIndex);
        setActiveTabIdState(targetTabId);
        // Note: No need to clear execution - it's now stored per-tab
        setTimeout(() => { isNavigatingRef.current = false; }, 0);
      } else {
        // Remove invalid entry and try again
        setNavHistory(prev => prev.filter(id => id !== targetTabId));
        setNavIndex(prev => Math.max(0, prev - 1));
      }
      return currentTabs;
    });
  }, [canGoBack, navIndex, navHistory]);

  const goForward = useCallback(() => {
    if (!canGoForward) return;
    
    const newIndex = navIndex + 1;
    const targetTabId = navHistory[newIndex];
    
    // Check if the tab still exists
    setTabs(currentTabs => {
      if (currentTabs.some(t => t.id === targetTabId)) {
        isNavigatingRef.current = true;
        setNavIndex(newIndex);
        setActiveTabIdState(targetTabId);
        // Note: No need to clear execution - it's now stored per-tab
        setTimeout(() => { isNavigatingRef.current = false; }, 0);
      } else {
        // Remove invalid entry
        setNavHistory(prev => prev.filter(id => id !== targetTabId));
      }
      return currentTabs;
    });
  }, [canGoForward, navIndex, navHistory]);

  const updateTab = useCallback((tabId: string, updates: Partial<Tab>) => {
    setTabs(prev =>
      prev.map(t => (t.id === tabId ? { ...t, ...updates } : t))
    );
  }, []);

  const renameTab = useCallback((tabId: string, newTitle: string) => {
    const settings = storageManager.getSettings();
    setTabs(prev =>
      prev.map(t => {
        if (t.id !== tabId) return t;
        return {
          ...t,
          title: newTitle,
          request: t.request ? { ...t.request, name: newTitle } : t.request,
          isDirty: !settings.autoSave, // Only mark dirty if auto-save is disabled
        };
      })
    );
  }, []);

  const reorderTabs = useCallback((newTabs: Tab[]) => {
    setTabs(newTabs);
  }, []);

  const updateRequest = useCallback((tabId: string, updates: Partial<Request>) => {
    const settings = storageManager.getSettings();
    setTabs(prev =>
      prev.map(t => {
        if (t.id !== tabId || !t.request) return t;
        return {
          ...t,
          request: { ...t.request, ...updates },
          title: updates.name || t.title,
          isDirty: !settings.autoSave, // Only mark dirty if auto-save is disabled
        };
      })
    );
  }, []);

  const sendRequest = useCallback(async () => {
    if (!activeTab?.request || !activeTabId) return;

    // Capture tab ID to update correct tab even if user switches tabs during request
    const tabId = activeTabId;

    // Set loading state on this specific tab
    setTabs(prev => prev.map(t => 
      t.id === tabId ? { ...t, isLoading: true, execution: undefined } : t
    ));

    try {
      const settings = storageManager.getSettings();
      
      // Find the collection for this request
      const collection = activeTab.request.collectionId
        ? collections.find(c => c.id === activeTab.request?.collectionId) || null
        : null;

      // Determine which environment to use:
      // 1. Check for selected collection environment (from collection.defaultEnvironmentId)
      // 2. Global environment provides base variables
      // Collection environment provides additional variables that can override global ones
      const selectedCollectionEnv = collection?.defaultEnvironmentId 
        ? collection.environments?.find(e => e.id === collection.defaultEnvironmentId) || null
        : null;

      // Check if User-Agent is disabled for this specific request
      const userAgentOverride = activeTab.request.headers.find(
        h => h.id?.startsWith('__user_agent_override__') && !h.enabled
      );
      const effectiveSettings = userAgentOverride 
        ? { ...settings, sendUserAgent: false }
        : settings;

      const execution = await requestService.execute(
        activeTab.request,
        activeEnvironment,  // Global environment
        effectiveSettings.requestTimeout,
        collection,
        effectiveSettings,
        selectedCollectionEnv  // Collection environment (overrides global)
      );

      // Store execution result on this specific tab
      setTabs(prev => prev.map(t => 
        t.id === tabId ? { ...t, isLoading: false, execution } : t
      ));

      // Add to history (with size limit check for binary responses)
      const maxBinarySizeKB = settings.historyMaxBinarySize ?? 50;
      const maxBinarySizeBytes = maxBinarySizeKB * 1024;
      
      let historyResponse = execution.response;
      let responseBodyOmitted = false;
      let responseBodyOriginalSize: number | undefined;
      
      // Check if response is binary and exceeds size limit
      if (execution.response?.bodyBase64) {
        // bodyBase64 is base64 encoded, actual size is roughly 3/4 of the string length
        const actualSize = Math.floor(execution.response.bodyBase64.length * 0.75);
        if (actualSize > maxBinarySizeBytes) {
          responseBodyOmitted = true;
          responseBodyOriginalSize = actualSize;
          // Create a copy without the binary body
          historyResponse = {
            ...execution.response,
            body: '',
            bodyBase64: undefined,
          };
        }
      }
      
      const historyEntry: HistoryEntry = {
        id: uuidv4(),
        request: activeTab.request,
        resolvedRequest: execution.resolvedRequest,
        response: historyResponse,
        timestamp: execution.timestamp,
        duration: execution.duration,
        responseBodyOmitted,
        responseBodyOriginalSize,
      };
      setHistory(prev => [historyEntry, ...prev].slice(0, 100));
    } catch (error) {
      console.error('Request failed:', error);
      // Clear loading state on error
      setTabs(prev => prev.map(t => 
        t.id === tabId ? { ...t, isLoading: false } : t
      ));
    }
  }, [activeTab, activeTabId, activeEnvironment, environments, collections]);

  const clearResponse = useCallback(() => {
    if (!activeTabId) return;
    setTabs(prev => prev.map(t => 
      t.id === activeTabId ? { ...t, execution: undefined } : t
    ));
  }, [activeTabId]);

  const getRequestHistory = useCallback((requestId: string): HistoryEntry[] => {
    return history.filter(h => h.request.id === requestId);
  }, [history]);

  const clearHistory = useCallback(async () => {
    setHistory([]);
    // Also clear from disk
    const manager = getStorageManager();
    if (manager && activeWorkspace?.name) {
      try {
        await manager.clearHistory(activeWorkspace.name);
      } catch (error) {
        console.error('Failed to clear history from disk:', error);
      }
    }
  }, [activeWorkspace?.name, getStorageManager]);

  return (
    <RequestContext.Provider
      value={{
        tabs,
        workspaceTabs,
        activeTabId: activeTabId,
        activeTab,
        currentExecution,
        isLoading,
        history,
        canGoBack,
        canGoForward,
        addTab,
        addSampleTab,
        addCollectionTab,
        addEnvironmentTab,
        addWebSocketTab,
        addWorkspaceTab,
        addDiffTab,
        updateWebSocket,
        closeTab,
        setActiveTab,
        updateTab,
        renameTab,
        reorderTabs,
        updateRequest,
        sendRequest,
        clearResponse,
        getRequestHistory,
        clearHistory,
        goBack,
        goForward,
      }}
    >
      {children}
    </RequestContext.Provider>
  );
};

export const useRequest = () => {
  const context = useContext(RequestContext);
  if (!context) {
    throw new Error('useRequest must be used within RequestProvider');
  }
  return context;
};

export default RequestContext;
