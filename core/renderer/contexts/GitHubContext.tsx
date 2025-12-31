import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { githubService, GitHubUser, GitHubRepository, GitHubBranch, GitHubCommit, LinkedRepository } from '@/services/GitHubService';
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
  
  // Sync actions
  pushChanges: (message: string, files: Array<{ path: string; content: string }>) => Promise<{ success: boolean; error?: string }>;
  pullChanges: () => Promise<{ success: boolean; error?: string }>;
  
  // Comparison
  compareWithRemote: () => Promise<{ ahead: number; behind: number; files: Array<{ filename: string; status: string }> } | null>;
}

const GitHubContext = createContext<GitHubContextValue | null>(null);

export const GitHubProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const webMode = useWebModeOptional();
  const isWebMode = webMode?.isWebMode ?? false;
  const { activeWorkspaceId } = useWorkspace();
  
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
    const newLinked: LinkedRepository = { workspaceId, owner, repo, branch };
    const updated = [...linkedRepos.filter(r => r.workspaceId !== workspaceId), newLinked];
    setLinkedRepos(updated);
    
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
  }, [linkedRepos, isWebMode]);

  // Unlink repository from workspace
  const unlinkRepository = useCallback(async (workspaceId: string) => {
    const updated = linkedRepos.filter(r => r.workspaceId !== workspaceId);
    setLinkedRepos(updated);
    
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
  }, [linkedRepos, isWebMode]);

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

  // Push changes
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

  // Pull changes
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

  // Compare with remote
  const compareWithRemote = useCallback(async () => {
    if (!activeWorkspaceId) return null;
    
    const linked = getLinkedRepo(activeWorkspaceId);
    if (!linked) return null;
    
    try {
      // Get the latest local and remote state
      // This is a simplified comparison - a full implementation would track local changes
      const branchResult = await githubService.getBranch(linked.owner, linked.repo, linked.branch);
      
      if (!branchResult.success || !branchResult.data) return null;
      
      return {
        ahead: 0, // Would need to track local commits
        behind: 0, // Would need to compare with last sync
        files: [],
      };
    } catch (error) {
      console.error('Error comparing with remote:', error);
      return null;
    }
  }, [activeWorkspaceId, getLinkedRepo]);

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

