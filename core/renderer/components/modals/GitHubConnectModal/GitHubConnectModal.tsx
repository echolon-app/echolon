import React, { useState, useEffect, useMemo } from 'react';
import { useGitHub } from '@/contexts/GitHubContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { 
  GitHubIcon, XIcon, ExternalLinkIcon, EyeIcon, EyeOffIcon, 
  SearchIcon, CheckIcon, AlertCircleIcon, InfoIcon, KeyIcon, LockIcon, RefreshIcon 
} from '@/components/ui/icons';
import { GitHubRepository } from '@/services/GitHubService';
import './GitHubConnectModal.css';

interface GitHubConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type AuthMethod = 'pat' | 'oauth';
type Step = 'auth' | 'repo' | 'done';

export const GitHubConnectModal: React.FC<GitHubConnectModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    isAuthenticated,
    isLoading,
    user,
    loginWithPAT,
    logout,
    repositories,
    fetchRepositories,
    selectedRepo,
    selectRepository,
    branches,
    fetchBranches,
    linkRepository,
  } = useGitHub();

  const { activeWorkspaceId } = useWorkspace();

  const [authMethod, setAuthMethod] = useState<AuthMethod>('pat');
  const [patToken, setPatToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [step, setStep] = useState<Step>('auth');
  const [connecting, setConnecting] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      if (isAuthenticated) {
        setStep('repo');
        fetchRepositories();
      } else {
        setStep('auth');
      }
      setError(null);
      setPatToken('');
      setSearchQuery('');
      selectRepository(null);
    }
  }, [isOpen, isAuthenticated, fetchRepositories, selectRepository]);

  // Fetch branches when repo is selected
  useEffect(() => {
    if (selectedRepo) {
      fetchBranches(selectedRepo.owner.login, selectedRepo.name);
      setSelectedBranch(selectedRepo.default_branch);
    }
  }, [selectedRepo, fetchBranches]);

  // Filter repositories based on search
  const filteredRepos = useMemo(() => {
    if (!searchQuery) return repositories;
    const query = searchQuery.toLowerCase();
    return repositories.filter(
      repo => 
        repo.name.toLowerCase().includes(query) ||
        repo.full_name.toLowerCase().includes(query) ||
        (repo.description && repo.description.toLowerCase().includes(query))
    );
  }, [repositories, searchQuery]);

  const handlePATLogin = async () => {
    if (!patToken.trim()) {
      setError('Please enter a Personal Access Token');
      return;
    }

    setConnecting(true);
    setError(null);

    const result = await loginWithPAT(patToken.trim());

    if (result.success) {
      setStep('repo');
      await fetchRepositories();
    } else {
      setError(result.error || 'Failed to authenticate');
    }

    setConnecting(false);
  };

  const handleOAuthLogin = async () => {
    // OAuth not implemented yet - would open browser
    setError('OAuth authentication is not yet implemented. Please use a Personal Access Token.');
  };

  const handleRepoSelect = (repo: GitHubRepository) => {
    selectRepository(repo);
  };

  const handleLinkRepository = async () => {
    if (!selectedRepo || !activeWorkspaceId || !selectedBranch) return;

    setConnecting(true);
    await linkRepository(
      activeWorkspaceId,
      selectedRepo.owner.login,
      selectedRepo.name,
      selectedBranch
    );
    setConnecting(false);
    onClose();
  };

  const handleLogout = async () => {
    await logout();
    setStep('auth');
    setPatToken('');
    selectRepository(null);
  };

  if (!isOpen) return null;

  return (
    <div className="github-connect-modal__overlay" onClick={onClose}>
      <div className="github-connect-modal__content" onClick={e => e.stopPropagation()}>
        <div className="github-connect-modal__header">
          <h2>
            <GitHubIcon />
            {step === 'auth' ? 'Connect to GitHub' : 'Link Repository'}
          </h2>
          <button className="github-connect-modal__close" onClick={onClose}>
            <XIcon />
          </button>
        </div>

        <div className="github-connect-modal__body">
          {/* Authentication Step */}
          {step === 'auth' && (
            <>
              <div className="github-connect-modal__auth-methods">
                <button
                  className={`github-connect-modal__auth-method ${
                    authMethod === 'pat' ? 'github-connect-modal__auth-method--selected' : ''
                  }`}
                  onClick={() => setAuthMethod('pat')}
                >
                  <KeyIcon />
                  <span>Personal Access Token</span>
                  <small>Recommended</small>
                </button>
                <button
                  className={`github-connect-modal__auth-method ${
                    authMethod === 'oauth' ? 'github-connect-modal__auth-method--selected' : ''
                  }`}
                  onClick={() => setAuthMethod('oauth')}
                >
                  <GitHubIcon />
                  <span>GitHub OAuth</span>
                  <small>Coming soon</small>
                </button>
              </div>

              {authMethod === 'pat' && (
                <>
                  <div className="github-connect-modal__pat-section">
                    <label>Personal Access Token</label>
                    <div className="input-wrapper">
                      <input
                        type={showToken ? 'text' : 'password'}
                        value={patToken}
                        onChange={e => setPatToken(e.target.value)}
                        placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                        onKeyDown={e => e.key === 'Enter' && handlePATLogin()}
                      />
                      <button onClick={() => setShowToken(!showToken)}>
                        {showToken ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                  </div>

                  <div className="github-connect-modal__pat-help">
                    <InfoIcon />
                    <p>
                      Create a token with <strong>repo</strong> scope at{' '}
                      <a 
                        href="https://github.com/settings/tokens/new?scopes=repo&description=Echolon"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        GitHub Settings <span style={{ display: 'inline-block', width: 10, height: 10 }}><ExternalLinkIcon /></span>
                      </a>
                    </p>
                  </div>
                </>
              )}

              {authMethod === 'oauth' && (
                <div className="github-connect-modal__pat-help">
                  <InfoIcon />
                  <p>
                    OAuth authentication will open GitHub in your browser to authorize Echolon.
                    This feature is coming soon.
                  </p>
                </div>
              )}

              {error && (
                <div className="github-connect-modal__error">
                  <AlertCircleIcon />
                  {error}
                </div>
              )}
            </>
          )}

          {/* Repository Selection Step */}
          {step === 'repo' && (
            <>
              {/* User info */}
              {user && (
                <div className="github-connect-modal__user-info">
                  <img src={user.avatar_url} alt={user.login} />
                  <div className="user-details">
                    <div className="user-name">{user.name || user.login}</div>
                    <div className="user-login">@{user.login}</div>
                  </div>
                  <div className="user-status">
                    <CheckIcon />
                    Connected
                  </div>
                </div>
              )}

              {/* Repository search */}
              <div className="github-connect-modal__repo-section">
                <div className="github-connect-modal__repo-header">
                <h4>Select a Repository</h4>
                  <button 
                    className="github-connect-modal__refresh-btn"
                    onClick={() => fetchRepositories()}
                    disabled={isLoading}
                    title="Refresh repositories"
                  >
                    <RefreshIcon />
                  </button>
                </div>
                <div className="github-connect-modal__repo-search">
                  <SearchIcon />
                  <input
                    type="text"
                    placeholder="Search repositories..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>

                {isLoading ? (
                  <div className="github-connect-modal__loading">
                    <div className="spinner" />
                  </div>
                ) : (
                  <div className="github-connect-modal__repo-list">
                    {filteredRepos.length === 0 ? (
                      <div className="github-connect-modal__repo-empty">
                        {repositories.length === 0 
                          ? 'No repositories found'
                          : 'No matching repositories'}
                      </div>
                    ) : (
                      filteredRepos.map(repo => (
                        <button
                          key={repo.id}
                          className={`github-connect-modal__repo-item ${
                            selectedRepo?.id === repo.id 
                              ? 'github-connect-modal__repo-item--selected' 
                              : ''
                          }`}
                          onClick={() => handleRepoSelect(repo)}
                        >
                          <img 
                            src={repo.owner.avatar_url || `https://github.com/${repo.owner.login}.png?size=64`}
                            alt={repo.owner.login}
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              target.nextElementSibling?.classList.add('show');
                            }}
                          />
                          <div className="github-connect-modal__repo-placeholder">
                            <GitHubIcon />
                          </div>
                          <div className="repo-details">
                            <div className="repo-name">{repo.full_name}</div>
                            <div className="repo-meta">
                              {repo.description && <span>{repo.description}</span>}
                            </div>
                          </div>
                          {repo.private && <span className="repo-private"><LockIcon /></span>}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Branch selection */}
              {selectedRepo && branches.length > 0 && (
                <div className="github-connect-modal__branch-section">
                  <label>Branch</label>
                  <select
                    value={selectedBranch}
                    onChange={e => setSelectedBranch(e.target.value)}
                  >
                    {branches.map(branch => (
                      <option key={branch.name} value={branch.name}>
                        {branch.name}
                        {branch.name === selectedRepo.default_branch && ' (default)'}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {error && (
                <div className="github-connect-modal__error">
                  <AlertCircleIcon />
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="github-connect-modal__footer">
          {step === 'auth' ? (
            <>
              <button 
                className="github-connect-modal__btn github-connect-modal__btn--secondary"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="github-connect-modal__btn github-connect-modal__btn--primary"
                onClick={authMethod === 'pat' ? handlePATLogin : handleOAuthLogin}
                disabled={connecting || (authMethod === 'pat' && !patToken.trim())}
              >
                {connecting ? 'Connecting...' : 'Connect'}
              </button>
            </>
          ) : (
            <>
              <button
                className="github-connect-modal__btn github-connect-modal__btn--danger"
                onClick={handleLogout}
              >
                Disconnect
              </button>
              <div style={{ flex: 1 }} />
              <button
                className="github-connect-modal__btn github-connect-modal__btn--secondary"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="github-connect-modal__btn github-connect-modal__btn--primary"
                onClick={handleLinkRepository}
                disabled={connecting || !selectedRepo || !selectedBranch}
              >
                {connecting ? 'Linking...' : 'Link Repository'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default GitHubConnectModal;

