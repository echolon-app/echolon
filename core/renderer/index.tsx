import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/aceSearchboxPatch';
import App from './App';
import {
  ThemeProvider,
  AppProvider,
  WorkspaceProvider,
  CollectionsProvider,
  EnvironmentsProvider,
  RequestProvider,
  MockingProvider,
  ToastProvider,
  DataLoaderProvider,
  GitHubProvider,
  GitProvider,
  WebModeProvider,
  Reference2Provider,
  FileStorageProvider,
  UpdateProvider,
} from '@/contexts';
import { ToastContainer } from '@/components/ui';

const root = ReactDOM.createRoot(document.getElementById('root')!);

const AppWithToasts = React.memo(function AppWithToasts() {
  return (
    <>
      <App />
      <ToastContainer />
    </>
  );
});

root.render(
    <Reference2Provider>
    <ThemeProvider>
      <WebModeProvider>
        <FileStorageProvider>
          <ToastProvider>
            <UpdateProvider>
              <DataLoaderProvider>
                <AppProvider>
                  <WorkspaceProvider>
                    <GitHubProvider>
                      <GitProvider>
                      <CollectionsProvider>
                        <EnvironmentsProvider>
                          <MockingProvider>
                            <RequestProvider>
                              <AppWithToasts />
                            </RequestProvider>
                          </MockingProvider>
                        </EnvironmentsProvider>
                      </CollectionsProvider>
                      </GitProvider>
                    </GitHubProvider>
                  </WorkspaceProvider>
                </AppProvider>
              </DataLoaderProvider>
            </UpdateProvider>
          </ToastProvider>
        </FileStorageProvider>
      </WebModeProvider>
    </ThemeProvider>
    </Reference2Provider>
);
