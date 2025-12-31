import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Button, Tooltip, AutoComplete, AutoCompleteOption } from '@/components/ui';
import { 
  ChevronLeftIcon, ChevronRightIcon, SearchIcon, SettingsIcon, 
  ChevronDownIcon, CheckIcon, PlusIcon, EditIcon, TrashIcon, GlobeIcon,
  TabsIcon, ListIcon 
} from '@/components/ui/icons';
import { useApp, useRequest, useWorkspace, useEnvironments, useCollections, useWebMode, useFileStorage } from '@/contexts';
import './TopBar.css';

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
  const { openSettingsModal, openGlobalSearch, openNewEnvironmentModal, viewMode, setViewMode } = useApp();
  const { canGoBack, canGoForward, goBack, goForward, activeTab } = useRequest();
  const { workspaces, activeWorkspace, setActiveWorkspace, addWorkspace, updateWorkspace, deleteWorkspace, selectedWorkspaceEnvironment, selectWorkspaceEnvironment } = useWorkspace();
  const { activeEnvironments, selectedEnvironment, selectEnvironment, addEnvironment } = useEnvironments();
  const { collections, setActiveCollectionEnvironment } = useCollections();
  const { readonly, isWebMode } = useWebMode();
  const { echolonPath } = useFileStorage();
  
  const [workspaceDropdownOpen, setWorkspaceDropdownOpen] = useState(false);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [workspaceModalMode, setWorkspaceModalMode] = useState<'create' | 'edit'>('create');
  const [editingWorkspace, setEditingWorkspace] = useState<{ id: string; name: string; description?: string; color?: string } | undefined>();
  
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Get the current collection based on active tab
  // First try collectionId, then fall back to finding collection containing this request
  const currentCollection = useMemo(() => {
    if (!activeTab?.request) return null;
    
    // First, try direct collectionId lookup
    if (activeTab.request.collectionId) {
      return collections.find(c => c.id === activeTab.request?.collectionId) || null;
    }
    
    // Fallback: find collection containing this request by ID
    const requestId = activeTab.request.id;
    if (!requestId) return null;
    
    for (const collection of collections) {
      // Check direct requests
      if (collection.requests?.some(r => r.id === requestId)) {
        return collection;
      }
      // Check requests in folders
      if (collection.folders?.some(folder => 
        folder.requests?.some(r => r.id === requestId)
      )) {
        return collection;
      }
    }
    
    return null;
  }, [activeTab, collections]);

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
        color: env.isActive === false ? '#6b7280' : (!env.emoji ? (env.color || '#f59e0b') : undefined), // Gray for hidden, custom color or orange for visible
      }));
      options.push(...collEnvs);
    }

    return options;
  }, [activeEnvironments, activeWorkspace?.environments, activeWorkspace?.id, currentCollection]);

  const handleEnvironmentChange = (envId: string | null) => {
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

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setWorkspaceDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
      const newWorkspace = addWorkspace(name, description, color);
      setActiveWorkspace(newWorkspace.id);
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
            /* Show Echolon logo in readonly mode */
            <div className="top-bar__logo">
              <EcholonLogo />
              <span className="top-bar__logo-text">Echolon</span>
            </div>
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
          <div className="top-bar__environment">
            <Tooltip content="Select environment" position="bottom">
              <span className="top-bar__environment-icon">
                <GlobeIcon />
              </span>
            </Tooltip>
            <AutoComplete<string | null>
              options={environmentOptions}
              value={(() => {
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
              onCreate={handleCreateEnvironment}
              createLabel="Create environment"
              onCreateClick={openNewEnvironmentModal}
              createButtonLabel="New Environment"
              className="top-bar__environment-select"
            />
          </div>
          <Tooltip content="Settings" position="bottom">
            <Button variant="ghost" size="sm" onClick={openSettingsModal}>
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
    </>
  );
};

export default TopBar;

