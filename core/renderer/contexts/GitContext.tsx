/**
 * Git Context
 * 
 * Provides real Git operations using isomorphic-git.
 * Manages git status, commits, branches, and sync operations.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { useWorkspace } from './WorkspaceContext';
import { useGitHub } from './GitHubContext';
import { isElectron } from '@/utils';

// Types
export interface GitStatus {
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: string[];
}

export interface GitFileStatus {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface GitCommitInfo {
  oid: string;
  message: string;
  author: {
    name: string;
    email: string;
    timestamp: number;
  };
  parent: string[];
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
  remote?: string;
}

export interface GitRemote {
  name: string;
  url: string;
}

interface FileChangedEvent {
  event: string;
  filename: string | null;
  dirPath: string;
}

export interface GitContextValue {
  // State
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
  status: GitStatus | null;
  commits: GitCommitInfo[];
  branches: GitBranchInfo[];
  currentBranch: string | null;
  remotes: GitRemote[];
  workspacePath: string | null;
  
  // Actions
  initRepo: () => Promise<{ success: boolean; error?: string }>;
  refreshStatus: () => Promise<void>;
  refreshAll: (pathOverride?: string) => Promise<void>;
  
  // Staging
  stageFile: (filepath: string) => Promise<{ success: boolean; error?: string }>;
  stageAll: () => Promise<{ success: boolean; error?: string }>;
  unstageFile: (filepath: string) => Promise<{ success: boolean; error?: string }>;
  discardChanges: (filepath: string) => Promise<{ success: boolean; error?: string }>;
  
  // Commits
  commit: (message: string) => Promise<{ success: boolean; oid?: string; error?: string }>;
  
  // Branches
  createBranch: (name: string, checkout?: boolean) => Promise<{ success: boolean; error?: string }>;
  checkoutBranch: (name: string) => Promise<{ success: boolean; error?: string }>;
  deleteBranch: (name: string) => Promise<{ success: boolean; error?: string }>;
  
  // Remotes
  addRemote: (name: string, url: string) => Promise<{ success: boolean; error?: string }>;
  removeRemote: (name: string) => Promise<{ success: boolean; error?: string }>;
  
  // Sync
  push: (remote?: string, branch?: string) => Promise<{ success: boolean; error?: string }>;
  pull: (remote?: string, branch?: string) => Promise<{ success: boolean; error?: string }>;
  fetch: (remote?: string, branch?: string) => Promise<{ success: boolean; error?: string }>;
  
  // Utils
  getTotalChanges: () => number;
  hasChanges: () => boolean;
}

const GitContext = createContext<GitContextValue | undefined>(undefined);

interface GitProviderProps {
  children: ReactNode;
}

export const GitProvider: React.FC<GitProviderProps> = ({ children }) => {
  // State
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommitInfo[]>([]);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  
  // Get workspace and GitHub context
  const { activeWorkspaceId, workspaces } = useWorkspace();
  const { user, isAuthenticated } = useGitHub();
  
  // Get workspace directory path
  const getWorkspacePath = useCallback(async (): Promise<string | null> => {
    if (!isElectron() || !activeWorkspaceId) return null;
    
    try {
      const echolonPath = await window.electronAPI.getEcholonPath();
      const workspace = workspaces.find(w => w.id === activeWorkspaceId);
      if (!workspace) return null;
      
      // Workspace folder is at: {echolonPath}/workspaces/{workspaceName}/
      const workspaceFolderName = workspace.name;
      return `${echolonPath}/workspaces/${workspaceFolderName}`;
    } catch (err) {
      console.error('[Git] Failed to get workspace path:', err);
      return null;
    }
  }, [activeWorkspaceId, workspaces]);
  
  // Check if workspace is a git repo and load status
  const checkAndLoadRepo = useCallback(async () => {
    if (!isElectron()) return;
    
    const path = await getWorkspacePath();
    if (!path) {
      setIsInitialized(false);
      setWorkspacePath(null);
      return;
    }
    
    setWorkspacePath(path);
    
    try {
      const isRepo = await window.electronAPI.gitIsRepo(path);
      setIsInitialized(isRepo);
      
      if (isRepo) {
        // Load status, branches, commits, remotes inline to avoid stale closure
        setIsLoading(true);
        try {
          const [statusRes, branchesRes, currentBranchRes, logRes, remotesRes] = await Promise.all([
            window.electronAPI.gitStatus(path),
            window.electronAPI.gitListBranches(path),
            window.electronAPI.gitCurrentBranch(path),
            window.electronAPI.gitLog(path, 50),
            window.electronAPI.gitListRemotes(path),
          ]);
          
          if (statusRes.success && statusRes.status) setStatus(statusRes.status);
          if (branchesRes.success && branchesRes.branches) setBranches(branchesRes.branches);
          if (currentBranchRes.success && currentBranchRes.branch) setCurrentBranch(currentBranchRes.branch);
          if (logRes.success && logRes.commits) setCommits(logRes.commits);
          if (remotesRes.success && remotesRes.remotes) setRemotes(remotesRes.remotes);
        } finally {
          setIsLoading(false);
        }
      }
    } catch (err) {
      console.error('[Git] Failed to check repo:', err);
      setIsInitialized(false);
    }
  }, [getWorkspacePath]);
  
  // Initialize git repo
  const initRepo = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!isElectron() || !workspacePath) {
      return { success: false, error: 'Not in Electron or no workspace selected' };
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Initialize repo
      const result = await window.electronAPI.gitInit(workspacePath);
      if (!result.success) {
        setError(result.error || 'Failed to initialize repository');
        return result;
      }
      
      // Create .gitignore
      await window.electronAPI.gitCreateGitignore(workspacePath);
      
      setIsInitialized(true);
      
      // Refresh status
      await refreshStatus();
      
      return { success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to initialize repository';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, [workspacePath]);
  
  // Refresh status
  const refreshStatus = useCallback(async () => {
    if (!isElectron() || !workspacePath || !isInitialized) return;
    
    try {
      const result = await window.electronAPI.gitStatus(workspacePath);
      if (result.success && result.status) {
        setStatus(result.status);
      }
    } catch (err) {
      console.error('[Git] Failed to get status:', err);
    }
  }, [workspacePath, isInitialized]);
  
  // Refresh all (status, branches, commits, remotes)
  // Accepts optional path parameter to avoid stale closure issues
  const refreshAll = useCallback(async (pathOverride?: string) => {
    const path = pathOverride || workspacePath;
    if (!isElectron() || !path) return;
    
    setIsLoading(true);
    
    try {
      // Get status
      const statusResult = await window.electronAPI.gitStatus(path);
      if (statusResult.success && statusResult.status) {
        setStatus(statusResult.status);
      }
      
      // Get branches
      const branchesResult = await window.electronAPI.gitListBranches(path);
      if (branchesResult.success && branchesResult.branches) {
        setBranches(branchesResult.branches);
      }
      
      // Get current branch
      const currentBranchResult = await window.electronAPI.gitCurrentBranch(path);
      if (currentBranchResult.success && currentBranchResult.branch) {
        setCurrentBranch(currentBranchResult.branch);
      }
      
      // Get commits
      const logResult = await window.electronAPI.gitLog(path, 50);
      if (logResult.success && logResult.commits) {
        setCommits(logResult.commits);
      }
      
      // Get remotes
      const remotesResult = await window.electronAPI.gitListRemotes(path);
      if (remotesResult.success && remotesResult.remotes) {
        setRemotes(remotesResult.remotes);
      }
    } catch (err) {
      console.error('[Git] Failed to refresh:', err);
    } finally {
      setIsLoading(false);
    }
  }, [workspacePath]);
  
  // Stage file
  const stageFile = useCallback(async (filepath: string): Promise<{ success: boolean; error?: string }> => {
    if (!isElectron() || !workspacePath) {
      return { success: false, error: 'Not in Electron or no workspace selected' };
    }
    
    try {
      const result = await window.electronAPI.gitAdd(workspacePath, filepath);
      if (result.success) {
        await refreshStatus();
      }
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to stage file';
      return { success: false, error: errorMessage };
    }
  }, [workspacePath, refreshStatus]);
  
  // Stage all
  const stageAll = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!isElectron() || !workspacePath) {
      return { success: false, error: 'Not in Electron or no workspace selected' };
    }
    
    try {
      const result = await window.electronAPI.gitAddAll(workspacePath);
      if (result.success) {
        await refreshStatus();
      }
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to stage all files';
      return { success: false, error: errorMessage };
    }
  }, [workspacePath, refreshStatus]);
  
  // Unstage file
  const unstageFile = useCallback(async (filepath: string): Promise<{ success: boolean; error?: string }> => {
    if (!isElectron() || !workspacePath) {
      return { success: false, error: 'Not in Electron or no workspace selected' };
    }
    
    try {
      const result = await window.electronAPI.gitUnstage(workspacePath, filepath);
      if (result.success) {
        await refreshStatus();
      }
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to unstage file';
      return { success: false, error: errorMessage };
    }
  }, [workspacePath, refreshStatus]);
  
  // Discard changes
  const discardChanges = useCallback(async (filepath: string): Promise<{ success: boolean; error?: string }> => {
    if (!isElectron() || !workspacePath) {
      return { success: false, error: 'Not in Electron or no workspace selected' };
    }
    
    try {
      const result = await window.electronAPI.gitDiscardChanges(workspacePath, filepath);
      if (result.success) {
        await refreshStatus();
      }
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to discard changes';
      return { success: false, error: errorMessage };
    }
  }, [workspacePath, refreshStatus]);
  
  // Commit
  const commit = useCallback(async (message: string): Promise<{ success: boolean; oid?: string; error?: string }> => {
    if (!isElectron() || !workspacePath) {
      return { success: false, error: 'Not in Electron or no workspace selected' };
    }
    
    // Get author info from GitHub user or use defaults
    const author = {
      name: user?.name || user?.login || 'Echolon User',
      email: user?.email || 'user@echolon.app',
    };
    
    setIsLoading(true);
    
    try {
      const result = await window.electronAPI.gitCommit(workspacePath, message, author);
      if (result.success) {
        await refreshAll();
      }
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to commit';
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, [workspacePath, user, refreshAll]);
  
  // Create branch
  const createBranch = useCallback(async (name: string, checkout: boolean = false): Promise<{ success: boolean; error?: string }> => {
    if (!isElectron() || !workspacePath) {
      return { success: false, error: 'Not in Electron or no workspace selected' };
    }
    
    try {
      const result = await window.electronAPI.gitCreateBranch(workspacePath, name, checkout);
      if (result.success) {
        await refreshAll();
      }
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create branch';
      return { success: false, error: errorMessage };
    }
  }, [workspacePath, refreshAll]);
  
  // Checkout branch
  const checkoutBranch = useCallback(async (name: string): Promise<{ success: boolean; error?: string }> => {
    if (!isElectron() || !workspacePath) {
      return { success: false, error: 'Not in Electron or no workspace selected' };
    }
    
    try {
      const result = await window.electronAPI.gitCheckout(workspacePath, name);
      if (result.success) {
        setCurrentBranch(name);
        await refreshAll();
      }
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to checkout branch';
      return { success: false, error: errorMessage };
    }
  }, [workspacePath, refreshAll]);
  
  // Delete branch
  const deleteBranch = useCallback(async (name: string): Promise<{ success: boolean; error?: string }> => {
    if (!isElectron() || !workspacePath) {
      return { success: false, error: 'Not in Electron or no workspace selected' };
    }
    
    try {
      const result = await window.electronAPI.gitDeleteBranch(workspacePath, name);
      if (result.success) {
        await refreshAll();
      }
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete branch';
      return { success: false, error: errorMessage };
    }
  }, [workspacePath, refreshAll]);
  
  // Add remote
  const addRemote = useCallback(async (name: string, url: string): Promise<{ success: boolean; error?: string }> => {
    if (!isElectron() || !workspacePath) {
      return { success: false, error: 'Not in Electron or no workspace selected' };
    }
    
    try {
      const result = await window.electronAPI.gitAddRemote(workspacePath, name, url);
      if (result.success) {
        await refreshAll();
      }
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add remote';
      return { success: false, error: errorMessage };
    }
  }, [workspacePath, refreshAll]);
  
  // Remove remote
  const removeRemote = useCallback(async (name: string): Promise<{ success: boolean; error?: string }> => {
    if (!isElectron() || !workspacePath) {
      return { success: false, error: 'Not in Electron or no workspace selected' };
    }
    
    try {
      const result = await window.electronAPI.gitRemoveRemote(workspacePath, name);
      if (result.success) {
        await refreshAll();
      }
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to remove remote';
      return { success: false, error: errorMessage };
    }
  }, [workspacePath, refreshAll]);
  
  // Push
  const push = useCallback(async (remote?: string, branch?: string): Promise<{ success: boolean; error?: string }> => {
    if (!isElectron() || !workspacePath) {
      return { success: false, error: 'Not in Electron or no workspace selected' };
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await window.electronAPI.gitPush(workspacePath, remote, branch);
      if (!result.success) {
        setError(result.error || 'Push failed');
      }
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to push';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, [workspacePath]);
  
  // Pull
  const pull = useCallback(async (remote?: string, branch?: string): Promise<{ success: boolean; error?: string }> => {
    if (!isElectron() || !workspacePath) {
      return { success: false, error: 'Not in Electron or no workspace selected' };
    }
    
    const author = {
      name: user?.name || user?.login || 'Echolon User',
      email: user?.email || 'user@echolon.app',
    };
    
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await window.electronAPI.gitPull(workspacePath, remote, branch, author);
      if (result.success) {
        await refreshAll();
      } else {
        setError(result.error || 'Pull failed');
      }
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to pull';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, [workspacePath, user, refreshAll]);
  
  // Fetch
  const fetch = useCallback(async (remote?: string, branch?: string): Promise<{ success: boolean; error?: string }> => {
    if (!isElectron() || !workspacePath) {
      return { success: false, error: 'Not in Electron or no workspace selected' };
    }
    
    setIsLoading(true);
    
    try {
      const result = await window.electronAPI.gitFetch(workspacePath, remote, branch);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch';
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, [workspacePath]);
  
  // Helper: Get total changes count
  const getTotalChanges = useCallback((): number => {
    if (!status) return 0;
    return status.staged.length + status.unstaged.length + status.untracked.length;
  }, [status]);
  
  // Helper: Check if there are changes
  const hasChanges = useCallback((): boolean => {
    return getTotalChanges() > 0;
  }, [getTotalChanges]);
  
  // Set up git credentials when GitHub auth changes
  useEffect(() => {
    if (!isElectron()) return;
    
    const setupCredentials = async () => {
      if (isAuthenticated && user) {
        // Get GitHub token from config
        const config = await window.electronAPI.readConfig();
        const token = config?.github?.accessToken;
        
        if (token) {
          await window.electronAPI.gitSetCredentials({
            username: user.login,
            password: token,
          });
        }
      } else {
        await window.electronAPI.gitSetCredentials(null);
      }
    };
    
    setupCredentials();
  }, [isAuthenticated, user]);
  
  // Load repo status when workspace changes
  useEffect(() => {
    checkAndLoadRepo();
  }, [checkAndLoadRepo]);
  
  // Listen for file changes and refresh git status
  useEffect(() => {
    if (!isElectron() || !workspacePath || !isInitialized) return;
    
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    
    // Subscribe to file change events
    const unsubscribe = window.electronAPI.onFileChanged((event: FileChangedEvent) => {
      // Check if the change is in our workspace directory
      // The dirPath is the Echolon root, but filename includes the relative path
      const workspaceName = workspacePath.split('/').pop() || '';
      const isInWorkspace = event.filename?.includes(workspaceName) || 
                            (event.dirPath && workspacePath.startsWith(event.dirPath));
      
      if (isInWorkspace) {
        // Debounce status refresh to avoid too many updates
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          refreshStatus();
        }, 500);
      }
    });
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [workspacePath, isInitialized, refreshStatus]);
  
  // Context value
  const value: GitContextValue = {
    // State
    isInitialized,
    isLoading,
    error,
    status,
    commits,
    branches,
    currentBranch,
    remotes,
    workspacePath,
    
    // Actions
    initRepo,
    refreshStatus,
    refreshAll,
    
    // Staging
    stageFile,
    stageAll,
    unstageFile,
    discardChanges,
    
    // Commits
    commit,
    
    // Branches
    createBranch,
    checkoutBranch,
    deleteBranch,
    
    // Remotes
    addRemote,
    removeRemote,
    
    // Sync
    push,
    pull,
    fetch,
    
    // Utils
    getTotalChanges,
    hasChanges,
  };
  
  return <GitContext.Provider value={value}>{children}</GitContext.Provider>;
};

export const useGit = (): GitContextValue => {
  const context = useContext(GitContext);
  if (!context) {
    throw new Error('useGit must be used within a GitProvider');
  }
  return context;
};

// Optional hook for components that may be outside the provider (e.g., web mode)
export const useGitOptional = (): GitContextValue | null => {
  return useContext(GitContext) ?? null;
};

export default GitContext;

