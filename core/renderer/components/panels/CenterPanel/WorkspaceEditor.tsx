import React, { useState, useCallback, useMemo } from 'react';
import { TabBar, Button, Input, Tooltip, Modal, EditableTable, Switch, ColorEmojiPicker } from '@/components/ui';
import { CollectionsIcon, TrashIcon, OpenIcon, AlertIcon, GlobeIcon, PlusIcon } from '@/components/ui/icons';
import { useWorkspace, useCollections, useRequest, useApp } from '@/contexts';
import { WORKSPACE_COLORS } from '../../../../shared/constants';
import { Collection, Folder, WorkspaceEnvironment, KeyValuePair } from '@/types';
import './WorkspaceEditor.css';

// Helper to count all requests in a collection (including folders)
const countAllRequests = (collection: Collection): number => {
  const countInFolder = (folder: Folder): number => {
    let count = folder.requests.length;
    for (const subFolder of folder.folders) {
      count += countInFolder(subFolder);
    }
    return count;
  };

  let total = collection.requests.length;
  for (const folder of collection.folders) {
    total += countInFolder(folder);
  }
  return total;
};

interface WorkspaceEditorProps {
  workspaceId: string;
}

type WorkspaceTab = 'overview' | 'collections' | 'environments';

const workspaceTabs = [
  { id: 'overview' as const, title: 'Overview' },
  { id: 'collections' as const, title: 'Collections' },
  { id: 'environments' as const, title: 'Environments' },
];

export const WorkspaceEditor: React.FC<WorkspaceEditorProps> = ({ workspaceId }) => {
  const { 
    workspaces, 
    updateWorkspace, 
    deleteWorkspace,
    addWorkspaceEnvironment,
    updateWorkspaceEnvironment,
    deleteWorkspaceEnvironment
  } = useWorkspace();
  const { collections, allCollections, deleteCollection } = useCollections();
  const { updateTab, activeTabId, renameTab, addCollectionTab, closeTab } = useRequest();
  const { settings } = useApp();
  
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showNewEnvModal, setShowNewEnvModal] = useState(false);
  const [newEnvName, setNewEnvName] = useState('');
  const colorInputRef = React.useRef<HTMLInputElement>(null);
  
  const workspace = workspaces.find(w => w.id === workspaceId);
  
  // Get collections for this workspace
  const workspaceCollections = allCollections.filter(c => c.workspaceId === workspaceId);

  // All hooks must be called before any early returns
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    updateWorkspace(workspaceId, { name: newName });
    
    // Update the tab title
    if (activeTabId) {
      renameTab(activeTabId, newName);
    }
  }, [workspaceId, updateWorkspace, activeTabId, renameTab]);

  const handleDescriptionChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateWorkspace(workspaceId, { description: e.target.value });
    
    // Mark tab as dirty (only if auto-save is disabled)
    if (activeTabId && !settings.autoSave) {
      updateTab(activeTabId, { isDirty: true });
    }
  }, [workspaceId, updateWorkspace, updateTab, activeTabId, settings.autoSave]);

  const handleColorChange = useCallback((color: string) => {
    updateWorkspace(workspaceId, { color });
    
    // Mark tab as dirty (only if auto-save is disabled)
    if (activeTabId && !settings.autoSave) {
      updateTab(activeTabId, { isDirty: true });
    }
  }, [workspaceId, updateWorkspace, updateTab, activeTabId, settings.autoSave]);

  const handleOpenCollection = useCallback((collectionId: string) => {
    const collection = allCollections.find(c => c.id === collectionId);
    if (collection) {
      addCollectionTab(collection);
    }
  }, [allCollections, addCollectionTab]);

  const handleDeleteCollection = useCallback((collectionId: string) => {
    if (window.confirm('Are you sure you want to delete this collection? This action cannot be undone.')) {
      deleteCollection(collectionId);
    }
  }, [deleteCollection]);

  const handleDeleteWorkspace = useCallback(() => {
    deleteWorkspace(workspaceId);
    setShowDeleteModal(false);
    if (activeTabId) {
      closeTab(activeTabId);
    }
  }, [deleteWorkspace, workspaceId, activeTabId, closeTab]);

  // Environment handlers
  const handleAddEnvironment = useCallback(async () => {
    if (!newEnvName.trim()) return;
    await addWorkspaceEnvironment(workspaceId, newEnvName.trim());
    setNewEnvName('');
    setShowNewEnvModal(false);
  }, [workspaceId, newEnvName, addWorkspaceEnvironment]);

  const handleDeleteEnvironment = useCallback(async (envId: string) => {
    await deleteWorkspaceEnvironment(workspaceId, envId);
  }, [workspaceId, deleteWorkspaceEnvironment]);

  const handleEnvironmentNameChange = useCallback((envId: string, name: string) => {
    updateWorkspaceEnvironment(workspaceId, envId, { name });
  }, [workspaceId, updateWorkspaceEnvironment]);

  const handleEnvironmentVariablesChange = useCallback((envId: string, variables: KeyValuePair[]) => {
    updateWorkspaceEnvironment(workspaceId, envId, { variables });
  }, [workspaceId, updateWorkspaceEnvironment]);

  const handleToggleEnvironmentActive = useCallback((envId: string) => {
    const env = workspace?.environments?.find(e => e.id === envId);
    if (env) {
      updateWorkspaceEnvironment(workspaceId, envId, { isActive: !env.isActive });
    }
  }, [workspaceId, workspace?.environments, updateWorkspaceEnvironment]);

  const handleEnvironmentColorEmojiChange = useCallback((envId: string, updates: { color?: string; emoji?: string }) => {
    updateWorkspaceEnvironment(workspaceId, envId, updates);
  }, [workspaceId, updateWorkspaceEnvironment]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Create stable empty rows for each environment (keyed by env id)
  // This prevents generating new UUIDs on each render which causes cursor jumping
  const emptyRowsByEnvId = useMemo(() => {
    const map: Record<string, KeyValuePair[]> = {};
    workspace?.environments?.forEach(env => {
      map[env.id] = [{ id: `empty-${env.id}`, key: '', value: '', enabled: true }];
    });
    return map;
  }, [workspace?.environments?.map(e => e.id).join(',')]);

  // Create stable onChange callbacks for each environment to prevent re-renders
  const envVariablesChangeCallbacks = useMemo(() => {
    const callbacks: Record<string, (vars: KeyValuePair[]) => void> = {};
   workspace?.environments?.forEach(env => {
      callbacks[env.id] = (vars: KeyValuePair[]) => handleEnvironmentVariablesChange(env.id, vars);
    });
    return callbacks;
  }, [workspace?.environments?.map(e => e.id).join(','), handleEnvironmentVariablesChange]);

  // Early return after all hooks
  if (!workspace) {
    return (
      <div className="workspace-editor workspace-editor--not-found">
        <div className="workspace-editor__empty">
          <CollectionsIcon />
          <h3>Workspace Not Found</h3>
          <p>This workspace may have been deleted.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-editor">
      {/* Header */}
      <div className="workspace-editor__header">
        <div className="workspace-editor__header-content">
          <span 
            className="workspace-editor__color-indicator"
            style={{ backgroundColor: workspace.color || WORKSPACE_COLORS[0] }}
          />
          <h2 className="workspace-editor__title">{workspace.name}</h2>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="workspace-editor__tabs">
        <TabBar
          tabs={workspaceTabs}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as WorkspaceTab)}
        />
      </div>

      {/* Tab Content */}
      <div className="workspace-editor__content">
        {activeTab === 'overview' && (
          <div className="workspace-editor__overview">
            {/* Color Selection */}
            <div className="workspace-editor__field">
              <label className="workspace-editor__label">Color</label>
              <div className="workspace-editor__colors">
                {WORKSPACE_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`workspace-editor__color-btn ${workspace.color === color ? 'workspace-editor__color-btn--active' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => handleColorChange(color)}
                    aria-label={`Select color ${color}`}
                  />
                ))}
                {/* Custom color picker */}
                <button
                  className={`workspace-editor__color-btn workspace-editor__color-btn--custom ${!WORKSPACE_COLORS.includes(workspace.color || '') && workspace.color ? 'workspace-editor__color-btn--active' : ''}`}
                  style={{ backgroundColor: !WORKSPACE_COLORS.includes(workspace.color || '') ? workspace.color : 'transparent' }}
                  onClick={() => colorInputRef.current?.click()}
                  aria-label="Choose custom color"
                  title="Custom color"
                />
                <input
                  ref={colorInputRef}
                  type="color"
                  className="workspace-editor__color-input-hidden"
                  value={workspace.color || '#6366f1'}
                  onChange={(e) => handleColorChange(e.target.value)}
                />
              </div>
            </div>

            {/* Name Field */}
            <div className="workspace-editor__field">
              <label className="workspace-editor__label">Name</label>
              <Input
                value={workspace.name}
                onChange={handleNameChange}
                placeholder="Workspace name"
              />
            </div>

            {/* Description Field */}
            <div className="workspace-editor__field">
              <label className="workspace-editor__label">Description</label>
              <textarea
                className="workspace-editor__textarea"
                value={workspace.description || ''}
                onChange={handleDescriptionChange}
                placeholder="Add a description for this workspace..."
                rows={4}
              />
            </div>

            {/* Metadata */}
            <div className="workspace-editor__metadata">
              <div className="workspace-editor__metadata-item">
                <span className="workspace-editor__metadata-label">Created</span>
                <span className="workspace-editor__metadata-value">{formatDate(workspace.createdAt)}</span>
              </div>
              {workspace.updatedAt !== workspace.createdAt && (
                <div className="workspace-editor__metadata-item">
                  <span className="workspace-editor__metadata-label">Updated</span>
                  <span className="workspace-editor__metadata-value">{formatDate(workspace.updatedAt)}</span>
                </div>
              )}
            </div>

            {/* Danger Zone */}
            <div className="workspace-editor__danger-zone">
              <h4>Danger Zone</h4>
              <div className={`workspace-editor__danger-action ${workspaceCollections.length > 0 ? 'workspace-editor__danger-action--blocked' : ''}`}>
                <div className="workspace-editor__danger-info">
                  <span className="workspace-editor__danger-title">Delete this workspace</span>
                  <span className="workspace-editor__danger-description">
                    {workspaceCollections.length > 0 
                      ? `This workspace contains ${workspaceCollections.length} collection${workspaceCollections.length !== 1 ? 's' : ''}. Move or delete all collections before deleting the workspace.`
                      : 'Once deleted, this action cannot be undone.'
                    }
                  </span>
                </div>
                <Tooltip 
                  content={workspaceCollections.length > 0 ? 'Remove all collections first' : ''}
                  position="left"
                >
                  <Button 
                    variant="danger" 
                    size="sm" 
                    onClick={() => setShowDeleteModal(true)}
                    icon={<TrashIcon />}
                    disabled={workspaceCollections.length > 0}
                  >
                    Delete Workspace
                  </Button>
                </Tooltip>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'collections' && (
          <div className="workspace-editor__collections">
            {workspaceCollections.length === 0 ? (
              <div className="workspace-editor__empty-collections">
                <CollectionsIcon />
                <h4>No Collections</h4>
                <p>This workspace doesn't have any collections yet.</p>

              </div>
            ) : (
              <div className="workspace-editor__collections-list">
                {workspaceCollections.map((collection) => (
                  <div 
                    key={collection.id} 
                    className="workspace-editor__collection-item"
                    onClick={() => handleOpenCollection(collection.id)}
                  >
                    <div className="workspace-editor__collection-info">
                      <span className="workspace-editor__collection-name">{collection.name}</span>
                      {collection.description && (
                        <span className="workspace-editor__collection-description">
                          {collection.description}
                        </span>
                      )}
                    </div>
                    <div className="workspace-editor__collection-meta">
                      <span className="workspace-editor__collection-count">
                        {countAllRequests(collection)} requests
                      </span>
                      <Tooltip content="Open collection">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenCollection(collection.id);
                          }}
                        >
                          <OpenIcon />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Delete collection">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="workspace-editor__delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCollection(collection.id);
                          }}
                        >
                          <TrashIcon />
                        </Button>
                      </Tooltip>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'environments' && (
          <div className="workspace-editor__environments">
            <div className="workspace-editor__section-description">
              <p>
                Workspace environments let you define variables specific to this workspace.
                These variables <strong>override</strong> global environment variables but are overridden by collection variables.
              </p>
            </div>
            
            <div className="workspace-editor__environments-header">
              <Button 
                variant="secondary" 
                size="sm" 
                icon={<PlusIcon />}
                onClick={() => setShowNewEnvModal(true)}
              >
                New Environment
              </Button>
            </div>

            {(!workspace.environments || workspace.environments.length === 0) ? (
              <div className="workspace-editor__environments-empty">
                <GlobeIcon />
                <p>No workspace environments yet</p>
                <p className="workspace-editor__environments-empty-hint">
                  Create an environment to define workspace-specific variables that override global ones.
                </p>
              </div>
            ) : (
              <div className="workspace-editor__environments-list">
                {workspace.environments.map((env: WorkspaceEnvironment) => (
                  <div key={env.id} className={`workspace-editor__environment ${env.isActive ? 'active' : ''}`}>
                    <div className="workspace-editor__environment-header">
                      <div className="workspace-editor__environment-info">
                        <ColorEmojiPicker
                          color={env.color}
                          emoji={env.emoji}
                          onChange={(updates) => handleEnvironmentColorEmojiChange(env.id, updates)}
                          size="sm"
                        />
                        <Input
                          value={env.name}
                          onChange={(e) => handleEnvironmentNameChange(env.id, e.target.value)}
                          className="workspace-editor__environment-name"
                          size="sm"
                        />
                      </div>
                      <div className="workspace-editor__environment-actions">
                        <Tooltip content="Delete environment" position="left">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteEnvironment(env.id)}
                            icon={<TrashIcon />}
                          />
                        </Tooltip>
                        <Tooltip content={env.isActive ? 'Hide from dropdown' : 'Show in dropdown'} position="left">
                          <span className="workspace-editor__environment-switch">
                            <Switch
                              checked={env.isActive}
                              onChange={() => handleToggleEnvironmentActive(env.id)}
                              size="sm"
                            />
                          </span>
                        </Tooltip>
                      </div>
                    </div>
                    <div className="workspace-editor__environment-variables">
                      <EditableTable
                        data={env.variables.length === 0 
                          ? emptyRowsByEnvId[env.id] || [{ id: `empty-${env.id}`, key: '', value: '', enabled: true }]
                          : env.variables
                        }
                        onChange={envVariablesChangeCallbacks[env.id]}
                        keyPlaceholder="Variable name"
                        valuePlaceholder="Value"
                        descriptionPlaceholder="Description (optional)"
                        showDescription={true}
                        showSecureToggle={true}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Workspace"
        size="sm"
      >
        <div className="workspace-editor__delete-modal">
          <div className="workspace-editor__delete-icon">
            <AlertIcon />
          </div>
          <p className="workspace-editor__delete-message">
            Are you sure you want to delete <strong>{workspace.name}</strong>?
          </p>
          <p className="workspace-editor__delete-warning">
            Collections in this workspace will be moved to the default workspace.
            This action cannot be undone.
          </p>
          <div className="workspace-editor__delete-actions">
            <Button variant="secondary" onClick={() => setShowDeleteModal(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDeleteWorkspace}>
              Delete Workspace
            </Button>
          </div>
        </div>
      </Modal>

      {/* New Environment Modal */}
      <Modal
        isOpen={showNewEnvModal}
        onClose={() => {
          setShowNewEnvModal(false);
          setNewEnvName('');
        }}
        title="New Environment"
        size="sm"
      >
        <div className="workspace-editor__new-env-modal">
          <p>Create a new environment for this workspace.</p>
          <Input
            value={newEnvName}
            onChange={(e) => setNewEnvName(e.target.value)}
            placeholder="Environment name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newEnvName.trim()) {
                handleAddEnvironment();
              }
            }}
          />
          <div className="workspace-editor__new-env-actions">
            <Button variant="secondary" onClick={() => {
              setShowNewEnvModal(false);
              setNewEnvName('');
            }}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleAddEnvironment} disabled={!newEnvName.trim()}>
              Create Environment
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default WorkspaceEditor;

