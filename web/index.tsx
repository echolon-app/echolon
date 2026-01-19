import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import App from '../core/renderer/App';
import {
  ThemeProvider,
  AppProvider,
  WorkspaceProvider,
  CollectionsProvider,
  EnvironmentsProvider,
  RequestProvider,
  ToastProvider,
  WebModeProvider,
  WebModeConfig,
  MockingProvider,
  GitHubProvider,
  FileStorageProvider,
  DataLoaderProvider,
  useRequest,
} from '../core/renderer/contexts';
import { ToastContainer } from '../core/renderer/components/ui';
import { DemoModeInitializer } from '../core/renderer/components/DemoModeInitializer';
import { specImporter } from '../core/renderer/services';
import { useCollections } from '../core/renderer/contexts/CollectionsContext';
import { useEnvironments } from '../core/renderer/contexts/EnvironmentsContext';
import { useWebMode } from '../core/renderer/contexts/WebModeContext';
import { Collection, Folder, Request, Environment } from '../core/renderer/types';
import '../core/renderer/styles/index.css';
import './styles.css';

// Helper to find a request by name in a collection (searches folders recursively)
const findRequestByName = (collection: Collection, name: string): Request | null => {
  const searchInRequests = (requests: Request[]): Request | null => {
    return requests.find(r => r.name.toLowerCase().includes(name.toLowerCase())) || null;
  };
  
  const searchInFolders = (folders: Folder[]): Request | null => {
    for (const folder of folders) {
      const found = searchInRequests(folder.requests || []);
      if (found) return found;
      if (folder.folders) {
        const foundInSubfolder = searchInFolders(folder.folders);
        if (foundInSubfolder) return foundInSubfolder;
      }
    }
    return null;
  };
  
  // Search in root requests first
  const rootRequest = searchInRequests(collection.requests || []);
  if (rootRequest) return rootRequest;
  
  // Search in folders
  return searchInFolders(collection.folders || []);
};

// Spec loader component that fetches and loads the OpenAPI spec as initial collection
// Unlike before, this doesn't block the app - it loads the spec in the background
const SpecLoader: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { specUrl, setLoadedCollection, corsProxy, initialRequest, viewMode, readonly } = useWebMode();
  const { addWebModeCollection, collections } = useCollections();
  const { addWebModeEnvironment, selectEnvironment } = useEnvironments();
  const { addTab, addCollectionTab, tabs, clearAllTabs } = useRequest();
  const hasLoaded = useRef(false);
  const hasOpenedTab = useRef(false);
  const hasClearedTabs = useRef(false);

  // In readonly mode, clear any stale tabs from localStorage on initial load
  // This prevents showing empty state when restored tabs reference non-existent collections
  useEffect(() => {
    if (!readonly || hasClearedTabs.current) return;
    hasClearedTabs.current = true;
    
    // Clear tabs if there are any (they would reference stale collection IDs)
    if (tabs.length > 0) {
      clearAllTabs();
      console.log('[SpecLoader] Cleared stale tabs for readonly mode');
    }
  }, [readonly, tabs.length, clearAllTabs]);

  useEffect(() => {
    // Skip if no specUrl, already loaded, or collections already exist
    if (!specUrl || hasLoaded.current || collections.length > 0) return;
    hasLoaded.current = true;

    const loadSpec = async () => {
      try {
        // Apply CORS proxy if configured
        const fetchUrl = corsProxy ? `${corsProxy}${encodeURIComponent(specUrl)}` : specUrl;
        
        const response = await fetch(fetchUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch spec: ${response.status} ${response.statusText}`);
        }

        const content = await response.text();

        // Import the spec using the existing importer
        const result = specImporter.parseContent(content, {
          createEnvironments: true,
        });

        if (result) {
          // Attach spec source to collection for response schema extraction
          result.collection.specSource = {
            type: 'url',
            format: result.format,
            url: specUrl,
            rawSpec: result.rawSpec,
            lastSyncedAt: Date.now(),
            syncFrequencyMins: 0, // No auto-sync by default
          };
          
          // Add the collection directly to state (web mode, no file storage)
          addWebModeCollection(result.collection);
          setLoadedCollection(result.collection);
          
          // Add collection environments as global environments
          if (result.collection.environments && result.collection.environments.length > 0) {
            let firstEnvId: string | null = null;
            for (const collEnv of result.collection.environments) {
              // Convert collection environment to global environment
              const globalEnv: Environment = {
                id: collEnv.id,
                name: collEnv.name,
                variables: collEnv.variables || [],
                isActive: false,
              };
              addWebModeEnvironment(globalEnv);
              if (!firstEnvId) {
                firstEnvId = collEnv.id;
              }
            }
            // Select the first environment as active
            if (firstEnvId) {
              selectEnvironment(firstEnvId);
              console.log('[SpecLoader] Selected environment:', firstEnvId);
            }
          }
          
          console.log('[SpecLoader] Loaded initial collection from:', specUrl);
        } else {
          console.error('[SpecLoader] Failed to parse spec from:', specUrl);
        }
      } catch (err) {
        console.error('[SpecLoader] Failed to load spec:', err);
        // Don't block the app - just log the error
        // User can still use the app and import specs manually
      }
    };

    loadSpec();
  }, [specUrl, corsProxy, addWebModeCollection, setLoadedCollection, collections.length, addWebModeEnvironment, selectEnvironment]);

  // Open initial tab after collection is loaded
  useEffect(() => {
    if (hasOpenedTab.current || collections.length === 0 || tabs.length > 0) return;
    
    const collection = collections[0];
    
    // In reference view mode, open the collection's Reference tab
    if (viewMode === 'reference') {
      hasOpenedTab.current = true;
      addCollectionTab(collection, 'reference');
      console.log('[SpecLoader] Opened collection Reference tab');
      return;
    }
    
    // Otherwise, open the initial request if specified
    if (initialRequest) {
      const request = findRequestByName(collection, initialRequest);
      if (request) {
        hasOpenedTab.current = true;
        const requestWithCollection = { ...request, collectionId: collection.id };
        addTab(requestWithCollection);
        console.log('[SpecLoader] Opened initial request tab:', request.name);
      }
    }
  }, [initialRequest, viewMode, collections, addTab, addCollectionTab, tabs.length]);

  // Always render the app - spec loading happens in the background
  return <>{children}</>;
};

// Main Web App component
const WebApp: React.FC = () => {
  return (
    <DemoModeInitializer>
      <SpecLoader>
        <App />
        <ToastContainer />
      </SpecLoader>
    </DemoModeInitializer>
  );
};

// Demo modes for landing page interactive demos
export type DemoMode = 
  | 'request-editor'
  | 'variables'
  | 'git'
  | 'publishing'
  | 'mocking'
  | null;

// Mount function for programmatic use
export interface MountOptions {
  container: string | HTMLElement;
  specUrl?: string;
  corsProxy?: string;
  theme?: 'light' | 'dark' | 'system';
  viewMode?: 'tabs' | 'reference';
  readonly?: boolean;
  title?: string;
  versionsUrl?: string;
  demoMode?: DemoMode;
  hideBanner?: boolean;
  initialRequest?: string; // Name of request to open on load
}

export function mount(options: MountOptions): () => void {
  const container = typeof options.container === 'string'
    ? document.querySelector(options.container)
    : options.container;

  if (!container) {
    throw new Error(`Container not found: ${options.container}`);
  }

  const config: WebModeConfig = {
    specUrl: options.specUrl,
    corsProxy: options.corsProxy,
    theme: options.theme,
    viewMode: options.viewMode,
    readonly: options.readonly,
    title: options.title,
    versionsUrl: options.versionsUrl,
    demoMode: options.demoMode,
    hideBanner: options.hideBanner,
    initialRequest: options.initialRequest,
  };

  const root = ReactDOM.createRoot(container);

  console.log('[WebApp] Rendering WebApp');

  root.render(
    <React.StrictMode>
      <WebModeProvider config={config}>
        <ThemeProvider>
          <ToastProvider>
            <FileStorageProvider>
              <DataLoaderProvider>
              <AppProvider>
                <WorkspaceProvider>
                  <GitHubProvider>
                    <MockingProvider>
                      <CollectionsProvider>
                        <EnvironmentsProvider>
                          <RequestProvider>
                            <WebApp />
                          </RequestProvider>
                        </EnvironmentsProvider>
                      </CollectionsProvider>
                    </MockingProvider>
                  </GitHubProvider>
                </WorkspaceProvider>
              </AppProvider>
              </DataLoaderProvider>
            </FileStorageProvider>
          </ToastProvider>
        </ThemeProvider>
      </WebModeProvider>
    </React.StrictMode>
  );

  // Return unmount function
  return () => {
    root.unmount();
  };
}

// Auto-initialize from script tag
function autoInit() {
  // Find the script tag with configuration
  const scriptTag = document.getElementById('api-reference') ||
                    document.querySelector('script[data-url]');

  if (!scriptTag) {
    console.warn('Echolon Web: No configuration script tag found. Use mount() for programmatic initialization.');
    return;
  }

  // Find or create container
  let container = document.getElementById('echolon');
  if (!container) {
    // Create container if not found
    container = document.createElement('div');
    container.id = 'echolon';
    // Insert before the script tag
    scriptTag.parentNode?.insertBefore(container, scriptTag);
  }

  // Get configuration from data attributes
  const specUrl = scriptTag.getAttribute('data-url') || undefined;
  const corsProxy = scriptTag.getAttribute('data-cors-proxy') || undefined;
  const theme = scriptTag.getAttribute('data-theme') as 'light' | 'dark' | 'system' | undefined;
  const viewMode = scriptTag.getAttribute('data-view') as 'tabs' | 'reference' | undefined;
  const readonlyAttr = scriptTag.getAttribute('data-readonly');
  const readonly = readonlyAttr === 'true' || readonlyAttr === '';
  const title = scriptTag.getAttribute('data-title') || undefined;
  const versionsUrl = scriptTag.getAttribute('data-versions-url') || undefined;
  
  // Parse URL parameters for demo mode and hideBanner
  const urlParams = new URLSearchParams(window.location.search);
  const demoModeParam = urlParams.get('demo') as DemoMode;
  const demoMode = demoModeParam || (scriptTag.getAttribute('data-demo') as DemoMode) || undefined;
  const hideBannerParam = urlParams.has('hideBanner');
  const hideBannerAttr = scriptTag.getAttribute('data-hide-banner');
  const hideBanner = hideBannerParam || hideBannerAttr === 'true' || hideBannerAttr === '';
  const initialRequest = scriptTag.getAttribute('data-initial-request') || undefined;

  mount({
    container,
    specUrl,
    corsProxy,
    theme,
    viewMode,
    readonly,
    title,
    versionsUrl,
    demoMode,
    hideBanner,
    initialRequest,
  });
}

// Auto-initialize when DOM is ready (only in browser environment)
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    // DOM is already ready
    autoInit();
  }
}

// Export for ES module usage
export { WebModeProvider, useWebMode } from '../core/renderer/contexts/WebModeContext';
export default { mount };

