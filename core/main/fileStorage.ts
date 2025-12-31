/**
 * File Storage Manager for Main Process
 * 
 * Handles all file system operations for Echolon including:
 * - Reading/writing .echo collection files
 * - Managing workspace directories
 * - File watching for external changes
 * - Directory selection dialogs
 */

import { app, dialog, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import {
  EchoFile,
  EcholonConfig,
  GlobalEnvironmentsFile,
  WorkspaceFile,
  EcholonPaths,
  ECHO_FORMAT_VERSION,
  createDefaultConfig,
  createDefaultEnvironmentsFile,
  createDefaultWorkspaceFile,
} from '../shared/echoFormat';

// File watcher using native fs.watch (chokidar would be better but keeping deps minimal)
interface FileWatcher {
  path: string;
  watcher: fs.FSWatcher;
}

class FileStorageManager extends EventEmitter {
  private static instance: FileStorageManager;
  private watchers: Map<string, FileWatcher> = new Map();
  private echolonPath: string;
  private paths: EcholonPaths;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  private constructor() {
    super();
    // Default path - will be overridden by config if exists
    this.echolonPath = this.getDefaultEcholonPath();
    this.paths = this.getEcholonPaths(this.echolonPath);
  }

  static getInstance(): FileStorageManager {
    if (!FileStorageManager.instance) {
      FileStorageManager.instance = new FileStorageManager();
    }
    return FileStorageManager.instance;
  }

  /**
   * Get the default Echolon storage path
   */
  getDefaultEcholonPath(): string {
    const home = app.getPath('home');
    return path.join(home, 'Echolon');
  }

  /**
   * Get all Echolon paths from a root directory
   */
  getEcholonPaths(rootPath: string): EcholonPaths {
    return {
      root: rootPath,
      config: path.join(rootPath, 'config.json'),
      environments: path.join(rootPath, 'environments.json'),
      workspaces: path.join(rootPath, 'workspaces'),
    };
  }

  /**
   * Initialize the Echolon directory structure
   */
  async initialize(): Promise<{ success: boolean; error?: string }> {
    try {
      // Try to load existing config to get custom path
      if (fs.existsSync(this.paths.config)) {
        const configData = await this.readJsonFile<EcholonConfig>(this.paths.config);
        if (configData && configData.echolonPath && configData.echolonPath !== this.echolonPath) {
          this.echolonPath = configData.echolonPath;
          this.paths = this.getEcholonPaths(this.echolonPath);
        }
      }

      // Create directory structure if it doesn't exist
      await this.ensureDirectoryStructure();

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Ensure the basic directory structure exists
   */
  private async ensureDirectoryStructure(): Promise<void> {
    // Create root directory
    if (!fs.existsSync(this.paths.root)) {
      fs.mkdirSync(this.paths.root, { recursive: true });
    }

    // Create workspaces directory
    if (!fs.existsSync(this.paths.workspaces)) {
      fs.mkdirSync(this.paths.workspaces, { recursive: true });
    }

    // Create default config if it doesn't exist
    if (!fs.existsSync(this.paths.config)) {
      const defaultConfig = createDefaultConfig(this.echolonPath);
      await this.writeJsonFile(this.paths.config, defaultConfig);
    }

    // Create default environments file if it doesn't exist
    if (!fs.existsSync(this.paths.environments)) {
      const defaultEnvs = createDefaultEnvironmentsFile();
      await this.writeJsonFile(this.paths.environments, defaultEnvs);
    }

    // Create default workspace if none exists
    const workspaceDirs = this.getWorkspaceDirectories();
    if (workspaceDirs.length === 0) {
      await this.createWorkspace('Default Workspace', 'Your default workspace', '#6366f1');
    }
  }

  /**
   * Read a JSON file and parse it (async for parallel reads)
   */
  async readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Write a JSON file
   */
  async writeJsonFile<T>(filePath: string, data: T): Promise<boolean> {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    } catch (error) {
      console.error(`Error writing file ${filePath}:`, error);
      return false;
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(filePath: string): Promise<boolean> {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return true;
    } catch (error) {
      console.error(`Error deleting file ${filePath}:`, error);
      return false;
    }
  }

  /**
   * Delete a directory recursively
   */
  async deleteDirectory(dirPath: string): Promise<boolean> {
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
      return true;
    } catch (error) {
      console.error(`Error deleting directory ${dirPath}:`, error);
      return false;
    }
  }

  /**
   * Get the current Echolon path
   */
  getEcholonPath(): string {
    return this.echolonPath;
  }

  /**
   * Get the current paths configuration
   */
  getPaths(): EcholonPaths {
    return this.paths;
  }

  /**
   * Change the Echolon storage path
   */
  async setEcholonPath(newPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Create the new directory if it doesn't exist
      if (!fs.existsSync(newPath)) {
        fs.mkdirSync(newPath, { recursive: true });
      }

      // Update paths
      this.echolonPath = newPath;
      this.paths = this.getEcholonPaths(newPath);

      // Ensure directory structure
      await this.ensureDirectoryStructure();

      // Update config
      const config = await this.readJsonFile<EcholonConfig>(this.paths.config);
      if (config) {
        config.echolonPath = newPath;
        await this.writeJsonFile(this.paths.config, config);
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Show directory selection dialog
   */
  async selectDirectory(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Echolon Storage Directory',
      defaultPath: this.echolonPath,
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  }

  /**
   * Open the Echolon directory in the system file manager
   */
  async openInFileManager(): Promise<void> {
    await shell.openPath(this.echolonPath);
  }

  // ==================== Config Operations ====================

  /**
   * Read the global config
   */
  async readConfig(): Promise<EcholonConfig | null> {
    return this.readJsonFile<EcholonConfig>(this.paths.config);
  }

  /**
   * Write the global config
   */
  async writeConfig(config: EcholonConfig): Promise<boolean> {
    return this.writeJsonFile(this.paths.config, config);
  }

  /**
   * Update specific config fields
   */
  async updateConfig(updates: Partial<EcholonConfig>): Promise<boolean> {
    const config = await this.readConfig();
    if (!config) return false;
    const updated = { ...config, ...updates };
    return this.writeConfig(updated);
  }

  // ==================== Environments Operations ====================

  /**
   * Read global environments
   */
  async readEnvironments(): Promise<GlobalEnvironmentsFile | null> {
    return this.readJsonFile<GlobalEnvironmentsFile>(this.paths.environments);
  }

  /**
   * Write global environments
   */
  async writeEnvironments(environments: GlobalEnvironmentsFile): Promise<boolean> {
    return this.writeJsonFile(this.paths.environments, environments);
  }

  // ==================== Data File Operations ====================
  // Generic data files for app state (pending changes, mocks, etc.)

  /**
   * Get the path for a data file in the Echolon directory
   * Only allows safe filenames (alphanumeric, dashes, underscores, .json extension)
   */
  private getDataFilePath(filename: string): string | null {
    // Validate filename to prevent path traversal
    const safeFilename = filename.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeFilename || safeFilename !== filename.replace(/\.json$/, '')) {
      console.error('Invalid data filename:', filename);
      return null;
    }
    return path.join(this.echolonPath, `${safeFilename}.json`);
  }

  /**
   * Read a generic data file from the Echolon directory
   */
  async readDataFile<T>(filename: string): Promise<T | null> {
    const filePath = this.getDataFilePath(filename);
    if (!filePath) return null;
    return this.readJsonFile<T>(filePath);
  }

  /**
   * Write a generic data file to the Echolon directory
   */
  async writeDataFile<T>(filename: string, data: T): Promise<boolean> {
    const filePath = this.getDataFilePath(filename);
    if (!filePath) return false;
    return this.writeJsonFile(filePath, data);
  }

  // ==================== Workspace Operations ====================

  /**
   * Get list of workspace directories
   */
  getWorkspaceDirectories(): string[] {
    try {
      if (!fs.existsSync(this.paths.workspaces)) {
        return [];
      }
      return fs.readdirSync(this.paths.workspaces, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
    } catch (error) {
      console.error('Error reading workspace directories:', error);
      return [];
    }
  }

  /**
   * Get the path to a workspace directory
   */
  getWorkspacePath(workspaceName: string): string {
    return path.join(this.paths.workspaces, workspaceName);
  }

  /**
   * Get the path to a workspace's workspace.json file
   */
  getWorkspaceFilePath(workspaceName: string): string {
    return path.join(this.getWorkspacePath(workspaceName), 'workspace.json');
  }

  /**
   * Get the path to a workspace's collections directory
   */
  getCollectionsPath(workspaceName: string): string {
    return path.join(this.getWorkspacePath(workspaceName), 'collections');
  }

  /**
   * Create a new workspace
   */
  async createWorkspace(
    name: string,
    description?: string,
    color?: string
  ): Promise<{ success: boolean; workspace?: WorkspaceFile; error?: string }> {
    try {
      const id = this.generateId();
      const workspacePath = this.getWorkspacePath(name);
      const collectionsPath = this.getCollectionsPath(name);

      // Create directories
      fs.mkdirSync(workspacePath, { recursive: true });
      fs.mkdirSync(collectionsPath, { recursive: true });

      // Create workspace.json
      const workspaceFile = createDefaultWorkspaceFile(id, name, description, color);
      await this.writeJsonFile(this.getWorkspaceFilePath(name), workspaceFile);

      return { success: true, workspace: workspaceFile };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Read a workspace's metadata
   */
  async readWorkspace(workspaceName: string): Promise<WorkspaceFile | null> {
    return this.readJsonFile<WorkspaceFile>(this.getWorkspaceFilePath(workspaceName));
  }

  /**
   * Update a workspace's metadata
   */
  async updateWorkspace(workspaceName: string, updates: Partial<WorkspaceFile>): Promise<boolean> {
    const workspace = await this.readWorkspace(workspaceName);
    if (!workspace) return false;
    const updated = { ...workspace, ...updates, updatedAt: new Date().toISOString() };
    return this.writeJsonFile(this.getWorkspaceFilePath(workspaceName), updated);
  }

  /**
   * Rename a workspace (directory rename)
   */
  async renameWorkspace(oldName: string, newName: string): Promise<boolean> {
    try {
      const oldPath = this.getWorkspacePath(oldName);
      const newPath = this.getWorkspacePath(newName);
      
      if (!fs.existsSync(oldPath)) return false;
      if (fs.existsSync(newPath)) return false; // Can't rename to existing name
      
      fs.renameSync(oldPath, newPath);
      
      // Update workspace.json name
      await this.updateWorkspace(newName, { name: newName });
      
      return true;
    } catch (error) {
      console.error('Error renaming workspace:', error);
      return false;
    }
  }

  /**
   * Delete a workspace
   */
  async deleteWorkspace(workspaceName: string): Promise<boolean> {
    return this.deleteDirectory(this.getWorkspacePath(workspaceName));
  }

  /**
   * Get all workspaces with their metadata (parallel reads)
   */
  async getAllWorkspaces(): Promise<WorkspaceFile[]> {
    const workspaceNames = this.getWorkspaceDirectories();
    const workspaces = await Promise.all(
      workspaceNames.map(name => this.readWorkspace(name))
    );
    return workspaces.filter((w): w is WorkspaceFile => w !== null);
  }

  // ==================== Collection Operations ====================

  /**
   * Get list of collection files in a workspace
   */
  getCollectionFiles(workspaceName: string): string[] {
    try {
      const collectionsPath = this.getCollectionsPath(workspaceName);
      if (!fs.existsSync(collectionsPath)) {
        return [];
      }
      return fs.readdirSync(collectionsPath)
        .filter(file => file.endsWith('.json'))
        .map(file => file.replace('.json', ''));
    } catch (error) {
      console.error('Error reading collection files:', error);
      return [];
    }
  }

  /**
   * Get the path to a collection file
   */
  getCollectionFilePath(workspaceName: string, collectionName: string): string {
    return path.join(this.getCollectionsPath(workspaceName), `${collectionName}.json`);
  }

  /**
   * Read a collection file
   */
  async readCollection(workspaceName: string, collectionName: string): Promise<EchoFile | null> {
    return this.readJsonFile<EchoFile>(this.getCollectionFilePath(workspaceName, collectionName));
  }

  /**
   * Write a collection file
   */
  async writeCollection(workspaceName: string, collectionName: string, collection: EchoFile): Promise<boolean> {
    // Update modified date
    collection.metadata.modifiedAt = new Date().toISOString();
    return this.writeJsonFile(this.getCollectionFilePath(workspaceName, collectionName), collection);
  }

  /**
   * Delete a collection file
   */
  async deleteCollection(workspaceName: string, collectionName: string): Promise<boolean> {
    return this.deleteFile(this.getCollectionFilePath(workspaceName, collectionName));
  }

  /**
   * Rename a collection (file rename)
   */
  async renameCollection(workspaceName: string, oldName: string, newName: string): Promise<boolean> {
    try {
      const oldPath = this.getCollectionFilePath(workspaceName, oldName);
      const newPath = this.getCollectionFilePath(workspaceName, newName);
      
      if (!fs.existsSync(oldPath)) return false;
      if (fs.existsSync(newPath)) return false;
      
      // Read, update name, and write to new location
      const collection = await this.readCollection(workspaceName, oldName);
      if (!collection) return false;
      
      collection.metadata.name = newName;
      await this.writeCollection(workspaceName, newName, collection);
      await this.deleteFile(oldPath);
      
      return true;
    } catch (error) {
      console.error('Error renaming collection:', error);
      return false;
    }
  }

  /**
   * Get all collections in a workspace (parallel reads)
   */
  async getAllCollections(workspaceName: string): Promise<EchoFile[]> {
    const collectionNames = this.getCollectionFiles(workspaceName);
    const collections = await Promise.all(
      collectionNames.map(name => this.readCollection(workspaceName, name))
    );
    return collections.filter((c): c is EchoFile => c !== null);
  }

  /**
   * Get all collections across all workspaces (parallel reads)
   */
  async getAllCollectionsAllWorkspaces(): Promise<{ workspace: string; collections: EchoFile[] }[]> {
    const workspaceNames = this.getWorkspaceDirectories();
    const results = await Promise.all(
      workspaceNames.map(async name => ({
        workspace: name,
        collections: await this.getAllCollections(name),
      }))
    );
    return results;
  }

  // ==================== Mocking Data Operations ====================

  /**
   * Get the path to a workspace's mocking directory
   */
  getMockingPath(workspaceName: string): string {
    return path.join(this.getWorkspacePath(workspaceName), 'mocking');
  }

  /**
   * Get the path to a mock API's directory
   */
  getMockApiPath(workspaceName: string, mockApiName: string): string {
    const safeName = this.sanitizeFilename(mockApiName);
    return path.join(this.getMockingPath(workspaceName), safeName);
  }

  /**
   * Get the path to an endpoint's directory within a mock API
   */
  getMockEndpointPath(workspaceName: string, mockApiName: string, endpoint: string): string {
    // Sanitize endpoint path: /api/users/:id -> api-users-_id
    const safeEndpoint = endpoint
      .replace(/^\//, '')           // Remove leading slash
      .replace(/\//g, '-')          // Replace slashes with dashes
      .replace(/:/g, '_')           // Replace colons with underscores
      .replace(/[<>:"/\\|?*]/g, '') // Remove other invalid chars
      || 'root';                    // Default for empty path
    return path.join(this.getMockApiPath(workspaceName, mockApiName), safeEndpoint);
  }

  /**
   * Get the path to the requests file for an endpoint
   */
  getMockRequestsFilePath(workspaceName: string, mockApiName: string, endpoint: string): string {
    return path.join(this.getMockEndpointPath(workspaceName, mockApiName, endpoint), 'requests.json');
  }

  /**
   * Read captured requests for a specific endpoint
   */
  async readMockRequests<T>(workspaceName: string, mockApiName: string, endpoint: string): Promise<T | null> {
    const filePath = this.getMockRequestsFilePath(workspaceName, mockApiName, endpoint);
    return this.readJsonFile<T>(filePath);
  }

  /**
   * Write captured requests for a specific endpoint
   */
  async writeMockRequests<T>(workspaceName: string, mockApiName: string, endpoint: string, data: T): Promise<boolean> {
    const filePath = this.getMockRequestsFilePath(workspaceName, mockApiName, endpoint);
    return this.writeJsonFile(filePath, data);
  }

  /**
   * Read all captured requests for a mock API
   */
  async readAllMockRequests<T>(workspaceName: string, mockApiName: string): Promise<{ endpoint: string; requests: T }[]> {
    const mockApiPath = this.getMockApiPath(workspaceName, mockApiName);
    
    if (!fs.existsSync(mockApiPath)) {
      return [];
    }

    try {
      const endpoints = fs.readdirSync(mockApiPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      const results = await Promise.all(
        endpoints.map(async (endpointDir) => {
          const requestsPath = path.join(mockApiPath, endpointDir, 'requests.json');
          const requests = await this.readJsonFile<T>(requestsPath);
          // Convert sanitized directory name back to endpoint path
          const endpoint = '/' + endpointDir.replace(/-/g, '/').replace(/_/g, ':');
          return { endpoint, requests };
        })
      );

      return results.filter((r): r is { endpoint: string; requests: T } => r.requests !== null);
    } catch (error) {
      console.error('Error reading all mock requests:', error);
      return [];
    }
  }

  /**
   * Read all captured requests across all mock APIs in a workspace
   */
  async readAllMockingData<T>(workspaceName: string): Promise<{ mockApiName: string; endpoint: string; requests: T }[]> {
    const mockingPath = this.getMockingPath(workspaceName);
    
    if (!fs.existsSync(mockingPath)) {
      return [];
    }

    try {
      const mockApis = fs.readdirSync(mockingPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      const allResults: { mockApiName: string; endpoint: string; requests: T }[] = [];

      for (const mockApiName of mockApis) {
        const endpointData = await this.readAllMockRequests<T>(workspaceName, mockApiName);
        for (const { endpoint, requests } of endpointData) {
          allResults.push({ mockApiName, endpoint, requests });
        }
      }

      return allResults;
    } catch (error) {
      console.error('Error reading all mocking data:', error);
      return [];
    }
  }

  /**
   * Delete a mock API's mocking data directory
   */
  async deleteMockApiData(workspaceName: string, mockApiName: string): Promise<boolean> {
    return this.deleteDirectory(this.getMockApiPath(workspaceName, mockApiName));
  }

  /**
   * Delete an endpoint's mocking data
   */
  async deleteMockEndpointData(workspaceName: string, mockApiName: string, endpoint: string): Promise<boolean> {
    return this.deleteDirectory(this.getMockEndpointPath(workspaceName, mockApiName, endpoint));
  }

  /**
   * Clear all mocking data for a workspace
   */
  async clearMockingData(workspaceName: string): Promise<boolean> {
    return this.deleteDirectory(this.getMockingPath(workspaceName));
  }

  // ==================== File Watching ====================

  /**
   * Start watching a directory for changes
   */
  watchDirectory(dirPath: string, callback: (event: string, filename: string | null) => void): void {
    if (this.watchers.has(dirPath)) {
      return; // Already watching
    }

    try {
      const watcher = fs.watch(dirPath, { recursive: true }, (event, filename) => {
        // Debounce to avoid multiple rapid events
        const key = `${dirPath}:${filename}`;
        if (this.debounceTimers.has(key)) {
          clearTimeout(this.debounceTimers.get(key)!);
        }
        
        this.debounceTimers.set(key, setTimeout(() => {
          callback(event, filename);
          this.debounceTimers.delete(key);
        }, 100));
      });

      this.watchers.set(dirPath, { path: dirPath, watcher });
    } catch (error) {
      console.error(`Error watching directory ${dirPath}:`, error);
    }
  }

  /**
   * Stop watching a directory
   */
  unwatchDirectory(dirPath: string): void {
    const watcher = this.watchers.get(dirPath);
    if (watcher) {
      watcher.watcher.close();
      this.watchers.delete(dirPath);
    }
  }

  /**
   * Stop all file watchers
   */
  unwatchAll(): void {
    for (const [path, watcher] of this.watchers) {
      watcher.watcher.close();
      this.watchers.delete(path);
    }
    
    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  // ==================== Utilities ====================

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Sanitize a name for use as a filename
   */
  sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
      .replace(/\s+/g, ' ')          // Normalize whitespace
      .trim()
      .substring(0, 255);            // Limit length
  }

  /**
   * Check if a path exists
   */
  exists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  /**
   * Check if the Echolon directory is initialized
   */
  isInitialized(): boolean {
    return fs.existsSync(this.paths.config) && fs.existsSync(this.paths.workspaces);
  }
}

export const fileStorageManager = FileStorageManager.getInstance();
export default fileStorageManager;

