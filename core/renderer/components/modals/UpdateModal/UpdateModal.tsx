import React from 'react';
import { Modal, Button, ProgressBar } from '@/components/ui';
import { useUpdateOptional } from '@/contexts';
import { DownloadIcon, RefreshIcon, CheckCircleIcon, RocketIcon, ClockIcon } from '@/components/ui/icons';
import './UpdateModal.css';

// Helper to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Helper to format speed
function formatSpeed(bytesPerSecond: number): string {
  return formatBytes(bytesPerSecond) + '/s';
}

// Helper to format date
function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateString;
  }
}

// Renderer for release notes -> notes come from the github releases page
// Handles both markdown and HTML formats
function renderReleaseNotes(notes: string | null): React.ReactNode {
  if (!notes) {
    return <p className="update-modal__no-notes">No release notes available.</p>;
  }
  
  // Handle array format from electron-updater (can be string[] for multi-platform notes)
  const notesText = Array.isArray(notes) ? notes.join('\n') : notes;
  
  // Check if notes contain HTML tags
  const hasHTML = /<[a-z][\s\S]*>/i.test(notesText);
  
  if (hasHTML) {
    // Render HTML content (sanitized)
    return (
      <div 
        className="update-modal__release-notes-content"
        dangerouslySetInnerHTML={{ __html: notesText }}
      />
    );
  }
  
  // Otherwise, parse as markdown-like text
  const lines = notesText.split('\n');
  const elements: React.ReactNode[] = [];
  let currentList: string[] = [];
  
  const flushList = () => {
    if (currentList.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`}>
          {currentList.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
      );
      currentList = [];
    }
  };
  
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    
    // Empty line
    if (!trimmed) {
      flushList();
      elements.push(<br key={`br-${index}`} />);
      return;
    }
    
    // Header lines (## or ###)
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(<h4 key={`h4-${index}`}>{trimmed.slice(4)}</h4>);
      return;
    }
    if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(<h3 key={`h3-${index}`}>{trimmed.slice(3)}</h3>);
      return;
    }
    if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(<h2 key={`h2-${index}`}>{trimmed.slice(2)}</h2>);
      return;
    }
    
    // List items
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      currentList.push(trimmed.slice(2));
      return;
    }
    
    // Regular paragraph (flush list first)
    flushList();
    elements.push(<p key={`p-${index}`}>{trimmed}</p>);
  });
  
  // Flush any remaining list items
  flushList();
  
  return (
    <div className="update-modal__release-notes-content">
      {elements}
    </div>
  );
}

export const UpdateModal: React.FC = () => {
  const update = useUpdateOptional();
  
  // Don't render in web mode (no update provider)
  if (!update) {
    return null;
  }

  const {
    currentVersion,
    status,
    updateInfo,
    downloadProgress,
    error,
    isModalOpen,
    modalMode,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    installOnNextRestart,
    closeModal,
  } = update;
  
  const isChecking = status === 'checking';
  const isDownloading = status === 'downloading';
  const isDownloaded = status === 'downloaded';
  const hasUpdate = status === 'available' || isDownloading || isDownloaded;
  const hasError = status === 'error';
  
  // Determine modal title based on mode and state
  const getTitle = () => {
    if (modalMode === 'changelog') {
      return `What's New in v${currentVersion}`;
    }
    if (isDownloaded) {
      return 'Update Ready to Install';
    }
    if (isDownloading) {
      return 'Downloading Update...';
    }
    if (hasUpdate) {
      return 'Update Available';
    }
    if (status === 'not-available') {
      return 'No Updates Available';
    }
    return 'Check for Updates';
  };
  
  // Render content based on state
  const renderContent = () => {
    // Changelog mode - just show current version notes
    if (modalMode === 'changelog') {
      return (
        <div className="update-modal__changelog">
          <div className="update-modal__version-badge">
            <span>Current Version</span>
            <code>v{currentVersion}</code>
          </div>
          <div className="update-modal__release-notes">
            <p className="update-modal__no-notes">
              View the full changelog on{' '}
              <a 
                href="https://github.com/echolon-app/echolon/releases" 
                target="_blank" 
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  window.electronAPI?.openExternal('https://github.com/echolon-app/echolon/releases');
                }}
              >
                GitHub Releases
              </a>
            </p>
          </div>
        </div>
      );
    }
    
    // Error state
    if (hasError) {
      return (
        <div className="update-modal__error">
          <div className="update-modal__error-icon">!</div>
          <p className="update-modal__error-message">{error}</p>
          <Button variant="primary" onClick={checkForUpdates} icon={<RefreshIcon />}>
            Try Again
          </Button>
        </div>
      );
    }
    
    // Checking state
    if (isChecking) {
      return (
        <div className="update-modal__checking">
          <div className="update-modal__spinner" />
          <p>Checking for updates...</p>
        </div>
      );
    }
    
    // No update available
    if (status === 'not-available') {
      return (
        <div className="update-modal__up-to-date">
          <div className="update-modal__success-icon">
            <CheckCircleIcon />
          </div>
          <h3>You're up to date!</h3>
          <p>Echolon v{currentVersion} is the latest version.</p>
        </div>
      );
    }
    
    // Update downloaded - ready to install
    if (isDownloaded && updateInfo) {
      return (
        <div className="update-modal__downloaded">
          <div className="update-modal__success-icon update-modal__success-icon--ready">
            <RocketIcon />
          </div>
          <h3>Ready to Install</h3>
          <p className="update-modal__version-info">
            Version <code>v{updateInfo.version}</code> has been downloaded and is ready to install.
          </p>
          
          <div className="update-modal__release-notes">
            <h4>What's New</h4>
            {renderReleaseNotes(updateInfo.releaseNotes)}
          </div>
          
          <div className="update-modal__actions">
            <Button 
              variant="primary" 
              onClick={installUpdate}
              icon={<RocketIcon />}
            >
              Restart & Install
            </Button>
            <Button 
              variant="secondary" 
              onClick={installOnNextRestart}
              icon={<ClockIcon />}
            >
              Install on Next Restart
            </Button>
          </div>
        </div>
      );
    }
    
    // Downloading state
    if (isDownloading && downloadProgress) {
      return (
        <div className="update-modal__downloading">
          <div className="update-modal__download-info">
            <span className="update-modal__download-version">
              Downloading v{updateInfo?.version}...
            </span>
            <span className="update-modal__download-stats">
              {formatBytes(downloadProgress.transferred)} / {formatBytes(downloadProgress.total)}
              {downloadProgress.bytesPerSecond > 0 && (
                <> • {formatSpeed(downloadProgress.bytesPerSecond)}</>
              )}
            </span>
          </div>
          <ProgressBar 
            value={downloadProgress.percent} 
            max={100}
            showLabel
          />
        </div>
      );
    }
    
    // Update available
    if (hasUpdate && updateInfo) {
      return (
        <div className="update-modal__available">
          <div className="update-modal__version-comparison">
            <div className="update-modal__version-box update-modal__version-box--current">
              <span className="update-modal__version-label">Current</span>
              <code>v{currentVersion}</code>
            </div>
            <div className="update-modal__version-arrow">→</div>
            <div className="update-modal__version-box update-modal__version-box--new">
              <span className="update-modal__version-label">New</span>
              <code>v{updateInfo.version}</code>
            </div>
          </div>
          
          {updateInfo.releaseDate && (
            <p className="update-modal__release-date">
              Released on {formatDate(updateInfo.releaseDate)}
            </p>
          )}
          
          <div className="update-modal__release-notes">
            <h4>What's New</h4>
            {renderReleaseNotes(updateInfo.releaseNotes)}
          </div>
          
          <div className="update-modal__actions">
            <Button 
              variant="primary" 
              onClick={downloadUpdate}
              icon={<DownloadIcon />}
            >
              Download Update
            </Button>
            <Button variant="ghost" onClick={closeModal}>
              Remind Me Later
            </Button>
          </div>
        </div>
      );
    }
    
    // Idle state - show check button
    return (
      <div className="update-modal__idle">
        <p>Current version: <code>v{currentVersion}</code></p>
        <Button 
          variant="primary" 
          onClick={checkForUpdates}
          icon={<RefreshIcon />}
        >
          Check for Updates
        </Button>
      </div>
    );
  };
  
  return (
    <Modal
      isOpen={isModalOpen}
      onClose={closeModal}
      title={getTitle()}
      size="md"
      className="update-modal-container"
      closeOnOverlayClick={!isDownloading}
      closeOnEscape={!isDownloading}
    >
      <div className="update-modal">
        {renderContent()}
      </div>
    </Modal>
  );
};

export default UpdateModal;

