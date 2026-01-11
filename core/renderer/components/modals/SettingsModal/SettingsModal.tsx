import React, { useState, useEffect, useCallback, Component, ErrorInfo, ReactNode } from 'react';
import { Modal, Button, SimpleInput, Dropdown } from '@/components/ui';
import { useApp, useTheme, COLOR_SCHEMES, useGitHub, useWebModeOptional, useUpdateOptional, useFileStorage } from '@/contexts';
import { 
  SettingsIcon, CodeIcon, SendIcon, CreditCardIcon, CheckIcon, InfoIcon,
  PaletteIcon, RefreshIcon, FolderIcon, GitHubIcon, ExternalLinkIcon, ServerIcon, DownloadIcon, RocketIcon,
  EyeIcon, EyeOffIcon, WarningIcon
} from '@/components/ui/icons';
import { fileStorageManager } from '@/services';
import { isElectron } from '@/utils';
import { APP_VERSION, BUILD_TIMESTAMP } from '@/utils/environment';
import type { ColorScheme } from '@/types';
import './SettingsModal.css';

// Error boundary to catch crashes in Settings modal
class SettingsErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error?: Error; errorInfo?: ErrorInfo }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Settings] Crash caught:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {



    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, color: '#ef4444', background: '#1a1a1a', borderRadius: 8 }}>
          <h3 style={{ margin: '0 0 12px', color: '#ef4444' }}>⚠️ Settings crashed!</h3>
          <p style={{ margin: '0 0 8px', color: '#a1a1aa' }}>
            Please report this error. You can still close this modal and use the app.
          </p>
          <pre style={{ 
            margin: '12px 0', 
            padding: 12, 
            background: '#0a0a0a', 
            borderRadius: 4, 
            overflow: 'auto',
            fontSize: 12,
            color: '#fca5a5'
          }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// API URL for fetching plans
const API_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || 'https://api.echolon.app';

// Plan type from API
interface Plan {
  id: string;
  name: string;
  price: number;
  period: string;
  billing?: string;
  description: string;
  features: string[];
  cta: string;
  ctaLink: string;
  highlight: boolean;
  badge: string | null;
}

import type { SettingsTab } from '@/contexts/AppContext';

export const SettingsModal: React.FC = () => {
  const { settingsModalOpen, settingsModalTab, closeSettingsModal, settings, updateSettings, isWebMode } = useApp();
  const { theme, setTheme, colorScheme, setColorScheme } = useTheme();
  const { isAuthenticated, user, logout, loginWithPAT } = useGitHub();
  const webMode = useWebModeOptional();
  const update = useUpdateOptional();
  const { 
    isWebFileSystemSupported, 
    isWebFileSystemEnabled, 
    enableWebFileSystem,
    disableWebFileSystem,
    echolonPath: webEcholonPath
  } = useFileStorage();
  const [activeTab, setActiveTab] = useState<SettingsTab>(settingsModalTab || 'general');
  const [customUpdateUrl, setCustomUpdateUrl] = useState<string>('');
  const [showWipeConfirmation, setShowWipeConfirmation] = useState(false);
  const [isWiping, setIsWiping] = useState(false);
  const [wipeConfirmText, setWipeConfirmText] = useState('');
  const [localStorageData, setLocalStorageData] = useState<{ key: string; value: string; size: number }[]>([]);
  const [githubPat, setGithubPat] = useState<string>('');
  const [patSaving, setPatSaving] = useState(false);
  const [patSaved, setPatSaved] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [savedTokenExists, setSavedTokenExists] = useState(false);
  const [patError, setPatError] = useState<string | null>(null);
  
  // Update activeTab when modal opens with a specific tab
  useEffect(() => {
    if (settingsModalOpen && settingsModalTab) {
      setActiveTab(settingsModalTab);
    }
  }, [settingsModalOpen, settingsModalTab]);
  
  // Load custom update server URL when Updates tab is active
  useEffect(() => {
    if (settingsModalOpen && activeTab === 'updates') {
      setCustomUpdateUrl(settings.customUpdateServerUrl || '');
    }
  }, [settingsModalOpen, activeTab, settings.customUpdateServerUrl]);

  // Check if GitHub PAT is saved when GitHub tab is opened
  useEffect(() => {
    const checkSavedToken = async () => {
      if (settingsModalOpen && activeTab === 'github') {
        try {
          const config = await fileStorageManager.readConfig();
          setSavedTokenExists(!!config?.github?.accessToken);
        } catch (error) {
          console.error('Failed to check saved token:', error);
        }
      }
    };
    checkSavedToken();
  }, [settingsModalOpen, activeTab]);

  const [echolonPath, setEcholonPath] = useState<string>('');
  const [corsProxy, setCorsProxy] = useState<string>(() => {
    return localStorage.getItem('echolon_cors_proxy') || '';
  });
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState<string | null>(null);
  
  // Use build-time injected version from package.json
  const appVersion = APP_VERSION;
  const isElectronApp = isElectron();

  // Fetch pricing plans from API
  useEffect(() => {
    const fetchPlans = async () => {
      setPlansLoading(true);
      setPlansError(null);
      try {
        const response = await fetch(`${API_URL}/api/subscriptions/plans`);
        if (response.ok) {
          const data = await response.json();
          if (data.plans && Array.isArray(data.plans)) {
            setPlans(data.plans);
          } else {
            setPlansError('Invalid response from pricing API');
          }
        } else {
          setPlansError('Failed to load pricing plans');
        }
      } catch (error) {
        console.error('Failed to fetch plans from API:', error);
        setPlansError('Unable to connect to pricing service');
      } finally {
        setPlansLoading(false);
      }
    };
    
    if (settingsModalOpen && activeTab === 'subscription') {
      fetchPlans();
    }
  }, [settingsModalOpen, activeTab]);

  // Sync CORS proxy to localStorage and WebModeContext
  const handleCorsProxyChange = (value: string) => {
    setCorsProxy(value);
    localStorage.setItem('echolon_cors_proxy', value);
    if (webMode) {
      webMode.setCorsProxy(value);
    }
  };

  // Load Echolon path (skip in web mode)
  useEffect(() => {
    if (isWebMode) return;
    
    const loadPath = async () => {
      const path = await fileStorageManager.getEcholonPath();
      setEcholonPath(path);
    };
    loadPath();
  }, [settingsModalOpen, isWebMode]);

  // Load localStorage data for debug view
  const refreshLocalStorageData = useCallback(() => {
    const data: { key: string; value: string; size: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key) || '';
        data.push({
          key,
          value,
          size: new Blob([value]).size,
        });
      }
    }
    // Sort by key name
    data.sort((a, b) => a.key.localeCompare(b.key));
    setLocalStorageData(data);
  }, []);

  useEffect(() => {
    if (settingsModalOpen && activeTab === 'storage' && settings.debugMode) {
      refreshLocalStorageData();
    }
  }, [settingsModalOpen, activeTab, settings.debugMode, refreshLocalStorageData]);

  const handleCheckForUpdates = async () => {
    if (update) {
      await update.checkForUpdates();
    }
  };

  const handleDownloadUpdate = () => {
    if (update) {
      update.openModal('update');
    }
  };

  const handleChangeStoragePath = async () => {
    if (isWebMode) return;
    const newPath = await fileStorageManager.selectDirectory();
    if (newPath) {
      const result = await fileStorageManager.setEcholonPath(newPath);
      if (result.success) {
        setEcholonPath(newPath);
      }
    }
  };

  const handleOpenStorageFolder = async () => {
    if (isWebMode) return;
    await fileStorageManager.openInFileManager();
  };

  const handleGitHubLogout = async () => {
    if (confirm('Are you sure you want to disconnect from GitHub?')) {
      await logout();
    }
  };

  const handleSaveGitHubPat = async () => {
    if (!githubPat.trim()) return;
    
    setPatSaving(true);
    setPatSaved(false);
    setPatError(null);
    try {
      // Authenticate with GitHub using the PAT - this validates and saves the token
      const result = await loginWithPAT(githubPat.trim());
      
      if (result.success) {
        setPatSaved(true);
        setSavedTokenExists(true);
        setGithubPat(''); // Clear the input for security
        setShowToken(false);
        setTimeout(() => setPatSaved(false), 3000);
      } else {
        setPatError(result.error || 'Failed to authenticate with GitHub');
      }
    } catch (error) {
      console.error('Failed to save GitHub PAT:', error);
      setPatError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setPatSaving(false);
    }
  };

  const handleWipeAllData = async () => {
    if (wipeConfirmText !== 'DELETE ALL') return;
    
    setIsWiping(true);
    try {
      // Clear localStorage first
      localStorage.clear();
      
      // Clear file storage (Electron only)
      if (window.electronAPI?.wipeAllData) {
        const result = await window.electronAPI.wipeAllData();
        if (!result.success) {
          console.error('Failed to wipe file storage:', result.error);
        }
      }
      
      // Restart the app
      if (window.electronAPI?.restartApp) {
        await window.electronAPI.restartApp();
      } else {
        // Web mode - just reload
        window.location.reload();
      }
    } catch (error) {
      console.error('Failed to wipe data:', error);
      setIsWiping(false);
    }
  };

  const allTabs: { id: SettingsTab; label: string; icon: React.ReactNode; electronOnly?: boolean }[] = [
    { id: 'general', label: 'General', icon: <SettingsIcon /> },
    { id: 'storage', label: 'Storage', icon: <FolderIcon /> }, // Available in web mode too
    { id: 'github', label: 'GitHub', icon: <GitHubIcon />, electronOnly: true },
    { id: 'theming', label: 'Theming', icon: <PaletteIcon /> },
    { id: 'editor', label: 'Editor', icon: <CodeIcon /> },
    { id: 'requests', label: 'Requests', icon: <SendIcon /> },
    { id: 'mocking', label: 'Mocking', icon: <ServerIcon />, electronOnly: true },
    { id: 'subscription', label: 'Subscription', icon: <CreditCardIcon /> },
    { id: 'updates', label: 'Updates', icon: <DownloadIcon />, electronOnly: true },
    { id: 'about', label: 'About', icon: <InfoIcon /> },
  ];
  
  // Apply custom update server URL
  const handleApplyCustomUpdateServer = async () => {
    if (!window.electronAPI?.setUpdateServer) return;
    
    try {
      const result = await window.electronAPI.setUpdateServer(customUpdateUrl || null);
      if (result.success) {
        updateSettings({ customUpdateServerUrl: customUpdateUrl });
      } else {
        console.error('Failed to set update server:', result.error);
      }
    } catch (error) {
      console.error('Failed to set update server:', error);
    }
  };
  
  // Reset to default update server
  const handleResetUpdateServer = async () => {
    if (!window.electronAPI?.setUpdateServer) return;
    
    try {
      const result = await window.electronAPI.setUpdateServer(null);
      if (result.success) {
        setCustomUpdateUrl('');
        updateSettings({ customUpdateServerUrl: '' });
      }
    } catch (error) {
      console.error('Failed to reset update server:', error);
    }
  };
  
  // Filter out Electron-only tabs when in web mode
  const tabs = allTabs.filter(tab => !isWebMode || !tab.electronOnly);

  // Arrow key navigation for tabs
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!settingsModalOpen) return;
    
    // Don't intercept arrow keys when focused on input elements
    const activeElement = document.activeElement;
    if (activeElement) {
      const tagName = activeElement.tagName.toLowerCase();
      const isEditable = activeElement.getAttribute('contenteditable') === 'true';
      if (tagName === 'input' || tagName === 'textarea' || isEditable) {
        return;
      }
    }
    
    const currentIndex = tabs.findIndex(tab => tab.id === activeTab);
    
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const newIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
      setActiveTab(tabs[newIndex].id);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      const newIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
      setActiveTab(tabs[newIndex].id);
    }
  }, [settingsModalOpen, activeTab, tabs]);

  useEffect(() => {
    if (settingsModalOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [settingsModalOpen, handleKeyDown]);


  /*return (
    <Modal
    isOpen={settingsModalOpen}
    onClose={closeSettingsModal}
    title="Settings"
    size="lg"
    className="settings-modal-container"
  >
    <div style={{ padding: 24, color: '#ef4444', background: '#1a1a1a', borderRadius: 8 }}>
      <h3 style={{ margin: '0 0 12px', color: '#ef4444' }}> Settings Modal!</h3>
    </div>
    </Modal>
  )*/

  return (
    <Modal
      isOpen={settingsModalOpen}
      onClose={closeSettingsModal}
      title="Settings"
      size="lg"
      className="settings-modal-container"
    >
      <SettingsErrorBoundary>
      <div className="settings-modal">
       
        <div className="settings-modal__sidebar">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`settings-modal__tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="settings-modal__tab-icon">{tab.icon}</span>
              <span className="settings-modal__tab-label">{tab.label}</span>
            </button>
          ))}
        </div>

       
        <div className="settings-modal__content">
          {activeTab === 'general' && (
            <div className="settings-modal__panel">
              <div>SETTINGS</div>
             {/*} <div className="settings-modal__panel-header">
                <h2>General</h2>
                <p>Customize the appearance and behavior of Echolon</p>
              </div>

              <div className="settings-modal__section">
                <h3>Appearance</h3>
                
                <div className="settings-modal__field">
                  <label>Mode</label>
                  <p className="settings-modal__field-description">
                    Choose between dark, light, or system preference
                  </p>
                  <Dropdown
                    options={[
                      { value: 'dark', label: 'Dark' },
                      { value: 'light', label: 'Light' },
                      { value: 'system', label: 'System' },
                    ]}
                    value={theme}
                   onChange={(value) => setTheme(value as 'dark' | 'light' | 'system')}
                  />
                </div>

                <div className="settings-modal__field">
                  <label>Font Size</label>
                  <p className="settings-modal__field-description">
                    Base font size for the application (10-20px)
                  </p>
                  <SimpleInput
                    type="number"
                    value={settings.fontSize?.toString() ?? "13"}
                    onChange={(e) => updateSettings({ fontSize: parseInt(e.target.value) || 13 })}
                    min={10}
                    max={20}
                  />
                </div>
              </div>

              <div className="settings-modal__section">
                <h3>Data</h3>
                
                <div className="settings-modal__field settings-modal__field--checkbox">
                  <label>
                    <input
                      type="checkbox"
                       checked={settings.autoSave}
                      onChange={(e) => updateSettings({ autoSave: e.target.checked })}
                    />
                    <span>Auto-save requests</span>
                  </label>
                  <p className="settings-modal__field-description">
                    Automatically save changes to requests as you make them
                  </p>
                </div>
              </div>
              */}

             
            </div>
          )}

          {activeTab === 'storage' && (
            <div className="settings-modal__panel">
              <div className="settings-modal__panel-header">
                <h2>Storage</h2>
                <p>Configure where your API collections are stored</p>
              </div>

              {/* Web Mode Storage UI */}
              {isWebMode && (
                <>
                  <div className="settings-modal__section">
                    <h3>Local File System</h3>
                    
                    {!isWebFileSystemSupported ? (
                      <div className="settings-modal__field">
                        <div className="settings-modal__warning-box">
                          <WarningIcon />
                          <div>
                            <p><strong>Browser Not Supported</strong></p>
                            <p className="settings-modal__field-description">
                              Your browser does not support the File System API. 
                              Please use Chrome, Edge, or another Chromium-based browser to enable local file storage.
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : !isWebFileSystemEnabled ? (
                      <div className="settings-modal__field">
                        <label>Enable Local Storage</label>
                        <p className="settings-modal__field-description">
                          Enable local file system storage to persist your workspaces, collections, and environments. 
                          Without this, your data will only be stored in browser memory and lost when you close the tab.
                        </p>
                        <Button 
                          variant="primary" 
                          size="sm"
                          onClick={async () => {
                            const result = await enableWebFileSystem();
                            if (!result.success && result.error) {
                              console.error('Failed to enable storage:', result.error);
                            }
                          }}
                          icon={<FolderIcon />}
                        >
                          Select Storage Folder
                        </Button>
                      </div>
                    ) : (
                      <div className="settings-modal__field">
                        <label>Storage Location</label>
                        <p className="settings-modal__field-description">
                          Your data is being stored in a local folder on your computer.
                        </p>
                        <div className="settings-modal__path-field">
                          <code className="settings-modal__path-value">{webEcholonPath || 'Selected folder'}</code>
                          <div className="settings-modal__path-actions">
                            <Button 
                              variant="secondary" 
                              size="sm"
                              onClick={async () => {
                                const result = await enableWebFileSystem();
                                if (!result.success && result.error) {
                                  console.error('Failed to change storage:', result.error);
                                }
                              }}
                              icon={<FolderIcon />}
                            >
                              Change
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={async () => {
                                if (confirm('Are you sure you want to disconnect from local storage? Your files will remain on disk but Echolon will no longer read from them.')) {
                                  await disableWebFileSystem();
                                }
                              }}
                            >
                              Disconnect
                            </Button>
                          </div>
                        </div>
                        <p className="settings-modal__field-description" style={{ marginTop: 8, color: 'var(--color-success)' }}>
                          ✓ Local storage is enabled. Your data will be persisted.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="settings-modal__section">
                    <h3>How It Works</h3>
                    <p className="settings-modal__field-description">
                      The Web File System API allows Echolon to read and write files directly to a folder on your computer. 
                      Your browser will ask for permission to access the folder you select.
                    </p>
                    <div className="settings-modal__about-info" style={{ marginTop: 12 }}>
                      <div className="settings-modal__about-row">
                        <span className="settings-modal__about-label">Format</span>
                        <span className="settings-modal__about-value">
                          <code>.json (Echo format v1.0)</code>
                        </span>
                      </div>
                      <div className="settings-modal__about-row">
                        <span className="settings-modal__about-label">Structure</span>
                        <span className="settings-modal__about-value">
                          <code>/workspaces/{'{workspace}'}/collections/{'{collection}'}.json</code>
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Electron Mode Storage UI */}
              {!isWebMode && (
                <>
                  <div className="settings-modal__section">
                    <h3>Data Location</h3>
                    
                    <div className="settings-modal__field">
                      <label>Echolon Directory</label>
                      <p className="settings-modal__field-description">
                        All your workspaces, collections, and environments are stored in this folder
                      </p>
                      <div className="settings-modal__path-field">
                        <code className="settings-modal__path-value">{echolonPath}</code>
                        <div className="settings-modal__path-actions">
                          <Button 
                            variant="secondary" 
                            size="sm"
                            onClick={handleOpenStorageFolder}
                            icon={<ExternalLinkIcon />}
                          >
                            Open
                          </Button>
                          <Button 
                            variant="secondary" 
                            size="sm"
                            onClick={handleChangeStoragePath}
                            icon={<FolderIcon />}
                          >
                            Change
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="settings-modal__section">
                    <h3>File Format</h3>
                    
                    <div className="settings-modal__about-info">
                      <div className="settings-modal__about-row">
                        <span className="settings-modal__about-label">Format</span>
                        <span className="settings-modal__about-value">
                          <code>.json (Echo format v1.0)</code>
                        </span>
                      </div>
                      <div className="settings-modal__about-row">
                        <span className="settings-modal__about-label">Structure</span>
                        <span className="settings-modal__about-value">
                          <code>/workspaces/{'{workspace}'}/collections/{'{collection}'}.json</code>
                        </span>
                      </div>
                    </div>
                    <p className="settings-modal__field-description" style={{ marginTop: 12 }}>
                      Collections are stored as JSON files compatible with version control systems like Git.
                      You can edit these files directly or sync them using the Git integration.
                    </p>
                  </div>
                </>
              )}

              {settings.debugMode && (
                <div className="settings-modal__section">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-md)' }}>
                    <h3 style={{ margin: 0 }}>Local Storage (Debug)</h3>
                    <Button 
                      variant="secondary" 
                      size="sm"
                      onClick={refreshLocalStorageData}
                      icon={<RefreshIcon />}
                    >
                      Refresh
                    </Button>
                  </div>
                  <p className="settings-modal__field-description" style={{ marginBottom: 'var(--spacing-md)' }}>
                    Total items: {localStorageData.length} • 
                    Total size: {(localStorageData.reduce((acc, item) => acc + item.size, 0) / 1024).toFixed(2)} KB
                  </p>
                  <div className="settings-modal__localstorage-list">
                    {localStorageData.map((item) => (
                      <div key={item.key} className="settings-modal__localstorage-item">
                        <div className="settings-modal__localstorage-header">
                          <code className="settings-modal__localstorage-key">{item.key}</code>
                          <span className="settings-modal__localstorage-size">
                            {item.size < 1024 ? `${item.size} B` : `${(item.size / 1024).toFixed(2)} KB`}
                          </span>
                        </div>
                        <pre className="settings-modal__localstorage-value">
                          {item.value.length > 500 
                            ? item.value.substring(0, 500) + '...' 
                            : item.value}
                        </pre>
                      </div>
                    ))}
                    {localStorageData.length === 0 && (
                      <p className="settings-modal__field-description">No data in localStorage</p>
                    )}
                  </div>
                </div>
              )}

              <div className="settings-modal__section settings-modal__section--danger">
                <h3>Danger Zone</h3>
                
                <div className="settings-modal__field">
                  <label>Wipe All Data</label>
                  <p className="settings-modal__field-description">
                    Permanently delete all workspaces, collections, environments, and settings. 
                    This action cannot be undone.
                  </p>
                  <Button 
                    variant="danger" 
                    size="sm"
                    onClick={() => setShowWipeConfirmation(true)}
                  >
                    Wipe All Data
                  </Button>
                </div>
              </div>
            </div>
          )}

        
          {showWipeConfirmation && (
            <div className="settings-modal__confirmation-overlay">
              <div className="settings-modal__confirmation-modal">
                <h3>⚠️ Confirm Data Wipe</h3>
                <p>
                  This will permanently delete <strong>all</strong> your data including:
                </p>
                <ul>
                  <li>All workspaces and collections</li>
                  <li>All environments and variables</li>
                  <li>All settings and preferences</li>
                  <li>Request history</li>
                </ul>
                <p>
                  Type <code>DELETE ALL</code> to confirm:
                </p>
                <SimpleInput
                  value={wipeConfirmText}
                  onChange={(e) => setWipeConfirmText(e.target.value)}
                  placeholder="Type DELETE ALL"
                  autoFocus
                />
                <div className="settings-modal__confirmation-actions">
                  <Button 
                    variant="secondary" 
                    onClick={() => {
                      setShowWipeConfirmation(false);
                      setWipeConfirmText('');
                    }}
                    disabled={isWiping}
                  >
                    Cancel
                  </Button>
                  <Button 
                    variant="danger" 
                    onClick={handleWipeAllData}
                    disabled={wipeConfirmText !== 'DELETE ALL' || isWiping}
                    loading={isWiping}
                  >
                    {isWiping ? 'Wiping...' : 'Wipe All Data & Restart'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'github' && (
            <div className="settings-modal__panel">
              <div className="settings-modal__panel-header">
                <h2>GitHub Integration</h2>
                <p>Connect to GitHub to sync and version control your collections</p>
              </div>

              <div className="settings-modal__section">
                <h3>Connection Status</h3>
                
                {isAuthenticated && user ? (
                  <div className="settings-modal__github-connected">
                    <img 
                      src={user.avatar_url} 
                      alt={user.login}
                      className="settings-modal__github-avatar"
                    />
                    <div className="settings-modal__github-info">
                      <div className="settings-modal__github-name">
                        {user.name || user.login}
                      </div>
                      <div className="settings-modal__github-login">
                        @{user.login}
                      </div>
                    </div>
                    <div className="settings-modal__github-status">
                      <CheckIcon />
                      Connected
                    </div>
                  </div>
                ) : (
                  <div className="settings-modal__github-disconnected">
                    <GitHubIcon />
                    <span>Not connected to GitHub</span>
                    <p className="settings-modal__field-description">
                      Connect your GitHub account to push and pull collections from repositories.
                    </p>
                  </div>
                )}
                
                <div className="settings-modal__github-actions">
                  {isAuthenticated ? (
                    <Button 
                      variant="danger" 
                      onClick={handleGitHubLogout}
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <p className="settings-modal__field-description">
                      Use the Git panel in the sidebar to connect your GitHub account.
                    </p>
                  )}
                </div>
              </div>

              <div className="settings-modal__section">
                <h3>Personal Access Token</h3>
                <p className="settings-modal__field-description" style={{ marginBottom: 12 }}>
                  Configure a GitHub Personal Access Token (PAT) for authentication. This is useful if you prefer not to use OAuth or need fine-grained access control.
                </p>
                
                <div className="settings-modal__field">
                  <label>Access Token</label>
                  <p className="settings-modal__field-description">
                    Create a token at{' '}
                    <a 
                      href="#" 
                      onClick={(e) => { 
                        e.preventDefault(); 
                        window.electronAPI?.openExternal?.('https://github.com/settings/tokens'); 
                      }}
                      style={{ color: 'var(--color-primary)' }}
                    >
                      github.com/settings/tokens
                    </a>
                    {' '}with <code>repo</code> scope.
                  </p>
                  
                  {/* Token input with show/hide toggle */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <SimpleInput
                        type={showToken ? 'text' : 'password'}
                        value={githubPat}
                        onChange={(e) => {
                          setGithubPat(e.target.value);
                          setPatError(null);
                        }}
                        placeholder={savedTokenExists && isAuthenticated ? 'Enter new token to replace' : 'ghp_xxxxxxxxxxxxxxxxxxxx'}
                        style={{ flex: 1, paddingRight: 36 }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken(!showToken)}
                        style={{
                          position: 'absolute',
                          right: 8,
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 4,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--color-text-tertiary)',
                          opacity: githubPat ? 1 : 0.5,
                        }}
                        disabled={!githubPat}
                        title={showToken ? 'Hide token' : 'Show token'}
                      >
                        {showToken ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                    <Button 
                      variant="primary" 
                      size="sm"
                      onClick={handleSaveGitHubPat}
                      disabled={!githubPat.trim() || patSaving}
                      loading={patSaving}
                    >
                      {patSaved ? 'Saved!' : 'Save'}
                    </Button>
                  </div>
                  
                  {/* Error message */}
                  {patError && (
                    <p className="settings-modal__field-description" style={{ color: 'var(--color-danger)', marginTop: 8 }}>
                      {patError}
                    </p>
                  )}
                  
                  {/* Success message */}
                  {patSaved && (
                    <p className="settings-modal__field-description" style={{ color: 'var(--color-success)', marginTop: 8 }}>
                      <CheckIcon /> Token saved and authenticated successfully!
                    </p>
                  )}
                  
                  {/* Info about token storage */}
                  <p className="settings-modal__field-description" style={{ marginTop: 12, fontSize: 11, opacity: 0.7 }}>
                    <span style={{ display: 'inline-flex', width: 12, height: 12, marginRight: 4, verticalAlign: 'middle' }}><InfoIcon /></span>
                    Token is stored locally in your Echolon config file.
                  </p>
                </div>
              </div>

              {isAuthenticated && (
                <div className="settings-modal__section">
                  <h3>Features</h3>
                  
                  <ul className="settings-modal__plan-features">
                    <li><CheckIcon /> Push collections to GitHub</li>
                    <li><CheckIcon /> Pull changes from repositories</li>
                    <li><CheckIcon /> View commit history</li>
                    <li><CheckIcon /> Switch between branches</li>
                    <li><CheckIcon /> Create new branches</li>
                  </ul>
                </div>
              )}
            </div>
          )}

          {activeTab === 'theming' && (
            <div className="settings-modal__panel">
              <div className="settings-modal__panel-header">
                <h2>Theming</h2>
                <p>Personalize the look and feel of Echolon</p>
              </div>

              <div className="settings-modal__section">
                <h3>Color Scheme</h3>
                
                <div className="settings-modal__theme-grid">
                  {COLOR_SCHEMES.map((scheme) => (
                    <button
                      key={scheme.id}
                      className={`settings-modal__theme-card ${colorScheme === scheme.id ? 'active' : ''}`}
                      onClick={() => setColorScheme(scheme.id as ColorScheme)}
                      style={{
                        '--theme-primary': scheme.primaryColor,
                        '--theme-bg-1': scheme.previewColors[0],
                        '--theme-bg-2': scheme.previewColors[1],
                        '--theme-accent-1': scheme.previewColors[2],
                        '--theme-accent-2': scheme.previewColors[3],
                      } as React.CSSProperties}
                    >
                      <div className="settings-modal__theme-preview">
                        <div className="settings-modal__theme-preview-sidebar" />
                        <div className="settings-modal__theme-preview-main">
                          <div className="settings-modal__theme-preview-topbar" />
                          <div className="settings-modal__theme-preview-content">
                            <div className="settings-modal__theme-preview-btn" />
                            <div className="settings-modal__theme-preview-line" />
                            <div className="settings-modal__theme-preview-line" />
                          </div>
                        </div>
                      </div>
                      <div className="settings-modal__theme-info">
                        <span className="settings-modal__theme-name">{scheme.name}</span>
                        <span className="settings-modal__theme-description">{scheme.description}</span>
                      </div>
                      {colorScheme === scheme.id && (
                        <div className="settings-modal__theme-active">
                          <CheckIcon />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'editor' && (
            <div className="settings-modal__panel">
              <div className="settings-modal__panel-header">
                <h2>Editor</h2>
                <p>Configure the code editor settings</p>
              </div>

              <div className="settings-modal__section">
                <h3>Formatting</h3>
                
                <div className="settings-modal__field">
                  <label>Tab Size</label>
                  <p className="settings-modal__field-description">
                    Number of spaces per indentation level
                  </p>
                  <Dropdown
                    options={[
                      { value: '2', label: '2 spaces' },
                      { value: '4', label: '4 spaces' },
                    ]}
                    value={String(settings.tabSize)}
                    onChange={(value) => updateSettings({ tabSize: parseInt(value) })}
                  />
                </div>

                <div className="settings-modal__field settings-modal__field--checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.wordWrap}
                      onChange={(e) => updateSettings({ wordWrap: e.target.checked })}
                    />
                    <span>Word Wrap</span>
                  </label>
                  <p className="settings-modal__field-description">
                    Wrap long lines in the editor
                  </p>
                </div>
              </div>

              <div className="settings-modal__section">
                <h3>Display</h3>
                
                <div className="settings-modal__field settings-modal__field--checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.showLineNumbers ?? true}
                      onChange={(e) => updateSettings({ showLineNumbers: e.target.checked })}
                    />
                    <span>Show Line Numbers</span>
                  </label>
                  <p className="settings-modal__field-description">
                    Display line numbers in the editor gutter
                  </p>
                </div>

                <div className="settings-modal__field settings-modal__field--checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.highlightActiveLine ?? true}
                      onChange={(e) => updateSettings({ highlightActiveLine: e.target.checked })}
                    />
                    <span>Highlight Active Line</span>
                  </label>
                  <p className="settings-modal__field-description">
                    Highlight the line where the cursor is positioned
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'requests' && (
            <div className="settings-modal__panel">
              <div className="settings-modal__panel-header">
                <h2>Requests</h2>
                <p>Configure HTTP request behavior</p>
              </div>

              <div className="settings-modal__section">
                <h3>Network</h3>
                
                <div className="settings-modal__field">
                  <label>Request Timeout</label>
                  <p className="settings-modal__field-description">
                    Maximum time to wait for a response (in milliseconds)
                  </p>
                  <SimpleInput
                    type="number"
                    value={settings.requestTimeout?.toString()}
                    onChange={(e) => updateSettings({ requestTimeout: parseInt(e.target.value) || 30000 })}
                    min={1000}
                    max={300000}
                  />
                </div>

                <div className="settings-modal__field settings-modal__field--checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.followRedirects}
                      onChange={(e) => updateSettings({ followRedirects: e.target.checked })}
                    />
                    <span>Follow Redirects</span>
                  </label>
                  <p className="settings-modal__field-description">
                    Automatically follow HTTP redirects (3xx responses)
                  </p>
                </div>
              </div>

           
              {/*isWebMode && (
                <div className="settings-modal__section">
                  <h3>CORS Proxy</h3>
                  
                  <div className="settings-modal__field">
                    <label>Proxy URL</label>
                    <p className="settings-modal__field-description">
                      When running in the browser, requests may fail due to CORS restrictions. 
                      Configure a CORS proxy to route requests through.
                    </p>
                    <SimpleInput
                      value={corsProxy}
                      onChange={(e) => handleCorsProxyChange(e.target.value)}
                      placeholder="https://cors-proxy.example.com/"
                    />
                    <p className="settings-modal__field-hint">
                      Examples: <code>https://cors-anywhere.herokuapp.com/</code> or <code>https://proxy.example.com/?url=</code>
                    </p>
                  </div>
                </div>
              )*/}

              <div className="settings-modal__section">
                <h3>Headers</h3>
                
                <div className="settings-modal__field settings-modal__field--checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.sendUserAgent ?? true}
                      onChange={(e) => updateSettings({ sendUserAgent: e.target.checked })}
                    />
                    <span>Send User-Agent Header</span>
                  </label>
                  <p className="settings-modal__field-description">
                    Automatically include <code>User-Agent: Echolon/{appVersion}</code> header in all requests
                  </p>
                </div>
              </div>

              

              <div className="settings-modal__section">
                <h3>History</h3>
                
                <div className="settings-modal__field settings-modal__field--checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.persistHistory ?? true}
                      onChange={(e) => updateSettings({ persistHistory: e.target.checked })}
                    />
                    <span>Persist Request History</span>
                  </label>
                  <p className="settings-modal__field-description">
                    Save request history to disk so it survives app restarts. History is stored in each workspace folder and excluded from Git by default.
                  </p>
                </div>
                
                <div className="settings-modal__field">
                  <label>Max History Entries</label>
                  <p className="settings-modal__field-description">
                    Maximum number of requests to keep in history
                  </p>
                  <SimpleInput
                    type="number"
                    value={(settings.maxHistoryEntries ?? 100).toString()}
                    onChange={(e) => updateSettings({ maxHistoryEntries: parseInt(e.target.value) || 100 })}
                    min={10}
                    max={1000}
                  />
                </div>
                
                <div className="settings-modal__field">
                  <label>Max Binary Response Size (KB)</label>
                  <p className="settings-modal__field-description">
                    Binary responses (images, PDFs, etc.) larger than this will be excluded from history to save disk space. Set to 0 to always exclude binary responses.
                  </p>
                  <SimpleInput
                    type="number"
                    value={(settings.historyMaxBinarySize ?? 50).toString()}
                    onChange={(e) => updateSettings({ historyMaxBinarySize: parseInt(e.target.value) || 0 })}
                    min={0}
                    max={10000}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'mocking' && (
            <div className="settings-modal__panel">
              <div className="settings-modal__panel-header">
                <h2>Mocking</h2>
                <p>Configure mock server and request capture settings</p>
              </div>

              <div className="settings-modal__section">
                <h3>Interface</h3>
                
                <div className="settings-modal__field settings-modal__field--checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.mockingShowQuickTest ?? true}
                      onChange={(e) => updateSettings({ mockingShowQuickTest: e.target.checked })}
                    />
                    <span>Show Quick Test</span>
                  </label>
                  <p className="settings-modal__field-description">
                    Show the Quick Test buttons for sending test requests to the mock server
                  </p>
                </div>
                
                <div className="settings-modal__field settings-modal__field--checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.mockingAutoSave ?? false}
                      onChange={(e) => updateSettings({ mockingAutoSave: e.target.checked })}
                    />
                    <span>Auto-save Mocked Response</span>
                  </label>
                  <p className="settings-modal__field-description">
                    Automatically save the mocked response when you leave an input field (status, headers, body)
                  </p>
                </div>
              </div>

              <div className="settings-modal__section">
                <h3>Request Capture</h3>
                
                <div className="settings-modal__field">
                  <label>Max Captured Requests</label>
                  <p className="settings-modal__field-description">
                    Maximum number of requests to keep in the capture history. Older requests will be automatically removed when this limit is reached.
                  </p>
                  <SimpleInput
                    type="number"
                    value={(settings.mockingMaxCapturedRequests ?? 1000).toString()}
                    onChange={(e) => updateSettings({ mockingMaxCapturedRequests: parseInt(e.target.value) || 1000 })}
                    min={100}
                    max={10000}
                  />
                </div>

                <div className="settings-modal__field">
                  <label>Save Debounce (ms)</label>
                  <p className="settings-modal__field-description">
                    Time to wait before saving captured requests to disk. Lower values save more frequently but may impact performance during high traffic.
                  </p>
                  <SimpleInput
                    type="number"
                    value={(settings.mockingSaveDebounceMs ?? 1000).toString()}
                    onChange={(e) => updateSettings({ mockingSaveDebounceMs: parseInt(e.target.value) || 1000 })}
                    min={100}
                    max={10000}
                    step={100}
                  />
                </div>
              </div>

              <div className="settings-modal__section">
                <h3>Persistence</h3>
                <p className="settings-modal__field-description">
                  Captured requests are automatically saved to disk and restored when you reload the application. 
                  This works for both local mock servers and cloud proxy connections.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'subscription' && (
            <div className="settings-modal__panel">
              <div className="settings-modal__panel-header">
                <h2>Subscription</h2>
                <p>Manage your Echolon subscription</p>
              </div>

              <div className="settings-modal__section">
                {plansLoading ? (
                  <div className="settings-modal__loading">Loading plans...</div>
                ) : plansError ? (
                  <div className="settings-modal__plans-error">
                    <WarningIcon />
                    <h4>{plansError}</h4>
                    <p>
                      Please try again later or contact us at{' '}
                      <a href="mailto:support@echolon.app">support@echolon.app</a>
                    </p>
                  </div>
                ) : (
                  plans.map((plan, index) => (
                    <div
                      key={plan.id}
                      className={`settings-modal__plan-card ${
                        index === 0 ? 'settings-modal__plan-card--current' : ''
                      } ${plan.highlight ? 'settings-modal__plan-card--pro' : ''}`}
                    >
                      <div className="settings-modal__plan-badge">
                        {index === 0 ? 'Current Plan' : plan.badge || plan.name}
                      </div>
                      <h3>{plan.name}</h3>
                      <p className="settings-modal__plan-price">
                        ${plan.price} {plan.price > 0 ? `/ ${plan.period}` : '/ month'}
                      </p>
                      {plan.billing && (
                        <p className="settings-modal__plan-billing">{plan.billing}</p>
                      )}
                      <ul className="settings-modal__plan-features">
                        {plan.features.map((feature, featureIndex) => (
                          <li key={featureIndex}>
                            <CheckIcon /> {feature}
                          </li>
                        ))}
                      </ul>
                      {index > 0 && (
                        <Button 
                          variant="primary" 
                          className="settings-modal__upgrade-btn"
                          onClick={() => {
                            // Open pricing page or checkout
                            window.open(plan.ctaLink.startsWith('http') ? plan.ctaLink : `https://echolon.app${plan.ctaLink}`, '_blank');
                          }}
                        >
                          {plan.cta}
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'updates' && (
            <div className="settings-modal__panel">
              <div className="settings-modal__panel-header">
                <h2>Updates</h2>
                <p>Manage software updates for Echolon</p>
              </div>

              <div className="settings-modal__section">
                <h3>Current Version</h3>
                <div className="settings-modal__about-info">
                  <div className="settings-modal__about-row">
                    <span className="settings-modal__about-label">Installed Version</span>
                    <span className="settings-modal__about-value">
                      <code>v{appVersion}</code>
                    </span>
                  </div>
                  <div className="settings-modal__about-row">
                    <span className="settings-modal__about-label">Build</span>
                    <span className="settings-modal__about-value">
                      <code>{BUILD_TIMESTAMP}</code>
                    </span>
                  </div>
                </div>
              </div>

              {update && (
                <>
                  <div className="settings-modal__section">
                    <h3>Update Settings</h3>
                    
                    <div className="settings-modal__field settings-modal__field--checkbox">
                      <label>
                        <input
                          type="checkbox"
                          checked={settings.autoCheckUpdates ?? true}
                          onChange={(e) => updateSettings({ autoCheckUpdates: e.target.checked })}
                        />
                        <span>Automatically check for updates</span>
                      </label>
                      <p className="settings-modal__field-description">
                        Automatically check for new versions when the app starts
                      </p>
                    </div>
                  </div>

                  <div className="settings-modal__section">
                    <h3>Check for Updates</h3>
                    
                    <div className="settings-modal__update-check">
                      {update.status === 'downloaded' ? (
                        <Button 
                          variant="primary" 
                          onClick={() => update.installUpdate()}
                          icon={<RocketIcon />}
                        >
                          Restart & Install Update
                        </Button>
                      ) : update.status === 'available' ? (
                        <Button 
                          variant="primary" 
                          onClick={handleDownloadUpdate}
                          icon={<DownloadIcon />}
                        >
                          Download Update v{update.updateInfo?.version}
                        </Button>
                      ) : update.status === 'downloading' ? (
                        <Button 
                          variant="secondary" 
                          loading={true}
                          icon={<DownloadIcon />}
                        >
                          Downloading... {update.downloadProgress ? `${Math.round(update.downloadProgress.percent)}%` : ''}
                        </Button>
                      ) : (
                        <Button 
                          variant="secondary" 
                          onClick={handleCheckForUpdates}
                          loading={update.status === 'checking'}
                          icon={<RefreshIcon />}
                        >
                          {update.status === 'checking' ? 'Checking...' : 'Check for Updates'}
                        </Button>
                      )}
                      
                      {update.status === 'available' && update.updateInfo && (
                        <div className="settings-modal__update-status settings-modal__update-status--available">
                          <CheckIcon />
                          <span>Version {update.updateInfo.version} is available!</span>
                        </div>
                      )}
                      
                      {update.status === 'downloaded' && update.updateInfo && (
                        <div className="settings-modal__update-status settings-modal__update-status--downloaded">
                          <RocketIcon />
                          <span>Version {update.updateInfo.version} ready to install</span>
                        </div>
                      )}
                      
                      {update.status === 'not-available' && (
                        <div className="settings-modal__update-status settings-modal__update-status--current">
                          <CheckIcon />
                          <span>You're up to date! (v{appVersion})</span>
                        </div>
                      )}
                      
                      {update.status === 'error' && (
                        <div className="settings-modal__update-status settings-modal__update-status--error">
                          <span>{update.error || 'Failed to check for updates. Make sure a release exists on GitHub.'}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

            
              {settings.debugMode && (
                <div className="settings-modal__section">
                  <h3>Custom Update Server (Debug)</h3>
                  <p className="settings-modal__field-description" style={{ marginBottom: 12 }}>
                    Override the default update server URL. This is useful for testing updates locally or from a custom server.
                  </p>
                  
                  <div className="settings-modal__field">
                    <label>Custom Server URL</label>
                    <p className="settings-modal__field-description">
                      Enter a custom update server URL (e.g., <code>http://localhost:3505</code>)
                    </p>
                    <SimpleInput
                      value={customUpdateUrl}
                      onChange={(e) => setCustomUpdateUrl(e.target.value)}
                      placeholder="http://localhost:3505"
                    />
                  </div>
                  
                  <div className="settings-modal__path-actions" style={{ marginTop: 12 }}>
                    <Button 
                      variant="primary" 
                      size="sm"
                      onClick={handleApplyCustomUpdateServer}
                    >
                      Apply Custom URL
                    </Button>
                    <Button 
                      variant="secondary" 
                      size="sm"
                      onClick={handleResetUpdateServer}
                    >
                      Reset to Default
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'about' && (
            <div className="settings-modal__panel">
              <div className="settings-modal__panel-header">
                <h2>About</h2>
                <p>Information about Echolon</p>
              </div>

              <div className="settings-modal__section">
                <h3>Application</h3>
                
                <div className="settings-modal__about-info">
                  <div className="settings-modal__about-row">
                    <span className="settings-modal__about-label">Version</span>
                    <span className="settings-modal__about-value">
                      <code>{appVersion}</code>
                    </span>
                  </div>
                  <div className="settings-modal__about-row">
                    <span className="settings-modal__about-label">Build</span>
                    <span className="settings-modal__about-value">
                      <code>{BUILD_TIMESTAMP}</code>
                    </span>
                  </div>
                  <div className="settings-modal__about-row">
                    <span className="settings-modal__about-label">Environment</span>
                    <span className="settings-modal__about-value">
                      <code>{isElectronApp ? 'Desktop App' : 'Web'}</code>
                    </span>
                  </div>
                </div>
              </div>

              <div className="settings-modal__section">
                <h3>Developer</h3>
                
                <div className="settings-modal__field settings-modal__field--checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.debugMode ?? false}
                      onChange={(e) => updateSettings({ debugMode: e.target.checked })}
                    />
                    <span>Debug Mode</span>
                  </label>
                  <p className="settings-modal__field-description">
                    Show debug information like startup time on launch
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      </SettingsErrorBoundary>
    </Modal>
  );
};

export default SettingsModal;
