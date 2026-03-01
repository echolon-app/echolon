import { Collection, PendingSpecChanges } from '@/types';
import { specDiffer } from './SpecDiffer';
import { fileStorageManager } from './FileStorageManager';

const PENDING_CHANGES_FILE = 'pending-spec-changes';

export type SyncStatus = 'idle' | 'checking' | 'has-changes' | 'error';

export interface SyncState {
  collectionId: string;
  status: SyncStatus;
  lastChecked?: number;
  pendingChanges?: PendingSpecChanges;
  error?: string;
}

export interface SyncManagerCallbacks {
  onChangesDetected?: (collectionId: string, changes: PendingSpecChanges) => void;
  onSyncComplete?: (collectionId: string) => void;
  onSyncError?: (collectionId: string, error: string) => void;
  getCollections: () => Collection[];
  updateCollection: (id: string, updates: Partial<Collection>) => void;
  getWorkspaceNameForCollection: (collectionId: string) => string | undefined;
}

/**
 * SyncManager handles automatic synchronization of URL-imported collections.
 * It runs checks on app start and at configurable intervals.
 */
export class SyncManager {
  private static instance: SyncManager;
  private callbacks: SyncManagerCallbacks | null = null;
  private syncStates: Map<string, SyncState> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private isInitialized = false;

  private constructor() {}

  static getInstance(): SyncManager {
    if (!SyncManager.instance) {
      SyncManager.instance = new SyncManager();
    }
    return SyncManager.instance;
  }

  /**
   * Initialize the sync manager with callbacks
   */
  async initialize(callbacks: SyncManagerCallbacks): Promise<void> {
    this.callbacks = callbacks;
    this.isInitialized = true;
    
    // Load any stored pending changes
    await this.loadPendingChanges();
    
    // Run initial sync check for all URL collections
    this.checkAllCollections();
  }

  /**
   * Clean up timers and state
   */
  cleanup(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.syncStates.clear();
    this.isInitialized = false;
  }

  /**
   * Get the sync state for a collection
   */
  getSyncState(collectionId: string): SyncState | undefined {
    return this.syncStates.get(collectionId);
  }

  /**
   * Get all pending changes
   */
  getAllPendingChanges(): PendingSpecChanges[] {
    const pending: PendingSpecChanges[] = [];
    for (const state of this.syncStates.values()) {
      if (state.pendingChanges) {
        pending.push(state.pendingChanges);
      }
    }
    return pending;
  }

  /**
   * Log a message to the app console
   */
  private log(type: 'info' | 'warn' | 'error' | 'success', message: string, details?: string): void {
    window.dispatchEvent(new CustomEvent('echolon:log', {
      detail: { type, message, details }
    }));
  }

  /**
   * Check a specific collection for updates
   */
  async checkCollection(collectionId: string): Promise<PendingSpecChanges | null> {
    if (!this.callbacks) {
      console.warn('SyncManager not initialized');
      return null;
    }
    
    // Prevent duplicate checks - skip if already checking
    const currentState = this.syncStates.get(collectionId);
    if (currentState?.status === 'checking') {
      return null;
    }

    const collections = this.callbacks.getCollections();
    const collection = collections.find(c => c.id === collectionId);
    
    if (!collection?.specSource?.url || !collection.specSource.rawSpec) {
      return null;
    }
    
    this.log('info', `Checking for updates: ${collection.name}`, collection.specSource.url);

    // Update state to checking
    this.updateSyncState(collectionId, { status: 'checking' });
    
    const checkTime = Date.now();

    try {
      // Fetch the remote spec
      const result = await window.electronAPI?.fetchUrlContent(collection.specSource.url);
      
      if (!result?.success || !result.content) {
        const statusCode = result?.statusCode ?? 0;
        const is5xx = statusCode >= 500 && statusCode < 600;
        if (is5xx) {
          // Server error: don't treat as API routes changed; treat as transient
          const errorMessage = result?.error || `Server error (${statusCode})`;
          this.callbacks.updateCollection(collectionId, {
            specSource: {
              ...collection.specSource,
              lastCheckedAt: checkTime,
            },
          });
          this.updateSyncState(collectionId, {
            status: 'error',
            lastChecked: checkTime,
            error: errorMessage,
          });
          this.log('error', `Sync check failed (server error): ${collection.name}`, errorMessage);
          this.callbacks.onSyncError?.(collectionId, errorMessage);
          return null;
        }
        throw new Error(result?.error || 'Failed to fetch URL');
      }

      // Compare specs
      if (specDiffer.areSpecsEqual(collection.specSource.rawSpec, result.content)) {
        // No changes - update last synced and last checked
        this.callbacks.updateCollection(collectionId, {
          specSource: {
            ...collection.specSource,
            lastSyncedAt: checkTime,
            lastCheckedAt: checkTime,
          },
        });
        
        this.updateSyncState(collectionId, {
          status: 'idle',
          lastChecked: checkTime,
          pendingChanges: undefined,
        });
        
        this.log('success', `No changes found: ${collection.name}`, 'Spec is up to date');
        this.callbacks.onSyncComplete?.(collectionId);
        return null;
      }

      // Changes detected - update lastCheckedAt (but not lastSyncedAt since we're not in sync)
      this.callbacks.updateCollection(collectionId, {
        specSource: {
          ...collection.specSource,
          lastCheckedAt: checkTime,
        },
      });
      
      const diffResult = specDiffer.compareSpecs(collection.specSource.rawSpec, result.content);
      const pendingChanges = specDiffer.createPendingChanges(collectionId, diffResult, result.content);
      
      this.updateSyncState(collectionId, {
        status: 'has-changes',
        lastChecked: checkTime,
        pendingChanges,
      });
      
      // Store pending changes
      this.savePendingChanges();
      
      this.log('info', `Changes detected: ${collection.name}`, `${pendingChanges.changes.length} change(s) found`);
      this.callbacks.onChangesDetected?.(collectionId, pendingChanges);
      return pendingChanges;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Even on error, update lastCheckedAt so we don't keep retrying immediately
      this.callbacks.updateCollection(collectionId, {
        specSource: {
          ...collection.specSource,
          lastCheckedAt: checkTime,
        },
      });
      
      this.updateSyncState(collectionId, {
        status: 'error',
        lastChecked: checkTime,
        error: errorMessage,
      });
      
      this.log('error', `Sync failed: ${collection.name}`, errorMessage);
      this.callbacks.onSyncError?.(collectionId, errorMessage);
      return null;
    }
  }

  /**
   * Check all URL-imported collections
   */
  async checkAllCollections(): Promise<void> {
    if (!this.callbacks) return;

    const collections = this.callbacks.getCollections();
    const urlCollections = collections.filter(
      c => c.specSource?.type === 'url' && c.specSource.url
    );

    // Schedule checks for each collection
    for (const collection of urlCollections) {
      this.scheduleCheck(collection);
    }
  }

  /**
   * Schedule a sync check for a collection based on its sync frequency
   */
  scheduleCheck(collection: Collection): void {
    const { id, specSource } = collection;
    
    if (!specSource?.url || specSource.syncFrequencyMins === 0) {
      // Manual only - clear any existing timer
      this.clearTimer(id);
      return;
    }

    // Clear existing timer
    this.clearTimer(id);
    
    // Skip scheduling if a check is currently in progress
    const currentState = this.syncStates.get(id);
    if (currentState?.status === 'checking') {
      return;
    }

    // Calculate delay
    const frequencyMs = specSource.syncFrequencyMins * 60 * 1000;
    
    // Use in-memory lastChecked first (for in-session scheduling after a check completes),
    // then fall back to persisted lastCheckedAt (for app startup)
    // This avoids race conditions where React state hasn't updated yet
    const lastChecked = currentState?.lastChecked || specSource.lastCheckedAt || 0;
    const timeSinceLastCheck = Date.now() - lastChecked;
    
    // If enough time has passed since last check, check now
    // Otherwise, schedule for when the interval expires
    let delay = frequencyMs - timeSinceLastCheck;
    if (delay < 0) {
      delay = 1000; // Small delay to avoid blocking initialization
    }
    
    // If we've never checked before, also use the small delay
    if (lastChecked === 0) {
      delay = 1000;
    }

    const timer = setTimeout(async () => {
      await this.checkCollection(id);
      
      // Re-schedule the next check
      const updatedCollections = this.callbacks?.getCollections() || [];
      const updatedCollection = updatedCollections.find(c => c.id === id);
      if (updatedCollection) {
        this.scheduleCheck(updatedCollection);
      }
    }, delay);

    this.timers.set(id, timer);
  }

  /**
   * Update sync frequency for a collection and reschedule
   */
  updateSyncFrequency(collectionId: string, frequencyMins: number): void {
    if (!this.callbacks) return;

    const collections = this.callbacks.getCollections();
    const collection = collections.find(c => c.id === collectionId);
    
    if (collection?.specSource) {
      this.callbacks.updateCollection(collectionId, {
        specSource: {
          ...collection.specSource,
          syncFrequencyMins: frequencyMins,
        },
      });
      
      // Reschedule with new frequency
      this.scheduleCheck({
        ...collection,
        specSource: {
          ...collection.specSource,
          syncFrequencyMins: frequencyMins,
        },
      });
    }
  }

  /**
   * Clear pending changes for a collection
   */
  clearPendingChanges(collectionId: string): void {
    const state = this.syncStates.get(collectionId);
    if (state) {
      this.updateSyncState(collectionId, {
        status: 'idle',
        pendingChanges: undefined,
      });
      this.savePendingChanges();
    }
  }

  /**
   * Handle when a collection is deleted
   */
  onCollectionDeleted(collectionId: string): void {
    this.clearTimer(collectionId);
    this.syncStates.delete(collectionId);
    this.savePendingChanges();
  }

  /**
   * Handle when a collection is updated
   */
  onCollectionUpdated(collection: Collection): void {
    // Reschedule if it's a URL collection
    if (collection.specSource?.type === 'url') {
      this.scheduleCheck(collection);
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private updateSyncState(collectionId: string, updates: Partial<SyncState>): void {
    const current = this.syncStates.get(collectionId) || {
      collectionId,
      status: 'idle' as SyncStatus,
    };
    
    this.syncStates.set(collectionId, { ...current, ...updates });
  }

  private clearTimer(collectionId: string): void {
    const timer = this.timers.get(collectionId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(collectionId);
    }
  }

  private async savePendingChanges(): Promise<void> {
    if (!this.callbacks) return;
    
    try {
      // Group pending changes by workspace
      const pendingByWorkspace: Map<string, Record<string, PendingSpecChanges>> = new Map();
      
      for (const [collectionId, state] of this.syncStates) {
        if (state.pendingChanges) {
          const workspaceName = this.callbacks.getWorkspaceNameForCollection(collectionId);
          if (workspaceName) {
            if (!pendingByWorkspace.has(workspaceName)) {
              pendingByWorkspace.set(workspaceName, {});
            }
            pendingByWorkspace.get(workspaceName)![collectionId] = state.pendingChanges;
          }
        }
      }
      
      // Save each workspace's pending changes to its own file
      for (const [workspaceName, pending] of pendingByWorkspace) {
        await fileStorageManager.writeWorkspaceDataFile(workspaceName, PENDING_CHANGES_FILE, pending);
      }
      
      // Also clear any workspaces that no longer have pending changes
      const collections = this.callbacks.getCollections();
      const workspacesWithCollections = new Set<string>();
      for (const collection of collections) {
        const workspaceName = this.callbacks.getWorkspaceNameForCollection(collection.id);
        if (workspaceName) {
          workspacesWithCollections.add(workspaceName);
        }
      }
      
      // Clear pending changes from workspaces that had them but now don't
      for (const workspaceName of workspacesWithCollections) {
        if (!pendingByWorkspace.has(workspaceName)) {
          // Write empty object to clear the file (or delete it)
          await fileStorageManager.writeWorkspaceDataFile(workspaceName, PENDING_CHANGES_FILE, {});
        }
      }
    } catch (error) {
      console.error('Failed to save pending changes:', error);
    }
  }

  private async loadPendingChanges(): Promise<void> {
    if (!this.callbacks) return;
    
    try {
      // Get all collections to find their workspaces
      const collections = this.callbacks.getCollections();
      const workspaces = new Set<string>();
      
      for (const collection of collections) {
        const workspaceName = this.callbacks.getWorkspaceNameForCollection(collection.id);
        if (workspaceName) {
          workspaces.add(workspaceName);
        }
      }
      
      // Load pending changes from each workspace
      for (const workspaceName of workspaces) {
        const pending = await fileStorageManager.readWorkspaceDataFile<Record<string, PendingSpecChanges>>(
          workspaceName, 
          PENDING_CHANGES_FILE
        );
        if (pending) {
          for (const [collectionId, changes] of Object.entries(pending)) {
            // Skip loading pending changes for collections set to "Manual only"
            const collection = collections.find(c => c.id === collectionId);
            if (collection?.specSource?.syncFrequencyMins === 0) {
              continue;
            }
            
            this.updateSyncState(collectionId, {
              status: 'has-changes',
              pendingChanges: changes,
            });
          }
        }
      }
    } catch (error) {
      console.error('Failed to load pending changes:', error);
    }
  }
}

// Export singleton instance
export const syncManager = SyncManager.getInstance();
export default syncManager;

