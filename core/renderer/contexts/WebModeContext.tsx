import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { Collection } from '@/types';

export type ViewMode = 'tabs' | 'reference';

export interface WebModeConfig {
  specUrl?: string;
  corsProxy?: string;
  theme?: 'light' | 'dark' | 'system';
  viewMode?: ViewMode;
  container?: string;
  readonly?: boolean;
  title?: string;
}

interface WebModeContextValue {
  // Detection
  isWebMode: boolean;
  
  // Configuration
  corsProxy: string;
  setCorsProxy: (proxy: string) => void;
  
  // View mode (tabs vs reference)
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  
  // Spec loading
  specUrl: string | null;
  specLoading: boolean;
  specError: string | null;
  loadedCollection: Collection | null;
  setLoadedCollection: (collection: Collection | null) => void;
  
  // Readonly mode - prevents collection modifications
  readonly: boolean;
  
  // Page title
  title: string | null;
  
  // Initial config from script attributes
  initialConfig: WebModeConfig;
}

const WebModeContext = createContext<WebModeContextValue | null>(null);

// Detect if running in web mode (not Electron)
const detectWebMode = (): boolean => {
  // In Electron, window.electronAPI is defined by preload script
  return typeof window !== 'undefined' && !window.electronAPI;
};

// Get config from script tag data attributes
const getScriptConfig = (): WebModeConfig => {
  if (typeof document === 'undefined') return {};
  
  const scriptTag = document.getElementById('api-reference') || 
                    document.querySelector('script[data-url]');
  
  if (!scriptTag) return {};
  
  const readonlyAttr = scriptTag.getAttribute('data-readonly');
  
  return {
    specUrl: scriptTag.getAttribute('data-url') || undefined,
    corsProxy: scriptTag.getAttribute('data-cors-proxy') || undefined,
    theme: (scriptTag.getAttribute('data-theme') as 'light' | 'dark' | 'system') || undefined,
    viewMode: (scriptTag.getAttribute('data-view') as ViewMode) || undefined,
    readonly: readonlyAttr === 'true' || readonlyAttr === '',
    title: scriptTag.getAttribute('data-title') || undefined,
  };
};

interface WebModeProviderProps {
  children: React.ReactNode;
  config?: WebModeConfig;
}

export const WebModeProvider: React.FC<WebModeProviderProps> = ({ children, config: propConfig }) => {
  const isWebMode = detectWebMode();
  
  // Merge script config with prop config (prop config takes precedence)
  const scriptConfig = useMemo(() => getScriptConfig(), []);
  const initialConfig = useMemo(() => ({
    ...scriptConfig,
    ...propConfig,
  }), [scriptConfig, propConfig]);
  
  // CORS proxy configuration
  const [corsProxy, setCorsProxyState] = useState<string>(() => {
    if (initialConfig.corsProxy) return initialConfig.corsProxy;
    // Try to load from localStorage
    const stored = localStorage.getItem('echolon_cors_proxy');
    return stored || '';
  });
  
  // View mode
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    if (initialConfig.viewMode) return initialConfig.viewMode;
    // Default to 'tabs' - same as Electron
    return 'tabs';
  });
  
  // Spec loading state
  const [specUrl] = useState<string | null>(initialConfig.specUrl || null);
  const [specLoading, setSpecLoading] = useState(false);
  const [specError, setSpecError] = useState<string | null>(null);
  const [loadedCollection, setLoadedCollection] = useState<Collection | null>(null);
  
  // Readonly mode
  const readonly = initialConfig.readonly ?? false;
  
  // Page title
  const title = initialConfig.title || null;
  
  // Set document title if provided
  useEffect(() => {
    if (title && typeof document !== 'undefined') {
      document.title = title;
    }
  }, [title]);
  
  // Persist CORS proxy to localStorage
  const setCorsProxy = useCallback((proxy: string) => {
    setCorsProxyState(proxy);
    localStorage.setItem('echolon_cors_proxy', proxy);
  }, []);
  
  // Persist view mode to localStorage
  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    localStorage.setItem('echolon_view_mode', mode);
  }, []);
  
  // Load view mode from localStorage on mount (if not set by config)
  useEffect(() => {
    if (!initialConfig.viewMode) {
      const stored = localStorage.getItem('echolon_view_mode') as ViewMode | null;
      if (stored && (stored === 'tabs' || stored === 'reference')) {
        setViewModeState(stored);
      }
    }
  }, [initialConfig.viewMode]);
  
  const contextValue = useMemo(() => ({
    isWebMode,
    corsProxy,
    setCorsProxy,
    viewMode,
    setViewMode,
    specUrl,
    specLoading,
    specError,
    loadedCollection,
    setLoadedCollection,
    readonly,
    title,
    initialConfig,
  }), [
    isWebMode,
    corsProxy,
    setCorsProxy,
    viewMode,
    setViewMode,
    specUrl,
    specLoading,
    specError,
    loadedCollection,
    setLoadedCollection,
    readonly,
    title,
    initialConfig,
  ]);
  
  return (
    <WebModeContext.Provider value={contextValue}>
      {children}
    </WebModeContext.Provider>
  );
};

export const useWebMode = () => {
  const context = useContext(WebModeContext);
  if (!context) {
    throw new Error('useWebMode must be used within WebModeProvider');
  }
  return context;
};

// Optional hook that returns null if not in WebModeProvider (for optional usage)
export const useWebModeOptional = () => {
  return useContext(WebModeContext);
};

export default WebModeContext;

