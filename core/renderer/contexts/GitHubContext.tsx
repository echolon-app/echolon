import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { githubService, GitHubUser, GitHubRepository, GitHubBranch, GitHubCommit, LinkedRepository } from '@/services/GitHubService';
import { githubSyncService, SyncStatus, FileChange } from '@/services/GitHubSyncService';
import { fileStorageManager } from '@/services';
import { useWorkspace } from './WorkspaceContext';
import { useWebModeOptional } from './WebModeContext';

interface GitHubContextValue {
  // Auth state
  isAuthenticated: boolean;
  isLoading: boolean;
  user: GitHubUser | null;
  
  // Auth actions
  loginWithPAT: (token: string) => Promise<{ success: boolean; error?: string }>;
  startOAuth: () => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  
  // Repository state
  repositories: GitHubRepository[];
  selectedRepo: GitHubRepository | null;
  linkedRepos: LinkedRepository[];
  
  // Repository actions
  fetchRepositories: () => Promise<void>;
  selectRepository: (repo: GitHubRepository | null) => void;
  linkRepository: (workspaceId: string, owner: string, repo: string, branch: string) => Promise<void>;
  unlinkRepository: (workspaceId: string) => Promise<void>;
  getLinkedRepo: (workspaceId: string) => LinkedRepository | undefined;
  
  // Branch state
  branches: GitHubBranch[];
  currentBranch: string | null;
  
  // Branch actions
  fetchBranches: (owner: string, repo: string) => Promise<void>;
  switchBranch: (branchName: string) => void;
  createBranch: (name: string, sourceSha: string) => Promise<{ success: boolean; error?: string }>;
  
  // Commit state
  commits: Array<{ sha: string; commit: GitHubCommit; html_url: string }>;
  
  // Commit actions
  fetchCommits: (owner: string, repo: string, branch?: string) => Promise<void>;
  
  // Sync state
  syncStatus: SyncStatus | null;
  isSyncing: boolean;
  
  // Sync actions
  checkSyncStatus: () => Promise<SyncStatus | null>;
  pushWorkspaceChanges: (message: string) => Promise<{ success: boolean; error?: string; sha?: string }>;
  pullWorkspaceChanges: () => Promise<{ success: boolean; error?: string; conflicts?: FileChange[] }>;
  initializeSync: () => Promise<{ success: boolean; error?: string }>;
  
  // Legacy sync actions (kept for compatibility)
  pushChanges: (message: string, files: Array<{ path: string; content: string }>) => Promise<{ success: boolean; error?: string }>;
  pullChanges: () => Promise<{ success: boolean; error?: string }>;
  compareWithRemote: () => Promise<{ ahead: number; behind: number; files: Array<{ filename: string; status: string }> } | null>;
}

const GitHubContext = createContext<GitHubContextValue | null>(null);

export const GitHubProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  //console.log('[GitHubProvider] Rendering GitHubProvider');
  const webMode = useWebModeOptional();
  const isWebMode = webMode?.isWebMode ?? false;
  //console.log('[GitHubContext] isWebMode:', isWebMode);
  const { activeWorkspaceId, activeWorkspace, getWorkspaceNameById } = useWorkspace();
  
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(!isWebMode); // Don't show loading in web mode
  const [user, setUser] = useState<GitHubUser | null>(null);
  
  // Repository state
  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepository | null>(null);
  const [linkedRepos, setLinkedRepos] = useState<LinkedRepository[]>([]);
  
  // Branch state
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  
  // Commit state
  const [commits, setCommits] = useState<Array<{ sha: string; commit: GitHubCommit; html_url: string }>>([]);
  
  // Sync state
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const initialLoadDone = useRef(false);

  // Load saved auth state on mount (skip in web mode)
  useEffect(() => {
    if (initialLoadDone.current || isWebMode) {
      if (isWebMode) setIsLoading(false);
      return;
    }
    initialLoadDone.current = true;
    
    const loadAuthState = async () => {
      try {
        setIsLoading(true);
        
        // Initialize sync service
        await githubSyncService.initialize();
        
        // Load config to get saved token and linked repos
        const config = await fileStorageManager.readConfig();
        
        if (config?.github?.accessToken) {
          // Try to restore session
          await githubService.setAccessToken(config.github.accessToken);
          const userResult = await githubService.getCurrentUser();
          
          if (userResult.success && userResult.data) {
            setUser(userResult.data);
            setIsAuthenticated(true);
          } else {
            // Token invalid, clear it
            await fileStorageManager.updateConfig({
              github: { ...config.github, accessToken: undefined }
            });
          }
        }
        
        // Load linked repos
        if (config?.github?.linkedRepos) {
          setLinkedRepos(config.github.linkedRepos);
        }
      } catch (error) {
        console.error('Error loading auth state:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadAuthState();
  }, [isWebMode]);

  // Login with Personal Access Token
  const loginWithPAT = useCallback(async (token: string): Promise<{ success: boolean; error?: string }> => {
    if (isWebMode) {
      return { success: false, error: 'GitHub integration is not available in web mode' };
    }
    
    setIsLoading(true);
    try {
      const result = await githubService.authenticateWithPAT(token);
      
      if (result.success && result.data) {
        setUser(result.data);
        setIsAuthenticated(true);
        
        // Save token to config
        const config = await fileStorageManager.readConfig();
        await fileStorageManager.updateConfig({
          github: {
            ...config?.github,
            authMethod: 'pat',
            accessToken: token,
            username: result.data.login,
          }
        });
        
        return { success: true };
      }
      
      return { success: false, error: result.error || 'Authentication failed' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    } finally {
      setIsLoading(false);
    }
  }, [isWebMode]);

  // Start OAuth flow
  const startOAuth = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    const result = await githubService.startOAuthFlow();
    return result;
  }, []);

  // Logout
  const logout = useCallback(async () => {
    await githubService.logout();
    setUser(null);
    setIsAuthenticated(false);
    setRepositories([]);
    setSelectedRepo(null);
    setBranches([]);
    setCommits([]);
    setSyncStatus(null);
    
    // Clear token from config (skip in web mode)
    if (!isWebMode) {
    const config = await fileStorageManager.readConfig();
    if (config?.github) {
      await fileStorageManager.updateConfig({
        github: {
          ...config.github,
          accessToken: undefined,
          refreshToken: undefined,
        }
      });
    }
    }
  }, [isWebMode]);

  // Fetch repositories
  const fetchRepositories = useCallback(async () => {
    if (!isAuthenticated) return;
    
    try {
      const result = await githubService.listRepositories({
        sort: 'pushed',
        per_page: 100,
      });
      
      if (result.success && result.data) {
        setRepositories(result.data);
      }
    } catch (error) {
      console.error('Error fetching repositories:', error);
    }
  }, [isAuthenticated]);

  // Select repository
  const selectRepository = useCallback((repo: GitHubRepository | null) => {
    setSelectedRepo(repo);
    if (repo) {
      setCurrentBranch(repo.default_branch);
    } else {
      setBranches([]);
      setCommits([]);
      setCurrentBranch(null);
    }
  }, []);

  // Link repository to workspace
  const linkRepository = useCallback(async (workspaceId: string, owner: string, repo: string, branch: string) => {
    const workspaceName = getWorkspaceNameById(workspaceId);
    if (!workspaceName) {
      console.error(`Cannot link repository: workspace ${workspaceId} not found`);
      return;
    }
    
    const newLinked: LinkedRepository = { workspaceId, owner, repo, branch };
    const updated = [...linkedRepos.filter(r => r.workspaceId !== workspaceId), newLinked];
    setLinkedRepos(updated);
    
    // Also register with sync service
    await githubSyncService.linkRepository(workspaceId, workspaceName, owner, repo, branch);
    
    // Setup git in the workspace (init + add remote)
    if (!isWebMode) {
      const electronAPI = window.electronAPI as { githubSetupWorkspaceGit?: (workspaceName: string, owner: string, repo: string) => Promise<{ success: boolean; error?: string }> } | undefined;
      if (electronAPI?.githubSetupWorkspaceGit) {
        const setupResult = await electronAPI.githubSetupWorkspaceGit(workspaceName, owner, repo);
        if (!setupResult.success) {
          console.error('Failed to setup git for workspace:', setupResult.error);
        }
      }
    }
    
    // Save to config (skip in web mode)
    if (!isWebMode) {
    const config = await fileStorageManager.readConfig();
    const existingGitHub = config?.github || { authMethod: 'pat' as const };
    await fileStorageManager.updateConfig({
      github: {
        ...existingGitHub,
        linkedRepos: updated,
      }
    });
    }
  }, [linkedRepos, isWebMode, getWorkspaceNameById]);

  // Unlink repository from workspace
  const unlinkRepository = useCallback(async (workspaceId: string) => {
    const workspaceName = getWorkspaceNameById(workspaceId);
    
    const updated = linkedRepos.filter(r => r.workspaceId !== workspaceId);
    setLinkedRepos(updated);
    
    // Also unlink from sync service (only if we have the workspace name)
    if (workspaceName) {
      await githubSyncService.unlinkRepository(workspaceId, workspaceName);
    }
    setSyncStatus(null);
    
    // Save to config (skip in web mode)
    if (!isWebMode) {
    const config = await fileStorageManager.readConfig();
    const existingGitHub = config?.github || { authMethod: 'pat' as const };
    await fileStorageManager.updateConfig({
      github: {
        ...existingGitHub,
        linkedRepos: updated,
      }
    });
    }
  }, [linkedRepos, isWebMode, getWorkspaceNameById]);

  // Get linked repo for a workspace
  const getLinkedRepo = useCallback((workspaceId: string): LinkedRepository | undefined => {
    return linkedRepos.find(r => r.workspaceId === workspaceId);
  }, [linkedRepos]);

  // Fetch branches
  const fetchBranches = useCallback(async (owner: string, repo: string) => {
    try {
      const result = await githubService.listBranches(owner, repo);
      
      if (result.success && result.data) {
        setBranches(result.data);
      }
    } catch (error) {
      console.error('Error fetching branches:', error);
    }
  }, []);

  // Switch branch
  const switchBranch = useCallback((branchName: string) => {
    setCurrentBranch(branchName);
  }, []);

  // Create branch
  const createBranch = useCallback(async (name: string, sourceSha: string): Promise<{ success: boolean; error?: string }> => {
    if (!selectedRepo) {
      return { success: false, error: 'No repository selected' };
    }
    
    try {
      const result = await githubService.createBranch(
        selectedRepo.owner.login,
        selectedRepo.name,
        name,
        sourceSha
      );
      
      if (result.success) {
        // Refresh branches
        await fetchBranches(selectedRepo.owner.login, selectedRepo.name);
        setCurrentBranch(name);
        return { success: true };
      }
      
      return { success: false, error: result.error };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }, [selectedRepo, fetchBranches]);

  // Fetch commits
  const fetchCommits = useCallback(async (owner: string, repo: string, branch?: string) => {
    try {
      const result = await githubService.listCommits(owner, repo, {
        sha: branch,
        per_page: 50,
      });
      
      if (result.success && result.data) {
        setCommits(result.data);
      }
    } catch (error) {
      console.error('Error fetching commits:', error);
    }
  }, []);

  // Check sync status for current workspace
  const checkSyncStatus = useCallback(async (): Promise<SyncStatus | null> => {
    if (!activeWorkspaceId || !activeWorkspace?.name) {
      setSyncStatus(null);
      return null;
    }
    
    const linked = linkedRepos.find(r => r.workspaceId === activeWorkspaceId);
    if (!linked) {
      setSyncStatus(null);
      return null;
    }
    
    setIsSyncing(true);
    try {
      const status = await githubSyncService.compareWithRemote(activeWorkspaceId, activeWorkspace.name);
      setSyncStatus(status);
      return status;
    } catch (error) {
      console.error('Error checking sync status:', error);
      return null;
    } finally {
      setIsSyncing(false);
    }
  }, [activeWorkspaceId, activeWorkspace?.name, linkedRepos]);

  // Push workspace changes to GitHub
  const pushWorkspaceChanges = useCallback(async (message: string): Promise<{ success: boolean; error?: string; sha?: string }> => {
    if (!activeWorkspaceId || !activeWorkspace?.name) {
      return { success: false, error: 'No active workspace' };
    }
    
    const linked = linkedRepos.find(r => r.workspaceId === activeWorkspaceId);
    if (!linked) {
      return { success: false, error: 'No repository linked to this workspace' };
    }
    
    setIsSyncing(true);
    try {
      const result = await githubSyncService.pushChanges(activeWorkspaceId, activeWorkspace.name, message);
      
      if (result.success) {
        // Refresh commits and sync status
        await fetchCommits(linked.owner, linked.repo, linked.branch);
        await checkSyncStatus();
      }
      
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    } finally {
      setIsSyncing(false);
    }
  }, [activeWorkspaceId, activeWorkspace?.name, linkedRepos, fetchCommits, checkSyncStatus]);

  // Pull workspace changes from GitHub
  const pullWorkspaceChanges = useCallback(async (): Promise<{ success: boolean; error?: string; conflicts?: FileChange[] }> => {
    if (!activeWorkspaceId || !activeWorkspace?.name) {
      return { success: false, error: 'No active workspace' };
    }
    
    const linked = linkedRepos.find(r => r.workspaceId === activeWorkspaceId);
    if (!linked) {
      return { success: false, error: 'No repository linked to this workspace' };
    }
    
    setIsSyncing(true);
    try {
      const result = await githubSyncService.pullChanges(activeWorkspaceId, activeWorkspace.name);
      
      if (result.success) {
        // Refresh sync status
        await checkSyncStatus();
      }
      
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    } finally {
      setIsSyncing(false);
    }
  }, [activeWorkspaceId, activeWorkspace?.name, linkedRepos, checkSyncStatus]);

  // Initialize sync (after first-time link)
  const initializeSync = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!activeWorkspaceId || !activeWorkspace?.name) {
      return { success: false, error: 'No active workspace' };
    }
    
    setIsSyncing(true);
    try {
      const result = await githubSyncService.initializeSyncFromRemote(activeWorkspaceId, activeWorkspace.name);
      
      if (result.success) {
        await checkSyncStatus();
      }
      
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    } finally {
      setIsSyncing(false);
    }
  }, [activeWorkspaceId, activeWorkspace?.name, checkSyncStatus]);

  // Legacy push changes (kept for compatibility)
  const pushChanges = useCallback(async (
    message: string,
    files: Array<{ path: string; content: string }>
  ): Promise<{ success: boolean; error?: string }> => {
    if (!activeWorkspaceId) {
      return { success: false, error: 'No active workspace' };
    }
    
    const linked = getLinkedRepo(activeWorkspaceId);
    if (!linked) {
      return { success: false, error: 'No repository linked to this workspace' };
    }
    
    try {
      const changes = files.map(f => ({
        path: f.path,
        content: githubService.encodeContent(f.content),
      }));
      
      const result = await githubService.pushChanges(
        linked.owner,
        linked.repo,
        linked.branch,
        message,
        changes
      );
      
      if (result.success) {
        // Refresh commits
        await fetchCommits(linked.owner, linked.repo, linked.branch);
        return { success: true };
      }
      
      return { success: false, error: result.error };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }, [activeWorkspaceId, getLinkedRepo, fetchCommits]);

  // Legacy pull changes (kept for compatibility)
  const pullChanges = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!activeWorkspaceId) {
      return { success: false, error: 'No active workspace' };
    }
    
    const linked = getLinkedRepo(activeWorkspaceId);
    if (!linked) {
      return { success: false, error: 'No repository linked to this workspace' };
    }
    
    try {
      const result = await githubService.pullLatest(linked.owner, linked.repo, linked.branch);
      
      if (result.success) {
        // In a full implementation, this would download and apply changes
        // For now, just refresh the commits view
        await fetchCommits(linked.owner, linked.repo, linked.branch);
        return { success: true };
      }
      
      return { success: false, error: result.error };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }, [activeWorkspaceId, getLinkedRepo, fetchCommits]);

  // Compare with remote (legacy - returns simple count format)
  const compareWithRemote = useCallback(async () => {
    if (!activeWorkspaceId || !activeWorkspace?.name) return null;
    
    const linked = getLinkedRepo(activeWorkspaceId);
    if (!linked) return null;
    
    try {
      const status = await githubSyncService.compareWithRemote(activeWorkspaceId, activeWorkspace.name);
      
      if (!status) return null;
      
      // Convert to legacy format
      const files = [
        ...status.localChanges.map(c => ({ filename: c.path, status: c.type })),
        ...status.remoteChanges.map(c => ({ filename: c.path, status: c.type })),
      ];
      
      return {
        ahead: status.localChanges.length,
        behind: status.remoteChanges.length,
        files,
      };
    } catch (error) {
      console.error('Error comparing with remote:', error);
      return null;
    }
  }, [activeWorkspaceId, activeWorkspace?.name, getLinkedRepo]);

  // Auto-check sync status when workspace changes
  useEffect(() => {
    if (activeWorkspaceId && isAuthenticated && !isWebMode) {
      checkSyncStatus();
    }
  }, [activeWorkspaceId, isAuthenticated, isWebMode, checkSyncStatus]);

  return (
    <GitHubContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        user,
        loginWithPAT,
        startOAuth,
        logout,
        repositories,
        selectedRepo,
        linkedRepos,
        fetchRepositories,
        selectRepository,
        linkRepository,
        unlinkRepository,
        getLinkedRepo,
        branches,
        currentBranch,
        fetchBranches,
        switchBranch,
        createBranch,
        commits,
        fetchCommits,
        syncStatus,
        isSyncing,
        checkSyncStatus,
        pushWorkspaceChanges,
        pullWorkspaceChanges,
        initializeSync,
        pushChanges,
        pullChanges,
        compareWithRemote,
      }}
    >
      {children}
    </GitHubContext.Provider>
  );
};

export const useGitHub = () => {
  const context = useContext(GitHubContext);
  if (!context) {
    throw new Error('useGitHub must be used within GitHubProvider');
  }
  return context;
};

export default GitHubContext;
