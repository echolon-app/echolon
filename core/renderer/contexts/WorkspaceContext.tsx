import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Workspace, WorkspaceEnvironment, KeyValuePair } from '@/types';
import { fileStorageManager } from '@/services';
import { echoConverter } from '@/services/EchoFileConverter';
import { WORKSPACE_COLORS } from '../../shared/constants';
import { useDataLoader } from './DataLoaderContext';
import { useWebModeOptional } from './WebModeContext';
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
  const { data, isLoading: dataLoading, refresh: refreshData } = useDataLoader();
  
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!isWebMode);
  const initializedRef = useRef(false);
          
  // Initialize from pre-loaded data
  useEffect(() => {
    if (dataLoading || initializedRef.current) return;
    
    // In web mode, create a virtual workspace
    if (isWebMode) {
      console.log('[WorkspaceContext] Web mode - creating virtual workspace');
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
      setIsLoading(false);
      initializedRef.current = true;
      return;
    }
    
    console.log('[WorkspaceContext] Initializing with pre-loaded data');
    setWorkspaces(data.workspaces);
    setActiveWorkspaceIdState(data.activeWorkspaceId);
      setIsLoading(false);
    initializedRef.current = true;
  }, [dataLoading, data.workspaces, data.activeWorkspaceId, isWebMode]);

  // Save active workspace to config when it changes (not in web mode)
  useEffect(() => {
    if (!initializedRef.current || activeWorkspaceId === null || isWebMode) return;
    
    fileStorageManager.updateConfig({
      ui: { activeWorkspaceId }
    });
  }, [activeWorkspaceId, isWebMode]);

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || null;

  const addWorkspace = useCallback(async (name: string, description?: string, color?: string): Promise<Workspace | null> => {
    const workspaceColor = color || WORKSPACE_COLORS[workspaces.length % WORKSPACE_COLORS.length];
    
    const result = await fileStorageManager.createWorkspace(name, description, workspaceColor);
    
    if (result.success && result.workspace) {
      const newWorkspace = echoConverter.workspaceFileToWorkspace(result.workspace);
      setWorkspaces(prev => [...prev, newWorkspace]);
      return newWorkspace;
    }
    
    return null;
  }, [workspaces.length]);

  const updateWorkspace = useCallback(async (id: string, updates: Partial<Workspace>) => {
    const workspace = workspaces.find(w => w.id === id);
    if (!workspace) return;

    const updatedWorkspace: Workspace = {
      ...workspace,
      ...updates,
      updatedAt: Date.now(),
    };

    // If name changed, we need to rename the directory
    if (updates.name && updates.name !== workspace.name) {
      const success = await fileStorageManager.renameWorkspace(workspace.name, updates.name);
      if (!success) {
        console.error('Failed to rename workspace directory');
        return;
      }
    }

    // Update workspace metadata file
    const workspaceName = updates.name || workspace.name;
    const workspaceFile = echoConverter.workspaceToWorkspaceFile(updatedWorkspace);
    await fileStorageManager.updateWorkspace(workspaceName, workspaceFile);

    setWorkspaces(prev =>
      prev.map(w => w.id === id ? updatedWorkspace : w)
    );
  }, [workspaces]);

  const deleteWorkspace = useCallback(async (id: string) => {
    // Don't allow deleting the last workspace
    if (workspaces.length <= 1) return;

    const workspace = workspaces.find(w => w.id === id);
    if (!workspace) return;

    const success = await fileStorageManager.deleteWorkspace(workspace.name);
    if (!success) {
      console.error('Failed to delete workspace');
      return;
    }
    
    setWorkspaces(prev => prev.filter(w => w.id !== id));
    
    // If deleting active workspace, switch to another
    if (activeWorkspaceId === id) {
      const remaining = workspaces.filter(w => w.id !== id);
      if (remaining.length > 0) {
        setActiveWorkspaceIdState(remaining[0].id);
      }
    }
  }, [workspaces, activeWorkspaceId]);

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

    // Save to file
    const workspaceFile = echoConverter.workspaceToWorkspaceFile(updatedWorkspace);
    await fileStorageManager.updateWorkspace(workspace.name, workspaceFile);

    setWorkspaces(prev =>
      prev.map(w => w.id === workspaceId ? updatedWorkspace : w)
    );

    return newEnv;
  }, [workspaces]);

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

    // Save to file
    const workspaceFile = echoConverter.workspaceToWorkspaceFile(updatedWorkspace);
    await fileStorageManager.updateWorkspace(workspace.name, workspaceFile);

    setWorkspaces(prev =>
      prev.map(w => w.id === workspaceId ? updatedWorkspace : w)
    );
  }, [workspaces]);

  const deleteWorkspaceEnvironment = useCallback(async (workspaceId: string, envId: string) => {
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (!workspace?.environments) return;

    const updatedWorkspace: Workspace = {
      ...workspace,
      environments: workspace.environments.filter(e => e.id !== envId),
      selectedEnvironmentId: workspace.selectedEnvironmentId === envId ? undefined : workspace.selectedEnvironmentId,
      updatedAt: Date.now(),
    };

    // Save to file
    const workspaceFile = echoConverter.workspaceToWorkspaceFile(updatedWorkspace);
    await fileStorageManager.updateWorkspace(workspace.name, workspaceFile);

    setWorkspaces(prev =>
      prev.map(w => w.id === workspaceId ? updatedWorkspace : w)
    );
  }, [workspaces]);

  const selectWorkspaceEnvironment = useCallback(async (workspaceId: string, envId: string | null) => {
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (!workspace) return;

    const updatedWorkspace: Workspace = {
      ...workspace,
      selectedEnvironmentId: envId || undefined,
      updatedAt: Date.now(),
    };

    // Save to file
    const workspaceFile = echoConverter.workspaceToWorkspaceFile(updatedWorkspace);
    await fileStorageManager.updateWorkspace(workspace.name, workspaceFile);

    setWorkspaces(prev =>
      prev.map(w => w.id === workspaceId ? updatedWorkspace : w)
    );
  }, [workspaces]);

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

    // Debounced save handled by updateWorkspace
    const workspaceFile = echoConverter.workspaceToWorkspaceFile(updatedWorkspace);
    fileStorageManager.updateWorkspace(workspace.name, workspaceFile);
  }, [workspaces]);

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

    // Save to file
    const workspaceFile = echoConverter.workspaceToWorkspaceFile(updatedWorkspace);
    fileStorageManager.updateWorkspace(workspace.name, workspaceFile);
  }, [workspaces]);

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

    // Save to file
    const workspaceFile = echoConverter.workspaceToWorkspaceFile(updatedWorkspace);
    fileStorageManager.updateWorkspace(workspace.name, workspaceFile);
  }, [workspaces]);

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
