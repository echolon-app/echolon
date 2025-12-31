import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Input, Dropdown, EditableTable, ColorEmojiPicker } from '@/components/ui';
import { useApp, useTheme, COLOR_SCHEMES, useGitHub, useWebModeOptional, useWorkspace } from '@/contexts';
import { 
  SettingsIcon, CodeIcon, SendIcon, CreditCardIcon, CheckIcon, InfoIcon,
  PaletteIcon, RefreshIcon, FolderIcon, GitHubIcon, ExternalLinkIcon, ServerIcon, GlobeIcon, PlusIcon, TrashIcon 
} from '@/components/ui/icons';
import { fileStorageManager } from '@/services';
import { isElectron } from '@/utils';
import { APP_VERSION } from '@/utils/environment';
import type { ColorScheme, WorkspaceEnvironment, KeyValuePair } from '@/types';
import { v4 as uuidv4 } from 'uuid';
import './SettingsModal.css';

type SettingsTab = 'general' | 'storage' | 'github' | 'theming' | 'editor' | 'requests' | 'workspaces' | 'mocking' | 'subscription' | 'about';

export const SettingsModal: React.FC = () => {
  const { settingsModalOpen, closeSettingsModal, settings, updateSettings, isWebMode } = useApp();
  const { theme, setTheme, colorScheme, setColorScheme } = useTheme();
  const { isAuthenticated, user, logout } = useGitHub();
  const webMode = useWebModeOptional();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'not-available' | 'error'>('idle');
  const [updateInfo, setUpdateInfo] = useState<{ version: string; releaseNotes: string } | null>(null);
  const [echolonPath, setEcholonPath] = useState<string>('');
  const [corsProxy, setCorsProxy] = useState<string>(() => {
    return localStorage.getItem('echolon_cors_proxy') || '';
  });
  
  // Use build-time injected version from package.json
  const appVersion = APP_VERSION;
  const isElectronApp = isElectron();

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

  useEffect(() => {
    if (!window.electronAPI) return;

    const unsubscribers: (() => void)[] = [];

    unsubscribers.push(
      window.electronAPI.onUpdateAvailable((data) => {
        setUpdateStatus('available');
        setUpdateInfo({ version: data.version, releaseNotes: data.releaseNotes });
      }),
      window.electronAPI.onUpdateNotAvailable(() => {
        setUpdateStatus('not-available');
      })
    );

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, []);

  const handleCheckForUpdates = async () => {
    if (!window.electronAPI) return;
    setUpdateStatus('checking');
    try {
      await window.electronAPI.checkForUpdates();
    } catch {
      setUpdateStatus('error');
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

  const allTabs: { id: SettingsTab; label: string; icon: React.ReactNode; electronOnly?: boolean }[] = [
    { id: 'general', label: 'General', icon: <SettingsIcon /> },
    { id: 'storage', label: 'Storage', icon: <FolderIcon />, electronOnly: true },
    { id: 'github', label: 'GitHub', icon: <GitHubIcon />, electronOnly: true },
    { id: 'theming', label: 'Theming', icon: <PaletteIcon /> },
    { id: 'editor', label: 'Editor', icon: <CodeIcon /> },
    { id: 'requests', label: 'Requests', icon: <SendIcon /> },
    { id: 'workspaces', label: 'Workspace Envs', icon: <GlobeIcon />, electronOnly: true },
    { id: 'mocking', label: 'Mocking', icon: <ServerIcon /> },
    { id: 'subscription', label: 'Subscription', icon: <CreditCardIcon /> },
    { id: 'about', label: 'About', icon: <InfoIcon /> },
  ];
  
  // Filter out Electron-only tabs when in web mode
  const tabs = allTabs.filter(tab => !isWebMode || !tab.electronOnly);

  // Arrow key navigation for tabs
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!settingsModalOpen) return;
    
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

  return (
    <Modal
      isOpen={settingsModalOpen}
      onClose={closeSettingsModal}
      title="Settings"
      size="lg"
      className="settings-modal-container"
    >
      <div className="settings-modal">
        {/* Sidebar Navigation */}
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

        {/* Content Area */}
        <div className="settings-modal__content">
          {activeTab === 'general' && (
            <div className="settings-modal__panel">
              <div className="settings-modal__panel-header">
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
                  <Input
                    type="number"
                    value={settings.fontSize}
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

              {!isWebMode && (
                <div className="settings-modal__section">
                  <h3>Storage Location</h3>
                  
                  <div className="settings-modal__field">
                    <p className="settings-modal__field-description">
                      Your workspaces and collections are saved at:
                    </p>
                    <div className="settings-modal__path-field">
                      <code className="settings-modal__path-value">{echolonPath}</code>
                      <Button 
                        variant="secondary" 
                        size="sm"
                        onClick={handleOpenStorageFolder}
                        icon={<ExternalLinkIcon />}
                      >
                        Open
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'storage' && (
            <div className="settings-modal__panel">
              <div className="settings-modal__panel-header">
                <h2>Storage</h2>
                <p>Configure where your API collections are stored</p>
              </div>

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
                  <Input
                    type="number"
                    value={settings.requestTimeout}
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

              {/* CORS Proxy - shown in web mode or when useful for browser users */}
              {isWebMode && (
                <div className="settings-modal__section">
                  <h3>CORS Proxy</h3>
                  
                  <div className="settings-modal__field">
                    <label>Proxy URL</label>
                    <p className="settings-modal__field-description">
                      When running in the browser, requests may fail due to CORS restrictions. 
                      Configure a CORS proxy to route requests through.
                    </p>
                    <Input
                      value={corsProxy}
                      onChange={(e) => handleCorsProxyChange(e.target.value)}
                      placeholder="https://cors-proxy.example.com/"
                    />
                    <p className="settings-modal__field-hint">
                      Examples: <code>https://cors-anywhere.herokuapp.com/</code> or <code>https://proxy.example.com/?url=</code>
                    </p>
                  </div>
                </div>
              )}

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
                
                <div className="settings-modal__field">
                  <label>Max History Entries</label>
                  <p className="settings-modal__field-description">
                    Maximum number of requests to keep in history
                  </p>
                  <Input
                    type="number"
                    value={settings.maxHistoryEntries ?? 100}
                    onChange={(e) => updateSettings({ maxHistoryEntries: parseInt(e.target.value) || 100 })}
                    min={10}
                    max={1000}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'workspaces' && <WorkspaceEnvironmentsPanel />}

          {activeTab === 'mocking' && (
            <div className="settings-modal__panel">
              <div className="settings-modal__panel-header">
                <h2>Mocking</h2>
                <p>Configure mock server and request capture settings</p>
              </div>

              <div className="settings-modal__section">
                <h3>Request Capture</h3>
                
                <div className="settings-modal__field">
                  <label>Max Captured Requests</label>
                  <p className="settings-modal__field-description">
                    Maximum number of requests to keep in the capture history. Older requests will be automatically removed when this limit is reached.
                  </p>
                  <Input
                    type="number"
                    value={settings.mockingMaxCapturedRequests ?? 1000}
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
                  <Input
                    type="number"
                    value={settings.mockingSaveDebounceMs ?? 1000}
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
                <div className="settings-modal__plan-card settings-modal__plan-card--current">
                  <div className="settings-modal__plan-badge">Current Plan</div>
                  <h3>Free</h3>
                  <p className="settings-modal__plan-price">$0 / month</p>
                  <ul className="settings-modal__plan-features">
                    <li><CheckIcon /> Unlimited workspaces</li>
                    <li><CheckIcon /> Unlimited collections</li>
                    <li><CheckIcon /> Unlimited requests</li>
                    <li><CheckIcon /> Unlimited variables</li>
                    <li><CheckIcon /> Scripting support</li>
                    <li><CheckIcon /> Full Git Sync support</li>
                    <li><CheckIcon /> Auto Watch and Migration for remote API changes</li>
                    <li><CheckIcon /> Import from openapi, postman, curl etc.</li>
                    <li><CheckIcon /> REST, GraphQL and WebSocket support.</li>
                    <li><CheckIcon /> Request History</li>
                    <li><CheckIcon /> Web/Mac/Windows/Linux Versions</li>
                    <li><CheckIcon /> All Auth types</li>
                    <li><CheckIcon /> Community Support</li>
                  </ul>
                </div>

                <div className="settings-modal__plan-card settings-modal__plan-card--pro">
                  <div className="settings-modal__plan-badge">Pro</div>
                  <h3>Pro</h3>
                  <p className="settings-modal__plan-price">$9 / user / month</p>
                  <ul className="settings-modal__plan-features">
                    <li><CheckIcon /> Everything in Free</li>
                    <li><CheckIcon /> Team collaboration</li>
                    <li><CheckIcon /> 1-Click publish of your APIs</li>
                    <li><CheckIcon /> Advanced mock servers</li>
                    <li><CheckIcon /> User management</li>
                    <li><CheckIcon /> Priority support (via email)</li>
                  </ul>
                  <Button variant="primary" className="settings-modal__upgrade-btn">
                    Coming Soon
                  </Button>
                </div>


                 <div className="settings-modal__plan-card settings-modal__plan-card--pro">
                  <div className="settings-modal__plan-badge">Enterprise</div>
                  <h3>Pro</h3>
                  <p className="settings-modal__plan-price">$19 / user / month</p>
                  <ul className="settings-modal__plan-features">
                    <li><CheckIcon /> Everything in Pro</li>
                    <li><CheckIcon /> Audit Logs</li>
                    <li><CheckIcon /> Integration with Secret Managers (coming soon)</li>
                    <li><CheckIcon /> Priority support (via email, chat or video)</li>
                  </ul>
                  <Button variant="primary" className="settings-modal__upgrade-btn">
                    Coming Soon
                  </Button>
                </div>
              </div>
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
                    <span className="settings-modal__about-label">Environment</span>
                    <span className="settings-modal__about-value">
                      <code>{isElectronApp ? 'Desktop App' : 'Web'}</code>
                    </span>
                  </div>
                </div>
              </div>

              {/* Software Updates - Only show in Electron app */}
              {isElectronApp && (
                <div className="settings-modal__section">
                  <h3>Software Updates</h3>
                  
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

                  <div className="settings-modal__update-check">
                    <Button 
                      variant="secondary" 
                      onClick={handleCheckForUpdates}
                      loading={updateStatus === 'checking'}
                      icon={<RefreshIcon />}
                    >
                      {updateStatus === 'checking' ? 'Checking...' : 'Check for Updates'}
                    </Button>
                    
                    {updateStatus === 'available' && updateInfo && (
                      <div className="settings-modal__update-status settings-modal__update-status--available">
                        <CheckIcon />
                        <span>Version {updateInfo.version} is available!</span>
                      </div>
                    )}
                    
                    {updateStatus === 'not-available' && (
                      <div className="settings-modal__update-status settings-modal__update-status--current">
                        <CheckIcon />
                        <span>You're up to date!</span>
                      </div>
                    )}
                    
                    {updateStatus === 'error' && (
                      <div className="settings-modal__update-status settings-modal__update-status--error">
                        <span>Failed to check for updates</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

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
    </Modal>
  );
};

// Workspace Environments Panel Component
const WorkspaceEnvironmentsPanel: React.FC = () => {
  const { 
    activeWorkspace, 
    addWorkspaceEnvironment, 
    updateWorkspaceEnvironment, 
    deleteWorkspaceEnvironment 
  } = useWorkspace();
  
  const [newEnvName, setNewEnvName] = useState('');
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(null);

  if (!activeWorkspace) {
    return (
      <div className="settings-modal__panel">
        <div className="settings-modal__panel-header">
          <h2>Workspace Environments</h2>
          <p>No workspace selected</p>
        </div>
      </div>
    );
  }

  const environments = activeWorkspace.environments || [];
  const selectedEnv = environments.find(e => e.id === selectedEnvId);

  const handleAddEnvironment = async () => {
    if (!newEnvName.trim()) return;
    const env = await addWorkspaceEnvironment(activeWorkspace.id, newEnvName.trim());
    if (env) {
      setNewEnvName('');
      setSelectedEnvId(env.id);
    }
  };

  const handleDeleteEnvironment = async (envId: string) => {
    await deleteWorkspaceEnvironment(activeWorkspace.id, envId);
    if (selectedEnvId === envId) {
      setSelectedEnvId(null);
    }
  };

  const handleVariablesChange = (variables: KeyValuePair[]) => {
    if (selectedEnvId) {
      updateWorkspaceEnvironment(activeWorkspace.id, selectedEnvId, { variables });
    }
  };

  const handleEnvNameChange = (name: string) => {
    if (selectedEnvId) {
      updateWorkspaceEnvironment(activeWorkspace.id, selectedEnvId, { name });
    }
  };

  const handleColorEmojiChange = (updates: { color?: string; emoji?: string }) => {
    if (selectedEnvId) {
      updateWorkspaceEnvironment(activeWorkspace.id, selectedEnvId, updates);
    }
  };

  return (
    <div className="settings-modal__panel">
      <div className="settings-modal__panel-header">
        <h2>Workspace Environments</h2>
        <p>Manage environment variables for workspace "{activeWorkspace.name}". These override global variables but are overridden by collection variables.</p>
      </div>

      <div className="settings-modal__section">
        <h3>Environments</h3>
        
        {/* Add new environment */}
        <div className="settings-modal__env-add">
          <Input
            placeholder="New environment name..."
            value={newEnvName}
            onChange={(e) => setNewEnvName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddEnvironment()}
          />
          <Button onClick={handleAddEnvironment} icon={<PlusIcon />} disabled={!newEnvName.trim()}>
            Add
          </Button>
        </div>

        {/* Environment list */}
        {environments.length === 0 ? (
          <p className="settings-modal__field-description">
            No workspace environments yet. Create one to define variables specific to this workspace.
          </p>
        ) : (
          <div className="settings-modal__env-list">
            {environments.map(env => (
              <div 
                key={env.id} 
                className={`settings-modal__env-item ${selectedEnvId === env.id ? 'selected' : ''}`}
                onClick={() => setSelectedEnvId(env.id)}
              >
                <span 
                  className="settings-modal__env-color"
                  style={{ backgroundColor: env.color || '#3b82f6' }}
                >
                  {env.emoji || ''}
                </span>
                <span className="settings-modal__env-name">{env.name}</span>
                <span className="settings-modal__env-vars">{env.variables.length} vars</span>
                <button
                  className="settings-modal__env-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteEnvironment(env.id);
                  }}
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Selected environment editor */}
      {selectedEnv && (
        <div className="settings-modal__section">
          <h3>Edit Environment</h3>
          
          <div className="settings-modal__env-editor">
            <div className="settings-modal__env-header">
              <ColorEmojiPicker
                color={selectedEnv.color}
                emoji={selectedEnv.emoji}
                onChange={handleColorEmojiChange}
                size="lg"
              />
              <Input
                value={selectedEnv.name}
                onChange={(e) => handleEnvNameChange(e.target.value)}
                size="lg"
              />
            </div>
            
            <div className="settings-modal__env-variables">
              <EditableTable
                data={selectedEnv.variables.length > 0 
                  ? selectedEnv.variables 
                  : [{ id: uuidv4(), key: '', value: '', enabled: true }]
                }
                onChange={handleVariablesChange}
                keyPlaceholder="Variable name"
                valuePlaceholder="Value"
                descriptionPlaceholder="Description (optional)"
                showDescription={true}
              />
            </div>
          </div>
        </div>
      )}

      <div className="settings-modal__section">
        <h3>Priority Order</h3>
        <p className="settings-modal__field-description">
          Variables are resolved in the following order (higher overrides lower):
        </p>
        <ol className="settings-modal__priority-list">
          <li><strong>Collection Environment</strong> - Variables from the collection's selected environment (highest priority)</li>
          <li><strong>Workspace Environment</strong> - Variables from this workspace's selected environment</li>
          <li><strong>Global Environment</strong> - Variables from the global environment (lowest priority)</li>
        </ol>
      </div>
    </div>
  );
};

export default SettingsModal;
