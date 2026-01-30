import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Modal, Button, Tooltip, CodeEditor, ClockIcon, CheckIcon, XIcon, LoadIcon, CopyIcon, TerminalIcon, EmptyHistoryIcon, InfoIcon, TrashIcon } from '@/components/ui';
import { useRequest, useTheme } from '@/contexts';
import { HistoryEntry, Request } from '@/types';
import { METHOD_COLORS } from '../../../../shared/constants';
import { generateCurl, generateCurlFromResolved } from '@/utils/codeGenerators';
import { formatRelativeDate } from '@/utils';
import './RequestHistoryModal.css';

const getMethodColor = (method: string): string => {
  return METHOD_COLORS[method] || '#9ca3af';
};

// Time range shortcut options
type TimeRangeShortcut = '1h' | '24h' | 'today' | '7d' | 'all' | 'custom';

const TIME_RANGE_SHORTCUTS: { value: TimeRangeShortcut; label: string }[] = [
  { value: '1h', label: '1h' },
  { value: '24h', label: '24h' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7d' },
  { value: 'all', label: 'All' },
];

// Status code categories
type StatusCategory = '2xx' | '3xx' | '4xx' | '5xx' | 'error';

const STATUS_CATEGORIES: { value: StatusCategory; label: string; color: string }[] = [
  { value: '2xx', label: '2xx Success', color: '#22c55e' },
  { value: '3xx', label: '3xx Redirect', color: '#3b82f6' },
  { value: '4xx', label: '4xx Client Error', color: '#f59e0b' },
  { value: '5xx', label: '5xx Server Error', color: '#ef4444' },
  { value: 'error', label: 'Failed', color: '#ef4444' },
];

// Helper to get start of today
const getStartOfToday = (): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

// Helper to get end of today (23:59:59.999)
const getEndOfToday = (): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
};

// Apply shortcut to date range
const applyShortcut = (shortcut: TimeRangeShortcut): { from: Date; to: Date } => {
  const now = new Date();
  const to = getEndOfToday();
  
  switch (shortcut) {
    case '1h':
      return { from: new Date(now.getTime() - 60 * 60 * 1000), to: now };
    case '24h':
      return { from: new Date(now.getTime() - 24 * 60 * 60 * 1000), to: now };
    case 'today':
      return { from: getStartOfToday(), to };
    case '7d':
      return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to };
    case 'all':
      return { from: new Date(0), to };
    default:
      return { from: getStartOfToday(), to };
  }
};

// Format date for display (compact: DD.MM.YY HH:mm)
const formatDateCompact = (date: Date): string => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}`;
};

// Parse compact date format (DD.MM.YY HH:mm)
const parseDateCompact = (value: string): Date | null => {
  // Try parsing DD.MM.YY HH:mm format
  const match = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})\s+(\d{1,2}):(\d{2})$/);
  if (match) {
    const [, day, month, year, hours, minutes] = match;
    const fullYear = 2000 + parseInt(year, 10);
    const date = new Date(fullYear, parseInt(month, 10) - 1, parseInt(day, 10), parseInt(hours, 10), parseInt(minutes, 10));
    if (!isNaN(date.getTime())) return date;
  }
  
  // Fallback: try native Date parsing
  const fallback = new Date(value);
  return isNaN(fallback.getTime()) ? null : fallback;
};

const getStatusCategory = (status?: number): StatusCategory | null => {
  if (!status) return 'error';
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500) return '5xx';
  return null;
};

// Default selected statuses
const DEFAULT_STATUSES: StatusCategory[] = ['2xx', '3xx', '4xx', '5xx', 'error'];

interface RequestHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: Request | null;
}

export const RequestHistoryModal: React.FC<RequestHistoryModalProps> = ({
  isOpen,
  onClose,
  request,
}) => {
  const { resolvedTheme } = useTheme();
  const { getRequestHistory, addTab, clearHistory } = useRequest();
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
  const [activeTab, setActiveTab] = useState<'request' | 'response'>('response');
  const [curlCopied, setCurlCopied] = useState(false);
  
  // Date range filter state
  const [dateFrom, setDateFrom] = useState<Date>(() => getStartOfToday());
  const [dateTo, setDateTo] = useState<Date>(() => getEndOfToday());
  const [activeShortcut, setActiveShortcut] = useState<TimeRangeShortcut>('today');
  const [selectedStatuses, setSelectedStatuses] = useState<Set<StatusCategory>>(() => new Set(DEFAULT_STATUSES));
  
  // Track if modal was previously open to avoid resetting on every render
  const wasOpenRef = useRef(false);
  
  // Generate curl command for the selected entry
  const curlCommand = useMemo(() => {
    if (!selectedEntry) return '';
    // Use resolved request if available (contains already-interpolated values)
    if (selectedEntry.resolvedRequest) {
      return generateCurlFromResolved(selectedEntry.resolvedRequest);
    }
    // Fallback to original request
    return generateCurl(selectedEntry.request, null, null);
  }, [selectedEntry]);

  const handleCopyCurl = async () => {
    await navigator.clipboard.writeText(curlCommand);
    setCurlCopied(true);
    setTimeout(() => setCurlCopied(false), 2000);
  };

  // Get history for this specific request
  const allHistory = useMemo(() => {
    if (!request?.id) return [];
    return getRequestHistory(request.id);
  }, [request?.id, getRequestHistory]);

  // Get unique status codes from history
  const availableStatusCategories = useMemo(() => {
    const categories = new Set<StatusCategory>();
    allHistory.forEach(entry => {
      const cat = getStatusCategory(entry.response?.status);
      if (cat) categories.add(cat);
    });
    return categories;
  }, [allHistory]);

  // Filter history by date range and status
  const requestHistory = useMemo(() => {
    const fromTime = dateFrom.getTime();
    const toTime = dateTo.getTime();
    return allHistory.filter(entry => {
      // Date range filter
      if (entry.timestamp < fromTime || entry.timestamp > toTime) return false;
      // Status filter
      const category = getStatusCategory(entry.response?.status);
      if (category && !selectedStatuses.has(category)) return false;
      return true;
    });
  }, [allHistory, dateFrom, dateTo, selectedStatuses]);

  // Handle shortcut click
  const handleShortcutClick = useCallback((shortcut: TimeRangeShortcut) => {
    const { from, to } = applyShortcut(shortcut);
    setDateFrom(from);
    setDateTo(to);
    setDateFromText(formatDateCompact(from));
    setDateToText(formatDateCompact(to));
    setActiveShortcut(shortcut);
  }, []);

  // State for text input values (allows typing before parsing)
  const [dateFromText, setDateFromText] = useState(() => formatDateCompact(getStartOfToday()));
  const [dateToText, setDateToText] = useState(() => formatDateCompact(getEndOfToday()));

  // Handle date input change
  const handleDateFromChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setDateFromText(value);
    const date = parseDateCompact(value);
    if (date) {
      setDateFrom(date);
      setActiveShortcut('custom');
    }
  }, []);

  const handleDateToChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setDateToText(value);
    const date = parseDateCompact(value);
    if (date) {
      setDateTo(date);
      setActiveShortcut('custom');
    }
  }, []);

  // Toggle status category
  const toggleStatusCategory = useCallback((category: StatusCategory) => {
    setSelectedStatuses(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        // Don't allow deselecting all
        if (next.size > 1) {
          next.delete(category);
        }
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  // Reset filters to defaults
  const resetFilters = useCallback(() => {
    const { from, to } = applyShortcut('today');
    setDateFrom(from);
    setDateTo(to);
    setDateFromText(formatDateCompact(from));
    setDateToText(formatDateCompact(to));
    setActiveShortcut('today');
    setSelectedStatuses(new Set(DEFAULT_STATUSES));
  }, []);

  // Handle modal open/close
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      // Modal just opened - reset to defaults and select first entry
      resetFilters();
      wasOpenRef.current = true;
    } else if (!isOpen && wasOpenRef.current) {
      // Modal just closed - reset selection
      setSelectedEntry(null);
      setActiveTab('response');
      wasOpenRef.current = false;
    }
  }, [isOpen, resetFilters]);

  // Select first entry when history changes (after filtering)
  useEffect(() => {
    if (isOpen && requestHistory.length > 0 && !selectedEntry) {
      setSelectedEntry(requestHistory[0]);
    }
  }, [isOpen, requestHistory, selectedEntry]);


  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getStatusClass = (status?: number) => {
    if (!status) return 'error';
    if (status >= 200 && status < 300) return 'success';
    if (status >= 300 && status < 400) return 'redirect';
    if (status >= 400 && status < 500) return 'client-error';
    return 'server-error';
  };

  const handleLoadRequest = () => {
    if (selectedEntry) {
      addTab(selectedEntry.request);
      onClose();
    }
  };

  const handleCopyResponse = async () => {
    if (selectedEntry?.response?.body) {
      await navigator.clipboard.writeText(selectedEntry.response.body);
    }
  };

  const formatBody = (body: string | undefined, contentType?: string) => {
    if (!body) return '';
    if (contentType?.includes('json')) {
      try {
        return JSON.stringify(JSON.parse(body), null, 2);
      } catch {
        return body;
      }
    }
    return body;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Request History${request?.name ? `: ${request.name}` : ''}`}
      size="xl"
      className="request-history-modal"
    >
      <div className="request-history-modal__content">
        {allHistory.length === 0 ? (
          <div className="request-history-modal__empty">
            <EmptyHistoryIcon />
            <h3>No History Yet</h3>
            <p>Send this request to start building your history.</p>
            <p className="request-history-modal__empty-hint">
              Each time you send a request, the full request and response will be saved here.
            </p>
          </div>
        ) : (
          <>
            {/* History List */}
            <div className="request-history-modal__list">
              <div className="request-history-modal__list-header">
                <span>{requestHistory.length} execution{requestHistory.length !== 1 ? 's' : ''}{requestHistory.length !== allHistory.length ? ` of ${allHistory.length}` : ''}</span>
                <Tooltip content="Clear all history">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearHistory}
                    icon={<TrashIcon />}
                    className="request-history-modal__clear-btn"
                  />
                </Tooltip>
              </div>
              
              {/* Filters */}
              <div className="request-history-modal__filters">
                {/* Date Range */}
                <div className="request-history-modal__date-filter">
                  <div className="request-history-modal__date-inputs">
                    <div className="request-history-modal__date-input-group">
                      <label>From</label>
                      <input
                        type="text"
                        value={dateFromText}
                        onChange={handleDateFromChange}
                        placeholder="DD.MM.YY HH:mm"
                        className="request-history-modal__date-input"
                      />
                    </div>
                    <span className="request-history-modal__date-separator">→</span>
                    <div className="request-history-modal__date-input-group">
                      <label>To</label>
                      <input
                        type="text"
                        value={dateToText}
                        onChange={handleDateToChange}
                        placeholder="DD.MM.YY HH:mm"
                        className="request-history-modal__date-input"
                      />
                    </div>
                  </div>
                  <div className="request-history-modal__time-shortcuts">
                    {TIME_RANGE_SHORTCUTS.map(opt => (
                      <button
                        key={opt.value}
                        className={`request-history-modal__time-btn ${activeShortcut === opt.value ? 'active' : ''}`}
                        onClick={() => handleShortcutClick(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                
                {/* Status Filter */}
                <div className="request-history-modal__status-filter">
                  {STATUS_CATEGORIES.map(cat => (
                    <button
                      key={cat.value}
                      className={`request-history-modal__status-btn ${selectedStatuses.has(cat.value) ? 'active' : ''} ${!availableStatusCategories.has(cat.value) ? 'disabled' : ''}`}
                      onClick={() => toggleStatusCategory(cat.value)}
                      disabled={!availableStatusCategories.has(cat.value)}
                      style={{
                        '--status-color': cat.color,
                      } as React.CSSProperties}
                    >
                      {cat.value === 'error' ? 'ERR' : cat.value}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="request-history-modal__list-items">
                {requestHistory.length === 0 ? (
                  <div className="request-history-modal__no-results">
                    <p>No executions match filters</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        handleShortcutClick('all');
                        setSelectedStatuses(new Set(DEFAULT_STATUSES));
                      }}
                    >
                      Clear filters
                    </Button>
                  </div>
                ) : (
                  requestHistory.map((entry) => (
                    <div
                      key={entry.id}
                      className={`request-history-modal__item ${selectedEntry?.id === entry.id ? 'selected' : ''}`}
                      onClick={() => setSelectedEntry(entry)}
                    >
                      <div className="request-history-modal__item-status">
                        {entry.response ? (
                          <span className={`request-history-modal__status-badge request-history-modal__status-badge--${getStatusClass(entry.response.status)}`}>
                            <a 
                              href={`https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/${entry.response.status}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="request-history-modal__status-link"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {entry.response.status}
                            </a>
                          </span>
                        ) : (
                          <span className="request-history-modal__status-badge request-history-modal__status-badge--error">
                            ERR
                          </span>
                        )}
                      </div>
                      <div className="request-history-modal__item-info">
                        <div className="request-history-modal__item-method" style={{ color: getMethodColor(entry.request.method) }}>
                          {entry.request.method}
                        </div>
                        <div className="request-history-modal__item-url" title={entry.resolvedRequest?.url || entry.request.url}>
                          {entry.resolvedRequest?.url || entry.request.url}
                        </div>
                      </div>
                      <div className="request-history-modal__item-meta">
                        <span className="request-history-modal__item-duration">
                          {formatDuration(entry.duration)}
                        </span>
                        <span className="request-history-modal__item-time">
                          <ClockIcon />
                          {formatRelativeDate(entry.timestamp)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Details Panel */}
            <div className="request-history-modal__details">
              {selectedEntry ? (
                <>
                  <div className="request-history-modal__details-header">
                    <div className="request-history-modal__details-tabs">
                      <button
                        className={`request-history-modal__details-tab ${activeTab === 'response' ? 'active' : ''}`}
                        onClick={() => setActiveTab('response')}
                      >
                        Response
                        {selectedEntry.response && (
                          <span className={`request-history-modal__tab-badge request-history-modal__tab-badge--${getStatusClass(selectedEntry.response.status)}`}>
                            <a 
                              href={`https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/${selectedEntry.response.status}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="request-history-modal__status-link"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {selectedEntry.response.status}
                            </a>
                          </span>
                        )}
                      </button>
                      <button
                        className={`request-history-modal__details-tab ${activeTab === 'request' ? 'active' : ''}`}
                        onClick={() => setActiveTab('request')}
                      >
                        Request
                      </button>
                    </div>
                    <div className="request-history-modal__details-actions">
                    
                      <Tooltip content="Load this request">
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<LoadIcon />}
                          onClick={handleLoadRequest}
                        >
                          Load
                        </Button>
                      </Tooltip>
                    </div>
                  </div>

                  <div className="request-history-modal__details-content">
                    {activeTab === 'response' && (
                      <div className="request-history-modal__response">
                        {selectedEntry.response ? (
                          <>
                            <div className="request-history-modal__response-meta">
                              <span className={`request-history-modal__response-status request-history-modal__response-status--${getStatusClass(selectedEntry.response.status)}`}>
                                {selectedEntry.response.status >= 200 && selectedEntry.response.status < 300 ? (
                                  <CheckIcon />
                                ) : (
                                  <XIcon />
                                )}
                                <a 
                                  href={`https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/${selectedEntry.response.status}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="request-history-modal__status-link"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {selectedEntry.response.status}
                                </a>
                                {' '}{selectedEntry.response.statusText}
                              </span>
                              <span className="request-history-modal__response-info">
                                {formatDuration(selectedEntry.duration)} • {(selectedEntry.response.size / 1024).toFixed(2)} KB
                              </span>
                            </div>
                            
                            <div className="request-history-modal__response-headers">
                              <h4>Headers</h4>
                              <div className="request-history-modal__headers-list">
                                {selectedEntry.response.headers.map((h, i) => (
                                  <div key={i} className="request-history-modal__header-row">
                                    <span className="request-history-modal__header-key">{h.key}</span>
                                    <span className="request-history-modal__header-value">{h.value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="request-history-modal__response-body">
                              <h4>Body</h4>
                              {selectedEntry.responseBodyOmitted ? (
                                <div className="request-history-modal__body-omitted">
                                  <InfoIcon />
                                  <div>
                                    <strong>Response body not saved</strong>
                                    <p>
                                      Binary response ({formatBytes(selectedEntry.responseBodyOriginalSize || 0)}) exceeded the history size limit.
                                      You can adjust this in Settings → Requests → History.
                                    </p>
                                  </div>
                                </div>
                              ) : (
                                <div className="request-history-modal__body-editor">
                                  <CodeEditor
                                    mode={selectedEntry.response.contentType?.includes('json') ? 'json' : 'text'}
                                    value={formatBody(selectedEntry.response.body, selectedEntry.response.contentType)}
                                    readOnly
                                    width="100%"
                                    height="300px"
                                  />
                                </div>
                              )}
                            </div>
                          </>
                        ) : (
                          <div className="request-history-modal__response-error">
                            <XIcon />
                            <span>Request failed - no response received</span>
                          </div>
                        )}
                      </div>
                    )}

                    {activeTab === 'request' && (
                      <div className="request-history-modal__request">
                        <div className="request-history-modal__request-url">
                          <span className="request-history-modal__request-method" style={{ color: getMethodColor(selectedEntry.request.method) }}>
                            {selectedEntry.request.method}
                          </span>
                          <span className="request-history-modal__request-url-text">
                            {selectedEntry.resolvedRequest?.url || selectedEntry.request.url}
                          </span>
                        </div>

                        {/* cURL Command */}
                        <div className="request-history-modal__curl">
                          <div className="request-history-modal__curl-header">
                            <h4><TerminalIcon /> cURL</h4>
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={<CopyIcon />}
                              onClick={handleCopyCurl}
                            >
                              {curlCopied ? 'Copied!' : 'Copy'}
                            </Button>
                          </div>
                          <pre className="request-history-modal__curl-code">{curlCommand}</pre>
                        </div>

                        {(selectedEntry.resolvedRequest?.headers || selectedEntry.request.headers).length > 0 && (
                          <div className="request-history-modal__request-headers">
                            <h4>Headers</h4>
                            <div className="request-history-modal__headers-list">
                              {selectedEntry.resolvedRequest?.headers
                                ? selectedEntry.resolvedRequest.headers.map((h, i) => (
                                    <div key={i} className="request-history-modal__header-row">
                                      <span className="request-history-modal__header-key">{h.key}</span>
                                      <span className="request-history-modal__header-value">{h.value}</span>
                                    </div>
                                  ))
                                : selectedEntry.request.headers
                                    .filter(h => h.enabled && h.key)
                                    .map((h, i) => (
                                      <div key={i} className="request-history-modal__header-row">
                                        <span className="request-history-modal__header-key">{h.key}</span>
                                        <span className="request-history-modal__header-value">{h.value}</span>
                                      </div>
                                    ))
                              }
                            </div>
                          </div>
                        )}

                        {selectedEntry.request.body.type !== 'none' && (selectedEntry.resolvedRequest?.body || selectedEntry.request.body.content) && (
                          <div className="request-history-modal__request-body">
                            <h4>Body ({selectedEntry.request.body.type})</h4>
                            <div className="request-history-modal__body-editor">
                              <CodeEditor
                                mode={selectedEntry.request.body.type === 'json' ? 'json' : 'text'}
                                value={formatBody(selectedEntry.resolvedRequest?.body || selectedEntry.request.body.content, selectedEntry.request.body.type === 'json' ? 'application/json' : undefined)}
                                readOnly
                                width="100%"
                                height="200px"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="request-history-modal__no-selection">
                  <p>Select an entry to view details</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default RequestHistoryModal;

