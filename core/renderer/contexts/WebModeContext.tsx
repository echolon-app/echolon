import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { Collection } from '@/types';
import { isElectron } from '@/utils';
import { specImporter } from '@/services';

export type ViewMode = 'tabs' | 'reference';

// Demo modes for landing page interactive demos
export type DemoMode = 
  | 'request-editor'    // Advanced request editor with content types, search, schema preview
  | 'variables'         // Variable support with tooltips, scopes, functions
  | 'git'              // Git integration demo
  | 'publishing'       // API public sharing workflow
  | 'mocking'          // Mock server demo
  | null;

export interface PublicSpecVersion {
  version: string;
  publishedAt?: string;
  title?: string;
  description?: string;
  url?: string;
}

export interface WebModeConfig {
  specUrl?: string;
  corsProxy?: string;
  theme?: 'light' | 'dark' | 'system';
  viewMode?: ViewMode;
  container?: string;
  readonly?: boolean;
  title?: string;
  versionsUrl?: string;
  demoMode?: DemoMode;
  hideBanner?: boolean;
  initialRequest?: string; // Name of request to open on load
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
  
  // Version switching (for public specs)
  versionsUrl: string | null;
  availableVersions: PublicSpecVersion[];
  currentVersion: string | null;
  setCurrentVersion: (version: string) => void;
  versionsLoading: boolean;
  
  // Environment selection (persisted to localStorage)
  selectedEnvironmentId: string | null;
  setSelectedEnvironmentId: (envId: string | null) => void;
  
  // Demo mode for landing page interactive demos
  demoMode: DemoMode;
  
  // Hide banner (for iframe embeds)
  hideBanner: boolean;
  
  // Initial request to open on load
  initialRequest: string | null;
}

const WebModeContext = createContext<WebModeContextValue | null>(null);

// Detect if running in web mode (not Electron)
// Uses the shared isElectron utility for consistent detection
const detectWebMode = (): boolean => {
  return !isElectron();
};

// Get config from script tag data attributes
const getScriptConfig = (): WebModeConfig => {
  if (typeof document === 'undefined') return {};
  
  const scriptTag = document.getElementById('api-reference') || 
                    document.querySelector('script[data-url]');
  
  if (!scriptTag) return {};
  
  const readonlyAttr = scriptTag.getAttribute('data-readonly');
  const hideBannerAttr = scriptTag.getAttribute('data-hide-banner');
  
  return {
    specUrl: scriptTag.getAttribute('data-url') || undefined,
    corsProxy: scriptTag.getAttribute('data-cors-proxy') || undefined,
    theme: (scriptTag.getAttribute('data-theme') as 'light' | 'dark' | 'system') || undefined,
    viewMode: (scriptTag.getAttribute('data-view') as ViewMode) || undefined,
    readonly: readonlyAttr === 'true' || readonlyAttr === '',
    title: scriptTag.getAttribute('data-title') || undefined,
    versionsUrl: scriptTag.getAttribute('data-versions-url') || undefined,
    demoMode: (scriptTag.getAttribute('data-demo') as DemoMode) || undefined,
    hideBanner: hideBannerAttr === 'true' || hideBannerAttr === '',
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
  
  // Demo mode for landing page interactive demos
  const demoMode: DemoMode = initialConfig.demoMode || null;
  
  // Hide banner for iframe embeds
  const hideBanner = initialConfig.hideBanner ?? false;
  
  // Initial request to open on load
  const initialRequest = initialConfig.initialRequest || null;
  
  // Version switching state
  const [versionsUrl] = useState<string | null>(initialConfig.versionsUrl || null);
  const [availableVersions, setAvailableVersions] = useState<PublicSpecVersion[]>([]);
  const [currentVersion, setCurrentVersionState] = useState<string | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  
  // Environment selection (persisted to localStorage)
  const [selectedEnvironmentId, setSelectedEnvironmentIdState] = useState<string | null>(() => {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem('echolon_web_selected_env');
  });
  
  // Fetch available versions from versionsUrl
  useEffect(() => {
    if (!versionsUrl) return;
    
    const fetchVersions = async () => {
      setVersionsLoading(true);
      try {
        const response = await fetch(versionsUrl);
        if (response.ok) {
          const data = await response.json();
          const versions: PublicSpecVersion[] = data.versions || [];
          setAvailableVersions(versions);
          
          // Extract current version from URL if possible
          const urlPath = window.location.pathname;
          const versionMatch = urlPath.match(/\/([^/]+)\/$/);
          if (versionMatch) {
            const urlVersion = versionMatch[1];
            const matchingVersion = versions.find(v => v.version === urlVersion);
            if (matchingVersion) {
              setCurrentVersionState(urlVersion);
            }
          }
          
          // If no current version set, default to first (latest)
          if (!currentVersion && versions.length > 0) {
            setCurrentVersionState(versions[0].version);
          }
        }
      } catch (err) {
        console.error('Failed to fetch versions:', err);
      } finally {
        setVersionsLoading(false);
      }
    };
    
    fetchVersions();
  }, [versionsUrl]);
  
  // Handle version change - fetch new spec without page reload
  const setCurrentVersion = useCallback(async (version: string) => {
    if (version === currentVersion) return;
    
    setSpecLoading(true);
    setCurrentVersionState(version);
    
    try {
      // Construct absolute URL for the selected version's openapi.json
      const baseUrl = window.location.origin;
      const specUrlToFetch = `${baseUrl}/${version}/openapi.json`;
      
      // Fetch the new spec
      const response = await fetch(specUrlToFetch);
      if (!response.ok) {
        throw new Error(`Failed to fetch spec: ${response.status}`);
      }
      
      const specContent = await response.text();
      
      // Convert the OpenAPI spec to a Collection using specImporter
      const result = specImporter.parseContent(specContent);
      const collection = result.collection;
      
      setLoadedCollection(collection);
      setSpecError(null);
      
      // Update URL without reload (history state)
      const newUrl = `${baseUrl}/${version}/`;
      window.history.pushState({ version }, '', newUrl);
      
    } catch (err) {
      console.error('Failed to switch version:', err);
      setSpecError(err instanceof Error ? err.message : 'Failed to load spec');
    } finally {
      setSpecLoading(false);
    }
  }, [currentVersion]);
  
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
  
  // Persist selected environment to localStorage
  const setSelectedEnvironmentId = useCallback((envId: string | null) => {
    setSelectedEnvironmentIdState(envId);
    if (envId) {
      localStorage.setItem('echolon_web_selected_env', envId);
    } else {
      localStorage.removeItem('echolon_web_selected_env');
    }
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
    versionsUrl,
    availableVersions,
    currentVersion,
    setCurrentVersion,
    versionsLoading,
    selectedEnvironmentId,
    setSelectedEnvironmentId,
    demoMode,
    hideBanner,
    initialRequest,
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
    versionsUrl,
    availableVersions,
    currentVersion,
    setCurrentVersion,
    versionsLoading,
    selectedEnvironmentId,
    setSelectedEnvironmentId,
    demoMode,
    hideBanner,
    initialRequest,
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

