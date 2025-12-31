import React, { useEffect, useState, useRef } from 'react';
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
import { useEnvironments } from '../core/renderer/contexts/EnvironmentsContext';
import { useWebMode } from '../core/renderer/contexts/WebModeContext';
import '../core/renderer/styles/index.css';
import './styles.css';

// Spec loader component that fetches and loads the OpenAPI spec
const SpecLoader: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { specUrl, setLoadedCollection, corsProxy } = useWebMode();
  const { addWebModeCollection } = useCollections();
  const { addWebModeEnvironment } = useEnvironments();
  const [loading, setLoading] = useState(!!specUrl);
  const [error, setError] = useState<string | null>(null);
  const hasLoaded = useRef(false);

  useEffect(() => {
    if (!specUrl || hasLoaded.current) return;
    hasLoaded.current = true;

    const loadSpec = async () => {
      setLoading(true);
      setError(null);

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
          };
          
          // Add the collection directly to state (web mode, no file storage)
          addWebModeCollection(result.collection);
          setLoadedCollection(result.collection);
          
          // Add environments from the spec (servers array)
          if (result.environments && result.environments.length > 0) {
            for (const env of result.environments) {
              addWebModeEnvironment(env);
            }
          }
        } else {
          setError('Failed to parse API specification - invalid format');
        }
      } catch (err) {
        console.error('Failed to load spec:', err);
        setError(err instanceof Error ? err.message : 'Failed to load API specification');
      } finally {
        setLoading(false);
      }
    };

    loadSpec();
  }, [specUrl, corsProxy, addWebModeCollection, setLoadedCollection, addWebModeEnvironment]);

  if (loading) {
    return (
      <div className="echolon-web-loading">
        <div className="echolon-web-loading__spinner" />
        <p>Loading API specification...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="echolon-web-error">
        <h2>Failed to load API specification</h2>
        <p>{error}</p>
        <p className="echolon-web-error__hint">
          If this is a CORS error, try configuring a CORS proxy using the <code>data-cors-proxy</code> attribute.
        </p>
      </div>
    );
  }

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

  mount({
    container,
    specUrl,
    corsProxy,
    theme,
    viewMode,
    readonly,
    title,
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

