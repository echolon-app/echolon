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
} from '../core/renderer/contexts';
import { ToastContainer } from '../core/renderer/components/ui';
import { specImporter } from '../core/renderer/services';
import { useCollections } from '../core/renderer/contexts/CollectionsContext';
import { useWebMode } from '../core/renderer/contexts/WebModeContext';
import '../core/renderer/styles/index.css';
import './styles.css';

// Spec loader component that fetches and loads the OpenAPI spec as initial collection
// Unlike before, this doesn't block the app - it loads the spec in the background
const SpecLoader: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { specUrl, setLoadedCollection, corsProxy } = useWebMode();
  const { addWebModeCollection, collections } = useCollections();
  const hasLoaded = useRef(false);

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
  }, [specUrl, corsProxy, addWebModeCollection, setLoadedCollection, collections.length]);

  // Always render the app - spec loading happens in the background
  return <>{children}</>;
};

// Main Web App component
const WebApp: React.FC = () => {
  return (
    <SpecLoader>
      <App />
      <ToastContainer />
    </SpecLoader>
  );
};

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
  };

  const root = ReactDOM.createRoot(container);

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

  mount({
    container,
    specUrl,
    corsProxy,
    theme,
    viewMode,
    readonly,
    title,
    versionsUrl,
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

