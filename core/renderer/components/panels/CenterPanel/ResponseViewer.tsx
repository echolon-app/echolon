import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import AceEditor from 'react-ace';
import { useTheme } from '@/contexts';
import { CodeEditor } from '@/components/ui';
import { 
  GlobeIcon, CopyIcon, CheckIcon, DownloadIcon, FilterIcon, SearchIcon,
  HelpIcon, CloseIcon, HorizontalLayoutIcon, VerticalLayoutIcon, ErrorIcon 
} from '@/components/ui/icons';
import { RequestExecution } from '@/types';
import { ContextMenu, useContextMenu, Tooltip, Dropdown } from '@/components/ui';
import { ResponseTimeTooltip } from './ResponseTimeTooltip';
import { ResponseSizeTooltip } from './ResponseSizeTooltip';
import { NetworkInfoTooltip } from './NetworkInfoTooltip';
import './ResponseViewer.css';

// Simple JSONPath implementation
const applyJsonPath = (obj: any, path: string): any => {
  if (!path || path === '$') return obj;
  
  // Remove leading $ and .
  let normalizedPath = path.startsWith('$') ? path.slice(1) : path;
  if (normalizedPath.startsWith('.')) normalizedPath = normalizedPath.slice(1);
  
  if (!normalizedPath) return obj;
  
  // Handle recursive descent (..)
  if (normalizedPath.startsWith('.')) {
    const key = normalizedPath.slice(1).split(/[.\[]/)[0];
    const results: any[] = [];
    
    const findRecursive = (current: any) => {
      if (current && typeof current === 'object') {
        if (Array.isArray(current)) {
          current.forEach(item => findRecursive(item));
        } else {
          if (key in current) {
            results.push(current[key]);
          }
          Object.values(current).forEach(val => findRecursive(val));
        }
      }
    };
    
    findRecursive(obj);
    return results;
  }
  
  // Parse path segments
  const segments: string[] = [];
  let current = '';
  let inBracket = false;
  
  for (const char of normalizedPath) {
    if (char === '[') {
      if (current) segments.push(current);
      current = '';
      inBracket = true;
    } else if (char === ']') {
      if (current) segments.push(current);
      current = '';
      inBracket = false;
    } else if (char === '.' && !inBracket) {
      if (current) segments.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) segments.push(current);
  
  // Navigate the path
  let result: any = obj;
  
  for (const segment of segments) {
    if (result === undefined || result === null) return undefined;
    
    // Handle wildcard [*]
    if (segment === '*') {
      if (Array.isArray(result)) {
        return result;
      }
      return Object.values(result);
    }
    
    // Handle array index or quotes
    const cleanSegment = segment.replace(/['"]/g, '');
    const numIndex = parseInt(cleanSegment, 10);
    
    if (!isNaN(numIndex) && Array.isArray(result)) {
      result = result[numIndex];
    } else {
      result = result[cleanSegment];
    }
  }
  
  return result;
};

type ResponseTab = 'body' | 'cookies' | 'headers';
type BodyViewMode = 'response' | 'example' | 'schema';
type ContentDisplayMode = 'auto' | 'json' | 'html' | 'xml' | 'javascript' | 'raw' | 'hex' | 'base64';

// Content display mode options
const contentDisplayModeOptions = [
  { value: 'auto', label: 'Auto' },
  { value: 'json', label: 'JSON' },
  { value: 'html', label: 'HTML' },
  { value: 'xml', label: 'XML' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'raw', label: 'Raw' },
  { value: 'hex', label: 'Hex' },
  { value: 'base64', label: 'Base64' },
];

// Convert string to hex representation
const toHex = (str: string): string => {
  let hex = '';
  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    hex += charCode.toString(16).padStart(2, '0') + ' ';
    if ((i + 1) % 16 === 0) hex += '\n';
  }
  return hex.trim();
};

// Convert string to base64
const toBase64 = (str: string): string => {
  try {
    return btoa(unescape(encodeURIComponent(str)));
  } catch {
    return btoa(str);
  }
};

interface SpecResponseInfo {
  example: string | null;
  schema: string | null;
}

interface ResponseViewerProps {
  execution: RequestExecution | null;
  isLoading: boolean;
  height?: number;
  specResponseInfo?: SpecResponseInfo;
  onClose?: () => void;
  onExpandToggle?: () => void;
  isExpanded?: boolean;
}


export const ResponseViewer: React.FC<ResponseViewerProps> = ({ execution, isLoading, height = 300, specResponseInfo, onClose, onExpandToggle, isExpanded }) => {
  const { resolvedTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<ResponseTab>('body');
  const editorRef = useRef<AceEditor>(null);
  const bodyContainerRef = useRef<HTMLDivElement>(null);
  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu();
  const [selectedText, setSelectedText] = useState('');
  const [editorHeight, setEditorHeight] = useState(200);
  const [copied, setCopied] = useState(false);
  const [jsonPathFilter, setJsonPathFilter] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const [bodyViewMode, setBodyViewMode] = useState<BodyViewMode>('response');
  const [contentDisplayMode, setContentDisplayMode] = useState<ContentDisplayMode>('auto');
  
  // Track the previous execution to detect new responses
  const prevExecutionRef = useRef<RequestExecution | null>(null);
  // Track previous loading state to detect when loading starts
  const prevIsLoadingRef = useRef(false);
  
  // Switch to body tab immediately when loading starts (Send clicked)
  useEffect(() => {
    if (isLoading && !prevIsLoadingRef.current) {
      // Loading just started - switch to body tab immediately
      setActiveTab('body');
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading]);

  // Default to 'example' when there's no response but spec info is available
  // Also switch to 'body' tab when a new response arrives
  useEffect(() => {
    // Don't change view mode while loading - this prevents flicker when clicking Send
    if (isLoading) return;
    
    const hasResponse = execution?.response;
    const hasSpec = specResponseInfo && (specResponseInfo.example || specResponseInfo.schema);
    
    // Check if this is a new response (different execution or newly received response)
    const isNewResponse = execution?.response && (
      !prevExecutionRef.current?.response || 
      execution.id !== prevExecutionRef.current?.id ||
      execution.response !== prevExecutionRef.current?.response
    );
    
    if (isNewResponse) {
      // Switch to body tab when a new response arrives
      setActiveTab('body');
      setBodyViewMode('response');
    } else if (!hasResponse && hasSpec) {
      setBodyViewMode('example');
    } else if (hasResponse && bodyViewMode !== 'response' && bodyViewMode !== 'example' && bodyViewMode !== 'schema') {
      setBodyViewMode('response');
    }
    
    // Update the ref
    prevExecutionRef.current = execution;
  }, [execution?.response, execution?.id, specResponseInfo, isLoading]);

  // Calculate editor height based on container
  useEffect(() => {
    const updateHeight = () => {
      // Header is ~42px, content padding
      const headerHeight = 42;
      const newHeight = Math.max(height - headerHeight, 100);
      setEditorHeight(newHeight);
    };
    updateHeight();
  }, [height]);

  // Resize editor when tab changes
  useEffect(() => {
    if (editorRef.current?.editor) {
      editorRef.current.editor.resize();
    }
  }, [activeTab, editorHeight]);

  // Setup editor with search functionality (CMD+F / Ctrl+F)
  const handleEditorLoad = useCallback((editor: any) => {
    // Load the searchbox extension for this editor
    ace.require('ace/ext/searchbox');
    
    // The searchbox extension adds its own find command
    // We just need to ensure CMD+F is properly bound
    editor.commands.bindKey('Command-F', 'find');
    editor.commands.bindKey('Ctrl-F', 'find');
  }, []);

  const response = execution?.response;

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getStatusClass = (status: number): string => {
    if (status >= 200 && status < 300) return 'success';
    if (status >= 300 && status < 400) return 'redirect';
    if (status >= 400 && status < 500) return 'client-error';
    return 'server-error';
  };

  const getEditorMode = (): string => {
    // If a specific display mode is selected, use that
    if (contentDisplayMode !== 'auto') {
      switch (contentDisplayMode) {
        case 'json': return 'json';
        case 'html': return 'html';
        case 'xml': return 'xml';
        case 'javascript': return 'javascript';
        case 'raw':
        case 'hex':
        case 'base64':
          return 'text';
      }
    }
    
    // Auto-detect based on content type
    if (!response) return 'text';
    const contentType = response.contentType.toLowerCase();
    if (contentType.includes('json')) return 'json';
    if (contentType.includes('html')) return 'html';
    if (contentType.includes('xml')) return 'xml';
    if (contentType.includes('javascript')) return 'javascript';
    return 'text';
  };

  const formatBody = useCallback((): string => {
    if (!response?.body) return '';
    
    // Handle special display modes
    if (contentDisplayMode === 'hex') {
      return toHex(response.body);
    }
    
    if (contentDisplayMode === 'base64') {
      return toBase64(response.body);
    }
    
    // For raw mode, return as-is without formatting
    if (contentDisplayMode === 'raw') {
      return response.body;
    }
    
    // For JSON mode (auto-detected or explicit), format it
    const mode = getEditorMode();
    if (mode === 'json') {
      try {
        const parsed = JSON.parse(response.body);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return response.body;
      }
    }
    
    return response.body;
  }, [response?.body, contentDisplayMode]);

  // Apply JSONPath filter to body
  const filteredBody = useMemo((): string => {
    if (!response?.body || !jsonPathFilter.trim()) {
      setFilterError(null);
      return formatBody();
    }
    
    if (getEditorMode() !== 'json') {
      setFilterError('JSONPath filtering only works with JSON responses');
      return formatBody();
    }
    
    try {
      const parsed = JSON.parse(response.body);
      const result = applyJsonPath(parsed, jsonPathFilter.trim());
      
      if (result === undefined) {
        setFilterError('No match found');
        return formatBody();
      }
      
      setFilterError(null);
      return JSON.stringify(result, null, 2);
    } catch (e) {
      setFilterError('Invalid JSONPath expression');
      return formatBody();
    }
  }, [response?.body, jsonPathFilter, formatBody]);

  // Focus filter input when shown
  useEffect(() => {
    if (showFilter && filterInputRef.current) {
      filterInputRef.current.focus();
    }
  }, [showFilter]);

  // Clear filter when response changes
  useEffect(() => {
    setJsonPathFilter('');
    setFilterError(null);
  }, [response?.body]);

  const handleCopyToClipboard = useCallback(async () => {
    let content: string | undefined;
    if (bodyViewMode === 'example') {
      content = specResponseInfo?.example || undefined;
    } else if (bodyViewMode === 'schema') {
      content = specResponseInfo?.schema || undefined;
    } else {
      content = formatBody();
    }
    if (content) {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [response, bodyViewMode, specResponseInfo]);

  const handleSaveToFile = useCallback(() => {
    let content: string | undefined;
    let filename: string;
    
    if (bodyViewMode === 'example' && specResponseInfo?.example) {
      content = specResponseInfo.example;
      filename = `example-${Date.now()}.json`;
    } else if (bodyViewMode === 'schema' && specResponseInfo?.schema) {
      content = specResponseInfo.schema;
      filename = `schema-${Date.now()}.json`;
    } else {
      content = formatBody();
    // Determine file extension based on content type
    let extension = 'txt';
    const mode = getEditorMode();
    if (mode === 'json') extension = 'json';
    else if (mode === 'html') extension = 'html';
    else if (mode === 'xml') extension = 'xml';
      filename = `response-${Date.now()}.${extension}`;
    }
    
    if (!content) return;

    // Create a blob and download
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [response, bodyViewMode, specResponseInfo, formatBody, getEditorMode]);

  const handleEditorContextMenu = (e: React.MouseEvent) => {
    const editor = editorRef.current?.editor;
    if (editor) {
      const selection = editor.getSelectedText();
      setSelectedText(selection);
    }
    showContextMenu(e);
  };

  const contextMenuItems = [
    {
      id: 'copy',
      label: 'Copy',
      shortcut: '⌘C',
      onClick: () => {
        navigator.clipboard.writeText(selectedText || formatBody());
      },
    },
    {
      id: 'copy-all',
      label: 'Copy All',
      onClick: () => {
        navigator.clipboard.writeText(formatBody());
      },
    },
    { id: 'divider', label: '', divider: true },
    {
      id: 'set-variable',
      label: 'Set as Variable',
      disabled: !selectedText,
      onClick: () => {
        // TODO: Open variable modal
        console.log('Set as variable:', selectedText);
      },
    },
  ];

  const getErrorHelp = (errorCode?: string): string | null => {
    switch (errorCode) {
      case 'ECONNREFUSED':
        return 'Make sure the server is running and the port is correct.';
      case 'ENOTFOUND':
        return 'Check the URL for typos and ensure you have an internet connection.';
      case 'ETIMEDOUT':
        return 'Try increasing the request timeout in settings or check your network connection.';
      case 'ECONNRESET':
        return 'The server closed the connection unexpectedly. Try again later.';
      case 'CERT_HAS_EXPIRED':
      case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      case 'DEPTH_ZERO_SELF_SIGNED_CERT':
        return 'Try disabling SSL verification in settings for this request.';
      default:
        return null;
    }
  };

  // Check if spec info is available - must be before early returns
  const hasSpecInfo = specResponseInfo && (specResponseInfo.example || specResponseInfo.schema);
  
  // Get the content to display based on body view mode - must be before early returns
  // Use useMemo to apply JSONPath filter without causing re-renders
  const { bodyContent, specFilterError } = useMemo(() => {
    // Determine the raw content based on mode
    let rawContent: string | undefined;
    if (bodyViewMode === 'example' && specResponseInfo?.example) {
      rawContent = specResponseInfo.example;
    } else if (bodyViewMode === 'schema' && specResponseInfo?.schema) {
      rawContent = specResponseInfo.schema;
    }
    
    // If we're in response mode, use filteredBody (which already has its own filter logic)
    if (!rawContent) {
      return { bodyContent: filteredBody, specFilterError: null };
    }
    
    // Apply JSONPath filter to spec content
    if (!jsonPathFilter.trim()) {
      return { bodyContent: rawContent, specFilterError: null };
    }
    
    try {
      const parsed = JSON.parse(rawContent);
      const result = applyJsonPath(parsed, jsonPathFilter.trim());
      
      if (result === undefined) {
        return { bodyContent: rawContent, specFilterError: 'No match found' };
      }
      
      return { bodyContent: JSON.stringify(result, null, 2), specFilterError: null };
    } catch (e) {
      return { bodyContent: rawContent, specFilterError: 'Invalid JSONPath expression or invalid JSON' };
    }
  }, [bodyViewMode, specResponseInfo, filteredBody, jsonPathFilter]);

  // Update filter error state based on the current mode
  useEffect(() => {
    if (bodyViewMode !== 'response' && specFilterError !== null) {
      setFilterError(specFilterError);
    } else if (bodyViewMode !== 'response' && !jsonPathFilter.trim()) {
      setFilterError(null);
    }
  }, [bodyViewMode, specFilterError, jsonPathFilter]);

  const getBodyContent = useCallback(() => bodyContent, [bodyContent]);

  if (isLoading) {
    return (
      <div className="response-viewer">
        <div className="response-viewer__loading">
          <div className="response-viewer__spinner" />
          <span>Sending request...</span>
        </div>
      </div>
    );
  }

  if (!response && execution?.error) {
    const errorHelp = getErrorHelp(execution.errorCode);
    return (
      <div className="response-viewer">
        <div className="response-viewer__header response-viewer__header--minimal">
          <div className="response-viewer__tabs" />
          <div className="response-viewer__meta">
            {onExpandToggle && (
              <button
                className="response-viewer__expand-btn"
                onClick={onExpandToggle}
                title={isExpanded ? "Switch to vertical layout" : "Switch to horizontal layout"}
              >
                {isExpanded ? <VerticalLayoutIcon /> : <HorizontalLayoutIcon />}
              </button>
            )}
            {onClose && (
              <button
                className="response-viewer__close-btn"
                onClick={onClose}
                title="Close panel"
              >
                <CloseIcon />
              </button>
            )}
          </div>
        </div>
        <div className="response-viewer__error">
          <div className="response-viewer__error-icon">
            <ErrorIcon />
          </div>
          <div className="response-viewer__error-content">
            <h3 className="response-viewer__error-title">Request Failed</h3>
            <p className="response-viewer__error-message">{execution.error}</p>
            {execution.errorCode && (
              <span className="response-viewer__error-code">Error code: {execution.errorCode}</span>
            )}
            {errorHelp && (
              <p className="response-viewer__error-help">{errorHelp}</p>
            )}
            {execution.duration > 0 && (
              <span className="response-viewer__error-duration">
                Failed after {formatDuration(execution.duration)}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Show empty state only when no response AND no spec info
  if (!response && !hasSpecInfo) {
    return (
      <div className="response-viewer">
        <div className="response-viewer__header response-viewer__header--minimal">
          <div className="response-viewer__tabs" />
          <div className="response-viewer__meta">
            {onExpandToggle && (
              <button
                className="response-viewer__expand-btn"
                onClick={onExpandToggle}
                title={isExpanded ? "Switch to vertical layout" : "Switch to horizontal layout"}
              >
                {isExpanded ? <VerticalLayoutIcon /> : <HorizontalLayoutIcon />}
              </button>
            )}
            {onClose && (
              <button
                className="response-viewer__close-btn"
                onClick={onClose}
                title="Close panel"
              >
                <CloseIcon />
              </button>
            )}
          </div>
        </div>
        <div className="response-viewer__empty">
          <p>Send a request to see the response</p>
        </div>
      </div>
    );
  }

  return (
    <div className="response-viewer">
      <div className="response-viewer__header">
        <div className="response-viewer__tabs">
          <button
            className={`response-viewer__tab ${activeTab === 'body' ? 'active' : ''}`}
            onClick={() => setActiveTab('body')}
          >
            Response
          </button>
          {response && (
            <>
          <button
            className={`response-viewer__tab ${activeTab === 'cookies' ? 'active' : ''}`}
            onClick={() => setActiveTab('cookies')}
          >
            Cookies
            {response.cookies.length > 0 && (
              <span className="response-viewer__tab-badge">{response.cookies.length}</span>
            )}
          </button>
          <button
            className={`response-viewer__tab ${activeTab === 'headers' ? 'active' : ''}`}
            onClick={() => setActiveTab('headers')}
          >
            Headers
            <span className="response-viewer__tab-badge">{response.headers.length}</span>
          </button>
            </>
          )}
        </div>

        <div className="response-viewer__meta">
          {response ? (
            <>
          <span className={`response-viewer__status response-viewer__status--${getStatusClass(response.status)}`}>
            {response.status} {response.statusText}
          </span>
          {response.timing ? (
            <Tooltip 
              content={<ResponseTimeTooltip timing={response.timing} />}
              position="bottom"
              delay={100}
              variant="rich"
            >
              <span className="response-viewer__time response-viewer__time--hoverable">
                    {formatDuration(execution!.duration)}
              </span>
            </Tooltip>
              ) : execution && (
            <span className="response-viewer__time">{formatDuration(execution.duration)}</span>
          )}
          {response.sizeBreakdown ? (
            <Tooltip 
              content={
                <ResponseSizeTooltip 
                  responseSize={response.sizeBreakdown} 
                  requestSize={response.requestSize}
                />
              }
              position="bottom"
              delay={100}
              variant="rich"
            >
              <span className="response-viewer__size response-viewer__size--hoverable">
                {formatBytes(response.size)}
              </span>
            </Tooltip>
          ) : (
            <span className="response-viewer__size">{formatBytes(response.size)}</span>
          )}
          {response.networkInfo && (
            <Tooltip 
              content={<NetworkInfoTooltip networkInfo={response.networkInfo} />}
              position="bottom"
              delay={100}
              variant="rich"
            >
              <span className="response-viewer__network response-viewer__network--hoverable">
                <GlobeIcon />
              </span>
            </Tooltip>
              )}
            </>
          ) : (
            <span className="response-viewer__preview-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              From Spec
            </span>
          )}
          {onExpandToggle && (
            <button
              className="response-viewer__expand-btn"
              onClick={onExpandToggle}
              title={isExpanded ? "Switch to vertical layout" : "Switch to horizontal layout"}
            >
              {isExpanded ? <VerticalLayoutIcon /> : <HorizontalLayoutIcon />}
            </button>
          )}
          {onClose && (
            <button
              className="response-viewer__close-btn"
              onClick={onClose}
              title="Close panel"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </div>

      <div className="response-viewer__content">
        {activeTab === 'body' && (
          <div 
            ref={bodyContainerRef}
            className="response-viewer__body" 
            onContextMenu={handleEditorContextMenu}
          >
            <div className="response-viewer__body-header">
              <div className="response-viewer__body-tabs">
                {/* Only show Response tab when there's actually a response */}
                {response && (
                  <button
                    className={`response-viewer__body-tab ${bodyViewMode === 'response' ? 'active' : ''}`}
                    onClick={() => setBodyViewMode('response')}
                  >
                    Response
                  </button>
                )}
                {hasSpecInfo && specResponseInfo?.example && (
                  <button
                    className={`response-viewer__body-tab ${bodyViewMode === 'example' ? 'active' : ''}`}
                    onClick={() => setBodyViewMode('example')}
                  >
                    Example
                  </button>
                )}
                {hasSpecInfo && specResponseInfo?.schema && (
                  <button
                    className={`response-viewer__body-tab ${bodyViewMode === 'schema' ? 'active' : ''}`}
                    onClick={() => setBodyViewMode('schema')}
                  >
                    Schema
                  </button>
                )}
              </div>
              <div className="response-viewer__body-actions">
                <Dropdown
                  options={contentDisplayModeOptions}
                  value={contentDisplayMode}
                  onChange={(value) => setContentDisplayMode(value as ContentDisplayMode)}
                  className="response-viewer__display-mode-dropdown"
                />
                <Tooltip content="Toggle JSONPath filter" position="bottom">
                  <button
                    className={`response-viewer__action-btn ${showFilter ? 'response-viewer__action-btn--active' : ''}`}
                    onClick={() => setShowFilter(!showFilter)}
                  >
                    <FilterIcon />
                  </button>
                </Tooltip>
                <Tooltip content={copied ? 'Copied!' : 'Copy to clipboard'} position="bottom">
                  <button
                    className={`response-viewer__action-btn ${copied ? 'response-viewer__action-btn--success' : ''}`}
                    onClick={handleCopyToClipboard}
                  >
                    {copied ? <CheckIcon /> : <CopyIcon />}
                  </button>
                </Tooltip>
                <Tooltip content="Save to file" position="bottom">
                  <button
                    className="response-viewer__action-btn"
                    onClick={handleSaveToFile}
                  >
                    <DownloadIcon />
                  </button>
                </Tooltip>
              </div>
            </div>

            {showFilter && (
              <div className={`response-viewer__filter ${filterError ? 'response-viewer__filter--error' : ''}`}>
                <SearchIcon />
                <input
                  ref={filterInputRef}
                  type="text"
                  value={jsonPathFilter}
                  onChange={(e) => setJsonPathFilter(e.target.value)}
                  placeholder="Filter JSON (uses JSONPath syntax)"
                  className="response-viewer__filter-input"
                />
                {jsonPathFilter && (
                  <button 
                    className="response-viewer__filter-clear"
                    onClick={() => setJsonPathFilter('')}
                  >
                    <CloseIcon />
                  </button>
                )}
                <Tooltip 
                  content={
                    <div className="response-viewer__filter-help">
                      <strong>JSONPath Examples:</strong>
                      <ul>
                        <li><code>$.data</code> — Access root property</li>
                        <li><code>$.users[0]</code> — First array element</li>
                        <li><code>$.users[*].name</code> — All names in array</li>
                        <li><code>$..id</code> — All "id" fields (recursive)</li>
                        <li><code>$.store.book[0].title</code> — Nested access</li>
                      </ul>
                    </div>
                  }
                  position="bottom"
                  variant="rich"
                >
                  <button className="response-viewer__filter-help-btn">
                    <HelpIcon />
                  </button>
                </Tooltip>
              </div>
            )}
            
            {filterError && showFilter && (
              <div className="response-viewer__filter-error">
                {filterError}
              </div>
            )}

            <CodeEditor
              ref={editorRef}
              mode={bodyViewMode === 'response' ? getEditorMode() : 'json'}
              value={getBodyContent()}
              readOnly
              width="100%"
              height={`${showFilter ? editorHeight - 50 : editorHeight}px`}
              onLoad={handleEditorLoad}
            />
          </div>
        )}

        {activeTab === 'cookies' && response && (
          <div className="response-viewer__cookies">
            {response.cookies.length === 0 ? (
              <p className="response-viewer__empty-message">No cookies</p>
            ) : (
              <table className="response-viewer__table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {response.cookies.map((cookie, index) => (
                    <tr key={index}>
                      <td>{cookie.name}</td>
                      <td>{cookie.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'headers' && response && (
          <div className="response-viewer__headers">
            <table className="response-viewer__table">
              <thead>
                <tr>
                  <th>Header</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {response.headers.map((header, index) => (
                  <tr key={index}>
                    <td>{header.key}</td>
                    <td>{header.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ContextMenu
        items={contextMenuItems}
        position={contextMenu}
        onClose={hideContextMenu}
      />
    </div>
  );
};

export default ResponseViewer;
