/**
 * GitHub Sync Service
 * 
 * Handles synchronization between local workspace files and GitHub repositories.
 * Tracks changes, computes diffs, and manages push/pull operations.
 */

import { githubService, GitHubContent } from './GitHubService';
import { fileStorageManager } from './FileStorageManager';
import { EchoFile, WorkspaceFile } from '../../shared/echoFormat';

// Types for sync state
export interface GitHubSyncState {
  workspaceId: string;
  workspaceName: string;
  owner: string;
  repo: string;
  branch: string;
  lastSyncedSha: string | null;
  lastSyncedAt: number | null;
  // Map of file path -> content hash at last sync
  fileHashes: Record<string, string>;
}

export interface FileChange {
  path: string;
  type: 'added' | 'modified' | 'deleted';
  localContent?: string;
  remoteContent?: string;
  localHash?: string;
  remoteHash?: string;
}

export interface SyncStatus {
  hasLocalChanges: boolean;
  hasRemoteChanges: boolean;
  localChanges: FileChange[];
  remoteChanges: FileChange[];
  conflicts: FileChange[];
  lastSyncedAt: number | null;
  lastSyncedSha: string | null;
}

export interface PushResult {
  success: boolean;
  sha?: string;
  error?: string;
  pushedFiles: string[];
}

export interface PullResult {
  success: boolean;
  error?: string;
  pulledFiles: string[];
  conflicts?: FileChange[];
}

const SYNC_STATE_FILE = 'github-sync-state';

class GitHubSyncService {
  private static instance: GitHubSyncService;
  private syncStates: Map<string, GitHubSyncState> = new Map();
  private initialized = false;

  private constructor() {}

  static getInstance(): GitHubSyncService {
    if (!GitHubSyncService.instance) {
      GitHubSyncService.instance = new GitHubSyncService();
    }
    return GitHubSyncService.instance;
  }

  /**
   * Initialize the sync service
   * Note: Sync states are now stored per workspace, so they're loaded on demand
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  /**
   * Load sync state for a specific workspace
   */
  async loadSyncState(workspaceName: string): Promise<GitHubSyncState | null> {
    try {
      const state = await fileStorageManager.readWorkspaceDataFile<GitHubSyncState>(
        workspaceName,
        SYNC_STATE_FILE
      );
      if (state) {
        this.syncStates.set(state.workspaceId, state);
      }
      return state;
    } catch (error) {
      console.error(`Failed to load sync state for workspace ${workspaceName}:`, error);
      return null;
    }
  }

  /**
   * Save sync state for a specific workspace
   */
  private async saveSyncState(state: GitHubSyncState): Promise<void> {
    try {
      await fileStorageManager.writeWorkspaceDataFile(
        state.workspaceName,
        SYNC_STATE_FILE,
        state
      );
    } catch (error) {
      console.error(`Failed to save sync state for workspace ${state.workspaceName}:`, error);
    }
  }

  /**
   * Delete sync state for a specific workspace
   */
  private async deleteSyncState(workspaceName: string): Promise<void> {
    try {
      await fileStorageManager.deleteWorkspaceDataFile(workspaceName, SYNC_STATE_FILE);
    } catch (error) {
      console.error(`Failed to delete sync state for workspace ${workspaceName}:`, error);
    }
  }

  /**
   * Get sync state for a workspace
   */
  getSyncState(workspaceId: string): GitHubSyncState | undefined {
    return this.syncStates.get(workspaceId);
  }

  /**
   * Link a workspace to a GitHub repository
   */
  async linkRepository(
    workspaceId: string,
    workspaceName: string,
    owner: string,
    repo: string,
    branch: string
  ): Promise<void> {
    const state: GitHubSyncState = {
      workspaceId,
      workspaceName,
      owner,
      repo,
      branch,
      lastSyncedSha: null,
      lastSyncedAt: null,
      fileHashes: {},
    };
    this.syncStates.set(workspaceId, state);
    await this.saveSyncState(state);
  }

  /**
   * Unlink a workspace from GitHub
   */
  async unlinkRepository(workspaceId: string, workspaceName: string): Promise<void> {
    this.syncStates.delete(workspaceId);
    await this.deleteSyncState(workspaceName);
  }

  /**
   * Compute a simple hash of content for change detection
   */
  private computeHash(content: string): string {
    // Simple hash function - in production you might use crypto
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  /**
   * Get all workspace files that should be synced
   * Returns map of relative path -> content
   */
  async getWorkspaceFiles(workspaceName: string): Promise<Map<string, string>> {
    const files = new Map<string, string>();

    // Get workspace metadata
    const workspace = await fileStorageManager.readWorkspace(workspaceName);
    if (workspace) {
      files.set('workspace.json', JSON.stringify(workspace, null, 2));
    }

    // Get all collections
    const collections = await fileStorageManager.getAllCollections(workspaceName);
    for (const collection of collections) {
      const fileName = `collections/${fileStorageManager.sanitizeFilename(collection.metadata.name)}.json`;
      files.set(fileName, JSON.stringify(collection, null, 2));
    }

    return files;
  }

  /**
   * Get files from GitHub repository
   * Returns map of relative path -> content
   */
  async getRemoteFiles(owner: string, repo: string, branch: string): Promise<Map<string, string>> {
    const files = new Map<string, string>();

    try {
      // Get the tree recursively
      const branchResult = await githubService.getBranch(owner, repo, branch);
      if (!branchResult.success || !branchResult.data) {
        return files;
      }

      // Get root contents
      const rootResult = await githubService.getContents(owner, repo, '', branch);
      if (!rootResult.success || !rootResult.data) {
        return files;
      }

      const contents = Array.isArray(rootResult.data) ? rootResult.data : [rootResult.data];
      
      // Process files recursively
      await this.processRemoteContents(owner, repo, branch, contents, '', files);
    } catch (error) {
      console.error('Error getting remote files:', error);
    }

    return files;
  }

  /**
   * Recursively process GitHub contents
   */
  private async processRemoteContents(
    owner: string,
    repo: string,
    branch: string,
    contents: GitHubContent[],
    basePath: string,
    files: Map<string, string>
  ): Promise<void> {
    for (const item of contents) {
      const itemPath = basePath ? `${basePath}/${item.name}` : item.name;

      if (item.type === 'file' && item.name.endsWith('.json')) {
        // Fetch file content
        const fileResult = await githubService.getContents(owner, repo, item.path, branch);
        if (fileResult.success && fileResult.data && !Array.isArray(fileResult.data)) {
          const fileContent = fileResult.data as GitHubContent;
          if (fileContent.content && fileContent.encoding === 'base64') {
            const decoded = githubService.decodeContent(fileContent.content);
            files.set(itemPath, decoded);
          }
        }
      } else if (item.type === 'dir') {
        // Recurse into directory
        const dirResult = await githubService.getContents(owner, repo, item.path, branch);
        if (dirResult.success && dirResult.data && Array.isArray(dirResult.data)) {
          await this.processRemoteContents(owner, repo, branch, dirResult.data, itemPath, files);
        }
      }
    }
  }

  /**
   * Compare local and remote files to detect changes
   */
  async compareWithRemote(workspaceId: string, workspaceName: string): Promise<SyncStatus | null> {
    const syncState = this.syncStates.get(workspaceId);
    if (!syncState) {
      return null;
    }

    const { owner, repo, branch, fileHashes, lastSyncedAt, lastSyncedSha } = syncState;

    // Get current local files
    const localFiles = await this.getWorkspaceFiles(workspaceName);
    
    // Get current remote files
    const remoteFiles = await this.getRemoteFiles(owner, repo, branch);

    const localChanges: FileChange[] = [];
    const remoteChanges: FileChange[] = [];
    const conflicts: FileChange[] = [];

    // All file paths (union of local, remote, and previously synced)
    const allPaths = new Set([
      ...localFiles.keys(),
      ...remoteFiles.keys(),
      ...Object.keys(fileHashes),
    ]);

    for (const path of allPaths) {
      const localContent = localFiles.get(path);
      const remoteContent = remoteFiles.get(path);
      const lastSyncedHash = fileHashes[path];

      const localHash = localContent ? this.computeHash(localContent) : undefined;
      const remoteHash = remoteContent ? this.computeHash(remoteContent) : undefined;

      // Determine what changed
      const localChanged = localHash !== lastSyncedHash;
      const remoteChanged = remoteHash !== lastSyncedHash;

      if (localChanged && remoteChanged) {
        // Both changed - conflict!
        if (localHash !== remoteHash) {
          conflicts.push({
            path,
            type: localContent && remoteContent ? 'modified' : (localContent ? 'added' : 'deleted'),
            localContent,
            remoteContent,
            localHash,
            remoteHash,
          });
        }
        // If hashes match, both sides made the same change - no conflict
      } else if (localChanged) {
        // Only local changed
        const type = !lastSyncedHash ? 'added' : (!localContent ? 'deleted' : 'modified');
        localChanges.push({
          path,
          type,
          localContent,
          localHash,
        });
      } else if (remoteChanged) {
        // Only remote changed
        const type = !lastSyncedHash ? 'added' : (!remoteContent ? 'deleted' : 'modified');
        remoteChanges.push({
          path,
          type,
          remoteContent,
          remoteHash,
        });
      }
    }

    return {
      hasLocalChanges: localChanges.length > 0,
      hasRemoteChanges: remoteChanges.length > 0,
      localChanges,
      remoteChanges,
      conflicts,
      lastSyncedAt,
      lastSyncedSha,
    };
  }

  /**
   * Push local changes to GitHub
   */
  async pushChanges(
    workspaceId: string,
    workspaceName: string,
    commitMessage: string
  ): Promise<PushResult> {
    const syncState = this.syncStates.get(workspaceId);
    if (!syncState) {
      return { success: false, error: 'Workspace not linked to GitHub', pushedFiles: [] };
    }

    const { owner, repo, branch } = syncState;

    try {
      // Get current local files
      const localFiles = await this.getWorkspaceFiles(workspaceName);
      
      // Prepare changes for GitHub
      const changes = Array.from(localFiles.entries()).map(([path, content]) => ({
        path,
        content: githubService.encodeContent(content),
      }));

      if (changes.length === 0) {
        return { success: false, error: 'No files to push', pushedFiles: [] };
      }

      // Push to GitHub
      const result = await githubService.pushChanges(owner, repo, branch, commitMessage, changes);

      if (!result.success) {
        return { success: false, error: result.error || 'Push failed', pushedFiles: [] };
      }

      // Update sync state with new hashes
      const newHashes: Record<string, string> = {};
      for (const [path, content] of localFiles.entries()) {
        newHashes[path] = this.computeHash(content);
      }

      syncState.lastSyncedSha = result.data?.sha || null;
      syncState.lastSyncedAt = Date.now();
      syncState.fileHashes = newHashes;
      
      await this.saveSyncState(syncState);

      return {
        success: true,
        sha: result.data?.sha,
        pushedFiles: Array.from(localFiles.keys()),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        pushedFiles: [],
      };
    }
  }

  /**
   * Pull remote changes and apply them locally
   */
  async pullChanges(workspaceId: string, workspaceName: string): Promise<PullResult> {
    const syncState = this.syncStates.get(workspaceId);
    if (!syncState) {
      return { success: false, error: 'Workspace not linked to GitHub', pulledFiles: [] };
    }

    const { owner, repo, branch } = syncState;

    try {
      // Get status first to check for conflicts
      const status = await this.compareWithRemote(workspaceId, workspaceName);
      if (!status) {
        return { success: false, error: 'Failed to compare with remote', pulledFiles: [] };
      }

      if (status.conflicts.length > 0) {
        return {
          success: false,
          error: 'Conflicts detected - resolve them before pulling',
          pulledFiles: [],
          conflicts: status.conflicts,
        };
      }

      // Get remote files
      const remoteFiles = await this.getRemoteFiles(owner, repo, branch);
      const pulledFiles: string[] = [];

      // Apply remote changes
      for (const change of status.remoteChanges) {
        const remoteContent = remoteFiles.get(change.path);

        if (change.type === 'deleted') {
          // Delete local file
          if (change.path === 'workspace.json') {
            // Don't delete workspace.json, just skip
            continue;
          } else if (change.path.startsWith('collections/')) {
            const collectionName = change.path.replace('collections/', '').replace('.json', '');
            await fileStorageManager.deleteCollection(workspaceName, collectionName);
          }
        } else if (remoteContent) {
          // Create or update local file
          if (change.path === 'workspace.json') {
            const workspace = JSON.parse(remoteContent) as WorkspaceFile;
            await fileStorageManager.updateWorkspace(workspaceName, workspace);
          } else if (change.path.startsWith('collections/')) {
            const collectionName = change.path.replace('collections/', '').replace('.json', '');
            const collection = JSON.parse(remoteContent) as EchoFile;
            await fileStorageManager.writeCollection(workspaceName, collectionName, collection);
          }
        }

        pulledFiles.push(change.path);
      }

      // Update sync state
      const localFiles = await this.getWorkspaceFiles(workspaceName);
      const newHashes: Record<string, string> = {};
      for (const [path, content] of localFiles.entries()) {
        newHashes[path] = this.computeHash(content);
      }

      // Get current branch SHA
      const branchResult = await githubService.getBranch(owner, repo, branch);
      if (branchResult.success && branchResult.data) {
        syncState.lastSyncedSha = branchResult.data.commit.sha;
      }
      
      syncState.lastSyncedAt = Date.now();
      syncState.fileHashes = newHashes;

      await this.saveSyncState(syncState);

      return {
        success: true,
        pulledFiles,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        pulledFiles: [],
      };
    }
  }

  /**
   * Initialize sync state from remote (for first-time sync)
   * This records the current state as the baseline
   */
  async initializeSyncFromRemote(workspaceId: string, workspaceName: string): Promise<{ success: boolean; error?: string }> {
    const syncState = this.syncStates.get(workspaceId);
    if (!syncState) {
      return { success: false, error: 'Workspace not linked to GitHub' };
    }

    const { owner, repo, branch } = syncState;

    try {
      // Get current branch SHA
      const branchResult = await githubService.getBranch(owner, repo, branch);
      if (!branchResult.success || !branchResult.data) {
        return { success: false, error: 'Failed to get branch info' };
      }

      // Get current local files and compute hashes
      const localFiles = await this.getWorkspaceFiles(workspaceName);
      const fileHashes: Record<string, string> = {};
      for (const [path, content] of localFiles.entries()) {
        fileHashes[path] = this.computeHash(content);
      }

      // Update sync state
      syncState.lastSyncedSha = branchResult.data.commit.sha;
      syncState.lastSyncedAt = Date.now();
      syncState.fileHashes = fileHashes;

      await this.saveSyncState(syncState);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Initialize sync state from local (after initial push)
   */
  async initializeSyncFromLocal(workspaceId: string, workspaceName: string, sha: string): Promise<void> {
    const syncState = this.syncStates.get(workspaceId);
    if (!syncState) return;

    // Get current local files and compute hashes
    const localFiles = await this.getWorkspaceFiles(workspaceName);
    const fileHashes: Record<string, string> = {};
    for (const [path, content] of localFiles.entries()) {
      fileHashes[path] = this.computeHash(content);
    }

    // Update sync state
    syncState.lastSyncedSha = sha;
    syncState.lastSyncedAt = Date.now();
    syncState.fileHashes = fileHashes;

    await this.saveSyncState(syncState);
  }
}

export const githubSyncService = GitHubSyncService.getInstance();
export default githubSyncService;

