import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { AppSettings, ConsoleEntry, Collection } from '@/types';
import { storageManager } from '@/services';
import { setEditorSearchMaxResults } from '@/aceSearchboxConfig';
import { isElectron } from '@/utils';
import { v4 as uuidv4 } from 'uuid';

type SidebarView = 'collections' | 'environments' | 'history' | 'mocking' | 'git' | 'socket' | 'graphql' | 'workspaces';

type SidebarState = 'hidden' | 'collapsed' | 'expanded';

export type ViewMode = 'tabs' | 'reference';

export type SettingsTab = 'general' | 'storage' | 'github' | 'theming' | 'editor' | 'requests' | 'proxy' | 'mocking' | 'subscription' | 'updates' | 'about';

// Check if running in web mode (not Electron)
// Uses the shared isElectron utility for consistent detection
const isWebMode = (): boolean => {
  return !isElectron();
};

interface AppContextValue {
  // UI State
  sidebarState: SidebarState;
  sidebarView: SidebarView;
  viewMode: ViewMode;
  isWebMode: boolean;
  leftPanelVisible: boolean;
  consoleVisible: boolean;
  rightPanelVisible: boolean;
  codePanelVisible: boolean;
  settingsModalOpen: boolean;
  settingsModalTab: SettingsTab | null;
  importModalOpen: boolean;
  newCollectionModalOpen: boolean;
  newEnvironmentModalOpen: boolean;
  moveCollectionModalOpen: boolean;
  moveCollectionTarget: Collection | null;
  globalSearchOpen: boolean;
  shortcutsModalOpen: boolean;
  onboardingOpen: boolean;
  screenMirrorModalOpen: boolean;
  
  // Settings
  settings: AppSettings;
  
  // Console
  consoleEntries: ConsoleEntry[];
  
  // Custom HTTP Methods
  customHttpMethods: string[];
  addCustomHttpMethod: (method: string) => void;
  removeCustomHttpMethod: (method: string) => void;
  
  // Actions
  cycleSidebarState: () => void;
  setSidebarView: (view: SidebarView) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleLeftPanel: () => void;
  toggleConsole: () => void;
  toggleRightPanel: () => void;
  showCodePanel: () => void;
  hideCodePanel: () => void;
  openSettingsModal: (tab?: SettingsTab) => void;
  closeSettingsModal: () => void;
  openImportModal: () => void;
  closeImportModal: () => void;
  openNewCollectionModal: () => void;
  closeNewCollectionModal: () => void;
  openNewEnvironmentModal: () => void;
  closeNewEnvironmentModal: () => void;
  openMoveCollectionModal: (collection: Collection) => void;
  closeMoveCollectionModal: () => void;
  openGlobalSearch: () => void;
  closeGlobalSearch: () => void;
  openShortcutsModal: () => void;
  closeShortcutsModal: () => void;
  openOnboarding: () => void;
  closeOnboarding: () => void;
  openScreenMirrorModal: () => void;
  closeScreenMirrorModal: () => void;
  updateSettings: (updates: Partial<AppSettings>) => void;
  logToConsole: (type: ConsoleEntry['type'], message: string, details?: string) => void;
  clearConsole: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const webMode = isWebMode();
  
  // UI State
  const [sidebarState, setSidebarState] = useState<SidebarState>(() => {
    const stored = localStorage.getItem('sidebarState');
    return (stored as SidebarState) || 'collapsed';
  });
  const [sidebarView, setSidebarViewState] = useState<SidebarView>(() => storageManager.getSidebarView());
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    const stored = localStorage.getItem('echolon_view_mode');
    if (stored === 'tabs' || stored === 'reference') return stored;
    // Default to 'tabs' - same view in both web and Electron
    return 'tabs';
  });
  const [leftPanelVisible, setLeftPanelVisible] = useState(() => {
    const stored = localStorage.getItem('leftPanelVisible');
    return stored !== 'false'; // Default to true
  });
  const [consoleVisible, setConsoleVisible] = useState(false);
  const [rightPanelVisible, setRightPanelVisible] = useState(false);
  const [codePanelVisible, setCodePanelVisible] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsModalTab, setSettingsModalTab] = useState<SettingsTab | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [newCollectionModalOpen, setNewCollectionModalOpen] = useState(false);
  const [newEnvironmentModalOpen, setNewEnvironmentModalOpen] = useState(false);
  const [moveCollectionModalOpen, setMoveCollectionModalOpen] = useState(false);
  const [moveCollectionTarget, setMoveCollectionTarget] = useState<Collection | null>(null);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [screenMirrorModalOpen, setScreenMirrorModalOpen] = useState(false);

  // Settings
  const [settings, setSettings] = useState<AppSettings>(() => storageManager.getSettings());

  // Console
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);

  // Custom HTTP Methods
  const [customHttpMethods, setCustomHttpMethods] = useState<string[]>(() => storageManager.getCustomHttpMethods());

  // Persist settings on change
  useEffect(() => {
    storageManager.setSettings(settings);
  }, [settings]);

  // Sync editor search max results to Ace searchbox patch (non-React code)
  useEffect(() => {
    setEditorSearchMaxResults(settings.editorSearchMaxResults ?? 9999);
  }, [settings.editorSearchMaxResults]);

  // Apply font size setting to CSS custom properties
  useEffect(() => {
    const baseFontSize = 13; // Default font size
    const scale = settings.fontSize / baseFontSize;
    const root = document.documentElement;
    
    // Scale all font size variables proportionally
    root.style.setProperty('--font-xs', `${Math.round(11 * scale)}px`);
    root.style.setProperty('--font-sm', `${Math.round(12 * scale)}px`);
    root.style.setProperty('--font-md', `${Math.round(13 * scale)}px`);
    root.style.setProperty('--font-lg', `${Math.round(14 * scale)}px`);
    root.style.setProperty('--font-xl', `${Math.round(16 * scale)}px`);
    root.style.setProperty('--font-2xl', `${Math.round(18 * scale)}px`);
    root.style.setProperty('--font-3xl', `${Math.round(24 * scale)}px`);
  }, [settings.fontSize]);

  // Listen for menu events
  useEffect(() => {
    const unsubscribers: (() => void)[] = [];

    if (window.electronAPI) {
      unsubscribers.push(
        window.electronAPI.onOpenSettings(() => setSettingsModalOpen(true)),
        window.electronAPI.onToggleSidebar(() => {
          setSidebarState(prev => {
            const next = prev === 'hidden' ? 'collapsed' : prev === 'collapsed' ? 'expanded' : 'hidden';
            localStorage.setItem('sidebarState', next);
            return next;
          });
        }),
        window.electronAPI.onToggleConsole(() => setConsoleVisible(v => !v)),
        window.electronAPI.onImportCollection(() => setImportModalOpen(true)),
        window.electronAPI.onNewCollection(() => setNewCollectionModalOpen(true))
      );
    }

    return () => unsubscribers.forEach(unsub => unsub());
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdKey = isMac ? e.metaKey : e.ctrlKey;

      if (cmdKey && e.key === ',') {
        e.preventDefault();
        setSettingsModalOpen(true);
      } else if (cmdKey && e.key === 'k') {
        e.preventDefault();
        setGlobalSearchOpen(true);
      } else if (e.key === 'Escape') {
        if (globalSearchOpen) setGlobalSearchOpen(false);
        if (settingsModalOpen) setSettingsModalOpen(false);
        if (importModalOpen) setImportModalOpen(false);
        if (newCollectionModalOpen) setNewCollectionModalOpen(false);
        if (newEnvironmentModalOpen) setNewEnvironmentModalOpen(false);
        if (moveCollectionModalOpen) setMoveCollectionModalOpen(false);
        if (codePanelVisible) setCodePanelVisible(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [globalSearchOpen, settingsModalOpen, importModalOpen, newCollectionModalOpen, newEnvironmentModalOpen, moveCollectionModalOpen, codePanelVisible]);

  const cycleSidebarState = useCallback(() => {
    setSidebarState(prev => {
      const next = prev === 'hidden' ? 'collapsed' : prev === 'collapsed' ? 'expanded' : 'hidden';
      localStorage.setItem('sidebarState', next);
      return next;
    });
  }, []);

  const setSidebarView = useCallback((view: SidebarView) => {
    setSidebarViewState(view);
    storageManager.setSidebarView(view);
    if (sidebarState === 'hidden') {
      setSidebarState('collapsed');
      localStorage.setItem('sidebarState', 'collapsed');
    }
  }, [sidebarState]);

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    localStorage.setItem('echolon_view_mode', mode);
  }, []);

  const toggleLeftPanel = useCallback(() => {
    setLeftPanelVisible(v => {
      const newValue = !v;
      localStorage.setItem('leftPanelVisible', String(newValue));
      return newValue;
    });
  }, []);

  const toggleConsole = useCallback(() => {
    setConsoleVisible(v => !v);
  }, []);

  const toggleRightPanel = useCallback(() => {
    setRightPanelVisible(v => !v);
  }, []);

  const showCodePanel = useCallback(() => setCodePanelVisible(true), []);
  const hideCodePanel = useCallback(() => setCodePanelVisible(false), []);

  const openSettingsModal = useCallback((tab?: SettingsTab) => {
    if (tab) {
      setSettingsModalTab(tab);
    }
    setSettingsModalOpen(true);
  }, []);
  const closeSettingsModal = useCallback(() => {
    setSettingsModalOpen(false);
    setSettingsModalTab(null);
  }, []);
  const openImportModal = useCallback(() => setImportModalOpen(true), []);
  const closeImportModal = useCallback(() => setImportModalOpen(false), []);
  const openNewCollectionModal = useCallback(() => setNewCollectionModalOpen(true), []);
  const closeNewCollectionModal = useCallback(() => setNewCollectionModalOpen(false), []);
  const openNewEnvironmentModal = useCallback(() => setNewEnvironmentModalOpen(true), []);
  const closeNewEnvironmentModal = useCallback(() => setNewEnvironmentModalOpen(false), []);
  const openMoveCollectionModal = useCallback((collection: Collection) => {
    setMoveCollectionTarget(collection);
    setMoveCollectionModalOpen(true);
  }, []);
  const closeMoveCollectionModal = useCallback(() => {
    setMoveCollectionModalOpen(false);
    setMoveCollectionTarget(null);
  }, []);
  const openGlobalSearch = useCallback(() => setGlobalSearchOpen(true), []);
  const closeGlobalSearch = useCallback(() => setGlobalSearchOpen(false), []);
  const openShortcutsModal = useCallback(() => setShortcutsModalOpen(true), []);
  const closeShortcutsModal = useCallback(() => setShortcutsModalOpen(false), []);
  const openOnboarding = useCallback(() => setOnboardingOpen(true), []);
  const closeOnboarding = useCallback(() => setOnboardingOpen(false), []);
  const openScreenMirrorModal = useCallback(() => setScreenMirrorModalOpen(true), []);
  const closeScreenMirrorModal = useCallback(() => setScreenMirrorModalOpen(false), []);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...updates }));
  }, []);

  const logToConsole = useCallback((type: ConsoleEntry['type'], message: string, details?: string) => {
    const entry: ConsoleEntry = {
      id: uuidv4(),
      type,
      message,
      timestamp: Date.now(),
      details,
    };
    setConsoleEntries(prev => [...prev, entry]);
  }, []);

  // Listen for log events from services (e.g., SyncManager)
  useEffect(() => {
    const handleLogEvent = (event: CustomEvent<{ type: ConsoleEntry['type']; message: string; details?: string }>) => {
      const { type, message, details } = event.detail;
      logToConsole(type, message, details);
    };

    window.addEventListener('echolon:log', handleLogEvent as EventListener);
    return () => {
      window.removeEventListener('echolon:log', handleLogEvent as EventListener);
    };
  }, [logToConsole]);

  const clearConsole = useCallback(() => {
    setConsoleEntries([]);
  }, []);

  const addCustomHttpMethod = useCallback((method: string) => {
    const upperMethod = method.toUpperCase();
    setCustomHttpMethods(prev => {
      if (prev.includes(upperMethod)) return prev;
      const updated = [...prev, upperMethod];
      storageManager.setCustomHttpMethods(updated);
      return updated;
    });
  }, []);

  const removeCustomHttpMethod = useCallback((method: string) => {
    const upperMethod = method.toUpperCase();
    setCustomHttpMethods(prev => {
      const updated = prev.filter(m => m !== upperMethod);
      storageManager.setCustomHttpMethods(updated);
      return updated;
    });
  }, []);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo(() => ({
    sidebarState,
    sidebarView,
    viewMode,
    isWebMode: webMode,
    leftPanelVisible,
    consoleVisible,
    rightPanelVisible,
    codePanelVisible,
    settingsModalOpen,
    settingsModalTab,
    importModalOpen,
    newCollectionModalOpen,
    newEnvironmentModalOpen,
    moveCollectionModalOpen,
    moveCollectionTarget,
    globalSearchOpen,
    shortcutsModalOpen,
    onboardingOpen,
    screenMirrorModalOpen,
    settings,
    consoleEntries,
    customHttpMethods,
    addCustomHttpMethod,
    removeCustomHttpMethod,
    cycleSidebarState,
    setSidebarView,
    setViewMode,
    toggleLeftPanel,
    toggleConsole,
    toggleRightPanel,
    showCodePanel,
    hideCodePanel,
    openSettingsModal,
    closeSettingsModal,
    openImportModal,
    closeImportModal,
    openNewCollectionModal,
    closeNewCollectionModal,
    openNewEnvironmentModal,
    closeNewEnvironmentModal,
    openMoveCollectionModal,
    closeMoveCollectionModal,
    openGlobalSearch,
    closeGlobalSearch,
    openShortcutsModal,
    closeShortcutsModal,
    openOnboarding,
    closeOnboarding,
    openScreenMirrorModal,
    closeScreenMirrorModal,
    updateSettings,
    logToConsole,
    clearConsole,
  }), [
    sidebarState,
    sidebarView,
    viewMode,
    webMode,
    leftPanelVisible,
    consoleVisible,
    rightPanelVisible,
    codePanelVisible,
    settingsModalOpen,
    settingsModalTab,
    importModalOpen,
    newCollectionModalOpen,
    newEnvironmentModalOpen,
    moveCollectionModalOpen,
    moveCollectionTarget,
    globalSearchOpen,
    shortcutsModalOpen,
    onboardingOpen,
    screenMirrorModalOpen,
    settings,
    consoleEntries,
    customHttpMethods,
    addCustomHttpMethod,
    removeCustomHttpMethod,
    cycleSidebarState,
    setSidebarView,
    setViewMode,
    toggleLeftPanel,
    toggleConsole,
    toggleRightPanel,
    showCodePanel,
    hideCodePanel,
    openSettingsModal,
    closeSettingsModal,
    openImportModal,
    closeImportModal,
    openNewCollectionModal,
    closeNewCollectionModal,
    openNewEnvironmentModal,
    closeNewEnvironmentModal,
    openMoveCollectionModal,
    closeMoveCollectionModal,
    openGlobalSearch,
    closeGlobalSearch,
    openShortcutsModal,
    closeShortcutsModal,
    openOnboarding,
    closeOnboarding,
    openScreenMirrorModal,
    closeScreenMirrorModal,
    updateSettings,
    logToConsole,
    clearConsole,
  ]);

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
};

export default AppContext;
