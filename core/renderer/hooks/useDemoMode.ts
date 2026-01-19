/**
 * Demo Mode Hook
 * 
 * Initializes demo data and state when the app is loaded with a demo mode parameter.
 * This hook should be called from the main App component or SpecLoader.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useWebModeOptional } from '@/contexts/WebModeContext';
import { useCollections } from '@/contexts/CollectionsContext';
import { useRequest } from '@/contexts/RequestContext';
import { useEnvironments } from '@/contexts/EnvironmentsContext';
import { getDemoData } from '@/services/DemoDataProvider';
import type { DemoMode } from '@/services/DemoDataProvider';
import { requestService } from '@/services';
import { Request, Collection } from '@/types';

interface UseDemoModeOptions {
  onDemoReady?: () => void;
}

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

export function useDemoMode(options: UseDemoModeOptions = {}) {
  const webMode = useWebModeOptional();
  const { addWebModeCollection, collections } = useCollections();
  const { addTab, addCollectionTab } = useRequest();
  const { addWebModeEnvironment, environments, selectEnvironment } = useEnvironments();
  const initializedRef = useRef(false);
  const demoReadyRef = useRef(false);

  const demoMode = webMode?.demoMode as DemoMode;

  // Initialize demo data
  const initializeDemo = useCallback(async () => {
    if (!demoMode || initializedRef.current) return;
    initializedRef.current = true;

    console.log('[DemoMode] Initializing demo:', demoMode);

    const demoData = getDemoData(demoMode);
    if (!demoData) {
      console.warn('[DemoMode] No demo data found for mode:', demoMode);
      return;
    }

    // Add demo collection
    console.log('[DemoMode] Adding demo collection:', demoData.collection.name);
    addWebModeCollection(demoData.collection);

    // Add demo environments
    for (const env of demoData.environments) {
      // Check if environment already exists
      const existing = environments.find(e => e.id === env.id);
      if (!existing) {
        console.log('[DemoMode] Adding demo environment:', env.name);
        addWebModeEnvironment(env);
      }
    }

    // Set active environment if specified
    if (demoData.selectedEnvironmentId) {
      console.log('[DemoMode] Setting active environment:', demoData.selectedEnvironmentId);
      selectEnvironment(demoData.selectedEnvironmentId);
    }

    // Small delay to let state settle
    await new Promise(resolve => setTimeout(resolve, 100));

    console.log('[DemoMode] Demo initialized successfully');
  }, [demoMode, addWebModeCollection, addWebModeEnvironment, environments, selectEnvironment]);

  // Open appropriate tabs after collection is loaded
  const openDemoTabs = useCallback(async () => {
    if (!demoMode || demoReadyRef.current) return;
    if (collections.length === 0) return;

    const demoData = getDemoData(demoMode);
    if (!demoData) return;

    // Find the demo collection
    const demoCollection = collections.find(c => c.id === demoData.collection.id);
    if (!demoCollection) return;

    console.log('[DemoMode] Opening demo tabs for:', demoMode);
    demoReadyRef.current = true;

    // Different behavior based on demo mode
    switch (demoMode) {
      case 'request-editor': {
        // Find and open the first request, then execute it
        const firstRequest = findFirstRequest(demoCollection);
        if (firstRequest) {
          console.log('[DemoMode] Opening request:', firstRequest.name);
          addTab(firstRequest, demoCollection.id);
          
          // Execute the request after a short delay to show the response
          setTimeout(async () => {
            try {
              console.log('[DemoMode] Executing demo request');
              await requestService.executeRequest(
                firstRequest,
                demoCollection,
                environments,
                environments.find(e => e.id === demoData.selectedEnvironmentId) || null
              );
            } catch (err) {
              console.log('[DemoMode] Request execution failed (expected in demo):', err);
            }
          }, 500);
        }
        break;
      }

      case 'variables': {
        // Open the first request to show variables in action
        const firstRequest = findFirstRequest(demoCollection);
        if (firstRequest) {
          console.log('[DemoMode] Opening variables demo request');
          addTab(firstRequest, demoCollection.id);
        }
        break;
      }

      case 'git': {
        // Open collection editor on git/sync tab
        console.log('[DemoMode] Opening collection git tab');
        addCollectionTab(demoCollection, 'sync');
        break;
      }

      case 'publishing': {
        // Open collection editor on sharing tab
        console.log('[DemoMode] Opening collection sharing tab');
        addCollectionTab(demoCollection, 'sharing');
        break;
      }

      case 'mocking': {
        // Open the first mocked request
        const firstRequest = findFirstRequest(demoCollection);
        if (firstRequest) {
          console.log('[DemoMode] Opening mocking demo request');
          addTab(firstRequest, demoCollection.id);
        }
        break;
      }
    }

    // Notify that demo is ready
    if (options.onDemoReady) {
      options.onDemoReady();
    }
  }, [demoMode, collections, addTab, addCollectionTab, environments, options]);

  // Initialize demo on mount
  useEffect(() => {
    if (demoMode && !initializedRef.current) {
      initializeDemo();
    }
  }, [demoMode, initializeDemo]);

  // Open tabs when collections are loaded
  useEffect(() => {
    if (demoMode && collections.length > 0 && !demoReadyRef.current) {
      // Small delay to ensure UI is ready
      const timer = setTimeout(() => {
        openDemoTabs();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [demoMode, collections, openDemoTabs]);

  return {
    isDemo: !!demoMode,
    demoMode,
    isReady: demoReadyRef.current,
  };
}

export default useDemoMode;
