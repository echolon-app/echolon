/**
 * DataLoaderContext - Parallel data loading for faster startup
 * 
 * Loads workspaces, collections, and environments in parallel
 * instead of sequentially to improve startup performance.
 */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { fileStorageManager, webFileSystemManager } from '@/services';
import { echoConverter } from '@/services/EchoFileConverter';
import { Collection, Workspace, Environment } from '@/types';
import { WORKSPACE_COLORS } from '../../shared/constants';
import { EcholonConfig, WorkspaceFile, GlobalEnvironmentsFile } from '@/services/FileStorageManager';
import { useWebModeOptional } from './WebModeContext';
import { useFileStorageOptional } from './FileStorageContext';

export interface LoadedData {
  workspaces: Workspace[];
  collections: Collection[];
  environments: Environment[];
  selectedEnvironmentId: string | null;
  activeWorkspaceId: string | null;
  config: EcholonConfig | null;
}

export interface LoadingTimings {
  total: number;
  fileStorageInit: number;
  workspaces: number;
  collections: number;
  environments: number;
  config: number;
}

interface DataLoaderContextValue {
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  data: LoadedData;
  timings: LoadingTimings | null;
  refresh: () => Promise<void>;
}

const defaultData: LoadedData = {
  workspaces: [],
  collections: [],
  environments: [],
  selectedEnvironmentId: null,
  activeWorkspaceId: null,
  config: null,
};

const DataLoaderContext = createContext<DataLoaderContextValue | null>(null);

export const DataLoaderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const webMode = useWebModeOptional();
  const isWebMode = webMode?.isWebMode ?? false;
  // Use optional hook to avoid circular dependency - FileStorageContext provides this
  const fileStorage = useFileStorageOptional();
  const isWebFileSystemEnabled = fileStorage?.isWebFileSystemEnabled ?? false;
  
  // In web mode without file system: no loading needed (already initialized)
  // In web mode with file system OR electron mode: need to load data
  const [isLoading, setIsLoading] = useState(() => {
    if (isWebMode && !isWebFileSystemEnabled) return false; // No loading in pure web mode
    return true; // Need to load data from file system
  });
  const [isInitialized, setIsInitialized] = useState(isWebMode && !isWebFileSystemEnabled); // Already initialized in web mode without FS
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LoadedData>(defaultData);
  const [timings, setTimings] = useState<LoadingTimings | null>(null);
  const loadStartedRef = useRef(false);
  const lastWebFsEnabledRef = useRef(isWebFileSystemEnabled);

  const loadAllData = useCallback(async (forceLoad = false) => {
    // In web mode without web file system, skip file system loading
    if (isWebMode && !isWebFileSystemEnabled && !forceLoad) {
      console.log('[DataLoader] Web mode detected without web file system, skipping file system initialization');
      setIsLoading(false);
      setIsInitialized(true);
      return;
    }
    
    // Use appropriate storage manager
    const storageManager = isWebMode ? webFileSystemManager : fileStorageManager;
    
    const totalStart = performance.now();
    const timingResults: Partial<LoadingTimings> = {};

    try {
      console.log(`[DataLoader] Starting parallel data load... (webMode: ${isWebMode}, webFS: ${isWebFileSystemEnabled})`);

      // Step 1: Initialize file storage (must happen first)
      const fsInitStart = performance.now();
      const initResult = await storageManager.initialize();
      timingResults.fileStorageInit = Math.round(performance.now() - fsInitStart);
      //console.log(`[DataLoader] File storage init: ${timingResults.fileStorageInit}ms`);

      if (!initResult.success) {
        throw new Error(initResult.error || 'Failed to initialize file storage');
      }

      // Step 2: Load everything in parallel
      const parallelStart = performance.now();
      
      const [
        workspaceFilesResult,
        collectionsDataResult,
        environmentsResult,
        configResult,
      ] = await Promise.all([
        // Load workspaces
        (async () => {
          const start = performance.now();
          const files = await storageManager.getAllWorkspaces();
          timingResults.workspaces = Math.round(performance.now() - start);
          console.log(`[DataLoader] Workspaces loaded: ${timingResults.workspaces}ms (${files.length} workspaces)`);
          return files;
        })(),
        
        // Load collections
        (async () => {
          const start = performance.now();
          const result = await storageManager.getAllCollectionsAllWorkspaces();
          timingResults.collections = Math.round(performance.now() - start);
          const totalCollections = result.reduce((sum, w) => sum + w.collections.length, 0);
          console.log(`[DataLoader] Collections loaded: ${timingResults.collections}ms (${totalCollections} collections)`);
          return result;
        })(),
        
        // Load environments
        (async () => {
          const start = performance.now();
          const envFile = await storageManager.readEnvironments();
          timingResults.environments = Math.round(performance.now() - start);
          //console.log(`[DataLoader] Environments loaded: ${timingResults.environments}ms`);
          return envFile;
        })(),
        
        // Load config
        (async () => {
          const start = performance.now();
          const config = await storageManager.readConfig();
          timingResults.config = Math.round(performance.now() - start);
          //console.log(`[DataLoader] Config loaded: ${timingResults.config}ms`);
          return config;
        })(),
      ]);

      //console.log(`[DataLoader] Parallel loading took: ${Math.round(performance.now() - parallelStart)}ms`);

      // Process workspaces
      let workspaces = workspaceFilesResult.map(echoConverter.workspaceFileToWorkspace);

      //console.log('[DataLoader] Workspaces loaded:', workspaces);
      
      // If no workspaces exist, create a default one
      if (workspaces.length === 0) {
        console.log('[DataLoader] Creating default workspace...');
        const result = await storageManager.createWorkspace(
          'Default Workspace',
          'Your default workspace',
          WORKSPACE_COLORS[0]
        );
        if (result.success && result.workspace) {
          workspaces = [echoConverter.workspaceFileToWorkspace(result.workspace)];
        }
      }

      //console.log('[DataLoader] collectionsDataResult:', collectionsDataResult);

      // Process collections
      const collections: Collection[] = [];
      for (const { workspace, collections: echoFiles } of collectionsDataResult) {
        const workspaceFile = workspaceFilesResult.find(w => w.name === workspace);
        const workspaceId = workspaceFile?.id || workspace;
        //console.log('[DataLoader] workspaceId:', workspaceId);
        
        for (const echoFile of echoFiles) {
        
          collections.push(echoConverter.echoFileToCollection(echoFile, workspaceId));
        }
      }

      // Process environments
      let environments: Environment[] = [];
      let selectedEnvironmentId: string | null = null;

      //console.log('[DataLoader] environmentsResult:', environmentsResult);
      
      if (environmentsResult) {
        const envData = echoConverter.globalFileToEnvironments(environmentsResult);
        environments = envData.environments;
        selectedEnvironmentId = envData.selectedId;
      }

      // Get active workspace ID from config
      let activeWorkspaceId: string | null = configResult?.ui?.activeWorkspaceId as string | null || null;
      
      // If no active workspace or it doesn't exist, use first workspace
      if (!activeWorkspaceId || !workspaces.find(w => w.id === activeWorkspaceId)) {
        activeWorkspaceId = workspaces.length > 0 ? workspaces[0].id : null;
      }

      timingResults.total = Math.round(performance.now() - totalStart);
      console.log(`[DataLoader] Total loading time: ${timingResults.total}ms`);

      setData({
        workspaces,
        collections,
        environments,
        selectedEnvironmentId,
        activeWorkspaceId,
        config: configResult,
      });
      
      setTimings(timingResults as LoadingTimings);
      setIsInitialized(true);
      setError(null);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[DataLoader] Error loading data:', message);
      setError(message);
      timingResults.total = Math.round(performance.now() - totalStart);
      setTimings(timingResults as LoadingTimings);
    } finally {
      setIsLoading(false);
    }
  }, [isWebMode, isWebFileSystemEnabled]);

  // Initial load
  useEffect(() => {
    if (loadStartedRef.current) return;
    loadStartedRef.current = true;
    loadAllData();
  }, [loadAllData]);

  // Reload when web file system becomes enabled
  useEffect(() => {
    if (isWebMode && isWebFileSystemEnabled && !lastWebFsEnabledRef.current) {
      console.log('[DataLoader] Web file system just enabled, reloading data...');
      lastWebFsEnabledRef.current = true;
      setIsLoading(true);
      loadAllData(true);
    }
  }, [isWebMode, isWebFileSystemEnabled, loadAllData]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await loadAllData(true);
  }, [loadAllData]);

  return (
    <DataLoaderContext.Provider
      value={{
        isLoading,
        isInitialized,
        error,
        data,
        timings,
        refresh,
      }}
    >
      {children}
    </DataLoaderContext.Provider>
  );
};

export const useDataLoader = () => {
  const context = useContext(DataLoaderContext);
  if (!context) {
    throw new Error('useDataLoader must be used within DataLoaderProvider');
  }
  return context;
};

export default DataLoaderContext;

