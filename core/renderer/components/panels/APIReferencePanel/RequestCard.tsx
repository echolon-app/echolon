import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Button, Input, Dropdown, TabBar, EditableTable, CodeEditor } from '@/components/ui';
import { SendIcon, ChevronDownIcon, ChevronUpIcon } from '@/components/ui/icons';
import { useEnvironments, useTheme, useCollections } from '@/contexts';
import { requestService, storageManager } from '@/services';
import { HTTP_METHODS, METHOD_COLORS, DEFAULT_HEADERS } from '../../../../shared/constants';
import { Request, Collection, KeyValuePair, HttpMethod, RequestExecution, CollectionEnvironment, AuthType } from '@/types';
import { ResponseViewer } from '../CenterPanel/ResponseViewer';
import { extractSpecResponseInfo } from '@/utils';

const CUSTOM_METHOD_COLOR = '#9ca3af';

const getMethodColor = (method: string): string => {
  return METHOD_COLORS[method] || CUSTOM_METHOD_COLOR;
};

type RequestTab = 'params' | 'auth' | 'headers' | 'body';

const requestTabs = [
  { id: 'params', title: 'Params' },
  { id: 'headers', title: 'Headers' },
  { id: 'body', title: 'Body' },
  { id: 'auth', title: 'Auth' },
];

interface RequestCardProps {
  request: Request;
  collection: Collection;
}

export const RequestCard: React.FC<RequestCardProps> = ({ request: initialRequest, collection }) => {
  const { resolvedTheme } = useTheme();
  const { activeEnvironment } = useEnvironments();
  const { updateRequest: updateCollectionRequest } = useCollections();

  // Extract spec response info for example/schema display
  const specResponseInfo = useMemo(() => {
    const rawSpec = collection?.specSource?.rawSpec;
    if (!rawSpec) return null;
    return extractSpecResponseInfo(rawSpec, initialRequest.url, initialRequest.method);
  }, [collection?.specSource?.rawSpec, initialRequest.url, initialRequest.method]);

  // Check if we have spec info (example or schema)
  const hasSpecInfo = specResponseInfo && (specResponseInfo.example || specResponseInfo.schema);

  // Local state for the request (editable copy)
  const [request, setRequest] = useState<Request>(initialRequest);
  const [expanded, setExpanded] = useState(false);
  const [activeRequestTab, setActiveRequestTab] = useState<RequestTab>('params');
  const [isLoading, setIsLoading] = useState(false);
  const [execution, setExecution] = useState<RequestExecution | null>(null);
  const [showResponse, setShowResponse] = useState(false);
  
  // Track if we've initialized showResponse based on spec info
  const hasInitializedShowResponse = useRef(false);
  
  // Default to showing response if there's spec info (example/schema) on first render
  useEffect(() => {
    if (!hasInitializedShowResponse.current && hasSpecInfo) {
      setShowResponse(true);
      hasInitializedShowResponse.current = true;
    }
  }, [hasSpecInfo]);

  // Get the selected collection environment for variable resolution
  const selectedCollectionEnv = useMemo(() => {
    if (!collection?.environments || !collection.defaultEnvironmentId) {
      return null;
    }
    return collection.environments.find(e => e.id === collection.defaultEnvironmentId) || null;
  }, [collection]);

  // Collection-level headers
  const collectionHeaders = collection?.headers?.filter(h => h.enabled && h.key) || [];

  // Get overrides for inherited collection headers (stored in request headers with special prefix)
  const inheritedHeaderOverrides = useMemo(() => {
    const overrides = new Map<string, boolean>();
    request.headers
      .filter(h => h.id?.startsWith('__inherited_header_override__'))
      .forEach(h => {
        overrides.set(h.key, h.enabled);
      });
    return overrides;
  }, [request.headers]);

  // Update local request state
  const updateLocalRequest = useCallback((updates: Partial<Request>) => {
    setRequest(prev => ({ ...prev, ...updates }));
  }, []);

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

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = e.target.value;
    const newParams = parseUrlParams(newUrl);
    
    if (newUrl.includes('?') && newParams.length > 0) {
      updateLocalRequest({ url: newUrl, queryParams: newParams });
    } else {
      updateLocalRequest({ url: newUrl });
    }
  };

  const handleMethodChange = (method: string) => {
    updateLocalRequest({ method: method.toUpperCase() as HttpMethod });
  };

  const handleQueryParamsChange = (params: KeyValuePair[]) => {
    const newUrl = buildUrlWithParams(request.url, params);
    updateLocalRequest({ queryParams: params, url: newUrl });
  };

  const handleHeadersChange = (headers: KeyValuePair[]) => {
    // Get request-level headers (filter out inherited headers)
    let requestHeaders = headers.filter(h => !h.inheritedFrom);
    
    // Remove any existing override markers
    requestHeaders = requestHeaders.filter(h => !h.id?.startsWith('__inherited_header_override__'));
    
    // Handle inherited header overrides
    const inheritedHeaders = headers.filter(h => h.inheritedFrom);
    inheritedHeaders.forEach(ih => {
      const originalHeader = collectionHeaders.find(ch => ch.id === ih.id);
      if (originalHeader && ih.enabled !== originalHeader.enabled) {
        // Store override for inherited header
        requestHeaders.push({
          id: '__inherited_header_override__' + ih.id,
          key: ih.id,
          value: '',
          enabled: ih.enabled,
          description: `Override for inherited header: ${ih.key}`,
        });
      }
    });
    
    updateLocalRequest({ headers: requestHeaders });
  };

  const handleBodyChange = (content: string) => {
    updateLocalRequest({ body: { ...request.body, content } });
  };

  const handleSend = async () => {
    setIsLoading(true);
    setExecution(null);
    setShowResponse(true);

    try {
      const settings = storageManager.getSettings();
      const result = await requestService.execute(
        request,
        activeEnvironment,
        settings.requestTimeout,
        collection,
        settings,
        selectedCollectionEnv
      );
      setExecution(result);
    } catch (error) {
      console.error('Request failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Method options
  const methodOptions = HTTP_METHODS.map(method => ({
    value: method,
    label: method,
    color: METHOD_COLORS[method],
  }));

  return (
    <div className={`request-card ${expanded ? 'request-card--expanded' : ''}`}>
      {/* Request Header with Name */}
      <div className="request-card__header" onClick={() => setExpanded(!expanded)}>
        <span 
          className="request-card__method"
          style={{ color: getMethodColor(request.method) }}
        >
          {request.method}
        </span>
        <span className="request-card__name">{request.name}</span>
        <span className="request-card__path">{request.url}</span>
        <button className="request-card__toggle">
          {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </button>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="request-card__content">
          {/* URL Bar */}
          <div className="request-card__url-bar">
            <Dropdown
              options={methodOptions}
              value={request.method}
              onChange={handleMethodChange}
              size="md"
              className="request-card__method-dropdown"
            />
            <Input
              value={request.url}
              onChange={handleUrlChange}
              placeholder="Enter request URL"
              supportVariables
              collectionEnvironment={selectedCollectionEnv}
              className="request-card__url-input"
            />
            <Button
              variant="primary"
              size="md"
              onClick={handleSend}
              loading={isLoading}
              icon={<SendIcon />}
              className="request-card__send-btn"
            >
              Send
            </Button>
          </div>

          {/* Request Options Tabs */}
          <div className="request-card__options">
            <div className="request-card__option-tabs">
              {requestTabs.map(tab => (
                <button
                  key={tab.id}
                  className={`request-card__option-tab ${activeRequestTab === tab.id ? 'active' : ''}`}
                  onClick={() => setActiveRequestTab(tab.id as RequestTab)}
                >
                  {tab.title}
                  {tab.id === 'params' && request.queryParams.filter(p => p.key).length > 0 && (
                    <span className="request-card__option-badge">
                      {request.queryParams.filter(p => p.key).length}
                    </span>
                  )}
                  {tab.id === 'headers' && request.headers.filter(h => h.key).length > 0 && (
                    <span className="request-card__option-badge">
                      {request.headers.filter(h => h.key).length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="request-card__option-content">
              {activeRequestTab === 'params' && (
                <EditableTable
                  data={request.queryParams}
                  onChange={handleQueryParamsChange}
                  keyPlaceholder="Key"
                  valuePlaceholder="Value"
                  collectionEnvironment={selectedCollectionEnv}
                />
              )}

              {activeRequestTab === 'headers' && (
                <EditableTable
                  data={[
                    ...collectionHeaders.map(h => ({
                      ...h,
                      inheritedFrom: collection?.name,
                      enabled: inheritedHeaderOverrides.has(h.id) ? (inheritedHeaderOverrides.get(h.id) ?? h.enabled) : h.enabled,
                    })),
                    ...request.headers.filter(h => !h.id?.startsWith('__inherited_header_override__')),
                  ]}
                  onChange={handleHeadersChange}
                  keyPlaceholder="Header"
                  valuePlaceholder="Value"
                  keySuggestions={DEFAULT_HEADERS}
                  collectionEnvironment={selectedCollectionEnv}
                />
              )}

              {activeRequestTab === 'body' && (
                <div className="request-card__body">
                  <div className="request-card__body-type">
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
                        updateLocalRequest({
                          body: { 
                            ...request.body, 
                            type: type as 'none' | 'json' | 'form-data' | 'x-www-form-urlencoded' | 'raw'
                          },
                        });
                      }}
                    />
                  </div>

                  {request.body.type !== 'none' && request.body.type !== 'form-data' && request.body.type !== 'x-www-form-urlencoded' && (
                    <div className="request-card__body-editor">
                      <CodeEditor
                        mode={request.body.type === 'json' ? 'json' : 'text'}
                        value={request.body.content}
                        onChange={handleBodyChange}
                        placeholder={request.body.type === 'json' ? '{\n  "key": "value"\n}' : 'Enter request body'}
                        width="100%"
                        height="150px"
                        supportVariables
                        collectionEnvironment={selectedCollectionEnv}
                      />
                    </div>
                  )}

                  {(request.body.type === 'form-data' || request.body.type === 'x-www-form-urlencoded') && (
                    <EditableTable
                      data={request.body.formData || []}
                      onChange={(formData) => {
                        updateLocalRequest({
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
                <div className="request-card__auth">
                  <div className="request-card__auth-type">
                    <label>Type</label>
                    <Dropdown
                      options={[
                        { value: 'none', label: collection?.auth && collection.auth.type !== 'none' ? 'Inherit from Collection' : 'No Auth' },
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
                        updateLocalRequest({ 
                          auth: { ...request.auth, type: type as AuthType } 
                        });
                      }}
                    />
                  </div>

                  {request.auth.type === 'basic' && (
                    <div className="request-card__auth-fields">
                      <div className="request-card__auth-field">
                        <label>Username</label>
                        <Input
                          value={request.auth.basic?.username || ''}
                          onChange={(e) => {
                            updateLocalRequest({
                              auth: {
                                ...request.auth,
                                basic: { ...request.auth.basic, username: e.target.value, password: request.auth.basic?.password || '' },
                              },
                            });
                          }}
                          supportVariables
                        />
                      </div>
                      <div className="request-card__auth-field">
                        <label>Password</label>
                        <Input
                          type="password"
                          value={request.auth.basic?.password || ''}
                          onChange={(e) => {
                            updateLocalRequest({
                              auth: {
                                ...request.auth,
                                basic: { ...request.auth.basic, username: request.auth.basic?.username || '', password: e.target.value },
                              },
                            });
                          }}
                          supportVariables
                        />
                      </div>
                    </div>
                  )}

                  {request.auth.type === 'bearer' && (
                    <div className="request-card__auth-fields">
                      <div className="request-card__auth-field">
                        <label>Token</label>
                        <Input
                          value={request.auth.bearer?.token || ''}
                          onChange={(e) => {
                            updateLocalRequest({
                              auth: {
                                ...request.auth,
                                bearer: { token: e.target.value },
                              },
                            });
                          }}
                          supportVariables
                        />
                      </div>
                    </div>
                  )}

                  {request.auth.type === 'api-key' && (
                    <div className="request-card__auth-fields">
                      <div className="request-card__auth-field">
                        <label>Key</label>
                        <Input
                          value={request.auth.apiKey?.key || ''}
                          onChange={(e) => {
                            updateLocalRequest({
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
                        />
                      </div>
                      <div className="request-card__auth-field">
                        <label>Value</label>
                        <Input
                          value={request.auth.apiKey?.value || ''}
                          onChange={(e) => {
                            updateLocalRequest({
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
                        />
                      </div>
                    </div>
                  )}

                  {request.auth.type === 'oauth2' && (
                    <div className="request-card__auth-fields">
                      <div className="request-card__auth-field">
                        <label>Access Token</label>
                        <Input
                          value={request.auth.oauth2?.accessToken || ''}
                          onChange={(e) => {
                            updateLocalRequest({
                              auth: {
                                ...request.auth,
                                oauth2: { 
                                  ...request.auth.oauth2,
                                  grantType: request.auth.oauth2?.grantType || 'authorization_code',
                                  accessToken: e.target.value,
                                  tokenType: request.auth.oauth2?.tokenType || 'Bearer',
                                  clientId: request.auth.oauth2?.clientId || '',
                                },
                              },
                            });
                          }}
                          placeholder="Access token"
                          supportVariables
                        />
                      </div>
                    </div>
                  )}

                  {request.auth.type === 'jwt' && (
                    <div className="request-card__auth-fields">
                      <div className="request-card__auth-field">
                        <label>JWT Token</label>
                        <Input
                          value={request.auth.jwt?.token || ''}
                          onChange={(e) => {
                            updateLocalRequest({
                              auth: {
                                ...request.auth,
                                jwt: { ...request.auth.jwt, token: e.target.value },
                              },
                            });
                          }}
                          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                          supportVariables
                        />
                      </div>
                    </div>
                  )}

                  {request.auth.type === 'digest' && (
                    <div className="request-card__auth-fields">
                      <div className="request-card__auth-field">
                        <label>Username</label>
                        <Input
                          value={request.auth.digest?.username || ''}
                          onChange={(e) => {
                            updateLocalRequest({
                              auth: {
                                ...request.auth,
                                digest: { 
                                  ...request.auth.digest,
                                  username: e.target.value,
                                  password: request.auth.digest?.password || '',
                                },
                              },
                            });
                          }}
                          supportVariables
                        />
                      </div>
                      <div className="request-card__auth-field">
                        <label>Password</label>
                        <Input
                          type="password"
                          value={request.auth.digest?.password || ''}
                          onChange={(e) => {
                            updateLocalRequest({
                              auth: {
                                ...request.auth,
                                digest: { 
                                  ...request.auth.digest,
                                  username: request.auth.digest?.username || '',
                                  password: e.target.value,
                                },
                              },
                            });
                          }}
                          supportVariables
                        />
                      </div>
                    </div>
                  )}

                  {request.auth.type === 'aws-signature' && (
                    <div className="request-card__auth-fields">
                      <div className="request-card__auth-field">
                        <label>Access Key ID</label>
                        <Input
                          value={request.auth.awsSignature?.accessKeyId || ''}
                          onChange={(e) => {
                            updateLocalRequest({
                              auth: {
                                ...request.auth,
                                awsSignature: { 
                                  ...request.auth.awsSignature,
                                  accessKeyId: e.target.value,
                                  secretAccessKey: request.auth.awsSignature?.secretAccessKey || '',
                                  region: request.auth.awsSignature?.region || '',
                                  service: request.auth.awsSignature?.service || '',
                                },
                              },
                            });
                          }}
                          supportVariables
                        />
                      </div>
                      <div className="request-card__auth-field">
                        <label>Secret Access Key</label>
                        <Input
                          type="password"
                          value={request.auth.awsSignature?.secretAccessKey || ''}
                          onChange={(e) => {
                            updateLocalRequest({
                              auth: {
                                ...request.auth,
                                awsSignature: { 
                                  ...request.auth.awsSignature,
                                  accessKeyId: request.auth.awsSignature?.accessKeyId || '',
                                  secretAccessKey: e.target.value,
                                  region: request.auth.awsSignature?.region || '',
                                  service: request.auth.awsSignature?.service || '',
                                },
                              },
                            });
                          }}
                          supportVariables
                        />
                      </div>
                      <div className="request-card__auth-field">
                        <label>Region</label>
                        <Input
                          value={request.auth.awsSignature?.region || ''}
                          onChange={(e) => {
                            updateLocalRequest({
                              auth: {
                                ...request.auth,
                                awsSignature: { 
                                  ...request.auth.awsSignature,
                                  accessKeyId: request.auth.awsSignature?.accessKeyId || '',
                                  secretAccessKey: request.auth.awsSignature?.secretAccessKey || '',
                                  region: e.target.value,
                                  service: request.auth.awsSignature?.service || '',
                                },
                              },
                            });
                          }}
                          placeholder="us-east-1"
                          supportVariables
                        />
                      </div>
                      <div className="request-card__auth-field">
                        <label>Service</label>
                        <Input
                          value={request.auth.awsSignature?.service || ''}
                          onChange={(e) => {
                            updateLocalRequest({
                              auth: {
                                ...request.auth,
                                awsSignature: { 
                                  ...request.auth.awsSignature,
                                  accessKeyId: request.auth.awsSignature?.accessKeyId || '',
                                  secretAccessKey: request.auth.awsSignature?.secretAccessKey || '',
                                  region: request.auth.awsSignature?.region || '',
                                  service: e.target.value,
                                },
                              },
                            });
                          }}
                          placeholder="s3, execute-api, etc."
                          supportVariables
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Response Section */}
          {showResponse && (
            <div className="request-card__response">
              {<ResponseViewer 
                execution={execution} 
                isLoading={isLoading}
                height={300}
                specResponseInfo={specResponseInfo || undefined}
                onClose={() => setShowResponse(false)}
              />}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RequestCard;

