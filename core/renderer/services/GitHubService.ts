/**
 * GitHub Service for Renderer Process
 * 
 * Provides a unified interface for GitHub operations,
 * communicating with the main process via IPC.
 */

import { formatDateMedium } from '@/utils';

// Types from the preload script (re-exported for convenience)
export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  name: string | null;
  email: string | null;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: {
    login: string;
    avatar_url: string;
  };
  description: string | null;
  default_branch: string;
  html_url: string;
  clone_url: string;
  pushed_at: string;
}

export interface GitHubBranch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author: {
    name: string;
    email: string;
    date: string;
  };
  committer: {
    name: string;
    email: string;
    date: string;
  };
  html_url: string;
  parents: Array<{ sha: string }>;
}

export interface GitHubContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: 'file' | 'dir';
  content?: string;
  encoding?: string;
  html_url: string;
  download_url: string | null;
}

export interface GitHubFileChange {
  path: string;
  content: string; // Base64 encoded
  sha?: string;
}

export interface GitHubApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

export interface GitHubCompareResult {
  status: string;
  ahead_by: number;
  behind_by: number;
  commits: Array<{ sha: string; commit: GitHubCommit }>;
  files: Array<{ filename: string; status: string; patch?: string }>;
}

export interface LinkedRepository {
  workspaceId: string;
  owner: string;
  repo: string;
  branch: string;
}

class GitHubService {
  private static instance: GitHubService;

  private constructor() {}

  static getInstance(): GitHubService {
    if (!GitHubService.instance) {
      GitHubService.instance = new GitHubService();
    }
    return GitHubService.instance;
  }

  // ==================== Authentication ====================

  /**
   * Authenticate with a Personal Access Token
   */
  async authenticateWithPAT(token: string): Promise<GitHubApiResponse<GitHubUser>> {
    return window.electronAPI.githubAuthWithPAT(token);
  }

  /**
   * Start OAuth flow (opens browser)
   */
  async startOAuthFlow(): Promise<{ success: boolean; url?: string; error?: string }> {
    return window.electronAPI.githubStartOAuth();
  }

  /**
   * Logout / clear authentication
   */
  async logout(): Promise<{ success: boolean }> {
    return window.electronAPI.githubLogout();
  }

  /**
   * Get the current authenticated user
   */
  async getCurrentUser(): Promise<GitHubApiResponse<GitHubUser>> {
    return window.electronAPI.githubGetCurrentUser();
  }

  /**
   * Check if authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    return window.electronAPI.githubIsAuthenticated();
  }

  /**
   * Set access token (for restoring from storage)
   */
  async setAccessToken(token: string | null): Promise<{ success: boolean }> {
    return window.electronAPI.githubSetAccessToken(token);
  }

  // ==================== Repository Operations ====================

  /**
   * List repositories for the authenticated user
   */
  async listRepositories(options?: {
    visibility?: 'all' | 'public' | 'private';
    sort?: 'created' | 'updated' | 'pushed' | 'full_name';
    per_page?: number;
    page?: number;
  }): Promise<GitHubApiResponse<GitHubRepository[]>> {
    return window.electronAPI.githubListRepos(options);
  }

  /**
   * Get a specific repository
   */
  async getRepository(owner: string, repo: string): Promise<GitHubApiResponse<GitHubRepository>> {
    return window.electronAPI.githubGetRepo(owner, repo);
  }

  /**
   * Create a new repository
   */
  async createRepository(options: {
    name: string;
    description?: string;
    private?: boolean;
    auto_init?: boolean;
  }): Promise<GitHubApiResponse<GitHubRepository>> {
    return window.electronAPI.githubCreateRepo(options);
  }

  // ==================== Branch Operations ====================

  /**
   * List branches for a repository
   */
  async listBranches(owner: string, repo: string): Promise<GitHubApiResponse<GitHubBranch[]>> {
    return window.electronAPI.githubListBranches(owner, repo);
  }

  /**
   * Get a specific branch
   */
  async getBranch(owner: string, repo: string, branch: string): Promise<GitHubApiResponse<GitHubBranch>> {
    return window.electronAPI.githubGetBranch(owner, repo, branch);
  }

  /**
   * Create a new branch
   */
  async createBranch(
    owner: string,
    repo: string,
    branchName: string,
    sourceSha: string
  ): Promise<GitHubApiResponse<{ ref: string; object: { sha: string } }>> {
    return window.electronAPI.githubCreateBranch(owner, repo, branchName, sourceSha);
  }

  // ==================== Commit Operations ====================

  /**
   * List commits for a repository
   */
  async listCommits(
    owner: string,
    repo: string,
    options?: {
      sha?: string;
      path?: string;
      per_page?: number;
      page?: number;
    }
  ): Promise<GitHubApiResponse<Array<{ sha: string; commit: GitHubCommit; html_url: string }>>> {
    return window.electronAPI.githubListCommits(owner, repo, options);
  }

  /**
   * Get a specific commit with file changes
   */
  async getCommit(
    owner: string,
    repo: string,
    sha: string
  ): Promise<GitHubApiResponse<{ sha: string; commit: GitHubCommit; files?: Array<{ filename: string; status: string; patch?: string }> }>> {
    return window.electronAPI.githubGetCommit(owner, repo, sha);
  }

  // ==================== Content Operations ====================

  /**
   * Get contents of a file or directory
   */
  async getContents(
    owner: string,
    repo: string,
    path: string,
    ref?: string
  ): Promise<GitHubApiResponse<GitHubContent | GitHubContent[]>> {
    return window.electronAPI.githubGetContents(owner, repo, path, ref);
  }

  /**
   * Create or update a file
   */
  async createOrUpdateFile(
    owner: string,
    repo: string,
    path: string,
    options: {
      message: string;
      content: string; // Base64 encoded
      sha?: string;
      branch?: string;
    }
  ): Promise<GitHubApiResponse<{ content: GitHubContent; commit: { sha: string } }>> {
    return window.electronAPI.githubCreateOrUpdateFile(owner, repo, path, options);
  }

  /**
   * Delete a file
   */
  async deleteFile(
    owner: string,
    repo: string,
    path: string,
    options: {
      message: string;
      sha: string;
      branch?: string;
    }
  ): Promise<GitHubApiResponse<{ commit: { sha: string } }>> {
    return window.electronAPI.githubDeleteFile(owner, repo, path, options);
  }

  // ==================== Comparison Operations ====================

  /**
   * Compare two commits
   */
  async compareCommits(
    owner: string,
    repo: string,
    base: string,
    head: string
  ): Promise<GitHubApiResponse<GitHubCompareResult>> {
    return window.electronAPI.githubCompareCommits(owner, repo, base, head);
  }

  // ==================== Batch Operations ====================

  /**
   * Push multiple file changes in a single commit
   */
  async pushChanges(
    owner: string,
    repo: string,
    branch: string,
    message: string,
    changes: GitHubFileChange[]
  ): Promise<GitHubApiResponse<{ sha: string }>> {
    return window.electronAPI.githubPushChanges(owner, repo, branch, message, changes);
  }

  /**
   * Pull latest changes (get current state)
   */
  async pullLatest(
    owner: string,
    repo: string,
    branch: string
  ): Promise<GitHubApiResponse<{ sha: string; commit: GitHubCommit; tree: Array<{ path: string; type: string; sha: string }> }>> {
    return window.electronAPI.githubPullLatest(owner, repo, branch);
  }

  // ==================== Utility Methods ====================

  /**
   * Encode content to base64
   */
  encodeContent(content: string): string {
    return btoa(unescape(encodeURIComponent(content)));
  }

  /**
   * Decode content from base64
   */
  decodeContent(base64: string): string {
    return decodeURIComponent(escape(atob(base64)));
  }

  /**
   * Parse a full repository name (owner/repo) into parts
   */
  parseRepoFullName(fullName: string): { owner: string; repo: string } | null {
    const parts = fullName.split('/');
    if (parts.length !== 2) return null;
    return { owner: parts[0], repo: parts[1] };
  }

  /**
   * Format a date string for display
   */
  formatDate(dateString: string): string {
    return formatDateMedium(dateString);
  }

  /**
   * Get relative time (e.g., "2 hours ago")
   */
  getRelativeTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    return this.formatDate(dateString);
  }
}

export const githubService = GitHubService.getInstance();
export default githubService;

