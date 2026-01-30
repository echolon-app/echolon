import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Workspace, WorkspaceEnvironment, KeyValuePair } from '@/types';
import { fileStorageManager, webFileSystemManager, cookieService } from '@/services';
import { echoConverter } from '@/services/EchoFileConverter';
import { WORKSPACE_COLORS } from '../../shared/constants';
import { useDataLoader } from './DataLoaderContext';
import { useWebModeOptional } from './WebModeContext';
import { useFileStorageOptional } from './FileStorageContext';
import { v4 as uuidv4 } from 'uuid';

interface WorkspaceContextValue {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  activeWorkspaceId: string | null;
  isLoading: boolean;
  addWorkspace: (name: string, description?: string, color?: string) => Promise<Workspace | null>;
  updateWorkspace: (id: string, updates: Partial<Workspace>) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  setActiveWorkspace: (id: string | null) => void;
  getWorkspaceNameById: (id: string) => string | undefined;
  refreshWorkspaces: () => Promise<void>;
  reorderWorkspaces: (fromIndex: number, toIndex: number) => Promise<void>;
  // Workspace environment management
  selectedWorkspaceEnvironment: WorkspaceEnvironment | null;
  addWorkspaceEnvironment: (workspaceId: string, name: string) => Promise<WorkspaceEnvironment | null>;
  updateWorkspaceEnvironment: (workspaceId: string, envId: string, updates: Partial<WorkspaceEnvironment>) => Promise<void>;
  deleteWorkspaceEnvironment: (workspaceId: string, envId: string) => Promise<void>;
  selectWorkspaceEnvironment: (workspaceId: string, envId: string | null) => Promise<void>;
  addWorkspaceVariable: (workspaceId: string, envId: string, key: string, value: string) => void;
  updateWorkspaceVariable: (workspaceId: string, envId: string, varId: string, updates: Partial<KeyValuePair>) => void;
  deleteWorkspaceVariable: (workspaceId: string, envId: string, varId: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const webMode = useWebModeOptional();
  const isWebMode = webMode?.isWebMode ?? false;
  const fileStorage = useFileStorageOptional();
  const isWebFileSystemEnabled = fileStorage?.isWebFileSystemEnabled ?? false;
  const { data, isLoading: dataLoading, refresh: refreshData } = useDataLoader();
  
  // Get the appropriate storage manager
  const getStorageManager = useCallback(() => {
    if (isWebMode && isWebFileSystemEnabled) {
      return webFileSystemManager;
    }
    return fileStorageManager;
  }, [isWebMode, isWebFileSystemEnabled]);
  
  // Should skip file operations?
  const shouldSkipFileOps = isWebMode && !isWebFileSystemEnabled;
  
  // Create the default web workspace for web mode without file system
  const defaultWebWorkspace: Workspace = useMemo(() => ({
    id: 'web-workspace',
    name: 'API Reference',
    description: 'Web mode workspace',
    color: WORKSPACE_COLORS[0],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }), []);
  
  // Initialize workspaces - in web mode without FS, start with the default workspace
  // In web mode with FS or electron, start empty (will load from file system)
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => {
    if (isWebMode && !isWebFileSystemEnabled) {
      return [defaultWebWorkspace];
    }
    return [];
  });
  
  // Initialize active workspace ID - in web mode without FS, preselect the default workspace
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(() => {
    if (isWebMode && !isWebFileSystemEnabled) {
      return 'web-workspace';
    }
    return null;
  });
  
  // Loading state: false if already initialized (web mode without FS), true otherwise
  const [isLoading, setIsLoading] = useState(() => {
    if (isWebMode && !isWebFileSystemEnabled) return false;
    return true; // Need to load from file system
  });
  
  // Track initialization state for web mode without FS only
  const virtualWorkspaceInitRef = useRef(isWebMode && !isWebFileSystemEnabled);
          
  // Initialize/sync workspaces from pre-loaded data
  useEffect(() => {
    if (dataLoading) return;
    
    // In web mode without file system, create a virtual workspace (only once)
    if (isWebMode && !isWebFileSystemEnabled) {
      if (!virtualWorkspaceInitRef.current) {
        console.log('[WorkspaceContext] Web mode without file system - creating virtual workspace');
        const webWorkspace: Workspace = {
          id: 'web-workspace',
          name: 'API Reference',
          description: 'Web mode workspace',
          color: WORKSPACE_COLORS[0],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setWorkspaces([webWorkspace]);
        setActiveWorkspaceIdState('web-workspace');
        virtualWorkspaceInitRef.current = true;
      }
      setIsLoading(false);
      return;
    }
    
    // In web mode with file system or electron mode, sync with loaded data
    // Always update when data changes (not just on initial load)
    console.log('[WorkspaceContext] Syncing with loaded data', { workspaceCount: data.workspaces.length });
    
    // Apply workspace ordering from config if available
    const workspaceOrder = data.config?.ui?.workspaceOrder;
    let orderedWorkspaces = [...data.workspaces];
    if (workspaceOrder && workspaceOrder.length > 0) {
      orderedWorkspaces.sort((a, b) => {
        const aIndex = workspaceOrder.indexOf(a.id);
        const bIndex = workspaceOrder.indexOf(b.id);
        // If not in order array, put at the end
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      });
    }
    setWorkspaces(orderedWorkspaces);
    
    // Only update active workspace if we don't have one or if it changed
    if (data.activeWorkspaceId) {
      setActiveWorkspaceIdState(data.activeWorkspaceId);
    }
    
    setIsLoading(false);
    // Reset virtual workspace flag when switching to file system mode
    virtualWorkspaceInitRef.current = false;
  }, [dataLoading, data.workspaces, data.activeWorkspaceId, data.config?.ui?.workspaceOrder, isWebMode, isWebFileSystemEnabled]);

  // Save active workspace to config when it changes (not in web mode without file system)
  useEffect(() => {
    // Don't save during initial load or in web mode without file system
    if (isLoading || activeWorkspaceId === null || shouldSkipFileOps) return;
    
    const manager = getStorageManager();
    manager.updateConfig({
      ui: { activeWorkspaceId }
    });
  }, [activeWorkspaceId, isLoading, shouldSkipFileOps, getStorageManager]);

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || null;

  // Initialize cookie service when active workspace changes
  useEffect(() => {
    if (!activeWorkspace || isLoading) return;
    
    const manager = getStorageManager();
    cookieService.initialize(
      activeWorkspace.name,
      manager,
      isWebMode,
      isWebFileSystemEnabled
    );
    
    // Load cookies for this workspace (async, but don't block)
    cookieService.loadCookies().catch(err => {
      console.error('[WorkspaceContext] Failed to load cookies:', err);
    });
  }, [activeWorkspace, isLoading, isWebMode, isWebFileSystemEnabled, getStorageManager]);

  const addWorkspace = useCallback(async (name: string, description?: string, color?: string): Promise<Workspace | null> => {
    const workspaceColor = color || WORKSPACE_COLORS[workspaces.length % WORKSPACE_COLORS.length];
    
    if (shouldSkipFileOps) {
      // In web mode without file system, create a local workspace
      const newWorkspace: Workspace = {
        id: uuidv4(),
        name,
        description,
        color: workspaceColor,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setWorkspaces(prev => [...prev, newWorkspace]);
      // Make the new workspace active
      setActiveWorkspaceIdState(newWorkspace.id);
      return newWorkspace;
    }
    
    const manager = getStorageManager();
    const result = await manager.createWorkspace(name, description, workspaceColor);
    
    if (result.success && result.workspace) {
      const newWorkspace = echoConverter.workspaceFileToWorkspace(result.workspace);
      setWorkspaces(prev => [...prev, newWorkspace]);
      // Make the new workspace active
      setActiveWorkspaceIdState(newWorkspace.id);
      return newWorkspace;
    }
    
    return null;
  }, [workspaces.length, shouldSkipFileOps, getStorageManager]);

  const updateWorkspace = useCallback(async (id: string, updates: Partial<Workspace>) => {
    const workspace = workspaces.find(w => w.id === id);
    if (!workspace) return;

    const updatedWorkspace: Workspace = {
      ...workspace,
      ...updates,
      updatedAt: Date.now(),
    };

    if (!shouldSkipFileOps) {
      const manager = getStorageManager();
      
      // If name changed, we need to rename the directory
      if (updates.name && updates.name !== workspace.name) {
        const success = await manager.renameWorkspace(workspace.name, updates.name);
        if (!success) {
          console.error('Failed to rename workspace directory');
          return;
        }
      }

      // Update workspace metadata file
      const workspaceName = updates.name || workspace.name;
      const workspaceFile = echoConverter.workspaceToWorkspaceFile(updatedWorkspace);
      await manager.updateWorkspace(workspaceName, workspaceFile);
    }

    setWorkspaces(prev =>
      prev.map(w => w.id === id ? updatedWorkspace : w)
    );
  }, [workspaces, shouldSkipFileOps, getStorageManager]);

  const deleteWorkspace = useCallback(async (id: string) => {
    // Don't allow deleting the last workspace
    if (workspaces.length <= 1) return;

    const workspace = workspaces.find(w => w.id === id);
    if (!workspace) return;

    if (!shouldSkipFileOps) {
      const manager = getStorageManager();
      const success = await manager.deleteWorkspace(workspace.name);
      if (!success) {
        console.error('Failed to delete workspace');
        return;
      }
    }
    
    setWorkspaces(prev => prev.filter(w => w.id !== id));
    
    // If deleting active workspace, switch to another
    if (activeWorkspaceId === id) {
      const remaining = workspaces.filter(w => w.id !== id);
      if (remaining.length > 0) {
        setActiveWorkspaceIdState(remaining[0].id);
      }
    }
  }, [workspaces, activeWorkspaceId, shouldSkipFileOps, getStorageManager]);

  const setActiveWorkspace = useCallback((id: string | null) => {
    if (id && workspaces.find(w => w.id === id)) {
      setActiveWorkspaceIdState(id);
    }
  }, [workspaces]);

  const getWorkspaceNameById = useCallback((id: string): string | undefined => {
    return workspaces.find(w => w.id === id)?.name;
  }, [workspaces]);

  const refreshWorkspaces = useCallback(async () => {
    await refreshData();
  }, [refreshData]);

  const reorderWorkspaces = useCallback(async (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= workspaces.length) return;
    if (toIndex < 0 || toIndex >= workspaces.length) return;

    // Reorder the workspaces array
    const newWorkspaces = [...workspaces];
    const [movedWorkspace] = newWorkspaces.splice(fromIndex, 1);
    newWorkspaces.splice(toIndex, 0, movedWorkspace);
    
    setWorkspaces(newWorkspaces);

    // Save the new order to config
    if (!shouldSkipFileOps) {
      const manager = getStorageManager();
      const workspaceOrder = newWorkspaces.map(w => w.id);
      await manager.updateConfig({
        ui: { workspaceOrder }
      });
    }
  }, [workspaces, shouldSkipFileOps, getStorageManager]);

  // Get selected workspace environment for the active workspace
  const selectedWorkspaceEnvironment = useMemo(() => {
    if (!activeWorkspace?.environments || !activeWorkspace?.selectedEnvironmentId) {
      return null;
    }
    return activeWorkspace.environments.find(e => e.id === activeWorkspace.selectedEnvironmentId) || null;
  }, [activeWorkspace?.environments, activeWorkspace?.selectedEnvironmentId]);

  const addWorkspaceEnvironment = useCallback(async (workspaceId: string, name: string): Promise<WorkspaceEnvironment | null> => {
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (!workspace) return null;

    const newEnv: WorkspaceEnvironment = {
      id: uuidv4(),
      name,
      variables: [],
      isActive: true,
    };

    const updatedWorkspace: Workspace = {
      ...workspace,
      environments: [...(workspace.environments || []), newEnv],
      selectedEnvironmentId: newEnv.id,
      updatedAt: Date.now(),
    };

    // Save to file if not skipping file operations
    if (!shouldSkipFileOps) {
      const manager = getStorageManager();
      const workspaceFile = echoConverter.workspaceToWorkspaceFile(updatedWorkspace);
      await manager.updateWorkspace(workspace.name, workspaceFile);
    }

    setWorkspaces(prev =>
      prev.map(w => w.id === workspaceId ? updatedWorkspace : w)
    );

    return newEnv;
  }, [workspaces, shouldSkipFileOps, getStorageManager]);

  const updateWorkspaceEnvironment = useCallback(async (workspaceId: string, envId: string, updates: Partial<WorkspaceEnvironment>) => {
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (!workspace?.environments) return;

    const updatedWorkspace: Workspace = {
      ...workspace,
      environments: workspace.environments.map(e =>
        e.id === envId ? { ...e, ...updates } : e
      ),
      updatedAt: Date.now(),
    };

    // Save to file if not skipping file operations
    if (!shouldSkipFileOps) {
      const manager = getStorageManager();
      const workspaceFile = echoConverter.workspaceToWorkspaceFile(updatedWorkspace);
      await manager.updateWorkspace(workspace.name, workspaceFile);
    }

    setWorkspaces(prev =>
      prev.map(w => w.id === workspaceId ? updatedWorkspace : w)
    );
  }, [workspaces, shouldSkipFileOps, getStorageManager]);

  const deleteWorkspaceEnvironment = useCallback(async (workspaceId: string, envId: string) => {
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (!workspace?.environments) return;

    const updatedWorkspace: Workspace = {
      ...workspace,
      environments: workspace.environments.filter(e => e.id !== envId),
      selectedEnvironmentId: workspace.selectedEnvironmentId === envId ? undefined : workspace.selectedEnvironmentId,
      updatedAt: Date.now(),
    };

    // Save to file if not skipping file operations
    if (!shouldSkipFileOps) {
      const manager = getStorageManager();
      const workspaceFile = echoConverter.workspaceToWorkspaceFile(updatedWorkspace);
      await manager.updateWorkspace(workspace.name, workspaceFile);
    }

    setWorkspaces(prev =>
      prev.map(w => w.id === workspaceId ? updatedWorkspace : w)
    );
  }, [workspaces, shouldSkipFileOps, getStorageManager]);

  const selectWorkspaceEnvironment = useCallback(async (workspaceId: string, envId: string | null) => {
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (!workspace) return;

    const updatedWorkspace: Workspace = {
      ...workspace,
      selectedEnvironmentId: envId || undefined,
      updatedAt: Date.now(),
    };

    // Save to file if not skipping file operations
    if (!shouldSkipFileOps) {
      const manager = getStorageManager();
      const workspaceFile = echoConverter.workspaceToWorkspaceFile(updatedWorkspace);
      await manager.updateWorkspace(workspace.name, workspaceFile);
    }

    setWorkspaces(prev =>
      prev.map(w => w.id === workspaceId ? updatedWorkspace : w)
    );
  }, [workspaces, shouldSkipFileOps, getStorageManager]);

  const addWorkspaceVariable = useCallback((workspaceId: string, envId: string, key: string, value: string) => {
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (!workspace?.environments) return;

    const newVariable: KeyValuePair = {
      id: uuidv4(),
      key,
      value,
      enabled: true,
    };

    const updatedWorkspace: Workspace = {
      ...workspace,
      environments: workspace.environments.map(e =>
        e.id === envId
          ? { ...e, variables: [...e.variables, newVariable] }
          : e
      ),
      updatedAt: Date.now(),
    };

    setWorkspaces(prev =>
      prev.map(w => w.id === workspaceId ? updatedWorkspace : w)
    );

    // Save to file if not skipping file operations
    if (!shouldSkipFileOps) {
      const manager = getStorageManager();
      const workspaceFile = echoConverter.workspaceToWorkspaceFile(updatedWorkspace);
      manager.updateWorkspace(workspace.name, workspaceFile);
    }
  }, [workspaces, shouldSkipFileOps, getStorageManager]);

  const updateWorkspaceVariable = useCallback((workspaceId: string, envId: string, varId: string, updates: Partial<KeyValuePair>) => {
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (!workspace?.environments) return;

    const updatedWorkspace: Workspace = {
      ...workspace,
      environments: workspace.environments.map(e =>
        e.id === envId
          ? {
              ...e,
              variables: e.variables.map(v =>
                v.id === varId ? { ...v, ...updates } : v
              ),
            }
          : e
      ),
      updatedAt: Date.now(),
    };

    setWorkspaces(prev =>
      prev.map(w => w.id === workspaceId ? updatedWorkspace : w)
    );

    // Save to file if not skipping file operations
    if (!shouldSkipFileOps) {
      const manager = getStorageManager();
      const workspaceFile = echoConverter.workspaceToWorkspaceFile(updatedWorkspace);
      manager.updateWorkspace(workspace.name, workspaceFile);
    }
  }, [workspaces, shouldSkipFileOps, getStorageManager]);

  const deleteWorkspaceVariable = useCallback((workspaceId: string, envId: string, varId: string) => {
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (!workspace?.environments) return;

    const updatedWorkspace: Workspace = {
      ...workspace,
      environments: workspace.environments.map(e =>
        e.id === envId
          ? { ...e, variables: e.variables.filter(v => v.id !== varId) }
          : e
      ),
      updatedAt: Date.now(),
    };

    setWorkspaces(prev =>
      prev.map(w => w.id === workspaceId ? updatedWorkspace : w)
    );

    // Save to file if not skipping file operations
    if (!shouldSkipFileOps) {
      const manager = getStorageManager();
      const workspaceFile = echoConverter.workspaceToWorkspaceFile(updatedWorkspace);
      manager.updateWorkspace(workspace.name, workspaceFile);
    }
  }, [workspaces, shouldSkipFileOps, getStorageManager]);

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeWorkspace,
        activeWorkspaceId,
        isLoading,
        addWorkspace,
        updateWorkspace,
        deleteWorkspace,
        setActiveWorkspace,
        getWorkspaceNameById,
        refreshWorkspaces,
        reorderWorkspaces,
        selectedWorkspaceEnvironment,
        addWorkspaceEnvironment,
        updateWorkspaceEnvironment,
        deleteWorkspaceEnvironment,
        selectWorkspaceEnvironment,
        addWorkspaceVariable,
        updateWorkspaceVariable,
        deleteWorkspaceVariable,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within WorkspaceProvider');
  }
  return context;
};

export default WorkspaceContext;
