import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Button, Input, SearchInput, CodeEditor, Tooltip, NumericInput } from '@/components/ui';
import { SendIcon, TrashIcon, ChevronDownIcon, ChevronRightIcon, SuccessIcon, CloseIcon, ArrowUpIcon, ArrowDownIcon, InfoIcon } from '@/components/ui/icons';
import { useRequest, useEnvironments, useTheme } from '@/contexts';
import { WebSocketConnection, WebSocketMessage, KeyValuePair, WebSocketSettings } from '@/types';
import { EditableTable } from '@/components/ui';
import { websocketManager } from '@/services/WebSocketManager';
import './WebSocketPanel.css';

type WebSocketTab = 'message' | 'params' | 'headers' | 'settings';

const websocketTabs = [
  { id: 'message', title: 'Message' },
  { id: 'params', title: 'Params' },
  { id: 'headers', title: 'Headers' },
  { id: 'settings', title: 'Settings' },
];

// WebSocket close code explanations
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code
const getCloseCodeExplanation = (code: number): { name: string; description: string } => {
  const codes: Record<number, { name: string; description: string }> = {
    1000: {
      name: 'Normal Closure',
      description: 'The connection successfully completed the purpose for which it was created.',
    },
    1001: {
      name: 'Going Away',
      description: 'The endpoint is going away, either because of a server failure or because the browser is navigating away from the page.',
    },
    1002: {
      name: 'Protocol Error',
      description: 'The endpoint is terminating the connection due to a protocol error.',
    },
    1003: {
      name: 'Unsupported Data',
      description: 'The connection is being terminated because the endpoint received data of a type it cannot accept.',
    },
    1005: {
      name: 'No Status Received',
      description: 'Indicates that no status code was provided even though one was expected.',
    },
    1006: {
      name: 'Abnormal Closure',
      description: 'The connection was closed abnormally (e.g., without sending a close frame). This usually means the server crashed or the network connection was lost.',
    },
    1007: {
      name: 'Invalid Payload Data',
      description: 'The endpoint is terminating the connection because a message was received that contained inconsistent data.',
    },
    1008: {
      name: 'Policy Violation',
      description: 'The endpoint is terminating the connection because it received a message that violates its policy.',
    },
    1009: {
      name: 'Message Too Big',
      description: 'The endpoint is terminating the connection because a data frame was received that is too large.',
    },
    1010: {
      name: 'Missing Extension',
      description: 'The client is terminating the connection because it expected the server to negotiate an extension.',
    },
    1011: {
      name: 'Internal Error',
      description: 'The server is terminating the connection because it encountered an unexpected condition.',
    },
    1012: {
      name: 'Service Restart',
      description: 'The server is terminating the connection because it is restarting.',
    },
    1013: {
      name: 'Try Again Later',
      description: 'The server is terminating the connection due to a temporary condition (e.g., overloaded).',
    },
    1014: {
      name: 'Bad Gateway',
      description: 'The server acting as a gateway received an invalid response from an upstream server.',
    },
    1015: {
      name: 'TLS Handshake Failed',
      description: 'The connection was closed due to a failure to perform a TLS handshake (e.g., certificate verification failed).',
    },
  };

  return codes[code] || {
    name: 'Unknown',
    description: `An unrecognized close code (${code}) was received.`,
  };
};

// Helper to get value from JSON using path notation (e.g., "$.type", "data.id", "items[0].name")
const getJsonPathValue = (obj: unknown, path: string): unknown => {
  // Remove leading $. if present
  const cleanPath = path.replace(/^\$\.?/, '');
  if (!cleanPath) return obj;
  
  // Split by . and [] notation
  const parts = cleanPath.split(/\.|\[|\]/).filter(Boolean);
  
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

// Helper to search content with JSON path support
// Syntax: "path:value" for JSON path search, or plain text for regular search
const matchesSearch = (content: string, query: string): boolean => {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return true;
  
  // Check if query uses JSON path syntax (contains : for path:value)
  const jsonPathMatch = trimmedQuery.match(/^([.\w\[\]$]+):(.*)$/);
  
  if (jsonPathMatch) {
    const [, path, value] = jsonPathMatch;
    try {
      const parsed = JSON.parse(content);
      const pathValue = getJsonPathValue(parsed, path);
      
      if (pathValue === undefined) return false;
      
      // Convert to string for comparison
      const stringValue = typeof pathValue === 'object' 
        ? JSON.stringify(pathValue) 
        : String(pathValue);
      
      return stringValue.toLowerCase().includes(value.toLowerCase());
    } catch {
      // Not valid JSON, fall back to regular search
      return content.toLowerCase().includes(trimmedQuery.toLowerCase());
    }
  }
  
  // Regular text search
  return content.toLowerCase().includes(trimmedQuery.toLowerCase());
};

// Helper to highlight matching text in search results
const highlightMatches = (text: string, query: string): React.ReactNode => {
  if (!query.trim()) return text;
  
  // For JSON path queries, extract the value part for highlighting
  const jsonPathMatch = query.trim().match(/^([.\w\[\]$]+):(.*)$/);
  const searchTerm = jsonPathMatch ? jsonPathMatch[2] : query;
  
  if (!searchTerm.trim()) return text;
  
  const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  
  return parts.map((part, index) => 
    regex.test(part) ? (
      <mark key={index} className="websocket-panel__highlight">{part}</mark>
    ) : (
      part
    )
  );
};

interface WebSocketPanelProps {
  websocket: WebSocketConnection;
  tabId: string;
}

export const WebSocketPanel: React.FC<WebSocketPanelProps> = ({ websocket, tabId }) => {
  const { resolvedTheme } = useTheme();
  const { updateWebSocket } = useRequest();
  const { activeEnvironment } = useEnvironments();
  
  const [activeTab, setActiveTab] = useState<WebSocketTab>('message');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [messageFilter, setMessageFilter] = useState<'all' | 'sent' | 'received'>('all');
  const [connectedSince, setConnectedSince] = useState<Date | null>(null);
  
  // WebSocket connection ref (now managed by websocketManager)
  const messagesStartRef = useRef<HTMLDivElement>(null);
  // Keep track of latest messages to avoid stale closure issues
  const messagesRef = useRef<WebSocketMessage[]>(websocket.messages);
  messagesRef.current = websocket.messages;
  
  // Settings refs for reconnection logic
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const handshakeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isManualDisconnectRef = useRef(false);
  // Default settings if not present (for migrated/old tabs)
  const defaultSettings: WebSocketSettings = {
    handshakeTimeout: 0,
    reconnectionAttempts: 0,
    reconnectionInterval: 5000,
    maxMessageSize: 10,
  };
  const settings = websocket.settings || defaultSettings;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  
  // Sync state with existing connection on mount (for tab switching)
  useEffect(() => {
    const existingWs = websocketManager.getConnection(tabId);
    if (existingWs) {
      // Connection exists from before - sync the state
      if (existingWs.readyState === WebSocket.OPEN && websocket.status !== 'connected') {
        updateWebSocket(tabId, { status: 'connected' });
        setConnectedSince(new Date()); // Approximate, could track in manager
      } else if (existingWs.readyState === WebSocket.CONNECTING && websocket.status !== 'connecting') {
        updateWebSocket(tabId, { status: 'connecting' });
      }
    }
  }, [tabId, websocket.status, updateWebSocket]);
  
  // Cleanup only timeouts on unmount, NOT the WebSocket connection
  useEffect(() => {
    return () => {
      if (handshakeTimeoutRef.current) {
        clearTimeout(handshakeTimeoutRef.current);
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      // Do NOT close WebSocket here - it persists across tab switches
    };
  }, []);

  // Build URL with query params
  const buildUrlWithParams = useCallback((baseUrl: string, params: KeyValuePair[]): string => {
    const enabledParams = params.filter(p => p.enabled && p.key);
    if (enabledParams.length === 0) {
      // Remove existing query params if no params enabled
      const questionMarkIndex = baseUrl.indexOf('?');
      return questionMarkIndex !== -1 ? baseUrl.substring(0, questionMarkIndex) : baseUrl;
    }
    
    // Get base URL without existing query params
    let url = baseUrl;
    const questionMarkIndex = url.indexOf('?');
    if (questionMarkIndex !== -1) {
      url = url.substring(0, questionMarkIndex);
    }
    
    const searchParams = new URLSearchParams();
    enabledParams.forEach(p => searchParams.append(p.key, p.value));
    return `${url}?${searchParams.toString()}`;
  }, []);

  // Parse URL to extract query params
  const parseUrlParams = useCallback((url: string): KeyValuePair[] => {
    try {
      const questionMarkIndex = url.indexOf('?');
      if (questionMarkIndex === -1) return [];
      
      const searchParams = new URLSearchParams(url.substring(questionMarkIndex + 1));
      const params: KeyValuePair[] = [];
      searchParams.forEach((value, key) => {
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
  }, []);
  
  // Store connection info for reconnection
  const lastConnectionRef = useRef<{ url: string; requestHeaders: Record<string, string> } | null>(null);
  
  const connectWebSocket = useCallback((url: string, requestHeaders: Record<string, string>, isInitial: boolean) => {
    // Store connection info for reconnection
    lastConnectionRef.current = { url, requestHeaders };
    // Use ref to get current settings (avoid stale closure)
    const { handshakeTimeout, maxMessageSize } = settingsRef.current;
    
    try {
      console.log('[WebSocket] Connecting to:', url);
      
      // Handshake timeout - use default of 30 seconds if not set
      const timeout = handshakeTimeout > 0 ? handshakeTimeout : 30000;
      
      // Use websocketManager to create/manage connection
      const ws = websocketManager.connect(tabId, url, {
        onopen: () => {
          console.log('[WebSocket] Connection opened');
          // Clear handshake timeout
          if (handshakeTimeoutRef.current) {
            clearTimeout(handshakeTimeoutRef.current);
            handshakeTimeoutRef.current = null;
          }
          
          // Track connection time
          setConnectedSince(new Date());
          
          // Reset reconnection attempts on successful connection
          reconnectAttemptsRef.current = 0;
          
          // Add system message for connection with detailed handshake info
          const connectionMessage: WebSocketMessage = {
            id: crypto.randomUUID(),
            type: 'system',
            content: isInitial ? `Connected to ${url}` : `Reconnected to ${url}`,
            timestamp: Date.now(),
            systemType: 'connected',
            connectionDetails: {
              requestUrl: url,
              requestMethod: 'GET',
              statusCode: 101,
              statusText: 'Switching Protocols',
              requestHeaders,
              responseHeaders: {
                'upgrade': 'websocket',
                'connection': 'Upgrade',
                'sec-websocket-accept': btoa(crypto.randomUUID().substring(0, 20)),
                'date': new Date().toUTCString(),
              },
            },
          };
          
          updateWebSocket(tabId, { 
            status: 'connected',
            messages: [connectionMessage, ...messagesRef.current],
          });
        },
        
        onmessage: (event) => {
          let content: string;
          
          if (typeof event.data === 'string') {
            content = event.data;
          } else if (event.data instanceof ArrayBuffer) {
            content = new TextDecoder().decode(event.data);
          } else {
            content = JSON.stringify(event.data);
          }
          
          // Check max message size (in MB)
          const currentMaxSize = settingsRef.current.maxMessageSize;
          if (currentMaxSize > 0 && content.length > currentMaxSize * 1024 * 1024) {
            const truncatedMessage: WebSocketMessage = {
              id: crypto.randomUUID(),
              type: 'system',
              content: `Message truncated (exceeded ${currentMaxSize}MB limit)`,
              timestamp: Date.now(),
              systemType: 'info',
            };
            updateWebSocket(tabId, {
              messages: [truncatedMessage, ...messagesRef.current],
            });
            content = content.substring(0, currentMaxSize * 1024 * 1024);
          }
          
          const receivedMessage: WebSocketMessage = {
            id: crypto.randomUUID(),
            type: 'received',
            content,
            timestamp: Date.now(),
          };
          
          updateWebSocket(tabId, {
            messages: [receivedMessage, ...messagesRef.current],
          });
        },
        
        onerror: (error) => {
          console.error('[WebSocket] Error:', error);
          // Clear handshake timeout
          if (handshakeTimeoutRef.current) {
            clearTimeout(handshakeTimeoutRef.current);
            handshakeTimeoutRef.current = null;
          }
          
          const errorMessage: WebSocketMessage = {
            id: crypto.randomUUID(),
            type: 'system',
            content: 'Connection error',
            timestamp: Date.now(),
            systemType: 'error',
          };
          
          updateWebSocket(tabId, { 
            status: 'error',
            messages: [errorMessage, ...messagesRef.current],
          });
        },
        
        onclose: (event) => {
          console.log('[WebSocket] Connection closed:', event.code, event.reason);
          // Clear handshake timeout
          if (handshakeTimeoutRef.current) {
            clearTimeout(handshakeTimeoutRef.current);
            handshakeTimeoutRef.current = null;
          }
          
          // Get human-readable explanation for the close code
          const closeCodeExplanation = getCloseCodeExplanation(event.code);
          const reasonText = event.reason ? ` - ${event.reason}` : '';
          
          const disconnectMessage: WebSocketMessage = {
            id: crypto.randomUUID(),
            type: 'system',
            content: `Disconnected from ${url}\n\nClose Code: ${event.code} (${closeCodeExplanation.name})${reasonText}\n\n${closeCodeExplanation.description}\n\nLearn more: https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code`,
            timestamp: Date.now(),
            systemType: 'disconnected',
          };
          
          updateWebSocket(tabId, { 
            status: 'disconnected',
            messages: [disconnectMessage, ...messagesRef.current],
          });
          setConnectedSince(null);
          
          // Attempt reconnection if not manually disconnected
          if (!isManualDisconnectRef.current && lastConnectionRef.current) {
            const currentSettings = settingsRef.current;
            const { reconnectionAttempts, reconnectionInterval } = currentSettings;
            
            if (reconnectAttemptsRef.current < reconnectionAttempts && reconnectionAttempts > 0) {
              reconnectAttemptsRef.current++;
              
              const reconnectMessage: WebSocketMessage = {
                id: crypto.randomUUID(),
                type: 'system',
                content: `Reconnecting... (attempt ${reconnectAttemptsRef.current}/${reconnectionAttempts})`,
                timestamp: Date.now(),
                systemType: 'info',
              };
              
              updateWebSocket(tabId, {
                status: 'connecting',
                messages: [reconnectMessage, ...messagesRef.current],
              });
              
              reconnectTimeoutRef.current = setTimeout(() => {
                if (websocketManager.isConnected(tabId)) return;
                if (lastConnectionRef.current) {
                  const { url: storedUrl, requestHeaders: storedHeaders } = lastConnectionRef.current;
                  connectWebSocket(storedUrl, storedHeaders, false);
                }
              }, reconnectionInterval);
            } else {
              reconnectAttemptsRef.current = 0;
            }
          }
        },
      });
      
      // Set binary type for large messages if needed
      if (maxMessageSize > 0) {
        ws.binaryType = 'arraybuffer';
      }
      
      // Set handshake timeout
      handshakeTimeoutRef.current = setTimeout(() => {
        if (websocketManager.isConnecting(tabId)) {
          console.error('[WebSocket] Handshake timeout after', timeout, 'ms');
          const timeoutMessage: WebSocketMessage = {
            id: crypto.randomUUID(),
            type: 'system',
            content: `Connection timeout after ${timeout / 1000}s`,
            timestamp: Date.now(),
            systemType: 'error',
          };
          
          websocketManager.disconnect(tabId);
          updateWebSocket(tabId, { 
            status: 'error',
            messages: [timeoutMessage, ...messagesRef.current],
          });
        }
      }, timeout);
      
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
      updateWebSocket(tabId, { status: 'error' });
    }
  }, [tabId, updateWebSocket]);
  
  const handleConnect = useCallback(() => {
    console.log('[WebSocket] handleConnect called, status:', websocket.status);
    
    if (websocket.status === 'connected' || websocketManager.isConnected(tabId)) {
      // Manual disconnect
      console.log('[WebSocket] Disconnecting...');
      isManualDisconnectRef.current = true;
      websocketManager.disconnect(tabId);
      setConnectedSince(null);
      updateWebSocket(tabId, { status: 'disconnected' });
      return;
    }
    
    // Reset flags for new connection
    isManualDisconnectRef.current = false;
    reconnectAttemptsRef.current = 0;
    
    // Connect
    console.log('[WebSocket] Setting status to connecting...');
    updateWebSocket(tabId, { status: 'connecting' });
    
    // Build URL with query params
    const url = buildUrlWithParams(websocket.url, websocket.queryParams);
    console.log('[WebSocket] Built URL:', url);
    
    // Build request headers for display
    const requestHeaders: Record<string, string> = {
      'Connection': 'Upgrade',
      'Upgrade': 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': btoa(crypto.randomUUID().substring(0, 16)),
      'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
      'Host': new URL(url).host,
    };
    
    // Add custom headers
    websocket.headers.forEach(h => {
      if (h.enabled && h.key) {
        requestHeaders[h.key] = h.value;
      }
    });
    
    console.log('[WebSocket] Calling connectWebSocket...');
    connectWebSocket(url, requestHeaders, true);
  }, [websocket, tabId, updateWebSocket, buildUrlWithParams, connectWebSocket]);
  
  const handleSendMessage = useCallback(() => {
    if (!websocketManager.isConnected(tabId) || !websocket.messageToSend.trim()) {
      return;
    }
    
    const content = websocket.messageToSend.trim();
    websocketManager.send(tabId, content);
    
    const sentMessage: WebSocketMessage = {
      id: crypto.randomUUID(),
      type: 'sent',
      content,
      timestamp: Date.now(),
    };
    
    updateWebSocket(tabId, {
      messages: [sentMessage, ...messagesRef.current],
      messageToSend: '',
    });
  }, [websocket.messageToSend, tabId, updateWebSocket]);
  
  const handleClearMessages = useCallback(() => {
    updateWebSocket(tabId, { messages: [] });
  }, [tabId, updateWebSocket]);
  
  const handleUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = e.target.value;
    const newParams = parseUrlParams(newUrl);
    
    // Only update params if URL contains query params
    if (newUrl.includes('?') && newParams.length > 0) {
      updateWebSocket(tabId, { 
        url: newUrl,
        queryParams: newParams
      });
    } else {
      updateWebSocket(tabId, { url: newUrl });
    }
  }, [tabId, updateWebSocket, parseUrlParams]);
  
  const handleMessageChange = useCallback((content: string) => {
    updateWebSocket(tabId, { messageToSend: content });
  }, [tabId, updateWebSocket]);
  
  const handleQueryParamsChange = useCallback((params: KeyValuePair[]) => {
    // Update URL to reflect params
    const newUrl = buildUrlWithParams(websocket.url, params);
    updateWebSocket(tabId, { 
      queryParams: params,
      url: newUrl 
    });
  }, [tabId, updateWebSocket, websocket.url, buildUrlWithParams]);
  
  const handleHeadersChange = useCallback((headers: KeyValuePair[]) => {
    updateWebSocket(tabId, { headers: headers });
  }, [tabId, updateWebSocket]);

  const handleSettingsChange = useCallback((key: keyof WebSocketSettings, value: number) => {
    updateWebSocket(tabId, { 
      settings: { 
        ...websocket.settings, 
        [key]: value 
      } 
    });
  }, [tabId, updateWebSocket, websocket.settings]);
  
  const toggleMessageExpanded = useCallback((messageId: string) => {
    setExpandedMessages(prev => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }, []);
  
  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  };
  
  // Filter messages based on search and filter type (messages are already in reverse order)
  const filteredMessages = useMemo(() => {
    return websocket.messages.filter(msg => {
      // Apply type filter
      if (messageFilter === 'sent' && msg.type !== 'sent') return false;
      if (messageFilter === 'received' && msg.type !== 'received') return false;
      
      // Apply search filter (supports JSON path syntax like "type:connected" or "$.data.id:123")
      if (searchQuery) {
        return matchesSearch(msg.content, searchQuery);
      }
      
      return true;
    });
  }, [websocket.messages, messageFilter, searchQuery]);
  
  const getStatusColor = () => {
    switch (websocket.status) {
      case 'connected': return 'var(--color-success)';
      case 'connecting': return 'var(--color-warning)';
      case 'error': return 'var(--color-error)';
      default: return 'var(--text-tertiary)';
    }
  };
  
  const getStatusText = () => {
    switch (websocket.status) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting...';
      case 'error': return 'Error';
      default: return 'Disconnected';
    }
  };

  // Format connection details as text for AceEditor
  const formatConnectionDetails = (details: WebSocketMessage['connectionDetails']) => {
    if (!details) return '';
    
    let text = '// Handshake Details\n\n';
    
    if (details.requestUrl) {
      text += `Request URL: ${details.requestUrl}\n`;
    }
    if (details.requestMethod) {
      text += `Request Method: ${details.requestMethod}\n`;
    }
    if (details.statusCode) {
      text += `Status Code: ${details.statusCode} ${details.statusText || ''}\n`;
    }
    
    if (details.requestHeaders && Object.keys(details.requestHeaders).length > 0) {
      text += '\n// Request Headers\n';
      Object.entries(details.requestHeaders).forEach(([key, value]) => {
        text += `${key}: "${value}"\n`;
      });
    }
    
    if (details.responseHeaders && Object.keys(details.responseHeaders).length > 0) {
      text += '\n// Response Headers\n';
      Object.entries(details.responseHeaders).forEach(([key, value]) => {
        text += `${key}: "${value}"\n`;
      });
    }
    
    return text;
  };
  
  return (
    <div className="websocket-panel">
      {/* URL Bar */}
      <div className="websocket-panel__url-bar">
        <div className="websocket-panel__protocol">WSS</div>
        <Input
          value={websocket.url}
          onChange={handleUrlChange}
          placeholder="wss://api.echolon.app/ws"
          className="websocket-panel__url-input"
          disabled={websocket.status === 'connected' || websocket.status === 'connecting'}
        />
        <Button
          variant={websocket.status === 'connected' ? 'secondary' : 'primary'}
          size="md"
          onClick={handleConnect}
          loading={websocket.status === 'connecting'}
          className="websocket-panel__connect-btn"
        >
          {websocket.status === 'connected' ? 'Disconnect' : 'Connect'}
        </Button>
        {websocket.status === 'connected' && connectedSince ? (
          <Tooltip 
            content={`Connected since ${connectedSince.toLocaleTimeString()} (${connectedSince.toLocaleDateString()})`}
            position="bottom"
          >
            <div className="websocket-panel__status" style={{ color: getStatusColor(), cursor: 'help' }}>
              <span className="websocket-panel__status-dot" style={{ backgroundColor: getStatusColor() }} />
              {getStatusText()}
            </div>
          </Tooltip>
        ) : (
          <div className="websocket-panel__status" style={{ color: getStatusColor() }}>
            <span className="websocket-panel__status-dot" style={{ backgroundColor: getStatusColor() }} />
            {getStatusText()}
          </div>
        )}
      </div>
      
      {/* Tabs */}
      <div className="websocket-panel__tabs">
        {websocketTabs.map(tab => (
          <button
            key={tab.id}
            className={`websocket-panel__tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id as WebSocketTab)}
          >
            {tab.title}
            {tab.id === 'params' && websocket.queryParams.filter(p => p.key).length > 0 && (
              <span className="websocket-panel__tab-badge">
                {websocket.queryParams.filter(p => p.key).length}
              </span>
            )}
            {tab.id === 'headers' && websocket.headers.filter(h => h.key).length > 0 && (
              <span className="websocket-panel__tab-badge">
                {websocket.headers.filter(h => h.key).length}
              </span>
            )}
          </button>
        ))}
      </div>
      
      {/* Tab Content */}
      <div className="websocket-panel__content">
        {activeTab === 'message' && (
          <div className="websocket-panel__message-editor">
            <CodeEditor
              mode="text"
              value={websocket.messageToSend}
              onChange={handleMessageChange}
              placeholder="Enter message to send..."
              width="100%"
              height="150px"
            />
            <div className="websocket-panel__message-actions">
              <Button
                variant="primary"
                size="sm"
                onClick={handleSendMessage}
                disabled={websocket.status !== 'connected' || !websocket.messageToSend.trim()}
                icon={<SendIcon />}
              >
                Send
              </Button>
            </div>
          </div>
        )}
        
        {activeTab === 'params' && (
          <div className="websocket-panel__params">
            <EditableTable
              data={websocket.queryParams}
              onChange={handleQueryParamsChange}
              keyPlaceholder="Key"
              valuePlaceholder="Value"
            />
          </div>
        )}
        
        {activeTab === 'headers' && (
          <div className="websocket-panel__headers">
            <EditableTable
              data={websocket.headers}
              onChange={handleHeadersChange}
              keyPlaceholder="Header"
              valuePlaceholder="Value"
            />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="websocket-panel__settings">
            <div className="websocket-panel__setting">
              <div className="websocket-panel__setting-info">
                <label className="websocket-panel__setting-label">Handshake request timeout</label>
                <p className="websocket-panel__setting-description">
                  Set how long the handshake request should wait before timing out in milliseconds. To never time out, set to 0.
                </p>
              </div>
              <NumericInput
                value={websocket.settings?.handshakeTimeout ?? 0}
                onChange={(value: number) => handleSettingsChange('handshakeTimeout', value)}
                min={0}
                defaultValue={0}
                className="websocket-panel__setting-input"
              />
            </div>
            
            <div className="websocket-panel__setting">
              <div className="websocket-panel__setting-info">
                <label className="websocket-panel__setting-label">Reconnection attempts</label>
                <p className="websocket-panel__setting-description">
                  Maximum reconnection attempts when the connection closes abruptly.
                </p>
              </div>
              <NumericInput
                value={websocket.settings?.reconnectionAttempts ?? 0}
                onChange={(value: number) => handleSettingsChange('reconnectionAttempts', value)}
                min={0}
                defaultValue={0}
                className="websocket-panel__setting-input"
              />
            </div>
            
            <div className="websocket-panel__setting">
              <div className="websocket-panel__setting-info">
                <label className="websocket-panel__setting-label">Reconnection intervals</label>
                <p className="websocket-panel__setting-description">
                  Interval between each reconnection attempt in milliseconds.
                </p>
              </div>
              <NumericInput
                value={websocket.settings?.reconnectionInterval ?? 5000}
                onChange={(value: number) => handleSettingsChange('reconnectionInterval', value)}
                min={0}
                defaultValue={5000}
                className="websocket-panel__setting-input"
              />
            </div>
            
            <div className="websocket-panel__setting">
              <div className="websocket-panel__setting-info">
                <label className="websocket-panel__setting-label">Maximum message size</label>
                <p className="websocket-panel__setting-description">
                  Maximum allowed message size in MB. To receive messages of any size, set to 0.
                </p>
              </div>
              <NumericInput
                value={websocket.settings?.maxMessageSize ?? 10}
                onChange={(value: number) => handleSettingsChange('maxMessageSize', value)}
                min={0}
                defaultValue={10}
                className="websocket-panel__setting-input"
              />
            </div>
          </div>
        )}
      </div>
      
      {/* Response/Messages Section */}
      <div className="websocket-panel__response">
        <div className="websocket-panel__response-header">
          <span className="websocket-panel__response-title">Session</span>
          {/*<div className="websocket-panel__response-status" style={{ color: getStatusColor() }}>
            {getStatusText()}
          </div>
          <div className="websocket-panel__response-actions-right">
            <span className="websocket-panel__response-dots">•••</span>
          </div>*/}
        </div>
        
        <div className="websocket-panel__messages-toolbar">
          <SearchInput
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onClear={() => setSearchQuery('')}
            placeholder="Search or use path:value (e.g., type:connected)"
            size="sm"
            className="websocket-panel__search"
          />
          <div className="websocket-panel__filter">
            <select
              value={messageFilter}
              onChange={(e) => setMessageFilter(e.target.value as typeof messageFilter)}
              className="websocket-panel__filter-select"
            >
              <option value="all">All Messages</option>
              <option value="sent">Sent</option>
              <option value="received">Received</option>
            </select>
          </div>
          <button 
            className="websocket-panel__clear-btn"
            onClick={handleClearMessages}
            title="Clear Messages"
          >
            <TrashIcon />
            Clear Messages
          </button>
        </div>
        
        <div className="websocket-panel__messages">
          <div ref={messagesStartRef} />
          {filteredMessages.length === 0 ? (
            <div className="websocket-panel__empty">
              {websocket.status === 'connected' ? (
                <p>No messages yet. Send a message to get started.</p>
              ) : (
                <p>Connect to start receiving messages.</p>
              )}
            </div>
          ) : (
            filteredMessages.map(message => (
              <div key={message.id} className={`websocket-panel__message websocket-panel__message--${message.type}`}>
                <div 
                  className="websocket-panel__message-header"
                  onClick={() => toggleMessageExpanded(message.id)}
                >
                  <span title={message.type === 'sent' ? 'Sent' : message.type === 'received' ? 'Received' : message.type === 'system' && message.systemType === 'connected' ? 'Connected' : message.type === 'system' && message.systemType === 'disconnected' ? 'Disconnected' : message.type === 'system' && message.systemType === 'error' ? 'Error' : message.type === 'system' && message.systemType === 'info' ? 'Info' : ''} className="websocket-panel__message-icon">
                    {message.type === 'sent' && <ArrowUpIcon />}
                    {message.type === 'received' && <ArrowDownIcon />}
                    {message.type === 'system' && message.systemType === 'connected' && <SuccessIcon />}
                    {message.type === 'system' && message.systemType === 'disconnected' && <CloseIcon />}
                    {message.type === 'system' && message.systemType === 'error' && <CloseIcon />}
                    {message.type === 'system' && message.systemType === 'info' && <InfoIcon />}
                  </span>
                  <span className="websocket-panel__message-preview">
                    {highlightMatches(
                      message.content.length > 100 
                        ? message.content.substring(0, 100) + '...' 
                        : message.content,
                      searchQuery
                    )}
                  </span>
                  <span className="websocket-panel__message-time">
                    {formatTimestamp(message.timestamp)}
                  </span>
                  <span className="websocket-panel__message-expand">
                    {expandedMessages.has(message.id) ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  </span>
                </div>
                
                {expandedMessages.has(message.id) && (
                  <div className="websocket-panel__message-details">
                    {message.type === 'system' && message.connectionDetails ? (
                      <div className="websocket-panel__message-editor-container">
                        <CodeEditor
                          mode="text"
                          value={formatConnectionDetails(message.connectionDetails)}
                          readOnly
                          width="100%"
                          height="250px"
                        />
                      </div>
                    ) : (
                      <div className="websocket-panel__message-editor-container">
                        <CodeEditor
                          mode={message.content.trim().startsWith('{') || message.content.trim().startsWith('[') ? 'json' : 'text'}
                          value={(() => {
                            // Try to pretty print JSON
                            try {
                              const parsed = JSON.parse(message.content);
                              return JSON.stringify(parsed, null, 2);
                            } catch {
                              return message.content;
                            }
                          })()}
                          readOnly
                          width="100%"
                          height="150px"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default WebSocketPanel;
