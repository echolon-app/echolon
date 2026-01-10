/**
 * Git Manager for Main Process
 * 
 * Handles real Git operations using isomorphic-git.
 * Provides git init, status, add, commit, push, pull, branch operations.
 */

import * as git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import * as fs from 'fs';
import * as path from 'path';

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

export interface GitCredentials {
  username: string;
  password: string; // Personal Access Token
}

class GitManager {
  private static instance: GitManager;
  private credentials: GitCredentials | null = null;

  private constructor() {}

  static getInstance(): GitManager {
    if (!GitManager.instance) {
      GitManager.instance = new GitManager();
    }
    return GitManager.instance;
  }

  /**
   * Set Git credentials (GitHub PAT)
   */
  setCredentials(credentials: GitCredentials | null): void {
    this.credentials = credentials;
  }

  /**
   * Get auth handler for isomorphic-git
   */
  private onAuth = () => {
    if (!this.credentials) {
      throw new Error('No Git credentials set');
    }
    return {
      username: this.credentials.username,
      password: this.credentials.password,
    };
  };

  /**
   * Convert SSH URL to HTTPS URL (isomorphic-git only supports HTTPS)
   * git@github.com:user/repo.git -> https://github.com/user/repo.git
   */
  private convertToHttpsUrl(url: string): string {
    // Check if it's an SSH URL
    const sshMatch = url.match(/^git@([^:]+):(.+)$/);
    if (sshMatch) {
      const host = sshMatch[1];
      const path = sshMatch[2];
      return `https://${host}/${path}`;
    }
    return url;
  }

  /**
   * Initialize a new Git repository
   */
  async init(dir: string): Promise<{ success: boolean; error?: string }> {
    try {
      await git.init({ fs, dir, defaultBranch: 'main' });
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to initialize repository' 
      };
    }
  }

  /**
   * Check if directory is a Git repository
   */
  async isRepo(dir: string): Promise<boolean> {
    try {
      const gitDir = path.join(dir, '.git');
      return fs.existsSync(gitDir);
    } catch {
      return false;
    }
  }

  /**
   * Get repository status (staged, unstaged, untracked files)
   */
  async status(dir: string): Promise<{ success: boolean; status?: GitStatus; error?: string }> {
    try {
      const FILE = 0, HEAD = 1, WORKDIR = 2, STAGE = 3;
      
      const statusMatrix = await git.statusMatrix({ fs, dir });
      
      const staged: GitFileStatus[] = [];
      const unstaged: GitFileStatus[] = [];
      const untracked: string[] = [];
      
      for (const row of statusMatrix) {
        const filepath = row[FILE] as string;
        const headStatus = row[HEAD];
        const workdirStatus = row[WORKDIR];
        const stageStatus = row[STAGE];
        
        // Untracked files: not in HEAD, in workdir, not staged
        if (headStatus === 0 && workdirStatus === 2 && stageStatus === 0) {
          untracked.push(filepath);
        }
        // Staged deletion: file was in HEAD, deleted from workdir, and staged for deletion
        else if (headStatus === 1 && workdirStatus === 0 && stageStatus === 0) {
          staged.push({ path: filepath, status: 'deleted' });
        }
        // Staged files (added or modified)
        else if (stageStatus === 2 || stageStatus === 3) {
          if (headStatus === 0) {
            staged.push({ path: filepath, status: 'added' });
          } else if (workdirStatus === 0) {
            staged.push({ path: filepath, status: 'deleted' });
          } else {
            staged.push({ path: filepath, status: 'modified' });
          }
        }
        // Unstaged changes (in workdir but not staged)
        else if (workdirStatus !== stageStatus) {
          if (headStatus === 1 && workdirStatus === 0) {
            unstaged.push({ path: filepath, status: 'deleted' });
          } else if (headStatus === 0 && workdirStatus === 2) {
            // Already handled as untracked
          } else if (workdirStatus === 2) {
            unstaged.push({ path: filepath, status: 'modified' });
          }
        }
      }
      
      return { success: true, status: { staged, unstaged, untracked } };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to get status' 
      };
    }
  }

  /**
   * Stage files (git add)
   * For deleted files, uses git.remove() instead of git.add()
   */
  async add(dir: string, filepath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const fullPath = path.join(dir, filepath);
      const fileExists = fs.existsSync(fullPath);
      
      if (fileExists) {
        // File exists - use git add
        await git.add({ fs, dir, filepath });
      } else {
        // File was deleted - use git remove to stage the deletion
        await git.remove({ fs, dir, filepath });
      }
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to add file' 
      };
    }
  }

  /**
   * Stage all files
   */
  async addAll(dir: string): Promise<{ success: boolean; error?: string }> {
    try {
      const statusResult = await this.status(dir);
      if (!statusResult.success || !statusResult.status) {
        return { success: false, error: statusResult.error };
      }
      
      // Add all untracked and unstaged files
      const filesToAdd = [
        ...statusResult.status.untracked,
        ...statusResult.status.unstaged.map(f => f.path),
      ];
      
      for (const filepath of filesToAdd) {
        await git.add({ fs, dir, filepath });
      }
      
      // Handle deleted files
      for (const file of statusResult.status.unstaged) {
        if (file.status === 'deleted') {
          await git.remove({ fs, dir, filepath: file.path });
        }
      }
      
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to add all files' 
      };
    }
  }

  /**
   * Unstage a file (git reset HEAD <file>)
   */
  async unstage(dir: string, filepath: string): Promise<{ success: boolean; error?: string }> {
    try {
      await git.resetIndex({ fs, dir, filepath });
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to unstage file' 
      };
    }
  }

  /**
   * Commit staged changes
   */
  async commit(
    dir: string, 
    message: string, 
    author: { name: string; email: string }
  ): Promise<{ success: boolean; oid?: string; error?: string }> {
    try {
      const oid = await git.commit({
        fs,
        dir,
        message,
        author,
      });
      return { success: true, oid };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to commit' 
      };
    }
  }

  /**
   * Get commit history (git log)
   */
  async log(dir: string, depth: number = 50): Promise<{ success: boolean; commits?: GitCommitInfo[]; error?: string }> {
    try {
      const logs = await git.log({ fs, dir, depth });
      
      const commits: GitCommitInfo[] = logs.map(entry => ({
        oid: entry.oid,
        message: entry.commit.message,
        author: {
          name: entry.commit.author.name,
          email: entry.commit.author.email,
          timestamp: entry.commit.author.timestamp,
        },
        parent: entry.commit.parent,
      }));
      
      return { success: true, commits };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to get log' 
      };
    }
  }

  /**
   * Get file content from HEAD commit and working directory for diff
   */
  async getFileForDiff(dir: string, filepath: string): Promise<{ 
    success: boolean; 
    oldContent?: string; 
    newContent?: string; 
    error?: string 
  }> {
    try {
      let oldContent = '';
      let newContent = '';
      
      // Try to get content from HEAD (last committed version)
      try {
        // First resolve HEAD to get the actual commit SHA
        const headOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
        
        // Read the blob from the commit
        const { blob } = await git.readBlob({
          fs,
          dir,
          oid: headOid,
          filepath,
        });
        oldContent = new TextDecoder().decode(blob);
      } catch {
        // File doesn't exist in HEAD (new file) or no commits yet
        oldContent = '';
      }
      
      // Get content from working directory (current version)
      const workingFilePath = path.join(dir, filepath);
      try {
        newContent = await fs.promises.readFile(workingFilePath, 'utf8');
      } catch {
        // File doesn't exist in working directory (deleted file)
        newContent = '';
      }
      
      return { success: true, oldContent, newContent };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to get file for diff' 
      };
    }
  }

  /**
   * List local branches
   */
  async listBranches(dir: string): Promise<{ success: boolean; branches?: GitBranchInfo[]; error?: string }> {
    try {
      const branchNames = await git.listBranches({ fs, dir });
      const currentBranch = await git.currentBranch({ fs, dir, fullname: false });
      
      const branches: GitBranchInfo[] = branchNames.map(name => ({
        name,
        current: name === currentBranch,
      }));
      
      return { success: true, branches };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to list branches' 
      };
    }
  }

  /**
   * Get current branch
   */
  async currentBranch(dir: string): Promise<{ success: boolean; branch?: string; error?: string }> {
    try {
      const branch = await git.currentBranch({ fs, dir, fullname: false });
      return { success: true, branch: branch || 'main' };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to get current branch' 
      };
    }
  }

  /**
   * Create a new branch
   */
  async createBranch(dir: string, name: string, checkout: boolean = false): Promise<{ success: boolean; error?: string }> {
    try {
      await git.branch({ fs, dir, ref: name, checkout });
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to create branch' 
      };
    }
  }

  /**
   * Checkout a branch
   */
  async checkout(dir: string, ref: string): Promise<{ success: boolean; error?: string }> {
    try {
      await git.checkout({ fs, dir, ref });
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to checkout' 
      };
    }
  }

  /**
   * Delete a branch
   */
  async deleteBranch(dir: string, name: string): Promise<{ success: boolean; error?: string }> {
    try {
      await git.deleteBranch({ fs, dir, ref: name });
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to delete branch' 
      };
    }
  }

  /**
   * List remotes
   */
  async listRemotes(dir: string): Promise<{ success: boolean; remotes?: GitRemote[]; error?: string }> {
    try {
      const rawRemotes = await git.listRemotes({ fs, dir });
      // Map isomorphic-git's format to our interface
      const remotes: GitRemote[] = rawRemotes.map(r => ({ name: r.remote, url: r.url }));
      return { success: true, remotes };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to list remotes' 
      };
    }
  }

  /**
   * Add a remote
   */
  async addRemote(dir: string, name: string, url: string): Promise<{ success: boolean; error?: string }> {
    try {
      await git.addRemote({ fs, dir, remote: name, url });
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to add remote' 
      };
    }
  }

  /**
   * Remove a remote
   */
  async removeRemote(dir: string, name: string): Promise<{ success: boolean; error?: string }> {
    try {
      await git.deleteRemote({ fs, dir, remote: name });
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to remove remote' 
      };
    }
  }

  /**
   * Push to remote
   */
  async push(
    dir: string, 
    remote: string = 'origin', 
    branch?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.credentials) {
        return { success: false, error: 'No credentials set. Please connect to GitHub first.' };
      }
      
      const currentBranch = branch || (await git.currentBranch({ fs, dir, fullname: false })) || 'main';
      
      // Get the remote URL explicitly - isomorphic-git sometimes has issues with remote name resolution
      const remotesResult = await this.listRemotes(dir);
      if (!remotesResult.success || !remotesResult.remotes) {
        return { success: false, error: 'Failed to get remotes' };
      }
      
      const remoteConfig = remotesResult.remotes.find(r => r.name === remote);
      if (!remoteConfig) {
        return { success: false, error: `Remote "${remote}" not found. Please add a remote first.` };
      }
      
      // Convert SSH URL to HTTPS if necessary (isomorphic-git only supports HTTPS)
      const remoteUrl = this.convertToHttpsUrl(remoteConfig.url);
      
      await git.push({
        fs,
        http,
        dir,
        url: remoteUrl,
        ref: currentBranch,
        remoteRef: currentBranch,
        onAuth: this.onAuth,
      });
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to push';
      // Provide more helpful error messages
      if (message.includes('401')) {
        return { success: false, error: 'Authentication failed. Please check your GitHub token.' };
      }
      if (message.includes('403')) {
        return { success: false, error: 'Permission denied. Make sure your token has repo access.' };
      }
      if (message.includes('404')) {
        return { success: false, error: 'Repository not found. This can happen if the repo is private and your token lacks access, or if the URL is incorrect.' };
      }
      return { success: false, error: message };
    }
  }

  /**
   * Fetch from remote
   */
  async fetch(
    dir: string, 
    remote: string = 'origin',
    branch?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.credentials) {
        return { success: false, error: 'No credentials set. Please connect to GitHub first.' };
      }
      
      // Get the remote URL explicitly
      const remotesResult = await this.listRemotes(dir);
      if (!remotesResult.success || !remotesResult.remotes) {
        return { success: false, error: 'Failed to get remotes' };
      }
      
      const remoteConfig = remotesResult.remotes.find(r => r.name === remote);
      if (!remoteConfig) {
        return { success: false, error: `Remote "${remote}" not found. Please add a remote first.` };
      }
      
      // Convert SSH URL to HTTPS if necessary (isomorphic-git only supports HTTPS)
      const remoteUrl = this.convertToHttpsUrl(remoteConfig.url);
      
      await git.fetch({
        fs,
        http,
        dir,
        url: remoteUrl,
        ref: branch,
        onAuth: this.onAuth,
        singleBranch: !!branch,
      });
      
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to fetch' 
      };
    }
  }

  /**
   * Pull from remote (fetch + merge)
   */
  async pull(
    dir: string, 
    remote: string = 'origin',
    branch?: string,
    author?: { name: string; email: string }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.credentials) {
        return { success: false, error: 'No credentials set. Please connect to GitHub first.' };
      }
      
      const currentBranch = branch || (await git.currentBranch({ fs, dir, fullname: false })) || 'main';
      
      // Get the remote URL explicitly
      const remotesResult = await this.listRemotes(dir);
      if (!remotesResult.success || !remotesResult.remotes) {
        return { success: false, error: 'Failed to get remotes' };
      }
      
      const remoteConfig = remotesResult.remotes.find(r => r.name === remote);
      if (!remoteConfig) {
        return { success: false, error: `Remote "${remote}" not found. Please add a remote first.` };
      }
      
      // Convert SSH URL to HTTPS if necessary (isomorphic-git only supports HTTPS)
      const remoteUrl = this.convertToHttpsUrl(remoteConfig.url);
      
      await git.pull({
        fs,
        http,
        dir,
        url: remoteUrl,
        ref: currentBranch,
        onAuth: this.onAuth,
        author: author || { name: 'Echolon User', email: 'user@echolon.app' },
        singleBranch: true,
      });
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to pull';
      if (message.includes('MergeConflict')) {
        return { success: false, error: 'Merge conflict detected. Please resolve manually.' };
      }
      return { success: false, error: message };
    }
  }

  /**
   * Clone a repository
   */
  async clone(
    url: string, 
    dir: string, 
    branch?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await git.clone({
        fs,
        http,
        dir,
        url,
        ref: branch,
        singleBranch: !!branch,
        onAuth: this.credentials ? this.onAuth : undefined,
      });
      
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to clone' 
      };
    }
  }

  /**
   * Get diff for a file (simplified - just returns if changed)
   */
  async diff(dir: string, filepath: string): Promise<{ success: boolean; changed?: boolean; error?: string }> {
    try {
      const FILE = 0, HEAD = 1, WORKDIR = 2;
      const status = await git.statusMatrix({ fs, dir, filepaths: [filepath] });
      
      if (status.length === 0) {
        return { success: true, changed: false };
      }
      
      const row = status[0];
      const changed = row[HEAD] !== row[WORKDIR];
      
      return { success: true, changed };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to get diff' 
      };
    }
  }

  /**
   * Discard changes in a file (checkout from HEAD)
   */
  async discardChanges(dir: string, filepath: string): Promise<{ success: boolean; error?: string }> {
    try {
      await git.checkout({ fs, dir, filepaths: [filepath], force: true });
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to discard changes' 
      };
    }
  }

  /**
   * Create .gitignore with default patterns
   */
  async createGitignore(dir: string): Promise<{ success: boolean; error?: string }> {
    try {
      const gitignorePath = path.join(dir, '.gitignore');
      const defaultContent = `# Echolon workspace gitignore
# OS files
.DS_Store
Thumbs.db

# Mocking data (usually not version controlled)
mocking/

# Temporary files
*.tmp
*.temp

# Node modules if any
node_modules/
`;
      
      fs.writeFileSync(gitignorePath, defaultContent, 'utf-8');
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to create .gitignore' 
      };
    }
  }
}

export const gitManager = GitManager.getInstance();
export default gitManager;

