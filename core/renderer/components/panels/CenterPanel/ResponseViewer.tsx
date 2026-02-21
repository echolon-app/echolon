import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import AceEditor from 'react-ace';
import ace from 'ace-builds';
import 'ace-builds/src-noconflict/ext-searchbox';
import { useTheme, useApp } from '@/contexts';
import { CodeEditor, Switch } from '@/components/ui';
import { 
  GlobeIcon, CopyIcon, CheckIcon, DownloadIcon, FilterIcon, SearchIcon,
  HelpIcon, CloseIcon, HorizontalLayoutIcon, VerticalLayoutIcon, ErrorIcon, EyeIcon 
} from '@/components/ui/icons';
import { RequestExecution, ScriptOutput, SizeBreakdown } from '@/types';
import { ContextMenu, useContextMenu, Tooltip, Dropdown, Button } from '@/components/ui';
import { cookieService } from '@/services';
import { ResponseTimeTooltip } from './ResponseTimeTooltip';
import { ResponseSizeTooltip } from './ResponseSizeTooltip';
import { ResponseSizeModal } from './ResponseSizeModal';
import { NetworkInfoTooltip } from './NetworkInfoTooltip';
import { formatLogTime } from '@/utils';
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

type ResponseTab = 'body' | 'cookies' | 'headers' | 'scripts' | 'preview';
type BodyViewMode = 'response' | 'example' | 'schema';
type ContentDisplayMode = 'auto' | 'json' | 'html' | 'xml' | 'javascript' | 'raw' | 'hex' | 'base64';

// Helper to determine if content type is previewable media
const isPreviewableMedia = (contentType: string): boolean => {
  const ct = contentType.toLowerCase();
  return (
    ct.startsWith('image/') ||
    ct.startsWith('video/') ||
    ct.startsWith('audio/') ||
    ct.includes('application/pdf')
  );
};

// Helper to determine if content type is HTML
const isHtmlContent = (contentType: string): boolean => {
  const ct = contentType.toLowerCase();
  return ct.includes('text/html') || ct.includes('application/xhtml');
};

// Helper to determine the media type category
const getMediaCategory = (contentType: string): 'image' | 'video' | 'audio' | 'pdf' | null => {
  const ct = contentType.toLowerCase();
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('audio/')) return 'audio';
  if (ct.includes('application/pdf')) return 'pdf';
  return null;
};

// Helper to convert base64 to Blob URL (more efficient for large files like videos/PDFs)
const base64ToBlobUrl = (base64: string, contentType: string): string => {
  try {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: contentType });
    return URL.createObjectURL(blob);
  } catch (e) {
    console.error('Failed to create blob URL:', e);
    return '';
  }
};

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

// Media Preview component - properly manages blob URLs for video/audio/PDF
const MediaPreview: React.FC<{ bodyBase64: string; contentType: string }> = ({ bodyBase64, contentType }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const mediaCategory = getMediaCategory(contentType);

  // Create blob URL for video/audio/PDF (data URLs don't work well for these)
  useEffect(() => {
    if (!bodyBase64 || !mediaCategory) return;

    // For images, we don't need blob URLs - data URLs work fine
    if (mediaCategory === 'image') {
      setBlobUrl(null);
      return;
    }

    // Create blob URL for video/audio/PDF
    const url = base64ToBlobUrl(bodyBase64, contentType);
    setBlobUrl(url);

    // Cleanup: revoke blob URL when component unmounts or data changes
    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [bodyBase64, contentType, mediaCategory]);

  if (!mediaCategory) {
    return (
      <div className="response-viewer__preview">
        <div className="response-viewer__preview-unsupported">
          <p>Preview not available for this content type: {contentType}</p>
        </div>
      </div>
    );
  }

  // For images, use data URL (works fine and is simpler)
  if (mediaCategory === 'image') {
    const dataUrl = `data:${contentType};base64,${bodyBase64}`;
    return (
      <div className="response-viewer__preview">
        <div className="response-viewer__preview-image-container">
          <img 
            src={dataUrl}
            alt="Response preview"
            className="response-viewer__preview-image"
          />
        </div>
      </div>
    );
  }

  // For video/audio/PDF, use blob URL (data URLs don't work well for large files)
  if (!blobUrl) {
    return (
      <div className="response-viewer__preview">
        <div className="response-viewer__preview-unsupported">
          <p>Loading preview...</p>
        </div>
      </div>
    );
  }

  switch (mediaCategory) {
    case 'video':
      return (
        <div className="response-viewer__preview">
          <div className="response-viewer__preview-video-container">
            <video 
              src={blobUrl}
              controls
              autoPlay={false}
              className="response-viewer__preview-video"
            />
          </div>
        </div>
      );
    case 'audio':
      return (
        <div className="response-viewer__preview">
          <div className="response-viewer__preview-audio-container">
            <audio 
              src={blobUrl}
              controls
              className="response-viewer__preview-audio"
            />
          </div>
        </div>
      );
    case 'pdf':
      return (
        <div className="response-viewer__preview">
          <div className="response-viewer__preview-pdf-container">
            <object
              data={blobUrl}
              type="application/pdf"
              className="response-viewer__preview-pdf"
            >
              {/* Fallback content when object can't render PDF */}
              <div className="response-viewer__preview-pdf-fallback">
                <p>PDF preview is not available in this environment.</p>
                <a 
                  href={blobUrl} 
                  download="response.pdf"
                  className="response-viewer__preview-download-link"
                >
                  Download PDF
                </a>
              </div>
            </object>
          </div>
        </div>
      );
    default:
      return (
        <div className="response-viewer__preview">
          <div className="response-viewer__preview-unsupported">
            <p>Preview not available for this content type: {contentType}</p>
          </div>
        </div>
      );
  }
};

// HTML Preview component - renders HTML in a sandboxed iframe
const HtmlPreview: React.FC<{ html: string }> = ({ html }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(html);
        doc.close();
      }
    }
  }, [html]);

  return (
    <div className="response-viewer__html-preview">
      <iframe
        ref={iframeRef}
        className="response-viewer__html-preview-iframe"
        sandbox="allow-same-origin"
        title="HTML Preview"
      />
    </div>
  );
};

// Script output section component
const ScriptOutputSection: React.FC<{ title: string; output: ScriptOutput }> = ({ title, output }) => {

  return (
    <div className={`response-viewer__script-section ${output.error ? 'response-viewer__script-section--error' : ''}`}>
      <div className="response-viewer__script-header">
        <span className="response-viewer__script-title">{title}</span>
        <span className="response-viewer__script-duration">
          {output.duration}ms
        </span>
        {output.error && (
          <span className="response-viewer__script-error-badge">
            <ErrorIcon /> Error
          </span>
        )}
      </div>
      <div className="response-viewer__script-logs">
        {output.logs.length === 0 && !output.error && (
          <div className="response-viewer__script-log response-viewer__script-log--info">
            <span className="response-viewer__script-log-type">info</span>
            <span className="response-viewer__script-log-message">Script executed successfully (no output)</span>
          </div>
        )}
        {output.logs.map((log, index) => (
          <div 
            key={index} 
            className={`response-viewer__script-log response-viewer__script-log--${log.type}`}
          >
            <span className="response-viewer__script-log-time">{formatLogTime(log.timestamp)}</span>
            <span className="response-viewer__script-log-type">{log.type}</span>
            <span className="response-viewer__script-log-message">
              {log.args.join(' ')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};


export const ResponseViewer: React.FC<ResponseViewerProps> = ({ execution, isLoading, height = 300, specResponseInfo, onClose, onExpandToggle, isExpanded }) => {
  const { resolvedTheme } = useTheme();
  const { openSettingsModal } = useApp();
  const [sizeModalData, setSizeModalData] = useState<{
    sizeBreakdown: SizeBreakdown;
    headers: Array<{ key: string; value: string }>;
    body: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<ResponseTab>('body');
  const editorRef = useRef<AceEditor>(null);
  const bodyContainerRef = useRef<HTMLDivElement>(null);
  const contentContainerRef = useRef<HTMLDivElement>(null);
  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu();
  const [selectedText, setSelectedText] = useState('');
  const [editorHeight, setEditorHeight] = useState(200);
  const [copied, setCopied] = useState(false);
  const [jsonPathFilter, setJsonPathFilter] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const [headersSearchQuery, setHeadersSearchQuery] = useState('');
  const [showHeadersSearch, setShowHeadersSearch] = useState(false);
  const [headersSearchMatchIndex, setHeadersSearchMatchIndex] = useState(0);
  const [headersSearchMatches, setHeadersSearchMatches] = useState<Array<{ index: number; type: 'key' | 'value' }>>([]);
  const headersSearchInputRef = useRef<HTMLInputElement>(null);
  const headersContainerRef = useRef<HTMLDivElement>(null);
  const [bodyViewMode, setBodyViewMode] = useState<BodyViewMode>('response');
  const [contentDisplayMode, setContentDisplayMode] = useState<ContentDisplayMode>('auto');
  const [showHtmlPreview, setShowHtmlPreview] = useState(false);
  const [cookieSearchQuery, setCookieSearchQuery] = useState('');
  const [showCookieSearch, setShowCookieSearch] = useState(false);
  
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
      // Switch to preview tab when a new response with previewable media arrives
      if (execution?.response?.contentType && isPreviewableMedia(execution.response.contentType)) {
        setActiveTab('preview');
      } else {
        // Switch to body tab when a new response arrives
        setActiveTab('body');
        setBodyViewMode('response');
      }
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

  // Resize editor when height or tab changes: single 500ms timeout (ResizeObserver handles drag).
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const editor = editorRef.current?.editor;
      if (editor) editor.resize();
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [height, activeTab]);

  // ResizeObserver: resize editor when container size changes (e.g. drag). Throttled, no rAF.
  useEffect(() => {
    const container = bodyContainerRef.current;
    if (!container) return;

    let resizeTimeout: NodeJS.Timeout | null = null;
    const resizeEditor = () => {
      if (resizeTimeout) return;
      resizeTimeout = setTimeout(() => {
        resizeTimeout = null;
        const editor = editorRef.current?.editor;
        if (editor) editor.resize();
      }, 16);
    };

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.height > 0) resizeEditor();
      }
    });
    resizeObserver.observe(container);

    const initialResizeTimeout = setTimeout(resizeEditor, 500);

    return () => {
      resizeObserver.disconnect();
      if (resizeTimeout) clearTimeout(resizeTimeout);
      clearTimeout(initialResizeTimeout);
    };
  }, [activeTab, editorHeight]);

  const response = execution?.response;

  // Clear headers search when switching away from headers tab
  useEffect(() => {
    if (activeTab !== 'headers') {
      setShowHeadersSearch(false);
      setHeadersSearchQuery('');
      setHeadersSearchMatchIndex(0);
      setHeadersSearchMatches([]);
    }
  }, [activeTab]);

  // Setup editor with search functionality (CMD+F / Ctrl+F)
  const handleEditorLoad = useCallback((editor: any) => {
    // Override find command to track search state and work with read-only editors
    editor.commands.addCommand({
      name: 'find',
      bindKey: { win: 'Ctrl-F', mac: 'Command-F' },
      exec: (ed: any) => {
        ed.focus();
        const Search = ace.require('ace/ext/searchbox').Search;
        const sb = ed.searchBox || new Search(ed);
        sb.show('', false);
        setShowSearch(true);
      },
      readOnly: true, // Allow this command in read-only mode
    });
    
    // Wrap the searchbox hide method to track when it's closed
    const initSearchBox = () => {
      if (editor.searchBox) {
        const originalHide = editor.searchBox.hide.bind(editor.searchBox);
        editor.searchBox.hide = () => {
          originalHide();
          setShowSearch(false);
        };
      }
    };
    
    // Initialize searchbox wrapper if it exists, or wait for it
    if (editor.searchBox) {
      initSearchBox();
    } else {
      // Watch for searchbox creation
      const checkInterval = setInterval(() => {
        if (editor.searchBox) {
          initSearchBox();
          clearInterval(checkInterval);
        }
      }, 100);
      // Clean up after 5 seconds if searchbox never created
      setTimeout(() => clearInterval(checkInterval), 5000);
    }
  }, []);

  // Handle CMD+F at the container level to trigger search even when editor doesn't have focus
  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      e.stopPropagation();
      
      // If headers tab is active, show headers search
      if (activeTab === 'headers' && response) {
        setShowHeadersSearch(true);
        setHeadersSearchQuery('');
        setHeadersSearchMatchIndex(0);
        setTimeout(() => {
          headersSearchInputRef.current?.focus();
        }, 0);
        return;
      }
      
      // Otherwise, use editor search
      const editor = editorRef.current?.editor;
      if (editor) {
        editor.focus();
        const Search = ace.require('ace/ext/searchbox').Search;
        const sb = editor.searchBox || new Search(editor);
        
        // Wrap hide method if not already wrapped
        if (!sb._hideWrapped) {
          const originalHide = sb.hide.bind(sb);
          sb.hide = () => {
            originalHide();
            setShowSearch(false);
          };
          sb._hideWrapped = true;
        }
        
        sb.show('', false);
        setShowSearch(true);
      }
    }
    
    // Handle ESC to close headers search
    if (e.key === 'Escape' && activeTab === 'headers' && showHeadersSearch) {
      setShowHeadersSearch(false);
      setHeadersSearchQuery('');
      setHeadersSearchMatchIndex(0);
      setHeadersSearchMatches([]);
    }
  }, [activeTab, response, showHeadersSearch]);

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

  // Clear filter and reset HTML preview when response changes
  useEffect(() => {
    setJsonPathFilter('');
    setFilterError(null);
    setShowHtmlPreview(false);
  }, [response?.body]);

  // Search headers when query changes
  useEffect(() => {
    if (!headersSearchQuery.trim() || !response) {
      setHeadersSearchMatches([]);
      setHeadersSearchMatchIndex(0);
      return;
    }

    const query = headersSearchQuery.toLowerCase();
    const matches: Array<{ index: number; type: 'key' | 'value' }> = [];

    response.headers.forEach((header, index) => {
      if (header.key.toLowerCase().includes(query)) {
        matches.push({ index, type: 'key' });
      }
      if (header.value.toLowerCase().includes(query)) {
        matches.push({ index, type: 'value' });
      }
    });

    setHeadersSearchMatches(matches);
    setHeadersSearchMatchIndex(matches.length > 0 ? 1 : 0);

    // Scroll to first match
    if (matches.length > 0 && headersContainerRef.current) {
      const firstMatchRow = headersContainerRef.current.querySelector(`tr[data-header-index="${matches[0].index}"]`);
      if (firstMatchRow) {
        firstMatchRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [headersSearchQuery, response]);

  // Navigate to next/previous match
  const handleHeadersSearchNavigate = useCallback((direction: 'next' | 'prev') => {
    if (headersSearchMatches.length === 0) return;

    let newIndex = headersSearchMatchIndex;
    if (direction === 'next') {
      newIndex = (newIndex % headersSearchMatches.length) + 1;
    } else {
      newIndex = newIndex <= 1 ? headersSearchMatches.length : newIndex - 1;
    }

    setHeadersSearchMatchIndex(newIndex);
    const match = headersSearchMatches[newIndex - 1];
    if (match && headersContainerRef.current) {
      const row = headersContainerRef.current.querySelector(`tr[data-header-index="${match.index}"]`);
      if (row) {
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [headersSearchMatches, headersSearchMatchIndex]);

  // Global keyboard listener for CMD+F, CMD+G, and SHIFT+CMD+G when headers tab is active
  useEffect(() => {
    if (activeTab !== 'headers' || !response) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        setShowHeadersSearch(true);
        setHeadersSearchQuery('');
        setHeadersSearchMatchIndex(0);
        setTimeout(() => {
          headersSearchInputRef.current?.focus();
        }, 0);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'g' && showHeadersSearch) {
        // CMD+G or Ctrl+G: navigate to next match
        // SHIFT+CMD+G or SHIFT+Ctrl+G: navigate to previous match
        e.preventDefault();
        e.stopPropagation();
        if (headersSearchMatches.length > 0) {
          if (e.shiftKey) {
            handleHeadersSearchNavigate('prev');
          } else {
            handleHeadersSearchNavigate('next');
          }
        }
      } else if (e.key === 'Escape' && showHeadersSearch) {
        e.preventDefault();
        setShowHeadersSearch(false);
        setHeadersSearchQuery('');
        setHeadersSearchMatchIndex(0);
        setHeadersSearchMatches([]);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeTab, response, showHeadersSearch, headersSearchMatches, handleHeadersSearchNavigate]);

  // Handle keyboard shortcuts in headers search
  const handleHeadersSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        handleHeadersSearchNavigate('prev');
      } else {
        handleHeadersSearchNavigate('next');
      }
    } else if (e.key === 'Escape') {
      setHeadersSearchQuery('');
      setHeadersSearchMatchIndex(0);
      setHeadersSearchMatches([]);
    }
  }, [handleHeadersSearchNavigate]);

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

  const handleToggleSearch = useCallback(() => {
    const editor = editorRef.current?.editor;
    if (editor) {
      if (showSearch) {
        // Close the search box
        const searchBox = editor.searchBox;
        if (searchBox) {
          searchBox.hide();
        }
        // State is updated by the wrapped hide method
      } else {
        // Focus the editor first to ensure search works
        editor.focus();
        // Open the search box using the Search class directly (works better for read-only editors)
        const Search = ace.require('ace/ext/searchbox').Search;
        const sb = editor.searchBox || new Search(editor);
        
        // Wrap hide method if not already wrapped
        if (!sb._hideWrapped) {
          const originalHide = sb.hide.bind(sb);
          sb.hide = () => {
            originalHide();
            setShowSearch(false);
          };
          sb._hideWrapped = true;
        }
        
        sb.show('', false);
        setShowSearch(true);
      }
    }
  }, [showSearch]);

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
              <p className="response-viewer__error-help">
                {errorHelp}
                {execution.errorCode === 'ETIMEDOUT' && (
                  <>
                    {' '}
                    <button 
                      className="response-viewer__error-link"
                      onClick={() => openSettingsModal('requests')}
                    >
                      Open Settings →
                    </button>
                  </>
                )}
              </p>
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
    <div className="response-viewer" data-onboarding="response" onKeyDown={handleContainerKeyDown} tabIndex={-1}>
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
          {response.bodyBase64 && isPreviewableMedia(response.contentType) && (
            <button
              className={`response-viewer__tab ${activeTab === 'preview' ? 'active' : ''}`}
              onClick={() => setActiveTab('preview')}
            >
              <EyeIcon />
              Preview
            </button>
          )}
            </>
          )}
          {execution?.scriptsOutput && (execution.scriptsOutput.pre || execution.scriptsOutput.post) && (
            <button
              className={`response-viewer__tab ${activeTab === 'scripts' ? 'active' : ''} ${
                (execution.scriptsOutput.pre?.error || execution.scriptsOutput.post?.error) ? 'response-viewer__tab--error' : ''
              }`}
              onClick={() => setActiveTab('scripts')}
            >
              Scripts
              {(execution.scriptsOutput.pre?.error || execution.scriptsOutput.post?.error) && (
                <span className="response-viewer__tab-badge response-viewer__tab-badge--error">!</span>
              )}
            </button>
          )}
        </div>

        <div className="response-viewer__meta">
          {response ? (
            <>
          <span className={`response-viewer__status response-viewer__status--${getStatusClass(response.status)}`}>
            <a 
              href={`https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/${response.status}`}
              target="_blank"
              rel="noopener noreferrer"
              className="response-viewer__status-link"
              onClick={(e) => e.stopPropagation()}
            >
              {response.status}
            </a>
            {' '}{response.statusText}
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
            <>
              <Tooltip
                content={
                  <ResponseSizeTooltip
                    responseSize={response.sizeBreakdown}
                    requestSize={response.requestSize}
                    headers={response.headers}
                  />
                }
                position="bottom"
                delay={100}
                variant="rich"
              >
                <button
                  type="button"
                  className="response-viewer__size response-viewer__size--hoverable"
                  onClick={() => response.sizeBreakdown && setSizeModalData({ sizeBreakdown: response.sizeBreakdown, headers: response.headers, body: response.body })}
                >
                  {formatBytes(response.sizeBreakdown.total)}
                </button>
              </Tooltip>
            </>
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

      <div className="response-viewer__content" ref={contentContainerRef}>
        {activeTab === 'body' && (
          <div 
            ref={bodyContainerRef}
            className="response-viewer__body" 
            onContextMenu={handleEditorContextMenu}
            onKeyDown={handleContainerKeyDown}
            tabIndex={-1}
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
                {/* HTML Preview Toggle - show when response is HTML */}
                {response && isHtmlContent(response.contentType) && bodyViewMode === 'response' && (
                  <div className="response-viewer__html-preview-toggle">
                    <Switch
                      checked={showHtmlPreview}
                      onChange={setShowHtmlPreview}
                      size="sm"
                      label="Preview"
                    />
                  </div>
                )}
                <Dropdown
                  options={contentDisplayModeOptions}
                  value={contentDisplayMode}
                  onChange={(value) => setContentDisplayMode(value as ContentDisplayMode)}
                  className="response-viewer__display-mode-dropdown"
                />
                <Tooltip content="Search (⌘F)" position="bottom">
                  <button
                    className={`response-viewer__action-btn ${showSearch ? 'response-viewer__action-btn--active' : ''}`}
                    onClick={handleToggleSearch}
                  >
                    <SearchIcon />
                  </button>
                </Tooltip>
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
                  placeholder="Filter JSON (uses JSONPath syntax, Example: $.data)"
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

            {/* Show HTML preview or code editor based on toggle */}
            {showHtmlPreview && response && isHtmlContent(response.contentType) && bodyViewMode === 'response' ? (
              <HtmlPreview html={response.body} />
            ) : (
              <CodeEditor
                ref={editorRef}
                mode={bodyViewMode === 'response' ? getEditorMode() : 'json'}
                value={getBodyContent()}
                readOnly
                width="100%"
                height={`${showFilter ? editorHeight - 50 : editorHeight}px`}
                onLoad={handleEditorLoad}
              />
            )}
          </div>
        )}

        {activeTab === 'cookies' && response && (
          <div className="response-viewer__cookies">
            {response.cookies.length === 0 ? (
              <p className="response-viewer__empty-message">No cookies</p>
            ) : (
              <>
                <div className="response-viewer__cookies-toolbar">
                  <div className="response-viewer__cookies-search">
                    <button
                      className={`response-viewer__cookies-search-toggle ${showCookieSearch ? 'active' : ''}`}
                      onClick={() => {
                        setShowCookieSearch(!showCookieSearch);
                        if (!showCookieSearch) {
                          setTimeout(() => {
                            const input = document.querySelector('.response-viewer__cookies-search-input') as HTMLInputElement;
                            input?.focus();
                          }, 0);
                        } else {
                          setCookieSearchQuery('');
                        }
                      }}
                      title="Search cookies"
                    >
                      <SearchIcon />
                    </button>
                    {showCookieSearch && (
                      <input
                        type="text"
                        className="response-viewer__cookies-search-input"
                        placeholder="Search by name, domain, or path..."
                        value={cookieSearchQuery}
                        onChange={(e) => setCookieSearchQuery(e.target.value)}
                      />
                    )}
                  </div>
                  <div className="response-viewer__cookies-actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        if (confirm('Clear all cookies from cookie jar?')) {
                          cookieService.clearCookies();
                          // Refresh the view by triggering a re-render
                          setCookieSearchQuery('');
                        }
                      }}
                    >
                      Clear All
                    </Button>
                  </div>
                </div>
                <div className="response-viewer__cookies-table-wrapper">
                  <table className="response-viewer__table response-viewer__table--cookies">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Value</th>
                        <th>Domain</th>
                        <th>Path</th>
                        <th>Expires</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {response.cookies
                        .filter(cookie => {
                          if (!cookieSearchQuery) return true;
                          const query = cookieSearchQuery.toLowerCase();
                          return (
                            cookie.name.toLowerCase().includes(query) ||
                            cookie.value.toLowerCase().includes(query) ||
                            cookie.domain?.toLowerCase().includes(query) ||
                            cookie.path?.toLowerCase().includes(query)
                          );
                        })
                        .map((cookie, index) => {
                          const isExpired = cookie.expires ? new Date(cookie.expires).getTime() < Date.now() : false;
                          const expiresSoon = cookie.expires ? {
                            expires: new Date(cookie.expires).getTime(),
                            soon: new Date(cookie.expires).getTime() - Date.now() < 24 * 60 * 60 * 1000 // 24 hours
                          } : null;
                          
                          return (
                            <tr key={index} className={isExpired ? 'expired' : ''}>
                              <td className="response-viewer__cookie-name">{cookie.name}</td>
                              <td className="response-viewer__cookie-value">
                                <span className="response-viewer__cookie-value-text">{cookie.value}</span>
                              </td>
                              <td className="response-viewer__cookie-domain">{cookie.domain || '-'}</td>
                              <td className="response-viewer__cookie-path">{cookie.path || '/'}</td>
                              <td className="response-viewer__cookie-expires">
                                {cookie.expires ? (
                                  <span className={isExpired ? 'expired' : expiresSoon?.soon ? 'expires-soon' : ''}>
                                    {new Date(cookie.expires).toLocaleString()}
                                  </span>
                                ) : (
                                  <span className="session-cookie">Session</span>
                                )}
                              </td>
                              <td className="response-viewer__cookie-actions">
                                <div className="response-viewer__cookie-actions-buttons">
                                  <button
                                    className="response-viewer__cookie-copy"
                                    onClick={() => {
                                      navigator.clipboard.writeText(cookie.value);
                                      setCopied(true);
                                      setTimeout(() => setCopied(false), 2000);
                                    }}
                                    title="Copy cookie value"
                                  >
                                    {copied ? <CheckIcon /> : <CopyIcon />}
                                  </button>
                                  <button
                                    className="response-viewer__cookie-delete"
                                    onClick={() => {
                                      // Get domain and path from cookie or derive from request URL
                                      let cookieDomain = cookie.domain;
                                      let cookiePath = cookie.path || '/';
                                      
                                      // If domain is missing, try to get it from the request URL
                                      if (!cookieDomain && execution?.resolvedRequest?.url) {
                                        try {
                                          const url = new URL(execution.resolvedRequest.url);
                                          cookieDomain = url.hostname;
                                        } catch {
                                          // Invalid URL, skip deletion
                                        }
                                      }
                                      
                                      if (cookieDomain && confirm(`Delete cookie "${cookie.name}"?`)) {
                                        cookieService.deleteCookie(cookie.name, cookieDomain, cookiePath);
                                        // Refresh by clearing search
                                        setCookieSearchQuery('');
                                      }
                                    }}
                                    title="Delete cookie from cookie jar"
                                    disabled={!cookie.domain && !execution?.resolvedRequest?.url}
                                  >
                                    <CloseIcon />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'headers' && response && (
          <div className="response-viewer__headers" ref={headersContainerRef}>
            {showHeadersSearch && (
              <div className="response-viewer__headers-search">
                <input
                  ref={headersSearchInputRef}
                  type="text"
                  className="response-viewer__headers-search-input"
                  placeholder="Search headers..."
                  value={headersSearchQuery}
                  onChange={(e) => setHeadersSearchQuery(e.target.value)}
                  onKeyDown={handleHeadersSearchKeyDown}
                />
                <div className="response-viewer__headers-search-info">
                  {headersSearchMatches.length > 0 ? (
                    <>
                      <span className="response-viewer__headers-search-count">
                        {headersSearchMatchIndex} / {headersSearchMatches.length}
                      </span>
                      <button
                        className="response-viewer__headers-search-btn"
                        onClick={() => handleHeadersSearchNavigate('prev')}
                        title="Previous (Shift+Enter)"
                      >
                        ↑
                      </button>
                      <button
                        className="response-viewer__headers-search-btn"
                        onClick={() => handleHeadersSearchNavigate('next')}
                        title="Next (Enter)"
                      >
                        ↓
                      </button>
                    </>
                  ) : (
                    <span className="response-viewer__headers-search-no-matches">No matches</span>
                  )}
                </div>
                <button
                  className="response-viewer__headers-search-close"
                  onClick={() => {
                    setShowHeadersSearch(false);
                    setHeadersSearchQuery('');
                    setHeadersSearchMatchIndex(0);
                    setHeadersSearchMatches([]);
                  }}
                  title="Close (Esc)"
                >
                  ×
                </button>
              </div>
            )}
            <table className="response-viewer__table">
              <thead>
                <tr>
                  <th>Header</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {response.headers.map((header, index) => {
                  const isMatched = headersSearchMatches.some(m => m.index === index);
                  const currentMatch = headersSearchMatches[headersSearchMatchIndex - 1];
                  const isCurrentMatch = currentMatch?.index === index;
                  const query = headersSearchQuery.toLowerCase();
                  
                  const highlightText = (text: string, type: 'key' | 'value') => {
                    if (!query || !isMatched) return text;
                    const isMatchType = headersSearchMatches.some(m => m.index === index && m.type === type);
                    if (!isMatchType) return text;
                    
                    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
                    return parts.map((part, i) => {
                      const isHighlight = part.toLowerCase() === query;
                      return isHighlight ? (
                        <mark key={i} className={`response-viewer__headers-match ${isCurrentMatch ? 'response-viewer__headers-match--current' : ''}`}>
                          {part}
                        </mark>
                      ) : (
                        <span key={i}>{part}</span>
                      );
                    });
                  };

                  return (
                    <tr
                      key={index}
                      data-header-index={index}
                      className={`${isMatched ? 'response-viewer__headers-row--matched' : ''} ${isCurrentMatch ? 'response-viewer__headers-row--current' : ''}`}
                    >
                      <td>{highlightText(header.key, 'key')}</td>
                      <td>{highlightText(header.value, 'value')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'scripts' && execution?.scriptsOutput && (
          <div className="response-viewer__scripts">
            {execution.scriptsOutput.pre && (
              <ScriptOutputSection 
                title="Pre-request Script" 
                output={execution.scriptsOutput.pre} 
              />
            )}
            {execution.scriptsOutput.post && (
              <ScriptOutputSection 
                title="Post-request Script" 
                output={execution.scriptsOutput.post} 
              />
            )}
            {!execution.scriptsOutput.pre && !execution.scriptsOutput.post && (
              <p className="response-viewer__empty-message">No script output</p>
            )}
          </div>
        )}

        {activeTab === 'preview' && response?.bodyBase64 && (
          <MediaPreview 
            bodyBase64={response.bodyBase64} 
            contentType={response.contentType} 
          />
        )}
      </div>

      {sizeModalData && (
        <ResponseSizeModal
          isOpen={true}
          onClose={() => setSizeModalData(null)}
          sizeBreakdown={sizeModalData.sizeBreakdown}
          headers={sizeModalData.headers}
          body={sizeModalData.body}
        />
      )}

      <ContextMenu
        items={contextMenuItems}
        position={contextMenu}
        onClose={hideContextMenu}
      />
    </div>
  );
};

export default ResponseViewer;
