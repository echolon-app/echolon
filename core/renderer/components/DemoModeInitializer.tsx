/**
 * Demo Mode Initializer Component
 * 
 * This component opens specific tabs and executes requests when demo mode is active.
 * It uses the requests from the loaded collection (via OpenAPI spec), not fake demo data.
 * 
 * URL Parameters:
 * - ?demo=request-editor - Demo mode to load
 * - &hideBanner=true - Hide the storage banner
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { useWebModeOptional } from '@/contexts/WebModeContext';
import { useCollections } from '@/contexts/CollectionsContext';
import { useRequest } from '@/contexts/RequestContext';
import { useEnvironments } from '@/contexts/EnvironmentsContext';
import { requestService } from '@/services';
import { Request, Collection, Environment } from '@/types';

export type DemoMode = 
  | 'request-editor'
  | 'variables'
  | 'git'
  | 'publishing'
  | 'mocking'
  | null;

// Request names to look for in the Sample CRUD API
// These match the operation summaries in the OpenAPI spec
const DEMO_REQUESTS = {
  'request-editor': {
    primary: 'Get all tasks',
    secondary: 'Get all tasks as HTML',
  },
};

// Find request by name in collection (searches root requests and folders)
const findRequestByName = (collection: Collection, name: string): Request | null => {
  // Check root requests first
  const rootRequest = collection.requests?.find(r => r.name === name);
  if (rootRequest) return rootRequest;
  
  // Check folders
  if (collection.folders) {
    for (const folder of collection.folders) {
      const folderRequest = folder.requests?.find(r => r.name === name);
      if (folderRequest) return folderRequest;
      
      // Check nested folders
      if (folder.folders) {
        for (const subFolder of folder.folders) {
          const subFolderRequest = subFolder.requests?.find(r => r.name === name);
          if (subFolderRequest) return subFolderRequest;
        }
      }
    }
  }
  return null;
};

// Find the first request in a collection (searches root requests and folders)
const findFirstRequest = (collection: Collection): Request | null => {
  // Check root requests first
  if (collection.requests && collection.requests.length > 0) {
    return collection.requests[0];
  }
  // Check folders
  if (collection.folders) {
    for (const folder of collection.folders) {
      if (folder.requests && folder.requests.length > 0) {
        return folder.requests[0];
      }
    }
  }
  return null;
};

interface DemoModeInitializerProps {
  children: React.ReactNode;
}

export const DemoModeInitializer: React.FC<DemoModeInitializerProps> = ({ children }) => {
  const webMode = useWebModeOptional();
  const { collections } = useCollections();
  const { addTab, addCollectionTab, updateTab, tabs, setActiveTab } = useRequest();
  const { environments, selectEnvironment } = useEnvironments();
  
  const tabsOpenedRef = useRef(false);
  const envSelectedRef = useRef(false);
  
  // Keep a ref to the latest tabs for async operations
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const demoMode = webMode?.demoMode as DemoMode;

  // Select the first environment when available
  useEffect(() => {
    if (demoMode && environments.length > 0 && !envSelectedRef.current) {
      envSelectedRef.current = true;
      const firstEnv = environments[0];
      if (firstEnv && !firstEnv.isActive) {
        console.log('[DemoMode] Selecting environment:', firstEnv.name);
        selectEnvironment(firstEnv.id);
      }
    }
  }, [demoMode, environments, selectEnvironment]);

  // Open appropriate tabs after collection is loaded from OpenAPI spec
  const openDemoTabs = useCallback(async () => {
    if (!demoMode || tabsOpenedRef.current) return;
    if (collections.length === 0) return;
    if (environments.length === 0) return; // Wait for environments to be loaded

    // Find the first collection (loaded from OpenAPI spec)
    const collection = collections[0];
    if (!collection) return;

    console.log('[DemoMode] Opening demo tabs for:', demoMode, 'using collection:', collection.name);
    tabsOpenedRef.current = true;

    // Find the active environment for request execution (should be selected now)
    const activeEnv = environments.find(e => e.isActive) || environments[0] || null;
    console.log('[DemoMode] Using environment:', activeEnv?.name || 'none');

    // Different behavior based on demo mode
    switch (demoMode) {
      case 'request-editor': {
        const requestNames = DEMO_REQUESTS['request-editor'];
        
        // Find requests by name
        const primaryRequest = findRequestByName(collection, requestNames.primary);
        const secondaryRequest = findRequestByName(collection, requestNames.secondary);
        
        console.log('[DemoMode] Found requests:', {
          primary: primaryRequest?.name,
          secondary: secondaryRequest?.name,
        });
        
        // Open primary request tab (JSON response)
        if (primaryRequest) {
          console.log('[DemoMode] Opening request:', primaryRequest.name);
          // Ensure collectionId is set on the request
          addTab({ ...primaryRequest, collectionId: collection.id });
        }
        
        // Open secondary request tab (HTML response)
        if (secondaryRequest) {
          console.log('[DemoMode] Opening request:', secondaryRequest.name);
          addTab({ ...secondaryRequest, collectionId: collection.id });
        }
        
        // Execute both requests after a short delay to allow tabs to be created
        setTimeout(async () => {
          const currentTabs = tabsRef.current;
          
          // Find tabs by request name
          const primaryTab = currentTabs.find(t => t.request?.name === requestNames.primary);
          const secondaryTab = currentTabs.find(t => t.request?.name === requestNames.secondary);
          
          console.log('[DemoMode] Found tabs:', { 
            primary: !!primaryTab, 
            secondary: !!secondaryTab,
            totalTabs: currentTabs.length 
          });
          
          // Execute primary request
          if (primaryRequest && primaryTab) {
            try {
              console.log('[DemoMode] Executing request:', primaryRequest.name);
              const result = await requestService.execute(
                primaryRequest,
                activeEnv as Environment | null,
                30000,
                collection
              );
              console.log('[DemoMode] Request executed:', primaryRequest.name, result?.response?.status);
              
              // Update the tab with the execution result
              updateTab(primaryTab.id, { execution: result, isLoading: false });
              
              // Set this tab as active to show the response
              setActiveTab(primaryTab.id);
            } catch (err) {
              console.log('[DemoMode] Request execution failed:', primaryRequest.name, err);
            }
          }
          
          // Execute secondary request after a small delay
          setTimeout(async () => {
            if (secondaryRequest && secondaryTab) {
              try {
                console.log('[DemoMode] Executing request:', secondaryRequest.name);
                const result = await requestService.execute(
                  secondaryRequest,
                  activeEnv as Environment | null,
                  30000,
                  collection
                );
                console.log('[DemoMode] Request executed:', secondaryRequest.name, result?.response?.status);
                
                // Update the tab with the execution result
                updateTab(secondaryTab.id, { execution: result, isLoading: false });
              } catch (err) {
                console.log('[DemoMode] Request execution failed:', secondaryRequest.name, err);
              }
            }
          }, 500);
        }, 800);
        break;
      }

      case 'variables': {
        const firstRequest = findFirstRequest(collection);
        if (firstRequest) {
          console.log('[DemoMode] Opening variables demo request');
          addTab({ ...firstRequest, collectionId: collection.id });
        }
        break;
      }

      case 'git': {
        console.log('[DemoMode] Opening collection git tab');
        addCollectionTab(collection, 'sync');
        break;
      }

      case 'publishing': {
        console.log('[DemoMode] Opening collection sharing tab');
        addCollectionTab(collection, 'sharing');
        break;
      }

      case 'mocking': {
        const firstRequest = findFirstRequest(collection);
        if (firstRequest) {
          console.log('[DemoMode] Opening mocking demo request');
          addTab({ ...firstRequest, collectionId: collection.id });
        }
        break;
      }
    }
  }, [demoMode, collections, addTab, addCollectionTab, environments, updateTab, setActiveTab]);

  // Open tabs when collections and environments are loaded
  useEffect(() => {
    if (demoMode && collections.length > 0 && environments.length > 0 && !tabsOpenedRef.current) {
      // Small delay to ensure environment is selected and UI is ready
      const timer = setTimeout(() => {
        openDemoTabs();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [demoMode, collections, environments, openDemoTabs]);

  return <>{children}</>;
};

export default DemoModeInitializer;
