import React, { useState, useMemo } from 'react';
import { Modal, Button, Tooltip, CodeEditor, ClockIcon, CheckIcon, XIcon, LoadIcon, CopyIcon, TerminalIcon, EmptyHistoryIcon } from '@/components/ui';
import { useRequest, useTheme } from '@/contexts';
import { HistoryEntry, Request } from '@/types';
import { METHOD_COLORS } from '../../../../shared/constants';
import { generateCurl } from '@/utils/codeGenerators';
import './RequestHistoryModal.css';

const getMethodColor = (method: string): string => {
  return METHOD_COLORS[method] || '#9ca3af';
};

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
  const { getRequestHistory, addTab } = useRequest();
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
  const [activeTab, setActiveTab] = useState<'request' | 'response'>('response');
  const [curlCopied, setCurlCopied] = useState(false);
  
  // Generate curl command for the selected entry
  const curlCommand = useMemo(() => {
    if (!selectedEntry) return '';
    return generateCurl(selectedEntry.request, null, null);
  }, [selectedEntry]);

  const handleCopyCurl = async () => {
    await navigator.clipboard.writeText(curlCommand);
    setCurlCopied(true);
    setTimeout(() => setCurlCopied(false), 2000);
  };

  // Get history for this specific request
  const requestHistory = useMemo(() => {
    if (!request?.id) return [];
    return getRequestHistory(request.id);
  }, [request?.id, getRequestHistory]);

  // When modal opens, select the first entry if available
  React.useEffect(() => {
    if (isOpen && requestHistory.length > 0 && !selectedEntry) {
      setSelectedEntry(requestHistory[0]);
    }
    if (!isOpen) {
      setSelectedEntry(null);
      setActiveTab('response');
    }
  }, [isOpen, requestHistory]);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    if (isToday) {
      return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (isYesterday) {
      return `Yesterday at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return date.toLocaleDateString([], { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
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
        {requestHistory.length === 0 ? (
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
                <span>{requestHistory.length} execution{requestHistory.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="request-history-modal__list-items">
                {requestHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className={`request-history-modal__item ${selectedEntry?.id === entry.id ? 'selected' : ''}`}
                    onClick={() => setSelectedEntry(entry)}
                  >
                    <div className="request-history-modal__item-status">
                      {entry.response ? (
                        <span className={`request-history-modal__status-badge request-history-modal__status-badge--${getStatusClass(entry.response.status)}`}>
                          {entry.response.status}
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
                      <div className="request-history-modal__item-url" title={entry.request.url}>
                        {entry.request.url}
                      </div>
                    </div>
                    <div className="request-history-modal__item-meta">
                      <span className="request-history-modal__item-time">
                        <ClockIcon />
                        {formatDate(entry.timestamp)}
                      </span>
                      <span className="request-history-modal__item-duration">
                        {formatDuration(entry.duration)}
                      </span>
                    </div>
                  </div>
                ))}
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
                            {selectedEntry.response.status}
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
                      <Tooltip content="Copy response body">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<CopyIcon />}
                          onClick={handleCopyResponse}
                          disabled={!selectedEntry.response?.body}
                        />
                      </Tooltip>
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
                                {selectedEntry.response.status} {selectedEntry.response.statusText}
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
                              <div className="request-history-modal__body-editor">
                                <CodeEditor
                                  mode={selectedEntry.response.contentType?.includes('json') ? 'json' : 'text'}
                                  value={formatBody(selectedEntry.response.body, selectedEntry.response.contentType)}
                                  readOnly
                                  width="100%"
                                  height="300px"
                                />
                              </div>
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
                            {selectedEntry.request.url}
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

                        {selectedEntry.request.headers.length > 0 && (
                          <div className="request-history-modal__request-headers">
                            <h4>Headers</h4>
                            <div className="request-history-modal__headers-list">
                              {selectedEntry.request.headers
                                .filter(h => h.enabled && h.key)
                                .map((h, i) => (
                                  <div key={i} className="request-history-modal__header-row">
                                    <span className="request-history-modal__header-key">{h.key}</span>
                                    <span className="request-history-modal__header-value">{h.value}</span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}

                        {selectedEntry.request.body.type !== 'none' && selectedEntry.request.body.content && (
                          <div className="request-history-modal__request-body">
                            <h4>Body ({selectedEntry.request.body.type})</h4>
                            <div className="request-history-modal__body-editor">
                              <CodeEditor
                                mode={selectedEntry.request.body.type === 'json' ? 'json' : 'text'}
                                value={formatBody(selectedEntry.request.body.content, selectedEntry.request.body.type === 'json' ? 'application/json' : undefined)}
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

