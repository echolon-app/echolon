import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Button, Tooltip, AutoComplete, AutoCompleteOption } from '@/components/ui';
import { 
  ChevronLeftIcon, ChevronRightIcon, SearchIcon, SettingsIcon, DevToolsIcon,
  ChevronDownIcon, CheckIcon, PlusIcon, EditIcon, TrashIcon, GlobeIcon,
  TabsIcon, ListIcon, GitHubIcon, ArrowUpIcon, ArrowDownIcon, RefreshIcon, GitBranchIcon, PhoneIcon
} from '@/components/ui/icons';
import { useApp, useRequest, useWorkspace, useEnvironments, useCollections, useWebMode, useFileStorage, useGitHub, useGitOptional, useToast } from '@/contexts';
import './TopBar.css';
import '@/components/ui/Modal/Modal.css';

interface WorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  workspace?: { id: string; name: string; description?: string; color?: string };
  onSave: (name: string, description?: string, color?: string) => void;
  onDelete?: () => void;
  echolonPath?: string;
}

const WorkspaceModal: React.FC<WorkspaceModalProps> = ({ 
  isOpen, 
  onClose, 
  mode, 
  workspace, 
  onSave, 
  onDelete,
  echolonPath
}) => {
  const [name, setName] = useState(workspace?.name || '');
  const [description, setDescription] = useState(workspace?.description || '');
  const [color, setColor] = useState(workspace?.color || '#6366f1');
  
  const colors = ['#6366f1', '#f43f5e', '#22c55e', '#f59e0b', '#06b6d4', '#8b5cf6', '#ec4899', '#14b8a6'];
  
  // Compute preview path for new workspace
  const previewPath = useMemo(() => {
    if (mode !== 'create' || !echolonPath || !name.trim()) return null;
    const sanitizedName = name.trim().replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ');
    return `${echolonPath}/${sanitizedName}`;
  }, [mode, echolonPath, name]);

  useEffect(() => {
    if (isOpen) {
      setName(workspace?.name || '');
      setDescription(workspace?.description || '');
      setColor(workspace?.color || '#6366f1');
    }
  }, [isOpen, workspace]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSave(name.trim(), description.trim() || undefined, color);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="workspace-modal-overlay" onClick={onClose}>
      <div className="workspace-modal" onClick={e => e.stopPropagation()}>
        <h3 className="workspace-modal__title">
          {mode === 'create' ? 'Create Workspace' : 'Edit Workspace'}
        </h3>
        <form onSubmit={handleSubmit}>
          <div className="workspace-modal__field">
            <label htmlFor="workspace-name">Name</label>
            <input
              id="workspace-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="My Workspace"
              autoFocus
            />
          </div>
          <div className="workspace-modal__field">
            <label htmlFor="workspace-description">Description (optional)</label>
            <input
              id="workspace-description"
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Workspace description"
            />
          </div>
          <div className="workspace-modal__field">
            <label>Color</label>
            <div className="workspace-modal__colors">
              {colors.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`workspace-modal__color ${color === c ? 'workspace-modal__color--active' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
          {mode === 'create' && previewPath && (
            <div className="workspace-modal__path-preview">
              <div className="workspace-modal__path-label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span>Will be saved to:</span>
              </div>
              <code className="workspace-modal__path-value">{previewPath}</code>
              <p className="workspace-modal__path-hint">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.36-5.36l-2.12 2.12M8.76 15.24l-2.12 2.12m0-10.48l2.12 2.12m8.48 8.48l2.12 2.12" />
                </svg>
                Workspaces are stored as plain files—perfect for Git version control
              </p>
            </div>
          )}
          <div className="workspace-modal__actions">
            {mode === 'edit' && onDelete && (
              <button 
                type="button" 
                className="workspace-modal__delete"
                onClick={() => {
                  onDelete();
                  onClose();
                }}
              >
                <TrashIcon />
                Delete
              </button>
            )}
            <div className="workspace-modal__actions-right">
              <button type="button" className="workspace-modal__cancel" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="workspace-modal__save" disabled={!name.trim()}>
                {mode === 'create' ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

// TabsIcon and ListIcon are imported from @/components/ui/icons

// Echolon Logo - Terminal prompt icon
const EcholonLogo = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="echolon-gradient" x1="4" y1="6" x2="20" y2="18" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#77F08B"/>
        <stop offset="1" stopColor="#4FE06C"/>
      </linearGradient>
    </defs>
    {/* Terminal prompt > */}
    <path d="M 4 7 L 10 12 L 4 17" stroke="url(#echolon-gradient)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    {/* Cursor line _ */}
    <path d="M 12 17 L 20 17" stroke="url(#echolon-gradient)" strokeWidth="2.5" strokeLinecap="round"/>
  </svg>
);

export const TopBar: React.FC = () => {
  const { openSettingsModal, openGlobalSearch, openNewEnvironmentModal, viewMode, setViewMode, settings, setSidebarView, openScreenMirrorModal } = useApp();
  const { canGoBack, canGoForward, goBack, goForward, activeTab } = useRequest();
  const { workspaces, activeWorkspace, setActiveWorkspace, addWorkspace, updateWorkspace, deleteWorkspace, selectedWorkspaceEnvironment, selectWorkspaceEnvironment } = useWorkspace();
  const { activeEnvironments, selectedEnvironment, selectEnvironment, addEnvironment } = useEnvironments();
  const { collections, setActiveCollectionEnvironment } = useCollections();
  const { readonly, isWebMode, availableVersions, currentVersion, setCurrentVersion, versionsLoading, selectedEnvironmentId, setSelectedEnvironmentId, loadedCollection } = useWebMode();
  const { echolonPath } = useFileStorage();
  const { 
    isAuthenticated: isGitHubAuthenticated, 
    getLinkedRepo, 
    syncStatus, 
    isSyncing, 
    checkSyncStatus, 
    pushWorkspaceChanges, 
    pullWorkspaceChanges 
  } = useGitHub();
  const { success: showSuccessToast } = useToast();
  const git = useGitOptional();
  const gitInitialized = git?.isInitialized ?? false;
  const gitHasChanges = git?.hasChanges ?? (() => false);
  const gitTotalChanges = git?.getTotalChanges ?? (() => 0);
  const gitStatus = git?.status ?? null;
  
  const [workspaceDropdownOpen, setWorkspaceDropdownOpen] = useState(false);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [workspaceModalMode, setWorkspaceModalMode] = useState<'create' | 'edit'>('create');
  const [editingWorkspace, setEditingWorkspace] = useState<{ id: string; name: string; description?: string; color?: string } | undefined>();
  const [gitHubDropdownOpen, setGitHubDropdownOpen] = useState(false);
  const [pushModalOpen, setPushModalOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [pushError, setPushError] = useState<string | null>(null);
  const [gitErrorModalOpen, setGitErrorModalOpen] = useState(false);
  const [versionDropdownOpen, setVersionDropdownOpen] = useState(false);
  
  const dropdownRef = useRef<HTMLDivElement>(null);
  const versionDropdownRef = useRef<HTMLDivElement>(null);
  const gitHubDropdownRef = useRef<HTMLDivElement>(null);
  
  // Get linked repo for current workspace
  const linkedRepo = activeWorkspace?.id ? getLinkedRepo(activeWorkspace.id) : undefined;

  // Get the current collection based on active tab
  // Handles: collection tabs, request tabs with collectionId, or fallback search
  const currentCollection = useMemo(() => {
    // If this is a collection tab, use its collectionId directly
    if (activeTab?.type === 'collection' && activeTab.collectionId) {
      return collections.find(c => c.id === activeTab.collectionId) || null;
    }
    
    // For request tabs, try direct collectionId lookup
    if (activeTab?.request?.collectionId) {
      return collections.find(c => c.id === activeTab.request?.collectionId) || null;
    }
    
    // Fallback: find collection containing this request by ID
    const requestId = activeTab?.request?.id;
    if (requestId) {
      // Helper to recursively search folders for a request
      const searchFolders = (folders: typeof collections[0]['folders']): boolean => {
        if (!folders) return false;
        for (const folder of folders) {
          if (folder.requests?.some(r => r.id === requestId)) return true;
          if (searchFolders(folder.folders)) return true;
        }
        return false;
      };
      
      for (const collection of collections) {
        // Check direct requests
        if (collection.requests?.some(r => r.id === requestId)) {
          return collection;
        }
        // Check requests in folders (recursively)
        if (searchFolders(collection.folders)) {
          return collection;
        }
      }
    }
    
    // In web mode, fall back to the loaded collection or first collection
    // This ensures collection environments are available for the environment dropdown
    if (isWebMode) {
      // Prefer the explicitly loaded collection from spec URL
      if (loadedCollection) {
        return loadedCollection;
      }
      // Fall back to first collection in the list
      if (collections.length > 0) {
        return collections[0];
      }
    }
    
    return null;
  }, [activeTab, collections, isWebMode, loadedCollection]);

  // Environment options for AutoComplete - show global + workspace + collection environments
  // Priority: Collection > Workspace > Global
  const environmentOptions: AutoCompleteOption<string | null>[] = useMemo(() => {
    const options: AutoCompleteOption<string | null>[] = [
      { 
        value: null, 
        label: 'No Environment', 
        description: 'No variables',
      },
    ];

    // Add global environments (active ones) - lowest priority
    if (activeEnvironments.length > 0) {
      options.push(...activeEnvironments.map(env => ({
        value: env.id,
        label: env.name,
        description: `Global • ${env.variables.length} variable${env.variables.length !== 1 ? 's' : ''}`,
        // If emoji, show it as icon; otherwise show color as circle
        icon: env.emoji ? <span className="autocomplete__emoji">{env.emoji}</span> : undefined,
        color: !env.emoji ? (env.color || '#22c55e') : undefined,
      })));
    }

    // Add workspace environments (middle priority)
    if (activeWorkspace?.environments && activeWorkspace.environments.length > 0) {
      const wsEnvs = activeWorkspace.environments.filter(env => env.isActive).map(env => ({
        value: `workspace:${activeWorkspace.id}:${env.id}`,
        label: env.name,
        description: `Workspace • ${env.variables.length} var${env.variables.length !== 1 ? 's' : ''}`,
        icon: env.emoji ? <span className="autocomplete__emoji">{env.emoji}</span> : undefined,
        color: !env.emoji ? (env.color || '#3b82f6') : undefined, // Blue for workspace
      }));
      options.push(...wsEnvs);
    }

    // Add collection-specific environments if there's an active collection (highest priority)
    if (currentCollection?.environments && currentCollection.environments.length > 0) {
      // Show all collection environments - the Switch in CollectionEditor controls isActive
      // Note: isActive was repurposed to mean "visible in dropdown" instead of "selected"
      // For backwards compatibility, show all environments regardless of isActive state
      const collEnvs = currentCollection.environments.map(env => ({
        value: `collection:${currentCollection.id}:${env.id}`,
        label: env.name + (env.isActive === false ? ' (hidden)' : ''),
        description: `Collection • ${env.variables.length} var${env.variables.length !== 1 ? 's' : ''}`,
        icon: env.emoji ? <span className="autocomplete__emoji">{env.emoji}</span> : undefined,
        // In web mode (OpenAPI specs), don't show default color since OpenAPI doesn't support it
        // In desktop mode, show custom color or default orange for visible environments
        color: env.isActive === false ? '#6b7280' : (!env.emoji ? (isWebMode ? env.color : (env.color || '#f59e0b')) : undefined),
      }));
      options.push(...collEnvs);
    }

    return options;
  }, [activeEnvironments, activeWorkspace?.environments, activeWorkspace?.id, currentCollection, isWebMode]);

  const handleEnvironmentChange = (envId: string | null) => {
    // In web mode, persist the selection to localStorage
    if (isWebMode) {
      setSelectedEnvironmentId(envId);
    }
    
    if (envId?.startsWith('collection:')) {
      // Handle collection environment selection (highest priority)
      const parts = envId.split(':');
      const collectionId = parts[1];
      const collEnvId = parts[2];
      setActiveCollectionEnvironment(collectionId, collEnvId);
      // Deselect global and workspace environments when selecting a collection environment
      selectEnvironment(null);
      if (activeWorkspace) {
        selectWorkspaceEnvironment(activeWorkspace.id, null);
      }
    } else if (envId?.startsWith('workspace:')) {
      // Handle workspace environment selection (middle priority)
      const parts = envId.split(':');
      const workspaceId = parts[1];
      const wsEnvId = parts[2];
      selectWorkspaceEnvironment(workspaceId, wsEnvId);
      // Deselect global and collection environments
      selectEnvironment(null);
      if (currentCollection) {
        setActiveCollectionEnvironment(currentCollection.id, null);
      }
    } else {
      // Handle global environment selection (lowest priority)
      selectEnvironment(envId);
      // Deselect collection and workspace environments when selecting a global environment
      if (currentCollection) {
        setActiveCollectionEnvironment(currentCollection.id, null);
      }
      if (activeWorkspace) {
        selectWorkspaceEnvironment(activeWorkspace.id, null);
      }
    }
  };

  const handleCreateEnvironment = (name: string) => {
    const newEnv = addEnvironment(name);
    selectEnvironment(newEnv.id);
  };

  // Restore saved environment selection in web mode when collection loads
  useEffect(() => {
    if (!isWebMode || !selectedEnvironmentId || !currentCollection) return;
    
    // Check if the saved environment ID matches a collection environment
    if (selectedEnvironmentId.startsWith('collection:')) {
      const parts = selectedEnvironmentId.split(':');
      const savedCollectionId = parts[1];
      const savedEnvId = parts[2];
      
      // Verify this environment exists in the current collection
      if (currentCollection.id === savedCollectionId || savedCollectionId === currentCollection.id) {
        const envExists = currentCollection.environments?.some(env => env.id === savedEnvId);
        if (envExists) {
          setActiveCollectionEnvironment(currentCollection.id, savedEnvId);
        }
      }
    }
  }, [isWebMode, selectedEnvironmentId, currentCollection, setActiveCollectionEnvironment]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setWorkspaceDropdownOpen(false);
      }
      if (gitHubDropdownRef.current && !gitHubDropdownRef.current.contains(e.target as Node)) {
        setGitHubDropdownOpen(false);
      }
      if (versionDropdownRef.current && !versionDropdownRef.current.contains(e.target as Node)) {
        setVersionDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // GitHub sync handlers
  const handlePush = async () => {
    if (!commitMessage.trim()) {
      setPushError('Please enter a commit message');
      return;
    }
    
    setPushError(null);
    const result = await pushWorkspaceChanges(commitMessage.trim());
    
    if (result.success) {
      setPushModalOpen(false);
      setCommitMessage('');
      setGitHubDropdownOpen(false);
      showSuccessToast('Changes pushed successfully');
    } else {
      setPushError(result.error || 'Push failed');
    }
  };

  const handlePull = async () => {
    const result = await pullWorkspaceChanges();
    
    if (!result.success) {
      // Could show error toast here
      console.error('Pull failed:', result.error);
    }
    
    setGitHubDropdownOpen(false);
  };

  const handleRefreshStatus = () => {
    checkSyncStatus();
  };

  const handleCreateWorkspace = () => {
    setWorkspaceModalMode('create');
    setEditingWorkspace(undefined);
    setWorkspaceModalOpen(true);
    setWorkspaceDropdownOpen(false);
  };

  const handleEditWorkspace = (workspace: { id: string; name: string; description?: string; color?: string }, e: React.MouseEvent) => {
    e.stopPropagation();
    setWorkspaceModalMode('edit');
    setEditingWorkspace(workspace);
    setWorkspaceModalOpen(true);
    setWorkspaceDropdownOpen(false);
  };

  const handleSaveWorkspace = (name: string, description?: string, color?: string) => {
    if (workspaceModalMode === 'create') {
      // addWorkspace already sets the new workspace as active
      addWorkspace(name, description, color);
    } else if (editingWorkspace) {
      updateWorkspace(editingWorkspace.id, { name, description, color });
    }
  };

  const handleDeleteWorkspace = () => {
    if (editingWorkspace && workspaces.length > 1) {
      deleteWorkspace(editingWorkspace.id);
    }
  };

  return (
    <>
      <div className="top-bar">
        <div className="top-bar__left">
          {readonly ? (
            /* Show Echolon logo and version dropdown in readonly mode */
            <>
            <div className="top-bar__logo">
              <EcholonLogo />
              <span className="top-bar__logo-text">Echolon</span>
            </div>
              
              {/* Version Dropdown for public specs */}
              {availableVersions.length > 1 && !versionsLoading && (
                <div className="top-bar__version" ref={versionDropdownRef}>
                  <button 
                    className="top-bar__version-trigger"
                    onClick={() => setVersionDropdownOpen(!versionDropdownOpen)}
                  >
                    <span className="top-bar__version-label">v{currentVersion || availableVersions[0]?.version}</span>
                    <ChevronDownIcon />
                  </button>
                  
                  {versionDropdownOpen && (
                    <div className="top-bar__version-dropdown">
                      <div className="top-bar__version-list">
                        {availableVersions.map(version => (
                          <div 
                            key={version.version}
                            className={`top-bar__version-item ${version.version === currentVersion ? 'top-bar__version-item--active' : ''}`}
                            onClick={() => {
                              setCurrentVersion(version.version);
                              setVersionDropdownOpen(false);
                            }}
                          >
                            <span className="top-bar__version-number">v{version.version}</span>
                            {version.publishedAt && (
                              <span className="top-bar__version-date">
                                {new Date(version.publishedAt).toLocaleDateString()}
                              </span>
                            )}
                            {version.version === currentVersion && (
                              <span className="top-bar__version-check"><CheckIcon /></span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="top-bar__nav">
                <Button variant="ghost" size="sm" onClick={goBack} disabled={!canGoBack}>
                  <ChevronLeftIcon />
                </Button>
                <Button variant="ghost" size="sm" onClick={goForward} disabled={!canGoForward}>
                  <ChevronRightIcon />
                </Button>
              </div>
              
              {/* Workspace Switcher */}
              <div className="top-bar__workspace" ref={dropdownRef}>
                <button 
                  className="top-bar__workspace-trigger"
                  onClick={() => setWorkspaceDropdownOpen(!workspaceDropdownOpen)}
                >
                  <span 
                    className="top-bar__workspace-color" 
                    style={{ backgroundColor: activeWorkspace?.color || '#6366f1' }}
                  />
                  <span className="top-bar__workspace-name">
                    {activeWorkspace?.name || 'Select Workspace'}
                  </span>
                  <ChevronDownIcon />
                </button>
                
                {workspaceDropdownOpen && (
                  <div className="top-bar__workspace-dropdown">
                    <div className="top-bar__workspace-list">
                      {workspaces.map(workspace => (
                        <div 
                          key={workspace.id}
                          className={`top-bar__workspace-item ${workspace.id === activeWorkspace?.id ? 'top-bar__workspace-item--active' : ''}`}
                          onClick={() => {
                            setActiveWorkspace(workspace.id);
                            setWorkspaceDropdownOpen(false);
                          }}
                        >
                          <span 
                            className="top-bar__workspace-color" 
                            style={{ backgroundColor: workspace.color || '#6366f1' }}
                          />
                          <span className="top-bar__workspace-item-name">{workspace.name}</span>
                          {workspace.id === activeWorkspace?.id && (
                            <span className="top-bar__workspace-check"><CheckIcon /></span>
                          )}
                          <button 
                            className="top-bar__workspace-edit"
                            onClick={(e) => handleEditWorkspace(workspace, e)}
                            title="Edit workspace"
                          >
                            <EditIcon />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="top-bar__workspace-divider" />
                    <button 
                      className="top-bar__workspace-add"
                      onClick={handleCreateWorkspace}
                    >
                      <PlusIcon />
                      <span>New Workspace</span>
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="top-bar__center">
          {/* View Mode Toggle - hide in web mode and when viewing a collection (has its own Reference tab) */}
         

          <button className="top-bar__search" onClick={openGlobalSearch}>
            <SearchIcon />
            <span>Search...</span>
            <kbd>⌘K</kbd>
          </button>
        </div>

        <div className="top-bar__right">
          {/* GitHub Sync Controls - show when workspace is linked to a repo */}
          {!isWebMode && linkedRepo && isGitHubAuthenticated && (
            <div className="top-bar__github" ref={gitHubDropdownRef}>
              <button 
                className={`top-bar__github-trigger ${syncStatus?.hasLocalChanges ? 'top-bar__github-trigger--has-changes' : ''}`}
                onClick={() => setGitHubDropdownOpen(!gitHubDropdownOpen)}
                disabled={isSyncing}
              >
                <GitBranchIcon />
                <span className="top-bar__github-repo">{linkedRepo.repo}</span>
                {syncStatus?.hasLocalChanges && (
                  <span className="top-bar__github-badge top-bar__github-badge--local">
                    {syncStatus.localChanges.length}↑
                  </span>
                )}
                {syncStatus?.hasRemoteChanges && (
                  <span className="top-bar__github-badge top-bar__github-badge--remote">
                    {syncStatus.remoteChanges.length}↓
                  </span>
                )}
                {isSyncing && <span className="top-bar__github-spinner" />}
                <ChevronDownIcon />
              </button>
              
              {gitHubDropdownOpen && (
                <div className="top-bar__github-dropdown">
                  <div className="top-bar__github-header">
                    <GitHubIcon />
                    <div className="top-bar__github-info">
                      <span className="top-bar__github-fullname">{linkedRepo.owner}/{linkedRepo.repo}</span>
                      <span className="top-bar__github-branch">{linkedRepo.branch}</span>
                    </div>
                  </div>
                  
                  <div className="top-bar__github-divider" />
                  
                  {syncStatus && (
                    <div className="top-bar__github-status">
                      {syncStatus.hasLocalChanges && (
                        <div className="top-bar__github-status-item">
                          <ArrowUpIcon />
                          <span>{syncStatus.localChanges.length} local change{syncStatus.localChanges.length !== 1 ? 's' : ''}</span>
                        </div>
                      )}
                      {syncStatus.hasRemoteChanges && (
                        <div className="top-bar__github-status-item">
                          <ArrowDownIcon />
                          <span>{syncStatus.remoteChanges.length} remote change{syncStatus.remoteChanges.length !== 1 ? 's' : ''}</span>
                        </div>
                      )}
                      {syncStatus.conflicts.length > 0 && (
                        <div className="top-bar__github-status-item top-bar__github-status-item--conflict">
                          <span>⚠️ {syncStatus.conflicts.length} conflict{syncStatus.conflicts.length !== 1 ? 's' : ''}</span>
                        </div>
                      )}
                      {!syncStatus.hasLocalChanges && !syncStatus.hasRemoteChanges && syncStatus.conflicts.length === 0 && (
                        <div className="top-bar__github-status-item top-bar__github-status-item--synced">
                          <CheckIcon />
                          <span>Up to date</span>
                        </div>
                      )}
                      {syncStatus.lastSyncedAt && (
                        <div className="top-bar__github-last-sync">
                          Last synced: {new Date(syncStatus.lastSyncedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  )}
                  
                  <div className="top-bar__github-divider" />
                  
                  <div className="top-bar__github-actions">
                    <button 
                      className="top-bar__github-action"
                      onClick={() => {
                        setPushModalOpen(true);
                        setGitHubDropdownOpen(false);
                      }}
                      disabled={isSyncing || !syncStatus?.hasLocalChanges}
                    >
                      <ArrowUpIcon />
                      <span>Push Changes</span>
                    </button>
                    <button 
                      className="top-bar__github-action"
                      onClick={handlePull}
                      disabled={isSyncing || !syncStatus?.hasRemoteChanges}
                    >
                      <ArrowDownIcon />
                      <span>Pull Changes</span>
                    </button>
                    <button 
                      className="top-bar__github-action"
                      onClick={handleRefreshStatus}
                      disabled={isSyncing}
                    >
                      <RefreshIcon />
                      <span>Refresh Status</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Git Changes Indicator - show when repo is initialized and has changes */}
          {!isWebMode && gitInitialized && gitHasChanges() && (
            <Tooltip content={`${gitTotalChanges()} uncommitted change${gitTotalChanges() !== 1 ? 's' : ''}`} position="bottom">
              <button 
                className="top-bar__git-indicator"
                onClick={() => setSidebarView('git')}
              >
                <GitBranchIcon />
                <span className="top-bar__git-badge">{gitTotalChanges()}</span>
              </button>
            </Tooltip>
          )}
          
          <AutoComplete<string | null>
            options={environmentOptions}
            value={(() => {
              // In web mode, use the persisted selection if available
              if (isWebMode && selectedEnvironmentId) {
                return selectedEnvironmentId;
              }
              // Check if there's a selected collection environment first
              if (currentCollection?.defaultEnvironmentId) {
                return `collection:${currentCollection.id}:${currentCollection.defaultEnvironmentId}`;
              }
              // Fall back to global environment
              return selectedEnvironment?.id || null;
            })()}
            onChange={handleEnvironmentChange}
            placeholder="No Environment"
            searchPlaceholder="Search environments..."
            emptyMessage="No environments found"
            size="sm"
            allowClear={false}
            onCreate={readonly ? undefined : handleCreateEnvironment}
            createLabel={readonly ? undefined : "Create environment"}
            onCreateClick={readonly ? undefined : openNewEnvironmentModal}
            createButtonLabel={readonly ? undefined : "New Environment"}
            leadingIcon={<GlobeIcon />}
            className="top-bar__environment-select"
          />
          {settings.debugMode && (
            <Tooltip content="Developer Tools" position="bottom">
              <Button variant="ghost" size="sm" onClick={() => window.electronAPI?.toggleDevTools()}>
                <DevToolsIcon />
              </Button>
            </Tooltip>
          )}
          <Tooltip content="Screen Mirroring" position="bottom">
            <Button variant="ghost" size="sm" onClick={() => openScreenMirrorModal()}>
              <PhoneIcon />
            </Button>
          </Tooltip>
          <Tooltip content="Settings" position="bottom">
            <Button variant="ghost" size="sm" onClick={() => openSettingsModal()}>
              <SettingsIcon />
            </Button>
          </Tooltip>
        </div>
      </div>
      
      <WorkspaceModal
        isOpen={workspaceModalOpen}
        onClose={() => setWorkspaceModalOpen(false)}
        mode={workspaceModalMode}
        workspace={editingWorkspace}
        onSave={handleSaveWorkspace}
        onDelete={workspaces.length > 1 ? handleDeleteWorkspace : undefined}
        echolonPath={echolonPath}
      />
      
      {/* Push Modal */}
      {pushModalOpen && (
        <div className="workspace-modal-overlay" onClick={() => setPushModalOpen(false)}>
          <div className="workspace-modal top-bar__push-modal" onClick={e => e.stopPropagation()}>
            <h3 className="workspace-modal__title">
              <GitHubIcon />
              Push Changes to GitHub
            </h3>
            
            {syncStatus?.localChanges && syncStatus.localChanges.length > 0 && (
              <div className="top-bar__push-changes">
                <p>{syncStatus.localChanges.length} file{syncStatus.localChanges.length !== 1 ? 's' : ''} to push:</p>
                <ul>
                  {syncStatus.localChanges.slice(0, 5).map(change => (
                    <li key={change.path} className={`top-bar__push-change top-bar__push-change--${change.type}`}>
                      <span className="top-bar__push-change-type">
                        {change.type === 'added' ? '+' : change.type === 'deleted' ? '-' : '~'}
                      </span>
                      {change.path}
                    </li>
                  ))}
                  {syncStatus.localChanges.length > 5 && (
                    <li className="top-bar__push-change-more">
                      ...and {syncStatus.localChanges.length - 5} more
                    </li>
                  )}
                </ul>
              </div>
            )}
            
            <div className="workspace-modal__field">
              <label htmlFor="commit-message">Commit Message</label>
              <input
                id="commit-message"
                type="text"
                value={commitMessage}
                onChange={e => setCommitMessage(e.target.value)}
                placeholder="Update workspace collections"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handlePush()}
              />
            </div>
            
            {pushError && (
              <div className="top-bar__push-error">
                <div className="top-bar__push-error-text">
                  {pushError.length > 80 ? pushError.substring(0, 80) + '...' : pushError}
                </div>
                <button 
                  type="button"
                  className="top-bar__push-error-details"
                  onClick={() => setGitErrorModalOpen(true)}
                >
                  View Full Error
                </button>
              </div>
            )}
            
            <div className="workspace-modal__actions">
              <div className="workspace-modal__actions-right">
                <button 
                  type="button" 
                  className="workspace-modal__cancel" 
                  onClick={() => {
                    setPushModalOpen(false);
                    setPushError(null);
                  }}
                >
                  Cancel
                </button>
                <button 
                  type="button"
                  className="workspace-modal__save"
                  onClick={handlePush}
                  disabled={isSyncing || !commitMessage.trim()}
                >
                  {isSyncing ? 'Pushing...' : 'Push'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Git Error Details Modal */}
      {gitErrorModalOpen && pushError && (
        <div className="modal-overlay" onClick={() => setGitErrorModalOpen(false)}>
          <div className="modal modal--lg" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2 className="modal__title" style={{ color: 'var(--color-error)' }}>GitHub Error</h2>
              <button 
                className="modal__close"
                onClick={() => setGitErrorModalOpen(false)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="modal__content">
              <pre className="git-error-modal__message">{pushError}</pre>
            </div>
            <div className="modal__footer">
              <button 
                className="git-error-modal__copy"
                onClick={() => {
                  navigator.clipboard.writeText(pushError);
                }}
              >
                Copy Error
              </button>
              <button 
                className="git-error-modal__ok"
                onClick={() => setGitErrorModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default TopBar;

