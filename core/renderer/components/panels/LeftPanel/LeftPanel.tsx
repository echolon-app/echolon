import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Button, SearchInput, CollapsibleList, CollapsibleListItem, ContextMenu, useContextMenu, Tooltip, Switch
} from '@/components/ui';
import { 
  RadarIcon, PlusIcon, FolderIcon, ImportIcon, PlayIcon, StopIcon, ServerIcon, SocketIcon, GraphQLIcon, 
  MailIcon, CollapseAllIcon, ExpandAllIcon, EditIcon, CopyIcon, ExportIcon, TrashIcon, OpenIcon, NewTabIcon, MoveIcon
} from '@/components/ui/icons';
import { useApp, useCollections, useRequest, useEnvironments, useMocking, useWebMode } from '@/contexts';
import { GitPanel } from '@/components/panels/GitPanel';
import { GitHubConnectModal } from '@/components/modals/GitHubConnectModal';
import { requestService } from '@/services';
import { Collection, Request, Folder, MockAPI } from '@/types';
import { METHOD_COLORS } from '../../../../shared/constants';
import { formatTime } from '@/utils';
import './LeftPanel.css';

const getMethodColor = (method: string): string => {
  return METHOD_COLORS[method] || '#9ca3af';
};

export const LeftPanel: React.FC = () => {
  const { sidebarView, openImportModal, openNewCollectionModal, openNewEnvironmentModal, openMoveCollectionModal } = useApp();
  const { collections, deleteCollection, addRequest, updateRequest, updateCollection, updateFolder, collapseAllFolders, expandAllFolders } = useCollections();
  const { environments, toggleEnvironmentActive } = useEnvironments();
  const { addTab, addSampleTab, addCollectionTab, addEnvironmentTab, history, closeTab, tabs, setActiveTab, renameTab, activeTabId, activeTab } = useRequest();
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
  
  // Scroll sync state - listen for events from CollectionEditor
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [activeRequestIdFromScroll, setActiveRequestIdFromScroll] = useState<string | null>(null);
  const [activeReferenceCollectionId, setActiveReferenceCollectionId] = useState<string | null>(null);
  
  // Flag to suppress auto-scroll when click originated from LeftPanel
  const suppressAutoScrollRef = useRef(false);
  
  // Ref to the scroll container
  const leftPanelContentRef = useRef<HTMLDivElement>(null);
  
  // Listen for scroll sync events from CollectionEditor
  useEffect(() => {
    const handleScrollSync = (event: CustomEvent<{ folderId: string | null; requestId: string | null; collectionId: string | null }>) => {
      const prevFolderId = activeFolderId;
      const prevRequestId = activeRequestIdFromScroll;
      
      setActiveFolderId(event.detail.folderId);
      setActiveRequestIdFromScroll(event.detail.requestId);
      setActiveReferenceCollectionId(event.detail.collectionId);
      
      // Only auto-scroll if:
      // 1. Not suppressed (i.e., not triggered by a LeftPanel click)
      // 2. The active item actually changed
      if (!suppressAutoScrollRef.current && 
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
      
      // Reset suppress flag after handling
      suppressAutoScrollRef.current = false;
    };
    
    window.addEventListener('referenceScrollSync', handleScrollSync as EventListener);
    return () => {
      window.removeEventListener('referenceScrollSync', handleScrollSync as EventListener);
    };
  }, [activeFolderId, activeRequestIdFromScroll]);
  
  const [searchQuery, setSearchQuery] = useState('');
  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu();
  const [contextTarget, setContextTarget] = useState<{ type: string; item: unknown } | null>(null);
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [editingCollectionName, setEditingCollectionName] = useState('');
  const [gitHubConnectModalOpen, setGitHubConnectModalOpen] = useState(false);

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
      // Suppress auto-scroll in LeftPanel since this click originated here
      suppressAutoScrollRef.current = true;
      
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

  const handleRequestContextMenu = (e: React.MouseEvent, request: Request) => {
    setContextTarget({ type: 'request', item: request });
    showContextMenu(e);
  };

  const handleAddRequestToCollection = (collection: Collection) => {
    const req = requestService.createEmptyRequest();
    req.collectionId = collection.id;
    req.name = 'New Request';
    // Add request to the collection
    addRequest(collection.id, req);
    // Open it in a tab
    addTab(req);
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
        { id: 'new-folder', label: 'Add Folder', icon: <FolderIcon />, onClick: () => {} },
        { id: 'divider1', label: '', divider: true },
        { id: 'rename', label: 'Rename', icon: <EditIcon />, onClick: () => {
          // Open the collection tab to rename
          addCollectionTab(collection);
        }},
        { id: 'duplicate', label: 'Duplicate', icon: <CopyIcon />, onClick: () => {} },
        { id: 'move', label: 'Move to Workspace', icon: <MoveIcon />, onClick: () => {
          openMoveCollectionModal(collection);
        }},
        { id: 'export', label: 'Export', icon: <ExportIcon />, onClick: () => {} },
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
          // Close any tabs related to this collection
          tabs.forEach(tab => {
            if (tab.collectionId === collection.id || tab.request?.collectionId === collection.id) {
              closeTab(tab.id);
            }
          });
          // Delete the collection
          deleteCollection(collection.id);
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
          { id: 'open-new-tab', label: 'Open in New Tab', icon: <NewTabIcon />, onClick: () => {
            handleOpenRequest(contextTarget.item as Request);
          }},
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
          const duplicated = requestService.duplicateRequest(contextTarget.item as Request);
          addTab(duplicated);
        }},
        { id: 'divider2', label: '', divider: true },
        { id: 'delete', label: 'Delete', icon: <TrashIcon />, danger: true, onClick: () => {} },
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
            await startMockServer(mockApi.id);
          }
        }},
        { id: 'divider2', label: '', divider: true },
        { id: 'delete', label: 'Delete', icon: <TrashIcon />, danger: true, onClick: () => {
          deleteMockApi(mockApi.id);
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

  const renderRequestItem = (request: Request, collectionId: string, folderId?: string) => {
    const isEditing = editingRequestId === request.id;
    const isActive = activeRequestId === request.id;
    // Check if this request is highlighted from reference scroll sync
    const isReferenceActive = activeReferenceCollectionId === collectionId && activeRequestIdFromScroll === request.id;
    
    return (
      <div key={request.id} ref={(el) => setRequestRef(request.id, el)} className={isReferenceActive ? 'reference-active-request' : undefined}>
        <CollapsibleListItem
          icon={<span className="method-badge" style={{ color: getMethodColor(request.method) }}>{request.method}</span>}
          active={isActive || isReferenceActive}
          onClick={() => !isEditing && handleOpenRequest(request, collectionId, folderId)}
          onContextMenu={(e) => handleRequestContextMenu(e, request)}
          onDoubleClick={() => handleStartEditing(request)}
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
            request.name
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
      request.url.toLowerCase().includes(lowerQuery)
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

  const renderFolder = (folder: Folder, collectionId: string) => {
    // Check if this folder should be highlighted (Reference scroll sync)
    // Only highlight folder if no specific request is active within it
    const isReferenceActive = activeReferenceCollectionId === collectionId;
    const isActiveSection = isReferenceActive && activeFolderId === folder.id && !activeRequestIdFromScroll;
    
    return (
      <div key={folder.id} ref={(el) => setFolderRef(folder.id, el)}>
        <CollapsibleList
          title={folder.name}
          icon={<FolderIcon />}
          collapsed={searchQuery ? false : folder.collapsed}
          onCollapsedChange={(collapsed) => {
            updateFolder(collectionId, folder.id, { collapsed });
          }}
          className={isActiveSection ? 'reference-active-section' : undefined}
        >
          {folder.folders.map(f => renderFolder(f, collectionId))}
          {folder.requests.map(r => renderRequestItem(r, collectionId, folder.id))}
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
        };
      })
      .filter((c): c is Collection => c !== null);
  };

  const filteredCollections = getFilteredCollections();

  const filteredEnvironments = searchQuery
    ? environments.filter(e => e.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : environments;

  const filteredMockApis = searchQuery
    ? mockApis.filter(m => m.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : mockApis;

  const handleNewMockApi = () => {
    const name = `Mock API ${mockApis.length + 1}`;
    const newApi = addMockApi(name);
    setActiveMockApi(newApi.id);
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
      await startMockServer(mockApi.id);
    }
  };

  return (
    <div className="left-panel">
      <div className="left-panel__header">
        <SearchInput
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onClear={() => setSearchQuery('')}
          placeholder={sidebarView === 'collections' ? 'Search name, method, URL...' : `Search ${sidebarView}...`}
          size="sm"
        />
      </div>

      <div className="left-panel__content" ref={leftPanelContentRef}>
        {sidebarView === 'collections' && (
          <>
            {!readonly && (
              <div className="left-panel__actions">
                <Button variant="ghost" size="sm" onClick={openNewCollectionModal}>
                  <PlusIcon />
                  New Collection
                </Button>
                <Button variant="ghost" size="sm" onClick={openImportModal}>
                  <ImportIcon />
                  Import
                </Button>
              </div>
            )}

            <div className="left-panel__list">
              {filteredCollections.length === 0 ? (
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
                      <p>No collections loaded</p>
                      <p className="left-panel__empty-hint">
                        The API reference will appear here
                      </p>
                    </>
                  ) : (
                    <>
                      <p>No collections yet</p>
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
                filteredCollections.map(collection => (
                  <CollapsibleList
                    key={collection.id}
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
                    {collection.folders.map(f => renderFolder(f, collection.id))}
                    {collection.requests.map(r => renderRequestItem(r, collection.id))}
                  </CollapsibleList>
                ))
              )}
            </div>
          </>
        )}

        {sidebarView === 'environments' && (
          <>
            <div className="left-panel__actions">
              <Button variant="ghost" size="sm" onClick={openNewEnvironmentModal}>
                <PlusIcon />
                New Environment
              </Button>
            </div>

            <div className="left-panel__list">
              {filteredEnvironments.length === 0 ? (
                <div className="left-panel__empty">
                  <p>No environments yet</p>
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
                      <span className="environment-item__count">{env.variables.length} vars</span>
                    </span>
                  </CollapsibleListItem>
                ))
              )}
            </div>
          </>
        )}

        {sidebarView === 'history' && (
          <div className="left-panel__list">
            {history.length === 0 ? (
              <div className="left-panel__empty">
                <p>No history yet</p>
                <p className="left-panel__empty-hint">Send a request to see it here</p>
              </div>
            ) : (
              history.slice(0, 50).map(entry => (
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
            )}
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

        {sidebarView === 'socket' && (
          <div className="left-panel__list">
            <div className="left-panel__coming-soon">
              <SocketIcon />
              <h3>WebSocket Support</h3>
              <div className="left-panel__coming-soon-badge">Under Consideration</div>
              <p className="left-panel__coming-soon-description">
                Real-time WebSocket connections for testing live APIs, chat applications, and streaming data.
              </p>
              <p className="left-panel__coming-soon-hint">
                Interested in this feature? Let us know!
              </p>
              <a 
                href="mailto:services@modrena.com?subject=Feature Request: WebSocket Support in Echolon&body=Hi,%0D%0A%0D%0AI'm interested in WebSocket support for Echolon.%0D%0A%0D%0A[Please describe your use case here]"
                className="left-panel__coming-soon-link"
              >
                <MailIcon />
                Request this feature
              </a>
            </div>
          </div>
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
                Interested in this feature? Let us know!
              </p>
              <a 
                href="mailto:services@modrena.com?subject=Feature Request: GraphQL Support in Echolon&body=Hi,%0D%0A%0D%0AI'm interested in GraphQL support for Echolon.%0D%0A%0D%0A[Please describe your use case here]"
                className="left-panel__coming-soon-link"
              >
                <MailIcon />
                Request this feature
              </a>
            </div>
          </div>
        )}

        {sidebarView === 'git' && (
          <GitPanel onConnectClick={() => setGitHubConnectModalOpen(true)} />
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
    </div>
  );
};

export default LeftPanel;
