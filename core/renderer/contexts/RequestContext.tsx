import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { Tab, Request, RequestExecution, HistoryEntry, Environment, Collection } from '@/types';
import { storageManager, requestService } from '@/services';
import { useEnvironments } from './EnvironmentsContext';
import { useCollections } from './CollectionsContext';
import { v4 as uuidv4 } from 'uuid';

interface RequestContextValue {
  tabs: Tab[];
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
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const savedTabs = storageManager.getTabs();
    if (savedTabs.length === 0) {
      // Create a default tab with sample request
      const sampleRequest = requestService.createSampleRequest();
      return [{
        id: uuidv4(),
        type: 'request',
        title: sampleRequest.name,
        request: sampleRequest,
        isDirty: false,
      }];
    }
    return savedTabs;
  });

  const [activeTabId, setActiveTabIdState] = useState<string | null>(() => {
    // Restore active tab from storage, fall back to first tab
    const savedActiveTabId = storageManager.getActiveTabId();
    if (savedActiveTabId && tabs.some(t => t.id === savedActiveTabId)) {
      return savedActiveTabId;
    }
    return tabs[0]?.id || null;
  });
  const [currentExecution, setCurrentExecution] = useState<RequestExecution | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(() => storageManager.getHistory());
  
  // Navigation history for back/forward
  const [navHistory, setNavHistory] = useState<string[]>(() => tabs[0]?.id ? [tabs[0].id] : []);
  const [navIndex, setNavIndex] = useState(0);
  const isNavigatingRef = useRef(false);

  const canGoBack = navIndex > 0;
  const canGoForward = navIndex < navHistory.length - 1;

  const { activeEnvironment, environments } = useEnvironments();
  const { collections } = useCollections();

  const activeTab = tabs.find(t => t.id === activeTabId) || null;

  // Persist tabs on change
  React.useEffect(() => {
    storageManager.setTabs(tabs);
  }, [tabs]);

  // Persist active tab on change
  React.useEffect(() => {
    storageManager.setActiveTabId(activeTabId);
  }, [activeTabId]);

  // Persist history on change
  React.useEffect(() => {
    storageManager.setHistory(history);
  }, [history]);

  // Helper to update active tab with navigation history tracking
  const setActiveTabId = useCallback((tabId: string) => {
    setActiveTabIdState(tabId);
    setCurrentExecution(null);
    
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
    const newTab: Tab = {
      id: uuidv4(),
      type: 'request',
      title: newRequest.name || 'New Request',
      request: newRequest,
      isDirty: false,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [setActiveTabId]);

  const addSampleTab = useCallback(() => {
    const sampleRequest = requestService.createSampleRequest();
    const newTab: Tab = {
      id: uuidv4(),
      type: 'request',
      title: sampleRequest.name,
      request: sampleRequest,
      isDirty: false,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [setActiveTabId]);

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
  }, [tabs, setActiveTabId]);

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
        }
        
        // If no tabs left, create a new one
        if (newTabs.length === 0) {
          const defaultRequest = requestService.createEmptyRequest();
          const defaultTab: Tab = {
            id: uuidv4(),
            type: 'request',
            title: 'New Request',
            request: defaultRequest,
            isDirty: false,
          };
          setActiveTabIdState(defaultTab.id);
          return [defaultTab];
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
        setCurrentExecution(null);
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
        setCurrentExecution(null);
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
    setTabs(prev =>
      prev.map(t => {
        if (t.id !== tabId) return t;
        return {
          ...t,
          title: newTitle,
          request: t.request ? { ...t.request, name: newTitle } : t.request,
          isDirty: true,
        };
      })
    );
  }, []);

  const reorderTabs = useCallback((newTabs: Tab[]) => {
    setTabs(newTabs);
  }, []);

  const updateRequest = useCallback((tabId: string, updates: Partial<Request>) => {
    setTabs(prev =>
      prev.map(t => {
        if (t.id !== tabId || !t.request) return t;
        return {
          ...t,
          request: { ...t.request, ...updates },
          title: updates.name || t.title,
          isDirty: true,
        };
      })
    );
  }, []);

  const sendRequest = useCallback(async () => {
    if (!activeTab?.request) return;

    setIsLoading(true);
    setCurrentExecution(null);

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

      setCurrentExecution(execution);

      // Add to history
      const historyEntry: HistoryEntry = {
        id: uuidv4(),
        request: activeTab.request,
        response: execution.response,
        timestamp: execution.timestamp,
        duration: execution.duration,
      };
      setHistory(prev => [historyEntry, ...prev].slice(0, 100));
    } catch (error) {
      console.error('Request failed:', error);
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, activeEnvironment, environments, collections]);

  const clearResponse = useCallback(() => {
    setCurrentExecution(null);
  }, []);

  const getRequestHistory = useCallback((requestId: string): HistoryEntry[] => {
    return history.filter(h => h.request.id === requestId);
  }, [history]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    storageManager.clearHistory();
  }, []);

  return (
    <RequestContext.Provider
      value={{
        tabs,
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
