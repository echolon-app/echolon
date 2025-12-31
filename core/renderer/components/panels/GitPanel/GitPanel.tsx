import React, { useState, useEffect } from 'react';
import { useGitHub } from '@/contexts/GitHubContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { 
  GitBranchIcon, GitCommitIcon, GitPullRequestIcon, RefreshIcon, 
  UploadIcon, DownloadIcon, PlusIcon, XIcon, CheckIcon, 
  GitHubIcon, LockIcon, ExternalLinkIcon 
} from '@/components/ui/icons';
import { githubService } from '@/services/GitHubService';
import './GitPanel.css';

type TabType = 'changes' | 'history' | 'branches';

interface GitPanelProps {
  onConnectClick: () => void;
}

export const GitPanel: React.FC<GitPanelProps> = ({ onConnectClick }) => {
  const {
    isAuthenticated,
    isLoading: authLoading,
    user,
    linkedRepos,
    getLinkedRepo,
    unlinkRepository,
    branches,
    currentBranch,
    fetchBranches,
    switchBranch,
    commits,
    fetchCommits,
    pushChanges,
    pullChanges,
  } = useGitHub();

  const { activeWorkspaceId } = useWorkspace();

  const [activeTab, setActiveTab] = useState<TabType>('changes');
  const [isLoading, setIsLoading] = useState(false);
  const [localChanges, setLocalChanges] = useState<Array<{ path: string; status: string }>>([]);

  const linkedRepo = activeWorkspaceId ? getLinkedRepo(activeWorkspaceId) : undefined;

  // Fetch data when repository is linked
  useEffect(() => {
    if (linkedRepo && isAuthenticated) {
      setIsLoading(true);
      Promise.all([
        fetchBranches(linkedRepo.owner, linkedRepo.repo),
        fetchCommits(linkedRepo.owner, linkedRepo.repo, linkedRepo.branch),
      ]).finally(() => setIsLoading(false));
    }
  }, [linkedRepo, isAuthenticated, fetchBranches, fetchCommits]);

  const handleRefresh = async () => {
    if (!linkedRepo) return;
    setIsLoading(true);
    await Promise.all([
      fetchBranches(linkedRepo.owner, linkedRepo.repo),
      fetchCommits(linkedRepo.owner, linkedRepo.repo, currentBranch || linkedRepo.branch),
    ]);
    setIsLoading(false);
  };

  const handlePull = async () => {
    setIsLoading(true);
    await pullChanges();
    setIsLoading(false);
  };

  const handlePush = async () => {
    // In a real implementation, this would open a commit modal
    // For now, just show we can push
    setIsLoading(true);
    // await pushChanges('Update collections', files);
    setIsLoading(false);
  };

  const handleUnlink = async () => {
    if (activeWorkspaceId && confirm('Are you sure you want to unlink this repository?')) {
      await unlinkRepository(activeWorkspaceId);
    }
  };

  const handleBranchSelect = (branchName: string) => {
    switchBranch(branchName);
    if (linkedRepo) {
      fetchCommits(linkedRepo.owner, linkedRepo.repo, branchName);
    }
  };

  // Not connected state
  if (!isAuthenticated) {
    return (
      <div className="git-panel">
        <div className="git-panel__header">
          <h3>
            <GitHubIcon />
            Git
          </h3>
        </div>
        <div className="git-panel__not-connected">
          <GitHubIcon />
          <h4>Connect to GitHub</h4>
          <p>
            Connect your GitHub account to sync your API collections and track changes.
          </p>
          <button className="git-panel__connect-btn" onClick={onConnectClick}>
            <GitHubIcon />
            Connect GitHub
          </button>
        </div>
      </div>
    );
  }

  // Loading state
  if (authLoading) {
    return (
      <div className="git-panel">
        <div className="git-panel__header">
          <h3>
            <GitHubIcon />
            Git
          </h3>
        </div>
        <div className="git-panel__loading">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  // No repository linked
  if (!linkedRepo) {
    return (
      <div className="git-panel">
        <div className="git-panel__header">
          <h3>
            <GitHubIcon />
            Git
          </h3>
        </div>
        <div className="git-panel__not-connected">
          <GitBranchIcon />
          <h4>No Repository Linked</h4>
          <p>
            Link a GitHub repository to this workspace to start syncing your collections.
          </p>
          <button className="git-panel__connect-btn" onClick={onConnectClick}>
            <GitBranchIcon />
            Link Repository
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="git-panel">
      <div className="git-panel__header">
        <h3>
          <GitHubIcon />
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

      {/* Repository info */}
      <div className="git-panel__repo-info">
        <img 
          className="repo-avatar"
          src={`https://github.com/${linkedRepo.owner}.png?size=64`}
          alt={linkedRepo.owner}
        />
        <div className="repo-details">
          <div className="repo-name">{linkedRepo.owner}/{linkedRepo.repo}</div>
          <div className="repo-branch">
            <GitBranchIcon />
            {currentBranch || linkedRepo.branch}
          </div>
        </div>
        <button 
          className="repo-unlink"
          onClick={handleUnlink}
          title="Unlink repository"
        >
          <XIcon />
        </button>
      </div>

      {/* Tabs */}
      <div className="git-panel__tabs">
        <button
          className={`git-panel__tab ${activeTab === 'changes' ? 'git-panel__tab--active' : ''}`}
          onClick={() => setActiveTab('changes')}
        >
          <GitPullRequestIcon />
          Changes
          {localChanges.length > 0 && (
            <span className="badge">{localChanges.length}</span>
          )}
        </button>
        <button
          className={`git-panel__tab ${activeTab === 'history' ? 'git-panel__tab--active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <GitCommitIcon />
          History
        </button>
        <button
          className={`git-panel__tab ${activeTab === 'branches' ? 'git-panel__tab--active' : ''}`}
          onClick={() => setActiveTab('branches')}
        >
          <GitBranchIcon />
          Branches
        </button>
      </div>

      {/* Tab content */}
      <div className="git-panel__content">
        {activeTab === 'changes' && (
          <div className="git-panel__changes">
            {localChanges.length === 0 ? (
              <div className="git-panel__changes-empty">
                <CheckIcon />
                <p>No uncommitted changes</p>
              </div>
            ) : (
              localChanges.map((change, idx) => (
                <div key={idx} className="git-panel__change-file">
                  <span className={`file-status file-status--${change.status}`} />
                  <span className="file-name">{change.path.split('/').pop()}</span>
                  <span className="file-path">{change.path}</span>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="git-panel__history">
            {isLoading ? (
              <div className="git-panel__loading">
                <div className="spinner" />
              </div>
            ) : (
              commits.map((item) => (
                <div 
                  key={item.sha} 
                  className="git-panel__commit"
                  onClick={() => window.open(item.html_url, '_blank')}
                >
                  <div className="commit-avatar">
                    {item.commit.author.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="commit-details">
                    <div className="commit-message">{item.commit.message}</div>
                    <div className="commit-meta">
                      <span className="commit-sha">{item.sha.substring(0, 7)}</span>
                      <span>{item.commit.author.name}</span>
                      <span>{githubService.getRelativeTime(item.commit.author.date)}</span>
                    </div>
                  </div>
                  <ExternalLinkIcon />
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
                    branch.name === (currentBranch || linkedRepo.branch) 
                      ? 'git-panel__branch--current' 
                      : ''
                  }`}
                  onClick={() => handleBranchSelect(branch.name)}
                >
                  <GitBranchIcon />
                  <span className="branch-name">{branch.name}</span>
                  {branch.name === linkedRepo.branch && (
                    <span className="branch-badge">default</span>
                  )}
                  {branch.protected && (
                    <span className="branch-protected"><LockIcon /></span>
                  )}
                </button>
              ))}
            </div>
            <button className="git-panel__new-branch">
              <PlusIcon />
              New Branch
            </button>
          </div>
        )}
      </div>

      {/* Sync controls */}
      <div className="git-panel__sync">
        <button 
          className="git-panel__sync-btn git-panel__sync-btn--pull"
          onClick={handlePull}
          disabled={isLoading}
        >
          <DownloadIcon />
          Pull
        </button>
        <button 
          className="git-panel__sync-btn git-panel__sync-btn--push"
          onClick={handlePush}
          disabled={isLoading || localChanges.length === 0}
        >
          <UploadIcon />
          Push
        </button>
      </div>
    </div>
  );
};

export default GitPanel;

