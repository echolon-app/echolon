import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import QRCode from 'qrcode';
import { Button, Input, Tooltip, Switch, EditableTable, CodeEditor } from '@/components/ui';
import { useMocking, useTheme, useToast } from '@/contexts';
import {
  PlayIcon, StopIcon, CopyIcon, TrashIcon, CheckIcon, ServerIcon,
  FormatIcon, SearchIcon, SortAscIcon, SortDescIcon, CloseIcon, ZapIcon,
  CloudIcon, GlobeIcon, WifiIcon, WifiOffIcon, RequestIcon, ResponseIcon, HelpIcon,
  QrCodeIcon, SmartphoneIcon
} from '@/components/ui/icons';
import { CapturedRequest, MockedResponse, KeyValuePair, MockMode } from '@/types';
import { METHOD_COLORS } from '../../../../shared/constants';
import { formatLogTime, formatDateTime } from '@/utils';
import './MockingPanel.css';

// Default cloud server URL
const DEFAULT_CLOUD_SERVER_URL = 'https://proxy.echolon.app';

const getMethodColor = (method: string): string => {
  return METHOD_COLORS[method] || '#9ca3af';
};

// Mock Mode Help Modal
const MockModeHelpModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="mocking-panel__modal-overlay" onClick={onClose}>
      <div className="mocking-panel__modal mocking-panel__modal--wide" onClick={e => e.stopPropagation()}>
        <div className="mocking-panel__modal-header">
          <h2>Local vs Cloud Mocking</h2>
          <button className="mocking-panel__modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="mocking-panel__modal-content">
          <div className="mocking-panel__mode-comparison">
            {/* Local Mode */}
            <div className="mocking-panel__mode-card">
              <div className="mocking-panel__mode-card-header mocking-panel__mode-card-header--local">
                <ServerIcon />
                <h3>Local Mock Server</h3>
              </div>
              <div className="mocking-panel__mode-card-content">
                <div className="mocking-panel__mode-diagram">
                  <div className="mocking-panel__diagram-item mocking-panel__diagram-item--app">
                    <span className="icon">📱</span>
                    <span>Same Network</span>
                  </div>
                  <div className="mocking-panel__diagram-arrow">→</div>
                  <div className="mocking-panel__diagram-item mocking-panel__diagram-item--local">
                    <span className="icon">💻</span>
                    <span>192.168.x.x:3456</span>
                  </div>
                  <div className="mocking-panel__diagram-arrow">→</div>
                  <div className="mocking-panel__diagram-item mocking-panel__diagram-item--echolon">
                    <span className="icon">⚡</span>
                    <span>Echolon</span>
                  </div>
                </div>
                <ul className="mocking-panel__mode-features">
                  <li><strong>Works offline</strong> — No internet required</li>
                  <li><strong>Local network</strong> — Any device on same WiFi/LAN</li>
                  <li><strong>Fast</strong> — Zero latency, direct connection</li>
                  <li><strong>Custom port</strong> — Configure your own port number</li>
                </ul>
                <div className="mocking-panel__mode-use-case">
                  <strong>Best for:</strong> Local development, testing on same network
                </div>
              </div>
            </div>

            {/* Cloud Mode */}
            <div className="mocking-panel__mode-card">
              <div className="mocking-panel__mode-card-header mocking-panel__mode-card-header--cloud">
                <CloudIcon />
                <h3>Cloud Proxy</h3>
              </div>
              <div className="mocking-panel__mode-card-content">
                <div className="mocking-panel__mode-diagram">
                  <div className="mocking-panel__diagram-item mocking-panel__diagram-item--app">
                    <span className="icon">📱</span>
                    <span>Any Device</span>
                  </div>
                  <div className="mocking-panel__diagram-arrow">→</div>
                  <div className="mocking-panel__diagram-item mocking-panel__diagram-item--cloud">
                    <span className="icon">☁️</span>
                    <span>*.echolon.app</span>
                  </div>
                  <div className="mocking-panel__diagram-arrow">→</div>
                  <div className="mocking-panel__diagram-item mocking-panel__diagram-item--echolon">
                    <span className="icon">⚡</span>
                    <span>Echolon</span>
                  </div>
                </div>
                <ul className="mocking-panel__mode-features">
                  <li><strong>Works anywhere</strong> — Test from any device or network</li>
                  <li><strong>Public URL</strong> — Share with teammates</li>
                  <li><strong>HTTPS</strong> — Secure connection, valid SSL certificate</li>
                  <li><strong>Forward to API</strong> — Optionally proxy to real backend</li>
                </ul>
                <div className="mocking-panel__mode-use-case">
                  <strong>Best for:</strong> Mobile testing, team collaboration, remote debugging
                </div>
              </div>
            </div>
          </div>

          <div className="mocking-panel__mode-summary">
            <h4>Quick Comparison</h4>
            <table className="mocking-panel__comparison-table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Local</th>
                  <th>Cloud</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Internet required</td>
                  <td>❌ No</td>
                  <td>✅ Yes</td>
                </tr>
                <tr>
                  <td>Same network (WiFi/LAN)</td>
                  <td>✅ Yes</td>
                  <td>✅ Yes</td>
                </tr>
                <tr>
                  <td>From anywhere (outside network)</td>
                  <td>❌ No</td>
                  <td>✅ Yes</td>
                </tr>
                <tr>
                  <td>HTTPS support</td>
                  <td>❌ No</td>
                  <td>✅ Yes</td>
                </tr>
                <tr>
                  <td>Custom port</td>
                  <td>✅ Yes</td>
                  <td>❌ No</td>
                </tr>
                <tr>
                  <td>Forward to real API</td>
                  <td>❌ No</td>
                  <td>✅ Yes</td>
                </tr>
                <tr>
                  <td>Latency</td>
                  <td>⚡ Instant</td>
                  <td>🌐 ~50-100ms</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

// Colored URL component
const ColoredUrl: React.FC<{ url: string; method: string }> = ({ url, method }) => {
  try {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol.replace(':', '');
    const host = urlObj.host;
    const pathname = urlObj.pathname;
    const search = urlObj.search;
    
    return (
      <span className="mocking-panel__colored-url">
        <span className="method" style={{ color: getMethodColor(method) }}>{method}</span>
        <span className="protocol">{protocol}://</span>
        <span className="host">{host}</span>
        <span className="path">{pathname}</span>
        {search && <span className="query">{search}</span>}
      </span>
    );
  } catch {
    // Fallback for invalid URLs
    return (
      <span className="mocking-panel__colored-url">
        <span className="method" style={{ color: getMethodColor(method) }}>{method}</span>
        <span className="path">{url}</span>
      </span>
    );
  }
};

// HelpCircleIcon is same as HelpIcon - use imported HelpIcon

// Flow explanation modal component
const ProxyFlowModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="mocking-panel__modal-overlay" onClick={onClose}>
      <div className="mocking-panel__modal" onClick={e => e.stopPropagation()}>
        <div className="mocking-panel__modal-header">
          <h2>How Cloud Proxy Forwarding Works</h2>
          <button className="mocking-panel__modal-close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="mocking-panel__modal-content">
          {/* Infographic */}
          <div className="mocking-panel__flow-diagram">
            <div className="mocking-panel__flow-row">
              <div className="mocking-panel__flow-box mocking-panel__flow-box--client">
                <span className="mocking-panel__flow-icon">🌐</span>
                <span className="mocking-panel__flow-label">Your App / Browser</span>
              </div>
              <div className="mocking-panel__flow-arrow">→</div>
              <div className="mocking-panel__flow-box mocking-panel__flow-box--proxy">
                <span className="mocking-panel__flow-icon">☁️</span>
                <span className="mocking-panel__flow-label">Echolon Proxy</span>
                <span className="mocking-panel__flow-sublabel">*.echolon.app</span>
              </div>
              <div className="mocking-panel__flow-arrow">→</div>
              <div className="mocking-panel__flow-box mocking-panel__flow-box--echolon">
                <span className="mocking-panel__flow-icon">🖥️</span>
                <span className="mocking-panel__flow-label">Echolon App</span>
                <span className="mocking-panel__flow-sublabel">Intercepts & shows requests</span>
              </div>
            </div>
            
            <div className="mocking-panel__flow-decision">
              <div className="mocking-panel__flow-decision-box">
                <span className="mocking-panel__flow-icon">🔀</span>
                <span className="mocking-panel__flow-label">Mock defined?</span>
              </div>
            </div>

            <div className="mocking-panel__flow-branches">
              <div className="mocking-panel__flow-branch mocking-panel__flow-branch--yes">
                <div className="mocking-panel__flow-branch-label">✅ Yes - Mock enabled</div>
                <div className="mocking-panel__flow-box mocking-panel__flow-box--mock">
                  <span className="mocking-panel__flow-icon">📝</span>
                  <span className="mocking-panel__flow-label">Return Mocked Response</span>
                </div>
              </div>
              
              <div className="mocking-panel__flow-branch mocking-panel__flow-branch--no">
                <div className="mocking-panel__flow-branch-label">❌ No mock</div>
                <div className="mocking-panel__flow-box mocking-panel__flow-box--forward">
                  <span className="mocking-panel__flow-icon">🔗</span>
                  <span className="mocking-panel__flow-label">Forward to Endpoint</span>
                  <span className="mocking-panel__flow-sublabel">api.example.com</span>
                </div>
                <div className="mocking-panel__flow-arrow">↓</div>
                <div className="mocking-panel__flow-box mocking-panel__flow-box--response">
                  <span className="mocking-panel__flow-icon">📨</span>
                  <span className="mocking-panel__flow-label">Real Response</span>
                  <span className="mocking-panel__flow-sublabel">Shown in Echolon App</span>
                </div>
              </div>
            </div>
          </div>

          {/* Explanation text */}
          <div className="mocking-panel__flow-explanation">
            <h3>Flow Steps:</h3>
            <ol>
              <li><strong>Request arrives</strong> at your namespace (e.g., <code>myapp.echolon.app/api/users</code>)</li>
              <li><strong>Echolon App receives</strong> the request and shows it in the captured requests list</li>
              <li><strong>Check for mock:</strong>
                <ul>
                  <li>If a mock is <em>enabled</em> for this route → Return the mocked response</li>
                  <li>If no mock → Forward to the configured endpoint (if set)</li>
                </ul>
              </li>
              <li><strong>Forward endpoint responses</strong> are shown in Echolon App (man-in-the-middle view)</li>
              <li><strong>Response is returned</strong> to your app/browser</li>
            </ol>
            
            <h3>Use Cases:</h3>
            <ul>
              <li>🔍 <strong>Debug API calls</strong> - See all requests your app makes</li>
              <li>🎭 <strong>Mock responses</strong> - Return custom responses for testing</li>
              <li>🔀 <strong>Proxy to real API</strong> - Forward unmocked routes to your real backend</li>
              <li>🐛 <strong>Inspect responses</strong> - View what your real API returns</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

// QR Code Modal for mobile device access
const QRCodeModal: React.FC<{ 
  isOpen: boolean; 
  onClose: () => void; 
  url: string;
}> = ({ isOpen, onClose, url }) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (isOpen && url) {
      QRCode.toDataURL(url, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      })
        .then(dataUrl => {
          setQrDataUrl(dataUrl);
          setError('');
        })
        .catch(() => {
          setError('Failed to generate QR code');
        });
    }
  }, [isOpen, url]);

  if (!isOpen) return null;

  return (
    <div className="mocking-panel__modal-overlay" onClick={onClose}>
      <div className="mocking-panel__modal mocking-panel__modal--qr" onClick={e => e.stopPropagation()}>
        <div className="mocking-panel__modal-header">
          <h2><SmartphoneIcon /> Connect Mobile Device</h2>
          <button className="mocking-panel__modal-close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="mocking-panel__modal-content mocking-panel__qr-content">
          <p className="mocking-panel__qr-instruction">
            Scan this QR code with your mobile device to connect to the mock server
          </p>
          
          {error ? (
            <div className="mocking-panel__qr-error">{error}</div>
          ) : qrDataUrl ? (
            <div className="mocking-panel__qr-code">
              <img src={qrDataUrl} alt="QR Code for mock server URL" />
            </div>
          ) : (
            <div className="mocking-panel__qr-loading">Generating QR code...</div>
          )}
          
          <div className="mocking-panel__qr-url">
            <code>{url}</code>
          </div>
          
          <div className="mocking-panel__qr-note">
            <strong>Note:</strong> Make sure your mobile device is on the same network as this computer.
          </div>
        </div>
      </div>
    </div>
  );
};

type SortField = 'method' | 'path' | 'status' | 'timestamp';
type SortDirection = 'asc' | 'desc';
type RequestTab = 'body' | 'headers' | 'query' | 'details';
type ResponseTab = 'body' | 'headers';

export const MockingPanel: React.FC = () => {
  const { resolvedTheme } = useTheme();
  const { success, error: showError } = useToast();
  const {
    mockApis,
    activeMockApiId,
    capturedRequests,
    selectedRequestId,
    localHostname,
    updateMockApi,
    deleteMockApi,
    startMockServer,
    stopMockServer,
    setMockMode,
    connectCloudProxy,
    disconnectCloudProxy,
    checkNamespaceAvailability,
    selectRequest,
    clearCapturedRequests,
    deleteCapturedRequest,
    mockFromCapturedRequest,
    toggleRequestMock,
    updateCapturedRequestResponse,
  } = useMocking();

  const [requestTab, setRequestTab] = useState<RequestTab>('body');
  const [responseTab, setResponseTab] = useState<ResponseTab>('body');
  const [showProxyFlowModal, setShowProxyFlowModal] = useState(false);
  const [showMockModeHelp, setShowMockModeHelp] = useState(false);
  const [showQRCode, setShowQRCode] = useState(false);
  const [editedResponse, setEditedResponse] = useState<Partial<MockedResponse>>({
    status: 200,
    statusText: 'OK',
    headers: [],
    body: '{\n  "message": "Mocked response"\n}',
  });
  const [originalResponse, setOriginalResponse] = useState<Partial<MockedResponse> | null>(null);

  // Search and sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Cloud proxy state
  const [namespaceAvailable, setNamespaceAvailable] = useState<boolean | null>(null);
  const [isCheckingNamespace, setIsCheckingNamespace] = useState(false);

  // Bottom panel resizing
  const [detailsPanelHeight, setDetailsPanelHeight] = useState(350);
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  // Side pane resizing (for details)
  const [leftPaneWidth, setLeftPaneWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; requestId: string } | null>(null);

  // Ref for table body to scroll selected row into view
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);

  const activeMockApi = useMemo(() => 
    mockApis.find(api => api.id === activeMockApiId),
    [mockApis, activeMockApiId]
  );

  // Filter by mock API, then by search, then sort
  const filteredRequests = useMemo(() => {
    let requests = capturedRequests.filter(req => req.mockApiId === activeMockApiId);
    
    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      requests = requests.filter(req => 
        req.method.toLowerCase().includes(query) ||
        req.path.toLowerCase().includes(query) ||
        String(req.response?.status || '').includes(query)
      );
    }
    
    // Apply sorting
    requests.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'method':
          comparison = a.method.localeCompare(b.method);
          break;
        case 'path':
          comparison = a.path.localeCompare(b.path);
          break;
        case 'status':
          comparison = (a.response?.status || 0) - (b.response?.status || 0);
          break;
        case 'timestamp':
          comparison = a.timestamp - b.timestamp;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    return requests;
  }, [capturedRequests, activeMockApiId, searchQuery, sortField, sortDirection]);

  const selectedRequest = useMemo(() =>
    capturedRequests.find(req => req.id === selectedRequestId),
    [capturedRequests, selectedRequestId]
  );

  // Handle column sort
  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }, [sortField]);

  // Helper to format JSON body
  const formatJsonBody = (body: string): string => {
    try {
      const parsed = JSON.parse(body);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return body; // Return as-is if not valid JSON
    }
  };

  // Update edited response when selected request changes
  useEffect(() => {
    if (!selectedRequest) return;

    // Check if this request has a mocked route - if so, load the mocked response
    if (selectedRequest.isMocked && activeMockApi) {
      const route = activeMockApi.routes.find(r => 
        r.method === selectedRequest.method && r.path === selectedRequest.path
      );
      if (route?.mockedResponse) {
        const formattedBody = formatJsonBody(route.mockedResponse.body);
        const response = {
          status: route.mockedResponse.status,
          statusText: route.mockedResponse.statusText,
          headers: route.mockedResponse.headers || [],
          body: formattedBody,
        };
        setEditedResponse(response);
        setOriginalResponse(response);
        return;
      }
    }

    // Fall back to captured request's response
    if (selectedRequest.response) {
      const formattedBody = formatJsonBody(selectedRequest.response.body);
      const response = {
        status: selectedRequest.response.status,
        statusText: selectedRequest.response.statusText,
        headers: selectedRequest.response.headers || [],
        body: formattedBody,
      };
      setEditedResponse(response);
      setOriginalResponse(response);
    }
  }, [selectedRequest?.id, selectedRequest?.isMocked, activeMockApi?.routes]);

  // Check if response has been modified
  const isResponseModified = useMemo(() => {
    if (!originalResponse) return true; // Allow save if no original (new mock)
    
    // Compare headers arrays
    const headersChanged = () => {
      const editedHeaders = editedResponse.headers || [];
      const originalHeaders = originalResponse.headers || [];
      if (editedHeaders.length !== originalHeaders.length) return true;
      return editedHeaders.some((h, i) => 
        h.key !== originalHeaders[i]?.key || h.value !== originalHeaders[i]?.value
      );
    };
    
    return (
      editedResponse.status !== originalResponse.status ||
      editedResponse.statusText !== originalResponse.statusText ||
      editedResponse.body !== originalResponse.body ||
      headersChanged()
    );
  }, [editedResponse, originalResponse]);

  const handleToggleServer = async () => {
    if (!activeMockApi) return;
    
    const isCloudMode = activeMockApi.mode === 'cloud';
    
    if (activeMockApi.isRunning) {
      if (isCloudMode) {
        await disconnectCloudProxy(activeMockApi.id);
      } else {
        await stopMockServer(activeMockApi.id);
      }
    } else {
      if (isCloudMode) {
        const result = await connectCloudProxy(activeMockApi.id);
        if (!result.success) {
          showError('Connection failed', result.error || 'Failed to connect to cloud proxy');
        } else {
          success('Connected', `Connected to ${activeMockApi.cloudNamespace}.echolon.app`);
        }
      } else {
        await startMockServer(activeMockApi.id);
      }
    }
  };

  const handleModeChange = (mode: MockMode) => {
    if (!activeMockApi) return;
    
    // Stop current server/connection before switching modes
    if (activeMockApi.isRunning) {
      if (activeMockApi.mode === 'cloud') {
        disconnectCloudProxy(activeMockApi.id);
      } else {
        stopMockServer(activeMockApi.id);
      }
    }
    
    setMockMode(activeMockApi.id, mode);
  };

  // Check if namespace is used in another mock API tab
  const isNamespaceUsedElsewhere = useMemo(() => {
    if (!activeMockApi?.cloudNamespace) return false;
    return mockApis.some(api => 
      api.id !== activeMockApi.id && 
      api.cloudNamespace === activeMockApi.cloudNamespace &&
      api.mode === 'cloud'
    );
  }, [mockApis, activeMockApi?.id, activeMockApi?.cloudNamespace]);

  const handleNamespaceChange = async (namespace: string) => {
    if (!activeMockApi) return;
    
    updateMockApi(activeMockApi.id, { cloudNamespace: namespace });
    
    // Check if used in another tab first
    const usedInOtherTab = mockApis.some(api => 
      api.id !== activeMockApi.id && 
      api.cloudNamespace === namespace &&
      api.mode === 'cloud'
    );
    
    if (usedInOtherTab) {
      setNamespaceAvailable(false);
      return;
    }
    
    // Check availability on server
    if (namespace.length >= 3) {
      setIsCheckingNamespace(true);
      const result = await checkNamespaceAvailability(
        namespace,
        activeMockApi.cloudServerUrl || DEFAULT_CLOUD_SERVER_URL
      );
      setNamespaceAvailable(result.available);
      setIsCheckingNamespace(false);
    } else {
      setNamespaceAvailable(null);
    }
  };

  const handleForwardToChange = (forwardTo: string) => {
    if (!activeMockApi) return;
    updateMockApi(activeMockApi.id, { cloudForwardTo: forwardTo || undefined });
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (activeMockApi) {
      updateMockApi(activeMockApi.id, { name: e.target.value });
    }
  };

  const handlePortChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (activeMockApi) {
      const port = parseInt(e.target.value, 10);
      if (!isNaN(port) && port > 0 && port < 65536) {
        updateMockApi(activeMockApi.id, { port });
      }
    }
  };

  const handleRequestClick = (request: CapturedRequest) => {
    selectRequest(request.id);
    
    // Pre-fill response editor with actual response if available
    if (request.response) {
      const formattedBody = formatJsonBody(request.response.body);
      const response = {
        status: request.response.status,
        statusText: request.response.statusText,
        headers: request.response.headers || [],
        body: formattedBody,
      };
      setEditedResponse(response);
      setOriginalResponse(response);
    }
  };

  const handleCloseDetails = () => {
    selectRequest(null);
  };

  const handleDeleteRequest = (requestId: string) => {
    deleteCapturedRequest(requestId);
    success('Request deleted');
  };

  const handleContextMenu = (e: React.MouseEvent, requestId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, requestId });
  };

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Close context menu when clicking elsewhere
  useEffect(() => {
    if (contextMenu) {
      const handleClick = () => closeContextMenu();
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu, closeContextMenu]);

  // Keyboard navigation for request list
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle arrow keys when we have requests and an active mock API
      if (!filteredRequests.length || !activeMockApiId) return;
      
      // Don't interfere with input fields or editors
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.classList.contains('ace_text-input')) {
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        
        const currentIndex = selectedRequestId 
          ? filteredRequests.findIndex(r => r.id === selectedRequestId)
          : -1;
        
        let newIndex: number;
        if (e.key === 'ArrowDown') {
          newIndex = currentIndex < filteredRequests.length - 1 ? currentIndex + 1 : 0;
        } else {
          newIndex = currentIndex > 0 ? currentIndex - 1 : filteredRequests.length - 1;
        }
        
        const newRequest = filteredRequests[newIndex];
        if (newRequest) {
          selectRequest(newRequest.id);
          
          // Scroll the row into view
          setTimeout(() => {
            const row = tableBodyRef.current?.children[newIndex] as HTMLElement;
            if (row) {
              row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
          }, 0);
        }
      }
      
      // Escape to deselect
      if (e.key === 'Escape' && selectedRequestId) {
        selectRequest(null);
      }
      
      // Delete with backspace or delete key
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedRequestId) {
        // Only if not in an input field
        handleDeleteRequest(selectedRequestId);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [filteredRequests, selectedRequestId, activeMockApiId, selectRequest]);

  const handleSaveMock = () => {
    if (!selectedRequest || !editedResponse.body) return;

    const response: MockedResponse = {
      status: editedResponse.status || 200,
      statusText: editedResponse.statusText || 'OK',
      headers: editedResponse.headers || [],
      body: editedResponse.body,
    };

    mockFromCapturedRequest(selectedRequest.id, response);
    
    // Update original response to match saved state, disabling the save button
    setOriginalResponse({ ...editedResponse });
    success('Mock saved successfully');
  };

  const copyEndpoint = useCallback(() => {
    if (activeMockApi) {
      navigator.clipboard.writeText(`http://localhost:${activeMockApi.port}`);
      success('Copied to clipboard', `http://localhost:${activeMockApi.port}`);
    }
  }, [activeMockApi, success]);

  // Quick action to send test requests via Electron IPC (bypasses CORS)
  const sendTestRequest = useCallback(async (method: string, path: string, body?: string) => {
    if (!activeMockApi || !activeMockApi.isRunning) {
      showError('Server not running', 'Start the mock server first');
      return;
    }
    
    const url = `http://127.0.0.1:${activeMockApi.port}${path}`;
    console.log(`[Quick Test] Sending ${method} to ${url}`);
    
    try {
      // Use Electron IPC to bypass CORS
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.makeHttpRequest) {
        console.log('[Quick Test] Using Electron IPC');
        const result = await electronAPI.makeHttpRequest({
          method,
          url,
          headers: { 'Content-Type': 'application/json' },
          body: body || null,
          timeout: 5000,
        });
        console.log('[Quick Test] Result:', result);
        if (!result.success) {
          showError(`${method} failed`, result.error || 'Unknown error');
        }
      } else {
        // Fallback for browser - mock server now supports CORS
        console.log('[Quick Test] Using fetch (browser fallback)');
        await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: body || undefined,
        });
      }
    } catch (err: any) {
      console.error('[Quick Test] Exception:', err);
      showError(`${method} failed`, err.message || 'Unknown error');
    }
  }, [activeMockApi, showError]);

  const handleDeleteMockApi = () => {
    if (!activeMockApi) return;
    
    if (window.confirm(`Are you sure you want to delete "${activeMockApi.name}"? This will also stop the server if running.`)) {
      deleteMockApi(activeMockApi.id);
    }
  };

  const handleToggleMock = (enabled: boolean) => {
    if (!selectedRequest) return;
    
    if (enabled && editedResponse.body) {
      // When enabling, automatically save the current edited response as the mock
      const response: MockedResponse = {
        status: editedResponse.status || 200,
        statusText: editedResponse.statusText || 'OK',
        headers: editedResponse.headers || [],
        body: editedResponse.body,
      };
      mockFromCapturedRequest(selectedRequest.id, response);
      // Update original response to match saved state (clears "modified" indicator)
      setOriginalResponse({ ...editedResponse });
      success('Mock enabled and saved');
    } else {
      // When disabling, just toggle the mock off
      toggleRequestMock(selectedRequest.id, enabled);
    }
  };

  const handlePrettyPrint = () => {
    if (!editedResponse.body) return;
    
    try {
      const parsed = JSON.parse(editedResponse.body);
      const formatted = JSON.stringify(parsed, null, 2);
      setEditedResponse(prev => ({ ...prev, body: formatted }));
    } catch {
      // Not valid JSON, ignore
    }
  };

  const handleHeadersChange = (headers: KeyValuePair[]) => {
    setEditedResponse(prev => ({ ...prev, headers }));
  };

  // Vertical panel resize handlers (for bottom details panel)
  const handlePanelResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingPanel(true);
    startYRef.current = e.clientY;
    startHeightRef.current = detailsPanelHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const handlePanelResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizingPanel) return;
    
    const diff = startYRef.current - e.clientY;
    const newHeight = Math.max(150, Math.min(600, startHeightRef.current + diff));
    setDetailsPanelHeight(newHeight);
  }, [isResizingPanel]);

  const handlePanelResizeEnd = useCallback(() => {
    setIsResizingPanel(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  // Horizontal pane resize handlers (for left/right split in details)
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = leftPaneWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    
    const diff = e.clientX - startXRef.current;
    const newWidth = Math.max(250, Math.min(800, startWidthRef.current + diff));
    setLeftPaneWidth(newWidth);
  }, [isResizing]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    if (isResizingPanel) {
      document.addEventListener('mousemove', handlePanelResizeMove);
      document.addEventListener('mouseup', handlePanelResizeEnd);
    }
    return () => {
      document.removeEventListener('mousemove', handlePanelResizeMove);
      document.removeEventListener('mouseup', handlePanelResizeEnd);
    };
  }, [isResizingPanel, handlePanelResizeMove, handlePanelResizeEnd]);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
    }
    return () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
    };
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  if (!activeMockApi) {
    return (
      <div className="mocking-panel mocking-panel--empty">
        <div className="mocking-panel__empty-state">
          <ServerIcon />
          <h2>No Mock API Selected</h2>
          <p>Select a mock API from the sidebar or create a new one to get started.</p>
        </div>
      </div>
    );
  }

  const getMockEndpoint = () => { 

    if (isCloudMode) {
      return `https://${activeMockApi.cloudNamespace}.echolon.app`;
    }

    return `http://${localHostname}:${activeMockApi.port}`;
  }

  const isCloudMode = activeMockApi.mode === 'cloud';
  const cloudStatus = activeMockApi.cloudStatus || 'disconnected';

  return (
    <div className="mocking-panel">
      {/* Header */}
      <div className="mocking-panel__header">
        <div className="mocking-panel__header-info">
          <Input
            value={activeMockApi.name}
            onChange={handleNameChange}
            size="lg"
            className="mocking-panel__name-input"
          />
          {/* Mode Toggle */}
          <div className="mocking-panel__mode-toggle">
            <button
              className={`mode-btn ${!isCloudMode ? 'active' : ''}`}
              onClick={() => handleModeChange('local')}
              disabled={activeMockApi.isRunning}
            >
              <ServerIcon /> Local
            </button>
            <button
              className={`mode-btn ${isCloudMode ? 'active' : ''}`}
              onClick={() => handleModeChange('cloud')}
              disabled={activeMockApi.isRunning}
            >
              <CloudIcon /> Cloud
            </button>
            <Tooltip content="What's the difference?">
              <button
                className="mode-help-btn"
                onClick={() => setShowMockModeHelp(true)}
              >
                <HelpIcon />
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="mocking-panel__header-actions">
          {!isCloudMode && (
            <div className="mocking-panel__port-input">
              <label>Port:</label>
              <Input
                type="number"
                value={activeMockApi.port}
                onChange={handlePortChange}
                size="sm"
                disabled={activeMockApi.isRunning}
              />
            </div>
          )}
          <Button
            variant={activeMockApi.isRunning ? 'secondary' : 'primary'}
            onClick={handleToggleServer}
            icon={activeMockApi.isRunning ? <StopIcon /> : <PlayIcon />}
            disabled={isCloudMode && !activeMockApi.isRunning && (namespaceAvailable === false || isNamespaceUsedElsewhere || !activeMockApi.cloudNamespace)}
          >
            {activeMockApi.isRunning 
              ? (isCloudMode ? 'Disconnect' : 'Stop Server')
              : (isCloudMode ? 'Connect' : 'Start Server')}
          </Button>
          <Tooltip content="Delete Mock API">
            <Button
              variant="ghost"
              size="md"
              onClick={handleDeleteMockApi}
              className="mocking-panel__delete-btn"
            >
              <TrashIcon />
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Cloud Proxy Settings */}
      {isCloudMode && (
        <div className="mocking-panel__cloud-settings">
          <div className="mocking-panel__cloud-row">
            <div className="mocking-panel__cloud-field">
              <label>Namespace</label>
              <div className="mocking-panel__namespace-input">
                <Input
                  value={activeMockApi.cloudNamespace || ''}
                  onChange={(e) => handleNamespaceChange(e.target.value)}
                  placeholder="my-api"
                  size="sm"
                  disabled={activeMockApi.isRunning}
                />
                <span className="mocking-panel__namespace-suffix">.echolon.app</span>
                <span className="mocking-panel__namespace-status">
                  {isCheckingNamespace && <span className="mocking-panel__checking">Checking...</span>}
                  {!isCheckingNamespace && isNamespaceUsedElsewhere && (
                    <span className="mocking-panel__unavailable">Used in another tab</span>
                  )}
                  {!isCheckingNamespace && !isNamespaceUsedElsewhere && namespaceAvailable === true && (
                    <span className="mocking-panel__available">Available</span>
                  )}
                  {!isCheckingNamespace && !isNamespaceUsedElsewhere && namespaceAvailable === false && (
                    <span className="mocking-panel__unavailable">In use</span>
                  )}
                </span>
              </div>
            </div>
            <div className="mocking-panel__cloud-field mocking-panel__cloud-field--wide">
              <label className="mocking-panel__label-with-help">
                Forward requests to (optional)
                <button 
                  className="mocking-panel__help-button"
                  onClick={() => setShowProxyFlowModal(true)}
                  type="button"
                  title="Learn how forwarding works"
                >
                  <HelpIcon />
                </button>
              </label>
              <Input
                value={activeMockApi.cloudForwardTo || ''}
                onChange={(e) => handleForwardToChange(e.target.value)}
                placeholder="https://api.example.com"
                size="sm"
                disabled={activeMockApi.isRunning}
              />
            </div>
          </div>
        </div>
      )}

      {/* Server Status */}
      <div className={`mocking-panel__status ${activeMockApi.isRunning ? 'running' : ''} ${isCloudMode ? 'cloud' : ''} ${cloudStatus === 'connecting' ? 'connecting' : ''}`}>
        <span className="mocking-panel__status-indicator" />
        <span className="mocking-panel__status-text">
          {isCloudMode ? (
            cloudStatus === 'connected' 
              ? `Connected to ${activeMockApi.cloudNamespace}.echolon.app`
              : cloudStatus === 'connecting'
                ? 'Connecting...'
                : cloudStatus === 'error'
                  ? 'Connection error'
                  : 'Disconnected'
          ) : (
            activeMockApi.isRunning 
              ? `Server running on port ${activeMockApi.port}` 
              : 'Server stopped'
          )}
        </span>
        {!isCloudMode && activeMockApi.isRunning && (
          <span className="mocking-panel__status-hint">
            Send requests to <code onClick={copyEndpoint}>{getMockEndpoint()}</code>
            <Tooltip content="Show QR code for mobile">
              <button 
                className="mocking-panel__qr-button"
                onClick={() => setShowQRCode(true)}
              >
                <QrCodeIcon />
              </button>
            </Tooltip>
          </span>
        )}
        {isCloudMode && cloudStatus === 'connected' && (
          <span className="mocking-panel__status-hint">
            <GlobeIcon /> Requests to <code>{getMockEndpoint()}</code> will be forwarded here
            {activeMockApi.cloudForwardTo && (
              <> and then to <code>{activeMockApi.cloudForwardTo}</code></>
            )}
             <Tooltip content="Show QR code for mobile">
              <button 
                className="mocking-panel__qr-button"
                onClick={() => setShowQRCode(true)}
              >
                <QrCodeIcon />
              </button>
            </Tooltip>
          </span>
        )}
      </div>

      {/* Quick Actions */}
      {!isCloudMode && activeMockApi.isRunning && (
        <div className="mocking-panel__quick-actions">
          <span className="mocking-panel__quick-actions-label">
            <ZapIcon /> Quick Test:
          </span>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => sendTestRequest('GET', '/todos')}
          >
            GET /todos
          </Button>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => sendTestRequest('POST', '/todos', JSON.stringify({ name: 'New Todo', status: 'open' }))}
          >
            POST /todos
          </Button>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => sendTestRequest('GET', '/todos/1')}
          >
            GET /todos/1
          </Button>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => sendTestRequest('PUT', '/todos/1', JSON.stringify({ name: 'Updated Todo', status: 'done' }))}
          >
            PUT /todos/1
          </Button>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => sendTestRequest('DELETE', '/todos/1')}
          >
            DELETE /todos/1
          </Button>
        </div>
      )}

      {/* Main Content */}
      <div className={`mocking-panel__content ${isResizingPanel ? 'resizing' : ''}`} ref={containerRef}>
        {/* Table Section */}
        <div className="mocking-panel__table-section" style={{ flex: selectedRequestId ? `0 0 calc(100% - ${detailsPanelHeight}px - 4px)` : '1' }}>
          {/* Search Bar */}
          <div className="mocking-panel__search-bar">
            <div className="mocking-panel__search">
              <SearchIcon />
              <input 
                type="text"
                placeholder="Search captured requests..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {filteredRequests.length > 0 && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => clearCapturedRequests(activeMockApi.id)}
              >
                <TrashIcon />
                Clear
              </Button>
            )}
          </div>

          {/* Request Table */}
          <div className="mocking-panel__request-table-container">
            {filteredRequests.length === 0 ? (
              <div className="mocking-panel__list-empty">
                <p>{searchQuery ? 'No matching requests' : 'No requests captured yet'}</p>
                <p className="hint">
                  {searchQuery 
                    ? 'Try adjusting your search query'
                    : activeMockApi.isRunning 
                      ? `Send requests to http://localhost:${activeMockApi.port} to see them here`
                      : 'Start the server to capture requests'}
                </p>
              </div>
            ) : (
              <table className="mocking-panel__request-table">
                <thead>
                  <tr>
                    <th 
                      className={`sortable ${sortField === 'method' ? `sorted ${sortDirection}` : ''}`}
                      onClick={() => handleSort('method')}
                    >
                      Method
                      <span className="sort-icon">
                        {sortField === 'method' ? (sortDirection === 'asc' ? <SortAscIcon /> : <SortDescIcon />) : null}
                      </span>
                    </th>
                    <th 
                      className={`sortable ${sortField === 'path' ? `sorted ${sortDirection}` : ''}`}
                      onClick={() => handleSort('path')}
                    >
                      Route
                      <span className="sort-icon">
                        {sortField === 'path' ? (sortDirection === 'asc' ? <SortAscIcon /> : <SortDescIcon />) : null}
                      </span>
                    </th>
                    <th 
                      className={`sortable ${sortField === 'status' ? `sorted ${sortDirection}` : ''}`}
                      onClick={() => handleSort('status')}
                    >
                      Status
                      <span className="sort-icon">
                        {sortField === 'status' ? (sortDirection === 'asc' ? <SortAscIcon /> : <SortDescIcon />) : null}
                      </span>
                    </th>
                    <th 
                      className={`sortable ${sortField === 'timestamp' ? `sorted ${sortDirection}` : ''}`}
                      onClick={() => handleSort('timestamp')}
                    >
                      Time
                      <span className="sort-icon">
                        {sortField === 'timestamp' ? (sortDirection === 'asc' ? <SortAscIcon /> : <SortDescIcon />) : null}
                      </span>
                    </th>
                    <th>Mocked</th>
                  </tr>
                </thead>
                <tbody ref={tableBodyRef}>
                  {filteredRequests.map(request => (
                    <tr
                      key={request.id}
                      className={`${request.isMocked ? 'mocked' : ''} ${selectedRequestId === request.id ? 'selected' : ''}`}
                      onClick={() => handleRequestClick(request)}
                      onContextMenu={(e) => handleContextMenu(e, request.id)}
                    >
                      <td className="method-cell">
                        <span style={{ color: getMethodColor(request.method) }}>
                          {request.method}
                        </span>
                      </td>
                      <td className="path-cell">{request.path}</td>
                      <td className="status-cell">
                        <span className={`status-badge ${
                          request.response?.status ? (
                            request.response.status >= 200 && request.response.status < 300 ? 'success' :
                            request.response.status >= 400 && request.response.status < 500 ? 'warning' :
                            request.response.status >= 500 ? 'error' : ''
                          ) : ''
                        }`}>
                          {request.response?.status || '-'}
                        </span>
                      </td>
                      <td className="time-cell">
                        {formatLogTime(request.timestamp)}
                      </td>
                      <td className="mocked-cell">
                        {request.isMocked && (
                          <span className="mocked-badge">
                            <CheckIcon /> Mocked
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Bottom Details Panel */}
        {selectedRequestId && selectedRequest && (
          <>
            {/* Resize Handle */}
            <div 
              className="mocking-panel__panel-resize-handle"
              onMouseDown={handlePanelResizeStart}
            />
            
            <div 
              className={`mocking-panel__details-panel ${isResizing ? 'resizing' : ''}`}
              style={{ height: detailsPanelHeight }}
            >
              {/* Details Header */}
              <div className="mocking-panel__details-header">
                <div className="mocking-panel__details-header-info">
                  <ColoredUrl url={selectedRequest.url} method={selectedRequest.method} />
                </div>
                
                <div className="mocking-panel__details-header-actions">
                  <div className="mocking-panel__mock-toggle">
                    <span>Enable Mock</span>
                    <ZapIcon />
                    <Switch
                      checked={selectedRequest?.isMocked || false}
                      onChange={handleToggleMock}
                      size="sm"
                    />
                  </div>
                  <Button 
                    variant="primary" 
                    size="sm" 
                    onClick={handleSaveMock}
                    icon={<CheckIcon />}
                    disabled={!isResponseModified}
                  >
                    Save Mock
                  </Button>
                  <Tooltip content="Delete request">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => handleDeleteRequest(selectedRequest.id)} 
                      icon={<TrashIcon />} 
                    />
                  </Tooltip>
                  <Tooltip content="Close">
                    <Button variant="ghost" size="sm" onClick={handleCloseDetails} icon={<CloseIcon />} />
                  </Tooltip>
                </div>
              </div>

              <div className="mocking-panel__details-content">
                {/* Left Pane - Request Info */}
                <div className="mocking-panel__pane mocking-panel__pane--request" style={{ width: leftPaneWidth }}>
                  <div className="mocking-panel__pane-header">
                    <h4><RequestIcon /> Request</h4>
                    <div className="mocking-panel__tabs">
                      <button
                        className={`tab ${requestTab === 'body' ? 'active' : ''}`}
                        onClick={() => setRequestTab('body')}
                      >
                        Body
                      </button>
                      <button
                        className={`tab ${requestTab === 'headers' ? 'active' : ''}`}
                        onClick={() => setRequestTab('headers')}
                      >
                        Headers
                      </button>
                      <button
                        className={`tab ${requestTab === 'query' ? 'active' : ''}`}
                        onClick={() => setRequestTab('query')}
                      >
                        Query
                      </button>
                      <button
                        className={`tab ${requestTab === 'details' ? 'active' : ''}`}
                        onClick={() => setRequestTab('details')}
                      >
                        Details
                      </button>
                    </div>
                  </div>
                  <div className="mocking-panel__pane-content">
                    {requestTab === 'body' && (
                      <>
                        {selectedRequest.body ? (
                          <div className="mocking-panel__editor-container mocking-panel__editor-container--readonly">
                            <div className="mocking-panel__editor">
                              <CodeEditor
                                mode="json"
                                value={(() => {
                                  try {
                                    return JSON.stringify(JSON.parse(selectedRequest.body), null, 2);
                                  } catch {
                                    return selectedRequest.body;
                                  }
                                })()}
                                readOnly={true}
                                width="100%"
                                height="100%"
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="mocking-panel__empty-section">
                            <p>No body in this request</p>
                          </div>
                        )}
                      </>
                    )}

                    {requestTab === 'headers' && (
                      <>
                        {selectedRequest.headers.length > 0 ? (
                          <table className="mocking-panel__info-table">
                            <tbody>
                              {selectedRequest.headers.map((h, i) => (
                                <tr key={i}>
                                  <td className="key">{h.key}</td>
                                  <td className="value">{h.value}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="mocking-panel__empty-section">
                            <p>No headers in this request</p>
                          </div>
                        )}
                      </>
                    )}

                    {requestTab === 'query' && (
                      <>
                        {Object.keys(selectedRequest.queryParams || {}).length > 0 ? (
                          <table className="mocking-panel__info-table">
                            <thead>
                              <tr>
                                <th>Key</th>
                                <th>Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(selectedRequest.queryParams || {}).map(([key, value], i) => (
                                <tr key={i}>
                                  <td className="key">{key}</td>
                                  <td className="value">{value}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="mocking-panel__empty-section">
                            <p>No query parameters in this request</p>
                          </div>
                        )}
                      </>
                    )}

                    {requestTab === 'details' && (
                      <div className="mocking-panel__details-info">
                        <table className="mocking-panel__info-table">
                          <tbody>
                            <tr>
                              <td className="key">Request ID</td>
                              <td className="value">
                                <code>{selectedRequest.id}</code>
                              </td>
                            </tr>
                            <tr>
                              <td className="key">Timestamp</td>
                              <td className="value">
                                {formatDateTime(selectedRequest.timestamp)}
                              </td>
                            </tr>
                            <tr>
                              <td className="key">Method</td>
                              <td className="value">
                                <span style={{ color: getMethodColor(selectedRequest.method) }}>
                                  {selectedRequest.method}
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <td className="key">Full URL</td>
                              <td className="value">
                                <code>{selectedRequest.url}</code>
                              </td>
                            </tr>
                            <tr>
                              <td className="key">Path</td>
                              <td className="value">
                                <code>{selectedRequest.path}</code>
                              </td>
                            </tr>
                            <tr>
                              <td className="key">Mock API</td>
                              <td className="value">{selectedRequest.mockApiId}</td>
                            </tr>
                            <tr>
                              <td className="key">Is Mocked</td>
                              <td className="value">
                                {selectedRequest.isMocked ? (
                                  <span className="mocking-panel__badge mocking-panel__badge--success">Yes</span>
                                ) : (
                                  <span className="mocking-panel__badge">No</span>
                                )}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>

                {/* Resize Handle */}
                <div 
                  className="mocking-panel__resize-handle"
                  onMouseDown={handleResizeStart}
                />

                {/* Right Pane - Response Editor */}
                <div className="mocking-panel__pane mocking-panel__pane--response">
                  <div className="mocking-panel__pane-header">
                    <h4><ResponseIcon /> Response</h4>
                    <div className="mocking-panel__tabs">
                      <button
                        className={`tab ${responseTab === 'body' ? 'active' : ''}`}
                        onClick={() => setResponseTab('body')}
                      >
                        Body
                      </button>
                      <button
                        className={`tab ${responseTab === 'headers' ? 'active' : ''}`}
                        onClick={() => setResponseTab('headers')}
                      >
                        Headers
                      </button>
                    </div>
                  </div>
                  
                  <div className="mocking-panel__pane-content">
                    {responseTab === 'body' && (
                      <>
                        {/* Status Row */}
                        <div className="mocking-panel__response-meta">
                          <div className="mocking-panel__field">
                            <label>Status</label>
                            <Input
                              type="number"
                              value={editedResponse.status || 200}
                              onChange={(e) => setEditedResponse(prev => ({ 
                                ...prev, 
                                status: parseInt(e.target.value, 10) 
                              }))}
                              size="sm"
                            />
                          </div>
                          <div className="mocking-panel__field">
                            <label>Status Text</label>
                            <Input
                              value={editedResponse.statusText || 'OK'}
                              onChange={(e) => setEditedResponse(prev => ({ 
                                ...prev, 
                                statusText: e.target.value 
                              }))}
                              size="sm"
                            />
                          </div>
                        </div>

                        <div className="mocking-panel__editor-container">
                          <div className="mocking-panel__editor-toolbar">
                            <Tooltip content="Format JSON">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={handlePrettyPrint}
                                icon={<FormatIcon />}
                              >
                                Pretty Print
                              </Button>
                            </Tooltip>
                          </div>
                          <div className="mocking-panel__editor">
                            <CodeEditor
                              mode="json"
                              value={editedResponse.body || ''}
                              onChange={(value) => setEditedResponse(prev => ({ ...prev, body: value }))}
                              width="100%"
                              height="100%"
                            />
                          </div>
                        </div>
                      </>
                    )}

                    {responseTab === 'headers' && (
                      <div className="mocking-panel__headers-editor">
                        <EditableTable
                          data={editedResponse.headers || []}
                          onChange={handleHeadersChange}
                          keyPlaceholder="Header"
                          valuePlaceholder="Value"
                          showDescription={false}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Proxy Flow Explanation Modal */}
      <ProxyFlowModal 
        isOpen={showProxyFlowModal} 
        onClose={() => setShowProxyFlowModal(false)} 
      />

      {/* Mock Mode Help Modal */}
      <MockModeHelpModal
        isOpen={showMockModeHelp}
        onClose={() => setShowMockModeHelp(false)}
      />

      {/* QR Code Modal for mobile access */}
      {activeMockApi && (
        <QRCodeModal
          isOpen={showQRCode}
          onClose={() => setShowQRCode(false)}
          url={`http://${localHostname}:${activeMockApi.port}`}
        />
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div 
          className="mocking-panel__context-menu"
          style={{ 
            position: 'fixed', 
            left: contextMenu.x, 
            top: contextMenu.y,
            zIndex: 1000,
          }}
        >
          <button 
            onClick={() => {
              handleDeleteRequest(contextMenu.requestId);
              closeContextMenu();
            }}
          >
            <TrashIcon />
            Delete request
          </button>
        </div>
      )}
    </div>
  );
};

export default MockingPanel;
