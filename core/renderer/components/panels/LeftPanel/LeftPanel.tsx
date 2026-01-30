import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { 
  Button, SearchInput, CollapsibleList, CollapsibleListItem, ContextMenu, useContextMenu, Tooltip, Switch,
  DropPosition, Modal
} from '@/components/ui';
import { 
  RadarIcon, PlusIcon, FolderIcon, ImportIcon, PlayIcon, StopIcon, ServerIcon, SocketIcon, GraphQLIcon, 
  MailIcon, CollapseAllIcon, ExpandAllIcon, EditIcon, CopyIcon, ExportIcon, TrashIcon, OpenIcon, NewTabIcon, MoveIcon,
  WorkspacesIcon, SortAscIcon, SortDescIcon, AlertIcon, WarningIcon, CollectionsIcon, EnvironmentsIcon, HistoryIcon,
  ExternalLinkIcon
} from '@/components/ui/icons';
import { useApp, useCollections, useRequest, useEnvironments, useMocking, useWebMode, useToast, useWorkspace } from '@/contexts';
import { GitPanel } from '@/components/panels/GitPanel';
import { GitHubConnectModal } from '@/components/modals/GitHubConnectModal';
import { requestService } from '@/services';
import { Collection, Request, Folder, MockAPI, WebSocketConnection } from '@/types';
import { METHOD_COLORS } from '../../../../shared/constants';
import { formatTime } from '@/utils';
import './LeftPanel.css';

const getMethodColor = (method: string): string => {
  return METHOD_COLORS[method] || '#9ca3af';
};

// Helper function to count all requests in a folder (recursively)
const countFolderRequests = (folder: Folder): number => {
  return folder.requests.length + folder.folders.reduce((sum, f) => sum + countFolderRequests(f), 0);
};

// Helper function to count all requests in a collection
const countCollectionRequests = (collection: Collection): number => {
  return collection.requests.length + collection.folders.reduce((sum, f) => sum + countFolderRequests(f), 0);
};

export const LeftPanel: React.FC = () => {
  const { sidebarView, openImportModal, openNewCollectionModal, openNewEnvironmentModal, openMoveCollectionModal } = useApp();
  const { collections, deleteCollection, addRequest, updateRequest, updateCollection, updateFolder, collapseAllFolders, expandAllFolders, moveRequestToCollection, deleteRequest, addFolder, deleteFolder, reorderCollections, sortCollections, reorderFolders, importCollection } = useCollections();
  const { environments, toggleEnvironmentActive, deleteEnvironment } = useEnvironments();
  const { addTab, addSampleTab, addCollectionTab, addEnvironmentTab, addWorkspaceTab, history, closeTab, tabs: allTabs, workspaceTabs: tabs, setActiveTab, renameTab, activeTabId, activeTab } = useRequest();
  const { 
    mockApis, 
    activeMockApiId, 
    addMockApi, 
    deleteMockApi, 
    setActiveMockApi,
    startMockServer,
    stopMockServer,
    localHostname 
  } = useMocking();
  const { readonly, isWebMode } = useWebMode();
  const { workspaces, addWorkspace, activeWorkspaceId, reorderWorkspaces, getWorkspaceNameById } = useWorkspace();
  const { error: showError } = useToast();
  
  // Scroll sync state - listen for events from CollectionEditor
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [activeRequestIdFromScroll, setActiveRequestIdFromScroll] = useState<string | null>(null);
  const [activeReferenceCollectionId, setActiveReferenceCollectionId] = useState<string | null>(null);
  
  // Flag to suppress auto-scroll when click originated from LeftPanel
  const suppressAutoScrollRef = useRef(false);
  
  // Flag to suppress auto-scroll during drag operations
  const isDraggingRef = useRef(false);
  
  // Ref to the scroll container
  const leftPanelContentRef = useRef<HTMLDivElement>(null);
  
  // Listen for scroll sync events from CollectionEditor
  useEffect(() => {
    const handleScrollSync = (event: CustomEvent<{ folderId: string | null; requestId: string | null; collectionId: string | null }>) => {
      // When click originated from LeftPanel, skip all updates
      // State was already set directly in handleOpenRequest to prevent folder flash
      if (suppressAutoScrollRef.current) {
        suppressAutoScrollRef.current = false;
        return;
      }
      
      const prevFolderId = activeFolderId;
      const prevRequestId = activeRequestIdFromScroll;
      
      setActiveFolderId(event.detail.folderId);
      setActiveRequestIdFromScroll(event.detail.requestId);
      setActiveReferenceCollectionId(event.detail.collectionId);
      
      // Only auto-scroll if:
      // 1. The active item actually changed
      // 2. Not currently dragging
      if (!isDraggingRef.current &&
          (event.detail.folderId !== prevFolderId || event.detail.requestId !== prevRequestId)) {
        // Scroll to the active item
        const targetId = event.detail.requestId || event.detail.folderId;
        const refsMap = event.detail.requestId ? requestItemRefs : folderItemRefs;
        
        if (targetId) {
          const element = refsMap.current.get(targetId);
          const scrollContainer = leftPanelContentRef.current;
          
          if (element && scrollContainer) {
            // Calculate if element is visible in the scroll container
            const containerRect = scrollContainer.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();
            
            // Check if element is outside the visible area of the container
            const isAbove = elementRect.top < containerRect.top;
            const isBelow = elementRect.bottom > containerRect.bottom;
            
            if (isAbove || isBelow) {
              // Calculate the element's position relative to the scroll container's content
              const elementTopRelativeToContainer = elementRect.top - containerRect.top + scrollContainer.scrollTop;
              const containerHeight = scrollContainer.clientHeight;
              const elementHeight = elementRect.height;
              
              let targetScrollTop: number;
              if (isBelow) {
                // Scroll so element is at the bottom of the visible area (with small padding)
                targetScrollTop = elementTopRelativeToContainer - containerHeight + elementHeight + 16;
              } else {
                // Scroll so element is at the top of the visible area (with small padding)
                targetScrollTop = elementTopRelativeToContainer - 16;
              }
              
              scrollContainer.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
            }
          }
        }
      }
    };
    
    window.addEventListener('referenceScrollSync', handleScrollSync as EventListener);
    return () => {
      window.removeEventListener('referenceScrollSync', handleScrollSync as EventListener);
    };
  }, [activeFolderId, activeRequestIdFromScroll]);
  
  // Clear reference active state when the reference tab is closed
  useEffect(() => {
    if (activeTab?.type !== 'collection') {
      setActiveFolderId(null);
      setActiveRequestIdFromScroll(null);
      setActiveReferenceCollectionId(null);
    }
  }, [activeTab?.type]);
  
  const [searchQuery, setSearchQuery] = useState('');
  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu();
  const [contextTarget, setContextTarget] = useState<{ type: string; item: unknown; collectionId?: string; folderId?: string } | null>(null);
  
  // Unified drag and drop state
  interface DragState {
    type: 'collection' | 'request' | 'folder' | 'workspace';
    id: string;
    collectionId?: string;
    folderId?: string;
    fromIndex?: number;
  }
  
  interface DropTarget {
    type: 'collection' | 'request' | 'folder' | 'workspace';
    id: string;
    position: DropPosition;
    collectionId?: string;
    folderId?: string;
    index?: number;
  }
  
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  
  // Use a ref for synchronous access to drag state (state updates are async)
  const dragStateRef = useRef<DragState | null>(null);
  
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [editingCollectionName, setEditingCollectionName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [gitHubConnectModalOpen, setGitHubConnectModalOpen] = useState(false);
  
  // Delete confirmation modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'collection' | 'request' | 'folder' | 'environment';
    id: string;
    name: string;
    collectionId?: string;
    folderId?: string;
  } | null>(null);

  // Refs for scrolling to active request and folder
  const requestItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const folderItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  
  // Get the active request ID from the active tab
  const activeRequestId = activeTab?.type === 'request' ? activeTab.request?.id : null;

  // Helper to find request's parent collection and folder path
  const findRequestPath = useCallback((requestId: string): { collectionId: string; folderIds: string[] } | null => {
    for (const collection of collections) {
      // Check direct requests
      if (collection.requests.some(r => r.id === requestId)) {
        return { collectionId: collection.id, folderIds: [] };
      }
      
      // Check folders recursively
      const searchFolder = (folder: Folder, path: string[]): string[] | null => {
        if (folder.requests.some(r => r.id === requestId)) {
          return [...path, folder.id];
        }
        for (const subFolder of folder.folders) {
          const result = searchFolder(subFolder, [...path, folder.id]);
          if (result) return result;
        }
        return null;
      };
      
      for (const folder of collection.folders) {
        const folderPath = searchFolder(folder, []);
        if (folderPath) {
          return { collectionId: collection.id, folderIds: folderPath };
        }
      }
    }
    return null;
  }, [collections]);

  // Track the previous active tab to detect actual tab changes
  const prevActiveTabIdRef = useRef<string | null>(null);

  // Scroll to active request and expand parent collection/folders when tab changes
  useEffect(() => {
    // Only run when activeTabId actually changes to a new value
    if (prevActiveTabIdRef.current === activeTabId) {
      return;
    }
    prevActiveTabIdRef.current = activeTabId;

    if (!activeRequestId || sidebarView !== 'collections') return;

    // Find the request's collection and folder path
    const requestPath = findRequestPath(activeRequestId);
    if (requestPath) {
      // Expand the collection if collapsed
      const collection = collections.find(c => c.id === requestPath.collectionId);
      if (collection?.collapsed) {
        updateCollection(requestPath.collectionId, { collapsed: false });
      }
      
      // Helper to check if a folder is collapsed
      const isFolderCollapsed = (folders: Folder[], folderId: string): boolean => {
        for (const folder of folders) {
          if (folder.id === folderId) return folder.collapsed === true;
          const found = isFolderCollapsed(folder.folders, folderId);
          if (found) return found;
        }
        return false;
      };
      
      // Expand any parent folders that are collapsed
      if (collection) {
      requestPath.folderIds.forEach(folderId => {
          if (isFolderCollapsed(collection.folders, folderId)) {
        updateFolder(requestPath.collectionId, folderId, { collapsed: false });
          }
      });
      }
    }

    // Scroll to the request item after a brief delay (to allow DOM to update)
    // Skip if currently dragging to avoid jarring scroll behavior
    if (isDraggingRef.current) return;
    
    const scrollTimeout = setTimeout(() => {
      const element = requestItemRefs.current.get(activeRequestId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 100);

    return () => clearTimeout(scrollTimeout);
  }, [activeTabId, activeRequestId, sidebarView, findRequestPath, collections, updateCollection, updateFolder]);

  // Callback ref to store request item refs
  const setRequestRef = useCallback((requestId: string, element: HTMLDivElement | null) => {
    if (element) {
      requestItemRefs.current.set(requestId, element);
    } else {
      requestItemRefs.current.delete(requestId);
    }
  }, []);

  // Callback ref to store folder item refs
  const setFolderRef = useCallback((folderId: string, element: HTMLDivElement | null) => {
    if (element) {
      folderItemRefs.current.set(folderId, element);
    } else {
      folderItemRefs.current.delete(folderId);
    }
  }, []);


  const handleOpenRequest = (request: Request, collectionId?: string, folderId?: string) => {
    // Check if active tab is a collection tab for this collection
    // If so, dispatch event to scroll to request in Reference tab instead of opening new tab
    if (activeTab?.type === 'collection' && activeTab.collectionId === collectionId) {
      // Suppress scroll sync updates since we'll set state directly
      suppressAutoScrollRef.current = true;
      
      // Immediately set active state to highlight the clicked request
      // This prevents folder flash by ensuring requestId is set before any scroll events
      setActiveFolderId(folderId || null);
      setActiveRequestIdFromScroll(request.id);
      setActiveReferenceCollectionId(collectionId || null);
      
      const event = new CustomEvent('scrollToRequestInReference', {
        detail: { requestId: request.id, collectionId, folderId },
        bubbles: true,
        cancelable: true
      });
      const handled = !window.dispatchEvent(event);
      if (handled) return; // Event was handled by CollectionEditor
    }
    
    // Check if a tab for this request already exists
    const existingTab = tabs.find(t => t.type === 'request' && t.request?.id === request.id);
    if (existingTab) {
      setActiveTab(existingTab.id);
      return;
    }
    
    // Ensure collectionId is set on the request when opening from a collection
    const requestWithCollection = collectionId && !request.collectionId 
      ? { ...request, collectionId } 
      : request;
    addTab(requestWithCollection);
  };

  const handleOpenEnvironment = (env: typeof environments[0]) => {
    addEnvironmentTab(env);
  };

  const handleCollectionContextMenu = (e: React.MouseEvent, collection: Collection) => {
    setContextTarget({ type: 'collection', item: collection });
    showContextMenu(e);
  };

  const handleRequestContextMenu = (e: React.MouseEvent, request: Request, collectionId?: string, folderId?: string) => {
    setContextTarget({ type: 'request', item: request, collectionId, folderId });
    showContextMenu(e);
  };

  // Handle context menu on list area (outside collections)
  const handleListAreaContextMenu = (e: React.MouseEvent) => {
    // Only show if clicking directly on the list, not on a collection
    if ((e.target as HTMLElement).closest('.collapsible-list')) return;
    setContextTarget({ type: 'listArea', item: null });
    showContextMenu(e);
  };

  // Unified drag handlers
  const handleDragStart = useCallback((
    e: React.DragEvent, 
    type: 'collection' | 'request' | 'folder' | 'workspace',
    id: string,
    collectionId?: string,
    folderId?: string,
    index?: number,
    additionalData?: Record<string, unknown>
  ) => {
    // CRITICAL: Stop propagation to prevent parent draggable elements from overwriting
    e.stopPropagation();
    
    isDraggingRef.current = true;
    const state: DragState = { type, id, collectionId, folderId, fromIndex: index };
    dragStateRef.current = state; // Set ref immediately for synchronous access
    setDragState(state);
    
    e.dataTransfer.setData('application/json', JSON.stringify({ 
      type, 
      data: { id, collectionId, folderId, index, ...additionalData }
    }));
    e.dataTransfer.effectAllowed = 'move';
    
    // Add visual feedback
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.classList.add('dragging');
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
    dragStateRef.current = null; // Clear ref immediately
    setDragState(null);
    setDropTarget(null);
  }, []);

  const calculateDropPosition = useCallback((e: React.DragEvent, element: HTMLElement, canDropInside: boolean): DropPosition => {
    const rect = element.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const height = rect.height;
    
    if (canDropInside) {
      // Three zones: top 25% = before, middle 50% = inside, bottom 25% = after
      if (relativeY < height * 0.25) return 'before';
      if (relativeY > height * 0.75) return 'after';
      return 'inside';
    } else {
      // Two zones: top 50% = before, bottom 50% = after
      return relativeY < height * 0.5 ? 'before' : 'after';
    }
  }, []);

  const handleDragOver = useCallback((
    e: React.DragEvent,
    targetType: 'collection' | 'request' | 'folder' | 'workspace',
    targetId: string,
    collectionId?: string,
    folderId?: string,
    index?: number
  ) => {
    const currentDragState = dragStateRef.current;
    if (!currentDragState) return;
    
    // Don't allow dropping on self
    if (currentDragState.id === targetId) {
      setDropTarget(null);
      return;
    }
    
    // Determine if we can drop inside this target
    const canDropInside = currentDragState.type === 'request' && (targetType === 'collection' || targetType === 'folder');
    
    // Collections can only reorder, not drop inside each other
    if (currentDragState.type === 'collection' && targetType === 'collection') {
      const position = calculateDropPosition(e, e.currentTarget as HTMLElement, false);
      setDropTarget({ type: targetType, id: targetId, position, index });
      e.dataTransfer.dropEffect = 'move';
      return;
    }
    
    // Requests can drop between requests or inside folders/collections
    if (currentDragState.type === 'request') {
      const position = calculateDropPosition(e, e.currentTarget as HTMLElement, canDropInside);
      setDropTarget({ type: targetType, id: targetId, position, collectionId, folderId, index });
      e.dataTransfer.dropEffect = 'move';
      return;
    }
    
    // Folders can reorder or drop inside collections/other folders (future)
    if (currentDragState.type === 'folder') {
      const position = calculateDropPosition(e, e.currentTarget as HTMLElement, false);
      setDropTarget({ type: targetType, id: targetId, position, collectionId, folderId, index });
      e.dataTransfer.dropEffect = 'move';
      return;
    }

    // Workspaces can only reorder among themselves
    if (currentDragState.type === 'workspace' && targetType === 'workspace') {
      const position = calculateDropPosition(e, e.currentTarget as HTMLElement, false);
      setDropTarget({ type: targetType, id: targetId, position, index });
      e.dataTransfer.dropEffect = 'move';
    }
  }, [calculateDropPosition]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if we're actually leaving this element (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDropTarget(null);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const currentDragState = dragStateRef.current;
    if (!currentDragState || !dropTarget) {
      dragStateRef.current = null;
      setDragState(null);
      setDropTarget(null);
      return;
    }
    
    try {
      // Handle collection reordering
      if (currentDragState.type === 'collection' && dropTarget.type === 'collection') {
        const fromIndex = currentDragState.fromIndex!;
        let toIndex = dropTarget.index!;
        
        if (dropTarget.position === 'after') {
          toIndex += 1;
        }
        if (fromIndex < toIndex) {
          toIndex -= 1;
        }
        if (fromIndex !== toIndex) {
          reorderCollections(fromIndex, toIndex);
        }
      }
      
      // Handle request movement
      if (currentDragState.type === 'request') {
        // Helper to recursively get all requests from folders
        const getAllRequestsFromFolders = (folders: Folder[]): Request[] => {
          return folders.flatMap(f => [...f.requests, ...getAllRequestsFromFolders(f.folders)]);
        };
        
        // Search in collections first
        let request = collections
          .flatMap(c => [...c.requests, ...getAllRequestsFromFolders(c.folders)])
          .find(r => r.id === currentDragState.id);
        
        // If not found in collections, search in standalone items (tabs)
        let standaloneTabId: string | undefined;
        if (!request) {
          const standaloneTab = tabs.find(tab => 
            tab.type === 'request' && tab.request?.id === currentDragState.id
          );
          if (standaloneTab?.request) {
            request = standaloneTab.request;
            standaloneTabId = standaloneTab.id;
          }
        }
        
        if (request) {
          const targetCollectionId = dropTarget.collectionId || dropTarget.id;
          const targetFolderId = dropTarget.type === 'folder' ? dropTarget.id : dropTarget.folderId;
          
          if (dropTarget.position === 'inside') {
            // Drop inside a folder or collection - insert at the first position
            moveRequestToCollection(request, currentDragState.collectionId || null, targetCollectionId, targetFolderId, 0);
            // Close the standalone tab if this was a standalone request
            if (standaloneTabId) {
              closeTab(standaloneTabId);
            }
          } else {
            // Drop at a position (before/after another request)
            let insertIndex = dropTarget.index ?? 0;
            if (dropTarget.position === 'after') {
              insertIndex += 1;
            }
            
            // Adjust index when moving within the same collection/folder
            // because the source item will be removed first
            const sameCollection = currentDragState.collectionId === targetCollectionId;
            const sameFolder = currentDragState.folderId === targetFolderId;
            if (sameCollection && sameFolder && currentDragState.fromIndex !== undefined) {
              if (currentDragState.fromIndex < insertIndex) {
                insertIndex -= 1;
              }
              // Skip if dropping at the same position
              if (currentDragState.fromIndex === insertIndex) {
                dragStateRef.current = null;
                setDragState(null);
                setDropTarget(null);
                return;
              }
            }
            
            moveRequestToCollection(request, currentDragState.collectionId || null, targetCollectionId, targetFolderId, insertIndex);
            // Close the standalone tab if this was a standalone request
            if (standaloneTabId) {
              closeTab(standaloneTabId);
            }
          }
        }
      }
      
      // Handle folder reordering
      if (currentDragState.type === 'folder' && dropTarget.type === 'folder') {
        const fromIndex = currentDragState.fromIndex!;
        let toIndex = dropTarget.index!;
        
        if (dropTarget.position === 'after') {
          toIndex += 1;
        }
        if (fromIndex < toIndex) {
          toIndex -= 1;
        }
        if (fromIndex !== toIndex && currentDragState.collectionId) {
          reorderFolders(currentDragState.collectionId, fromIndex, toIndex);
        }
      }

      // Handle workspace reordering
      if (currentDragState.type === 'workspace' && dropTarget.type === 'workspace') {
        const fromIndex = currentDragState.fromIndex!;
        let toIndex = dropTarget.index!;
        
        if (dropTarget.position === 'after') {
          toIndex += 1;
        }
        if (fromIndex < toIndex) {
          toIndex -= 1;
        }
        if (fromIndex !== toIndex) {
          reorderWorkspaces(fromIndex, toIndex);
        }
      }
    } catch (err) {
      console.error('Drop error:', err);
    }
    
    dragStateRef.current = null;
    setDragState(null);
    setDropTarget(null);
  }, [dropTarget, collections, moveRequestToCollection, reorderCollections]);

  // Helper to get drop indicator for an item
  const getDropIndicator = useCallback((
    targetType: 'collection' | 'request' | 'folder' | 'workspace',
    targetId: string
  ): DropPosition | null => {
    if (!dropTarget || dropTarget.id !== targetId || dropTarget.type !== targetType) {
      return null;
    }
    return dropTarget.position;
  }, [dropTarget]);

  const handleAddRequestToCollection = (collection: Collection) => {
    const req = requestService.createEmptyRequest();
    req.collectionId = collection.id;
    req.name = 'New Request';
    // Add request to the collection
    addRequest(collection.id, req);
    // Open it in a tab
    addTab(req);
  };

  const handleAddRequestToFolder = (collectionId: string, folderId: string) => {
    const req = requestService.createEmptyRequest();
    req.collectionId = collectionId;
    req.folderId = folderId;
    req.name = 'New Request';
    // Add request to the folder
    addRequest(collectionId, req, folderId);
    // Open it in a tab
    addTab(req);
  };

  const handleFolderContextMenu = (e: React.MouseEvent, folder: Folder, collectionId: string) => {
    setContextTarget({ type: 'folder', item: folder, collectionId });
    showContextMenu(e);
  };

  const getContextMenuItems = () => {
    if (!contextTarget) return [];

    if (contextTarget.type === 'collection') {
      const collection = contextTarget.item as Collection;
      const hasFolders = collection.folders.length > 0;
      
      // In readonly mode, only show view options
      if (readonly) {
        return [
          ...(hasFolders ? [
            { id: 'collapse-all', label: 'Collapse All Folders', icon: <CollapseAllIcon />, onClick: () => {
              collapseAllFolders(collection.id);
            }},
            { id: 'expand-all', label: 'Expand All Folders', icon: <ExpandAllIcon />, onClick: () => {
              expandAllFolders(collection.id);
            }},
          ] : []),
        ];
      }
      
      return [
        { id: 'new-request', label: 'Add Request', icon: <PlusIcon />, shortcut: '⌘N', onClick: () => {
          handleAddRequestToCollection(collection);
        }},
        { id: 'new-folder', label: 'Add Folder', icon: <FolderIcon />, onClick: () => {
          addFolder(collection.id, 'New Folder');
        }},
        { id: 'divider1', label: '', divider: true },
        { id: 'rename', label: 'Rename', icon: <EditIcon />, onClick: () => {
          // Open the collection tab to rename
          addCollectionTab(collection);
        }},
        { id: 'duplicate', label: 'Duplicate', icon: <CopyIcon />, onClick: async () => {
          // Helper to generate new IDs for folders recursively
          const cloneFolders = (folders: Folder[]): Folder[] => {
            return folders.map(folder => ({
              ...folder,
              id: uuidv4(),
              requests: folder.requests.map(r => ({ ...r, id: uuidv4() })),
              folders: cloneFolders(folder.folders),
            }));
          };
          
          // Create a deep copy with new IDs
          const duplicatedCollection: Collection = {
            ...collection,
            id: uuidv4(),
            name: `${collection.name} (Copy)`,
            requests: collection.requests.map(r => ({ ...r, id: uuidv4() })),
            folders: cloneFolders(collection.folders),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          
          await importCollection(duplicatedCollection);
        }},
        { id: 'move', label: 'Move to Workspace', icon: <MoveIcon />, onClick: () => {
          openMoveCollectionModal(collection);
        }},
        { id: 'export', label: 'Export', icon: <ExportIcon />, onClick: () => {} },
        // Show in Finder - only available in Electron (not web)
        ...(window.electronAPI ? [
          { id: 'show-in-finder', label: 'Show in Finder', icon: <ExternalLinkIcon />, onClick: () => {
            const workspaceName = getWorkspaceNameById(collection.workspaceId || '');
            if (workspaceName) {
              window.electronAPI.showCollectionInFinder(workspaceName, collection.name);
            }
          }},
        ] : []),
        ...(hasFolders ? [
          { id: 'divider-folders', label: '', divider: true },
          { id: 'collapse-all', label: 'Collapse All Folders', icon: <CollapseAllIcon />, onClick: () => {
            collapseAllFolders(collection.id);
          }},
          { id: 'expand-all', label: 'Expand All Folders', icon: <ExpandAllIcon />, onClick: () => {
            expandAllFolders(collection.id);
          }},
        ] : []),
        { id: 'divider2', label: '', divider: true },
        { id: 'delete', label: 'Delete', icon: <TrashIcon />, danger: true, onClick: () => {
          setDeleteTarget({
            type: 'collection',
            id: collection.id,
            name: collection.name,
          });
          setDeleteModalOpen(true);
        }},
      ];
    }

    if (contextTarget.type === 'request') {
      // In readonly mode, only show view options
      if (readonly) {
        return [
          { id: 'open', label: 'Open', icon: <OpenIcon />, onClick: () => {
            handleOpenRequest(contextTarget.item as Request);
          }},
          /*{ id: 'open-new-tab', label: 'Open in New Tab', icon: <NewTabIcon />, onClick: () => {
            handleOpenRequest(contextTarget.item as Request);
          }},*/
        ];
      }
      
      return [
        { id: 'open', label: 'Open', icon: <OpenIcon />, onClick: () => {
          handleOpenRequest(contextTarget.item as Request);
        }},
        { id: 'open-new-tab', label: 'Open in New Tab', icon: <NewTabIcon />, onClick: () => {
          handleOpenRequest(contextTarget.item as Request);
        }},
        { id: 'divider1', label: '', divider: true },
        { id: 'duplicate', label: 'Duplicate', icon: <CopyIcon />, onClick: () => {
          const originalRequest = contextTarget.item as Request;
          const collectionId = contextTarget.collectionId || originalRequest.collectionId;
          const folderId = contextTarget.folderId || originalRequest.folderId;
          const duplicated = requestService.duplicateRequest(originalRequest);
          
          // If the original request belongs to a collection, add the duplicate to the same collection/folder
          if (collectionId) {
            duplicated.collectionId = collectionId;
            duplicated.folderId = folderId;
            addRequest(collectionId, duplicated, folderId);
          }
          
          addTab(duplicated);
        }},
        { id: 'deprecate', label: (contextTarget.item as Request).isDeprecated ? 'Remove Deprecation' : 'Deprecate', icon: <WarningIcon />, onClick: () => {
          const request = contextTarget.item as Request;
          const collectionId = contextTarget.collectionId || request.collectionId;
          if (collectionId) {
            updateRequest(collectionId, request.id, { isDeprecated: !request.isDeprecated });
          }
        }},
        { id: 'divider2', label: '', divider: true },
        { id: 'delete', label: 'Delete', icon: <TrashIcon />, danger: true, onClick: () => {
          const request = contextTarget.item as Request;
          const collectionId = contextTarget.collectionId || request.collectionId;
          const folderId = contextTarget.folderId || request.folderId;
          if (collectionId) {
            setDeleteTarget({
              type: 'request',
              id: request.id,
              name: request.name,
              collectionId,
              folderId,
            });
            setDeleteModalOpen(true);
          }
        }},
      ];
    }

    if (contextTarget.type === 'folder') {
      const folder = contextTarget.item as Folder;
      const collectionId = contextTarget.collectionId!;
      
      if (readonly) return [];
      
      return [
        { id: 'add-request', label: 'Add Request', icon: <PlusIcon />, onClick: () => {
          handleAddRequestToFolder(collectionId, folder.id);
        }},
        { id: 'add-subfolder', label: 'Add Subfolder', icon: <FolderIcon />, onClick: () => {
          addFolder(collectionId, 'New Folder', folder.id);
        }},
        { id: 'divider1', label: '', divider: true },
        { id: 'rename', label: 'Rename', icon: <EditIcon />, onClick: () => {
          handleStartEditingFolder(folder);
        }},
        { id: 'deprecate', label: folder.isDeprecated ? 'Remove Deprecation' : 'Deprecate', icon: <WarningIcon />, onClick: () => {
          updateFolder(collectionId, folder.id, { isDeprecated: !folder.isDeprecated });
        }},
        { id: 'divider2', label: '', divider: true },
        { id: 'delete', label: 'Delete', icon: <TrashIcon />, danger: true, onClick: () => {
          setDeleteTarget({
            type: 'folder',
            id: folder.id,
            name: folder.name,
            collectionId,
          });
          setDeleteModalOpen(true);
        }},
      ];
    }

    if (contextTarget.type === 'mockApi') {
      const mockApi = contextTarget.item as MockAPI;
      return [
        { id: 'open', label: 'Open', icon: <OpenIcon />, onClick: () => {
          setActiveMockApi(mockApi.id);
        }},
        { id: 'divider1', label: '', divider: true },
        { id: mockApi.isRunning ? 'stop' : 'start', label: mockApi.isRunning ? 'Stop Server' : 'Start Server', icon: mockApi.isRunning ? <StopIcon /> : <PlayIcon />, onClick: async () => {
          if (mockApi.isRunning) {
            await stopMockServer(mockApi.id);
          } else {
            const result = await startMockServer(mockApi.id);
            if (!result.success) {
              showError('Server failed to start', result.error || 'Failed to start mock server');
            }
          }
        }},
        { id: 'divider2', label: '', divider: true },
        { id: 'delete', label: 'Delete', icon: <TrashIcon />, danger: true, onClick: () => {
          deleteMockApi(mockApi.id);
        }},
      ];
    }

    if (contextTarget.type === 'standaloneRequest') {
      const { tab } = contextTarget.item as { tab: typeof tabs[0]; request: Request };
      return [
        { id: 'open', label: 'Open', icon: <OpenIcon />, onClick: () => {
          setActiveTab(tab.id);
        }},
        { id: 'divider1', label: '', divider: true },
        { id: 'duplicate', label: 'Duplicate', icon: <CopyIcon />, onClick: () => {
          const duplicated = requestService.duplicateRequest(tab.request!);
          addTab(duplicated);
        }},
        { id: 'divider2', label: '', divider: true },
        { id: 'close', label: 'Close', icon: <TrashIcon />, danger: true, onClick: () => {
          closeTab(tab.id);
        }},
      ];
    }

    if (contextTarget.type === 'standaloneWebSocket') {
      const { tab } = contextTarget.item as { tab: typeof tabs[0]; websocket: unknown };
      return [
        { id: 'open', label: 'Open', icon: <OpenIcon />, onClick: () => {
          setActiveTab(tab.id);
        }},
        { id: 'divider1', label: '', divider: true },
        { id: 'close', label: 'Close', icon: <TrashIcon />, danger: true, onClick: () => {
          closeTab(tab.id);
        }},
      ];
    }

    // List area context menu (for sorting collections)
    if (contextTarget.type === 'listArea') {
      if (readonly) return [];
      
      return [
        { id: 'sort-asc', label: 'Sort by Name (A-Z)', icon: <SortAscIcon />, onClick: () => {
          sortCollections('asc');
        }},
        { id: 'sort-desc', label: 'Sort by Name (Z-A)', icon: <SortDescIcon />, onClick: () => {
          sortCollections('desc');
        }},
      ];
    }

    // Environment context menu
    if (contextTarget.type === 'environment') {
      const env = contextTarget.item as typeof environments[0];
      return [
        { id: 'open', label: 'Open', icon: <OpenIcon />, onClick: () => {
          handleOpenEnvironment(env);
        }},
        { id: 'divider1', label: '', divider: true },
        { id: 'delete', label: 'Delete', icon: <TrashIcon />, danger: true, onClick: () => {
          setDeleteTarget({
            type: 'environment',
            id: env.id,
            name: env.name,
          });
          setDeleteModalOpen(true);
        }},
      ];
    }

    return [];
  };

  const handleStartEditing = (request: Request) => {
    setEditingRequestId(request.id);
    setEditingName(request.name);
  };

  const handleFinishEditing = (request: Request, collectionId: string) => {
    if (editingName.trim() && editingName !== request.name) {
      const newName = editingName.trim();
      // Update in collection
      updateRequest(collectionId, request.id, { name: newName });
      // Also update any open tab for this request
      const existingTab = tabs.find(t => t.type === 'request' && t.request?.id === request.id);
      if (existingTab) {
        renameTab(existingTab.id, newName);
      }
    }
    setEditingRequestId(null);
    setEditingName('');
  };

  const handleCancelEditing = () => {
    setEditingRequestId(null);
    setEditingName('');
  };

  // Collection name editing handlers
  const handleStartEditingCollection = (collection: Collection) => {
    setEditingCollectionId(collection.id);
    setEditingCollectionName(collection.name);
  };

  const handleFinishEditingCollection = (collection: Collection) => {
    if (editingCollectionName.trim() && editingCollectionName !== collection.name) {
      const newName = editingCollectionName.trim();
      // Update the collection
      updateCollection(collection.id, { name: newName });
      // Also update any open collection tab
      const existingTab = tabs.find(t => t.type === 'collection' && t.collectionId === collection.id);
      if (existingTab) {
        renameTab(existingTab.id, newName);
      }
    }
    setEditingCollectionId(null);
    setEditingCollectionName('');
  };

  const handleCancelEditingCollection = () => {
    setEditingCollectionId(null);
    setEditingCollectionName('');
  };

  // Folder name editing handlers
  const handleStartEditingFolder = (folder: Folder) => {
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
  };

  const handleFinishEditingFolder = (folder: Folder, collectionId: string) => {
    if (editingFolderName.trim() && editingFolderName !== folder.name) {
      const newName = editingFolderName.trim();
      updateFolder(collectionId, folder.id, { name: newName });
    }
    setEditingFolderId(null);
    setEditingFolderName('');
  };

  const handleCancelEditingFolder = () => {
    setEditingFolderId(null);
    setEditingFolderName('');
  };

  // Handle delete confirmation
  const handleConfirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    
    if (deleteTarget.type === 'collection') {
      // Close any tabs related to this collection
      allTabs.forEach(tab => {
        if (tab.collectionId === deleteTarget.id || tab.request?.collectionId === deleteTarget.id) {
          closeTab(tab.id);
        }
      });
      deleteCollection(deleteTarget.id);
    } else if (deleteTarget.type === 'request' && deleteTarget.collectionId) {
      // Close any tabs with this request
      allTabs.forEach(tab => {
        if (tab.request?.id === deleteTarget.id) {
          closeTab(tab.id);
        }
      });
      deleteRequest(deleteTarget.collectionId, deleteTarget.id, deleteTarget.folderId);
    } else if (deleteTarget.type === 'folder' && deleteTarget.collectionId) {
      deleteFolder(deleteTarget.collectionId, deleteTarget.id);
    } else if (deleteTarget.type === 'environment') {
      // Close any tabs with this environment
      allTabs.forEach(tab => {
        if (tab.type === 'environment' && tab.environmentId === deleteTarget.id) {
          closeTab(tab.id);
        }
      });
      deleteEnvironment(deleteTarget.id);
    }
    
    setDeleteModalOpen(false);
    setDeleteTarget(null);
  }, [deleteTarget, allTabs, closeTab, deleteCollection, deleteRequest, deleteFolder]);

  // Handle dropping a request to make it standalone
  const [isStandaloneDragOver, setIsStandaloneDragOver] = useState(false);
  
  const handleStandaloneDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragStateRef.current?.type === 'request') {
      setIsStandaloneDragOver(true);
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const handleStandaloneDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsStandaloneDragOver(false);
  }, []);

  const handleStandaloneDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsStandaloneDragOver(false);
    
    const currentDragState = dragStateRef.current;
    if (currentDragState?.type !== 'request' || !currentDragState.collectionId) {
      return;
    }
    
    // Helper to recursively get all requests from folders
    const getAllRequestsFromFolders = (folders: Folder[]): Request[] => {
      return folders.flatMap(f => [...f.requests, ...getAllRequestsFromFolders(f.folders)]);
    };
    
    // Find the request
    const request = collections
      .flatMap(c => [...c.requests, ...getAllRequestsFromFolders(c.folders)])
      .find(r => r.id === currentDragState.id);
    
    if (request) {
      // Remove from collection
      deleteRequest(currentDragState.collectionId, request.id, currentDragState.folderId);
      
      // Create a new standalone tab with the request
      const standaloneRequest: Request = {
        ...request,
        collectionId: undefined,
        folderId: undefined,
      };
      addTab(standaloneRequest);
    }
    
    dragStateRef.current = null;
    setDragState(null);
    setDropTarget(null);
  }, [collections, deleteRequest, addTab]);

  const renderRequestItem = (request: Request, collectionId: string, folderId?: string, index?: number) => {
    const isEditing = editingRequestId === request.id;
    const isActive = activeRequestId === request.id;
    const isReferenceActive = activeReferenceCollectionId === collectionId && activeRequestIdFromScroll === request.id;
    const isDragging = dragState?.type === 'request' && dragState.id === request.id;
    
    return (
      <div 
        key={request.id} 
        ref={(el) => setRequestRef(request.id, el)} 
        className={isReferenceActive ? 'reference-active-request' : undefined}
      >
        <CollapsibleListItem
          icon={<span className="method-badge" style={{ color: getMethodColor(request.method) }}>{request.method}</span>}
          active={isActive || isReferenceActive}
          onClick={() => !isEditing && handleOpenRequest(request, collectionId, folderId)}
          onContextMenu={(e) => handleRequestContextMenu(e, request, collectionId, folderId)}
          onDoubleClick={() => handleStartEditing(request)}
          draggable={!readonly && !isEditing}
          onDragStart={(e) => handleDragStart(e, 'request', request.id, collectionId, folderId, index, { request })}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const currentDrag = dragStateRef.current;
            if (currentDrag?.type === 'request' && currentDrag.id !== request.id) {
              handleDragOver(e, 'request', request.id, collectionId, folderId, index);
            }
          }}
          onDragLeave={handleDragLeave}
          onDrop={(e) => {
            e.preventDefault();
            const currentDrag = dragStateRef.current;
            if (!readonly && currentDrag?.type === 'request') {
              handleDrop(e);
            }
          }}
          itemId={request.id}
          dropIndicator={getDropIndicator('request', request.id)}
          className={`${isDragging ? 'collapsible-list-item--dragging' : ''} ${request.isDeprecated ? 'collapsible-list-item--deprecated' : ''}`}
        >
          {isEditing ? (
            <input
              type="text"
              className="request-name-input"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={() => handleFinishEditing(request, collectionId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleFinishEditing(request, collectionId);
                } else if (e.key === 'Escape') {
                  handleCancelEditing();
                }
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          ) : (
            <span className={request.isDeprecated ? 'request-name--deprecated' : ''}>{request.name}</span>
          )}
        </CollapsibleListItem>
      </div>
    );
  };

  // Helper function to check if a request matches the search query
  const requestMatchesSearch = (request: Request, query: string): boolean => {
    const lowerQuery = query.toLowerCase();
    return (
      request.name.toLowerCase().includes(lowerQuery) ||
      request.method.toLowerCase().includes(lowerQuery) ||
      request.url.toLowerCase().includes(lowerQuery) ||
      (request.tags?.some(tag => tag.toLowerCase().includes(lowerQuery)) ?? false)
    );
  };

  // Helper function to filter requests in a folder based on search
  const filterFolderRequests = (folder: Folder, query: string): { folder: Folder; hasMatches: boolean } => {
    const lowerQuery = query.toLowerCase();
    const folderNameMatches = folder.name.toLowerCase().includes(lowerQuery);
    
    // Filter requests
    const matchingRequests = folder.requests.filter(r => requestMatchesSearch(r, query));
    
    // Recursively filter subfolders
    const filteredSubfolders: Folder[] = [];
    let hasSubfolderMatches = false;
    
    folder.folders.forEach(f => {
      const { folder: filteredFolder, hasMatches } = filterFolderRequests(f, query);
      if (hasMatches || folderNameMatches) {
        filteredSubfolders.push(filteredFolder);
        if (hasMatches) hasSubfolderMatches = true;
      }
    });
    
    const hasMatches = folderNameMatches || matchingRequests.length > 0 || hasSubfolderMatches;
    
    return {
      folder: {
        ...folder,
        requests: folderNameMatches ? folder.requests : matchingRequests,
        folders: filteredSubfolders,
        // Auto-expand folders with search results
        collapsed: hasMatches ? false : folder.collapsed,
      },
      hasMatches,
    };
  };

  const renderFolder = (folder: Folder, collectionId: string, index?: number) => {
    const isReferenceActive = activeReferenceCollectionId === collectionId;
    const isActiveSection = isReferenceActive && activeFolderId === folder.id && !activeRequestIdFromScroll;
    const isEditing = editingFolderId === folder.id;
    const isDragging = dragState?.type === 'folder' && dragState.id === folder.id;
    
    return (
      <div 
        key={folder.id} 
        ref={(el) => setFolderRef(folder.id, el)}
        onDragOver={(e) => {
          const dragType = dragStateRef.current?.type;
          if (!readonly && (dragType === 'folder' || dragType === 'request')) {
            e.preventDefault();
            e.stopPropagation();
            handleDragOver(e, 'folder', folder.id, collectionId, undefined, index);
          }
        }}
        onDragLeave={(e) => {
          const dragType = dragStateRef.current?.type;
          if (dragType === 'folder' || dragType === 'request') {
            e.stopPropagation();
            handleDragLeave(e);
          }
        }}
        onDrop={(e) => {
          const dragType = dragStateRef.current?.type;
          if (!readonly && (dragType === 'folder' || dragType === 'request')) {
            e.preventDefault();
            e.stopPropagation();
            handleDrop(e);
          }
        }}
      >
        <CollapsibleList
          title={folder.name}
          icon={<FolderIcon />}
          collapsed={searchQuery ? false : folder.collapsed}
          onCollapsedChange={(collapsed) => {
            updateFolder(collectionId, folder.id, { collapsed });
          }}
          onContextMenu={(e) => handleFolderContextMenu(e, folder, collectionId)}
          onTitleDoubleClick={() => !readonly && handleStartEditingFolder(folder)}
          isEditingTitle={isEditing}
          editingTitleValue={editingFolderName}
          onEditingTitleChange={setEditingFolderName}
          onEditingTitleComplete={() => handleFinishEditingFolder(folder, collectionId)}
          onEditingTitleCancel={handleCancelEditingFolder}
          className={`${isActiveSection ? 'reference-active-section' : ''} ${isDragging ? 'collapsible-list--dragging' : ''} ${folder.isDeprecated ? 'collapsible-list--deprecated' : ''}`}
          draggable={!readonly && !isEditing}
          onDragStart={(e) => handleDragStart(e, 'folder', folder.id, collectionId, undefined, index)}
          onDragEnd={handleDragEnd}
          listId={folder.id}
          dropIndicator={getDropIndicator('folder', folder.id)}
        >
          {folder.folders.map((f, idx) => renderFolder(f, collectionId, idx))}
          {folder.requests.map((r, idx) => renderRequestItem(r, collectionId, folder.id, idx))}
        </CollapsibleList>
      </div>
    );
  };

  // Enhanced search: filter collections and their contents
  const getFilteredCollections = () => {
    if (!searchQuery) return collections;
    
    const lowerQuery = searchQuery.toLowerCase();
    
    return collections
      .map(collection => {
        const collectionNameMatches = collection.name.toLowerCase().includes(lowerQuery);
        
        // Filter top-level requests
        const matchingRequests = collection.requests.filter(r => requestMatchesSearch(r, searchQuery));
        
        // Filter folders recursively
        const filteredFolders: Folder[] = [];
        let hasFolderMatches = false;
        
        collection.folders.forEach(folder => {
          const { folder: filteredFolder, hasMatches } = filterFolderRequests(folder, searchQuery);
          if (hasMatches || collectionNameMatches) {
            filteredFolders.push(filteredFolder);
            if (hasMatches) hasFolderMatches = true;
          }
        });
        
        // Include collection if its name matches, or if it has matching requests/folders
        const hasAnyMatches = collectionNameMatches || matchingRequests.length > 0 || hasFolderMatches;
        
        if (!hasAnyMatches) return null;
        
        return {
          ...collection,
          requests: collectionNameMatches ? collection.requests : matchingRequests,
          folders: filteredFolders,
          // Auto-expand collection when searching
          collapsed: false,
        } as Collection;
      })
      .filter((c): c is Collection => c !== null);
  };

  const filteredCollections = getFilteredCollections();

  // Get standalone requests and WebSocket connections (not belonging to any collection)
  const standaloneItems = useMemo(() => {
    const standaloneRequests = tabs
      .filter(tab => tab.type === 'request' && tab.request && !tab.request.collectionId)
      .map(tab => ({ type: 'request' as const, tab, item: tab.request! }));
    
    const websocketConnections = tabs
      .filter(tab => tab.type === 'websocket' && tab.websocket)
      .map(tab => ({ type: 'websocket' as const, tab, item: tab.websocket! }));
    
    return [...standaloneRequests, ...websocketConnections];
  }, [tabs]);

  // Filter standalone items by search query
  const filteredStandaloneItems = useMemo(() => {
    if (!searchQuery) return standaloneItems;
    
    const lowerQuery = searchQuery.toLowerCase();
    return standaloneItems.filter(item => {
      if (item.type === 'request') {
        return (
          item.item.name.toLowerCase().includes(lowerQuery) ||
          item.item.method.toLowerCase().includes(lowerQuery) ||
          item.item.url.toLowerCase().includes(lowerQuery)
        );
      } else {
        return (
          item.item.name.toLowerCase().includes(lowerQuery) ||
          item.item.url.toLowerCase().includes(lowerQuery)
        );
      }
    });
  }, [standaloneItems, searchQuery]);

  // Calculate total and filtered request counts for the search indicator
  const totalRequestCount = useMemo(() => {
    return collections.reduce((sum, c) => sum + countCollectionRequests(c), 0) + standaloneItems.length;
  }, [collections, standaloneItems]);

  const filteredRequestCount = useMemo(() => {
    if (!searchQuery) return totalRequestCount;
    return filteredCollections.reduce((sum, c) => sum + countCollectionRequests(c as Collection), 0) + filteredStandaloneItems.length;
  }, [searchQuery, filteredCollections, filteredStandaloneItems, totalRequestCount]);

  const filteredEnvironments = searchQuery
    ? environments.filter(e => e.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : environments;

  const filteredMockApis = searchQuery
    ? mockApis.filter(m => m.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : mockApis;

  const filteredWorkspaces = searchQuery
    ? workspaces.filter(w => 
        w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (w.description && w.description.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : workspaces;

  const handleNewMockApi = () => {
    const name = `Mock API ${mockApis.length + 1}`;
    const newApi = addMockApi(name);
    setActiveMockApi(newApi.id);
  };

  const handleNewWorkspace = async () => {
    const name = `Workspace ${workspaces.length + 1}`;
    const newWorkspace = await addWorkspace(name);
    if (newWorkspace) {
      addWorkspaceTab(newWorkspace);
    }
  };

  const handleMockApiContextMenu = (e: React.MouseEvent, mockApi: MockAPI) => {
    setContextTarget({ type: 'mockApi', item: mockApi });
    showContextMenu(e);
  };

  const handleToggleMockServer = async (e: React.MouseEvent, mockApi: MockAPI) => {
    e.stopPropagation();
    if (mockApi.isRunning) {
      await stopMockServer(mockApi.id);
    } else {
      const result = await startMockServer(mockApi.id);
      if (!result.success) {
        showError('Server failed to start', result.error || 'Failed to start mock server');
      }
    }
  };

  return (
    <div className="left-panel" data-onboarding="sidebar">
      {sidebarView != 'git' && <div className="left-panel__header">
        <SearchInput
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onClear={() => setSearchQuery('')}
          placeholder={sidebarView === 'collections' ? 'Search name, method, URL, tags...' : `Search ${sidebarView}...`}
          size="sm"
          suffix={sidebarView === 'collections' && searchQuery ? `${filteredRequestCount}/${totalRequestCount}` : undefined}
        />
        {sidebarView === 'workspaces' && (
          <Tooltip content="New Workspace">
            <Button variant="ghost" size="sm" onClick={handleNewWorkspace} className="left-panel__header-action">
              <PlusIcon />
            </Button>
          </Tooltip>
        )}
        {sidebarView === 'environments' && (
          <Tooltip content="New Environment">
            <Button variant="ghost" size="sm" onClick={openNewEnvironmentModal} className="left-panel__header-action">
              <PlusIcon />
            </Button>
          </Tooltip>
        )}
      </div>}

      <div className="left-panel__content" ref={leftPanelContentRef}>
        {sidebarView === 'collections' && (
          <>
            {!readonly && (
              <div className="left-panel__actions">
                <Button variant="ghost" size="sm" onClick={openNewCollectionModal}>
                  <PlusIcon />
                  New
                </Button>
                <Button variant="ghost" size="sm" onClick={openImportModal}>
                  <ImportIcon />
                  Import
                </Button>
              </div>
            )}

            <div 
              className="left-panel__list" 
              onContextMenu={handleListAreaContextMenu}
              onDragLeave={(e) => {
                // Clear drop target if leaving the list area entirely
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDropTarget(null);
                }
              }}
            >
              {/* Drop zone for making requests standalone */}
              {!readonly && (
                <div 
                  className={`left-panel__standalone-dropzone ${isStandaloneDragOver ? 'left-panel__standalone-dropzone--drag-over' : ''}`}
                  onDragOver={handleStandaloneDragOver}
                  onDragLeave={handleStandaloneDragLeave}
                  onDrop={handleStandaloneDrop}
                >
                  <span>Drop here to remove from collection</span>
                </div>
              )}
              
              {/* Standalone items (requests & websockets not in collections) */}
              {filteredStandaloneItems.length > 0 && (
                <div className="left-panel__standalone-section">
                  {filteredStandaloneItems.map((standaloneItem) => {
                    const { type, tab, item } = standaloneItem;
                    if (type === 'request') {
                      const request = item as Request;
                      const isDragging = dragState?.type === 'request' && dragState.id === request.id;
                      return (
                        <CollapsibleListItem
                          key={tab.id}
                          icon={
                            <span className="method-badge" style={{ color: getMethodColor(request.method) }}>
                              {request.method}
                            </span>
                          }
                          active={activeTabId === tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          onContextMenu={(e) => {
                            setContextTarget({ type: 'standaloneRequest', item: { tab, request } });
                            showContextMenu(e);
                          }}
                          draggable={!readonly}
                          onDragStart={(e) => handleDragStart(e, 'request', request.id, undefined, undefined, undefined, { request, standaloneTabId: tab.id })}
                          onDragEnd={handleDragEnd}
                          itemId={request.id}
                          className={isDragging ? 'collapsible-list-item--dragging' : ''}
                        >
                          <div className="standalone-item">
                            <span className="standalone-item__name">{request.name}</span>
                          </div>
                        </CollapsibleListItem>
                      );
                    } else {
                      const websocket = item as WebSocketConnection;
                      return (
                        <CollapsibleListItem
                          key={tab.id}
                          icon={<SocketIcon />}
                          active={activeTabId === tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          onContextMenu={(e) => {
                            setContextTarget({ type: 'standaloneWebSocket', item: { tab, websocket } });
                            showContextMenu(e);
                          }}
                        >
                          <div className="standalone-item">
                            <span className="standalone-item__name">{websocket.name}</span>
                            <span className={`standalone-item__status standalone-item__status--${websocket.status}`} />
                          </div>
                        </CollapsibleListItem>
                      );
                    }
                  })}
                </div>
              )}

              {filteredCollections.length === 0 && filteredStandaloneItems.length === 0 ? (
                <div className="left-panel__empty">
                  {searchQuery ? (
                    <>
                      <p>No results found</p>
                      <p className="left-panel__empty-hint">
                        Try searching by name, method, or URL
                      </p>
                    </>
                  ) : readonly ? (
                    <>
                      <CollectionsIcon />
                      <p>No collections loaded</p>
                      <p className="left-panel__empty-hint">
                        The API reference will appear here
                      </p>
                    </>
                  ) : (
                    <>
                      <CollectionsIcon />
                      <p>No collections yet</p>
                      <p className="left-panel__empty-hint">
                        Organize your API requests into collections
                      </p>
                      <Button variant="secondary" size="sm" onClick={openNewCollectionModal}>
                        Create Collection
                      </Button>
                      <Button variant="ghost" size="sm" onClick={addSampleTab} style={{ marginTop: '8px' }}>
                        Try Sample Request
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                filteredCollections.map((collection, collectionIndex) => {
                  const isDragging = dragState?.type === 'collection' && dragState.id === collection.id;
                  
                  return (
                    <div 
                      key={collection.id}
                      className="collection-drag-wrapper"
                      onDragOver={(e) => {
                        // Only handle collection-to-collection dragging
                        // Don't interfere with request/folder dragging inside the collection
                        if (!readonly && dragStateRef.current?.type === 'collection') {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDragOver(e, 'collection', collection.id, undefined, undefined, collectionIndex);
                        }
                      }}
                      onDragLeave={(e) => {
                        if (dragStateRef.current?.type === 'collection') {
                          e.stopPropagation();
                          handleDragLeave(e);
                        }
                      }}
                      onDrop={(e) => {
                        if (!readonly && dragStateRef.current?.type === 'collection') {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDrop(e);
                        }
                      }}
                    >
                      <CollapsibleList
                        title={collection.name}
                        subtitle={collection.type || 'REST'}
                        badge={collection.specSource?.type === 'url' ? <RadarIcon /> : undefined}
                        badgeTooltip={collection.specSource?.type === 'url' ? 'Synced from URL' : undefined}
                        collapsed={collection.collapsed}
                        onCollapsedChange={(collapsed) => {
                          updateCollection(collection.id, { collapsed });
                        }}
                        onContextMenu={(e) => handleCollectionContextMenu(e, collection)}
                        onTitleClick={() => !editingCollectionId && addCollectionTab(collection)}
                        onTitleDoubleClick={() => handleStartEditingCollection(collection)}
                        isEditingTitle={editingCollectionId === collection.id}
                        editingTitleValue={editingCollectionName}
                        onEditingTitleChange={setEditingCollectionName}
                        onEditingTitleComplete={() => handleFinishEditingCollection(collection)}
                        onEditingTitleCancel={handleCancelEditingCollection}
                        draggable={!readonly && !searchQuery && editingCollectionId !== collection.id}
                        onDragStart={(e) => handleDragStart(e, 'collection', collection.id, undefined, undefined, collectionIndex)}
                        onDragEnd={handleDragEnd}
                        listId={collection.id}
                        dropIndicator={getDropIndicator('collection', collection.id)}
                        className={isDragging ? 'collapsible-list--dragging' : ''}
                        actions={
                          !readonly && (
                            <Tooltip content="Add Request">
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAddRequestToCollection(collection);
                                }}
                                className="collection-add-btn"
                              >
                                <PlusIcon />
                              </Button>
                            </Tooltip>
                          )
                        }
                      >
                        {collection.folders.map((f, idx) => renderFolder(f, collection.id, idx))}
                        {collection.requests.map((r, idx) => renderRequestItem(r, collection.id, undefined, idx))}
                      </CollapsibleList>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {sidebarView === 'environments' && (
          <>
            <div className="left-panel__list">
              {filteredEnvironments.length === 0 ? (
                <div className="left-panel__empty">
                  <EnvironmentsIcon />
                  <p>No environments yet</p>
                  <p className="left-panel__empty-hint">
                    Store variables for different environments
                  </p>
                  <Button variant="secondary" size="sm" onClick={openNewEnvironmentModal}>
                    Create Environment
                  </Button>
                </div>
              ) : (
                filteredEnvironments.map(env => (
                  <CollapsibleListItem
                    key={env.id}
                    active={env.isActive}
                    onClick={() => handleOpenEnvironment(env)}
                    onContextMenu={(e) => {
                      setContextTarget({ type: 'environment', item: env });
                      showContextMenu(e);
                    }}
                  >
                    <span className="environment-item">
                      <Tooltip content="Delete environment" position="right">
                        <button 
                          className="environment-item__delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget({
                              type: 'environment',
                              id: env.id,
                              name: env.name,
                            });
                            setDeleteModalOpen(true);
                          }}
                        >
                          <TrashIcon />
                        </button>
                      </Tooltip>
                      <Tooltip content={env.isActive ? 'Hide from dropdown' : 'Show in dropdown'} position="right">
                        <span 
                          className="environment-item__toggle"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleEnvironmentActive(env.id);
                          }}
                        >
                          <Switch
                            checked={env.isActive}
                            onChange={() => {}}
                            size="sm"
                          />
                        </span>
                      </Tooltip>
                      <span className="environment-item__name">{env.name}</span>
                      <span className="environment-item__count">{env.variables.length} var/s</span>
                    </span>
                  </CollapsibleListItem>
                ))
              )}
            </div>
          </>
        )}

        {sidebarView === 'history' && (
          <div className="left-panel__list">
            {(() => {
              // Filter history by active workspace
              const workspaceHistory = activeWorkspaceId
                ? history.filter(entry => entry.request.workspaceId === activeWorkspaceId)
                : history;
              
              return workspaceHistory.length === 0 ? (
                <div className="left-panel__empty">
                  <HistoryIcon />
                  <p>No history yet</p>
                  <p className="left-panel__empty-hint">Send a request to see it here</p>
                </div>
              ) : (
                workspaceHistory.slice(0, 50).map(entry => (
                  <CollapsibleListItem
                    key={entry.id}
                    icon={
                      <span className="method-badge" style={{ color: getMethodColor(entry.request.method) }}>
                        {entry.request.method}
                      </span>
                    }
                    onClick={() => addTab(entry.request)}
                  >
                    <div className="history-item">
                      <span className="history-item__url">{entry.request.url || 'Untitled'}</span>
                      <span className="history-item__time">
                        {formatTime(entry.timestamp)}
                      </span>
                    </div>
                  </CollapsibleListItem>
                ))
              );
            })()}
          </div>
        )}

        {sidebarView === 'mocking' && (
          <>
            <div className="left-panel__actions">
              <Button variant="ghost" size="sm" onClick={handleNewMockApi}>
                <PlusIcon />
                New Mock API
              </Button>
            </div>

            <div className="left-panel__list">
              {filteredMockApis.length === 0 ? (
                <div className="left-panel__empty">
                  <ServerIcon />
                  <p>No mock APIs yet</p>
                  <p className="left-panel__empty-hint">
                    Create a mock API to intercept and mock HTTP requests
                  </p>
                  <Button variant="secondary" size="sm" onClick={handleNewMockApi}>
                    Create Mock API
                  </Button>
                </div>
              ) : (
                filteredMockApis.map(mockApi => (
                  <CollapsibleListItem
                    key={mockApi.id}
                    active={activeMockApiId === mockApi.id}
                    onClick={() => setActiveMockApi(mockApi.id)}
                    onContextMenu={(e) => handleMockApiContextMenu(e, mockApi)}
                  >
                    <div className="mock-api-item">
                      <div className="mock-api-item__info">
                        <span className={`mock-api-item__status ${mockApi.isRunning ? 'running' : ''}`} />
                        <span className="mock-api-item__name">{mockApi.name}</span>
                      </div>
                      <div className="mock-api-item__details">
                        <span className="mock-api-item__port">:{mockApi.port}</span>
                        <Tooltip content={mockApi.isRunning ? 'Stop Server' : 'Start Server'}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => handleToggleMockServer(e, mockApi)}
                            className={`mock-api-item__toggle ${mockApi.isRunning ? 'running' : ''}`}
                          >
                            {mockApi.isRunning ? <StopIcon /> : <PlayIcon />}
                          </Button>
                        </Tooltip>
                      </div>
                    </div>
                  </CollapsibleListItem>
                ))
              )}
            </div>
          </>
        )}

        {sidebarView === 'graphql' && (
          <div className="left-panel__list">
            <div className="left-panel__coming-soon">
              <GraphQLIcon />
              <h3>GraphQL Support</h3>
              <div className="left-panel__coming-soon-badge">Under Consideration</div>
              <p className="left-panel__coming-soon-description">
                Full GraphQL support with schema exploration, query builder, and subscription testing.
              </p>
              <p className="left-panel__coming-soon-hint">
                Interested in this feature? Let me know!
              </p>
              <button 
                className="left-panel__coming-soon-link"
                onClick={() => {
                  const mailtoUrl = "mailto:support@echolon.app?subject=Feature Request: GraphQL Support in Echolon&body=Hi,%0D%0A%0D%0AI'm interested in GraphQL support for Echolon.%0D%0A%0D%0A[Please describe your use case here]";
                  if (window.electronAPI?.openExternal) {
                    window.electronAPI.openExternal(mailtoUrl);
                  } else {
                    window.open(mailtoUrl, '_blank');
                  }
                }}
              >
                <MailIcon />
                Request this feature
              </button>
            </div>
          </div>
        )}

        {sidebarView === 'git' && (
          <GitPanel onConnectClick={() => setGitHubConnectModalOpen(true)} />
        )}

        {sidebarView === 'workspaces' && (
          <>
            <div className="left-panel__list">
              {filteredWorkspaces.length === 0 ? (
                <div className="left-panel__empty">
                  <WorkspacesIcon />
                  {searchQuery ? (
                    <>
                      <p>No results found</p>
                      <p className="left-panel__empty-hint">
                        Try a different search term
                      </p>
                    </>
                  ) : (
                    <>
                      <p>No workspaces yet</p>
                      <p className="left-panel__empty-hint">
                        Workspaces help you organize your collections
                      </p>
                      <Button variant="secondary" size="sm" onClick={handleNewWorkspace}>
                        Create Workspace
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                filteredWorkspaces.map((workspace, workspaceIndex) => {
                  const isDragging = dragState?.type === 'workspace' && dragState.id === workspace.id;
                  
                  return (
                    <div
                      key={workspace.id}
                      className="workspace-drag-wrapper"
                      onDragOver={(e) => {
                        if (!searchQuery && dragStateRef.current?.type === 'workspace') {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDragOver(e, 'workspace', workspace.id, undefined, undefined, workspaceIndex);
                        }
                      }}
                      onDragLeave={(e) => {
                        if (dragStateRef.current?.type === 'workspace') {
                          e.stopPropagation();
                          handleDragLeave(e);
                        }
                      }}
                      onDrop={(e) => {
                        if (!searchQuery && dragStateRef.current?.type === 'workspace') {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDrop(e);
                        }
                      }}
                    >
                      <CollapsibleListItem
                        onClick={() => addWorkspaceTab(workspace)}
                        draggable={!searchQuery}
                        onDragStart={(e) => handleDragStart(e, 'workspace', workspace.id, undefined, undefined, workspaceIndex)}
                        onDragEnd={handleDragEnd}
                        itemId={workspace.id}
                        dropIndicator={getDropIndicator('workspace', workspace.id)}
                        className={isDragging ? 'collapsible-list-item--dragging' : ''}
                      >
                        <div className="workspace-item">
                          <span 
                            className="workspace-item__color" 
                            style={{ backgroundColor: workspace.color || '#6366f1' }} 
                          />
                          <span className="workspace-item__name">{workspace.name}</span>
                        </div>
                      </CollapsibleListItem>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      <ContextMenu
        items={getContextMenuItems()}
        position={contextMenu}
        onClose={hideContextMenu}
      />

      <GitHubConnectModal 
        isOpen={gitHubConnectModalOpen} 
        onClose={() => setGitHubConnectModalOpen(false)} 
      />

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setDeleteTarget(null);
        }}
        title={`Delete ${deleteTarget?.type === 'collection' ? 'Collection' : deleteTarget?.type === 'folder' ? 'Folder' : deleteTarget?.type === 'environment' ? 'Environment' : 'Request'}`}
        size="sm"
      >
        <div className="left-panel__delete-modal">
          <div className="left-panel__delete-icon">
            <AlertIcon />
          </div>
          <p className="left-panel__delete-message">
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>?
          </p>
          {deleteTarget?.type === 'collection' && (
            <p className="left-panel__delete-warning">
              This will delete all requests and folders in this collection.
            </p>
          )}
          {deleteTarget?.type === 'folder' && (
            <p className="left-panel__delete-warning">
              This will delete all requests and subfolders in this folder.
            </p>
          )}
          {deleteTarget?.type === 'environment' && (
            <p className="left-panel__delete-warning">
              This will delete all variables in this environment.
            </p>
          )}
          <p className="left-panel__delete-warning">
            This action cannot be undone.
          </p>
          <div className="left-panel__delete-actions">
            <Button 
              variant="secondary" 
              onClick={() => {
                setDeleteModalOpen(false);
                setDeleteTarget(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={handleConfirmDelete}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default LeftPanel;
