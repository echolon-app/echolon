import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { fileStorageManager, EcholonConfig, WorkspaceFile, EchoFile, GlobalEnvironmentsFile } from '@/services';
import { echoConverter } from '@/services/EchoFileConverter';
import { Collection, Workspace, Environment } from '@/types';
import { useWebModeOptional } from './WebModeContext';

interface FileStorageContextValue {
  // Initialization state
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;

  // Path management
  echolonPath: string;
  setEcholonPath: (path: string) => Promise<{ success: boolean; error?: string }>;
  selectDirectory: () => Promise<string | null>;
  openInFileManager: () => Promise<void>;

  // Config
  config: EcholonConfig | null;
  updateConfig: (updates: Partial<EcholonConfig>) => Promise<boolean>;

  // Data loading
  loadWorkspaces: () => Promise<Workspace[]>;
  loadCollections: (workspaceName: string) => Promise<Collection[]>;
  loadAllCollections: () => Promise<{ workspaceName: string; workspaceId: string; collections: Collection[] }[]>;
  loadEnvironments: () => Promise<{ environments: Environment[]; selectedId: string | null }>;

  // Data saving
  saveWorkspace: (workspace: Workspace) => Promise<boolean>;
  saveCollection: (collection: Collection, workspaceName: string) => Promise<boolean>;
  saveEnvironments: (environments: Environment[], selectedId: string | null) => Promise<boolean>;

  // Delete operations
  deleteWorkspace: (workspaceName: string) => Promise<boolean>;
  deleteCollection: (workspaceName: string, collectionName: string) => Promise<boolean>;

  // Rename operations
  renameWorkspace: (oldName: string, newName: string) => Promise<boolean>;
  renameCollection: (workspaceName: string, oldName: string, newName: string) => Promise<boolean>;

  // Create operations
  createWorkspace: (name: string, description?: string, color?: string) => Promise<Workspace | null>;

  // File change subscription
  onFileChange: (callback: (event: { filename: string | null }) => void) => () => void;
}

const FileStorageContext = createContext<FileStorageContextValue | null>(null);

export const FileStorageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const webMode = useWebModeOptional();
  const isWebMode = webMode?.isWebMode ?? false;
  
  const [isInitialized, setIsInitialized] = useState(isWebMode); // Already initialized in web mode (no file storage)
  const [isLoading, setIsLoading] = useState(!isWebMode);
  const [error, setError] = useState<string | null>(null);
  const [echolonPath, setEcholonPathState] = useState('');
  const [config, setConfig] = useState<EcholonConfig | null>(null);
  const workspaceCacheRef = useRef<Map<string, WorkspaceFile>>(new Map());

  // Initialize file storage on mount (skip in web mode)
  useEffect(() => {
    // Skip file system initialization in web mode
    if (isWebMode) {
      console.log('[FileStorage] Web mode detected, skipping file system initialization');
      setIsLoading(false);
      setIsInitialized(true);
      return;
    }
    
    const init = async () => {
      try {
        setIsLoading(true);
        const result = await fileStorageManager.initialize();
        
        if (!result.success) {
          setError(result.error || 'Failed to initialize file storage');
          return;
        }

        const path = await fileStorageManager.getEcholonPath();
        setEcholonPathState(path);

        const loadedConfig = await fileStorageManager.readConfig();
        setConfig(loadedConfig);

        setIsInitialized(true);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error during initialization');
      } finally {
        setIsLoading(false);
      }
    };

    init();

    return () => {
      fileStorageManager.cleanup();
    };
  }, [isWebMode]);

  // Set Echolon path
  const setEcholonPath = useCallback(async (newPath: string) => {
    const result = await fileStorageManager.setEcholonPath(newPath);
    if (result.success) {
      setEcholonPathState(newPath);
    }
    return result;
  }, []);

  // Select directory
  const selectDirectory = useCallback(async () => {
    return fileStorageManager.selectDirectory();
  }, []);

  // Open in file manager
  const openInFileManager = useCallback(async () => {
    return fileStorageManager.openInFileManager();
  }, []);

  // Update config
  const updateConfig = useCallback(async (updates: Partial<EcholonConfig>) => {
    const success = await fileStorageManager.updateConfig(updates);
    if (success) {
      setConfig(prev => prev ? { ...prev, ...updates } : null);
    }
    return success;
  }, []);

  // Load workspaces
  const loadWorkspaces = useCallback(async (): Promise<Workspace[]> => {
    const workspaceFiles = await fileStorageManager.getAllWorkspaces();
    
    // Update cache
    workspaceCacheRef.current.clear();
    workspaceFiles.forEach(wf => workspaceCacheRef.current.set(wf.name, wf));
    
    return workspaceFiles.map(echoConverter.workspaceFileToWorkspace);
  }, []);

  // Load collections for a workspace
  const loadCollections = useCallback(async (workspaceName: string): Promise<Collection[]> => {
    const echoFiles = await fileStorageManager.getAllCollections(workspaceName);
    const workspace = workspaceCacheRef.current.get(workspaceName);
    const workspaceId = workspace?.id || workspaceName;
    
    return echoFiles.map(ef => echoConverter.echoFileToCollection(ef, workspaceId));
  }, []);

  // Load all collections across all workspaces
  const loadAllCollections = useCallback(async () => {
    const result = await fileStorageManager.getAllCollectionsAllWorkspaces();
    
    return result.map(({ workspace, collections }) => {
      const workspaceFile = workspaceCacheRef.current.get(workspace);
      const workspaceId = workspaceFile?.id || workspace;
      
      return {
        workspaceName: workspace,
        workspaceId,
        collections: collections.map(ef => echoConverter.echoFileToCollection(ef, workspaceId)),
      };
    });
  }, []);

  // Load environments
  const loadEnvironments = useCallback(async () => {
    const globalFile = await fileStorageManager.readEnvironments();
    if (!globalFile) {
      return { environments: [], selectedId: null };
    }
    return echoConverter.globalFileToEnvironments(globalFile);
  }, []);

  // Save workspace
  const saveWorkspace = useCallback(async (workspace: Workspace): Promise<boolean> => {
    const workspaceFile = echoConverter.workspaceToWorkspaceFile(workspace);
    const success = await fileStorageManager.updateWorkspace(workspace.name, workspaceFile);
    if (success) {
      workspaceCacheRef.current.set(workspace.name, workspaceFile);
    }
    return success;
  }, []);

  // Save collection
  const saveCollection = useCallback(async (collection: Collection, workspaceName: string): Promise<boolean> => {
    const echoFile = echoConverter.collectionToEchoFile(collection, workspaceName);
    const collectionName = fileStorageManager.sanitizeFilename(collection.name);
    return fileStorageManager.writeCollection(workspaceName, collectionName, echoFile);
  }, []);

  // Save environments
  const saveEnvironments = useCallback(async (environments: Environment[], selectedId: string | null): Promise<boolean> => {
    const globalFile = echoConverter.environmentsToGlobalFile(environments, selectedId);
    return fileStorageManager.writeEnvironments(globalFile);
  }, []);

  // Delete workspace
  const deleteWorkspace = useCallback(async (workspaceName: string): Promise<boolean> => {
    const success = await fileStorageManager.deleteWorkspace(workspaceName);
    if (success) {
      workspaceCacheRef.current.delete(workspaceName);
    }
    return success;
  }, []);

  // Delete collection
  const deleteCollection = useCallback(async (workspaceName: string, collectionName: string): Promise<boolean> => {
    const sanitizedName = fileStorageManager.sanitizeFilename(collectionName);
    return fileStorageManager.deleteCollection(workspaceName, sanitizedName);
  }, []);

  // Rename workspace
  const renameWorkspace = useCallback(async (oldName: string, newName: string): Promise<boolean> => {
    const success = await fileStorageManager.renameWorkspace(oldName, newName);
    if (success) {
      const cached = workspaceCacheRef.current.get(oldName);
      if (cached) {
        workspaceCacheRef.current.delete(oldName);
        workspaceCacheRef.current.set(newName, { ...cached, name: newName });
      }
    }
    return success;
  }, []);

  // Rename collection
  const renameCollection = useCallback(async (workspaceName: string, oldName: string, newName: string): Promise<boolean> => {
    const sanitizedOld = fileStorageManager.sanitizeFilename(oldName);
    const sanitizedNew = fileStorageManager.sanitizeFilename(newName);
    return fileStorageManager.renameCollection(workspaceName, sanitizedOld, sanitizedNew);
  }, []);

  // Create workspace
  const createWorkspace = useCallback(async (name: string, description?: string, color?: string): Promise<Workspace | null> => {
    const result = await fileStorageManager.createWorkspace(name, description, color);
    if (result.success && result.workspace) {
      workspaceCacheRef.current.set(name, result.workspace);
      return echoConverter.workspaceFileToWorkspace(result.workspace);
    }
    return null;
  }, []);

  // File change subscription
  const onFileChange = useCallback((callback: (event: { filename: string | null }) => void) => {
    return fileStorageManager.onFileChange(callback);
  }, []);

  return (
    <FileStorageContext.Provider
      value={{
        isInitialized,
        isLoading,
        error,
        echolonPath,
        setEcholonPath,
        selectDirectory,
        openInFileManager,
        config,
        updateConfig,
        loadWorkspaces,
        loadCollections,
        loadAllCollections,
        loadEnvironments,
        saveWorkspace,
        saveCollection,
        saveEnvironments,
        deleteWorkspace,
        deleteCollection,
        renameWorkspace,
        renameCollection,
        createWorkspace,
        onFileChange,
      }}
    >
      {children}
    </FileStorageContext.Provider>
  );
};

export const useFileStorage = () => {
  const context = useContext(FileStorageContext);
  if (!context) {
    throw new Error('useFileStorage must be used within FileStorageProvider');
  }
  return context;
};

export default FileStorageContext;

