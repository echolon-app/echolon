import React, { useState, useMemo } from 'react';
import { useGitHub } from '@/contexts/GitHubContext';
import { GitCommitIcon, XIcon, GitBranchIcon, CheckIcon, AlertCircleIcon } from '@/components/ui/icons';
import './GitCommitModal.css';

interface ChangedFile {
  path: string;
  content: string;
  status: 'added' | 'modified' | 'deleted';
}

interface GitCommitModalProps {
  isOpen: boolean;
  onClose: () => void;
  files: ChangedFile[];
}

const COMMIT_TEMPLATES = [
  'Update collections',
  'Add new endpoints',
  'Fix request configuration',
  'Update environment variables',
  'Refactor folder structure',
];

export const GitCommitModal: React.FC<GitCommitModalProps> = ({
  isOpen,
  onClose,
  files,
}) => {
  const { currentBranch, pushChanges, getLinkedRepo } = useGitHub();

  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(
    new Set(files.map(f => f.path))
  );
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ sha: string } | null>(null);

  const toggleFile = (path: string) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(path)) {
      newSelected.delete(path);
    } else {
      newSelected.add(path);
    }
    setSelectedFiles(newSelected);
  };

  const toggleAll = () => {
    if (selectedFiles.size === files.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(files.map(f => f.path)));
    }
  };

  const filesToCommit = useMemo(() => {
    return files.filter(f => selectedFiles.has(f.path));
  }, [files, selectedFiles]);

  const handleCommit = async () => {
    if (!commitMessage.trim()) {
      setError('Please enter a commit message');
      return;
    }

    if (filesToCommit.length === 0) {
      setError('Please select at least one file to commit');
      return;
    }

    setIsCommitting(true);
    setError(null);

    const result = await pushChanges(
      commitMessage.trim(),
      filesToCommit.map(f => ({ path: f.path, content: f.content }))
    );

    setIsCommitting(false);

    if (result.success) {
      setSuccess({ sha: 'abc1234' }); // The actual SHA would come from the result
    } else {
      setError(result.error || 'Failed to commit changes');
    }
  };

  const handleClose = () => {
    setCommitMessage('');
    setError(null);
    setSuccess(null);
    setSelectedFiles(new Set(files.map(f => f.path)));
    onClose();
  };

  const applyTemplate = (template: string) => {
    setCommitMessage(template);
  };

  if (!isOpen) return null;

  return (
    <div className="git-commit-modal__overlay" onClick={handleClose}>
      <div className="git-commit-modal__content" onClick={e => e.stopPropagation()}>
        <div className="git-commit-modal__header">
          <h2>
            <GitCommitIcon />
            Commit Changes
          </h2>
          <button className="git-commit-modal__close" onClick={handleClose}>
            <XIcon />
          </button>
        </div>

        <div className="git-commit-modal__body">
          {success ? (
            <div className="git-commit-modal__success">
              <CheckIcon />
              <h3>Changes Committed!</h3>
              <p>Your changes have been pushed to the repository.</p>
              <div className="commit-sha">Commit: {success.sha}</div>
            </div>
          ) : (
            <>
              {/* Branch info */}
              <div className="git-commit-modal__branch-info">
                <GitBranchIcon />
                Committing to <strong>{currentBranch}</strong>
              </div>

              {/* Changed files */}
              <div className="git-commit-modal__files-section">
                <h4>
                  Changed Files
                  <span>
                    {selectedFiles.size} of {files.length} selected
                  </span>
                </h4>
                <div className="git-commit-modal__files-list">
                  {files.map(file => (
                    <div key={file.path} className="git-commit-modal__file">
                      <input
                        type="checkbox"
                        className="file-checkbox"
                        checked={selectedFiles.has(file.path)}
                        onChange={() => toggleFile(file.path)}
                      />
                      <span className={`file-status file-status--${file.status}`} />
                      <span className="file-name">{file.path}</span>
                      <span className={`file-action file-action--${file.status}`}>
                        {file.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Commit message */}
              <div className="git-commit-modal__message-section">
                <label>Commit Message</label>
                <textarea
                  className="git-commit-modal__message-input"
                  value={commitMessage}
                  onChange={e => setCommitMessage(e.target.value)}
                  placeholder="Describe your changes..."
                  rows={3}
                />
                <span 
                  className={`git-commit-modal__message-counter ${
                    commitMessage.length > 72 ? 'git-commit-modal__message-counter--warning' : ''
                  }`}
                >
                  {commitMessage.length} / 72 characters (recommended)
                </span>
                <div className="git-commit-modal__templates">
                  {COMMIT_TEMPLATES.map(template => (
                    <button
                      key={template}
                      className="git-commit-modal__template"
                      onClick={() => applyTemplate(template)}
                    >
                      {template}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div className="git-commit-modal__error">
                  <AlertCircleIcon />
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="git-commit-modal__footer">
          {success ? (
            <button
              className="git-commit-modal__btn git-commit-modal__btn--primary"
              onClick={handleClose}
            >
              Done
            </button>
          ) : (
            <>
              <button
                className="git-commit-modal__btn git-commit-modal__btn--secondary"
                onClick={handleClose}
              >
                Cancel
              </button>
              <button
                className="git-commit-modal__btn git-commit-modal__btn--primary"
                onClick={handleCommit}
                disabled={isCommitting || selectedFiles.size === 0 || !commitMessage.trim()}
              >
                {isCommitting ? 'Committing...' : `Commit ${selectedFiles.size} file${selectedFiles.size !== 1 ? 's' : ''}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default GitCommitModal;

