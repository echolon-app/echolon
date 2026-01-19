import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import ace from 'ace-builds';
import { Button, Input, Dropdown, TabBar, EditableTable, Tooltip, CodeEditor, TagInput } from '@/components/ui';
import { SendIcon, CodeIcon, HistoryIcon, CopyIcon, CheckIcon, SocketIcon, ShieldIcon } from '@/components/ui/icons';
import { useRequest, useEnvironments, useTheme, useCollections, useApp, useWebModeOptional } from '@/contexts';
import { storageManager } from '@/services';
import { HTTP_METHODS, METHOD_COLORS, DEFAULT_HEADERS } from '../../../../shared/constants';
import { HttpMethod, KeyValuePair, Collection, AuthType, AuthConfig } from '@/types';
import { extractSpecResponseInfo, buildResolvedUrl } from '@/utils';
import { isElectron } from '@/utils';
import { APP_VERSION } from '@/utils/environment';
import { ResponseViewer } from './ResponseViewer';
import { EnvironmentEditor } from './EnvironmentEditor';
import { CollectionEditor } from './CollectionEditor';
import { WebSocketPanel } from './WebSocketPanel';
import { WorkspaceEditor } from './WorkspaceEditor';
import { DiffViewer } from '@/components/panels/DiffViewer/DiffViewer';
import { RequestHistoryModal } from '@/components/modals';
import './CenterPanel.css';

const CUSTOM_METHOD_COLOR = '#9ca3af';

const getMethodColor = (method: string): string => {
  return METHOD_COLORS[method] || CUSTOM_METHOD_COLOR;
};

// Simple markdown renderer for description preview
const renderMarkdown = (text: string): string => {
  let html = text
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Code blocks (must be before inline code)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Line breaks
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');
  
  // Wrap in paragraph if not already wrapped
  if (!html.startsWith('<h') && !html.startsWith('<pre') && !html.startsWith('<li')) {
    html = '<p>' + html + '</p>';
  }
  
  // Wrap consecutive li elements in ul
  html = html.replace(/(<li>.*?<\/li>)+/g, '<ul>$&</ul>');
  
  return html;
};

// Sample script type
interface SampleScript {
  value: string;
  label: string;
  code?: string;
}

// Sample scripts for pre-request

const PRE_REQUEST_SAMPLES: SampleScript[] = [
  { value: '', label: 'Insert sample script...' },
  {
    value: 'set-env-var',
    label: 'Set Environment Variable',
    code: `// Set an environment variable (available across requests)
echo.setEnvVar('myVariable', 'myValue');

// Get an environment variable
const value = echo.getEnvVar('myVariable');
console.log('Variable value:', value);`,
  },
  {
    value: 'set-var',
    label: 'Set Runtime Variable',
    code: `// Set a runtime variable (request-scoped)
echo.setVar('tempValue', 'some data');

// Get a runtime variable
const temp = echo.getVar('tempValue');
console.log('Runtime var:', temp);`,
  },
  {
    value: 'timestamp',
    label: 'Generate Timestamp',
    code: `// Generate current timestamp
const timestamp = Date.now();
echo.setEnvVar('timestamp', timestamp.toString());

// Or use ISO format
const isoDate = new Date().toISOString();
echo.setEnvVar('isoTimestamp', isoDate);
console.log('Timestamp set:', isoDate);`,
  },
  {
    value: 'random-data',
    label: 'Generate Random Data',
    code: `// Generate random ID
const randomId = Math.random().toString(36).substring(2, 15);
echo.setEnvVar('randomId', randomId);

// Generate random number between 1-100
const randomNum = Math.floor(Math.random() * 100) + 1;
echo.setEnvVar('randomNumber', randomNum.toString());
console.log('Random ID:', randomId);`,
  },
  {
    value: 'uuid',
    label: 'Generate UUID',
    code: `// Generate a UUID v4
const uuid = crypto.randomUUID();
echo.setEnvVar('uuid', uuid);
console.log('Generated UUID:', uuid);`,
  },
  {
    value: 'basic-auth-header',
    label: 'Encode Basic Auth',
    code: `// Encode credentials for Basic Auth header
const username = echo.getEnvVar('username') || 'user';
const password = echo.getEnvVar('password') || 'pass';
const encoded = btoa(\`\${username}:\${password}\`);
echo.setEnvVar('basicAuth', \`Basic \${encoded}\`);
console.log('Basic Auth header encoded');`,
  },
  {
    value: 'modify-request',
    label: 'Modify Request',
    code: `// Modify request before sending
// Add or modify headers
req.setHeader('X-Custom-Header', 'custom-value');
req.setHeader('X-Timestamp', Date.now().toString());

// Log current request details
console.log('Request URL:', req.getUrl());
console.log('Request Method:', req.getMethod());
console.log('Request Headers:', req.getHeaders());`,
  },
  {
    value: 'log-request',
    label: 'Log Request Details',
    code: `// Log request details for debugging
console.log('URL:', req.url);
console.log('Method:', req.method);
console.log('Headers:', req.headers);
if (req.body) {
  console.log('Body:', req.body);
}`,
  },
];

// Sample scripts for post-request

const POST_REQUEST_SAMPLES: SampleScript[] = [
  { value: '', label: 'Insert sample script...' },
  {
    value: 'check-status',
    label: 'Check Status Code',
    code: `// Check if response status is successful
if (res.status >= 200 && res.status < 300) {
  console.log('✓ Request successful:', res.status, res.statusText);
} else {
  console.error('✗ Request failed:', res.status, res.statusText);
}`,
  },
  {
    value: 'parse-json',
    label: 'Parse JSON Response',
    code: `// Parse JSON response body
try {
  const data = JSON.parse(res.getBody());
  console.log('Response data:', data);
} catch (e) {
  console.error('Failed to parse JSON:', e.message);
}`,
  },
  {
    value: 'extract-token',
    label: 'Extract & Save Token',
    code: `// Extract token from response and save to environment
try {
  const data = JSON.parse(res.body);
  const token = data.token || data.access_token;
  if (token) {
    echo.setEnvVar('authToken', token);
    console.log('✓ Token saved to environment variable "authToken"');
  } else {
    console.warn('No token found in response');
  }
} catch (e) {
  console.error('Failed to extract token:', e.message);
}`,
  },
  {
    value: 'extract-id',
    label: 'Extract & Save ID',
    code: `// Extract ID from response and save to environment
try {
  const data = JSON.parse(res.body);
  if (data.id) {
    echo.setEnvVar('lastId', data.id.toString());
    console.log('✓ ID saved:', data.id);
  } else {
    console.warn('No ID found in response');
  }
} catch (e) {
  console.error('Failed to extract ID:', e.message);
}`,
  },
  {
    value: 'assert-contains',
    label: 'Assert Response Contains',
    code: `// Assert response body contains expected value
const expectedValue = 'success';
if (res.body.includes(expectedValue)) {
  console.log('✓ Response contains expected value');
} else {
  console.error('✗ Response does not contain:', expectedValue);
}`,
  },
  {
    value: 'measure-time',
    label: 'Log Response Time',
    code: `// Log response time
console.log('Response time:', res.responseTime, 'ms');
if (res.responseTime > 1000) {
  console.warn('⚠ Slow response (> 1s)');
} else if (res.responseTime < 100) {
  console.log('✓ Fast response');
}`,
  },
  {
    value: 'check-headers',
    label: 'Check Response Headers',
    code: `// Check specific response headers
const contentType = res.getHeader('content-type');
console.log('Content-Type:', contentType);

// Check for caching headers
const cacheControl = res.getHeader('cache-control');
if (cacheControl) {
  console.log('Cache-Control:', cacheControl);
}

// Log all headers
console.log('All headers:', res.getHeaders());`,
  },
  {
    value: 'log-response',
    label: 'Log Response Details',
    code: `// Log response details for debugging
console.log('Status:', res.status, res.statusText);
console.log('Response Time:', res.responseTime, 'ms');
console.log('Headers:', res.headers);
console.log('Body preview:', res.body.substring(0, 500));`,
  },
];

type RequestTab = 'params' | 'auth' | 'headers' | 'body' | 'scripts' | 'tags' | 'description' | 'settings';

const requestTabs = [
  { id: 'params', title: 'Params' },
  { id: 'auth', title: 'Auth' },
  { id: 'headers', title: 'Headers' },
  { id: 'body', title: 'Body' },
  { id: 'scripts', title: 'Scripts' },
  { id: 'tags', title: 'Tags' },
  { id: 'description', title: 'Description' },
 // { id: 'settings', title: 'Settings' },
];

interface CenterPanelProps {
  onShowCodePanel?: () => void;
}

export const CenterPanel: React.FC<CenterPanelProps> = ({ onShowCodePanel }) => {
  const { resolvedTheme } = useTheme();
  const { 
    workspaceTabs: tabs, 
    tabs: allTabs,
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
  const { customHttpMethods, addCustomHttpMethod, settings, updateSettings, openSettingsModal, isWebMode } = useApp();
  const webMode = useWebModeOptional();
  const viewMode = webMode?.viewMode ?? 'tabs';
  const readonly = webMode?.readonly ?? false;
  
  // In reference view mode (web), hide the tab bar
  const hideTabBar = isWebMode && viewMode === 'reference';
  
  // Track if we've auto-opened a tab to prevent infinite loops
  const hasAutoOpenedTab = useRef(false);
  
  // Get active proxy profile (works in both web and Electron modes)
  const activeProxyProfile = useMemo(() => {
    if (!settings.activeProxyProfileId) return null;
    return settings.proxyProfiles?.find(p => p.id === settings.activeProxyProfileId) || null;
  }, [settings.activeProxyProfileId, settings.proxyProfiles]);
  const [activeRequestTab, setActiveRequestTabState] = useState<RequestTab>(() => {
    // Restore active request tab from localStorage
    const saved = localStorage.getItem('echolon_active_request_tab');
    if (saved && ['params', 'auth', 'headers', 'body', 'scripts', 'tags', 'description', 'settings'].includes(saved)) {
      return saved as RequestTab;
    }
    return 'params';
  });
  const [descriptionPreviewMode, setDescriptionPreviewMode] = useState(false);
  
  // Wrapper to persist active request tab
  const setActiveRequestTab = useCallback((tab: RequestTab) => {
    setActiveRequestTabState(tab);
    localStorage.setItem('echolon_active_request_tab', tab);
  }, []);
  
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
  const [urlCopied, setUrlCopied] = useState(false);
  const resizeRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // In readonly web mode, auto-open collection reference tab if no tab is active
  // This ensures we never show the empty state in embedded readonly mode
  useEffect(() => {
    if (!isWebMode || !readonly || hasAutoOpenedTab.current) return;
    if (activeTab) return; // Already have an active tab
    if (collections.length === 0) return; // No collections yet
    
    // Auto-open the first collection's reference tab
    hasAutoOpenedTab.current = true;
    addCollectionTab(collections[0], 'reference');
    console.log('[CenterPanel] Auto-opened collection reference tab for readonly web mode');
  }, [isWebMode, readonly, activeTab, collections, addCollectionTab]);

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
  // Include stringified environments to catch deep changes like color updates
  const envString = JSON.stringify(requestCollection?.environments);
  const selectedCollectionEnv = useMemo(() => {
    if (!requestCollection?.environments || !requestCollection.defaultEnvironmentId) {
      return null;
    }
    return requestCollection.environments.find(e => e.id === requestCollection.defaultEnvironmentId) || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envString, requestCollection?.defaultEnvironmentId]);
  
  // Get collection-level headers that will be injected
  const collectionHeaders = requestCollection?.headers?.filter(h => h.enabled && h.key) || [];

  // Get overrides for inherited collection headers (stored in request headers with special prefix)
  const inheritedHeaderOverrides = useMemo(() => {
    const overrides = new Map<string, boolean>();
    (request?.headers ?? [])
      .filter(h => h.id?.startsWith('__inherited_header_override__'))
      .forEach(h => {
        // The key stores the original inherited header ID
        overrides.set(h.key, h.enabled);
      });
    return overrides;
  }, [request?.headers]);

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
      // Apply any request-level overrides for disabled state
      ...collectionHeaders.map(h => ({
        ...h,
        inheritedFrom: requestCollection?.name,
        enabled: inheritedHeaderOverrides.has(h.id) ? (inheritedHeaderOverrides.get(h.id) ?? h.enabled) : h.enabled,
      })),
      // Request-level headers (excluding system and inherited override markers)
      ...(request.headers ?? []).filter(h => 
        !h.id?.startsWith('__user_agent_override__') && 
        !h.id?.startsWith('__inherited_header_override__')
      ),
    ];
  }, [request, showSystemUserAgent, userAgentOverride, collectionHeaders, requestCollection?.name, inheritedHeaderOverrides]);

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
      
      // Also sync to collection
      if (request.collectionId) {
        updateCollectionRequest(request.collectionId, request.id, { method: upperMethod as HttpMethod });
      }
      
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

  // Extract path variables from URL (e.g., :id, :userId, {id}, {userId})
  const extractPathVariables = useCallback((url: string): string[] => {
    const results: string[] = [];
    
    // Match :paramName patterns (Express-style, not inside {{ }} which are environment variables)
    const colonMatches = url.match(/(?<!\{):([a-zA-Z_][a-zA-Z0-9_]*)/g);
    if (colonMatches) {
      results.push(...colonMatches.map(m => m.slice(1))); // Remove : prefix
    }
    
    // Match {paramName} patterns (OpenAPI-style, single braces only, not {{var}})
    const braceMatches = url.match(/(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})/g);
    if (braceMatches) {
      results.push(...braceMatches.map(m => m.slice(1, -1))); // Remove { and } 
    }
    
    return [...new Set(results)]; // Dedupe
  }, []);

  // Get path variables from the current URL
  const urlPathVariables = useMemo(() => {
    if (!request?.url) return [];
    return extractPathVariables(request.url);
  }, [request?.url, extractPathVariables]);

  // Sync path params with URL path variables
  useEffect(() => {
    if (!activeTabId || !request) return;
    
    const currentPathVars = extractPathVariables(request.url);
    const existingParams = request.pathParams || [];
    
    // Check if we need to update
    const existingKeys = existingParams.map(p => p.key);
    const needsUpdate = currentPathVars.some(v => !existingKeys.includes(v)) ||
                        existingParams.some(p => p.key && !currentPathVars.includes(p.key));
    
    if (needsUpdate) {
      // Create new pathParams array preserving existing values
      const newPathParams = currentPathVars.map(varName => {
        const existing = existingParams.find(p => p.key === varName);
        return existing || {
          id: crypto.randomUUID(),
          key: varName,
          value: '',
          enabled: true,
        };
      });
      
      updateRequest(activeTabId, { pathParams: newPathParams });
    }
  }, [activeTabId, request?.url, request?.pathParams, extractPathVariables, updateRequest]);

  // Handle path params change
  const handlePathParamsChange = useCallback((params: KeyValuePair[]) => {
    if (!activeTabId) return;
    updateRequest(activeTabId, { pathParams: params });
  }, [activeTabId, updateRequest]);

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
    
    // Also sync to collection if this request belongs to one
    if (request?.collectionId) {
      const updates = newUrl.includes('?') && newParams.length > 0
        ? { url: newUrl, queryParams: newParams }
        : { url: newUrl };
      updateCollectionRequest(request.collectionId, request.id, updates);
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
    
    // Also sync to collection
    if (request.collectionId) {
      updateCollectionRequest(request.collectionId, request.id, { 
        queryParams: params,
        url: newUrl 
      });
    }
  };

  const handleHeadersChange = (headers: KeyValuePair[]) => {
    if (activeTabId) {
      updateRequest(activeTabId, { headers });
      // Also sync to collection
      if (request?.collectionId) {
        updateCollectionRequest(request.collectionId, request.id, { headers });
      }
    }
  };

  // Helper to update auth - syncs both tab state and collection
  const handleAuthChange = (authUpdate: Partial<AuthConfig>) => {
    if (!activeTabId || !request) return;
    const newAuth: AuthConfig = { ...request.auth, ...authUpdate };
    console.log('[CenterPanel] handleAuthChange called:', { 
      requestId: request.id, 
      requestName: request.name,
      collectionId: request.collectionId,
      authUpdate, 
      newAuth 
    });
    updateRequest(activeTabId, { auth: newAuth });
    // Also sync to collection
    if (request.collectionId) {
      console.log('[CenterPanel] Syncing auth to collection:', request.collectionId);
      updateCollectionRequest(request.collectionId, request.id, { auth: newAuth });
    } else {
      console.warn('[CenterPanel] Request has no collectionId - auth not synced to collection');
    }
  };

  // Memoized onChange handler for headers table (handles system User-Agent toggling and inherited header overrides)
  const handleHeadersTableChange = useCallback((allHeaders: KeyValuePair[]) => {
    if (!request) return;
    
    // Find the system User-Agent header state
    const systemHeader = allHeaders.find(h => h.id?.startsWith('__user_agent_override__'));
    
    // Get request-level headers (filter out inherited and system display headers)
    let requestHeaders = allHeaders.filter(h => !h.inheritedFrom && !(h as any).isSystem);
    
    // Remove any existing override markers (we'll re-add them based on current state)
    requestHeaders = requestHeaders.filter(h => 
      !h.id?.startsWith('__user_agent_override__') && 
      !h.id?.startsWith('__inherited_header_override__')
    );
    
    // Handle system User-Agent override
    if (systemHeader && showSystemUserAgent) {
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
    
    // Handle inherited header overrides
    // Find inherited headers that have been toggled off (different from their original state)
    const inheritedHeaders = allHeaders.filter(h => h.inheritedFrom && !h.isSystem);
    inheritedHeaders.forEach(ih => {
      // Find the original collection header
      const originalHeader = collectionHeaders.find(ch => ch.id === ih.id);
      if (originalHeader) {
        // If the enabled state differs from original, store an override
        if (ih.enabled !== originalHeader.enabled) {
          requestHeaders.push({
            id: '__inherited_header_override__' + ih.id,
            key: ih.id, // Store the original header ID in the key field
            value: '',
            enabled: ih.enabled,
            description: `Override for inherited header: ${ih.key}`,
          });
        }
      }
    });
    
    handleHeadersChange(requestHeaders);
  }, [request, showSystemUserAgent, handleHeadersChange, collectionHeaders]);

  const handleBodyChange = (content: string) => {
    if (activeTabId && request) {
      updateRequest(activeTabId, { 
        body: { ...request.body, content } 
      });
      // Also sync to collection
      if (request.collectionId) {
        updateCollectionRequest(request.collectionId, request.id, { 
        body: { ...request.body, content } 
      });
      }
    }
  };

  const handleSend = async () => {
    await sendRequest();
  };

  const handleCopyUrl = useCallback(async () => {
    if (!request) return;
    
    // Build the fully resolved URL (env vars + path params + query params)
    const resolvedUrl = buildResolvedUrl(request, activeEnvironment, requestCollection);
    
    try {
      await navigator.clipboard.writeText(resolvedUrl);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy URL:', error);
    }
  }, [request, activeEnvironment, requestCollection]);

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
    ) : tab.type === 'websocket' ? (
      <span className="tab-websocket-badge">
        <SocketIcon />
      </span>
    ) : undefined,
  }));

  return (
    <div className="center-panel">
      {/* Request Tabs - hidden in reference view mode (web) */}
      {!hideTabBar && (
        <TabBar
          tabs={tabItems}
          activeTab={activeTabId || ''}
          onTabChange={setActiveTab}
          onTabClose={closeTab}
          onTabReorder={(newTabs) => {
            // Build new tabs order: workspace tabs in new order, other tabs unchanged
            const workspaceTabIds = new Set(tabs.map(t => t.id));
            const otherTabs = allTabs.filter(t => !workspaceTabIds.has(t.id));
            const reorderedWorkspaceTabs = newTabs.map(t => tabs.find(tab => tab.id === t.id)!);
            reorderTabs([...reorderedWorkspaceTabs, ...otherTabs]);
          }}
          onTabRename={handleTabRename}
          onNewTab={() => addTab()}
          showAddButton
          className="center-panel__tabs"
        />
      )}

      {/* Environment Editor */}
      {activeTab?.type === 'environment' && activeTab.environmentId ? (
        <EnvironmentEditor environmentId={activeTab.environmentId} />
      ) : activeTab?.type === 'collection' && activeTab.collectionId && collections.some(c => c.id === activeTab.collectionId) ? (
        <CollectionEditor collectionId={activeTab.collectionId} />
      ) : activeTab?.type === 'websocket' && activeTab.websocket ? (
        <WebSocketPanel websocket={activeTab.websocket} tabId={activeTab.id} />
      ) : activeTab?.type === 'workspace' && activeTab.workspaceId ? (
        <WorkspaceEditor workspaceId={activeTab.workspaceId} />
      ) : activeTab?.type === 'diff' && activeTab.diff ? (
        <DiffViewer
          filePath={activeTab.diff.filePath}
          oldContent={activeTab.diff.oldContent}
          newContent={activeTab.diff.newContent}
          status={activeTab.diff.status}
        />
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
              <div className="center-panel__url-wrapper">
                <Input
                  value={request.url}
                  onChange={handleUrlChange}
                  placeholder="Enter request URL"
                  supportVariables
                  collectionEnvironment={selectedCollectionEnv}
                  pathParams={request.pathParams}
                  onNavigateToVariable={handleNavigateToVariable}
                  className="center-panel__url"
                />
                {activeProxyProfile && (
                  <Tooltip content={`Using proxy: ${activeProxyProfile.name}\n${activeProxyProfile.url}`}>
                    <button
                      className="center-panel__proxy-indicator"
                      onClick={() => openSettingsModal('proxy')}
                      title="Proxy active - click to configure"
                    >
                      <ShieldIcon />
                    </button>
                  </Tooltip>
                )}
              </div>
              <Button
                variant="primary"
                size="md"
                onClick={handleSend}
                loading={isLoading}
                icon={<SendIcon />}
                className="center-panel__send"
              >
                Send <kbd className="center-panel__send-shortcut">⌘↩</kbd>
              </Button>
              <div className="center-panel__url-actions">
                <Tooltip content={urlCopied ? "Copied!" : "Copy URL (resolved)"}>
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={handleCopyUrl}
                    icon={urlCopied ? <CheckIcon /> : <CopyIcon />}
                    className={`center-panel__copy-btn ${urlCopied ? 'center-panel__copy-btn--copied' : ''}`}
                  />
                </Tooltip>
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
                    {tab.id === 'params' && (request.queryParams.filter(p => p.key).length + (request.pathParams?.length || 0)) > 0 && (
                      <span className="center-panel__option-badge">
                        {request.queryParams.filter(p => p.key).length + (request.pathParams?.length || 0)}
                      </span>
                    )}
                    {tab.id === 'headers' && request.headers.filter(h => h.key).length > 0 && (
                      <span className="center-panel__option-badge">
                        {request.headers.filter(h => h.key).length}
                      </span>
                    )}
                    {tab.id === 'tags' && (request.tags?.length || 0) > 0 && (
                      <span className="center-panel__option-badge">
                        {request.tags?.length || 0}
                      </span>
                    )}
                    {tab.id === 'description' && request.description && (
                      <span className="center-panel__option-badge center-panel__option-badge--dot" />
                    )}
                  </button>
                ))}
              </div>

            <div className="center-panel__option-content">
              {activeRequestTab === 'params' && (
                <div className="center-panel__params">
                  {/* Path Variables */}
                  {urlPathVariables.length > 0 && (
                    <div className="center-panel__params-section center-panel__params-section--path">
                      <div className="center-panel__params-section-header">
                        <span className="center-panel__params-section-title">Path Variables</span>
                        <span className="center-panel__params-section-count">{urlPathVariables.length}</span>
                      </div>
                      <EditableTable
                        data={request.pathParams || []}
                        onChange={handlePathParamsChange}
                        keyPlaceholder="Variable"
                        valuePlaceholder="Value"
                        descriptionPlaceholder="Description"
                        collectionEnvironment={selectedCollectionEnv}
                        onNavigateToVariable={handleNavigateToVariable}
                        disableKeyEdit
                        isPathParams
                      />
                    </div>
                  )}
                  
                  {/* Query Parameters */}
                  <div className="center-panel__params-section">
                    {urlPathVariables.length > 0 && (
                      <div className="center-panel__params-section-header">
                        <span className="center-panel__params-section-title">Query Parameters</span>
                        {request.queryParams.filter(p => p.key).length > 0 && (
                          <span className="center-panel__params-section-count">{request.queryParams.filter(p => p.key).length}</span>
                        )}
                      </div>
                    )}
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
                        { value: 'oauth2', label: 'OAuth 2.0' },
                        { value: 'jwt', label: 'JWT Bearer' },
                        { value: 'digest', label: 'Digest Auth' },
                        { value: 'aws-signature', label: 'AWS Signature' },
                      ]}
                      value={request.auth.type}
                      onChange={(type) => {
                        handleAuthChange({ type: type as AuthType });
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
                            handleAuthChange({
                              basic: { ...request.auth.basic, username: e.target.value, password: request.auth.basic?.password || '' },
                            });
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
                            handleAuthChange({
                              basic: { ...request.auth.basic, username: request.auth.basic?.username || '', password: e.target.value },
                            });
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
                            handleAuthChange({
                              bearer: { token: e.target.value },
                            });
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
                            handleAuthChange({
                              apiKey: { 
                                ...request.auth.apiKey, 
                                key: e.target.value,
                                value: request.auth.apiKey?.value || '',
                                addTo: request.auth.apiKey?.addTo || 'header'
                              },
                            });
                          }}
                          supportVariables
                        />
                      </div>
                      <div className="center-panel__auth-field">
                        <label>Value</label>
                        <Input
                          value={request.auth.apiKey?.value || ''}
                          onChange={(e) => {
                            handleAuthChange({
                              apiKey: { 
                                ...request.auth.apiKey, 
                                key: request.auth.apiKey?.key || '',
                                value: e.target.value,
                                addTo: request.auth.apiKey?.addTo || 'header'
                              },
                            });
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
                            handleAuthChange({
                              apiKey: { 
                                ...request.auth.apiKey,
                                key: request.auth.apiKey?.key || '',
                                value: request.auth.apiKey?.value || '',
                                addTo: addTo as 'header' | 'query'
                              },
                            });
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {request.auth.type === 'oauth2' && (
                    <div className="center-panel__auth-fields">
                      <div className="center-panel__auth-field">
                        <label>Grant Type</label>
                        <Dropdown
                          options={[
                            { value: 'authorization_code', label: 'Authorization Code' },
                            { value: 'client_credentials', label: 'Client Credentials' },
                            { value: 'password', label: 'Password' },
                            { value: 'implicit', label: 'Implicit' },
                          ]}
                          value={request.auth.oauth2?.grantType || 'authorization_code'}
                          onChange={(grantType) => {
                            handleAuthChange({
                              oauth2: { 
                                ...request.auth.oauth2,
                                grantType: grantType as 'authorization_code' | 'client_credentials' | 'password' | 'implicit',
                                accessToken: request.auth.oauth2?.accessToken || '',
                                tokenType: request.auth.oauth2?.tokenType || 'Bearer',
                                clientId: request.auth.oauth2?.clientId || '',
                              },
                            });
                          }}
                        />
                      </div>
                      <div className="center-panel__auth-field">
                        <label>Access Token</label>
                        <Input
                          value={request.auth.oauth2?.accessToken || ''}
                          onChange={(e) => {
                            handleAuthChange({
                              oauth2: { 
                                ...request.auth.oauth2,
                                grantType: request.auth.oauth2?.grantType || 'authorization_code',
                                accessToken: e.target.value,
                                tokenType: request.auth.oauth2?.tokenType || 'Bearer',
                                clientId: request.auth.oauth2?.clientId || '',
                              },
                            });
                          }}
                          placeholder="Enter access token or use token URL to fetch"
                          supportVariables
                        />
                      </div>
                      <div className="center-panel__auth-field">
                        <label>Token Type</label>
                        <Input
                          value={request.auth.oauth2?.tokenType || 'Bearer'}
                          onChange={(e) => {
                            handleAuthChange({
                              oauth2: { 
                                ...request.auth.oauth2,
                                grantType: request.auth.oauth2?.grantType || 'authorization_code',
                                accessToken: request.auth.oauth2?.accessToken || '',
                                tokenType: e.target.value,
                                clientId: request.auth.oauth2?.clientId || '',
                              },
                            });
                          }}
                          supportVariables
                        />
                      </div>
                      <div className="center-panel__auth-field">
                        <label>Client ID</label>
                        <Input
                          value={request.auth.oauth2?.clientId || ''}
                          onChange={(e) => {
                            handleAuthChange({
                              oauth2: { 
                                ...request.auth.oauth2,
                                grantType: request.auth.oauth2?.grantType || 'authorization_code',
                                accessToken: request.auth.oauth2?.accessToken || '',
                                tokenType: request.auth.oauth2?.tokenType || 'Bearer',
                                clientId: e.target.value,
                              },
                            });
                          }}
                          supportVariables
                        />
                      </div>
                      <div className="center-panel__auth-field">
                        <label>Client Secret</label>
                        <Input
                          type="password"
                          value={request.auth.oauth2?.clientSecret || ''}
                          onChange={(e) => {
                            handleAuthChange({
                              oauth2: { 
                                ...request.auth.oauth2,
                                grantType: request.auth.oauth2?.grantType || 'authorization_code',
                                accessToken: request.auth.oauth2?.accessToken || '',
                                tokenType: request.auth.oauth2?.tokenType || 'Bearer',
                                clientId: request.auth.oauth2?.clientId || '',
                                clientSecret: e.target.value,
                              },
                            });
                          }}
                          supportVariables
                        />
                      </div>
                      <div className="center-panel__auth-field">
                        <label>Token URL</label>
                        <Input
                          value={request.auth.oauth2?.tokenUrl || ''}
                          onChange={(e) => {
                            handleAuthChange({
                              oauth2: { 
                                ...request.auth.oauth2,
                                grantType: request.auth.oauth2?.grantType || 'authorization_code',
                                accessToken: request.auth.oauth2?.accessToken || '',
                                tokenType: request.auth.oauth2?.tokenType || 'Bearer',
                                clientId: request.auth.oauth2?.clientId || '',
                                tokenUrl: e.target.value,
                              },
                            });
                          }}
                          placeholder="https://oauth.example.com/token"
                          supportVariables
                        />
                      </div>
                      <div className="center-panel__auth-field">
                        <label>Scope</label>
                        <Input
                          value={request.auth.oauth2?.scope || ''}
                          onChange={(e) => {
                            handleAuthChange({
                              oauth2: { 
                                ...request.auth.oauth2,
                                grantType: request.auth.oauth2?.grantType || 'authorization_code',
                                accessToken: request.auth.oauth2?.accessToken || '',
                                tokenType: request.auth.oauth2?.tokenType || 'Bearer',
                                clientId: request.auth.oauth2?.clientId || '',
                                scope: e.target.value,
                              },
                            });
                          }}
                          placeholder="read write profile"
                          supportVariables
                        />
                      </div>
                    </div>
                  )}

                  {request.auth.type === 'jwt' && (
                    <div className="center-panel__auth-fields">
                      <div className="center-panel__auth-field">
                        <label>JWT Token</label>
                        <Input
                          value={request.auth.jwt?.token || ''}
                          onChange={(e) => {
                            handleAuthChange({
                              jwt: { 
                                ...request.auth.jwt,
                                token: e.target.value,
                              },
                            });
                          }}
                          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                          supportVariables
                        />
                      </div>
                      <div className="center-panel__auth-field">
                        <label>Prefix</label>
                        <Input
                          value={request.auth.jwt?.prefix || 'Bearer'}
                          onChange={(e) => {
                            handleAuthChange({
                              jwt: { 
                                ...request.auth.jwt,
                                token: request.auth.jwt?.token || '',
                                prefix: e.target.value,
                              },
                            });
                          }}
                          placeholder="Bearer"
                          supportVariables
                        />
                      </div>
                      <div className="center-panel__auth-field">
                        <label>Header Name</label>
                        <Input
                          value={request.auth.jwt?.headerName || 'Authorization'}
                          onChange={(e) => {
                            handleAuthChange({
                              jwt: { 
                                ...request.auth.jwt,
                                token: request.auth.jwt?.token || '',
                                headerName: e.target.value,
                              },
                            });
                          }}
                          placeholder="Authorization"
                          supportVariables
                        />
                      </div>
                    </div>
                  )}

                  {request.auth.type === 'digest' && (
                    <div className="center-panel__auth-fields">
                      <div className="center-panel__auth-field">
                        <label>Username</label>
                        <Input
                          value={request.auth.digest?.username || ''}
                          onChange={(e) => {
                            handleAuthChange({
                              digest: { 
                                ...request.auth.digest,
                                username: e.target.value,
                                password: request.auth.digest?.password || '',
                              },
                            });
                          }}
                          supportVariables
                        />
                      </div>
                      <div className="center-panel__auth-field">
                        <label>Password</label>
                        <Input
                          type="password"
                          value={request.auth.digest?.password || ''}
                          onChange={(e) => {
                            handleAuthChange({
                              digest: { 
                                ...request.auth.digest,
                                username: request.auth.digest?.username || '',
                                password: e.target.value,
                              },
                            });
                          }}
                          supportVariables
                        />
                      </div>
                      <div className="center-panel__auth-field">
                        <label>Realm (optional)</label>
                        <Input
                          value={request.auth.digest?.realm || ''}
                          onChange={(e) => {
                            handleAuthChange({
                              digest: { 
                                ...request.auth.digest,
                                username: request.auth.digest?.username || '',
                                password: request.auth.digest?.password || '',
                                realm: e.target.value,
                              },
                            });
                          }}
                          supportVariables
                        />
                      </div>
                      <div className="center-panel__auth-field">
                        <label>Algorithm</label>
                        <Dropdown
                          options={[
                            { value: 'MD5', label: 'MD5' },
                            { value: 'MD5-sess', label: 'MD5-sess' },
                            { value: 'SHA-256', label: 'SHA-256' },
                            { value: 'SHA-256-sess', label: 'SHA-256-sess' },
                          ]}
                          value={request.auth.digest?.algorithm || 'MD5'}
                          onChange={(algorithm) => {
                            handleAuthChange({
                              digest: { 
                                ...request.auth.digest,
                                username: request.auth.digest?.username || '',
                                password: request.auth.digest?.password || '',
                                algorithm: algorithm as 'MD5' | 'MD5-sess' | 'SHA-256' | 'SHA-256-sess',
                              },
                            });
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {request.auth.type === 'aws-signature' && (
                    <div className="center-panel__auth-fields">
                      <div className="center-panel__auth-field">
                        <label>Access Key ID</label>
                        <Input
                          value={request.auth.awsSignature?.accessKeyId || ''}
                          onChange={(e) => {
                            handleAuthChange({
                              awsSignature: { 
                                ...request.auth.awsSignature,
                                accessKeyId: e.target.value,
                                secretAccessKey: request.auth.awsSignature?.secretAccessKey || '',
                                region: request.auth.awsSignature?.region || '',
                                service: request.auth.awsSignature?.service || '',
                              },
                            });
                          }}
                          supportVariables
                        />
                      </div>
                      <div className="center-panel__auth-field">
                        <label>Secret Access Key</label>
                        <Input
                          type="password"
                          value={request.auth.awsSignature?.secretAccessKey || ''}
                          onChange={(e) => {
                            handleAuthChange({
                              awsSignature: { 
                                ...request.auth.awsSignature,
                                accessKeyId: request.auth.awsSignature?.accessKeyId || '',
                                secretAccessKey: e.target.value,
                                region: request.auth.awsSignature?.region || '',
                                service: request.auth.awsSignature?.service || '',
                              },
                            });
                          }}
                          supportVariables
                        />
                      </div>
                      <div className="center-panel__auth-field">
                        <label>Region</label>
                        <Input
                          value={request.auth.awsSignature?.region || ''}
                          onChange={(e) => {
                            handleAuthChange({
                              awsSignature: { 
                                ...request.auth.awsSignature,
                                accessKeyId: request.auth.awsSignature?.accessKeyId || '',
                                secretAccessKey: request.auth.awsSignature?.secretAccessKey || '',
                                region: e.target.value,
                                service: request.auth.awsSignature?.service || '',
                              },
                            });
                          }}
                          placeholder="us-east-1"
                          supportVariables
                        />
                      </div>
                      <div className="center-panel__auth-field">
                        <label>Service</label>
                        <Input
                          value={request.auth.awsSignature?.service || ''}
                          onChange={(e) => {
                            handleAuthChange({
                              awsSignature: { 
                                ...request.auth.awsSignature,
                                accessKeyId: request.auth.awsSignature?.accessKeyId || '',
                                secretAccessKey: request.auth.awsSignature?.secretAccessKey || '',
                                region: request.auth.awsSignature?.region || '',
                                service: e.target.value,
                              },
                            });
                          }}
                          placeholder="s3, execute-api, etc."
                          supportVariables
                        />
                      </div>
                      <div className="center-panel__auth-field">
                        <label>Session Token (optional)</label>
                        <Input
                          value={request.auth.awsSignature?.sessionToken || ''}
                          onChange={(e) => {
                            handleAuthChange({
                              awsSignature: { 
                                ...request.auth.awsSignature,
                                accessKeyId: request.auth.awsSignature?.accessKeyId || '',
                                secretAccessKey: request.auth.awsSignature?.secretAccessKey || '',
                                region: request.auth.awsSignature?.region || '',
                                service: request.auth.awsSignature?.service || '',
                                sessionToken: e.target.value,
                              },
                            });
                          }}
                          supportVariables
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
                        height="100%"
                        supportVariables
                        collectionEnvironment={selectedCollectionEnv}
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
                    <div className="center-panel__script-header">
                    <label>Pre-request Script</label>
                      <Dropdown
                        options={PRE_REQUEST_SAMPLES.map(s => ({ value: s.value, label: s.label }))}
                        value=""
                        onChange={(value) => {
                          const sample = PRE_REQUEST_SAMPLES.find(s => s.value === value);
                          if (sample?.code && activeTabId) {
                            const currentScript = request.scripts.pre;
                            const newScript = currentScript
                              ? `${currentScript}\n\n${sample.code}`
                              : sample.code;
                            const scriptsUpdate = { scripts: { ...request.scripts, pre: newScript } };
                            updateRequest(activeTabId, scriptsUpdate);
                            // Sync to collection for file persistence
                            if (request.collectionId) {
                              updateCollectionRequest(request.collectionId, request.id, scriptsUpdate);
                            }
                          }
                        }}
                        size="sm"
                        className="center-panel__script-samples"
                      />
                    </div>
                    <div className="center-panel__script-editor">
                      <CodeEditor
                        mode="javascript"
                        value={request.scripts.pre}
                        onChange={(value) => {
                          if (activeTabId) {
                            const scriptsUpdate = { scripts: { ...request.scripts, pre: value } };
                            updateRequest(activeTabId, scriptsUpdate);
                            // Sync to collection for file persistence
                            if (request.collectionId) {
                              updateCollectionRequest(request.collectionId, request.id, scriptsUpdate);
                            }
                          }
                        }}
                        onLoad={handleEditorLoad}
                        placeholder="// JavaScript code to run before request"
                        width="100%"
                        height="150px"
                        scriptContext="pre"
                      />
                    </div>
                  </div>
                  <div className="center-panel__script">
                    <div className="center-panel__script-header">
                    <label>Post-request Script</label>
                      <Dropdown
                        options={POST_REQUEST_SAMPLES.map(s => ({ value: s.value, label: s.label }))}
                        value=""
                        onChange={(value) => {
                          const sample = POST_REQUEST_SAMPLES.find(s => s.value === value);
                          if (sample?.code && activeTabId) {
                            const currentScript = request.scripts.post;
                            const newScript = currentScript
                              ? `${currentScript}\n\n${sample.code}`
                              : sample.code;
                            const scriptsUpdate = { scripts: { ...request.scripts, post: newScript } };
                            updateRequest(activeTabId, scriptsUpdate);
                            // Sync to collection for file persistence
                            if (request.collectionId) {
                              updateCollectionRequest(request.collectionId, request.id, scriptsUpdate);
                            }
                          }
                        }}
                        size="sm"
                        className="center-panel__script-samples"
                      />
                    </div>
                    <div className="center-panel__script-editor">
                      <CodeEditor
                        mode="javascript"
                        value={request.scripts.post}
                        onChange={(value) => {
                          if (activeTabId) {
                            const scriptsUpdate = { scripts: { ...request.scripts, post: value } };
                            updateRequest(activeTabId, scriptsUpdate);
                            // Sync to collection for file persistence
                            if (request.collectionId) {
                              updateCollectionRequest(request.collectionId, request.id, scriptsUpdate);
                            }
                          }
                        }}
                        onLoad={handleEditorLoad}
                        placeholder="// JavaScript code to run after request"
                        width="100%"
                        height="150px"
                        scriptContext="post"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeRequestTab === 'tags' && (
                <div className="center-panel__tags">
                  <div className="center-panel__tags-description">
                    <p>Add tags to categorize and organize your requests. Tags are searchable and exported to OpenAPI specs.</p>
                  </div>
                  <TagInput
                    tags={request.tags || []}
                    onChange={(tags) => {
                      console.log('[CenterPanel] Tags changed:', { 
                        tags, 
                        requestId: request.id, 
                        requestName: request.name,
                        collectionId: request.collectionId,
                        activeTabId 
                      });
                      if (activeTabId) {
                        updateRequest(activeTabId, { tags });
                        // Also sync to collection
                        if (request.collectionId) {
                          console.log('[CenterPanel] Syncing tags to collection:', request.collectionId);
                          updateCollectionRequest(request.collectionId, request.id, { tags });
                        } else {
                          console.warn('[CenterPanel] Request has no collectionId - tags not synced to collection');
                        }
                      }
                    }}
                    placeholder="Type a tag and press Enter..."
                  />
                </div>
              )}

              {activeRequestTab === 'description' && (
                <div className="center-panel__description">
                  <div className="center-panel__description-toolbar">
                    <div className="center-panel__description-tabs">
                      <button
                        className={`center-panel__description-tab ${!descriptionPreviewMode ? 'center-panel__description-tab--active' : ''}`}
                        onClick={() => setDescriptionPreviewMode(false)}
                      >
                        Edit
                      </button>
                      <button
                        className={`center-panel__description-tab ${descriptionPreviewMode ? 'center-panel__description-tab--active' : ''}`}
                        onClick={() => setDescriptionPreviewMode(true)}
                      >
                        Preview
                      </button>
                    </div>
                  </div>
                  <div className="center-panel__description-editor">
                    {!descriptionPreviewMode ? (
                      <textarea
                        className="center-panel__description-textarea"
                        placeholder="Add a description for this request (supports markdown)..."
                        value={request.description || ''}
                        onChange={(e) => {
                          if (activeTabId) {
                            updateRequest(activeTabId, { description: e.target.value });
                            // Also sync to collection
                            if (request.collectionId) {
                              updateCollectionRequest(request.collectionId, request.id, { description: e.target.value });
                            }
                          }
                        }}
                      />
                    ) : (
                      <div 
                        className="center-panel__description-preview"
                        dangerouslySetInnerHTML={{ 
                          __html: renderMarkdown(request.description || '*No description*') 
                        }}
                      />
                    )}
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
        <div className="center-panel__welcome">
          <div className="center-panel__welcome-content">
            {/* Logo */}
            <div className="center-panel__welcome-logo">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64">
                <defs>
                  <linearGradient id="welcome-gradient" x1="4" y1="6" x2="20" y2="18" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#77F08B"/>
                    <stop offset="1" stopColor="#4FE06C"/>
                  </linearGradient>
                </defs>
                <path d="M 4 7 L 10 12 L 4 17" stroke="url(#welcome-gradient)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                <line x1="13" y1="17" x2="20" y2="17" stroke="url(#welcome-gradient)" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
              <h1 className="center-panel__welcome-title">Echolon</h1>
              <p className="center-panel__welcome-subtitle">Modern API Development Platform</p>
            </div>

            {/* Feature Grid */}
            <div className="center-panel__welcome-features">
              <div className="center-panel__welcome-feature">
                <div className="center-panel__welcome-feature-icon">
                  <SendIcon />
                </div>
                <div className="center-panel__welcome-feature-text">
                  <h3>API Requests</h3>
                  <p>Send HTTP requests with full control over headers, body, and authentication</p>
                </div>
              </div>
              
              <div className="center-panel__welcome-feature">
                <div className="center-panel__welcome-feature-icon">
                  <SocketIcon />
                </div>
                <div className="center-panel__welcome-feature-text">
                  <h3>WebSocket</h3>
                  <p>Real-time bidirectional communication testing with message history</p>
                </div>
              </div>
              
              <div className="center-panel__welcome-feature">
                <div className="center-panel__welcome-feature-icon">
                  <CodeIcon />
                </div>
                <div className="center-panel__welcome-feature-text">
                  <h3>Code Generation</h3>
                  <p>Export requests to cURL, JavaScript, Python, and more</p>
                </div>
              </div>
              
              <div className="center-panel__welcome-feature">
                <div className="center-panel__welcome-feature-icon">
                  <HistoryIcon />
                </div>
                <div className="center-panel__welcome-feature-text">
                  <h3>Request History</h3>
                  <p>Track and replay your previous API calls with full context</p>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="center-panel__welcome-actions">
              <Button variant="primary" size="lg" onClick={() => addTab()}>
                <SendIcon />
                New Request
              </Button>
              <span className="center-panel__welcome-hint">
                or press <kbd>⌘</kbd> + <kbd>E</kbd>
              </span>
            </div>
          </div>
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
