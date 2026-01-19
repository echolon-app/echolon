import React, { useState, useCallback } from 'react';
import { useGitOptional } from '@/contexts/GitContext';
import { useGitHub } from '@/contexts/GitHubContext';
import { useApp } from '@/contexts/AppContext';
import { useToast } from '@/contexts/ToastContext';
import { useRequest } from '@/contexts/RequestContext';
import { useWebMode } from '@/contexts/WebModeContext';
import { isElectron } from '@/utils';
import { 
  GitBranchIcon, GitCommitIcon, GitPullRequestIcon, RefreshIcon, 
  UploadIcon, DownloadIcon, PlusIcon, XIcon, CheckIcon, 
  GitHubIcon, RevertIcon, FolderIcon, TrashIcon
} from '@/components/ui/icons';
import './GitPanel.css';

type TabType = 'changes' | 'history' | 'branches';

interface GitPanelProps {
  onConnectClick: () => void;
  onOpenDiff?: (filePath: string, status: string) => void;
}

export const GitPanel: React.FC<GitPanelProps> = ({ onConnectClick, onOpenDiff }) => {
  const gitContext = useGitOptional();
  const { isWebMode } = useWebMode();
  
  // Destructure git context if available, otherwise use safe defaults
  const {
    isInitialized = false,
    isLoading = false,
    error = null,
    status = null,
    commits = [],
    branches = [],
    currentBranch = null,
    remotes = [],
    workspacePath = null,
    
    initRepo = async () => ({ success: false, error: 'Git not available' }),
    refreshAll = async () => {},
    
    stageFile = async () => ({ success: false, error: 'Git not available' }),
    stageAll = async () => ({ success: false, error: 'Git not available' }),
    unstageFile = async () => ({ success: false, error: 'Git not available' }),
    discardChanges = async () => ({ success: false, error: 'Git not available' }),
    
    commit = async () => ({ success: false, error: 'Git not available' }),
    
    createBranch = async () => ({ success: false, error: 'Git not available' }),
    checkoutBranch = async () => ({ success: false, error: 'Git not available' }),
    deleteBranch = async () => ({ success: false, error: 'Git not available' }),
    
    addRemote = async () => ({ success: false, error: 'Git not available' }),
    removeRemote = async () => ({ success: false, error: 'Git not available' }),
    
    push = async () => ({ success: false, error: 'Git not available' }),
    pull = async () => ({ success: false, error: 'Git not available' }),
    
    getTotalChanges = () => 0,
    hasChanges = () => false,
  } = gitContext || {};

  const { isAuthenticated, user } = useGitHub();
  const { setSidebarView } = useApp();
  const { info, success: showSuccess, error: showError } = useToast();
  const { addDiffTab } = useRequest();

  const [activeTab, setActiveTab] = useState<TabType>('changes');
  
  // Refresh data when switching to history tab
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    if (tab === 'history') {
      refreshAll();
    }
  };
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isCommitPushing, setIsCommitPushing] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [showNewBranchInput, setShowNewBranchInput] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [showAddRemoteModal, setShowAddRemoteModal] = useState(false);
  const [newRemoteName, setNewRemoteName] = useState('origin');
  const [newRemoteUrl, setNewRemoteUrl] = useState('');
  const [isEditingRemote, setIsEditingRemote] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);

  // Open remote modal (for add or edit)
  const openRemoteModal = useCallback((edit: boolean = false) => {
    if (edit && remotes.length > 0) {
      setNewRemoteName(remotes[0].name);
      setNewRemoteUrl(remotes[0].url);
      setIsEditingRemote(true);
    } else {
      setNewRemoteName('origin');
      setNewRemoteUrl('');
      setIsEditingRemote(false);
    }
    setShowAddRemoteModal(true);
  }, [remotes]);

  // Handle init repo
  const handleInitRepo = useCallback(async () => {
    await initRepo();
  }, [initRepo]);

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    await refreshAll();
  }, [refreshAll]);

  // Handle commit
  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) return;
    
    setIsCommitting(true);
    const result = await commit(commitMessage);
    setIsCommitting(false);
    
    if (result.success) {
      setCommitMessage('');
    }
  }, [commitMessage, commit]);

  // Handle commit and push
  const handleCommitAndPush = useCallback(async () => {
    if (!commitMessage.trim()) return;
    
    setIsCommitPushing(true);
    const commitResult = await commit(commitMessage);
    
    if (commitResult.success) {
      setCommitMessage('');
      await push();
    }
    setIsCommitPushing(false);
  }, [commitMessage, commit, push]);

  // Handle push
  const handlePush = useCallback(async () => {
    setIsPushing(true);
    const result = await push();
    setIsPushing(false);
    if (result.success) {
      showSuccess('Changes pushed successfully');
    }
  }, [push, showSuccess]);

  // Handle pull
  const handlePull = useCallback(async () => {
    setIsPulling(true);
    await pull();
    setIsPulling(false);
  }, [pull]);

  // Handle stage all
  const handleStageAll = useCallback(async () => {
    await stageAll();
  }, [stageAll]);

  // Handle create branch
  const handleCreateBranch = useCallback(async () => {
    if (!newBranchName.trim()) return;
    
    const result = await createBranch(newBranchName, true);
    if (result.success) {
      setNewBranchName('');
      setShowNewBranchInput(false);
    }
  }, [newBranchName, createBranch]);

  // Handle add/edit remote
  const handleAddRemote = useCallback(async () => {
    if (!newRemoteName.trim() || !newRemoteUrl.trim()) return;
    
    // If editing and name changed, remove old remote first
    if (isEditingRemote && remotes.length > 0 && remotes[0].name !== newRemoteName) {
      await removeRemote(remotes[0].name);
    } else if (isEditingRemote && remotes.length > 0) {
      // If just URL changed, remove and re-add
      await removeRemote(remotes[0].name);
    }
    
    const result = await addRemote(newRemoteName, newRemoteUrl);
    if (result.success) {
      setNewRemoteName('origin');
      setNewRemoteUrl('');
      setShowAddRemoteModal(false);
      setIsEditingRemote(false);
    }
  }, [newRemoteName, newRemoteUrl, addRemote, removeRemote, isEditingRemote, remotes]);

  // Handle file click - open diff view
  const handleFileClick = useCallback(async (filePath: string, fileStatus: string) => {
    if (!isElectron() || !workspacePath) {
      info('Diff viewer is only available in the desktop app');
      return;
    }

    // Get file content for diff
    try {
      const result = await window.electronAPI.gitGetFileForDiff(workspacePath, filePath);
      
      if (result.success) {
        const status = fileStatus === 'added' ? 'added' : 
                      fileStatus === 'deleted' ? 'deleted' : 'modified';
        addDiffTab(
          filePath, 
          result.oldContent || '', 
          result.newContent || '', 
          status as 'added' | 'modified' | 'deleted'
        );
      } else {
        showError('Failed to load diff', result.error);
      }
    } catch (err) {
      showError('Failed to load diff', err instanceof Error ? err.message : 'Unknown error');
    }
    
    // Call the onOpenDiff callback if provided
    if (onOpenDiff) {
      onOpenDiff(filePath, fileStatus);
    }
  }, [workspacePath, addDiffTab, info, showError, onOpenDiff]);

  // Format timestamp
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    
    return date.toLocaleDateString();
  };

  // Git not available (web mode)
  if (!gitContext) {
    return (
      <div className="git-panel">
        <div className="git-panel__header">
          <h3>
            <GitBranchIcon />
            Git
          </h3>
        </div>
        <div className="git-panel__not-connected">
          <GitBranchIcon />
          <h4>Git Not Available</h4>
          <p>
            {isWebMode 
              ? 'Git version control is only available in the desktop app.'
              : 'Git functionality is not available.'
            }
          </p>
        </div>
      </div>
    );
  }

  // No workspace selected
  if (!workspacePath) {
    return (
      <div className="git-panel">
        <div className="git-panel__header">
          <h3>
            <GitBranchIcon />
            Git
          </h3>
        </div>
        <div className="git-panel__not-connected">
          <FolderIcon />
          <h4>No Workspace Selected</h4>
          <p>
            Select a workspace to use Git version control.
          </p>
        </div>
      </div>
    );
  }

  // Not initialized - show init button
  if (!isInitialized) {
    return (
      <div className="git-panel">
        <div className="git-panel__header">
          <h3>
            <GitBranchIcon />
            Git
          </h3>
        </div>
        <div className="git-panel__not-connected">
          <GitBranchIcon />
          <h4>Initialize Repository</h4>
          <p>
            This workspace is not a Git repository yet. Initialize it to start tracking changes.
          </p>
          <button 
            className="git-panel__connect-btn" 
            onClick={handleInitRepo}
            disabled={isLoading}
          >
            <GitBranchIcon />
            {isLoading ? 'Initializing...' : 'Initialize Git Repository'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="git-panel">
      <div className="git-panel__header">
        <h3>
          <GitBranchIcon />
          Git
        </h3>
        <div className="git-panel__actions">
          <button 
            className="git-panel__action-btn"
            onClick={handleRefresh}
            disabled={isLoading}
            title="Refresh"
          >
            <span className={isLoading ? 'spin' : ''}>
              <RefreshIcon />
            </span>
          </button>
        </div>
      </div>

      {/* Branch info */}
      <div className="git-panel__repo-info">
        <div className="repo-avatar">
          <GitBranchIcon />
        </div>
        <div className="repo-details">
          <div className="repo-name">{currentBranch || 'main'}</div>
          <div className="repo-branch">
            {remotes.length > 0 ? (
              <>
                <span className="remote-indicator">●</span>
                {remotes[0].name}
                <button 
                  className="remote-edit-btn"
                  onClick={() => openRemoteModal(true)}
                  title="Edit remote"
                >
                  Edit
                </button>
              </>
            ) : (
              <button 
                className="no-remote-btn"
                onClick={() => openRemoteModal(false)}
              >
                No remote configured
              </button>
            )}
          </div>
        </div>
        {!isAuthenticated && remotes.length === 0 && (
        <button 
            className="git-panel__connect-btn git-panel__connect-btn--small"
            onClick={onConnectClick}
            title="Connect GitHub to push/pull"
        >
            <GitHubIcon />
        </button>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="git-panel__error">
          <XIcon />
          <span>{error.length > 60 ? error.substring(0, 60) + '...' : error}</span>
          {error.length > 60 && (
            <button 
              className="git-panel__error-details-btn"
              onClick={() => setShowErrorModal(true)}
            >
              Details
            </button>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="git-panel__tabs">
        <button
          className={`git-panel__tab ${activeTab === 'changes' ? 'git-panel__tab--active' : ''}`}
          onClick={() => handleTabChange('changes')}
        >
          <GitPullRequestIcon />
          Changes
          {getTotalChanges() > 0 && (
            <span className="badge">{getTotalChanges()}</span>
          )}
        </button>
        <button
          className={`git-panel__tab ${activeTab === 'history' ? 'git-panel__tab--active' : ''}`}
          onClick={() => handleTabChange('history')}
        >
          <GitCommitIcon />
          History
        </button>
        <button
          className={`git-panel__tab ${activeTab === 'branches' ? 'git-panel__tab--active' : ''}`}
          onClick={() => handleTabChange('branches')}
        >
          <GitBranchIcon />
          Branches
        </button>
      </div>

      {/* Tab content */}
      <div className="git-panel__content">
        {activeTab === 'changes' && (
          <div className="git-panel__changes">
            {/* Staged files */}
            {status && status.staged.length > 0 && (
              <div className="git-panel__section">
                <div className="git-panel__section-header">
                  <span>Staged Changes ({status.staged.length})</span>
                </div>
                {status.staged.map((file) => (
                  <div 
                    key={file.path} 
                    className="git-panel__change-file"
                    onClick={() => handleFileClick(file.path, file.status)}
                  >
                    <span className={`file-status file-status--${file.status}`}>
                      {file.status === 'added' ? 'A' : file.status === 'modified' ? 'M' : 'D'}
                    </span>
                    <span className="file-name">{file.path.split('/').pop()}</span>
                    <span className="file-path">{file.path}</span>
                    <button 
                      className="file-action file-action--unstage"
                      onClick={(e) => { e.stopPropagation(); unstageFile(file.path); }}
                      title="Unstage"
                    >
                      Unstage
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Unstaged files */}
            {status && status.unstaged.length > 0 && (
              <div className="git-panel__section">
                <div className="git-panel__section-header">
                  <span>Changes ({status.unstaged.length})</span>
                  <button 
                    className="git-panel__stage-all-btn"
                    onClick={handleStageAll}
                    title="Stage All"
                  >
                    Stage All
                  </button>
                </div>
                {status.unstaged.map((file) => (
                  <div 
                    key={file.path} 
                    className="git-panel__change-file"
                    onClick={() => handleFileClick(file.path, file.status)}
                  >
                    <span className={`file-status file-status--${file.status}`}>
                      {file.status === 'added' ? 'A' : file.status === 'modified' ? 'M' : 'D'}
                    </span>
                    <span className="file-name">{file.path.split('/').pop()}</span>
                    <span className="file-path">{file.path}</span>
                    <div className="file-actions">
                      <button 
                        className="file-action file-action--stage"
                        onClick={(e) => { e.stopPropagation(); stageFile(file.path); }}
                        title="Stage"
                      >
                        Stage
                      </button>
                      <button 
                        className="file-action file-action--discard"
                        onClick={(e) => { e.stopPropagation(); discardChanges(file.path); }}
                        title="Discard Changes"
                      >
                        <RevertIcon />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Untracked files */}
            {status && status.untracked.length > 0 && (
              <div className="git-panel__section">
                <div className="git-panel__section-header">
                  <span>Untracked Files ({status.untracked.length})</span>
                  <button 
                    className="git-panel__stage-all-btn"
                    onClick={handleStageAll}
                    title="Stage All"
                  >
                    Stage All
                  </button>
                </div>
                {status.untracked.map((filepath) => (
                  <div 
                    key={filepath} 
                    className="git-panel__change-file"
                    onClick={() => handleFileClick(filepath, 'added')}
                  >
                    <span className="file-status file-status--untracked">?</span>
                    <span className="file-name">{filepath.split('/').pop()}</span>
                    <span className="file-path">{filepath}</span>
                    <button 
                      className="file-action file-action--stage"
                      onClick={(e) => { e.stopPropagation(); stageFile(filepath); }}
                      title="Stage"
                    >
                      Stage
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* No changes */}
            {!hasChanges() && (
              <div className="git-panel__changes-empty">
                <CheckIcon />
                <p>No uncommitted changes</p>
              </div>
            )}

            {/* Commit input */}
            {status && status.staged.length > 0 && (
              <div className="git-panel__commit-form">
                <textarea
                  className="git-panel__commit-input"
                  placeholder="Commit message..."
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      handleCommit();
                    }
                  }}
                />
                <button
                  className="git-panel__commit-btn"
                  onClick={handleCommit}
                  disabled={!commitMessage.trim() || isCommitting || isCommitPushing}
                >
                  <GitCommitIcon />
                  {isCommitting ? 'Committing...' : 'Commit'}
                </button>
                {remotes.length > 0 && (
                  <button
                    className="git-panel__commit-push-btn"
                    onClick={handleCommitAndPush}
                    disabled={!commitMessage.trim() || isCommitting || isCommitPushing}
                  >
                    <UploadIcon />
                    {isCommitPushing ? 'Committing & Pushing...' : 'Commit & Push'}
                  </button>
                )}
                </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="git-panel__history">
            {isLoading ? (
              <div className="git-panel__loading">
                <div className="spinner" />
              </div>
            ) : commits.length === 0 ? (
              <div className="git-panel__changes-empty">
                <GitCommitIcon />
                <p>No commits yet</p>
              </div>
            ) : (
              commits.map((item) => (
                <div 
                  key={item.oid} 
                  className="git-panel__commit"
                >
                  <div className="commit-avatar">
                    {item.author.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="commit-details">
                    <div className="commit-message">{item.message.split('\n')[0]}</div>
                    <div className="commit-meta">
                      <span className="commit-sha">{item.oid.substring(0, 7)}</span>
                      <span>{item.author.name}</span>
                      <span>{formatDate(item.author.timestamp)}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'branches' && (
          <div className="git-panel__branches">
            <div className="git-panel__branch-list">
              {branches.map((branch) => (
                <button
                  key={branch.name}
                  className={`git-panel__branch ${
                    branch.current ? 'git-panel__branch--current' : ''
                  }`}
                  onClick={() => !branch.current && checkoutBranch(branch.name)}
                  disabled={branch.current}
                >
                  <GitBranchIcon />
                  <span className="branch-name">{branch.name}</span>
                  {branch.current && (
                    <span className="branch-badge">current</span>
                  )}
                  {!branch.current && (
                    <button
                      className="branch-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete branch "${branch.name}"?`)) {
                          deleteBranch(branch.name);
                        }
                      }}
                      title="Delete branch"
                    >
                      <TrashIcon />
                    </button>
                  )}
                </button>
              ))}
            </div>
            
            {showNewBranchInput ? (
              <div className="git-panel__new-branch-form">
                <input
                  type="text"
                  placeholder="Branch name..."
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateBranch();
                    if (e.key === 'Escape') {
                      setShowNewBranchInput(false);
                      setNewBranchName('');
                    }
                  }}
                  autoFocus
                />
                <button onClick={handleCreateBranch} disabled={!newBranchName.trim()}>
                  <CheckIcon />
                </button>
                <button onClick={() => { setShowNewBranchInput(false); setNewBranchName(''); }}>
                  <XIcon />
                </button>
              </div>
            ) : (
              <button 
                className="git-panel__new-branch"
                onClick={() => setShowNewBranchInput(true)}
              >
              <PlusIcon />
              New Branch
            </button>
            )}

            {/* Remotes section */}
            <div className="git-panel__section-header" style={{ marginTop: '16px' }}>
              <span>Remotes</span>
            </div>
            {remotes.length === 0 ? (
              <div className="git-panel__no-remotes">
                <p>No remotes configured</p>
                <button 
                  className="git-panel__add-remote-btn"
                  onClick={() => openRemoteModal(false)}
                >
                  <PlusIcon />
                  Add Remote
                </button>
              </div>
            ) : (
              <div className="git-panel__remote-list">
                {remotes.map((remote) => (
                  <div key={remote.name} className="git-panel__remote">
                    <span className="remote-name">{remote.name}</span>
                    <span className="remote-url">{remote.url}</span>
                    <button
                      className="remote-delete"
                      onClick={() => {
                        if (confirm(`Remove remote "${remote.name}"?`)) {
                          removeRemote(remote.name);
                        }
                      }}
                      title="Remove remote"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ))}
                <button 
                  className="git-panel__add-remote-btn"
                  onClick={() => openRemoteModal(false)}
                >
                  <PlusIcon />
                  Add Remote
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sync controls */}
      <div className="git-panel__sync">
        <button 
          className="git-panel__sync-btn git-panel__sync-btn--pull"
          onClick={handlePull}
          disabled={isPulling || remotes.length === 0}
          title={remotes.length === 0 ? 'Add a remote first' : 'Pull from remote'}
        >
          <DownloadIcon />
          {isPulling ? 'Pulling...' : 'Pull'}
        </button>
        <button 
          className="git-panel__sync-btn git-panel__sync-btn--push"
          onClick={handlePush}
          disabled={isPushing || remotes.length === 0}
          title={remotes.length === 0 ? 'Add a remote first' : 'Push to remote'}
        >
          <UploadIcon />
          {isPushing ? 'Pushing...' : 'Push'}
        </button>
      </div>

      {/* Add Remote Modal */}
      {showAddRemoteModal && (
        <div className="git-panel__modal-overlay" onClick={() => setShowAddRemoteModal(false)}>
          <div className="git-panel__modal" onClick={(e) => e.stopPropagation()}>
            <div className="git-panel__modal-header">
              <h4>{isEditingRemote ? 'Edit Remote' : 'Add Remote'}</h4>
              <button onClick={() => setShowAddRemoteModal(false)}>
                <XIcon />
              </button>
            </div>
            <div className="git-panel__modal-body">
              <div className="git-panel__form-group">
                <label>Name</label>
                <input
                  type="text"
                  value={newRemoteName}
                  onChange={(e) => setNewRemoteName(e.target.value)}
                  placeholder="origin"
                />
              </div>
              <div className="git-panel__form-group">
                <label>URL</label>
                <input
                  type="text"
                  value={newRemoteUrl}
                  onChange={(e) => setNewRemoteUrl(e.target.value)}
                  placeholder="https://github.com/user/repo.git"
                />
              </div>
              {user && (
                <p className="git-panel__hint">
                  Tip: Use format https://github.com/{user.login}/repo-name.git
                </p>
              )}
            </div>
            <div className="git-panel__modal-footer">
              <button 
                className="git-panel__modal-cancel"
                onClick={() => setShowAddRemoteModal(false)}
              >
                Cancel
              </button>
              <button 
                className="git-panel__modal-confirm git-panel__modal-save"
                onClick={handleAddRemote}
                disabled={!newRemoteName.trim() || !newRemoteUrl.trim()}
              >
                <CheckIcon />
                Save Remote
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Git Error Details Modal */}
      {showErrorModal && error && (
        <div className="git-panel__error-modal-overlay" onClick={() => setShowErrorModal(false)}>
          <div className="git-panel__error-modal" onClick={(e) => e.stopPropagation()}>
            <div className="git-panel__error-modal-header">
              <h4>Git Error</h4>
              <button onClick={() => setShowErrorModal(false)}>
                <XIcon />
              </button>
            </div>
            <div className="git-panel__error-modal-body">
              <pre className="git-panel__error-modal-content">{error}</pre>
            </div>
            <div className="git-panel__error-modal-footer">
              <button 
                className="git-panel__modal-cancel"
                onClick={() => navigator.clipboard.writeText(error)}
              >
                Copy Error
              </button>
              <button 
                className="git-panel__modal-confirm"
                onClick={() => setShowErrorModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GitPanel;
