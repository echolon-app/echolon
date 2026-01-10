import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { fileStorageManager, webFileSystemManager, EcholonConfig, WorkspaceFile, EchoFile, GlobalEnvironmentsFile } from '@/services';
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

  // Web File System specific
  isWebMode: boolean;
  isWebFileSystemSupported: boolean;
  isWebFileSystemEnabled: boolean;
  enableWebFileSystem: () => Promise<{ success: boolean; error?: string }>;
  disableWebFileSystem: () => Promise<void>;
}

const FileStorageContext = createContext<FileStorageContextValue | null>(null);

export const FileStorageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const webMode = useWebModeOptional();
  const isWebMode = webMode?.isWebMode ?? false;
  
  // Check if Web File System API is supported
  const isWebFileSystemSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  
  // Track if web file system storage is enabled
  const [isWebFileSystemEnabled, setIsWebFileSystemEnabled] = useState(() => {
    if (!isWebMode) return false;
    return webFileSystemManager.isStorageEnabled();
  });
  
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [echolonPath, setEcholonPathState] = useState('');
  const [config, setConfig] = useState<EcholonConfig | null>(null);
  const workspaceCacheRef = useRef<Map<string, WorkspaceFile>>(new Map());
  const filePickerActiveRef = useRef(false);

  // Helper to get the appropriate storage manager
  const getStorageManager = useCallback(() => {
    if (isWebMode && isWebFileSystemEnabled) {
      return webFileSystemManager;
    }
    return fileStorageManager;
  }, [isWebMode, isWebFileSystemEnabled]);

  // Initialize file storage on mount
  useEffect(() => {
    const init = async () => {
      try {
        setIsLoading(true);
        setError(null);

        if (isWebMode) {
          // In web mode, check if we have existing directory access
          if (webFileSystemManager.isStorageEnabled()) {
            console.log('[FileStorage] Web mode - attempting to restore file system access');
            const result = await webFileSystemManager.initialize();
            
            if (result.success) {
              const path = await webFileSystemManager.getEcholonPath();
              setEcholonPathState(path);
              
              const loadedConfig = await webFileSystemManager.readConfig();
              setConfig(loadedConfig);
              
              setIsWebFileSystemEnabled(true);
              setIsInitialized(true);
              console.log('[FileStorage] Web file system restored successfully');
            } else {
              // Failed to restore - might need re-permission
              console.log('[FileStorage] Web file system restore failed:', result.error);
              setIsWebFileSystemEnabled(false);
              setIsInitialized(true); // Still initialized, just without file system
            }
          } else {
            // No file system enabled yet
            console.log('[FileStorage] Web mode - no file system enabled');
            setIsInitialized(true);
          }
        } else {
          // Electron mode
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
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error during initialization');
      } finally {
        setIsLoading(false);
      }
    };

    init();

    return () => {
      if (!isWebMode) {
        fileStorageManager.cleanup();
      }
    };
  }, [isWebMode]);

  // Enable web file system storage
  const enableWebFileSystem = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    console.log('[FileStorage] enableWebFileSystem called', { isWebMode, isWebFileSystemSupported });
    
    if (!isWebMode) {
      return { success: false, error: 'Not in web mode' };
    }

    if (!isWebFileSystemSupported) {
      return { success: false, error: 'Web File System API is not supported in this browser' };
    }

    // Prevent multiple simultaneous calls (e.g., double-click)
    if (filePickerActiveRef.current) {
      console.log('[FileStorage] File picker already active, skipping duplicate call');
      return { success: false, error: 'File picker already active' };
    }

    try {
      filePickerActiveRef.current = true;
      setIsLoading(true);
      console.log('[FileStorage] Requesting directory access...');
      const result = await webFileSystemManager.requestDirectoryAccess();
      console.log('[FileStorage] Directory access result:', result);
      
      if (result.success) {
        const path = await webFileSystemManager.getEcholonPath();
        console.log('[FileStorage] Echolon path:', path);
        setEcholonPathState(path);
        
        const loadedConfig = await webFileSystemManager.readConfig();
        console.log('[FileStorage] Loaded config:', loadedConfig);
        setConfig(loadedConfig);
        
        console.log('[FileStorage] Setting isWebFileSystemEnabled = true');
        setIsWebFileSystemEnabled(true);
        setIsInitialized(true);
        setError(null);
      }
      
      return result;
    } catch (err) {
      console.error('[FileStorage] Enable failed:', err);
      const message = err instanceof Error ? err.message : 'Failed to enable file system';
      return { success: false, error: message };
    } finally {
      filePickerActiveRef.current = false;
      setIsLoading(false);
    }
  }, [isWebMode, isWebFileSystemSupported]);

  // Disable web file system storage
  const disableWebFileSystem = useCallback(async (): Promise<void> => {
    if (!isWebMode) return;
    
    await webFileSystemManager.disconnect();
    setIsWebFileSystemEnabled(false);
    setEcholonPathState('');
    setConfig(null);
  }, [isWebMode]);

  // Set Echolon path
  const setEcholonPath = useCallback(async (newPath: string) => {
    if (isWebMode) {
      // In web mode, changing path means selecting a new directory
      return enableWebFileSystem();
    }
    const result = await fileStorageManager.setEcholonPath(newPath);
    if (result.success) {
      setEcholonPathState(newPath);
    }
    return result;
  }, [isWebMode, enableWebFileSystem]);

  // Select directory
  const selectDirectory = useCallback(async () => {
    if (isWebMode) {
      const result = await enableWebFileSystem();
      if (result.success) {
        return await webFileSystemManager.getEcholonPath();
      }
      return null;
    }
    return fileStorageManager.selectDirectory();
  }, [isWebMode, enableWebFileSystem]);

  // Open in file manager (no-op in web mode)
  const openInFileManager = useCallback(async () => {
    if (isWebMode) {
      // Can't open in file manager in web mode
      console.log('[FileStorage] Open in file manager not available in web mode');
      return;
    }
    return fileStorageManager.openInFileManager();
  }, [isWebMode]);

  // Update config
  const updateConfig = useCallback(async (updates: Partial<EcholonConfig>) => {
    const manager = getStorageManager();
    const success = await manager.updateConfig(updates);
    if (success) {
      setConfig(prev => prev ? { ...prev, ...updates } : null);
    }
    return success;
  }, [getStorageManager]);

  // Load workspaces
  const loadWorkspaces = useCallback(async (): Promise<Workspace[]> => {
    const manager = getStorageManager();
    if (isWebMode && !isWebFileSystemEnabled) {
      return [];
    }
    
    const workspaceFiles = await manager.getAllWorkspaces();
    
    // Update cache
    workspaceCacheRef.current.clear();
    workspaceFiles.forEach(wf => workspaceCacheRef.current.set(wf.name, wf));
    
    return workspaceFiles.map(echoConverter.workspaceFileToWorkspace);
  }, [getStorageManager, isWebMode, isWebFileSystemEnabled]);

  // Load collections for a workspace
  const loadCollections = useCallback(async (workspaceName: string): Promise<Collection[]> => {
    const manager = getStorageManager();
    if (isWebMode && !isWebFileSystemEnabled) {
      return [];
    }
    
    const echoFiles = await manager.getAllCollections(workspaceName);
    const workspace = workspaceCacheRef.current.get(workspaceName);
    const workspaceId = workspace?.id || workspaceName;
    
    return echoFiles.map(ef => echoConverter.echoFileToCollection(ef, workspaceId));
  }, [getStorageManager, isWebMode, isWebFileSystemEnabled]);

  // Load all collections across all workspaces
  const loadAllCollections = useCallback(async () => {
    const manager = getStorageManager();
    if (isWebMode && !isWebFileSystemEnabled) {
      return [];
    }
    
    const result = await manager.getAllCollectionsAllWorkspaces();
    
    return result.map(({ workspace, collections }) => {
      const workspaceFile = workspaceCacheRef.current.get(workspace);
      const workspaceId = workspaceFile?.id || workspace;
      
      return {
        workspaceName: workspace,
        workspaceId,
        collections: collections.map(ef => echoConverter.echoFileToCollection(ef, workspaceId)),
      };
    });
  }, [getStorageManager, isWebMode, isWebFileSystemEnabled]);

  // Load environments
  const loadEnvironments = useCallback(async () => {
    const manager = getStorageManager();
    if (isWebMode && !isWebFileSystemEnabled) {
      return { environments: [], selectedId: null };
    }
    
    const globalFile = await manager.readEnvironments();
    if (!globalFile) {
      return { environments: [], selectedId: null };
    }
    return echoConverter.globalFileToEnvironments(globalFile);
  }, [getStorageManager, isWebMode, isWebFileSystemEnabled]);

  // Save workspace
  const saveWorkspace = useCallback(async (workspace: Workspace): Promise<boolean> => {
    const manager = getStorageManager();
    if (isWebMode && !isWebFileSystemEnabled) {
      return false;
    }
    
    const workspaceFile = echoConverter.workspaceToWorkspaceFile(workspace);
    const success = await manager.updateWorkspace(workspace.name, workspaceFile);
    if (success) {
      workspaceCacheRef.current.set(workspace.name, workspaceFile);
    }
    return success;
  }, [getStorageManager, isWebMode, isWebFileSystemEnabled]);

  // Save collection
  const saveCollection = useCallback(async (collection: Collection, workspaceName: string): Promise<boolean> => {
    const manager = getStorageManager();
    if (isWebMode && !isWebFileSystemEnabled) {
      return false;
    }
    
    const echoFile = echoConverter.collectionToEchoFile(collection, workspaceName);
    const collectionName = manager.sanitizeFilename(collection.name);
    return manager.writeCollection(workspaceName, collectionName, echoFile);
  }, [getStorageManager, isWebMode, isWebFileSystemEnabled]);

  // Save environments
  const saveEnvironments = useCallback(async (environments: Environment[], selectedId: string | null): Promise<boolean> => {
    const manager = getStorageManager();
    if (isWebMode && !isWebFileSystemEnabled) {
      return false;
    }
    
    const globalFile = echoConverter.environmentsToGlobalFile(environments, selectedId);
    return manager.writeEnvironments(globalFile);
  }, [getStorageManager, isWebMode, isWebFileSystemEnabled]);

  // Delete workspace
  const deleteWorkspace = useCallback(async (workspaceName: string): Promise<boolean> => {
    const manager = getStorageManager();
    if (isWebMode && !isWebFileSystemEnabled) {
      return false;
    }
    
    const success = await manager.deleteWorkspace(workspaceName);
    if (success) {
      workspaceCacheRef.current.delete(workspaceName);
    }
    return success;
  }, [getStorageManager, isWebMode, isWebFileSystemEnabled]);

  // Delete collection
  const deleteCollection = useCallback(async (workspaceName: string, collectionName: string): Promise<boolean> => {
    const manager = getStorageManager();
    if (isWebMode && !isWebFileSystemEnabled) {
      return false;
    }
    
    const sanitizedName = manager.sanitizeFilename(collectionName);
    return manager.deleteCollection(workspaceName, sanitizedName);
  }, [getStorageManager, isWebMode, isWebFileSystemEnabled]);

  // Rename workspace
  const renameWorkspace = useCallback(async (oldName: string, newName: string): Promise<boolean> => {
    const manager = getStorageManager();
    if (isWebMode && !isWebFileSystemEnabled) {
      return false;
    }
    
    const success = await manager.renameWorkspace(oldName, newName);
    if (success) {
      const cached = workspaceCacheRef.current.get(oldName);
      if (cached) {
        workspaceCacheRef.current.delete(oldName);
        workspaceCacheRef.current.set(newName, { ...cached, name: newName });
      }
    }
    return success;
  }, [getStorageManager, isWebMode, isWebFileSystemEnabled]);

  // Rename collection
  const renameCollection = useCallback(async (workspaceName: string, oldName: string, newName: string): Promise<boolean> => {
    const manager = getStorageManager();
    if (isWebMode && !isWebFileSystemEnabled) {
      return false;
    }
    
    const sanitizedOld = manager.sanitizeFilename(oldName);
    const sanitizedNew = manager.sanitizeFilename(newName);
    return manager.renameCollection(workspaceName, sanitizedOld, sanitizedNew);
  }, [getStorageManager, isWebMode, isWebFileSystemEnabled]);

  // Create workspace
  const createWorkspace = useCallback(async (name: string, description?: string, color?: string): Promise<Workspace | null> => {
    const manager = getStorageManager();
    if (isWebMode && !isWebFileSystemEnabled) {
      return null;
    }
    
    const result = await manager.createWorkspace(name, description, color);
    if (result.success && result.workspace) {
      workspaceCacheRef.current.set(name, result.workspace);
      return echoConverter.workspaceFileToWorkspace(result.workspace);
    }
    return null;
  }, [getStorageManager, isWebMode, isWebFileSystemEnabled]);

  // File change subscription (no-op in web mode)
  const onFileChange = useCallback((callback: (event: { filename: string | null }) => void) => {
    if (isWebMode) {
      // Web File System API doesn't support file watching
      return () => {};
    }
    return fileStorageManager.onFileChange(callback);
  }, [isWebMode]);

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
        // Web file system specific
        isWebMode,
        isWebFileSystemSupported,
        isWebFileSystemEnabled,
        enableWebFileSystem,
        disableWebFileSystem,
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

// Optional hook for contexts that need to check file storage state without requiring it
export const useFileStorageOptional = () => {
  return useContext(FileStorageContext);
};

export default FileStorageContext;
