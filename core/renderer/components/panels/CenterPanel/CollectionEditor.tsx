import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { EditableTable, Input, Dropdown, Button, Modal, DiffViewer, Switch, Tooltip, CodeEditor, ColorEmojiPicker } from '@/components/ui';
import { useCollections, useRequest, useApp, useEnvironments, useTheme, useToast } from '@/contexts';
import { 
  RadarIcon, GlobeIcon, PlusIcon, FolderIcon, TrashIcon, AlertIcon, 
  RefreshIcon, LinkIcon, SendIcon, ChevronDownIcon, ChevronRightIcon,
  ExpandAllIcon, CollapseAllIcon 
} from '@/components/ui/icons';
import { KeyValuePair, AuthConfig, SpecChange, PendingSpecChanges, Folder, CollectionEnvironment, Request, RequestExecution, HttpMethod } from '@/types';
import { specDiffer, requestService, storageManager } from '@/services';
import { SYNC_FREQUENCY_OPTIONS, HTTP_METHODS, METHOD_COLORS, DEFAULT_HEADERS } from '../../../../shared/constants';
import { v4 as uuidv4 } from 'uuid';

import { ResponseViewer } from './ResponseViewer';
import { extractSpecResponseInfo } from '@/utils/specResponseExtractor';
import './CollectionEditor.css';

const CUSTOM_METHOD_COLOR = '#9ca3af';

const getMethodColor = (method: string): string => {
  return METHOD_COLORS[method] || CUSTOM_METHOD_COLOR;
};

// Request Item Component for Reference View
interface RequestItemProps {
  request: Request;
  collection: {
    id: string;
    name: string;
    auth?: AuthConfig;
    headers?: KeyValuePair[];
    environments?: CollectionEnvironment[];
    defaultEnvironmentId?: string;
    specSource?: { rawSpec?: string };
  };
  onUpdateRequest: (requestId: string, updates: Partial<Request>) => void;
  folderPath?: string;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  index?: number;
  hideExpandButton?: boolean;
}

const RequestItem: React.FC<RequestItemProps> = ({ request, collection, onUpdateRequest, folderPath, isExpanded: controlledExpanded, onToggleExpand, index, hideExpandButton }) => {
  const { resolvedTheme } = useTheme();
  const { activeEnvironment } = useEnvironments();
  const { customHttpMethods, addCustomHttpMethod, logToConsole } = useApp();
  const [internalExpanded, setInternalExpanded] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);
  
  // Use controlled state if provided, otherwise use internal state
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const setIsExpanded = onToggleExpand || (() => setInternalExpanded(!internalExpanded));
  const [isLoading, setIsLoading] = useState(false);
  const [execution, setExecution] = useState<RequestExecution | null>(null);
  const [activeRequestTab, setActiveRequestTab] = useState<'params' | 'headers' | 'body' | 'auth'>('params');

  // Extract spec response info for example/schema display
  const specResponseInfo = useMemo(() => {
    const rawSpec = collection?.specSource?.rawSpec;
    if (!rawSpec) return null;
    return extractSpecResponseInfo(rawSpec, request.url, request.method);
  }, [collection?.specSource?.rawSpec, request.url, request.method]);

  const selectedCollectionEnv = useMemo(() => {
    if (!collection?.environments || !collection.defaultEnvironmentId) {
      return null;
    }
    return collection.environments.find(e => e.id === collection.defaultEnvironmentId) || null;
  }, [collection]);

  const collectionHeaders = collection?.headers?.filter(h => h.enabled && h.key) || [];

  const methodOptions = useMemo(() => {
    const standardMethods = HTTP_METHODS.map(method => ({
      value: method,
      label: method,
      color: METHOD_COLORS[method],
    }));
    
    const customMethods = customHttpMethods
      .filter(method => !HTTP_METHODS.includes(method as typeof HTTP_METHODS[number]))
      .map(method => ({
        value: method,
        label: method,
        color: CUSTOM_METHOD_COLOR,
      }));
    
    return [...standardMethods, ...customMethods];
  }, [customHttpMethods]);

  const handleMethodChange = (method: string) => {
    const upperMethod = method.toUpperCase();
    onUpdateRequest(request.id, { method: upperMethod as HttpMethod });
    
    if (!HTTP_METHODS.includes(upperMethod as typeof HTTP_METHODS[number])) {
      addCustomHttpMethod(upperMethod);
    }
  };

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdateRequest(request.id, { url: e.target.value });
  };

  const handleQueryParamsChange = (params: KeyValuePair[]) => {
    // Build new URL with the params
    let url = request.url;
    const questionMarkIndex = url.indexOf('?');
    if (questionMarkIndex !== -1) {
      url = url.substring(0, questionMarkIndex);
    }

    const enabledParams = params.filter(p => p.enabled && p.key);
    if (enabledParams.length > 0) {
      const searchParams = new URLSearchParams();
      enabledParams.forEach(p => {
        searchParams.append(p.key, p.value);
      });
      url = `${url}?${searchParams.toString()}`;
    }

    onUpdateRequest(request.id, { queryParams: params, url });
  };

  const handleHeadersChange = (allHeaders: KeyValuePair[]) => {
    const requestHeaders = allHeaders.filter(h => !h.inheritedFrom);
    onUpdateRequest(request.id, { headers: requestHeaders });
  };

  const handleBodyChange = (content: string) => {
    onUpdateRequest(request.id, { body: { ...request.body, content } });
  };

  const handleSend = async () => {
    setIsLoading(true);
    setExecution(null);

    try {
      const settings = storageManager.getSettings();
      const result = await requestService.execute(
        request,
        activeEnvironment,
        settings.requestTimeout,
        collection as any,
        settings,
        selectedCollectionEnv
      );
      setExecution(result);
      logToConsole('success', `${request.method} ${request.url} - ${result.response?.status || 'Error'}`);
    } catch (error) {
      logToConsole('error', `Request failed: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="reference-request-item" ref={itemRef}>
      {/* Sticky Header with Name and URL */}
      <div className="reference-request-item__sticky-header">
        <div className="reference-request-item__name-row">
          {!hideExpandButton && (
            <button 
              className="reference-request-item__expand-btn"
              onClick={() => setIsExpanded()}
            >
              {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
            </button>
          )}
          <span 
            className="reference-request-item__method-badge"
            style={{ color: getMethodColor(request.method) }}
          >
            {request.method}
          </span>
          <span className="reference-request-item__name">{request.name}</span>
          {folderPath && (
            <span className="reference-request-item__folder-path">{folderPath}</span>
          )}
        </div>
        <div className="reference-request-item__url-bar">
          <Dropdown
            options={methodOptions}
            value={request.method}
            onChange={handleMethodChange}
            size="sm"
            className="reference-request-item__method-dropdown"
            allowCustom
            customPlaceholder="Custom..."
            customColor="#9ca3af"
          />
          <Input
            value={request.url}
            onChange={handleUrlChange}
            placeholder="Enter request URL"
            supportVariables
            collectionEnvironment={selectedCollectionEnv}
            className="reference-request-item__url-input"
            size="sm"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={handleSend}
            loading={isLoading}
            icon={<SendIcon />}
            className="reference-request-item__send-btn"
          >
            Send
          </Button>
        </div>
      </div>

      {/* Expandable Content */}
      {isExpanded && (
        <div className="reference-request-item__content">
          {/* Request Options Tabs */}
          <div className="reference-request-item__tabs">
            <button
              className={`reference-request-item__tab ${activeRequestTab === 'params' ? 'active' : ''}`}
              onClick={() => setActiveRequestTab('params')}
            >
              Params
              {request.queryParams.filter(p => p.key).length > 0 && (
                <span className="reference-request-item__tab-badge">
                  {request.queryParams.filter(p => p.key).length}
                </span>
              )}
            </button>
            <button
              className={`reference-request-item__tab ${activeRequestTab === 'headers' ? 'active' : ''}`}
              onClick={() => setActiveRequestTab('headers')}
            >
              Headers
              {request.headers.filter(h => h.key).length > 0 && (
                <span className="reference-request-item__tab-badge">
                  {request.headers.filter(h => h.key).length}
                </span>
              )}
            </button>
            <button
              className={`reference-request-item__tab ${activeRequestTab === 'body' ? 'active' : ''}`}
              onClick={() => setActiveRequestTab('body')}
            >
              Body
            </button>
            <button
              className={`reference-request-item__tab ${activeRequestTab === 'auth' ? 'active' : ''}`}
              onClick={() => setActiveRequestTab('auth')}
            >
              Auth
              {request.auth.type !== 'none' && (
                <span className="reference-request-item__tab-indicator" />
              )}
            </button>
          </div>

          {/* Tab Content */}
          <div className="reference-request-item__tab-content">
            {activeRequestTab === 'params' && (
              <EditableTable
                data={request.queryParams.length === 0 
                  ? [{ id: uuidv4(), key: '', value: '', enabled: true }] 
                  : request.queryParams
                }
                onChange={handleQueryParamsChange}
                keyPlaceholder="Key"
                valuePlaceholder="Value"
                descriptionPlaceholder="Description"
                collectionEnvironment={selectedCollectionEnv}
              />
            )}

            {activeRequestTab === 'headers' && (
              <EditableTable
                data={[
                  ...collectionHeaders.map(h => ({
                    ...h,
                    inheritedFrom: collection?.name,
                  })),
                  ...(request.headers.length === 0 
                    ? [{ id: uuidv4(), key: '', value: '', enabled: true }] 
                    : request.headers),
                ]}
                onChange={handleHeadersChange}
                keyPlaceholder="Header"
                valuePlaceholder="Value"
                descriptionPlaceholder="Description"
                keySuggestions={DEFAULT_HEADERS}
                collectionEnvironment={selectedCollectionEnv}
              />
            )}

            {activeRequestTab === 'body' && (
              <div className="reference-request-item__body">
                <div className="reference-request-item__body-type">
                  <Dropdown
                    options={[
                      { value: 'none', label: 'none' },
                      { value: 'json', label: 'JSON' },
                      { value: 'form-data', label: 'form-data' },
                      { value: 'x-www-form-urlencoded', label: 'x-www-form-urlencoded' },
                      { value: 'raw', label: 'raw' },
                    ]}
                    value={request.body.type}
                    onChange={(type) => {
                      onUpdateRequest(request.id, {
                        body: { 
                          ...request.body, 
                          type: type as 'none' | 'json' | 'form-data' | 'x-www-form-urlencoded' | 'raw'
                        },
                      });
                    }}
                  />
                </div>

            

                {request.body.type !== 'none' && request.body.type !== 'form-data' && request.body.type !== 'x-www-form-urlencoded' && (
                  <div className="reference-request-item__body-editor" style={{ marginBottom: '24px' }}>
                   
                   <CodeEditor
                    mode={request.body.type === 'json' ? 'json' : 'text'}
                    value={request.body.content}
                    onChange={handleBodyChange}
                    placeholder={request.body.type === 'json' ? '{\n  "key": "value"\n}' : 'Enter request body'}
                    width="100%"
                    height="550px"
                    fontSize={12}
                  />
                    {/*<AceEditor
                      mode={request.body.type === 'json' ? 'json' : 'text'}
                      theme={resolvedTheme === 'dark' ? 'one_dark' : 'chrome'}
                      value={request.body.content}
                      onChange={handleBodyChange}
                      placeholder={request.body.type === 'json' ? '{\n  "key": "value"\n}' : 'Enter request body'}
                      width="100%"
                      height="550px"
                      fontSize={12}
                      showPrintMargin={false}
                      showGutter={true}
                      highlightActiveLine={true}
                      setOptions={{
                        showLineNumbers: true,
                        tabSize: 2,
                        useWorker: false,
                      }}
                    />*/}
                  </div>
                )}

                {(request.body.type === 'form-data' || request.body.type === 'x-www-form-urlencoded') && (
                  <EditableTable
                    data={request.body.formData?.length 
                      ? request.body.formData 
                      : [{ id: uuidv4(), key: '', value: '', enabled: true }]
                    }
                    onChange={(formData) => {
                      onUpdateRequest(request.id, {
                        body: { ...request.body, formData },
                      });
                    }}
                    keyPlaceholder="Key"
                    valuePlaceholder="Value"
                    showDescription={false}
                    collectionEnvironment={selectedCollectionEnv}
                  />
                )}
              </div>
            )}

            {activeRequestTab === 'auth' && (
              <div className="reference-request-item__auth">
                <div className="reference-request-item__auth-type">
                  <label>Type</label>
                  <Dropdown
                    options={[
                      { value: 'none', label: collection?.auth && collection.auth.type !== 'none' ? 'Inherit from Collection' : 'No Auth' },
                      { value: 'basic', label: 'Basic Auth' },
                      { value: 'bearer', label: 'Bearer Token' },
                      { value: 'api-key', label: 'API Key' },
                    ]}
                    value={request.auth.type}
                    onChange={(type) => {
                      onUpdateRequest(request.id, { 
                        auth: { ...request.auth, type: type as 'none' | 'basic' | 'bearer' | 'api-key' } 
                      });
                    }}
                  />
                </div>

                {request.auth.type === 'basic' && (
                  <div className="reference-request-item__auth-fields">
                    <div className="reference-request-item__auth-field">
                      <label>Username</label>
                      <Input
                        value={request.auth.basic?.username || ''}
                        onChange={(e) => {
                          onUpdateRequest(request.id, {
                            auth: {
                              ...request.auth,
                              basic: { ...request.auth.basic, username: e.target.value, password: request.auth.basic?.password || '' },
                            },
                          });
                        }}
                        supportVariables
                        size="sm"
                      />
                    </div>
                    <div className="reference-request-item__auth-field">
                      <label>Password</label>
                      <Input
                        type="password"
                        value={request.auth.basic?.password || ''}
                        onChange={(e) => {
                          onUpdateRequest(request.id, {
                            auth: {
                              ...request.auth,
                              basic: { ...request.auth.basic, username: request.auth.basic?.username || '', password: e.target.value },
                            },
                          });
                        }}
                        supportVariables
                        size="sm"
                      />
                    </div>
                  </div>
                )}

                {request.auth.type === 'bearer' && (
                  <div className="reference-request-item__auth-fields">
                    <div className="reference-request-item__auth-field">
                      <label>Token</label>
                      <Input
                        value={request.auth.bearer?.token || ''}
                        onChange={(e) => {
                          onUpdateRequest(request.id, {
                            auth: {
                              ...request.auth,
                              bearer: { token: e.target.value },
                            },
                          });
                        }}
                        supportVariables
                        size="sm"
                      />
                    </div>
                  </div>
                )}

                {request.auth.type === 'api-key' && (
                  <div className="reference-request-item__auth-fields">
                    <div className="reference-request-item__auth-field">
                      <label>Key</label>
                      <Input
                        value={request.auth.apiKey?.key || ''}
                        onChange={(e) => {
                          onUpdateRequest(request.id, {
                            auth: {
                              ...request.auth,
                              apiKey: { 
                                ...request.auth.apiKey, 
                                key: e.target.value,
                                value: request.auth.apiKey?.value || '',
                                addTo: request.auth.apiKey?.addTo || 'header'
                              },
                            },
                          });
                        }}
                        supportVariables
                        size="sm"
                      />
                    </div>
                    <div className="reference-request-item__auth-field">
                      <label>Value</label>
                      <Input
                        value={request.auth.apiKey?.value || ''}
                        onChange={(e) => {
                          onUpdateRequest(request.id, {
                            auth: {
                              ...request.auth,
                              apiKey: { 
                                ...request.auth.apiKey, 
                                key: request.auth.apiKey?.key || '',
                                value: e.target.value,
                                addTo: request.auth.apiKey?.addTo || 'header'
                              },
                            },
                          });
                        }}
                        supportVariables
                        size="sm"
                      />
                    </div>
                    <div className="reference-request-item__auth-field">
                      <label>Add to</label>
                      <Dropdown
                        options={[
                          { value: 'header', label: 'Header' },
                          { value: 'query', label: 'Query Params' },
                        ]}
                        value={request.auth.apiKey?.addTo || 'header'}
                        onChange={(addTo) => {
                          onUpdateRequest(request.id, {
                            auth: {
                              ...request.auth,
                              apiKey: { 
                                ...request.auth.apiKey,
                                key: request.auth.apiKey?.key || '',
                                value: request.auth.apiKey?.value || '',
                                addTo: addTo as 'header' | 'query'
                              },
                            },
                          });
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Response Viewer - always show if spec has example/schema */}
          {(execution || specResponseInfo) && (
            <div className="reference-request-item__response">
              {<ResponseViewer 
                execution={execution}
                isLoading={isLoading}
                height={500}
                specResponseInfo={specResponseInfo || undefined}
              />}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

type CollectionTab = 'reference' | 'overview' | 'environments' | 'headers' | 'auth' | 'sync';

interface CollectionEditorProps {
  collectionId: string;
}

export const CollectionEditor: React.FC<CollectionEditorProps> = ({ collectionId }) => {
  const { 
    collections, 
    updateCollection, 
    deleteCollection,
    updateRequest,
    updateFolder,
    collapseAllFolders,
    expandAllFolders,
    addCollectionEnvironment,
    updateCollectionEnvironment,
    deleteCollectionEnvironment,
    toggleCollectionEnvironmentActive,
  } = useCollections();
  const { updateTab, activeTabId, closeTab, tabs } = useRequest();
  const { logToConsole } = useApp();
  const { environments } = useEnvironments();
  const { success, warning, error: showError } = useToast();
  
  // Get the current tab
  const currentTab = tabs.find(t => t.id === activeTabId);
  
  // Initialize sub-tab from persisted state or default to 'reference'
  const [activeTab, setActiveTabState] = useState<CollectionTab>(() => {
    const savedSubTab = currentTab?.subTab as CollectionTab;
    const validTabs: CollectionTab[] = ['reference', 'overview', 'environments', 'headers', 'auth', 'sync'];
    if (savedSubTab && validTabs.includes(savedSubTab)) {
      return savedSubTab;
    }
    return 'reference';
  });
  
  // Wrapper to persist sub-tab changes
  const setActiveTab = useCallback((tab: CollectionTab) => {
    setActiveTabState(tab);
    // Persist to the tab object
    if (activeTabId) {
      updateTab(activeTabId, { subTab: tab });
    }
  }, [activeTabId, updateTab]);
  
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<PendingSpecChanges | null>(null);
  const [showNewEnvModal, setShowNewEnvModal] = useState(false);
  const [newEnvName, setNewEnvName] = useState('');
  const [expandedRequestIds, setExpandedRequestIds] = useState<Set<string>>(new Set());
  
  // Reference content ref for scroll tracking
  const reference2ContentRef = useRef<HTMLDivElement>(null);
  
  // Track active section for scroll sync (folder and request)
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  
  // Track which sections are visible in the viewport (for virtualization)
  const [visibleSectionIds, setVisibleSectionIds] = useState<Set<string>>(new Set());
  const sectionObserverRef = useRef<IntersectionObserver | null>(null);
  
  const collection = collections.find(c => c.id === collectionId);
  const hasUrlSource = collection?.specSource?.type === 'url' && collection?.specSource.url;
  
  // Handle initialSubTab navigation (for when opening from external navigation)
  useEffect(() => {
    if (currentTab?.initialSubTab) {
      const validTabs: CollectionTab[] = ['overview', 'environments', 'headers', 'auth', 'sync'];
      if (validTabs.includes(currentTab.initialSubTab as CollectionTab)) {
        setActiveTab(currentTab.initialSubTab as CollectionTab);
        // Clear the initialSubTab after navigating
        if (activeTabId) {
          updateTab(activeTabId, { initialSubTab: undefined });
        }
      }
    }
  }, [currentTab?.initialSubTab, activeTabId, updateTab, setActiveTab]);
  
  // Reset pending changes when collection changes
  useEffect(() => {
    setPendingChanges(null);
  }, [collectionId]);

  // Helper to get all request IDs recursively
  const getAllRequestIds = useCallback((requests: Request[], folders: Folder[]): string[] => {
    const ids: string[] = [];
    requests.forEach(r => ids.push(r.id));
    folders.forEach(folder => {
      folder.requests.forEach(r => ids.push(r.id));
      ids.push(...getAllRequestIds([], folder.folders));
    });
    return ids;
  }, []);

  // Expand all requests by default when collection changes
  useEffect(() => {
    if (collection) {
      const allIds = getAllRequestIds(collection.requests, collection.folders);
      setExpandedRequestIds(new Set(allIds));
    }
  }, [collectionId, collection, getAllRequestIds]);

  const markDirty = useCallback(() => {
    if (activeTabId) {
      updateTab(activeTabId, { isDirty: true });
    }
  }, [activeTabId, updateTab]);

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    updateCollection(collectionId, { name: newName });
    if (activeTabId) {
      updateTab(activeTabId, { title: newName, isDirty: true });
    }
  }, [collectionId, updateCollection, updateTab, activeTabId]);

  const handleDescriptionChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateCollection(collectionId, { description: e.target.value });
    markDirty();
  }, [collectionId, updateCollection, markDirty]);

  const handleDefaultEnvironmentChange = useCallback((value: string) => {
    updateCollection(collectionId, { defaultEnvironmentId: value === 'none' ? undefined : value });
    markDirty();
  }, [collectionId, updateCollection, markDirty]);

  const handleHeadersChange = useCallback((headers: KeyValuePair[]) => {
    updateCollection(collectionId, { headers });
    markDirty();
  }, [collectionId, updateCollection, markDirty]);

  const handleAuthTypeChange = useCallback((type: string) => {
    if (!collection) return;
    const newAuth: AuthConfig = { 
      ...collection.auth, 
      type: type as AuthConfig['type'] 
    };
    updateCollection(collectionId, { auth: newAuth });
    markDirty();
  }, [collectionId, collection, updateCollection, markDirty]);

  const handleAuthUpdate = useCallback((updates: Partial<AuthConfig>) => {
    if (!collection) return;
    const newAuth: AuthConfig = { 
      type: collection.auth?.type || 'none',
      ...collection.auth, 
      ...updates 
    };
    updateCollection(collectionId, { auth: newAuth });
    markDirty();
  }, [collectionId, collection, updateCollection, markDirty]);

  const handleSyncFrequencyChange = useCallback((value: string) => {
    if (!collection?.specSource) return;
    updateCollection(collectionId, {
      specSource: {
        ...collection.specSource,
        syncFrequencyMins: parseInt(value, 10),
      },
    });
  }, [collectionId, collection, updateCollection]);

  // Collection environment handlers
  const handleCreateEnvironment = useCallback(() => {
    if (!newEnvName.trim()) return;
    addCollectionEnvironment(collectionId, newEnvName.trim());
    setNewEnvName('');
    setShowNewEnvModal(false);
    markDirty();
  }, [collectionId, newEnvName, addCollectionEnvironment, markDirty]);

  const handleEnvironmentVariablesChange = useCallback((envId: string, variables: KeyValuePair[]) => {
    updateCollectionEnvironment(collectionId, envId, { variables });
    markDirty();
  }, [collectionId, updateCollectionEnvironment, markDirty]);

  const handleToggleEnvironmentActive = useCallback((envId: string) => {
    toggleCollectionEnvironmentActive(collectionId, envId);
    markDirty();
  }, [collectionId, toggleCollectionEnvironmentActive, markDirty]);

  const handleDeleteEnvironment = useCallback((envId: string) => {
    deleteCollectionEnvironment(collectionId, envId);
    markDirty();
  }, [collectionId, deleteCollectionEnvironment, markDirty]);

  const handleEnvironmentNameChange = useCallback((envId: string, name: string) => {
    updateCollectionEnvironment(collectionId, envId, { name });
    markDirty();
  }, [collectionId, updateCollectionEnvironment, markDirty]);

  const handleEnvironmentColorEmojiChange = useCallback((envId: string, updates: { color?: string; emoji?: string }) => {
    updateCollectionEnvironment(collectionId, envId, updates);
    markDirty();
  }, [collectionId, updateCollectionEnvironment, markDirty]);

  const handleCheckForUpdates = useCallback(async () => {
    if (!collection?.specSource?.url) {
      showError('Cannot check for updates', 'Collection has no source URL configured');
      return;
    }
    
    if (!collection.specSource.rawSpec) {
      showError('Cannot check for updates', 'Collection is missing the original spec data. Try re-importing the collection from the URL.');
      return;
    }

    setIsChecking(true);
    setPendingChanges(null);

    try {
      // Check if electronAPI is available
      if (!window.electronAPI?.fetchUrlContent) {
        throw new Error('URL fetching is not available in this environment');
      }
      
      const result = await window.electronAPI.fetchUrlContent(collection.specSource.url);
      
      if (!result?.success || !result.content) {
        throw new Error(result?.error || 'Failed to fetch URL');
      }

      // Check if the spec is different
      if (specDiffer.areSpecsEqual(collection.specSource.rawSpec, result.content)) {
        logToConsole('info', 'No changes detected - collection is up to date');
        success('Collection is up to date', 'No changes detected from remote spec');
        // Update last synced timestamp
        updateCollection(collectionId, {
          specSource: {
            ...collection.specSource,
            lastSyncedAt: Date.now(),
          },
        });
      } else {
        // Create pending changes
        const diffResult = specDiffer.compareSpecs(collection.specSource.rawSpec, result.content);
        const changes = specDiffer.createPendingChanges(collectionId, diffResult, result.content);
        setPendingChanges(changes);
        logToConsole('info', `Found ${changes.changes.length} change(s) in remote spec`);
        warning(`${changes.changes.length} change${changes.changes.length !== 1 ? 's' : ''} detected`, 'Review the changes below');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to check for updates';
      logToConsole('error', message);
      showError('Check failed', message);
    } finally {
      setIsChecking(false);
    }
  }, [collection, collectionId, logToConsole, updateCollection, success, warning, showError]);

  const handleSelectionChange = useCallback((changes: SpecChange[]) => {
    if (pendingChanges) {
      setPendingChanges({ ...pendingChanges, changes });
    }
  }, [pendingChanges]);

  const handleApplyChanges = useCallback(async (selectedIds: string[]) => {
    if (!pendingChanges || !collection?.specSource?.rawSpec) return;

    setIsApplying(true);

    try {
      const updatedCollection = specDiffer.applyChanges(collection, pendingChanges, selectedIds);
      
      // Get the selected changes
      const selectedChanges = pendingChanges.changes.filter(c => selectedIds.includes(c.id));
      
      // Merge rawSpec on a per-route basis:
      // - Routes with applied changes: updated to match new remote spec
      // - Routes without applied changes: keep old rawSpec values
      const mergedRawSpec = specDiffer.mergeSpecForSelectedChanges(
        collection.specSource.rawSpec,
        pendingChanges.newRawSpec,
        selectedChanges
      );
      
        updatedCollection.specSource = {
          ...collection.specSource,
        rawSpec: mergedRawSpec,
          lastSyncedAt: Date.now(),
        };

      await updateCollection(collectionId, updatedCollection);
      setPendingChanges(null);
      logToConsole('success', `Applied ${selectedIds.length} change(s) to collection`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to apply changes';
      logToConsole('error', message);
    } finally {
      setIsApplying(false);
    }
  }, [collection, pendingChanges, collectionId, updateCollection, logToConsole]);

  const handleApplySelected = useCallback(() => {
    if (!pendingChanges) return;
    const selectedIds = pendingChanges.changes.filter(c => c.selected).map(c => c.id);
    handleApplyChanges(selectedIds);
  }, [pendingChanges, handleApplyChanges]);

  const handleApplyAll = useCallback(() => {
    if (!pendingChanges) return;
    const allIds = pendingChanges.changes.map(c => c.id);
    handleApplyChanges(allIds);
  }, [pendingChanges, handleApplyChanges]);

  const handleDelete = useCallback(() => {
    // Close the current collection tab
    if (activeTabId) {
      closeTab(activeTabId);
    }
    // Close any tabs that belong to requests in this collection
    tabs.forEach(tab => {
      if (tab.request?.collectionId === collectionId) {
        closeTab(tab.id);
      }
    });
    // Delete the collection
    deleteCollection(collectionId);
    setShowDeleteModal(false);
  }, [activeTabId, closeTab, tabs, collectionId, deleteCollection]);

  // Handler to update a request in the collection
  const handleUpdateCollectionRequest = useCallback((requestId: string, updates: Partial<Request>) => {
    updateRequest(collectionId, requestId, updates);
    markDirty();
  }, [collectionId, updateRequest, markDirty]);

  // Reference view expand/collapse handlers
  const handleToggleRequestExpand = useCallback((requestId: string) => {
    setExpandedRequestIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(requestId)) {
        newSet.delete(requestId);
      } else {
        newSet.add(requestId);
      }
      return newSet;
    });
  }, []);

  // Scroll to section function
  const scrollToSection = useCallback((sectionId: string) => {
    const container = reference2ContentRef.current;
    if (!container) return;
    const element = container.querySelector(`[data-section-id="${sectionId}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);
  

  // Track when the reference content is ready
  const [referenceContentReady, setReferenceContentReady] = useState(false);
  
  // Callback ref to detect when reference content is mounted
  const handleReferenceContentRef = useCallback((node: HTMLDivElement | null) => {
    (reference2ContentRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    setReferenceContentReady(!!node);
  }, []);

  // Clear scroll sync when leaving reference tab
  useEffect(() => {
    if (activeTab !== 'reference') {
      window.dispatchEvent(new CustomEvent('referenceScrollSync', { 
        detail: { folderId: null, requestId: null, collectionId: null } 
      }));
    }
  }, [activeTab]);

  // ========== REFERENCE TAB HELPERS (must be before early return) ==========

  // FolderSection interface for reference tab
  interface FolderSection {
    id: string;
    name: string;
    requests: Request[];
    subFolders: FolderSection[];
  }

  // Get folder sections for reference tab (excludes root-level requests)
  const getFolderSectionsForReference = useCallback((folders: Folder[]): FolderSection[] => {
    const mapFolder = (folder: Folder): FolderSection => ({
      id: folder.id,
      name: folder.name,
      requests: folder.requests,
      subFolders: folder.folders.map(mapFolder),
    });
    return folders.map(mapFolder);
  }, []);

  // Flatten sections recursively
  const flattenSectionsRecursive = useCallback((sections: FolderSection[]): FolderSection[] => {
    const result: FolderSection[] = [];
    const flatten = (secs: FolderSection[]) => {
      secs.forEach(section => {
        result.push(section);
        if (section.subFolders.length > 0) {
          flatten(section.subFolders);
        }
      });
    };
    flatten(sections);
    return result;
  }, []);

  // All flat sections for rendering
  const allFlatSections = useMemo(() => {
    if (!collection) return [];
    const folderSecs = getFolderSectionsForReference(collection.folders);
    return flattenSectionsRecursive(folderSecs);
  }, [collection, getFolderSectionsForReference, flattenSectionsRecursive]);

  // Calculate active section from scroll position (for scroll sync)
  const calculateActiveSection = useCallback(() => {
    const container = reference2ContentRef.current;
    if (!container) return;
    
    const targetLine = 50; // 50px from top of container
    const containerRect = container.getBoundingClientRect();
    const targetY = containerRect.top + targetLine;
    
    let newFolderId: string | null = null;
    let newRequestId: string | null = null;
    let lastSectionAboveTarget: string | null = null;
    
    // Find all section elements
    const sectionElements = container.querySelectorAll('[data-section-id]');
    
    for (const sectionEl of sectionElements) {
      const rect = sectionEl.getBoundingClientRect();
      const sectionId = sectionEl.getAttribute('data-section-id');
      
      // Track the last section whose top is above the target line
      // This handles gaps between sections
      if (rect.top <= targetY) {
        lastSectionAboveTarget = sectionId;
      }
      
      if (rect.top <= targetY && rect.bottom > targetY) {
        newFolderId = sectionId;
        
        // Check for active request within this section
        const requestElements = sectionEl.querySelectorAll('[data-request-id]');
        let lastRequestAboveTarget: string | null = null;
        
        for (const reqEl of requestElements) {
          const reqRect = reqEl.getBoundingClientRect();
          const requestId = reqEl.getAttribute('data-request-id');
          
          // Track the last request whose top is above the target line
          if (reqRect.top <= targetY) {
            lastRequestAboveTarget = requestId;
          }
          
          if (reqRect.top <= targetY && reqRect.bottom > targetY) {
            newRequestId = requestId;
            break;
          }
        }
        
        // If target is in a gap between requests, use the last request above the target
        if (!newRequestId && lastRequestAboveTarget) {
          newRequestId = lastRequestAboveTarget;
        }
        
        break;
      }
    }
    
    // If target is in a gap between sections, use the last section above the target
    if (!newFolderId && lastSectionAboveTarget) {
      newFolderId = lastSectionAboveTarget;
    }
    
    // Only default to first section if we're at the very top
    if (!newFolderId && sectionElements.length > 0 && container.scrollTop < 10) {
      newFolderId = sectionElements[0].getAttribute('data-section-id');
    }
    
    // Don't update if nothing changed
    if (newFolderId === activeFolderId && newRequestId === activeRequestId) {
      return;
    }
    
    // Only update if we have a valid folder
    if (newFolderId) {
      setActiveFolderId(newFolderId);
      setActiveRequestId(newRequestId);
      window.dispatchEvent(new CustomEvent('referenceScrollSync', { 
        detail: { folderId: newFolderId, requestId: newRequestId, collectionId } 
      }));
    }
  }, [activeFolderId, activeRequestId, collectionId]);

  // Update active section when scroll changes
  useEffect(() => {
    if (activeTab === 'reference' && referenceContentReady) {
      // Initial calculation
      calculateActiveSection();
    }
  }, [activeTab, referenceContentReady, calculateActiveSection]);

  // Handle scroll for sync
  const handleReferenceScroll = useCallback(() => {
    calculateActiveSection();
  }, [calculateActiveSection]);

  // Set up IntersectionObserver to track which sections are visible (for virtualization)
  useEffect(() => {
    if (activeTab !== 'reference' || !referenceContentReady) return;
    
    const container = reference2ContentRef.current;
    if (!container) return;
    
    // Clean up previous observer
    if (sectionObserverRef.current) {
      sectionObserverRef.current.disconnect();
    }
    
    // Create observer with generous margins to pre-render nearby sections
    sectionObserverRef.current = new IntersectionObserver(
      (entries) => {
        setVisibleSectionIds(prev => {
          const newSet = new Set(prev);
          entries.forEach(entry => {
            const sectionId = entry.target.getAttribute('data-section-id');
            if (sectionId) {
              if (entry.isIntersecting) {
                newSet.add(sectionId);
              } else {
                newSet.delete(sectionId);
              }
            }
          });
          return newSet;
        });
      },
      {
        root: container,
        rootMargin: '200px 0px', // Pre-render sections 200px before they become visible
        threshold: 0,
      }
    );
    
    // Observe all sections after a brief delay to ensure DOM is ready
    const timer = setTimeout(() => {
      const sections = container.querySelectorAll('[data-section-id]');
      sections.forEach(section => {
        sectionObserverRef.current?.observe(section);
      });
    }, 100);
    
    return () => {
      clearTimeout(timer);
      sectionObserverRef.current?.disconnect();
    };
  }, [activeTab, referenceContentReady, allFlatSections.length]);

  // Listen for scroll-to-request events from LeftPanel when clicking a request
  useEffect(() => {
    const handleScrollToRequest = (e: Event) => {
      const event = e as CustomEvent<{ requestId: string; collectionId: string; folderId?: string }>;
      const { requestId, collectionId: eventCollectionId, folderId } = event.detail;
      
      // Only handle if we're on the Reference tab and it's for this collection
      if (activeTab !== 'reference' || eventCollectionId !== collectionId || !collection) {
        return; // Let the event continue (will open request in new tab)
      }
      
      // Prevent default behavior (opening in new tab)
      e.preventDefault();
      
      // Check if folder is expanded (inline check)
      const checkFolderExpanded = (fId: string): boolean => {
        if (fId === 'root') return true;
        const findFolder = (folders: Folder[]): Folder | null => {
          for (const folder of folders) {
            if (folder.id === fId) return folder;
            const found = findFolder(folder.folders);
            if (found) return found;
          }
          return null;
        };
        const folder = findFolder(collection.folders);
        return folder ? !folder.collapsed : false;
      };
      
      // Expand the folder if it's collapsed
      if (folderId && !checkFolderExpanded(folderId)) {
        updateFolder(collectionId, folderId, { collapsed: false });
      }
      
      const container = reference2ContentRef.current;
      if (!container) return;
      
      // Step 1: First scroll to the section header to make it visible
      // This ensures the IntersectionObserver will mark the section as visible
      const sectionElement = container.querySelector(`[data-section-id="${folderId}"]`);
      if (sectionElement) {
        sectionElement.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
      
      // Step 2: Wait for virtualization to render the content, then scroll to request
      const scrollToRequest = (attempts = 0) => {
        if (attempts > 10) return; // Give up after 10 attempts
        
        const requestElement = container.querySelector(`[data-request-id="${requestId}"]`);
        if (requestElement) {
          // Found it! Scroll to the request instantly
          requestElement.scrollIntoView({ behavior: 'auto', block: 'start' });
        } else {
          // Not rendered yet, wait and try again
          setTimeout(() => scrollToRequest(attempts + 1), 100);
        }
      };
      
      // Start looking for the request after a brief delay
      setTimeout(() => scrollToRequest(0), 150);
    };
    
    window.addEventListener('scrollToRequestInReference', handleScrollToRequest);
    return () => window.removeEventListener('scrollToRequestInReference', handleScrollToRequest);
  }, [activeTab, collectionId, collection, updateFolder]);

  // ========== END VIRTUAL LIST HOOKS ==========

  // Early return AFTER all hooks
  if (!collection) {
    return (
      <div className="collection-editor collection-editor--not-found">
        <div className="collection-editor__empty">
          <FolderIcon />
          <h3>Collection Not Found</h3>
          <p>This collection may have been deleted.</p>
        </div>
      </div>
    );
  }

  // Ensure there's at least one empty row for headers
  const headersWithEmpty = (collection.headers || []).length === 0
    ? [{ id: uuidv4(), key: '', value: '', enabled: true }]
    : collection.headers || [];

  const auth: AuthConfig = collection.auth || { type: 'none' };

  // Helper to count all requests recursively (including nested in folders)
  const countAllRequests = (folders: Folder[]): number => {
    return folders.reduce((count, folder) => {
      return count + folder.requests.length + countAllRequests(folder.folders);
    }, 0);
  };

  // Helper to count all folders recursively
  const countAllFolders = (folders: Folder[]): number => {
    return folders.reduce((count, folder) => {
      return count + 1 + countAllFolders(folder.folders);
    }, 0);
  };

  const totalRequests = collection.requests.length + countAllRequests(collection.folders);
  const totalFolders = countAllFolders(collection.folders);

  // Helper to get all requests with their folder paths
  const getAllRequestsWithPaths = (
    requests: Request[], 
    folders: Folder[], 
    parentPath: string = ''
  ): Array<{ request: Request; folderPath: string }> => {
    const result: Array<{ request: Request; folderPath: string }> = [];
    
    // Add root-level requests
    requests.forEach(r => {
      result.push({ request: r, folderPath: parentPath });
    });
    
    // Recursively add requests from folders
    folders.forEach(folder => {
      const folderPath = parentPath ? `${parentPath} / ${folder.name}` : folder.name;
      folder.requests.forEach(r => {
        result.push({ request: r, folderPath });
      });
      result.push(...getAllRequestsWithPaths([], folder.folders, folderPath));
    });
    
    return result;
  };

  const allRequestsWithPaths = getAllRequestsWithPaths(collection.requests, collection.folders);

  const handleExpandAll = () => {
    // Use context's batch expand function (single state update)
    expandAllFolders(collectionId);
  };

  const handleCollapseAll = () => {
    // Use context's batch collapse function (single state update)
    collapseAllFolders(collectionId);
  };

  // Check if any folder is expanded
  const checkAnyFolderExpanded = (): boolean => {
    const check = (folders: Folder[]): boolean => {
      for (const folder of folders) {
        if (!folder.collapsed) return true;
        if (check(folder.folders)) return true;
      }
      return false;
    };
    return check(collection.folders);
  };

  const someExpanded = checkAnyFolderExpanded();

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleString();
  };

  // Reference: Get folder structure with requests for operations summary view (excludes root-level requests)
  const getFolderSections = (folders: Folder[]): FolderSection[] => {
    const mapFolder = (folder: Folder): FolderSection => ({
      id: folder.id,
      name: folder.name,
      requests: folder.requests,
      subFolders: folder.folders.map(mapFolder),
    });
    return folders.map(mapFolder);
  };

  const folderSections = getFolderSections(collection.folders);

  // Flatten folder sections for sidebar navigation
  const flattenSections = (sections: FolderSection[], parentPath: string = ''): Array<{ id: string; name: string; path: string; depth: number }> => {
    const result: Array<{ id: string; name: string; path: string; depth: number }> = [];
    sections.forEach(section => {
      const path = parentPath ? `${parentPath}/${section.name}` : section.name;
      const depth = parentPath.split('/').filter(Boolean).length;
      result.push({ id: section.id, name: section.name, path, depth });
      result.push(...flattenSections(section.subFolders, path));
    });
    return result;
  };

  const flatSections = flattenSections(folderSections);

  // Toggle folder expanded state (uses collection data - syncs with LeftPanel)
  const toggleFolderExpanded = (folderId: string) => {
    // For "root" section (requests not in folders), we don't have a folder to toggle
    if (folderId === 'root') return;
    
    // Find the folder to get its current collapsed state
    const findFolder = (folders: Folder[]): Folder | null => {
      for (const folder of folders) {
        if (folder.id === folderId) return folder;
        const found = findFolder(folder.folders);
        if (found) return found;
      }
      return null;
    };
    
    const folder = findFolder(collection.folders);
    if (folder) {
      updateFolder(collectionId, folderId, { collapsed: !folder.collapsed });
    }
  };

  // Check if a folder is expanded (uses collection data - syncs with LeftPanel)
  const isFolderExpanded = (folderId: string): boolean => {
    if (folderId === 'root') return true; // Root is always "expanded"
    
    const findFolder = (folders: Folder[]): Folder | null => {
      for (const folder of folders) {
        if (folder.id === folderId) return folder;
        const found = findFolder(folder.folders);
        if (found) return found;
      }
      return null;
    };
    
    const folder = findFolder(collection.folders);
    return folder ? !folder.collapsed : false;
  };

  return (
    <div className="collection-editor">
      <div className="collection-editor__header">
        <div className="collection-editor__title">
          <FolderIcon />
          <h2>{collection.name}</h2>
          {hasUrlSource && (
            <span className="collection-editor__url-badge">
            <RadarIcon />
              URL
            </span>
          )}
        </div>
        <div className="collection-editor__meta">
          <span>{totalRequests} requests</span>
          <span>{totalFolders} folders</span>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="collection-editor__tabs">
        <button
          className={`collection-editor__tab ${activeTab === 'reference' ? 'active' : ''}`}
          onClick={() => setActiveTab('reference')}
        >
          Reference
          <span className="collection-editor__tab-badge">
            {totalRequests}
          </span>
        </button>
        <button
          className={`collection-editor__tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          className={`collection-editor__tab ${activeTab === 'environments' ? 'active' : ''}`}
          onClick={() => setActiveTab('environments')}
        >
          Environments
          {(collection.environments?.length || 0) > 0 && (
            <span className="collection-editor__tab-badge">
              {collection.environments?.length}
            </span>
          )}
        </button>
        <button
          className={`collection-editor__tab ${activeTab === 'headers' ? 'active' : ''}`}
          onClick={() => setActiveTab('headers')}
        >
          Headers
          {(collection.headers?.filter(h => h.key).length || 0) > 0 && (
            <span className="collection-editor__tab-badge">
              {collection.headers?.filter(h => h.key).length}
            </span>
          )}
        </button>
        <button
          className={`collection-editor__tab ${activeTab === 'auth' ? 'active' : ''}`}
          onClick={() => setActiveTab('auth')}
        >
          Auth
          {auth.type !== 'none' && (
            <span className="collection-editor__tab-indicator" />
          )}
        </button>
        {hasUrlSource && (
          <button
            className={`collection-editor__tab ${activeTab === 'sync' ? 'active' : ''}`}
            onClick={() => setActiveTab('sync')}
          >
            Sync
            {pendingChanges && pendingChanges.changes.length > 0 && (
              <span className="collection-editor__tab-badge collection-editor__tab-badge--warning">
                {pendingChanges.changes.length}
              </span>
            )}
          </button>
        )}
        
        {/* Expand/Collapse All button for Reference tab */}
        {activeTab === 'reference' && allRequestsWithPaths.length > 0 && (
          <div className="collection-editor__tabs-spacer" />
        )}
        {activeTab === 'reference' && allRequestsWithPaths.length > 0 && (
          <Tooltip content={someExpanded ? 'Collapse all' : 'Expand all'}>
            <button
              className="collection-editor__tab collection-editor__tab--action"
              onClick={someExpanded ? handleCollapseAll : handleExpandAll}
            >
              {someExpanded ? <CollapseAllIcon /> : <ExpandAllIcon />}
              {someExpanded ? 'Collapse All' : 'Expand All'}
            </button>
          </Tooltip>
        )}
      </div>

      {/* Tab Content */}
      <div className={`collection-editor__content ${activeTab === 'reference' ? 'collection-editor__content--reference' : ''}`}>
        {activeTab === 'reference' && (
          <div className="collection-editor__reference">
            {/* Main Content - sidebar is now the LeftPanel */}
            <div 
              className="reference-content" 
              ref={handleReferenceContentRef}
              onScroll={handleReferenceScroll}
            >
              {folderSections.length === 0 ? (
                <div className="collection-editor__reference-empty">
                  <FolderIcon />
                  <p>No requests in this collection</p>
                  <p className="collection-editor__reference-empty-hint">
                    Add requests from the sidebar to see them here.
                  </p>
                </div>
              ) : (
                <div className="reference-sections-container">
                  {/* Render sections with CSS content-visibility for browser-native virtualization */}
                  {allFlatSections.map((section) => (
                    <div
                      key={section.id}
                      className="reference-section"
                      data-section-id={section.id}
                    >
                      <h2 className="reference-section__title">{section.name}</h2>
                      
                      {/* Operations Card */}
                      {section.requests.length > 0 && (
                        <div className="reference-operations-card">
                          <div className="reference-operations-card__header">
                            Operations
                          </div>
                          <div className="reference-operations-card__list">
                            {section.requests.map(request => (
                              <div key={request.id} className="reference-operations-card__item">
                                <span 
                                  className="reference-operations-card__method"
                                  style={{ color: getMethodColor(request.method) }}
                                >
                                  {request.method}
                                </span>
                                <span className="reference-operations-card__path">
                                  {request.url || '/'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Show More Button */}
                      {section.requests.length > 0 && (
                        <button
                          className="reference-section__toggle"
                          onClick={() => toggleFolderExpanded(section.id)}
                        >
                          {isFolderExpanded(section.id) ? 'Show Less' : 'Show More'}
                          <ChevronDownIcon />
                        </button>
                      )}

                      {/* Expanded Request Details - only render if section is visible (virtualization) */}
                      {isFolderExpanded(section.id) && (
                        <div className="reference-section__requests">
                          {visibleSectionIds.has(section.id) ? (
                            // Full render for visible sections
                            section.requests.map((request, idx) => (
                              <div key={request.id} className="reference-request" data-request-id={request.id}>
                                <div className="reference-request__header">
                                  <span 
                                    className="reference-request__method"
                                    style={{ 
                                      backgroundColor: getMethodColor(request.method),
                                      color: '#fff'
                                    }}
                                  >
                                    {request.method}
                                  </span>
                                  <span className="reference-request__path">{request.url || '/'}</span>
                                  {request.name && (
                                    <span className="reference-request__name">{request.name}</span>
                                  )}
                                </div>
                                
                                {/* Request Item for full details */}
                                <RequestItem
                                  request={request}
                                  collection={{
                                    id: collection.id,
                                    name: collection.name,
                                    auth: collection.auth,
                                    headers: collection.headers,
                                    environments: collection.environments,
                                    defaultEnvironmentId: collection.defaultEnvironmentId,
                                    specSource: collection.specSource,
                                  }}
                                  onUpdateRequest={handleUpdateCollectionRequest}
                                  folderPath={section.name}
                                  isExpanded={true}
                                  index={idx}
                                  hideExpandButton={true}
                                />
                              </div>
                            ))
                          ) : (
                            // Lightweight placeholder for off-screen expanded sections
                            <div className="reference-section__requests-placeholder">
                              <span>{section.requests.length} request{section.requests.length !== 1 ? 's' : ''} - scroll to view details</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'overview' && (
          <div className="collection-editor__overview">
            <div className="collection-editor__field">
              <label>Name</label>
              <Input
                value={collection.name}
                onChange={handleNameChange}
                placeholder="Collection name"
              />
            </div>
            <div className="collection-editor__field">
              <label>Description</label>
              <textarea
                value={collection.description || ''}
                onChange={handleDescriptionChange}
                placeholder="Add a description for this collection..."
                rows={4}
              />
            </div>
            {/* ID */}
            <div className="collection-editor__field">
              <label>ID</label>
              <Input
                value={collection.id}
                readOnly
                placeholder="Collection ID"
                supportVariables
              />
            </div>
            <div className="collection-editor__field">
              <label>Default Environment</label>
              <Dropdown
                options={[
                  { value: 'none', label: 'None (use active environment)' },
                  ...environments.map(env => ({ value: env.id, label: env.name }))
                ]}
                value={collection.defaultEnvironmentId || 'none'}
                onChange={handleDefaultEnvironmentChange}
              />
              <span className="collection-editor__field-hint">
                When set, this environment will be used for all requests in this collection, 
                regardless of the globally active environment.
              </span>
            </div>
            <div className="collection-editor__info">
              <div className="collection-editor__info-item">
                <span className="collection-editor__info-label">Created</span>
                <span className="collection-editor__info-value">
                  {new Date(collection.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="collection-editor__info-item">
                <span className="collection-editor__info-label">Last Modified</span>
                <span className="collection-editor__info-value">
                  {new Date(collection.updatedAt).toLocaleDateString()}
                </span>
              </div>
              {collection.importedAt && (
                <div className="collection-editor__info-item">
                  <span className="collection-editor__info-label">Imported</span>
                  <span className="collection-editor__info-value">
                    {new Date(collection.importedAt).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>

            {/* Danger Zone */}
            <div className="collection-editor__danger-zone">
              <h4>Danger Zone</h4>
              <div className="collection-editor__danger-action">
                <div className="collection-editor__danger-info">
                  <span className="collection-editor__danger-title">Delete this collection</span>
                  <span className="collection-editor__danger-description">
                    Once deleted, all requests and folders in this collection will be permanently removed.
                  </span>
                </div>
                <Button 
                  variant="danger" 
                  size="sm" 
                  onClick={() => setShowDeleteModal(true)}
                  icon={<TrashIcon />}
                >
                  Delete Collection
                </Button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'environments' && (
          <div className="collection-editor__environments">
            <div className="collection-editor__section-description">
              <p>
                Collection environments let you define variables specific to this collection.
                These variables <strong>override</strong> global environment variables with the same name.
              </p>
            </div>
            
            <div className="collection-editor__environments-header">
              <Button 
                variant="secondary" 
                size="sm" 
                icon={<PlusIcon />}
                onClick={() => setShowNewEnvModal(true)}
              >
                New Environment
              </Button>
            </div>

            {(!collection.environments || collection.environments.length === 0) ? (
              <div className="collection-editor__environments-empty">
                <GlobeIcon />
                <p>No collection environments yet</p>
                <p className="collection-editor__environments-empty-hint">
                  Create an environment to define collection-specific variables that override global ones.
                </p>
              </div>
            ) : (
              <div className="collection-editor__environments-list">
                {collection.environments.map((env: CollectionEnvironment) => (
                  <div key={env.id} className={`collection-editor__environment ${env.isActive ? 'active' : ''}`}>
                    <div className="collection-editor__environment-header">
                      <div className="collection-editor__environment-info">
                        <ColorEmojiPicker
                          color={env.color}
                          emoji={env.emoji}
                          onChange={(updates) => handleEnvironmentColorEmojiChange(env.id, updates)}
                          size="sm"
                        />
                        <Input
                          value={env.name}
                          onChange={(e) => handleEnvironmentNameChange(env.id, e.target.value)}
                          className="collection-editor__environment-name"
                          size="sm"
                        />
                      </div>
                      <div className="collection-editor__environment-actions">
                        <Tooltip content={env.isActive ? 'Hide from dropdown' : 'Show in dropdown'} position="left">
                          <Switch
                            checked={env.isActive}
                            onChange={() => handleToggleEnvironmentActive(env.id)}
                            size="sm"
                          />
                        </Tooltip>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteEnvironment(env.id)}
                          icon={<TrashIcon />}
                        />
                      </div>
                    </div>
                    <div className="collection-editor__environment-variables">
                      <EditableTable
                        data={env.variables.length === 0 
                          ? [{ id: uuidv4(), key: '', value: '', enabled: true }] 
                          : env.variables
                        }
                        onChange={(vars) => handleEnvironmentVariablesChange(env.id, vars)}
                        keyPlaceholder="Variable name"
                        valuePlaceholder="Value"
                        descriptionPlaceholder="Description (optional)"
                        showDescription={true}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'headers' && (
          <div className="collection-editor__headers">
            <div className="collection-editor__section-description">
              <p>
                These headers will be automatically added to every request in this collection.
                Request-specific headers can override these values.
              </p>
            </div>
            <EditableTable
              data={headersWithEmpty}
              onChange={handleHeadersChange}
              keyPlaceholder="Header"
              valuePlaceholder="Value"
              descriptionPlaceholder="Description"
            />
          </div>
        )}

        {activeTab === 'auth' && (
          <div className="collection-editor__auth">
            <div className="collection-editor__section-description">
              <p>
                Set default authentication for all requests in this collection.
                Request-specific auth settings will override this.
              </p>
            </div>
            
            <div className="collection-editor__auth-type">
              <label>Type</label>
              <Dropdown
                options={[
                  { value: 'none', label: 'No Auth' },
                  { value: 'basic', label: 'Basic Auth' },
                  { value: 'bearer', label: 'Bearer Token' },
                  { value: 'api-key', label: 'API Key' },
                ]}
                value={auth.type}
                onChange={handleAuthTypeChange}
              />
            </div>

            {auth.type === 'basic' && (
              <div className="collection-editor__auth-fields">
                <div className="collection-editor__auth-field">
                  <label>Username</label>
                  <Input
                    value={auth.basic?.username || ''}
                    onChange={(e) => handleAuthUpdate({
                      basic: { 
                        username: e.target.value, 
                        password: auth.basic?.password || '' 
                      }
                    })}
                    placeholder="Username"
                    supportVariables
                  />
                </div>
                <div className="collection-editor__auth-field">
                  <label>Password</label>
                  <Input
                    type="password"
                    value={auth.basic?.password || ''}
                    onChange={(e) => handleAuthUpdate({
                      basic: { 
                        username: auth.basic?.username || '', 
                        password: e.target.value 
                      }
                    })}
                    placeholder="Password"
                    supportVariables
                  />
                </div>
              </div>
            )}

            {auth.type === 'bearer' && (
              <div className="collection-editor__auth-fields">
                <div className="collection-editor__auth-field">
                  <label>Token</label>
                  <Input
                    value={auth.bearer?.token || ''}
                    onChange={(e) => handleAuthUpdate({
                      bearer: { token: e.target.value }
                    })}
                    placeholder="Bearer token"
                    supportVariables
                  />
                </div>
              </div>
            )}

            {auth.type === 'api-key' && (
              <div className="collection-editor__auth-fields">
                <div className="collection-editor__auth-field">
                  <label>Key</label>
                  <Input
                    value={auth.apiKey?.key || ''}
                    onChange={(e) => handleAuthUpdate({
                      apiKey: { 
                        key: e.target.value,
                        value: auth.apiKey?.value || '',
                        addTo: auth.apiKey?.addTo || 'header'
                      }
                    })}
                    placeholder="Header or param name"
                    supportVariables
                  />
                </div>
                <div className="collection-editor__auth-field">
                  <label>Value</label>
                  <Input
                    value={auth.apiKey?.value || ''}
                    onChange={(e) => handleAuthUpdate({
                      apiKey: { 
                        key: auth.apiKey?.key || '',
                        value: e.target.value,
                        addTo: auth.apiKey?.addTo || 'header'
                      }
                    })}
                    placeholder="API key value"
                    supportVariables
                  />
                </div>
                <div className="collection-editor__auth-field">
                  <label>Add to</label>
                  <Dropdown
                    options={[
                      { value: 'header', label: 'Header' },
                      { value: 'query', label: 'Query Params' },
                    ]}
                    value={auth.apiKey?.addTo || 'header'}
                    onChange={(addTo) => handleAuthUpdate({
                      apiKey: { 
                        key: auth.apiKey?.key || '',
                        value: auth.apiKey?.value || '',
                        addTo: addTo as 'header' | 'query'
                      }
                    })}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'sync' && hasUrlSource && (
          <div className="collection-editor__sync">
            <div className="collection-editor__section-description">
              <p>
                This collection is linked to a remote OpenAPI specification.
                You can sync it to detect and apply changes from the source.
              </p>
            </div>

            {/* Source URL */}
            <div className="collection-editor__sync-source">
              <label>Source URL</label>
              <div className="collection-editor__sync-url">
                <LinkIcon />
                <span>{collection.specSource?.url}</span>
              </div>
            </div>

            {/* Sync Settings */}
            <div className="collection-editor__sync-settings">
              <div className="collection-editor__sync-frequency">
                <label>Auto-sync Frequency</label>
                <Dropdown
                  options={SYNC_FREQUENCY_OPTIONS.map((opt: { value: number; label: string }) => ({
                    value: String(opt.value),
                    label: opt.label,
                  }))}
                  value={String(collection.specSource?.syncFrequencyMins ?? 30)}
                  onChange={handleSyncFrequencyChange}
                />
              </div>
              <Button
                variant="secondary"
                onClick={handleCheckForUpdates}
                loading={isChecking}
                icon={<RefreshIcon />}
              >
                Check Now
              </Button>
            </div>

            {/* Sync Info */}
            <div className="collection-editor__sync-info">
              <div className="collection-editor__info-item">
                <span className="collection-editor__info-label">Last Synced</span>
                <span className="collection-editor__info-value">
                  {formatDate(collection.specSource?.lastSyncedAt)}
                </span>
              </div>
              <div className="collection-editor__info-item">
                <span className="collection-editor__info-label">Imported</span>
                <span className="collection-editor__info-value">
                  {formatDate(collection.importedAt)}
                </span>
              </div>
              <div className="collection-editor__info-item">
                <span className="collection-editor__info-label">Format</span>
                <span className="collection-editor__info-value">
                  {collection.specSource?.format === 'openapi' ? 'OpenAPI' : collection.specSource?.format}
                </span>
              </div>
            </div>

            {/* Changes Diff Viewer */}
            {pendingChanges && (
              <div className="collection-editor__sync-changes">
                <h4>Detected Changes</h4>
                <DiffViewer
                  changes={pendingChanges.changes}
                  onSelectionChange={handleSelectionChange}
                  onApplySelected={handleApplySelected}
                  onApplyAll={handleApplyAll}
                  isApplying={isApplying}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Collection"
        size="sm"
      >
        <div className="collection-editor__delete-modal">
          <div className="collection-editor__delete-icon">
            <AlertIcon />
          </div>
          <p className="collection-editor__delete-message">
            Are you sure you want to delete <strong>{collection.name}</strong>?
          </p>
          <p className="collection-editor__delete-warning">
            This will permanently delete {totalRequests} request{totalRequests !== 1 ? 's' : ''} 
            {totalFolders > 0 && ` and ${totalFolders} folder${totalFolders !== 1 ? 's' : ''}`}. 
            This action cannot be undone.
          </p>
          <div className="collection-editor__delete-actions">
            <Button variant="secondary" onClick={() => setShowDeleteModal(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Delete Collection
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
        title="New Collection Environment"
        size="sm"
      >
        <div className="collection-editor__new-env-modal">
          <div className="collection-editor__new-env-field">
            <label>Environment Name</label>
            <Input
              value={newEnvName}
              onChange={(e) => setNewEnvName(e.target.value)}
              placeholder="e.g., Development, Staging, Production"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newEnvName.trim()) {
                  handleCreateEnvironment();
                }
              }}
            />
          </div>
          <p className="collection-editor__new-env-hint">
            This environment's variables will override global environment variables with the same name
            when working with requests in this collection.
          </p>
          <div className="collection-editor__new-env-actions">
            <Button 
              variant="secondary" 
              onClick={() => {
                setShowNewEnvModal(false);
                setNewEnvName('');
              }}
            >
              Cancel
            </Button>
            <Button 
              variant="primary" 
              onClick={handleCreateEnvironment}
              disabled={!newEnvName.trim()}
            >
              Create Environment
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default CollectionEditor;
