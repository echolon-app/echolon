/**
 * File Storage Manager for Renderer Process
 * 
 * Provides a unified interface for file-based storage operations,
 * communicating with the main process via IPC.
 */

import {
  EchoFile,
  EcholonConfig,
  GlobalEnvironmentsFile,
  WorkspaceFile,
} from '../../shared/echoFormat';

// Re-export types for convenience
export type { EchoFile, EcholonConfig, GlobalEnvironmentsFile, WorkspaceFile };

interface FileChangedEvent {
  event: string;
  filename: string | null;
  dirPath: string;
}

type FileChangeCallback = (event: FileChangedEvent) => void;

class FileStorageManager {
  private static instance: FileStorageManager;
  private fileChangeCallbacks: Set<FileChangeCallback> = new Set();
  private unsubscribeFileChanged: (() => void) | null = null;
  private initialized = false;

  private constructor() {}

  static getInstance(): FileStorageManager {
    if (!FileStorageManager.instance) {
      FileStorageManager.instance = new FileStorageManager();
    }
    return FileStorageManager.instance;
  }

  /**
   * Initialize file storage and set up file watching
   */
  async initialize(): Promise<{ success: boolean; error?: string }> {
    if (this.initialized) {
      return { success: true };
    }

    try {
      const result = await window.electronAPI.initFileStorage();
      
      if (result.success) {
        // Set up file change listener
        this.unsubscribeFileChanged = window.electronAPI.onFileChanged((event) => {
          this.notifyFileChange(event);
        });

        // Start watching the Echolon directory
        const echolonPath = await this.getEcholonPath();
        await window.electronAPI.watchDirectory(echolonPath);

        this.initialized = true;
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    if (this.unsubscribeFileChanged) {
      this.unsubscribeFileChanged();
      this.unsubscribeFileChanged = null;
    }
    this.fileChangeCallbacks.clear();
    this.initialized = false;
  }

  // ==================== Path Operations ====================

  /**
   * Get the current Echolon storage path
   */
  async getEcholonPath(): Promise<string> {
    return window.electronAPI.getEcholonPath();
  }

  /**
   * Set a new Echolon storage path
   */
  async setEcholonPath(newPath: string): Promise<{ success: boolean; error?: string }> {
    const result = await window.electronAPI.setEcholonPath(newPath);
    
    if (result.success) {
      // Re-watch the new directory
      await window.electronAPI.watchDirectory(newPath);
    }

    return result;
  }

  /**
   * Open directory selection dialog
   */
  async selectDirectory(): Promise<string | null> {
    return window.electronAPI.selectDirectory();
  }

  /**
   * Open the Echolon directory in system file manager
   */
  async openInFileManager(): Promise<void> {
    return window.electronAPI.openInFileManager();
  }

  // ==================== Config Operations ====================

  /**
   * Read the global config
   */
  async readConfig(): Promise<EcholonConfig | null> {
    return window.electronAPI.readConfig();
  }

  /**
   * Write the global config
   */
  async writeConfig(config: EcholonConfig): Promise<boolean> {
    return window.electronAPI.writeConfig(config);
  }

  /**
   * Update specific config fields
   */
  async updateConfig(updates: Partial<EcholonConfig>): Promise<boolean> {
    return window.electronAPI.updateConfig(updates);
  }

  // ==================== Environment Operations ====================

  /**
   * Read global environments
   */
  async readEnvironments(): Promise<GlobalEnvironmentsFile | null> {
    return window.electronAPI.readEnvironments();
  }

  /**
   * Write global environments
   */
  async writeEnvironments(environments: GlobalEnvironmentsFile): Promise<boolean> {
    return window.electronAPI.writeEnvironments(environments);
  }

  // ==================== Workspace Operations ====================

  /**
   * Get all workspaces
   */
  async getAllWorkspaces(): Promise<WorkspaceFile[]> {
    return window.electronAPI.getAllWorkspaces();
  }

  /**
   * Create a new workspace
   */
  async createWorkspace(
    name: string,
    description?: string,
    color?: string
  ): Promise<{ success: boolean; workspace?: WorkspaceFile; error?: string }> {
    return window.electronAPI.createWorkspace(name, description, color);
  }

  /**
   * Read a workspace's metadata
   */
  async readWorkspace(workspaceName: string): Promise<WorkspaceFile | null> {
    return window.electronAPI.readWorkspace(workspaceName);
  }

  /**
   * Update a workspace's metadata
   */
  async updateWorkspace(workspaceName: string, updates: Partial<WorkspaceFile>): Promise<boolean> {
    return window.electronAPI.updateWorkspace(workspaceName, updates);
  }

  /**
   * Rename a workspace
   */
  async renameWorkspace(oldName: string, newName: string): Promise<boolean> {
    return window.electronAPI.renameWorkspace(oldName, newName);
  }

  /**
   * Delete a workspace
   */
  async deleteWorkspace(workspaceName: string): Promise<boolean> {
    return window.electronAPI.deleteWorkspace(workspaceName);
  }

  // ==================== Collection Operations ====================

  /**
   * Get all collections in a workspace
   */
  async getAllCollections(workspaceName: string): Promise<EchoFile[]> {
    return window.electronAPI.getAllCollections(workspaceName);
  }

  /**
   * Get all collections across all workspaces
   */
  async getAllCollectionsAllWorkspaces(): Promise<{ workspace: string; collections: EchoFile[] }[]> {
    return window.electronAPI.getAllCollectionsAllWorkspaces();
  }

  /**
   * Read a collection file
   */
  async readCollection(workspaceName: string, collectionName: string): Promise<EchoFile | null> {
    return window.electronAPI.readCollection(workspaceName, collectionName);
  }

  /**
   * Write a collection file
   */
  async writeCollection(workspaceName: string, collectionName: string, collection: EchoFile): Promise<boolean> {
    return window.electronAPI.writeCollection(workspaceName, collectionName, collection);
  }

  /**
   * Delete a collection file
   */
  async deleteCollection(workspaceName: string, collectionName: string): Promise<boolean> {
    return window.electronAPI.deleteCollection(workspaceName, collectionName);
  }

  /**
   * Rename a collection
   */
  async renameCollection(workspaceName: string, oldName: string, newName: string): Promise<boolean> {
    return window.electronAPI.renameCollection(workspaceName, oldName, newName);
  }

  // ==================== Data File Operations ====================
  // Generic data files for app state (pending changes, mocks, etc.)

  /**
   * Read a generic data file from the Echolon directory
   */
  async readDataFile<T>(filename: string): Promise<T | null> {
    return window.electronAPI?.readDataFile<T>(filename) ?? null;
  }

  /**
   * Write a generic data file to the Echolon directory
   */
  async writeDataFile<T>(filename: string, data: T): Promise<boolean> {
    return window.electronAPI?.writeDataFile(filename, data) ?? false;
  }

  // ==================== Mocking Data Operations ====================
  // Workspace-based storage for captured requests

  /**
   * Read captured requests for a specific endpoint
   */
  async readMockRequests<T>(workspaceName: string, mockApiName: string, endpoint: string): Promise<T | null> {
    return window.electronAPI?.readMockRequests<T>(workspaceName, mockApiName, endpoint) ?? null;
  }

  /**
   * Write captured requests for a specific endpoint
   */
  async writeMockRequests<T>(workspaceName: string, mockApiName: string, endpoint: string, data: T): Promise<boolean> {
    return window.electronAPI?.writeMockRequests(workspaceName, mockApiName, endpoint, data) ?? false;
  }

  /**
   * Read all captured requests for a mock API
   */
  async readAllMockRequests<T>(workspaceName: string, mockApiName: string): Promise<{ endpoint: string; requests: T }[]> {
    return window.electronAPI?.readAllMockRequests<T>(workspaceName, mockApiName) ?? [];
  }

  /**
   * Read all captured requests across all mock APIs in a workspace
   */
  async readAllMockingData<T>(workspaceName: string): Promise<{ mockApiName: string; endpoint: string; requests: T }[]> {
    return window.electronAPI?.readAllMockingData<T>(workspaceName) ?? [];
  }

  /**
   * Delete a mock API's mocking data
   */
  async deleteMockApiData(workspaceName: string, mockApiName: string): Promise<boolean> {
    return window.electronAPI?.deleteMockApiData(workspaceName, mockApiName) ?? false;
  }

  /**
   * Delete an endpoint's mocking data
   */
  async deleteMockEndpointData(workspaceName: string, mockApiName: string, endpoint: string): Promise<boolean> {
    return window.electronAPI?.deleteMockEndpointData(workspaceName, mockApiName, endpoint) ?? false;
  }

  /**
   * Clear all mocking data for a workspace
   */
  async clearMockingData(workspaceName: string): Promise<boolean> {
    return window.electronAPI?.clearMockingData(workspaceName) ?? false;
  }

  // ==================== File Change Notifications ====================

  /**
   * Subscribe to file change events
   */
  onFileChange(callback: FileChangeCallback): () => void {
    this.fileChangeCallbacks.add(callback);
    return () => {
      this.fileChangeCallbacks.delete(callback);
    };
  }

  /**
   * Notify all subscribers of a file change
   */
  private notifyFileChange(event: FileChangedEvent): void {
    this.fileChangeCallbacks.forEach(callback => {
      try {
        callback(event);
      } catch (error) {
        console.error('Error in file change callback:', error);
      }
    });
  }

  // ==================== Utility Methods ====================

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
   * Check if file storage is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

export const fileStorageManager = FileStorageManager.getInstance();
export default fileStorageManager;

