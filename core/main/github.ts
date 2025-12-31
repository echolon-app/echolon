/**
 * GitHub API Manager for Main Process
 * 
 * Handles GitHub API operations using the REST API directly.
 * Provides authentication (PAT/OAuth), repository operations,
 * and content management for syncing Echolon data.
 */

import { BrowserWindow, shell } from 'electron';
import https from 'https';
import http from 'http';

// GitHub API base URL
const GITHUB_API_BASE = 'https://api.github.com';

// GitHub OAuth App credentials (you would need to register an OAuth app)
const GITHUB_OAUTH_CLIENT_ID = process.env.GITHUB_OAUTH_CLIENT_ID || '';
const GITHUB_OAUTH_REDIRECT_URI = 'echolon://oauth/callback';

// Types
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
  content?: string; // Base64 encoded for files
  encoding?: string;
  html_url: string;
  download_url: string | null;
}

export interface GitHubFileChange {
  path: string;
  content: string; // Base64 encoded
  sha?: string; // Required for updates, omit for creates
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  html_url: string;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  created_at: string;
  updated_at: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

class GitHubManager {
  private static instance: GitHubManager;
  private accessToken: string | null = null;
  private mainWindow: BrowserWindow | null = null;
  private oauthServer: http.Server | null = null;

  private constructor() {}

  static getInstance(): GitHubManager {
    if (!GitHubManager.instance) {
      GitHubManager.instance = new GitHubManager();
    }
    return GitHubManager.instance;
  }

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  /**
   * Set the access token for API calls
   */
  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  /**
   * Get the current access token
   */
  getAccessToken(): string | null {
    return this.accessToken;
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  /**
   * Make an authenticated request to GitHub API
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    return new Promise((resolve) => {
      const url = new URL(endpoint.startsWith('http') ? endpoint : `${GITHUB_API_BASE}${endpoint}`);
      
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Echolon-App',
        'X-GitHub-Api-Version': '2022-11-28',
      };

      if (this.accessToken) {
        headers['Authorization'] = `Bearer ${this.accessToken}`;
      }

      if (body) {
        headers['Content-Type'] = 'application/json';
      }

      const options: https.RequestOptions = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers,
      };

      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const statusCode = res.statusCode || 500;
            
            if (statusCode >= 200 && statusCode < 300) {
              const parsed = data ? JSON.parse(data) : null;
              resolve({ success: true, data: parsed, statusCode });
            } else {
              const errorData = data ? JSON.parse(data) : { message: 'Unknown error' };
              resolve({
                success: false,
                error: errorData.message || `HTTP ${statusCode}`,
                statusCode,
              });
            }
          } catch (error) {
            resolve({
              success: false,
              error: 'Failed to parse response',
              statusCode: res.statusCode,
            });
          }
        });
      });

      req.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      
      req.end();
    });
  }

  // ==================== Authentication ====================

  /**
   * Authenticate with a Personal Access Token
   */
  async authenticateWithPAT(token: string): Promise<ApiResponse<GitHubUser>> {
    this.accessToken = token;
    const result = await this.getCurrentUser();
    
    if (!result.success) {
      this.accessToken = null;
    }
    
    return result;
  }

  /**
   * Start OAuth flow
   */
  async startOAuthFlow(): Promise<{ success: boolean; url?: string; error?: string }> {
    if (!GITHUB_OAUTH_CLIENT_ID) {
      return { success: false, error: 'OAuth not configured' };
    }

    const state = Math.random().toString(36).substring(2);
    const scope = 'repo,user:email';
    
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_OAUTH_CLIENT_ID}&redirect_uri=${encodeURIComponent(GITHUB_OAUTH_REDIRECT_URI)}&scope=${scope}&state=${state}`;
    
    // Open in external browser
    await shell.openExternal(authUrl);
    
    return { success: true, url: authUrl };
  }

  /**
   * Handle OAuth callback
   */
  async handleOAuthCallback(code: string): Promise<ApiResponse<GitHubUser>> {
    // This would need a backend server to exchange the code for a token
    // For now, we'll just return an error suggesting PAT usage
    return {
      success: false,
      error: 'OAuth callback handling requires a backend server. Please use a Personal Access Token instead.',
    };
  }

  /**
   * Logout / clear authentication
   */
  logout(): void {
    this.accessToken = null;
  }

  // ==================== User Operations ====================

  /**
   * Get the current authenticated user
   */
  async getCurrentUser(): Promise<ApiResponse<GitHubUser>> {
    return this.request<GitHubUser>('GET', '/user');
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
  }): Promise<ApiResponse<GitHubRepository[]>> {
    const params = new URLSearchParams();
    if (options?.visibility) params.set('visibility', options.visibility);
    if (options?.sort) params.set('sort', options.sort);
    if (options?.per_page) params.set('per_page', options.per_page.toString());
    if (options?.page) params.set('page', options.page.toString());
    
    const query = params.toString();
    return this.request<GitHubRepository[]>('GET', `/user/repos${query ? `?${query}` : ''}`);
  }

  /**
   * Get a specific repository
   */
  async getRepository(owner: string, repo: string): Promise<ApiResponse<GitHubRepository>> {
    return this.request<GitHubRepository>('GET', `/repos/${owner}/${repo}`);
  }

  /**
   * Create a new repository
   */
  async createRepository(options: {
    name: string;
    description?: string;
    private?: boolean;
    auto_init?: boolean;
  }): Promise<ApiResponse<GitHubRepository>> {
    return this.request<GitHubRepository>('POST', '/user/repos', options);
  }

  // ==================== Branch Operations ====================

  /**
   * List branches for a repository
   */
  async listBranches(owner: string, repo: string): Promise<ApiResponse<GitHubBranch[]>> {
    return this.request<GitHubBranch[]>('GET', `/repos/${owner}/${repo}/branches`);
  }

  /**
   * Get a specific branch
   */
  async getBranch(owner: string, repo: string, branch: string): Promise<ApiResponse<GitHubBranch>> {
    return this.request<GitHubBranch>('GET', `/repos/${owner}/${repo}/branches/${branch}`);
  }

  /**
   * Create a new branch
   */
  async createBranch(
    owner: string,
    repo: string,
    branchName: string,
    sourceSha: string
  ): Promise<ApiResponse<{ ref: string; object: { sha: string } }>> {
    return this.request('POST', `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${branchName}`,
      sha: sourceSha,
    });
  }

  // ==================== Commit Operations ====================

  /**
   * List commits for a repository
   */
  async listCommits(
    owner: string,
    repo: string,
    options?: {
      sha?: string; // Branch name or SHA
      path?: string;
      per_page?: number;
      page?: number;
    }
  ): Promise<ApiResponse<Array<{ sha: string; commit: GitHubCommit; html_url: string }>>> {
    const params = new URLSearchParams();
    if (options?.sha) params.set('sha', options.sha);
    if (options?.path) params.set('path', options.path);
    if (options?.per_page) params.set('per_page', options.per_page.toString());
    if (options?.page) params.set('page', options.page.toString());
    
    const query = params.toString();
    return this.request('GET', `/repos/${owner}/${repo}/commits${query ? `?${query}` : ''}`);
  }

  /**
   * Get a specific commit
   */
  async getCommit(
    owner: string,
    repo: string,
    sha: string
  ): Promise<ApiResponse<{ sha: string; commit: GitHubCommit; files?: Array<{ filename: string; status: string; additions: number; deletions: number; changes: number; patch?: string }> }>> {
    return this.request('GET', `/repos/${owner}/${repo}/commits/${sha}`);
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
  ): Promise<ApiResponse<GitHubContent | GitHubContent[]>> {
    const params = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    return this.request('GET', `/repos/${owner}/${repo}/contents/${path}${params}`);
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
      sha?: string; // Required for updates
      branch?: string;
    }
  ): Promise<ApiResponse<{ content: GitHubContent; commit: { sha: string; message: string } }>> {
    return this.request('PUT', `/repos/${owner}/${repo}/contents/${path}`, options);
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
  ): Promise<ApiResponse<{ commit: { sha: string } }>> {
    return this.request('DELETE', `/repos/${owner}/${repo}/contents/${path}`, options);
  }

  /**
   * Get the tree (directory structure) of a repository
   */
  async getTree(
    owner: string,
    repo: string,
    sha: string,
    recursive?: boolean
  ): Promise<ApiResponse<{ sha: string; tree: Array<{ path: string; mode: string; type: string; sha: string; size?: number }> }>> {
    const params = recursive ? '?recursive=1' : '';
    return this.request('GET', `/repos/${owner}/${repo}/git/trees/${sha}${params}`);
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
  ): Promise<ApiResponse<{
    status: 'ahead' | 'behind' | 'diverged' | 'identical';
    ahead_by: number;
    behind_by: number;
    total_commits: number;
    commits: Array<{ sha: string; commit: GitHubCommit }>;
    files: Array<{
      filename: string;
      status: 'added' | 'removed' | 'modified' | 'renamed';
      additions: number;
      deletions: number;
      changes: number;
      patch?: string;
    }>;
  }>> {
    return this.request('GET', `/repos/${owner}/${repo}/compare/${base}...${head}`);
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
  ): Promise<ApiResponse<{ sha: string }>> {
    // Get the current branch SHA
    const branchResult = await this.getBranch(owner, repo, branch);
    if (!branchResult.success || !branchResult.data) {
      return { success: false, error: branchResult.error || 'Failed to get branch' };
    }

    const baseSha = branchResult.data.commit.sha;

    // Get the base tree
    const treeResult = await this.getTree(owner, repo, baseSha);
    if (!treeResult.success || !treeResult.data) {
      return { success: false, error: treeResult.error || 'Failed to get tree' };
    }

    // Create blobs for each file
    const treeEntries: Array<{ path: string; mode: string; type: string; sha?: string; content?: string }> = [];
    
    for (const change of changes) {
      // Create a blob for the file content
      const blobResult = await this.request<{ sha: string }>('POST', `/repos/${owner}/${repo}/git/blobs`, {
        content: change.content,
        encoding: 'base64',
      });
      
      if (!blobResult.success || !blobResult.data) {
        return { success: false, error: `Failed to create blob for ${change.path}` };
      }
      
      treeEntries.push({
        path: change.path,
        mode: '100644',
        type: 'blob',
        sha: blobResult.data.sha,
      });
    }

    // Create a new tree
    const newTreeResult = await this.request<{ sha: string }>('POST', `/repos/${owner}/${repo}/git/trees`, {
      base_tree: treeResult.data.sha,
      tree: treeEntries,
    });
    
    if (!newTreeResult.success || !newTreeResult.data) {
      return { success: false, error: newTreeResult.error || 'Failed to create tree' };
    }

    // Create the commit
    const commitResult = await this.request<{ sha: string }>('POST', `/repos/${owner}/${repo}/git/commits`, {
      message,
      tree: newTreeResult.data.sha,
      parents: [baseSha],
    });
    
    if (!commitResult.success || !commitResult.data) {
      return { success: false, error: commitResult.error || 'Failed to create commit' };
    }

    // Update the branch reference
    const updateResult = await this.request<{ ref: string }>('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      sha: commitResult.data.sha,
    });
    
    if (!updateResult.success) {
      return { success: false, error: updateResult.error || 'Failed to update branch' };
    }

    return { success: true, data: { sha: commitResult.data.sha } };
  }

  /**
   * Pull latest changes (get latest commit info)
   */
  async pullLatest(
    owner: string,
    repo: string,
    branch: string
  ): Promise<ApiResponse<{
    sha: string;
    commit: GitHubCommit;
    tree: Array<{ path: string; type: string; sha: string }>;
  }>> {
    // Get the latest commit
    const branchResult = await this.getBranch(owner, repo, branch);
    if (!branchResult.success || !branchResult.data) {
      return { success: false, error: branchResult.error || 'Failed to get branch' };
    }

    // Get the commit details
    const commitResult = await this.getCommit(owner, repo, branchResult.data.commit.sha);
    if (!commitResult.success || !commitResult.data) {
      return { success: false, error: commitResult.error || 'Failed to get commit' };
    }

    // Get the tree
    const treeResult = await this.getTree(owner, repo, branchResult.data.commit.sha, true);
    if (!treeResult.success || !treeResult.data) {
      return { success: false, error: treeResult.error || 'Failed to get tree' };
    }

    return {
      success: true,
      data: {
        sha: commitResult.data.sha,
        commit: commitResult.data.commit,
        tree: treeResult.data.tree.map(t => ({
          path: t.path,
          type: t.type,
          sha: t.sha,
        })),
      },
    };
  }
}

export const githubManager = GitHubManager.getInstance();
export default githubManager;

