import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Collection, Request, Folder, PendingSpecChanges, CollectionEnvironment, KeyValuePair, CollectionType } from '@/types';
import { fileStorageManager, syncManager } from '@/services';
import { echoConverter } from '@/services/EchoFileConverter';
import { useWorkspace } from './WorkspaceContext';
import { useDataLoader } from './DataLoaderContext';
import { useWebModeOptional } from './WebModeContext';
import { v4 as uuidv4 } from 'uuid';

interface CollectionsContextValue {
  collections: Collection[];
  allCollections: Collection[];
  isLoading: boolean;
  addCollection: (name: string, description?: string, type?: CollectionType) => Promise<Collection | null>;
  updateCollection: (id: string, updates: Partial<Collection>) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  importCollection: (collection: Collection) => Promise<void>;
  // Web mode only - add collection directly to state without file storage
  addWebModeCollection: (collection: Collection) => void;
  moveCollection: (collectionId: string, targetWorkspaceId: string) => Promise<void>;
  addRequest: (collectionId: string, request: Request, folderId?: string) => void;
  updateRequest: (collectionId: string, requestId: string, updates: Partial<Request>) => void;
  deleteRequest: (collectionId: string, requestId: string, folderId?: string) => void;
  moveRequestToCollection: (request: Request, fromCollectionId: string | null, toCollectionId: string, folderId?: string, insertIndex?: number) => void;
  addFolder: (collectionId: string, name: string, parentFolderId?: string) => Folder;
  updateFolder: (collectionId: string, folderId: string, updates: Partial<Folder>) => void;
  deleteFolder: (collectionId: string, folderId: string) => void;
  collapseAllFolders: (collectionId: string) => void;
  expandAllFolders: (collectionId: string) => void;
  getRequest: (collectionId: string, requestId: string) => Request | null;
  searchCollections: (query: string) => { collections: Collection[]; requests: Request[]; folders: Folder[] };
  // Collection environment management
  addCollectionEnvironment: (collectionId: string, name: string) => CollectionEnvironment;
  updateCollectionEnvironment: (collectionId: string, envId: string, updates: Partial<CollectionEnvironment>) => void;
  deleteCollectionEnvironment: (collectionId: string, envId: string) => void;
  toggleCollectionEnvironmentActive: (collectionId: string, envId: string) => void;
  setActiveCollectionEnvironment: (collectionId: string, envId: string | null) => void;
  getActiveCollectionEnvironment: (collectionId: string) => CollectionEnvironment | null;
  // Sync-related
  pendingChangesCount: number;
  getPendingChanges: (collectionId: string) => PendingSpecChanges | undefined;
  clearPendingChanges: (collectionId: string) => void;
  checkForUpdates: (collectionId: string) => Promise<PendingSpecChanges | null>;
  // File storage helpers
  refreshCollections: () => Promise<void>;
}

const CollectionsContext = createContext<CollectionsContextValue | null>(null);

// Create sample collection with sample requests
const createSampleCollection = (workspaceId?: string): Collection => {
  const sampleGetRequest: Request = {
    id: uuidv4(),
    name: 'Get Users',
    method: 'GET',
    url: 'https://jsonplaceholder.typicode.com/users',
    headers: [],
    queryParams: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    scripts: { pre: '', post: '' },
  };

  const samplePostRequest: Request = {
    id: uuidv4(),
    name: 'Create Post',
    method: 'POST',
    url: 'https://jsonplaceholder.typicode.com/posts',
    headers: [
      { id: uuidv4(), key: 'Content-Type', value: 'application/json', enabled: true }
    ],
    queryParams: [],
    body: { 
      type: 'json', 
      content: JSON.stringify({
        title: 'Sample Post',
        body: 'This is a sample post body',
        userId: 1
      }, null, 2)
    },
    auth: { type: 'none' },
    scripts: { pre: '', post: '' },
  };

  const sampleGetSingleRequest: Request = {
    id: uuidv4(),
    name: 'Get Single Post',
    method: 'GET',
    url: 'https://jsonplaceholder.typicode.com/posts/1',
    headers: [],
    queryParams: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    scripts: { pre: '', post: '' },
  };

  return {
    id: uuidv4(),
    name: 'Sample Collection',
    description: 'A sample collection with example API requests using JSONPlaceholder API',
    requests: [sampleGetRequest, samplePostRequest, sampleGetSingleRequest],
    folders: [
      {
        id: uuidv4(),
        name: 'Tasks',
        requests: [
          {
            id: uuidv4(),
            name: 'Get Tasks',
            method: 'GET',
            url: 'https://sample-api.echolon.app/tasks',
            headers: [],
            queryParams: [
           
            ],
            body: { type: 'none', content: '' },
            auth: { type: 'none' },
            scripts: { pre: '', post: '' },
          },
          {
            id: uuidv4(),
            name: 'Create Task',
            method: 'POST',
            url: 'https://sample-api.echolon.app/task',
            headers: [],
            queryParams: [
           
            ],
            body: { type: 'none', content: '' },
            auth: { type: 'none' },
            scripts: { pre: '', post: '' },
          }
        ],
        folders: [],
      }
    ],
    
    workspaceId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
};

export const CollectionsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const webMode = useWebModeOptional();
  const isWebMode = webMode?.isWebMode ?? false;
  const { activeWorkspaceId, getWorkspaceNameById } = useWorkspace();
  const { data, isLoading: dataLoading, refresh: refreshData } = useDataLoader();
  
  const syncInitialized = useRef(false);
  const initializedRef = useRef(false);
  const saveQueueRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  
  const [allCollections, setAllCollections] = useState<Collection[]>([]);
  const [isLoading, setIsLoading] = useState(!isWebMode);
  const [pendingChangesCount, setPendingChangesCount] = useState(0);
  
  // Ref to always have access to latest collections (for SyncManager callbacks)
  const collectionsRef = useRef<Collection[]>([]);
  useEffect(() => {
    collectionsRef.current = allCollections;
  }, [allCollections]);

  // Initialize from pre-loaded data
  useEffect(() => {
    if (dataLoading || initializedRef.current) return;
    
    // In web mode, start with empty collections (will be populated via addWebModeCollection)
    if (isWebMode) {
      console.log('[CollectionsContext] Web mode - starting with empty collections');
      setIsLoading(false);
      initializedRef.current = true;
      return;
    }
    
    console.log('[CollectionsContext] Initializing with pre-loaded data');
    setAllCollections(data.collections);
    setIsLoading(false);
    initializedRef.current = true;
  }, [dataLoading, data.collections, isWebMode]);

  // Create sample collection if workspace has no collections (deferred, not in web mode)
  useEffect(() => {
    if (!initializedRef.current || !activeWorkspaceId || isWebMode) return;
    
    const workspaceCollections = allCollections.filter(c => c.workspaceId === activeWorkspaceId);
      if (workspaceCollections.length === 0) {
      // Defer sample creation to not block startup
      const timer = setTimeout(async () => {
        const sample = createSampleCollection(activeWorkspaceId);
          const workspaceName = getWorkspaceNameById(activeWorkspaceId);
          if (workspaceName) {
            const echoFile = echoConverter.collectionToEchoFile(sample, workspaceName);
            await fileStorageManager.writeCollection(workspaceName, fileStorageManager.sanitizeFilename(sample.name), echoFile);
        setAllCollections(prev => [...prev, sample]);
          }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [activeWorkspaceId, allCollections, getWorkspaceNameById, isWebMode]);

  // Immediate save to file (no debounce)
  const saveCollectionToFileImmediate = useCallback(async (collection: Collection) => {
    // Skip file operations in web mode
    if (isWebMode) return;
    
    const workspaceName = getWorkspaceNameById(collection.workspaceId || '');
    if (!workspaceName) {
      console.error('Cannot save collection: workspace not found');
      return;
    }
    
    // Clear any pending debounced save for this collection
    const existingTimeout = saveQueueRef.current.get(collection.id);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      saveQueueRef.current.delete(collection.id);
    }
    
    const echoFile = echoConverter.collectionToEchoFile(collection, workspaceName);
    const collectionName = fileStorageManager.sanitizeFilename(collection.name);
    await fileStorageManager.writeCollection(workspaceName, collectionName, echoFile);
  }, [getWorkspaceNameById, isWebMode]);

  // Debounced save to file (skip in web mode)
  const saveCollectionToFile = useCallback(async (collection: Collection) => {
    // Skip file operations in web mode
    if (isWebMode) return;
    
    const workspaceName = getWorkspaceNameById(collection.workspaceId || '');
    if (!workspaceName) {
      console.error('Cannot save collection: workspace not found');
      return;
    }
    
    // Clear existing timeout for this collection
    const existingTimeout = saveQueueRef.current.get(collection.id);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      }
    
    // Debounce save by 500ms
    const timeout = setTimeout(async () => {
      const echoFile = echoConverter.collectionToEchoFile(collection, workspaceName);
      const collectionName = fileStorageManager.sanitizeFilename(collection.name);
      await fileStorageManager.writeCollection(workspaceName, collectionName, echoFile);
      saveQueueRef.current.delete(collection.id);
    }, 500);
    
    saveQueueRef.current.set(collection.id, timeout);
  }, [getWorkspaceNameById, isWebMode]);

  // Filter collections by active workspace
  const collections = useMemo(() => {
    if (!activeWorkspaceId) return allCollections;
    return allCollections.filter(c => c.workspaceId === activeWorkspaceId);
  }, [allCollections, activeWorkspaceId]);

  const addCollection = useCallback(async (name: string, description?: string, type?: CollectionType): Promise<Collection | null> => {
    const workspaceName = getWorkspaceNameById(activeWorkspaceId || '');
    if (!workspaceName) {
      console.error('Cannot add collection: no active workspace');
      return null;
    }
    
    const newCollection: Collection = {
      id: uuidv4(),
      name,
      description,
      type: type || 'REST',
      requests: [],
      folders: [],
      workspaceId: activeWorkspaceId || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    // Save to file
    const echoFile = echoConverter.collectionToEchoFile(newCollection, workspaceName);
    const success = await fileStorageManager.writeCollection(
      workspaceName, 
      fileStorageManager.sanitizeFilename(name), 
      echoFile
    );
    
    if (success) {
    setAllCollections(prev => [...prev, newCollection]);
    return newCollection;
    }
    
    return null;
  }, [activeWorkspaceId, getWorkspaceNameById]);

  const updateCollection = useCallback(async (id: string, updates: Partial<Collection>) => {
    const collection = allCollections.find(c => c.id === id);
    if (!collection) return;
    
    const updatedCollection = { ...collection, ...updates, updatedAt: Date.now() };
    
    // Handle name change (rename file)
    if (updates.name && updates.name !== collection.name) {
      const workspaceName = getWorkspaceNameById(collection.workspaceId || '');
      if (workspaceName) {
        const oldName = fileStorageManager.sanitizeFilename(collection.name);
        const newName = fileStorageManager.sanitizeFilename(updates.name);
        await fileStorageManager.renameCollection(workspaceName, oldName, newName);
      }
    }
    
    // Reschedule sync check if frequency changed
    if (updates.specSource?.syncFrequencyMins !== undefined && 
        updates.specSource.syncFrequencyMins !== collection.specSource?.syncFrequencyMins) {
      syncManager.scheduleCheck(updatedCollection);
    }
    
    setAllCollections(prev =>
      prev.map(c => c.id === id ? updatedCollection : c)
    );
    
    // Save immediately for UI state changes (collapsed), debounce for other changes
    const isUIStateChange = Object.keys(updates).every(key => key === 'collapsed');
    if (isUIStateChange) {
      await saveCollectionToFileImmediate(updatedCollection);
    } else {
      await saveCollectionToFile(updatedCollection);
    }
  }, [allCollections, getWorkspaceNameById, saveCollectionToFile, saveCollectionToFileImmediate]);

  const deleteCollection = useCallback(async (id: string) => {
    const collection = allCollections.find(c => c.id === id);
    if (!collection) return;
    
    const workspaceName = getWorkspaceNameById(collection.workspaceId || '');
    if (workspaceName) {
      const collectionName = fileStorageManager.sanitizeFilename(collection.name);
      await fileStorageManager.deleteCollection(workspaceName, collectionName);
    }
    
    setAllCollections(prev => prev.filter(c => c.id !== id));
    syncManager.onCollectionDeleted(id);
  }, [allCollections, getWorkspaceNameById]);

  const importCollection = useCallback(async (collection: Collection) => {
    const workspaceName = getWorkspaceNameById(activeWorkspaceId || '');
    if (!workspaceName) {
      console.error('Cannot import collection: no active workspace');
      return;
    }
    
    const newCollection = { 
      ...collection, 
      id: uuidv4(), 
      workspaceId: activeWorkspaceId || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    // Save to file
    const echoFile = echoConverter.collectionToEchoFile(newCollection, workspaceName);
    await fileStorageManager.writeCollection(
      workspaceName,
      fileStorageManager.sanitizeFilename(newCollection.name),
      echoFile
    );
    
    setAllCollections(prev => [...prev, newCollection]);
  }, [activeWorkspaceId, getWorkspaceNameById]);

  // Web mode only - add collection directly to state without file storage
  const addWebModeCollection = useCallback((collection: Collection) => {
    const newCollection = { 
      ...collection, 
      id: collection.id || uuidv4(), 
      // Use 'web-workspace' as fallback - this is the ID used by WorkspaceContext in web mode
      workspaceId: activeWorkspaceId || 'web-workspace',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setAllCollections(prev => [...prev, newCollection]);
  }, [activeWorkspaceId]);

  const moveCollection = useCallback(async (collectionId: string, targetWorkspaceId: string) => {
    const collection = allCollections.find(c => c.id === collectionId);
    if (!collection) return;
    
    const sourceWorkspaceName = getWorkspaceNameById(collection.workspaceId || '');
    const targetWorkspaceName = getWorkspaceNameById(targetWorkspaceId);
    
    if (!sourceWorkspaceName || !targetWorkspaceName) return;
    
    // Read from source, write to target, delete from source
    const collectionFileName = fileStorageManager.sanitizeFilename(collection.name);
    const updatedCollection = { ...collection, workspaceId: targetWorkspaceId, updatedAt: Date.now() };
    const echoFile = echoConverter.collectionToEchoFile(updatedCollection, targetWorkspaceName);
    
    await fileStorageManager.writeCollection(targetWorkspaceName, collectionFileName, echoFile);
    await fileStorageManager.deleteCollection(sourceWorkspaceName, collectionFileName);
    
    setAllCollections(prev =>
      prev.map(c => c.id === collectionId ? updatedCollection : c)
    );
  }, [allCollections, getWorkspaceNameById]);

  const addRequest = useCallback((collectionId: string, request: Request, folderId?: string) => {
    setAllCollections(prev => {
      const newCollections = prev.map(c => {
        if (c.id !== collectionId) return c;

        if (folderId) {
          const updateFolders = (folders: Folder[]): Folder[] =>
            folders.map(f => {
              if (f.id === folderId) {
                return { ...f, requests: [...f.requests, request] };
              }
              return { ...f, folders: updateFolders(f.folders) };
            });

          const updated = {
            ...c,
            folders: updateFolders(c.folders),
            updatedAt: Date.now(),
          };
          saveCollectionToFile(updated);
          return updated;
        }

        const updated = {
          ...c,
          requests: [...c.requests, request],
          updatedAt: Date.now(),
        };
        saveCollectionToFile(updated);
        return updated;
      });
      return newCollections;
    });
  }, [saveCollectionToFile]);

  const updateRequest = useCallback((collectionId: string, requestId: string, updates: Partial<Request>) => {
    setAllCollections(prev => {
      const newCollections = prev.map(c => {
        if (c.id !== collectionId) return c;

        const updateRequests = (requests: Request[]): Request[] =>
          requests.map(r => (r.id === requestId ? { ...r, ...updates } : r));

        const updateFolders = (folders: Folder[]): Folder[] =>
          folders.map(f => ({
            ...f,
            requests: updateRequests(f.requests),
            folders: updateFolders(f.folders),
          }));

        const updated = {
          ...c,
          requests: updateRequests(c.requests),
          folders: updateFolders(c.folders),
          updatedAt: Date.now(),
        };
        saveCollectionToFile(updated);
        return updated;
      });
      return newCollections;
    });
  }, [saveCollectionToFile]);

  const deleteRequest = useCallback((collectionId: string, requestId: string, folderId?: string) => {
    setAllCollections(prev => {
      const newCollections = prev.map(c => {
        if (c.id !== collectionId) return c;

        if (folderId) {
          const updateFolders = (folders: Folder[]): Folder[] =>
            folders.map(f => {
              if (f.id === folderId) {
                return { ...f, requests: f.requests.filter(r => r.id !== requestId) };
              }
              return { ...f, folders: updateFolders(f.folders) };
            });

          const updated = {
            ...c,
            folders: updateFolders(c.folders),
            updatedAt: Date.now(),
          };
          saveCollectionToFile(updated);
          return updated;
        }

        const updated = {
          ...c,
          requests: c.requests.filter(r => r.id !== requestId),
          updatedAt: Date.now(),
        };
        saveCollectionToFile(updated);
        return updated;
      });
      return newCollections;
    });
  }, [saveCollectionToFile]);

  const moveRequestToCollection = useCallback((
    request: Request, 
    fromCollectionId: string | null, 
    toCollectionId: string, 
    toFolderId?: string,
    insertIndex?: number
  ) => {
    console.log('[moveRequest] Called with:', { 
      requestName: request?.name,
      fromCollectionId, 
      toCollectionId, 
      toFolderId, 
      insertIndex 
    });

    // Update the request with new collection info
    const movedRequest: Request = {
      ...request,
      collectionId: toCollectionId,
      folderId: toFolderId,
    };

    // Helper to insert at specific index or append
    const insertAtIndex = (arr: Request[], item: Request, index?: number): Request[] => {
      if (index === undefined || index < 0 || index > arr.length) {
        return [...arr, item];
      }
      const result = [...arr];
      result.splice(index, 0, item);
      return result;
    };

    // Check if moving within same collection
    const isSameCollection = fromCollectionId === toCollectionId;
    console.log('[moveRequest] isSameCollection:', isSameCollection);

    setAllCollections(prev => {
      const newCollections = prev.map(c => {
        // Case 1: Moving within the same collection
        if (isSameCollection && c.id === toCollectionId) {
          // Helper to remove request from folders recursively
          const removeFromFolders = (folders: Folder[]): Folder[] =>
            folders.map(f => ({
              ...f,
              requests: f.requests.filter(r => r.id !== request.id),
              folders: removeFromFolders(f.folders),
            }));

          // Remove from current location (root and all folders)
          let newRequests = c.requests.filter(r => r.id !== request.id);
          let newFolders = removeFromFolders(c.folders);

          // Add to target location
          if (toFolderId) {
            // Add to specific folder
            const addToFolder = (folders: Folder[]): Folder[] =>
              folders.map(f => {
                if (f.id === toFolderId) {
                  return { ...f, requests: insertAtIndex(f.requests, movedRequest, insertIndex) };
                }
                return { ...f, folders: addToFolder(f.folders) };
              });
            newFolders = addToFolder(newFolders);
          } else {
            // Add to root - adjust index if moving within root
            const originalIndex = c.requests.findIndex(r => r.id === request.id);
            let adjustedIndex = insertIndex;
            if (originalIndex !== -1 && insertIndex !== undefined && originalIndex < insertIndex) {
              adjustedIndex = insertIndex - 1;
            }
            newRequests = insertAtIndex(newRequests, movedRequest, adjustedIndex);
          }

          const updated = {
            ...c,
            requests: newRequests,
            folders: newFolders,
            updatedAt: Date.now(),
          };
          saveCollectionToFile(updated);
          return updated;
        }

        // Case 2: Remove from source collection (when moving to different collection)
        if (fromCollectionId && c.id === fromCollectionId && !isSameCollection) {
          const removeFromFolders = (folders: Folder[]): Folder[] =>
            folders.map(f => ({
              ...f,
              requests: f.requests.filter(r => r.id !== request.id),
              folders: removeFromFolders(f.folders),
            }));

          const updated = {
            ...c,
            requests: c.requests.filter(r => r.id !== request.id),
            folders: removeFromFolders(c.folders),
            updatedAt: Date.now(),
          };
          saveCollectionToFile(updated);
          return updated;
        }

        // Case 3: Add to target collection (when moving from different collection or standalone)
        if (c.id === toCollectionId && !isSameCollection) {
          console.log('[moveRequest] Case 3: Adding to target collection', c.name);
          if (toFolderId) {
            // Add to specific folder
            const addToFolder = (folders: Folder[]): Folder[] =>
              folders.map(f => {
                if (f.id === toFolderId) {
                  return { ...f, requests: insertAtIndex(f.requests, movedRequest, insertIndex) };
                }
                return { ...f, folders: addToFolder(f.folders) };
              });

            const updated = {
              ...c,
              folders: addToFolder(c.folders),
              updatedAt: Date.now(),
            };
            saveCollectionToFile(updated);
            return updated;
          } else {
            // Add to root of collection at specified index
            const updated = {
              ...c,
              requests: insertAtIndex(c.requests, movedRequest, insertIndex),
              updatedAt: Date.now(),
            };
            saveCollectionToFile(updated);
            return updated;
          }
        }

        return c;
      });
      return newCollections;
    });
  }, [saveCollectionToFile]);

  const addFolder = useCallback((collectionId: string, name: string, parentFolderId?: string): Folder => {
    const newFolder: Folder = {
      id: uuidv4(),
      name,
      requests: [],
      folders: [],
    };

    setAllCollections(prev => {
      const newCollections = prev.map(c => {
        if (c.id !== collectionId) return c;

        if (parentFolderId) {
          const updateFolders = (folders: Folder[]): Folder[] =>
            folders.map(f => {
              if (f.id === parentFolderId) {
                return { ...f, folders: [...f.folders, newFolder] };
              }
              return { ...f, folders: updateFolders(f.folders) };
            });

          const updated = {
            ...c,
            folders: updateFolders(c.folders),
            updatedAt: Date.now(),
          };
          saveCollectionToFile(updated);
          return updated;
        }

        const updated = {
          ...c,
          folders: [...c.folders, newFolder],
          updatedAt: Date.now(),
        };
        saveCollectionToFile(updated);
        return updated;
      });
      return newCollections;
    });

    return newFolder;
  }, [saveCollectionToFile]);

  const updateFolder = useCallback((collectionId: string, folderId: string, updates: Partial<Folder>) => {
    // Check if this is a UI state change (collapsed)
    const isUIStateChange = Object.keys(updates).every(key => key === 'collapsed');
    
    setAllCollections(prev => {
      const newCollections = prev.map(c => {
        if (c.id !== collectionId) return c;

        const updateFolders = (folders: Folder[]): Folder[] =>
          folders.map(f => {
            if (f.id === folderId) {
              return { ...f, ...updates };
            }
            return { ...f, folders: updateFolders(f.folders) };
          });

        const updated = {
          ...c,
          folders: updateFolders(c.folders),
          updatedAt: Date.now(),
        };
        
        // Save immediately for UI state changes, debounce for others
        if (isUIStateChange) {
          saveCollectionToFileImmediate(updated);
        } else {
          saveCollectionToFile(updated);
        }
        return updated;
      });
      return newCollections;
    });
  }, [saveCollectionToFile, saveCollectionToFileImmediate]);

  const deleteFolder = useCallback((collectionId: string, folderId: string) => {
    setAllCollections(prev => {
      const newCollections = prev.map(c => {
        if (c.id !== collectionId) return c;

        const filterFolders = (folders: Folder[]): Folder[] =>
          folders
            .filter(f => f.id !== folderId)
            .map(f => ({ ...f, folders: filterFolders(f.folders) }));

        const updated = {
          ...c,
          folders: filterFolders(c.folders),
          updatedAt: Date.now(),
        };
        saveCollectionToFile(updated);
        return updated;
      });
      return newCollections;
    });
  }, [saveCollectionToFile]);

  const collapseAllFolders = useCallback((collectionId: string) => {
    setAllCollections(prev => {
      const newCollections = prev.map(c => {
        if (c.id !== collectionId) return c;

        const collapseFolders = (folders: Folder[]): Folder[] =>
          folders.map(f => ({
            ...f,
            collapsed: true,
            folders: collapseFolders(f.folders),
          }));

        const updated = {
          ...c,
          folders: collapseFolders(c.folders),
          updatedAt: Date.now(),
        };
        saveCollectionToFile(updated);
        return updated;
      });
      return newCollections;
    });
  }, [saveCollectionToFile]);

  const expandAllFolders = useCallback((collectionId: string) => {
    setAllCollections(prev => {
      const newCollections = prev.map(c => {
        if (c.id !== collectionId) return c;

        const expandFolders = (folders: Folder[]): Folder[] =>
          folders.map(f => ({
            ...f,
            collapsed: false,
            folders: expandFolders(f.folders),
          }));

        const updated = {
          ...c,
          folders: expandFolders(c.folders),
          updatedAt: Date.now(),
        };
        saveCollectionToFile(updated);
        return updated;
      });
      return newCollections;
    });
  }, [saveCollectionToFile]);

  const getRequest = useCallback((collectionId: string, requestId: string): Request | null => {
    const collection = allCollections.find(c => c.id === collectionId);
    if (!collection) return null;

    const request = collection.requests.find(r => r.id === requestId);
    if (request) return request;

    const searchFolders = (folders: Folder[]): Request | null => {
      for (const folder of folders) {
        const found = folder.requests.find(r => r.id === requestId);
        if (found) return found;
        const inSubfolder = searchFolders(folder.folders);
        if (inSubfolder) return inSubfolder;
      }
      return null;
    };

    return searchFolders(collection.folders);
  }, [allCollections]);

  const searchCollections = useCallback((query: string): { collections: Collection[]; requests: Request[]; folders: Folder[] } => {
    const lowerQuery = query.toLowerCase();
    const matchedCollections: Collection[] = [];
    const matchedRequests: Request[] = [];
    const matchedFolders: Folder[] = [];

    const searchRequests = (requests: Request[]) => {
      requests.forEach(r => {
        if (
          r.name.toLowerCase().includes(lowerQuery) ||
          r.url.toLowerCase().includes(lowerQuery) ||
          r.method.toLowerCase().includes(lowerQuery)
        ) {
          matchedRequests.push(r);
        }
      });
    };

    const searchFolders = (folders: Folder[]) => {
      folders.forEach(f => {
        if (f.name.toLowerCase().includes(lowerQuery)) {
          matchedFolders.push(f);
        }
        searchRequests(f.requests);
        searchFolders(f.folders);
      });
    };

    collections.forEach(c => {
      if (
        c.name.toLowerCase().includes(lowerQuery) ||
        (c.description && c.description.toLowerCase().includes(lowerQuery))
      ) {
        matchedCollections.push(c);
      }
      searchRequests(c.requests);
      searchFolders(c.folders);
    });

    return { collections: matchedCollections, requests: matchedRequests, folders: matchedFolders };
  }, [collections]);

  // Collection environment management
  const addCollectionEnvironment = useCallback((collectionId: string, name: string): CollectionEnvironment => {
    const newEnv: CollectionEnvironment = {
      id: uuidv4(),
      name,
      variables: [],
      isActive: true,
    };

    setAllCollections(prev => {
      const newCollections = prev.map(c => {
        if (c.id !== collectionId) return c;
        
        const existingEnvs = c.environments || [];
        const updated = {
          ...c,
          environments: [...existingEnvs, newEnv],
          updatedAt: Date.now(),
        };
        saveCollectionToFile(updated);
        return updated;
      });
      return newCollections;
    });

    return newEnv;
  }, [saveCollectionToFile]);

  const updateCollectionEnvironment = useCallback((collectionId: string, envId: string, updates: Partial<CollectionEnvironment>) => {
    setAllCollections(prev => {
      const newCollections = prev.map(c => {
        if (c.id !== collectionId) return c;
        
        const updated = {
          ...c,
          environments: (c.environments || []).map(e =>
            e.id === envId ? { ...e, ...updates } : e
          ),
          updatedAt: Date.now(),
        };
        saveCollectionToFile(updated);
        return updated;
      });
      return newCollections;
    });
  }, [saveCollectionToFile]);

  const deleteCollectionEnvironment = useCallback((collectionId: string, envId: string) => {
    setAllCollections(prev => {
      const newCollections = prev.map(c => {
        if (c.id !== collectionId) return c;
        
        const filtered = (c.environments || []).filter(e => e.id !== envId);
        if (filtered.length > 0 && c.environments?.find(e => e.id === envId)?.isActive) {
          filtered[0].isActive = true;
        }
        
        const updated = {
          ...c,
          environments: filtered,
          updatedAt: Date.now(),
        };
        saveCollectionToFile(updated);
        return updated;
      });
      return newCollections;
    });
  }, [saveCollectionToFile]);

  const toggleCollectionEnvironmentActive = useCallback((collectionId: string, envId: string) => {
    setAllCollections(prev => {
      const newCollections = prev.map(c => {
        if (c.id !== collectionId) return c;
        
        const updated = {
          ...c,
          environments: (c.environments || []).map(e => ({
            ...e,
            isActive: e.id === envId ? !e.isActive : e.isActive,
          })),
          updatedAt: Date.now(),
        };
        saveCollectionToFile(updated);
        return updated;
      });
      return newCollections;
    });
  }, [saveCollectionToFile]);

  const setActiveCollectionEnvironment = useCallback((collectionId: string, envId: string | null) => {
    setAllCollections(prev => {
      const newCollections = prev.map(c => {
        if (c.id !== collectionId) return c;
        const updated = {
          ...c,
          defaultEnvironmentId: envId || undefined,
          updatedAt: Date.now(),
        };
        saveCollectionToFile(updated);
        return updated;
      });
      return newCollections;
    });
  }, [saveCollectionToFile]);

  const getActiveCollectionEnvironment = useCallback((collectionId: string): CollectionEnvironment | null => {
    const collection = allCollections.find(c => c.id === collectionId);
    if (!collection?.environments) return null;
    return collection.environments.find(e => e.isActive) || null;
  }, [allCollections]);

  // Sync-related functions
  const getPendingChanges = useCallback((collectionId: string): PendingSpecChanges | undefined => {
    return syncManager.getSyncState(collectionId)?.pendingChanges;
  }, []);

  const checkForUpdates = useCallback(async (collectionId: string): Promise<PendingSpecChanges | null> => {
    return syncManager.checkCollection(collectionId);
  }, []);

  const clearPendingChanges = useCallback((collectionId: string): void => {
    syncManager.clearPendingChanges(collectionId);
    const allPending = syncManager.getAllPendingChanges();
    setPendingChangesCount(allPending.reduce((sum, p) => sum + p.changes.length, 0));
  }, []);

  // Initialize sync manager (skip in web mode)
  useEffect(() => {
    if (syncInitialized.current || !initializedRef.current || isWebMode) return;
    syncInitialized.current = true;

    syncManager.initialize({
      getCollections: () => collectionsRef.current,
      updateCollection: async (id, updates) => {
        setAllCollections(prev => {
          const newCollections = prev.map(c => {
            if (c.id !== id) return c;
            const updated = { ...c, ...updates, updatedAt: Date.now() };
            saveCollectionToFile(updated);
            return updated;
          });
          return newCollections;
        });
      },
      onChangesDetected: (collectionId, changes) => {
        const allPending = syncManager.getAllPendingChanges();
        setPendingChangesCount(allPending.reduce((sum, p) => sum + p.changes.length, 0));
        
        // Dispatch custom event for notification handling
        const collection = collectionsRef.current.find(c => c.id === collectionId);
        if (collection) {
          window.dispatchEvent(new CustomEvent('echolon:sync-changes-detected', {
            detail: {
              collectionId,
              collectionName: collection.name,
              changesCount: changes.changes.length,
            }
          }));
        }
      },
      onSyncComplete: () => {
        const allPending = syncManager.getAllPendingChanges();
        setPendingChangesCount(allPending.reduce((sum, p) => sum + p.changes.length, 0));
      },
      onSyncError: (collectionId, error) => {
        console.warn(`Sync error for collection ${collectionId}:`, error);
      },
    });

    return () => {
      syncManager.cleanup();
      syncInitialized.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveCollectionToFile, isWebMode]);

  const refreshCollections = useCallback(async () => {
    await refreshData();
  }, [refreshData]);

  return (
    <CollectionsContext.Provider
      value={{
        collections,
        allCollections,
        isLoading,
        addCollection,
        updateCollection,
        deleteCollection,
        importCollection,
        addWebModeCollection,
        moveCollection,
        addRequest,
        updateRequest,
        deleteRequest,
        moveRequestToCollection,
        addFolder,
        updateFolder,
        deleteFolder,
        collapseAllFolders,
        expandAllFolders,
        getRequest,
        searchCollections,
        addCollectionEnvironment,
        updateCollectionEnvironment,
        deleteCollectionEnvironment,
        toggleCollectionEnvironmentActive,
        setActiveCollectionEnvironment,
        getActiveCollectionEnvironment,
        pendingChangesCount,
        getPendingChanges,
        clearPendingChanges,
        checkForUpdates,
        refreshCollections,
      }}
    >
      {children}
    </CollectionsContext.Provider>
  );
};

export const useCollections = () => {
  const context = useContext(CollectionsContext);
  if (!context) {
    throw new Error('useCollections must be used within CollectionsProvider');
  }
  return context;
};

export default CollectionsContext;
