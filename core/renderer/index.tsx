import React from 'react';
import ReactDOM from 'react-dom/client';
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
  WebModeProvider,
  Reference2Provider,
  FileStorageProvider,
  UpdateProvider,
} from '@/contexts';
import { ToastContainer } from '@/components/ui';

const root = ReactDOM.createRoot(document.getElementById('root')!);

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
                      <CollectionsProvider>
                        <EnvironmentsProvider>
                          <MockingProvider>
                            <RequestProvider>
                              <App />
                              <ToastContainer />
                            </RequestProvider>
                          </MockingProvider>
                        </EnvironmentsProvider>
                      </CollectionsProvider>
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
