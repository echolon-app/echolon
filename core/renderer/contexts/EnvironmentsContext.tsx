import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Environment, KeyValuePair, CollectionEnvironment, WorkspaceEnvironment } from '@/types';
import { fileStorageManager } from '@/services';
import { echoConverter } from '@/services/EchoFileConverter';
import { useDataLoader } from './DataLoaderContext';
import { useWebModeOptional } from './WebModeContext';
import { v4 as uuidv4 } from 'uuid';

// Variable with source information
export interface ResolvedVariable {
  key: string;
  value: string;
  enabled: boolean;
  source: 'global' | 'workspace' | 'collection';
  sourceName: string;
}

interface EnvironmentsContextValue {
  environments: Environment[];
  activeEnvironments: Environment[];
  selectedEnvironment: Environment | null;
  isLoading: boolean;
  addEnvironment: (name: string) => Promise<Environment>;
  importEnvironment: (env: Environment, checkDuplicate?: boolean) => Promise<Environment | null>;
  // Web mode only - add environment directly to state without file storage
  addWebModeEnvironment: (env: Environment) => void;
  updateEnvironment: (id: string, updates: Partial<Environment>) => void;
  deleteEnvironment: (id: string) => void;
  toggleEnvironmentActive: (id: string) => void;
  selectEnvironment: (id: string | null) => void;
  addVariable: (environmentId: string, key: string, value: string) => void;
  updateVariable: (environmentId: string, variableId: string, updates: Partial<KeyValuePair>) => void;
  deleteVariable: (environmentId: string, variableId: string) => void;
  getVariable: (key: string) => string | null;
  // Priority: Collection > Workspace > Global
  getMergedVariables: (collectionEnv: CollectionEnvironment | null, workspaceEnv?: WorkspaceEnvironment | null) => ResolvedVariable[];
  getVariableWithSource: (key: string, collectionEnv: CollectionEnvironment | null, workspaceEnv?: WorkspaceEnvironment | null) => ResolvedVariable | null;
  activeEnvironment: Environment | null;
  setActiveEnvironment: (id: string | null) => void;
  refreshEnvironments: () => Promise<void>;
}

const EnvironmentsContext = createContext<EnvironmentsContextValue | null>(null);

export const EnvironmentsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const webMode = useWebModeOptional();
  const isWebMode = webMode?.isWebMode ?? false;
  const { data, isLoading: dataLoading, refresh: refreshData } = useDataLoader();
  
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!isWebMode);
  const initializedRef = useRef(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize from pre-loaded data
  useEffect(() => {
    if (dataLoading || initializedRef.current) return;
    
    // In web mode, start with empty environments (will be populated via addWebModeEnvironment)
    if (isWebMode) {
      console.log('[EnvironmentsContext] Web mode - starting with empty environments');
      setIsLoading(false);
      initializedRef.current = true;
      return;
    }
    
    console.log('[EnvironmentsContext] Initializing with pre-loaded data');
    setEnvironments(data.environments);
    setSelectedEnvironmentId(data.selectedEnvironmentId);
    setIsLoading(false);
    initializedRef.current = true;
  }, [dataLoading, data.environments, data.selectedEnvironmentId, isWebMode]);

  // Debounced save to file (skip in web mode)
  const saveEnvironmentsToFile = useCallback((envs: Environment[], selectedId: string | null) => {
    // Skip file operations in web mode
    if (isWebMode) return;
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      }
    
    saveTimeoutRef.current = setTimeout(async () => {
      const globalFile = echoConverter.environmentsToGlobalFile(envs, selectedId);
      await fileStorageManager.writeEnvironments(globalFile);
      saveTimeoutRef.current = null;
    }, 500);
  }, [isWebMode]);

  // Environments that are active (shown in dropdown)
  const activeEnvironments = useMemo(() => environments.filter(e => e.isActive), [environments]);
  
  // Currently selected environment for variables
  const selectedEnvironment = useMemo(() => {
    if (!selectedEnvironmentId) return null;
    return environments.find(e => e.id === selectedEnvironmentId) || null;
  }, [environments, selectedEnvironmentId]);
  
  // Legacy alias
  const activeEnvironment = selectedEnvironment;

  const addEnvironment = useCallback(async (name: string): Promise<Environment> => {
    const newEnvironment: Environment = {
      id: uuidv4(),
      name,
      variables: [],
      isActive: true,
    };
    
    const newEnvs = [...environments, newEnvironment];
    setEnvironments(newEnvs);
    setSelectedEnvironmentId(newEnvironment.id);
    saveEnvironmentsToFile(newEnvs, newEnvironment.id);
    
    return newEnvironment;
  }, [environments, saveEnvironmentsToFile]);

  const importEnvironment = useCallback(async (env: Environment, checkDuplicate = true): Promise<Environment | null> => {
    if (checkDuplicate) {
      const existing = environments.find(e => e.name.toLowerCase() === env.name.toLowerCase());
      if (existing) {
        return null;
      }
    }
    
    const newEnvironment: Environment = {
      ...env,
      id: uuidv4(),
      isActive: true,
    };
    
    const newEnvs = [...environments, newEnvironment];
    setEnvironments(newEnvs);
    setSelectedEnvironmentId(newEnvironment.id);
    saveEnvironmentsToFile(newEnvs, newEnvironment.id);
    
    return newEnvironment;
  }, [environments, saveEnvironmentsToFile]);

  // Web mode only - add environment directly to state without file storage
  const addWebModeEnvironment = useCallback((env: Environment) => {
    const newEnvironment: Environment = {
      ...env,
      id: env.id || uuidv4(),
      isActive: true,
    };
    
    setEnvironments(prev => {
      // Don't add if already exists
      if (prev.some(e => e.name.toLowerCase() === env.name.toLowerCase())) {
        return prev;
      }
      return [...prev, newEnvironment];
    });
    setSelectedEnvironmentId(newEnvironment.id);
  }, []);

  const updateEnvironment = useCallback((id: string, updates: Partial<Environment>) => {
    setEnvironments(prev => {
      const newEnvs = prev.map(e => (e.id === id ? { ...e, ...updates } : e));
      saveEnvironmentsToFile(newEnvs, selectedEnvironmentId);
      return newEnvs;
    });
  }, [selectedEnvironmentId, saveEnvironmentsToFile]);

  const deleteEnvironment = useCallback((id: string) => {
    setEnvironments(prev => {
      const newEnvs = prev.filter(e => e.id !== id);
      let newSelectedId = selectedEnvironmentId;
      
      if (selectedEnvironmentId === id) {
        const remaining = newEnvs.filter(e => e.isActive);
        newSelectedId = remaining.length > 0 ? remaining[0].id : null;
        setSelectedEnvironmentId(newSelectedId);
      }
      
      saveEnvironmentsToFile(newEnvs, newSelectedId);
      return newEnvs;
    });
  }, [selectedEnvironmentId, saveEnvironmentsToFile]);

  const toggleEnvironmentActive = useCallback((id: string) => {
    setEnvironments(prev => {
      const newEnvs = prev.map(e => e.id === id ? { ...e, isActive: !e.isActive } : e);
      let newSelectedId = selectedEnvironmentId;
      
      if (selectedEnvironmentId === id) {
        const env = prev.find(e => e.id === id);
        if (env?.isActive) {
          const remaining = newEnvs.filter(e => e.id !== id && e.isActive);
          newSelectedId = remaining.length > 0 ? remaining[0].id : null;
          setSelectedEnvironmentId(newSelectedId);
        }
      }
      
      saveEnvironmentsToFile(newEnvs, newSelectedId);
      return newEnvs;
    });
  }, [selectedEnvironmentId, saveEnvironmentsToFile]);

  const selectEnvironment = useCallback((id: string | null) => {
    setSelectedEnvironmentId(id);
    saveEnvironmentsToFile(environments, id);
  }, [environments, saveEnvironmentsToFile]);

  const setActiveEnvironment = selectEnvironment;

  const addVariable = useCallback((environmentId: string, key: string, value: string) => {
    const newVariable: KeyValuePair = {
      id: uuidv4(),
      key,
      value,
      enabled: true,
    };
    setEnvironments(prev => {
      const newEnvs = prev.map(e =>
        e.id === environmentId
          ? { ...e, variables: [...e.variables, newVariable] }
          : e
    );
      saveEnvironmentsToFile(newEnvs, selectedEnvironmentId);
      return newEnvs;
    });
  }, [selectedEnvironmentId, saveEnvironmentsToFile]);

  const updateVariable = useCallback((environmentId: string, variableId: string, updates: Partial<KeyValuePair>) => {
    setEnvironments(prev => {
      const newEnvs = prev.map(e =>
        e.id === environmentId
          ? {
              ...e,
              variables: e.variables.map(v =>
                v.id === variableId ? { ...v, ...updates } : v
              ),
            }
          : e
    );
      saveEnvironmentsToFile(newEnvs, selectedEnvironmentId);
      return newEnvs;
    });
  }, [selectedEnvironmentId, saveEnvironmentsToFile]);

  const deleteVariable = useCallback((environmentId: string, variableId: string) => {
    setEnvironments(prev => {
      const newEnvs = prev.map(e =>
        e.id === environmentId
          ? { ...e, variables: e.variables.filter(v => v.id !== variableId) }
          : e
    );
      saveEnvironmentsToFile(newEnvs, selectedEnvironmentId);
      return newEnvs;
    });
  }, [selectedEnvironmentId, saveEnvironmentsToFile]);

  const getVariable = useCallback((key: string): string | null => {
    if (!selectedEnvironment) return null;
    const variable = selectedEnvironment.variables.find(
      v => v.key === key && v.enabled
    );
    return variable?.value || null;
  }, [selectedEnvironment]);

  // Priority: Collection > Workspace > Global
  const getMergedVariables = useCallback((collectionEnv: CollectionEnvironment | null, workspaceEnv?: WorkspaceEnvironment | null): ResolvedVariable[] => {
    const result: Map<string, ResolvedVariable> = new Map();
    
    // 1. Add global environment variables (lowest priority)
    if (selectedEnvironment) {
      selectedEnvironment.variables.forEach(v => {
        if (v.key) {
          result.set(v.key, {
            key: v.key,
            value: v.value,
            enabled: v.enabled,
            source: 'global',
            sourceName: selectedEnvironment.name,
          });
        }
      });
    }
    
    // 2. Add workspace environment variables (middle priority - overrides global)
    if (workspaceEnv) {
      workspaceEnv.variables.forEach(v => {
        if (v.key) {
          result.set(v.key, {
            key: v.key,
            value: v.value,
            enabled: v.enabled,
            source: 'workspace',
            sourceName: workspaceEnv.name,
          });
        }
      });
    }
    
    // 3. Add collection environment variables (highest priority - overrides everything)
    if (collectionEnv) {
      collectionEnv.variables.forEach(v => {
        if (v.key) {
          result.set(v.key, {
            key: v.key,
            value: v.value,
            enabled: v.enabled,
            source: 'collection',
            sourceName: collectionEnv.name,
          });
        }
      });
    }
    
    return Array.from(result.values());
  }, [selectedEnvironment]);

  // Priority: Collection > Workspace > Global
  const getVariableWithSource = useCallback((key: string, collectionEnv: CollectionEnvironment | null, workspaceEnv?: WorkspaceEnvironment | null): ResolvedVariable | null => {
    // 1. Check collection environment first (highest priority)
    if (collectionEnv) {
      const collectionVar = collectionEnv.variables.find(v => v.key === key && v.enabled);
      if (collectionVar) {
        return {
          key: collectionVar.key,
          value: collectionVar.value,
          enabled: collectionVar.enabled,
          source: 'collection',
          sourceName: collectionEnv.name,
        };
      }
    }
    
    // 2. Check workspace environment (middle priority)
    if (workspaceEnv) {
      const workspaceVar = workspaceEnv.variables.find(v => v.key === key && v.enabled);
      if (workspaceVar) {
        return {
          key: workspaceVar.key,
          value: workspaceVar.value,
          enabled: workspaceVar.enabled,
          source: 'workspace',
          sourceName: workspaceEnv.name,
        };
      }
    }
    
    // 3. Check global environment (lowest priority)
    if (selectedEnvironment) {
      const globalVar = selectedEnvironment.variables.find(v => v.key === key && v.enabled);
      if (globalVar) {
        return {
          key: globalVar.key,
          value: globalVar.value,
          enabled: globalVar.enabled,
          source: 'global',
          sourceName: selectedEnvironment.name,
        };
      }
    }
    
    return null;
  }, [selectedEnvironment]);

  const refreshEnvironments = useCallback(async () => {
    await refreshData();
  }, [refreshData]);

  const contextValue = useMemo(() => ({
    environments,
    activeEnvironments,
    selectedEnvironment,
    isLoading,
    addEnvironment,
    importEnvironment,
    addWebModeEnvironment,
    updateEnvironment,
    deleteEnvironment,
    toggleEnvironmentActive,
    selectEnvironment,
    addVariable,
    updateVariable,
    deleteVariable,
    getVariable,
    getMergedVariables,
    getVariableWithSource,
    activeEnvironment,
    setActiveEnvironment,
    refreshEnvironments,
  }), [
    environments,
    activeEnvironments,
    selectedEnvironment,
    isLoading,
    addEnvironment,
    importEnvironment,
    addWebModeEnvironment,
    updateEnvironment,
    deleteEnvironment,
    toggleEnvironmentActive,
    selectEnvironment,
    addVariable,
    updateVariable,
    deleteVariable,
    getVariable,
    getMergedVariables,
    getVariableWithSource,
    activeEnvironment,
    setActiveEnvironment,
    refreshEnvironments,
  ]);

  return (
    <EnvironmentsContext.Provider value={contextValue}>
      {children}
    </EnvironmentsContext.Provider>
  );
};

export const useEnvironments = () => {
  const context = useContext(EnvironmentsContext);
  if (!context) {
    throw new Error('useEnvironments must be used within EnvironmentsProvider');
  }
  return context;
};

export default EnvironmentsContext;
