/**
 * Web File System Manager for Web Mode
 * 
 * Provides file system operations using the Web File System API.
 * This allows the web version of Echolon to persist data to the local file system.
 */

import {
  EchoFile,
  EcholonConfig,
  GlobalEnvironmentsFile,
  WorkspaceFile,
  ECHO_FORMAT_VERSION,
  createDefaultConfig,
  createDefaultEnvironmentsFile,
  createDefaultWorkspaceFile,
} from '../../shared/echoFormat';

// IndexedDB database name for storing the directory handle
const IDB_NAME = 'echolon-web-storage';
const IDB_STORE = 'handles';
const IDB_KEY = 'root-directory';

// Storage key for tracking if storage has been set up
const STORAGE_ENABLED_KEY = 'echolon_web_fs_enabled';

/**
 * Simple IndexedDB wrapper for storing the FileSystemDirectoryHandle
 */
class HandleStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(IDB_NAME, 1);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE);
          }
        };
      });
    }
    return this.dbPromise;
  }

  async get<T>(key: string): Promise<T | null> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(IDB_STORE, 'readonly');
      const store = transaction.objectStore(IDB_STORE);
      const request = store.get(key);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result ?? null);
    });
  }

  async set<T>(key: string, value: T): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(IDB_STORE, 'readwrite');
      const store = transaction.objectStore(IDB_STORE);
      const request = store.put(value, key);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async delete(key: string): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(IDB_STORE, 'readwrite');
      const store = transaction.objectStore(IDB_STORE);
      const request = store.delete(key);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}

class WebFileSystemManager {
  private static instance: WebFileSystemManager;
  private handleStore: HandleStore;
  private rootHandle: FileSystemDirectoryHandle | null = null;
  private initialized = false;
  private directoryName: string = '';

  private constructor() {
    this.handleStore = new HandleStore();
  }

  static getInstance(): WebFileSystemManager {
    if (!WebFileSystemManager.instance) {
      WebFileSystemManager.instance = new WebFileSystemManager();
    }
    return WebFileSystemManager.instance;
  }

  /**
   * Check if the Web File System API is supported
   */
  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  /**
   * Check if file storage has been enabled
   */
  isStorageEnabled(): boolean {
    return localStorage.getItem(STORAGE_ENABLED_KEY) === 'true';
  }

  /**
   * Check if the manager has a valid directory handle
   */
  hasDirectoryAccess(): boolean {
    return this.rootHandle !== null;
  }

  /**
   * Get the current directory name
   */
  getDirectoryName(): string {
    return this.directoryName;
  }

  /**
   * Verify and request permission for the stored directory handle
   */
  async verifyPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
    try {
      // Check current permission state
      const options: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' };
      
      // @ts-ignore - queryPermission exists but TypeScript doesn't know about it
      let permission = await handle.queryPermission(options);
      
      if (permission === 'granted') {
        return true;
      }
      
      // Request permission if not granted
      // @ts-ignore - requestPermission exists but TypeScript doesn't know about it
      permission = await handle.requestPermission(options);
      return permission === 'granted';
    } catch (error) {
      console.error('[WebFS] Permission verification failed:', error);
      return false;
    }
  }

  /**
   * Request directory access from the user
   */
  async requestDirectoryAccess(): Promise<{ success: boolean; error?: string }> {
    if (!WebFileSystemManager.isSupported()) {
      return { success: false, error: 'Web File System API is not supported in this browser' };
    }

    try {
      // Show directory picker
      const handle = await window.showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'documents',
      });

      // Store the handle in IndexedDB
      await this.handleStore.set(IDB_KEY, handle);
      
      this.rootHandle = handle;
      this.directoryName = handle.name;
      
      // Mark storage as enabled
      localStorage.setItem(STORAGE_ENABLED_KEY, 'true');
      
      // Initialize the directory structure
      await this.ensureDirectoryStructure();
      
      this.initialized = true;
      
      return { success: true };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'Directory selection was cancelled' };
      }
      const message = error instanceof Error ? error.message : 'Failed to access directory';
      return { success: false, error: message };
    }
  }

  /**
   * Initialize the file system manager
   * Attempts to restore the previously selected directory
   */
  async initialize(): Promise<{ success: boolean; error?: string }> {
    if (this.initialized && this.rootHandle) {
      return { success: true };
    }

    if (!WebFileSystemManager.isSupported()) {
      console.log('[WebFS] Web File System API not supported');
      return { success: false, error: 'Web File System API is not supported' };
    }

    try {
      // Try to restore the directory handle from IndexedDB
      const storedHandle = await this.handleStore.get<FileSystemDirectoryHandle>(IDB_KEY);
      
      if (!storedHandle) {
        // No stored handle - storage not yet enabled
        return { success: false, error: 'No directory selected' };
      }

      // Verify we still have permission
      const hasPermission = await this.verifyPermission(storedHandle);
      
      if (!hasPermission) {
        // Permission was revoked or denied
        localStorage.removeItem(STORAGE_ENABLED_KEY);
        return { success: false, error: 'Permission denied. Please re-enable storage.' };
      }

      this.rootHandle = storedHandle;
      this.directoryName = storedHandle.name;
      
      // Ensure directory structure exists
      await this.ensureDirectoryStructure();
      
      this.initialized = true;
      localStorage.setItem(STORAGE_ENABLED_KEY, 'true');
      
      return { success: true };
    } catch (error) {
      console.error('[WebFS] Initialization failed:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Disconnect from the file system
   */
  async disconnect(): Promise<void> {
    this.rootHandle = null;
    this.initialized = false;
    this.directoryName = '';
    localStorage.removeItem(STORAGE_ENABLED_KEY);
    await this.handleStore.delete(IDB_KEY);
  }

  /**
   * Ensure the basic directory structure exists
   */
  private async ensureDirectoryStructure(): Promise<void> {
    if (!this.rootHandle) {
      throw new Error('No directory handle available');
    }

    // Create workspaces directory
    await this.rootHandle.getDirectoryHandle('workspaces', { create: true });

    // Create default config if it doesn't exist
    if (!(await this.fileExists('config.json'))) {
      const defaultConfig = createDefaultConfig(this.directoryName);
      await this.writeJsonFile('config.json', defaultConfig);
    }

    // Create default environments file if it doesn't exist
    if (!(await this.fileExists('environments.json'))) {
      const defaultEnvs = createDefaultEnvironmentsFile();
      await this.writeJsonFile('environments.json', defaultEnvs);
    }

    // Create default workspace if none exists
    const workspaceDirs = await this.getWorkspaceDirectories();
    if (workspaceDirs.length === 0) {
      await this.createWorkspace('Default Workspace', 'Your default workspace', '#6366f1');
    }
  }

  /**
   * Check if a file exists in the root directory
   */
  private async fileExists(filename: string): Promise<boolean> {
    if (!this.rootHandle) return false;
    
    try {
      await this.rootHandle.getFileHandle(filename);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read a JSON file from the root directory
   */
  private async readJsonFile<T>(filename: string): Promise<T | null> {
    if (!this.rootHandle) return null;
    
    try {
      const fileHandle = await this.rootHandle.getFileHandle(filename);
      const file = await fileHandle.getFile();
      const content = await file.text();
      return JSON.parse(content) as T;
    } catch (error) {
      console.error(`[WebFS] Error reading file ${filename}:`, error);
      return null;
    }
  }

  /**
   * Write a JSON file to the root directory
   */
  private async writeJsonFile<T>(filename: string, data: T): Promise<boolean> {
    if (!this.rootHandle) return false;
    
    try {
      const fileHandle = await this.rootHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(data, null, 2));
      await writable.close();
      return true;
    } catch (error) {
      console.error(`[WebFS] Error writing file ${filename}:`, error);
      return false;
    }
  }

  /**
   * Read a JSON file from a directory handle
   */
  private async readJsonFileFromDir<T>(dirHandle: FileSystemDirectoryHandle, filename: string): Promise<T | null> {
    try {
      const fileHandle = await dirHandle.getFileHandle(filename);
      const file = await fileHandle.getFile();
      const content = await file.text();
      return JSON.parse(content) as T;
    } catch (error) {
      return null;
    }
  }

  /**
   * Write a JSON file to a directory handle
   */
  private async writeJsonFileToDir<T>(dirHandle: FileSystemDirectoryHandle, filename: string, data: T): Promise<boolean> {
    try {
      const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(data, null, 2));
      await writable.close();
      return true;
    } catch (error) {
      console.error(`[WebFS] Error writing file ${filename}:`, error);
      return false;
    }
  }

  /**
   * Delete a file from a directory
   */
  private async deleteFileFromDir(dirHandle: FileSystemDirectoryHandle, filename: string): Promise<boolean> {
    try {
      await dirHandle.removeEntry(filename);
      return true;
    } catch (error) {
      console.error(`[WebFS] Error deleting file ${filename}:`, error);
      return false;
    }
  }

  /**
   * Delete a directory recursively
   */
  private async deleteDirectory(parentHandle: FileSystemDirectoryHandle, dirName: string): Promise<boolean> {
    try {
      await parentHandle.removeEntry(dirName, { recursive: true });
      return true;
    } catch (error) {
      console.error(`[WebFS] Error deleting directory ${dirName}:`, error);
      return false;
    }
  }

  // ==================== Config Operations ====================

  /**
   * Read the global config
   */
  async readConfig(): Promise<EcholonConfig | null> {
    return this.readJsonFile<EcholonConfig>('config.json');
  }

  /**
   * Write the global config
   */
  async writeConfig(config: EcholonConfig): Promise<boolean> {
    return this.writeJsonFile('config.json', config);
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
    return this.readJsonFile<GlobalEnvironmentsFile>('environments.json');
  }

  /**
   * Write global environments
   */
  async writeEnvironments(environments: GlobalEnvironmentsFile): Promise<boolean> {
    return this.writeJsonFile('environments.json', environments);
  }

  // ==================== Workspace Operations ====================

  /**
   * Get list of workspace directories
   */
  async getWorkspaceDirectories(): Promise<string[]> {
    if (!this.rootHandle) return [];
    
    try {
      const workspacesHandle = await this.rootHandle.getDirectoryHandle('workspaces');
      const directories: string[] = [];
      
      for await (const entry of workspacesHandle.values()) {
        if (entry.kind === 'directory') {
          directories.push(entry.name);
        }
      }
      
      return directories;
    } catch (error) {
      console.error('[WebFS] Error reading workspace directories:', error);
      return [];
    }
  }

  /**
   * Get a workspace directory handle
   */
  private async getWorkspaceHandle(workspaceName: string): Promise<FileSystemDirectoryHandle | null> {
    if (!this.rootHandle) return null;
    
    try {
      const workspacesHandle = await this.rootHandle.getDirectoryHandle('workspaces');
      return await workspacesHandle.getDirectoryHandle(workspaceName);
    } catch {
      return null;
    }
  }

  /**
   * Create a new workspace
   */
  async createWorkspace(
    name: string,
    description?: string,
    color?: string
  ): Promise<{ success: boolean; workspace?: WorkspaceFile; error?: string }> {
    if (!this.rootHandle) {
      return { success: false, error: 'No directory access' };
    }

    try {
      const id = this.generateId();
      const workspacesHandle = await this.rootHandle.getDirectoryHandle('workspaces', { create: true });
      const workspaceHandle = await workspacesHandle.getDirectoryHandle(name, { create: true });
      
      // Create collections directory
      await workspaceHandle.getDirectoryHandle('collections', { create: true });

      // Create workspace.json
      const workspaceFile = createDefaultWorkspaceFile(id, name, description, color);
      await this.writeJsonFileToDir(workspaceHandle, 'workspace.json', workspaceFile);

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
    const workspaceHandle = await this.getWorkspaceHandle(workspaceName);
    if (!workspaceHandle) return null;
    
    return this.readJsonFileFromDir<WorkspaceFile>(workspaceHandle, 'workspace.json');
  }

  /**
   * Update a workspace's metadata
   */
  async updateWorkspace(workspaceName: string, updates: Partial<WorkspaceFile>): Promise<boolean> {
    const workspaceHandle = await this.getWorkspaceHandle(workspaceName);
    if (!workspaceHandle) return false;

    const workspace = await this.readJsonFileFromDir<WorkspaceFile>(workspaceHandle, 'workspace.json');
    if (!workspace) return false;

    const updated = { ...workspace, ...updates, updatedAt: new Date().toISOString() };
    return this.writeJsonFileToDir(workspaceHandle, 'workspace.json', updated);
  }

  /**
   * Rename a workspace (directory rename)
   */
  async renameWorkspace(oldName: string, newName: string): Promise<boolean> {
    if (!this.rootHandle) return false;

    try {
      const workspacesHandle = await this.rootHandle.getDirectoryHandle('workspaces');
      
      // Read old workspace data
      const oldHandle = await workspacesHandle.getDirectoryHandle(oldName);
      const workspaceData = await this.readJsonFileFromDir<WorkspaceFile>(oldHandle, 'workspace.json');
      
      if (!workspaceData) return false;

      // Create new workspace with updated name
      const newHandle = await workspacesHandle.getDirectoryHandle(newName, { create: true });
      const collectionsHandle = await newHandle.getDirectoryHandle('collections', { create: true });
      
      // Update workspace name and write to new location
      workspaceData.name = newName;
      workspaceData.updatedAt = new Date().toISOString();
      await this.writeJsonFileToDir(newHandle, 'workspace.json', workspaceData);

      // Copy collections
      const oldCollectionsHandle = await oldHandle.getDirectoryHandle('collections');
      for await (const entry of oldCollectionsHandle.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.json')) {
          const fileHandle = entry as FileSystemFileHandle;
          const file = await fileHandle.getFile();
          const content = await file.text();
          const data = JSON.parse(content);
          await this.writeJsonFileToDir(collectionsHandle, entry.name, data);
        }
      }

      // Delete old workspace
      await workspacesHandle.removeEntry(oldName, { recursive: true });

      return true;
    } catch (error) {
      console.error('[WebFS] Error renaming workspace:', error);
      return false;
    }
  }

  /**
   * Delete a workspace
   */
  async deleteWorkspace(workspaceName: string): Promise<boolean> {
    if (!this.rootHandle) return false;

    try {
      const workspacesHandle = await this.rootHandle.getDirectoryHandle('workspaces');
      return this.deleteDirectory(workspacesHandle, workspaceName);
    } catch (error) {
      console.error('[WebFS] Error deleting workspace:', error);
      return false;
    }
  }

  /**
   * Get all workspaces with their metadata
   */
  async getAllWorkspaces(): Promise<WorkspaceFile[]> {
    const workspaceNames = await this.getWorkspaceDirectories();
    const workspaces: WorkspaceFile[] = [];

    for (const name of workspaceNames) {
      const workspace = await this.readWorkspace(name);
      if (workspace) {
        workspaces.push(workspace);
      }
    }

    return workspaces;
  }

  // ==================== Collection Operations ====================

  /**
   * Get the collections directory handle for a workspace
   */
  private async getCollectionsHandle(workspaceName: string): Promise<FileSystemDirectoryHandle | null> {
    const workspaceHandle = await this.getWorkspaceHandle(workspaceName);
    if (!workspaceHandle) return null;

    try {
      return await workspaceHandle.getDirectoryHandle('collections', { create: true });
    } catch {
      return null;
    }
  }

  /**
   * Get list of collection files in a workspace
   */
  async getCollectionFiles(workspaceName: string): Promise<string[]> {
    const collectionsHandle = await this.getCollectionsHandle(workspaceName);
    if (!collectionsHandle) return [];

    const files: string[] = [];
    
    for await (const entry of collectionsHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.json')) {
        files.push(entry.name.replace('.json', ''));
      }
    }

    return files;
  }

  /**
   * Read a collection file
   */
  async readCollection(workspaceName: string, collectionName: string): Promise<EchoFile | null> {
    const collectionsHandle = await this.getCollectionsHandle(workspaceName);
    if (!collectionsHandle) return null;

    return this.readJsonFileFromDir<EchoFile>(collectionsHandle, `${collectionName}.json`);
  }

  /**
   * Write a collection file
   */
  async writeCollection(workspaceName: string, collectionName: string, collection: EchoFile): Promise<boolean> {
    const collectionsHandle = await this.getCollectionsHandle(workspaceName);
    if (!collectionsHandle) return false;

    // Update modified date
    collection.metadata.modifiedAt = new Date().toISOString();
    return this.writeJsonFileToDir(collectionsHandle, `${collectionName}.json`, collection);
  }

  /**
   * Delete a collection file
   */
  async deleteCollection(workspaceName: string, collectionName: string): Promise<boolean> {
    const collectionsHandle = await this.getCollectionsHandle(workspaceName);
    if (!collectionsHandle) return false;

    return this.deleteFileFromDir(collectionsHandle, `${collectionName}.json`);
  }

  /**
   * Rename a collection
   */
  async renameCollection(workspaceName: string, oldName: string, newName: string): Promise<boolean> {
    const collectionsHandle = await this.getCollectionsHandle(workspaceName);
    if (!collectionsHandle) return false;

    try {
      // Read old collection
      const collection = await this.readJsonFileFromDir<EchoFile>(collectionsHandle, `${oldName}.json`);
      if (!collection) return false;

      // Update name and write to new file
      collection.metadata.name = newName;
      collection.metadata.modifiedAt = new Date().toISOString();
      await this.writeJsonFileToDir(collectionsHandle, `${newName}.json`, collection);

      // Delete old file
      await this.deleteFileFromDir(collectionsHandle, `${oldName}.json`);

      return true;
    } catch (error) {
      console.error('[WebFS] Error renaming collection:', error);
      return false;
    }
  }

  /**
   * Get all collections in a workspace
   */
  async getAllCollections(workspaceName: string): Promise<EchoFile[]> {
    const collectionNames = await this.getCollectionFiles(workspaceName);
    const collections: EchoFile[] = [];

    for (const name of collectionNames) {
      const collection = await this.readCollection(workspaceName, name);
      if (collection) {
        collections.push(collection);
      }
    }

    return collections;
  }

  /**
   * Get all collections across all workspaces
   */
  async getAllCollectionsAllWorkspaces(): Promise<{ workspace: string; collections: EchoFile[] }[]> {
    const workspaceNames = await this.getWorkspaceDirectories();
    const results: { workspace: string; collections: EchoFile[] }[] = [];

    for (const name of workspaceNames) {
      const collections = await this.getAllCollections(name);
      results.push({ workspace: name, collections });
    }

    return results;
  }

  // ==================== Request History Operations ====================

  /**
   * Get the history directory handle for a workspace
   */
  private async getHistoryHandle(workspaceName: string): Promise<FileSystemDirectoryHandle | null> {
    const workspaceHandle = await this.getWorkspaceHandle(workspaceName);
    if (!workspaceHandle) return null;

    try {
      return await workspaceHandle.getDirectoryHandle('history', { create: true });
    } catch {
      return null;
    }
  }

  /**
   * Read request history from disk for a workspace
   */
  async readHistory<T>(workspaceName: string): Promise<T | null> {
    const historyHandle = await this.getHistoryHandle(workspaceName);
    if (!historyHandle) return null;

    return this.readJsonFileFromDir<T>(historyHandle, 'history.json');
  }

  /**
   * Write request history to disk for a workspace
   */
  async writeHistory<T>(workspaceName: string, data: T): Promise<boolean> {
    const historyHandle = await this.getHistoryHandle(workspaceName);
    if (!historyHandle) return false;

    return this.writeJsonFileToDir(historyHandle, 'history.json', data);
  }

  /**
   * Clear history for a workspace
   */
  async clearHistory(workspaceName: string): Promise<boolean> {
    const historyHandle = await this.getHistoryHandle(workspaceName);
    if (!historyHandle) return false;

    try {
      return this.deleteFileFromDir(historyHandle, 'history.json');
    } catch {
      return true; // File might not exist
    }
  }

  // ==================== Data File Operations ====================

  /**
   * Read a generic data file from the root directory
   */
  async readDataFile<T>(filename: string): Promise<T | null> {
    // Sanitize filename
    const safeFilename = filename.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeFilename) return null;
    
    return this.readJsonFile<T>(`${safeFilename}.json`);
  }

  /**
   * Write a generic data file to the root directory
   */
  async writeDataFile<T>(filename: string, data: T): Promise<boolean> {
    // Sanitize filename
    const safeFilename = filename.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeFilename) return false;
    
    return this.writeJsonFile(`${safeFilename}.json`, data);
  }

  // ==================== Mocking Data Operations ====================

  /**
   * Get the mocking directory handle for a workspace
   */
  private async getMockingHandle(workspaceName: string): Promise<FileSystemDirectoryHandle | null> {
    const workspaceHandle = await this.getWorkspaceHandle(workspaceName);
    if (!workspaceHandle) return null;

    try {
      return await workspaceHandle.getDirectoryHandle('mocking', { create: true });
    } catch {
      return null;
    }
  }

  /**
   * Sanitize endpoint path for use as directory name
   */
  private sanitizeEndpointPath(endpoint: string): string {
    return endpoint
      .replace(/^\//, '')
      .replace(/\//g, '-')
      .replace(/:/g, '_')
      .replace(/[<>:"/\\|?*]/g, '')
      || 'root';
  }

  /**
   * Read captured requests for a specific endpoint
   */
  async readMockRequests<T>(workspaceName: string, mockApiName: string, endpoint: string): Promise<T | null> {
    const mockingHandle = await this.getMockingHandle(workspaceName);
    if (!mockingHandle) return null;

    try {
      const safeMockName = this.sanitizeFilename(mockApiName);
      const safeEndpoint = this.sanitizeEndpointPath(endpoint);
      
      const apiHandle = await mockingHandle.getDirectoryHandle(safeMockName);
      const endpointHandle = await apiHandle.getDirectoryHandle(safeEndpoint);
      
      return this.readJsonFileFromDir<T>(endpointHandle, 'requests.json');
    } catch {
      return null;
    }
  }

  /**
   * Write captured requests for a specific endpoint
   */
  async writeMockRequests<T>(workspaceName: string, mockApiName: string, endpoint: string, data: T): Promise<boolean> {
    const mockingHandle = await this.getMockingHandle(workspaceName);
    if (!mockingHandle) return false;

    try {
      const safeMockName = this.sanitizeFilename(mockApiName);
      const safeEndpoint = this.sanitizeEndpointPath(endpoint);
      
      const apiHandle = await mockingHandle.getDirectoryHandle(safeMockName, { create: true });
      const endpointHandle = await apiHandle.getDirectoryHandle(safeEndpoint, { create: true });
      
      return this.writeJsonFileToDir(endpointHandle, 'requests.json', data);
    } catch (error) {
      console.error('[WebFS] Error writing mock requests:', error);
      return false;
    }
  }

  /**
   * Read all captured requests for a mock API
   */
  async readAllMockRequests<T>(workspaceName: string, mockApiName: string): Promise<{ endpoint: string; requests: T }[]> {
    const mockingHandle = await this.getMockingHandle(workspaceName);
    if (!mockingHandle) return [];

    try {
      const safeMockName = this.sanitizeFilename(mockApiName);
      const apiHandle = await mockingHandle.getDirectoryHandle(safeMockName);
      const results: { endpoint: string; requests: T }[] = [];

      for await (const entry of apiHandle.values()) {
        if (entry.kind === 'directory') {
          const endpointHandle = await apiHandle.getDirectoryHandle(entry.name);
          const requests = await this.readJsonFileFromDir<T>(endpointHandle, 'requests.json');
          if (requests) {
            // Convert sanitized directory name back to endpoint path
            const endpoint = '/' + entry.name.replace(/-/g, '/').replace(/_/g, ':');
            results.push({ endpoint, requests });
          }
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  /**
   * Read all captured requests across all mock APIs in a workspace
   */
  async readAllMockingData<T>(workspaceName: string): Promise<{ mockApiName: string; endpoint: string; requests: T }[]> {
    const mockingHandle = await this.getMockingHandle(workspaceName);
    if (!mockingHandle) return [];

    const allResults: { mockApiName: string; endpoint: string; requests: T }[] = [];

    try {
      for await (const entry of mockingHandle.values()) {
        if (entry.kind === 'directory') {
          const mockApiName = entry.name;
          const endpointData = await this.readAllMockRequests<T>(workspaceName, mockApiName);
          for (const { endpoint, requests } of endpointData) {
            allResults.push({ mockApiName, endpoint, requests });
          }
        }
      }
    } catch (error) {
      console.error('[WebFS] Error reading all mocking data:', error);
    }

    return allResults;
  }

  /**
   * Delete a mock API's mocking data
   */
  async deleteMockApiData(workspaceName: string, mockApiName: string): Promise<boolean> {
    const mockingHandle = await this.getMockingHandle(workspaceName);
    if (!mockingHandle) return false;

    const safeMockName = this.sanitizeFilename(mockApiName);
    return this.deleteDirectory(mockingHandle, safeMockName);
  }

  /**
   * Delete an endpoint's mocking data
   */
  async deleteMockEndpointData(workspaceName: string, mockApiName: string, endpoint: string): Promise<boolean> {
    const mockingHandle = await this.getMockingHandle(workspaceName);
    if (!mockingHandle) return false;

    try {
      const safeMockName = this.sanitizeFilename(mockApiName);
      const safeEndpoint = this.sanitizeEndpointPath(endpoint);
      
      const apiHandle = await mockingHandle.getDirectoryHandle(safeMockName);
      return this.deleteDirectory(apiHandle, safeEndpoint);
    } catch {
      return false;
    }
  }

  /**
   * Clear all mocking data for a workspace
   */
  async clearMockingData(workspaceName: string): Promise<boolean> {
    const workspaceHandle = await this.getWorkspaceHandle(workspaceName);
    if (!workspaceHandle) return false;

    return this.deleteDirectory(workspaceHandle, 'mocking');
  }

  // ==================== Workspace Data File Operations ====================
  // Workspace-specific data files for state like sync states, pending changes, cookies, etc.

  /**
   * Get the data directory handle for a workspace
   */
  private async getDataHandle(workspaceName: string): Promise<FileSystemDirectoryHandle | null> {
    const workspaceHandle = await this.getWorkspaceHandle(workspaceName);
    if (!workspaceHandle) return null;

    try {
      return await workspaceHandle.getDirectoryHandle('data', { create: true });
    } catch {
      return null;
    }
  }

  /**
   * Read a workspace-specific data file
   */
  async readWorkspaceDataFile<T>(workspaceName: string, filename: string): Promise<T | null> {
    const dataHandle = await this.getDataHandle(workspaceName);
    if (!dataHandle) return null;

    const safeFilename = this.sanitizeFilename(filename);
    return this.readJsonFileFromDir<T>(dataHandle, `${safeFilename}.json`);
  }

  /**
   * Write a workspace-specific data file
   */
  async writeWorkspaceDataFile<T>(workspaceName: string, filename: string, data: T): Promise<boolean> {
    const dataHandle = await this.getDataHandle(workspaceName);
    if (!dataHandle) return false;

    const safeFilename = this.sanitizeFilename(filename);
    return this.writeJsonFileToDir(dataHandle, `${safeFilename}.json`, data);
  }

  /**
   * Delete a workspace-specific data file
   */
  async deleteWorkspaceDataFile(workspaceName: string, filename: string): Promise<boolean> {
    const dataHandle = await this.getDataHandle(workspaceName);
    if (!dataHandle) return false;

    const safeFilename = this.sanitizeFilename(filename);
    return this.deleteFileFromDir(dataHandle, `${safeFilename}.json`);
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
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 255);
  }

  /**
   * Get the Echolon path (directory name for web)
   */
  async getEcholonPath(): Promise<string> {
    return this.directoryName || 'Not configured';
  }

  /**
   * Check if the manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Clean up resources (no-op for web, but maintains interface compatibility)
   */
  cleanup(): void {
    // No cleanup needed for web file system
  }
}

// Type declaration for FileSystemHandlePermissionDescriptor
interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

// Augment global interfaces for Web File System API
declare global {
  interface Window {
    showDirectoryPicker(options?: {
      mode?: 'read' | 'readwrite';
      startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
    }): Promise<FileSystemDirectoryHandle>;
  }

  // Extend FileSystemDirectoryHandle to include values() iterator
  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemHandle>;
  }
}

export const webFileSystemManager = WebFileSystemManager.getInstance();
export default webFileSystemManager;

