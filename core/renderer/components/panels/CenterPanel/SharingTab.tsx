/**
 * SharingTab Component
 * 
 * Handles export and public sharing of API collections
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Input, Button, Switch, Tooltip, Modal, PremiumBadge } from '@/components/ui';
import { GlobeIcon, RefreshIcon, LinkIcon, TrashIcon, CheckIcon, CopyIcon, AlertIcon, DownloadIcon, FileIcon } from '@/components/ui/icons';
import { useToast, useWorkspace, useFileStorage } from '@/contexts';
import { Collection, PublicSharing } from '@/types';
import { publicSpecsService, exportToOpenAPIJson, exportToEcholonJson } from '@/services';
import { isElectron } from '@/utils';
import './SharingTab.css';

type SharingOption = 'openapi' | 'echolon' | 'public';

interface SharingTabProps {
  collection: Collection;
  onUpdateCollection: (updates: Partial<Collection>) => void;
}

// Check subdomain result type
interface CheckResult {
  available: boolean;
  reason?: 'exists' | 'invalid' | 'reserved';
  message?: string;
  owned?: boolean;
}

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

// Generate a unique user ID
function generateUserId(): string {
  return 'usr_' + crypto.randomUUID().replace(/-/g, '').substring(0, 24);
}

export const SharingTab: React.FC<SharingTabProps> = ({ collection, onUpdateCollection }) => {
  const { success, error: showError } = useToast();
  const { activeWorkspace } = useWorkspace();
  const { config, updateConfig } = useFileStorage();
  
  // Check if public sharing is active (moved up for initial state)
  const isPublicActive = collection.publicSharing?.enabled && (collection.publicSharing?.versions?.length ?? 0) > 0;
  
  // Selected option state - pre-select 'public' if public sharing is active
  const [selectedOption, setSelectedOption] = useState<SharingOption | null>(isPublicActive ? 'public' : null);
  
  // Public sharing state
  const [sharingEnabled, setSharingEnabled] = useState(collection.publicSharing?.enabled ?? false);
  const [subdomain, setSubdomain] = useState(collection.publicSharing?.subdomain ?? '');
  const [version, setVersion] = useState('1.0.0');
  const [isCheckingSubdomain, setIsCheckingSubdomain] = useState(false);
  const [subdomainCheck, setSubdomainCheck] = useState<CheckResult | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishedVersions, setPublishedVersions] = useState(collection.publicSharing?.versions ?? []);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [versionToDelete, setVersionToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [disableModalOpen, setDisableModalOpen] = useState(false);
  const [isDisabling, setIsDisabling] = useState(false);

  const debouncedSubdomain = useDebounce(subdomain, 500);

  // Track locally generated userId (for when config hasn't loaded yet)
  const [localUserId] = useState(() => generateUserId());
  
  // Get userId from config, or use the locally generated one
  const userId = config?.userId || localUserId;

  // Persist the userId to config if not already saved
  useEffect(() => {
    if (config && !config.userId) {
      console.log('[SharingTab] Saving userId to config:', userId);
      updateConfig({ userId });
    }
  }, [config, userId, updateConfig]);

  // Generate random subdomain on first enable
  useEffect(() => {
    if (sharingEnabled && !subdomain) {
      const randomSubdomain = publicSpecsService.generateRandomSubdomain();
      setSubdomain(randomSubdomain);
    }
  }, [sharingEnabled, subdomain]);

  // Auto-save subdomain when it changes (debounced)
  useEffect(() => {
    if (!sharingEnabled || !debouncedSubdomain || debouncedSubdomain.length < 3) return;
    
    // Only save if subdomain has actually changed from what's stored
    if (debouncedSubdomain !== collection.publicSharing?.subdomain) {
      const sharing: PublicSharing = {
        enabled: true,
        subdomain: debouncedSubdomain,
        versions: publishedVersions,
        lastPublishedAt: collection.publicSharing?.lastPublishedAt,
      };
      onUpdateCollection({ publicSharing: sharing });
    }
  }, [debouncedSubdomain, sharingEnabled, publishedVersions, collection.publicSharing?.subdomain, collection.publicSharing?.lastPublishedAt, onUpdateCollection]);

  // Check subdomain availability when it changes
  useEffect(() => {
    if (!debouncedSubdomain || debouncedSubdomain.length < 3) {
      setSubdomainCheck(null);
      return;
    }

    const checkSubdomain = async () => {
      setIsCheckingSubdomain(true);
      console.log('[SharingTab] Checking subdomain:', debouncedSubdomain, 'with userId:', userId);
      try {
        const result = await publicSpecsService.checkSubdomain(debouncedSubdomain, userId || undefined);
        console.log('[SharingTab] Subdomain check result:', result);
        setSubdomainCheck(result);
      } catch (err) {
        console.error('Error checking subdomain:', err);
        setSubdomainCheck({ available: true }); // Assume available on error
      } finally {
        setIsCheckingSubdomain(false);
      }
    };

    checkSubdomain();
  }, [debouncedSubdomain, userId]);

  // Load existing versions when subdomain is set
  useEffect(() => {
    if (collection.publicSharing?.subdomain && collection.publicSharing.versions) {
      setPublishedVersions(collection.publicSharing.versions);
    }
  }, [collection.publicSharing?.subdomain, collection.publicSharing?.versions]);

  // Suggest next version based on existing versions
  useEffect(() => {
    if (publishedVersions.length > 0) {
      const latestVersion = publishedVersions[0]?.version;
      if (latestVersion) {
        // Try to increment patch version
        const parts = latestVersion.split('.');
        if (parts.length === 3) {
          const patch = parseInt(parts[2], 10);
          if (!isNaN(patch)) {
            setVersion(`${parts[0]}.${parts[1]}.${patch + 1}`);
          }
        }
      }
    }
  }, [publishedVersions]);

  // Handle toggle sharing
  const handleToggleSharing = useCallback((enabled: boolean) => {
    if (!enabled && publishedVersions.length > 0) {
      // Show confirmation modal if there are published versions
      setDisableModalOpen(true);
    } else {
      setSharingEnabled(enabled);
      
      if (enabled) {
        // Enable sharing
        const sharing: PublicSharing = {
          enabled: true,
          subdomain: subdomain || undefined,
          versions: publishedVersions,
          lastPublishedAt: collection.publicSharing?.lastPublishedAt,
        };
        onUpdateCollection({ publicSharing: sharing });
      } else {
        // No published versions, just disable
        onUpdateCollection({
          publicSharing: {
            enabled: false,
            subdomain: undefined,
            versions: [],
            lastPublishedAt: undefined,
          },
        });
      }
    }
  }, [subdomain, publishedVersions, collection.publicSharing?.lastPublishedAt, onUpdateCollection]);

  // Handle confirmed disable - delete all versions from S3
  const handleConfirmDisable = useCallback(async () => {
    if (!collection.publicSharing?.subdomain) {
      setSharingEnabled(false);
      onUpdateCollection({ publicSharing: { enabled: false } });
      setDisableModalOpen(false);
      return;
    }

    setIsDisabling(true);
    try {
      // Delete all versioned files from S3
      for (const ver of publishedVersions) {
        await publicSpecsService.deleteVersion(collection.publicSharing.subdomain, ver.version);
      }
      
      // Delete root files (openapi.json, index.html, versions.json, manifest.json)
      await publicSpecsService.deleteRootFiles(collection.publicSharing.subdomain);
      
      // Clear local state
      setPublishedVersions([]);
      setSharingEnabled(false);
      setSubdomain('');
      
      onUpdateCollection({
        publicSharing: {
          enabled: false,
          subdomain: undefined,
          versions: [],
          lastPublishedAt: undefined,
        },
      });
      
      success('Sharing Disabled', 'All published versions have been removed');
    } catch (err) {
      console.error('Error disabling sharing:', err);
      showError('Error', 'Failed to delete some versions. Please try again.');
    } finally {
      setIsDisabling(false);
      setDisableModalOpen(false);
    }
  }, [collection.publicSharing, publishedVersions, onUpdateCollection, success, showError]);

  // Handle subdomain change
  const handleSubdomainChange = useCallback((value: string) => {
    // Normalize: lowercase, replace spaces with hyphens, limit to 20 chars
    const normalized = value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').substring(0, 20);
    setSubdomain(normalized);
    setSubdomainCheck(null);
  }, []);

  // Regenerate random subdomain
  const handleRegenerateSubdomain = useCallback(() => {
    const randomSubdomain = publicSpecsService.generateRandomSubdomain();
    // Truncate to 20 chars
    setSubdomain(randomSubdomain.substring(0, 20));
  }, []);

  // Write openapi.json to git repo
  const writeOpenAPIToRepo = useCallback(async (openapiJson: string, ver: string): Promise<boolean> => {
    if (!isElectron() || !activeWorkspace) {
      return true; // Skip in web mode
    }

    try {
      const workspaceName = activeWorkspace.name;
      if (!workspaceName) return false;

      // Use the electron API to write the OpenAPI file in a folder: {collectionId}/{version}/openapi.json
      const electronAPI = window.electronAPI as { writeCollectionOpenAPI?: (w: string, id: string, j: string, v?: string) => Promise<boolean> } | undefined;
      const result = await electronAPI?.writeCollectionOpenAPI?.(
        workspaceName,
        collection.id,
        openapiJson,
        ver
      );
      
      if (result) {
        console.log('[SharingTab] Wrote openapi.json to repo for collection:', collection.id, 'version:', ver);
      }
      
      return result ?? false;
    } catch (err) {
      console.error('Error writing openapi.json to repo:', err);
      return false;
    }
  }, [activeWorkspace, collection.id]);

  // Handle publish
  const handlePublish = useCallback(async () => {
    if (!subdomain || !version) {
      showError('Missing Information', 'Please enter both subdomain and version');
      return;
    }

    // Check if subdomain is available (either free or owned by us)
    if (subdomainCheck && !subdomainCheck.available && !subdomainCheck.owned) {
      showError('Subdomain Unavailable', subdomainCheck.message || 'This subdomain is not available');
      return;
    }

    // DEBUG: Log collection structure before publishing
    console.log('=== PUBLISH DEBUG ===');
    console.log('Collection ID:', collection.id);
    console.log('Collection Name:', collection.name);
    console.log('Root requests count:', collection.requests?.length || 0);
    console.log('Root requests:', JSON.stringify(collection.requests?.map(r => ({
      id: r.id,
      name: r.name,
      method: r.method,
      url: r.url,
    })), null, 2));
    console.log('Folders count:', collection.folders?.length || 0);
    collection.folders?.forEach((f, i) => {
      console.log(`Folder ${i} "${f.name}":`, f.requests?.length || 0, 'requests');
      console.log(`Folder ${i} requests:`, JSON.stringify(f.requests?.map(r => ({
        id: r.id,
        name: r.name,
        method: r.method,
        url: r.url,
      })), null, 2));
    });
    console.log('=== END DEBUG ===');

    setIsPublishing(true);

    try {
      // Check if this is a web-only mode (no Electron API)
      if (!isElectron()) {
        showError('Feature Unavailable', 'Public spec publishing requires the Echolon desktop app');
        return;
      }

      const result = await publicSpecsService.publishCollection(
        collection,
        version,
        subdomain,
        {
          title: collection.name,
          description: collection.description,
          userId: userId || undefined,
        }
      );

      if (result.success) {
        // Update collection with new sharing info
        const updatedSharing = publicSpecsService.updateCollectionPublicSharing(
          collection,
          subdomain,
          version,
          collection.name,
          collection.description
        );
        
        onUpdateCollection({ publicSharing: updatedSharing });
        setPublishedVersions(updatedSharing.versions || []);

        // Write openapi.json to git repo (versioned)
        const openapiJson = exportToOpenAPIJson(collection, { version, pretty: true });
        await writeOpenAPIToRepo(openapiJson, version);

        success(
          'Published Successfully',
          `Your API documentation is now live at https://${subdomain}.api.echolon.app/`
        );
      } else {
        showError('Publish Failed', result.error || 'Unknown error occurred');
      }
    } catch (err) {
      console.error('Error publishing:', err);
      showError('Publish Failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsPublishing(false);
    }
  }, [subdomain, version, subdomainCheck, collection, onUpdateCollection, success, showError, writeOpenAPIToRepo, userId]);

  // Open delete confirmation modal
  const handleDeleteClick = useCallback((ver: string) => {
    setVersionToDelete(ver);
    setDeleteModalOpen(true);
  }, []);

  // Handle confirmed delete version
  const handleConfirmDelete = useCallback(async () => {
    if (!collection.publicSharing?.subdomain || !versionToDelete) return;

    setIsDeleting(true);
    try {
      const deleted = await publicSpecsService.deleteVersion(
        collection.publicSharing.subdomain,
        versionToDelete
      );

      if (deleted) {
        const updatedVersions = publishedVersions.filter(v => v.version !== versionToDelete);
        setPublishedVersions(updatedVersions);
        
        onUpdateCollection({
          publicSharing: {
            ...collection.publicSharing,
            versions: updatedVersions,
          },
        });

        success('Version Deleted', `Version ${versionToDelete} has been removed`);
      } else {
        showError('Delete Failed', 'Could not delete the version');
      }
    } catch (err) {
      console.error('Error deleting version:', err);
      showError('Delete Failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsDeleting(false);
      setDeleteModalOpen(false);
      setVersionToDelete(null);
    }
  }, [collection.publicSharing, versionToDelete, publishedVersions, onUpdateCollection, success, showError]);

  // Copy URL to clipboard
  const handleCopyUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

  // Export as OpenAPI JSON
  const handleExportOpenAPI = useCallback(() => {
    try {
      const openApiJson = exportToOpenAPIJson(collection, { pretty: true });
      const blob = new Blob([openApiJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${collection.name.toLowerCase().replace(/\s+/g, '-')}-openapi.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      success('Export Complete', 'OpenAPI specification downloaded successfully');
    } catch (err) {
      console.error('Error exporting OpenAPI:', err);
      showError('Export Failed', err instanceof Error ? err.message : 'Unknown error');
    }
  }, [collection, success, showError]);

  // Export as Echolon format
  const handleExportEcholon = useCallback(() => {
    try {
      const echolonJson = exportToEcholonJson(collection);
      const blob = new Blob([echolonJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${collection.name.toLowerCase().replace(/\s+/g, '-')}.echolon.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      success('Export Complete', 'Echolon collection downloaded successfully');
    } catch (err) {
      console.error('Error exporting Echolon format:', err);
      showError('Export Failed', err instanceof Error ? err.message : 'Unknown error');
    }
  }, [collection, success, showError]);

  // Format date for display
  const formatPublishedDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Get the public URL for current subdomain
  const getPublicUrl = (ver?: string) => {
    if (!subdomain) return '';
    return ver ? `https://${subdomain}.api.echolon.app/${ver}/` : `https://${subdomain}.api.echolon.app/`;
  };

  // Render subdomain status indicator (inline)
  const renderSubdomainStatus = () => {
    if (!subdomain || subdomain.length < 3) {
      return <span className="sharing-tab__status sharing-tab__status--hint">Min 3 chars</span>;
    }

    if (isCheckingSubdomain) {
      return <span className="sharing-tab__status sharing-tab__status--checking">Checking...</span>;
    }

    if (subdomainCheck) {
      if (subdomainCheck.available) {
        return (
          <span className="sharing-tab__status sharing-tab__status--available">
            <CheckIcon /> Available
          </span>
        );
      } else if (subdomainCheck.owned) {
        return (
          <span className="sharing-tab__status sharing-tab__status--owned">
            <CheckIcon /> Yours
          </span>
        );
      } else {
        return (
          <span className="sharing-tab__status sharing-tab__status--unavailable">
            <AlertIcon /> Taken
          </span>
        );
      }
    }

    return null;
  };

  // Check if we can publish
  const canPublish = useMemo(() => {
    if (!sharingEnabled || !subdomain || !version) return false;
    if (subdomain.length < 3) return false;
    if (isCheckingSubdomain) return false;
    // Allow if available OR if owned by us
    if (subdomainCheck && !subdomainCheck.available && !subdomainCheck.owned) {
      return false;
    }
    return true;
  }, [sharingEnabled, subdomain, version, isCheckingSubdomain, subdomainCheck]);

  return (
    <div className="sharing-tab">
      <div className="sharing-tab__header">
        <h3>Export &amp; Share</h3>
        <p className="sharing-tab__description">
          Export your collection or share it publicly
        </p>
      </div>

      {/* Option Cards */}
      <div className="sharing-tab__options">
        {/* Public URL */}
        <button
          className={`sharing-tab__option-card ${selectedOption === 'public' ? 'sharing-tab__option-card--selected' : ''}`}
          onClick={() => setSelectedOption(selectedOption === 'public' ? null : 'public')}
          type="button"
        >
          <div className="sharing-tab__option-icon sharing-tab__option-icon--public">
            <GlobeIcon />
          </div>
          <div className="sharing-tab__option-content">
            <h4>Share via Public URL</h4>
            <p>Host at api.echolon.app</p>
          </div>
          {isPublicActive && (
            <span className="sharing-tab__option-badge">Active</span>
          )}
        </button>

        {/* OpenAPI Export */}
        <button
          className={`sharing-tab__option-card ${selectedOption === 'openapi' ? 'sharing-tab__option-card--selected' : ''}`}
          onClick={() => setSelectedOption(selectedOption === 'openapi' ? null : 'openapi')}
          type="button"
        >
          <div className="sharing-tab__option-icon">
            <FileIcon />
          </div>
          <div className="sharing-tab__option-content">
            <h4>Export as OpenAPI</h4>
            <p>Download as OpenAPI 3.0 spec</p>
          </div>
        </button>

        {/* Echolon Export */}
        <button
          className={`sharing-tab__option-card ${selectedOption === 'echolon' ? 'sharing-tab__option-card--selected' : ''}`}
          onClick={() => setSelectedOption(selectedOption === 'echolon' ? null : 'echolon')}
          type="button"
        >
          <div className="sharing-tab__option-icon sharing-tab__option-icon--echolon">
            <DownloadIcon />
          </div>
          <div className="sharing-tab__option-content">
            <h4>Export as Echolon</h4>
            <p>Download in Echolon format</p>
          </div>
        </button>
      </div>

      {/* OpenAPI Export Panel */}
      {selectedOption === 'openapi' && (
        <div className="sharing-tab__panel">
          <p className="sharing-tab__panel-description">
            Export your collection as an OpenAPI 3.0 specification file. This format is widely supported by API tools and documentation generators.
          </p>
          <Button variant="primary" onClick={handleExportOpenAPI}>
            <DownloadIcon />
            Download OpenAPI JSON
          </Button>
        </div>
      )}

      {/* Echolon Export Panel */}
      {selectedOption === 'echolon' && (
        <div className="sharing-tab__panel">
          <p className="sharing-tab__panel-description">
            Export your collection in Echolon's native format. This preserves all Echolon-specific features and can be imported back into Echolon.
          </p>
          <Button variant="primary" onClick={handleExportEcholon}>
            <DownloadIcon />
            Download Echolon JSON
          </Button>
        </div>
      )}

      {/* Public Sharing Panel */}
      {selectedOption === 'public' && (
        <div className="sharing-tab__panel">
          <div className="sharing-tab__panel-header">
            <PremiumBadge 
              modalTitle="Premium Feature - Free During Beta"
              modalDescription="Public sharing allows you to host your API documentation at a custom subdomain. This feature will require a premium subscription in the future, but it's completely free while Echolon is in beta!"
            />
          </div>

          {/* Enable/Disable Toggle */}
          <div className="sharing-tab__toggle-row">
            <Switch
              checked={sharingEnabled}
              onChange={handleToggleSharing}
              label="Enable public sharing"
            />
          </div>

          {sharingEnabled && (
            <>
              {/* Subdomain + Version + Publish - Inline Layout */}
              <div className="sharing-tab__inline-form">
                <div className="sharing-tab__form-row">
                  {/* Subdomain */}
                  <div className="sharing-tab__field sharing-tab__field--subdomain">
                    <label className="sharing-tab__label">Subdomain</label>
                    <div className="sharing-tab__subdomain-row">
                      <Input
                        value={subdomain}
                        onChange={(e) => handleSubdomainChange(e.target.value)}
                        placeholder="my-api"
                        maxLength={20}
                        className="sharing-tab__input sharing-tab__input--small"
                      />
                      <span className="sharing-tab__subdomain-suffix">.api.echolon.app</span>
                      <Tooltip content="Generate random">
                        <button
                          className="sharing-tab__regenerate-btn"
                          onClick={handleRegenerateSubdomain}
                          type="button"
                        >
                          <RefreshIcon />
                        </button>
                      </Tooltip>
                      {renderSubdomainStatus()}
                    </div>
                  </div>

                  {/* Version */}
                  <div className="sharing-tab__field sharing-tab__field--version">
                    <label className="sharing-tab__label">Version</label>
                    <Input
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                      placeholder="1.0.0"
                      className="sharing-tab__input sharing-tab__input--small"
                    />
                  </div>

                  {/* Publish Button */}
                  <div className="sharing-tab__field sharing-tab__field--action">
                    <label className="sharing-tab__label">&nbsp;</label>
                    <Button
                      variant="primary"
                      onClick={handlePublish}
                      disabled={!canPublish || isPublishing}
                      className="sharing-tab__publish-btn"
                    >
                      {isPublishing ? (
                        <span className="sharing-tab__spinner"><RefreshIcon /></span>
                      ) : (
                        'Publish'
                      )}
                    </Button>
                  </div>
                </div>

                {subdomain && subdomain.length >= 3 && (
                  <div className="sharing-tab__preview-section">
                    <div className="sharing-tab__preview">
                      <span className="sharing-tab__preview-label">URL:</span>
                      <code className="sharing-tab__preview-url">{getPublicUrl()}</code>
                      <Tooltip content="Copy URL">
                        <button 
                          className="sharing-tab__copy-btn"
                          onClick={() => handleCopyUrl(getPublicUrl())}
                          type="button"
                        >
                          {copiedUrl === getPublicUrl() ? <CheckIcon /> : <CopyIcon />}
                        </button>
                      </Tooltip>
                    </div>
                    <div className="sharing-tab__spec-links">
                      <a 
                        href={publicSpecsService.getOpenAPIUrl(subdomain)} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="sharing-tab__spec-link"
                      >
                        <code>openapi.json</code>
                      </a>
                      <span className="sharing-tab__spec-link-separator">•</span>
                      <a 
                        href={publicSpecsService.getEcholonUrl(subdomain)} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="sharing-tab__spec-link"
                      >
                        <code>echolon.json</code>
                      </a>
                    </div>
                  </div>
                )}
              </div>

              {/* Published Versions */}
              {publishedVersions.length > 0 && (
                <div className="sharing-tab__versions">
                  <h4 className="sharing-tab__section-title">Published Versions</h4>
                  <div className="sharing-tab__versions-list">
                    {publishedVersions.map((v) => (
                      <div key={v.version} className="sharing-tab__version-item">
                        <div className="sharing-tab__version-info">
                          <span className="sharing-tab__version-number">{v.version}</span>
                          <span className="sharing-tab__version-date">
                            {formatPublishedDate(v.publishedAt)}
                          </span>
                        </div>
                        <div className="sharing-tab__version-actions">
                          <Tooltip content={copiedUrl === getPublicUrl(v.version) ? 'Copied!' : 'Copy URL'}>
                            <button
                              className="sharing-tab__icon-btn"
                              onClick={() => handleCopyUrl(getPublicUrl(v.version))}
                              type="button"
                            >
                              {copiedUrl === getPublicUrl(v.version) ? <CheckIcon /> : <CopyIcon />}
                            </button>
                          </Tooltip>
                          <Tooltip content="Open in browser">
                            <a
                              className="sharing-tab__icon-btn"
                              href={getPublicUrl(v.version)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <LinkIcon />
                            </a>
                          </Tooltip>
                          <Tooltip content="Delete version">
                            <button
                              className="sharing-tab__icon-btn sharing-tab__icon-btn--danger"
                              onClick={() => handleDeleteClick(v.version)}
                              type="button"
                            >
                              <TrashIcon />
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Disable Sharing Confirmation Modal */}
      <Modal
        isOpen={disableModalOpen}
        onClose={() => setDisableModalOpen(false)}
        title="Disable Public Sharing"
        size="sm"
      >
        <div className="sharing-tab__delete-modal">
          <p>
            Are you sure you want to disable public sharing?
          </p>
          <p className="sharing-tab__delete-modal-warning">
            This will delete all {publishedVersions.length} published version{publishedVersions.length !== 1 ? 's' : ''} from <strong>{subdomain}.api.echolon.app</strong>. This action cannot be undone.
          </p>
          <div className="sharing-tab__delete-modal-actions">
            <Button
              variant="secondary"
              onClick={() => setDisableModalOpen(false)}
              disabled={isDisabling}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleConfirmDisable}
              loading={isDisabling}
            >
              Disable &amp; Delete All
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Version Confirmation Modal */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setVersionToDelete(null);
        }}
        title="Delete Published Version"
        size="sm"
      >
        <div className="sharing-tab__delete-modal">
          <p>
            Are you sure you want to delete version <strong>{versionToDelete}</strong>?
          </p>
          <p className="sharing-tab__delete-modal-warning">
            This will remove the published API documentation from the public URL. This action cannot be undone.
          </p>
          <div className="sharing-tab__delete-modal-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setDeleteModalOpen(false);
                setVersionToDelete(null);
              }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleConfirmDelete}
              loading={isDeleting}
            >
              Delete Version
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default SharingTab;
