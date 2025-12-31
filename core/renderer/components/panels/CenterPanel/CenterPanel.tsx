import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Button, Input, Dropdown, TabBar, EditableTable, Tooltip, CodeEditor } from '@/components/ui';
import { SendIcon, CodeIcon, HistoryIcon } from '@/components/ui/icons';
import { useRequest, useEnvironments, useTheme, useCollections, useApp } from '@/contexts';
import { storageManager } from '@/services';
import { HTTP_METHODS, METHOD_COLORS, DEFAULT_HEADERS } from '../../../../shared/constants';
import { HttpMethod, KeyValuePair, Collection } from '@/types';
import { extractSpecResponseInfo } from '@/utils';
import { APP_VERSION } from '@/utils/environment';
import { ResponseViewer } from './ResponseViewer';
import { EnvironmentEditor } from './EnvironmentEditor';
import { CollectionEditor } from './CollectionEditor';
import { RequestHistoryModal } from '@/components/modals';
import './CenterPanel.css';

const CUSTOM_METHOD_COLOR = '#9ca3af';

const getMethodColor = (method: string): string => {
  return METHOD_COLORS[method] || CUSTOM_METHOD_COLOR;
};

type RequestTab = 'params' | 'auth' | 'headers' | 'body' | 'scripts' | 'settings';

const requestTabs = [
  { id: 'params', title: 'Params' },
  { id: 'auth', title: 'Auth' },
  { id: 'headers', title: 'Headers' },
  { id: 'body', title: 'Body' },
  { id: 'scripts', title: 'Scripts' },
 // { id: 'settings', title: 'Settings' },
];

interface CenterPanelProps {
  onShowCodePanel?: () => void;
}

export const CenterPanel: React.FC<CenterPanelProps> = ({ onShowCodePanel }) => {
  const { resolvedTheme } = useTheme();
  const { 
    tabs, 
    activeTab, 
    activeTabId, 
    setActiveTab, 
    closeTab, 
    reorderTabs, 
    renameTab,
    addTab,
    addCollectionTab,
    addEnvironmentTab,
    updateRequest, 
    sendRequest, 
    isLoading,
    currentExecution 
  } = useRequest();
  const { activeEnvironment, environments } = useEnvironments();
  const { collections, updateRequest: updateCollectionRequest } = useCollections();
  const { customHttpMethods, addCustomHttpMethod, settings, updateSettings } = useApp();
  const [activeRequestTab, setActiveRequestTab] = useState<RequestTab>('params');
  const [responseHeight, setResponseHeight] = useState(() => {
    return storageManager.getPanelSizes().responseHeight;
  });
  const [responseWidth, setResponseWidth] = useState(() => {
    return storageManager.getPanelSizes().responseWidth;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [isResponsePanelCollapsed, setIsResponsePanelCollapsed] = useState(false);
  const [isResponseExpanded, setIsResponseExpanded] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const resizeRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Setup editor with search functionality (CMD+F / Ctrl+F)
  const handleEditorLoad = useCallback((editor: any) => {
    // Load the searchbox extension for this editor
    ace.require('ace/ext/searchbox');
    
    // Ensure CMD+F is properly bound to the find command
    editor.commands.bindKey('Command-F', 'find');
    editor.commands.bindKey('Ctrl-F', 'find');
  }, []);

  const request = activeTab?.request;
  
  // Get the collection for the current request (if any)
  const requestCollection: Collection | null = request?.collectionId 
    ? collections.find(c => c.id === request.collectionId) || null
    : null;
  
  // Get the selected collection environment for variable resolution
  const selectedCollectionEnv = useMemo(() => {
    if (!requestCollection?.environments || !requestCollection.defaultEnvironmentId) {
      return null;
    }
    return requestCollection.environments.find(e => e.id === requestCollection.defaultEnvironmentId) || null;
  }, [requestCollection]);
  
  // Get collection-level headers that will be injected
  const collectionHeaders = requestCollection?.headers?.filter(h => h.enabled && h.key) || [];

  // Check if user has overridden the system User-Agent header in this request
  const userAgentOverride = useMemo(() => 
    request?.headers.find(
      h => h.key.toLowerCase() === 'user-agent' && h.id?.startsWith('__user_agent_override__')
    ),
    [request?.headers]
  );
  
  const hasUserDefinedUserAgent = useMemo(() =>
    request?.headers.some(
      h => h.key.toLowerCase() === 'user-agent' && !h.id?.startsWith('__user_agent_override__')
    ) || false,
    [request?.headers]
  );
  
  // Show system User-Agent if: setting is enabled AND user hasn't defined their own
  const showSystemUserAgent = (settings.sendUserAgent ?? true) && !hasUserDefinedUserAgent;

  // Memoize the combined headers data for EditableTable to prevent cursor jumping
  const combinedHeadersData = useMemo(() => {
    if (!request) return [];
    
    return [
      // System User-Agent header (from settings, can be toggled per request)
      ...(showSystemUserAgent ? [{
        id: userAgentOverride?.id || '__user_agent_override__' + request.id,
        key: 'User-Agent',
        value: `Echolon/${APP_VERSION}`,
        enabled: userAgentOverride ? userAgentOverride.enabled : true,
        description: 'Auto-generated (can be fully disabled via settings/requests)',
        inheritedFrom: 'System',
        isSystem: true,
      }] : []),
      // Inherited headers from collection (shown second with marker)
      ...collectionHeaders.map(h => ({
        ...h,
        inheritedFrom: requestCollection?.name,
      })),
      // Request-level headers (excluding system override markers)
      ...request.headers.filter(h => !h.id?.startsWith('__user_agent_override__')),
    ];
  }, [request, showSystemUserAgent, userAgentOverride, collectionHeaders, requestCollection?.name]);

  // Handle navigation to a variable definition when user double-clicks on a variable
  const handleNavigateToVariable = useCallback((
    variableName: string,
    source: 'global' | 'collection',
    sourceId: string
  ) => {
    if (source === 'global') {
      // Find the global environment and open it
      const environment = environments.find(e => e.id === sourceId);
      if (environment) {
        addEnvironmentTab(environment);
      }
    } else if (source === 'collection' && requestCollection) {
      // Navigate to the collection's environment tab
      addCollectionTab(requestCollection, 'environments');
    }
  }, [environments, requestCollection, addEnvironmentTab, addCollectionTab]);

  // Extract spec response info for the current request
  const specResponseInfo = useMemo(() => {
    if (!request || !requestCollection?.specSource?.rawSpec) {
      return undefined;
    }
    return extractSpecResponseInfo(
      requestCollection.specSource.rawSpec,
      request.url,
      request.method
    );
  }, [request?.url, request?.method, requestCollection?.specSource?.rawSpec]);

  // Build method options including custom methods
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
    if (activeTabId && request) {
      const upperMethod = method.toUpperCase();
      updateRequest(activeTabId, { method: upperMethod as HttpMethod });
      
      // Save custom method if it's not a standard HTTP method
      if (!HTTP_METHODS.includes(upperMethod as typeof HTTP_METHODS[number])) {
        addCustomHttpMethod(upperMethod);
      }
    }
  };

  // Parse URL to extract query params
  const parseUrlParams = (url: string): KeyValuePair[] => {
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      const params: KeyValuePair[] = [];
      urlObj.searchParams.forEach((value, key) => {
        params.push({
          id: crypto.randomUUID(),
          key,
          value,
          enabled: true,
        });
      });
      return params;
    } catch {
      return [];
    }
  };

  // Build URL from base URL and params
  const buildUrlWithParams = useCallback((baseUrl: string, params: KeyValuePair[]): string => {
    try {
      // Get the base URL without query params
      let url = baseUrl;
      const questionMarkIndex = url.indexOf('?');
      if (questionMarkIndex !== -1) {
        url = url.substring(0, questionMarkIndex);
      }

      const enabledParams = params.filter(p => p.enabled && p.key);
      if (enabledParams.length === 0) return url;

      const searchParams = new URLSearchParams();
      enabledParams.forEach(p => {
        searchParams.append(p.key, p.value);
      });

      return `${url}?${searchParams.toString()}`;
    } catch {
      return baseUrl;
    }
  }, []);

  // Sync URL with query params when request has params but URL doesn't include them
  useEffect(() => {
    if (!activeTabId || !request) return;
    
    const enabledParams = request.queryParams.filter(p => p.enabled && p.key);
    if (enabledParams.length === 0) return;
    
    // Check if URL already has these params
    const urlHasParams = request.url.includes('?');
    if (!urlHasParams) {
      // URL doesn't have params, but we have params - sync them
      const newUrl = buildUrlWithParams(request.url, request.queryParams);
      if (newUrl !== request.url) {
        updateRequest(activeTabId, { url: newUrl });
      }
    }
  }, [activeTabId, request?.id]); // Only run when request changes, not on every param change

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeTabId) return;
    
    const newUrl = e.target.value;
    const newParams = parseUrlParams(newUrl);
    
    // Only update params if URL contains query params
    if (newUrl.includes('?') && newParams.length > 0) {
      updateRequest(activeTabId, { 
        url: newUrl,
        queryParams: newParams
      });
    } else {
      updateRequest(activeTabId, { url: newUrl });
    }
  };

  const handleQueryParamsChange = (params: KeyValuePair[]) => {
    if (!activeTabId || !request) return;
    
    // Build new URL with the params
    const newUrl = buildUrlWithParams(request.url, params);
    updateRequest(activeTabId, { 
      queryParams: params,
      url: newUrl 
    });
  };

  const handleHeadersChange = (headers: KeyValuePair[]) => {
    if (activeTabId) {
      updateRequest(activeTabId, { headers });
    }
  };

  // Memoized onChange handler for headers table (handles system User-Agent toggling)
  const handleHeadersTableChange = useCallback((allHeaders: KeyValuePair[]) => {
    if (!request) return;
    
    // Find the system User-Agent header state
    const systemHeader = allHeaders.find(h => h.id?.startsWith('__user_agent_override__'));
    
    // Get request-level headers (filter out inherited and system display headers)
    let requestHeaders = allHeaders.filter(h => !h.inheritedFrom && !(h as any).isSystem);
    
    // If system header exists and was toggled, save its state in the request
    if (systemHeader && showSystemUserAgent) {
      // Remove any existing override
      requestHeaders = requestHeaders.filter(h => !h.id?.startsWith('__user_agent_override__'));
      
      // Add the override state (we store it to remember if user disabled it)
      if (!systemHeader.enabled) {
        // User disabled the system header - store this preference
        requestHeaders.unshift({
          id: '__user_agent_override__' + request.id,
          key: 'User-Agent',
          value: '',
          enabled: false,
          description: 'System User-Agent disabled for this request',
        });
      }
    }
    
    handleHeadersChange(requestHeaders);
  }, [request, showSystemUserAgent, handleHeadersChange]);

  const handleBodyChange = (content: string) => {
    if (activeTabId && request) {
      updateRequest(activeTabId, { 
        body: { ...request.body, content } 
      });
    }
  };

  const handleSend = async () => {
    await sendRequest();
  };

  const handleTabRename = (tabId: string, newTitle: string) => {
    renameTab(tabId, newTitle);
    // Also update the collection if this request belongs to one
    const tab = tabs.find(t => t.id === tabId);
    if (tab?.type === 'request' && tab.request?.collectionId) {
      updateCollectionRequest(tab.request.collectionId, tab.request.id, { name: newTitle });
    }
  };

  // Response panel resize handler
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
  };

  useEffect(() => {
    let newHeight = responseHeight;
    let newWidth = responseWidth;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      
      const container = contentRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      
      if (isResponseExpanded) {
        // Horizontal mode - resize width (response is on the right)
        // Width is from the mouse position to the right edge
        newWidth = Math.max(300, Math.min(containerRect.right - e.clientX, containerRect.width - 300));
        setResponseWidth(newWidth);
      } else {
        // Vertical mode - resize height
        newHeight = Math.max(100, Math.min(containerRect.bottom - e.clientY, containerRect.height - 200));
        setResponseHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      // Save to localStorage when resize ends
      if (isResponseExpanded) {
        storageManager.setPanelSizes({ responseWidth: newWidth });
      } else {
        storageManager.setPanelSizes({ responseHeight: newHeight });
      }
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      // Prevent text selection during resize
      document.body.style.userSelect = 'none';
      document.body.style.cursor = isResponseExpanded ? 'ew-resize' : 'ns-resize';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing, responseHeight, responseWidth, isResponseExpanded]);

  const tabItems = tabs.map(tab => ({
    id: tab.id,
    title: tab.type === 'environment' ? `Env: ${tab.title}` : tab.title,
    isDirty: tab.isDirty,
    icon: tab.type === 'request' && tab.request ? (
      <span 
        className="tab-method-badge" 
        style={{ color: getMethodColor(tab.request.method) }}
      >
        {tab.request.method}
      </span>
    ) : undefined,
  }));

  return (
    <div className="center-panel">
      {/* Request Tabs */}
      <TabBar
        tabs={tabItems}
        activeTab={activeTabId || ''}
        onTabChange={setActiveTab}
        onTabClose={closeTab}
        onTabReorder={(newTabs) => {
          const reorderedTabs = newTabs.map(t => tabs.find(tab => tab.id === t.id)!);
          reorderTabs(reorderedTabs);
        }}
        onTabRename={handleTabRename}
        onNewTab={() => addTab()}
        showAddButton
        className="center-panel__tabs"
      />

      {/* Environment Editor */}
      {activeTab?.type === 'environment' && activeTab.environmentId ? (
        <EnvironmentEditor environmentId={activeTab.environmentId} />
      ) : activeTab?.type === 'collection' && activeTab.collectionId ? (
        <CollectionEditor collectionId={activeTab.collectionId} />
      ) : request ? (
        <div 
          className={`center-panel__content ${isResponseExpanded ? 'center-panel__content--horizontal' : ''}`}
          ref={contentRef}
        >
          {/* Request Section (URL Bar + Options) */}
          <div className="center-panel__request-section">
            {/* URL Bar */}
            <div className="center-panel__url-bar">
              <Dropdown
                options={methodOptions}
                value={request.method}
                onChange={handleMethodChange}
                size="md"
                className="center-panel__method"
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
                onNavigateToVariable={handleNavigateToVariable}
                className="center-panel__url"
              />
              <Button
                variant="primary"
                size="md"
                onClick={handleSend}
                loading={isLoading}
                icon={<SendIcon />}
                className="center-panel__send"
              >
                Send
              </Button>
              <Tooltip content="Request History">
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => setShowHistoryModal(true)}
                  icon={<HistoryIcon />}
                  className="center-panel__history-btn"
                />
              </Tooltip>
              {onShowCodePanel && (
                <Tooltip content="View as Code">
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={onShowCodePanel}
                    icon={<CodeIcon />}
                    className="center-panel__code-btn"
                  />
                </Tooltip>
              )}
            </div>

            {/* Request Options */}
            <div className="center-panel__options">
              <div className="center-panel__option-tabs">
                {requestTabs.map(tab => (
                  <button
                    key={tab.id}
                    className={`center-panel__option-tab ${activeRequestTab === tab.id ? 'active' : ''}`}
                    onClick={() => setActiveRequestTab(tab.id as RequestTab)}
                  >
                    {tab.title}
                    {tab.id === 'params' && request.queryParams.filter(p => p.key).length > 0 && (
                      <span className="center-panel__option-badge">
                        {request.queryParams.filter(p => p.key).length}
                      </span>
                    )}
                    {tab.id === 'headers' && request.headers.filter(h => h.key).length > 0 && (
                      <span className="center-panel__option-badge">
                        {request.headers.filter(h => h.key).length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

            <div className="center-panel__option-content">
              {activeRequestTab === 'params' && (
                <div className="center-panel__params">
                  <EditableTable
                    data={request.queryParams}
                    onChange={handleQueryParamsChange}
                    keyPlaceholder="Key"
                    valuePlaceholder="Value"
                    descriptionPlaceholder="Description"
                    collectionEnvironment={selectedCollectionEnv}
                    onNavigateToVariable={handleNavigateToVariable}
                  />
                </div>
              )}

              {activeRequestTab === 'auth' && (
                <div className="center-panel__auth">
                  {/* Show collection auth inheritance indicator */}
                  {request.auth.type === 'none' && requestCollection?.auth && requestCollection.auth.type !== 'none' && (
                    <div 
                      className="center-panel__auth-inherited center-panel__auth-inherited--clickable"
                      onClick={() => addCollectionTab(requestCollection, 'auth')}
                      title="Click to edit collection auth settings"
                    >
                      <div className="center-panel__auth-inherited-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                      </div>
                      <div className="center-panel__auth-inherited-info">
                        <span className="center-panel__auth-inherited-title">
                          Inheriting from collection
                        </span>
                        <span className="center-panel__auth-inherited-detail">
                          {requestCollection.auth.type === 'basic' && 'Basic Auth'}
                          {requestCollection.auth.type === 'bearer' && 'Bearer Token'}
                          {requestCollection.auth.type === 'api-key' && 'API Key'}
                          {requestCollection.auth.type === 'oauth2' && 'OAuth 2.0'}
                          {' from '}
                          <strong>{requestCollection.name}</strong>
                        </span>
                      </div>
                      <div className="center-panel__auth-inherited-arrow">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                      </div>
                    </div>
                  )}
                  
                  <div className="center-panel__auth-type">
                    <label>Type</label>
                    <Dropdown
                      options={[
                        { value: 'none', label: requestCollection?.auth && requestCollection.auth.type !== 'none' ? 'Inherit from Collection' : 'No Auth' },
                        { value: 'basic', label: 'Basic Auth' },
                        { value: 'bearer', label: 'Bearer Token' },
                        { value: 'api-key', label: 'API Key' },
                      ]}
                      value={request.auth.type}
                      onChange={(type) => {
                        if (activeTabId) {
                          updateRequest(activeTabId, { 
                            auth: { ...request.auth, type: type as 'none' | 'basic' | 'bearer' | 'api-key' } 
                          });
                        }
                      }}
                    />
                  </div>

                  {request.auth.type === 'basic' && (
                    <div className="center-panel__auth-fields">
                      <div className="center-panel__auth-field">
                        <label>Username</label>
                        <Input
                          value={request.auth.basic?.username || ''}
                          onChange={(e) => {
                            if (activeTabId) {
                              updateRequest(activeTabId, {
                                auth: {
                                  ...request.auth,
                                  basic: { ...request.auth.basic, username: e.target.value, password: request.auth.basic?.password || '' },
                                },
                              });
                            }
                          }}
                          supportVariables
                        />
                      </div>
                      <div className="center-panel__auth-field">
                        <label>Password</label>
                        <Input
                          type="password"
                          value={request.auth.basic?.password || ''}
                          onChange={(e) => {
                            if (activeTabId) {
                              updateRequest(activeTabId, {
                                auth: {
                                  ...request.auth,
                                  basic: { ...request.auth.basic, username: request.auth.basic?.username || '', password: e.target.value },
                                },
                              });
                            }
                          }}
                          supportVariables
                        />
                      </div>
                    </div>
                  )}

                  {request.auth.type === 'bearer' && (
                    <div className="center-panel__auth-fields">
                      <div className="center-panel__auth-field">
                        <label>Token</label>
                        <Input
                          value={request.auth.bearer?.token || ''}
                          onChange={(e) => {
                            if (activeTabId) {
                              updateRequest(activeTabId, {
                                auth: {
                                  ...request.auth,
                                  bearer: { token: e.target.value },
                                },
                              });
                            }
                          }}
                          supportVariables
                        />
                      </div>
                    </div>
                  )}

                  {request.auth.type === 'api-key' && (
                    <div className="center-panel__auth-fields">
                      <div className="center-panel__auth-field">
                        <label>Key</label>
                        <Input
                          value={request.auth.apiKey?.key || ''}
                          onChange={(e) => {
                            if (activeTabId) {
                              updateRequest(activeTabId, {
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
                            }
                          }}
                          supportVariables
                        />
                      </div>
                      <div className="center-panel__auth-field">
                        <label>Value</label>
                        <Input
                          value={request.auth.apiKey?.value || ''}
                          onChange={(e) => {
                            if (activeTabId) {
                              updateRequest(activeTabId, {
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
                            }
                          }}
                          supportVariables
                        />
                      </div>
                      <div className="center-panel__auth-field">
                        <label>Add to</label>
                        <Dropdown
                          options={[
                            { value: 'header', label: 'Header' },
                            { value: 'query', label: 'Query Params' },
                          ]}
                          value={request.auth.apiKey?.addTo || 'header'}
                          onChange={(addTo) => {
                            if (activeTabId) {
                              updateRequest(activeTabId, {
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
                            }
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeRequestTab === 'headers' && (
                <div className="center-panel__headers">
                  <EditableTable
                    data={combinedHeadersData}
                    onChange={handleHeadersTableChange}
                    keyPlaceholder="Header"
                    valuePlaceholder="Value"
                    descriptionPlaceholder="Description"
                    keySuggestions={DEFAULT_HEADERS}
                    collectionEnvironment={selectedCollectionEnv}
                    onNavigateToVariable={handleNavigateToVariable}
                  />
                </div>
              )}

              {activeRequestTab === 'body' && (
                <div className="center-panel__body">
                  <div className="center-panel__body-type">
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
                        if (activeTabId) {
                          updateRequest(activeTabId, {
                            body: { 
                              ...request.body, 
                              type: type as 'none' | 'json' | 'form-data' | 'x-www-form-urlencoded' | 'raw'
                            },
                          });
                        }
                      }}
                    />
                  </div>

                  {request.body.type !== 'none' && request.body.type !== 'form-data' && request.body.type !== 'x-www-form-urlencoded' && (
                    <div className="center-panel__body-editor">
                      <CodeEditor
                        mode={request.body.type === 'json' ? 'json' : 'text'}
                        value={request.body.content}
                        onChange={handleBodyChange}
                        onLoad={handleEditorLoad}
                        placeholder={request.body.type === 'json' ? '{\n  "key": "value"\n}' : 'Enter request body'}
                        width="100%"
                        height="200px"
                      />
                    </div>
                  )}

                  {(request.body.type === 'form-data' || request.body.type === 'x-www-form-urlencoded') && (
                    <EditableTable
                      data={request.body.formData || []}
                      onChange={(formData) => {
                        if (activeTabId) {
                          updateRequest(activeTabId, {
                            body: { ...request.body, formData },
                          });
                        }
                      }}
                      keyPlaceholder="Key"
                      valuePlaceholder="Value"
                      showDescription={false}
                      collectionEnvironment={selectedCollectionEnv}
                      onNavigateToVariable={handleNavigateToVariable}
                    />
                  )}
                </div>
              )}

              {activeRequestTab === 'scripts' && (
                <div className="center-panel__scripts">
                  <div className="center-panel__script">
                    <label>Pre-request Script</label>
                    <div className="center-panel__script-editor">
                      <CodeEditor
                        mode="javascript"
                        value={request.scripts.pre}
                        onChange={(value) => {
                          if (activeTabId) {
                            updateRequest(activeTabId, {
                              scripts: { ...request.scripts, pre: value },
                            });
                          }
                        }}
                        onLoad={handleEditorLoad}
                        placeholder="// JavaScript code to run before request"
                        width="100%"
                        height="150px"
                      />
                    </div>
                  </div>
                  <div className="center-panel__script">
                    <label>Post-request Script</label>
                    <div className="center-panel__script-editor">
                      <CodeEditor
                        mode="javascript"
                        value={request.scripts.post}
                        onChange={(value) => {
                          if (activeTabId) {
                            updateRequest(activeTabId, {
                              scripts: { ...request.scripts, post: value },
                            });
                          }
                        }}
                        onLoad={handleEditorLoad}
                        placeholder="// JavaScript code to run after request"
                        width="100%"
                        height="150px"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeRequestTab === 'settings' && (
                <div className="center-panel__settings">
                  <p>Request-specific settings coming soon...</p>
                </div>
              )}
            </div>
          </div>
          </div>
          {/* End of Request Section */}
          

          {/* Response Section */}
          <div 
            className={`center-panel__response-section ${isResponseExpanded ? 'center-panel__response-section--horizontal' : ''}`}
            style={isResponseExpanded ? { width: responseWidth } : undefined}
          >
            {/* Horizontal resize handle - only show in horizontal mode */}
            {isResponseExpanded && (
              <div 
                className={`center-panel__resize-handle-horizontal ${isResizing ? 'active' : ''}`}
                onMouseDown={handleResizeMouseDown}
              />
            )}
            {/* Collapsed expand button - only show in vertical mode */}
            {isResponsePanelCollapsed && !isResponseExpanded && (
              <div className="center-panel__response-collapsed">
                <button 
                  className="center-panel__response-expand"
                  onClick={() => setIsResponsePanelCollapsed(false)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                    <polyline points="17 11 12 6 7 11" />
                    <polyline points="17 18 12 13 7 18" />
                  </svg>
                  <span>Show Response</span>
                </button>
              </div>
            )}
            {/* Response Viewer */}
            <div 
              className={`center-panel__response ${isResponsePanelCollapsed && !isResponseExpanded ? 'center-panel__response--hidden' : ''}`}
              style={!isResponseExpanded ? { height: isResponsePanelCollapsed ? 0 : responseHeight } : undefined}
              ref={resizeRef}
            >
              {!isResponsePanelCollapsed && !isResponseExpanded && (
                <div 
                  className={`center-panel__resize-handle ${isResizing ? 'active' : ''}`}
                  onMouseDown={handleResizeMouseDown}
                />
              )}
              {<ResponseViewer 
                execution={currentExecution} 
                isLoading={isLoading}
                height={responseHeight}
                specResponseInfo={specResponseInfo}
                onClose={!isResponseExpanded ? () => setIsResponsePanelCollapsed(true) : undefined}
                onExpandToggle={() => setIsResponseExpanded(!isResponseExpanded)}
                isExpanded={isResponseExpanded}
              />}
            </div>
          </div>
        </div>
      ) : (
        <div className="center-panel__empty">
          <p>Select a request or create a new one</p>
          <Button variant="primary" onClick={() => addTab()}>
            New Request
          </Button>
        </div>
      )}

      {/* Request History Modal */}
      <RequestHistoryModal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        request={request || null}
      />
    </div>
  );
};

export default CenterPanel;
