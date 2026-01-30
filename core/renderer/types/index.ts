import { HTTP_METHODS, AUTH_TYPES } from '../../shared/constants';

// Allow standard HTTP methods + any custom string
export type HttpMethod = typeof HTTP_METHODS[number] | string;
export type AuthType = typeof AUTH_TYPES[number];

// Color schemes for theming
export type ColorScheme = 'terminal' | 'midnight' | 'ocean' | 'sunset' | 'rose' | 'emerald';

export interface ColorSchemeInfo {
  id: ColorScheme;
  name: string;
  description: string;
  primaryColor: string;
  previewColors: string[];
}

export interface KeyValuePair {
  id: string;
  key: string;
  value: string;
  description?: string;
  enabled: boolean;
  inheritedFrom?: string; // Name of the source (e.g., collection name) if this is inherited
  isSystem?: boolean; // Whether this is a system-generated header (e.g., User-Agent from settings)
  secure?: boolean; // If true, the value is hidden/masked like a password
}

export interface Folder {
  id: string;
  name: string;
  requests: Request[];
  folders: Folder[];
  collapsed?: boolean;
  isDeprecated?: boolean; // Mark folder as deprecated
}

// Collection type (protocol/API type)
export type CollectionType = 'REST' | 'GraphQL' | 'WebSocket' | 'gRPC' | 'MQTT';

// Spec source types for URL-based import and sync
export type SpecFormat = 'openapi' | 'postman' | 'insomnia' | 'echolon';
export type SpecSourceType = 'file' | 'url';

export interface SpecSource {
  type: SpecSourceType;
  format: SpecFormat;
  url?: string;
  lastSyncedAt?: number;
  lastCheckedAt?: number; // When we last checked for updates (regardless of result)
  syncFrequencyMins: number; // 0 = manual only
  rawSpec?: string; // Original spec JSON/YAML for diffing
  // Track changes that were intentionally skipped/dismissed (signature = "METHOD:path")
  dismissedChanges?: string[];
}

// Represents a detected change when syncing specs
export type SpecChangeType = 'added' | 'removed' | 'modified';

export interface SpecChange {
  id: string;
  type: SpecChangeType;
  path: string; // API endpoint path
  method: string;
  description: string;
  details?: string; // Additional details about the change
  oldValue?: unknown;
  newValue?: unknown;
  selected: boolean; // For selective application
}

export interface PendingSpecChanges {
  collectionId: string;
  detectedAt: number;
  changes: SpecChange[];
  newRawSpec: string;
}

// Collection-level environment (similar to global but scoped to a collection)
export interface CollectionEnvironment {
  id: string;
  name: string;
  variables: KeyValuePair[];
  isActive: boolean;
  color?: string; // Custom color (hex code)
  emoji?: string; // Custom emoji
}

// Workspace-level environment (between global and collection)
export interface WorkspaceEnvironment {
  id: string;
  name: string;
  variables: KeyValuePair[];
  isActive: boolean;
  color?: string;
  emoji?: string;
}

// Public sharing configuration for collections
export interface PublicSharingVersion {
  version: string;
  publishedAt: number;
  title?: string;
  description?: string;
}

export interface PublicSharing {
  enabled: boolean;
  subdomain?: string;
  versions?: PublicSharingVersion[];
  lastPublishedAt?: number;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  type?: CollectionType; // API type: REST, GraphQL, WebSocket, gRPC, MQTT (defaults to REST)
  requests: Request[];
  folders: Folder[];
  variables?: KeyValuePair[];
  // Collection-level environments (override global environment variables)
  environments?: CollectionEnvironment[];
  // Collection-level settings that apply to all requests
  headers?: KeyValuePair[];
  auth?: AuthConfig;
  defaultEnvironmentId?: string; // Default environment to use for this collection
  workspaceId?: string;
  createdAt: number;
  updatedAt: number;
  // UI state
  collapsed?: boolean;
  order?: number; // Display order within workspace
  // Spec import/sync fields
  specSource?: SpecSource;
  importedAt?: number; // Timestamp when originally imported
  // Public sharing
  publicSharing?: PublicSharing;
}

export interface RequestBody {
  type: 'none' | 'json' | 'form-data' | 'x-www-form-urlencoded' | 'raw' | 'binary';
  content: string;
  formData?: KeyValuePair[];
}

export interface AuthConfig {
  type: AuthType;
  basic?: {
    username: string;
    password: string;
  };
  bearer?: {
    token: string;
  };
  apiKey?: {
    key: string;
    value: string;
    addTo: 'header' | 'query';
  };
  oauth2?: {
    grantType: 'authorization_code' | 'client_credentials' | 'password' | 'implicit';
    accessToken: string;
    refreshToken?: string;
    tokenType: string;
    clientId: string;
    clientSecret?: string;
    authorizationUrl?: string;
    tokenUrl?: string;
    scope?: string;
    state?: string;
    // For password grant
    username?: string;
    password?: string;
  };
  jwt?: {
    token: string;
    prefix?: string; // Default: "Bearer"
    headerName?: string; // Default: "Authorization"
  };
  digest?: {
    username: string;
    password: string;
    realm?: string;
    nonce?: string;
    algorithm?: 'MD5' | 'MD5-sess' | 'SHA-256' | 'SHA-256-sess';
    qop?: 'auth' | 'auth-int';
  };
  awsSignature?: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    service: string;
    sessionToken?: string;
  };
}

export interface Request {
  id: string;
  name: string;
  description?: string; // Optional markdown description for the request
  method: HttpMethod;
  url: string;
  headers: KeyValuePair[];
  queryParams: KeyValuePair[];
  pathParams: KeyValuePair[];
  body: RequestBody;
  auth: AuthConfig;
  scripts: {
    pre: string;
    post: string;
  };
  tags?: string[]; // Tags for categorizing and searching requests
  isDeprecated?: boolean; // Mark request as deprecated
  collectionId?: string;
  folderId?: string;
  workspaceId?: string; // Workspace this request belongs to (for unsaved requests)
}

export interface ResponseHeader {
  key: string;
  value: string;
}

export interface ResponseCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface ResponseTiming {
  prepare: number;       // Internal setup time
  socketInit: number;    // Socket initialization
  dnsLookup: number;     // DNS lookup duration
  tcpHandshake: number;  // TCP connection time
  sslHandshake: number;  // SSL/TLS handshake time (0 for HTTP)
  ttfb: number;          // Time to first byte (waiting)
  download: number;      // Content download time
  process: number;       // Processing/decompression time
  total: number;         // Total request duration
}

export interface SizeBreakdown {
  headers: number;
  body: number;
  uncompressed?: number;  // Uncompressed body size (if compression was used)
  total: number;
}

export interface NetworkInfo {
  httpVersion: string;
  localAddress?: string;
  remoteAddress?: string;
  // TLS info (only for HTTPS)
  tlsProtocol?: string;
  cipherName?: string;
  // Certificate info
  certificateCN?: string;
  issuerCN?: string;
  validUntil?: string;
}

export interface Response {
  status: number;
  statusText: string;
  headers: ResponseHeader[];
  cookies: ResponseCookie[];
  body: string;
  bodyBase64?: string; // Base64-encoded body for binary content (images, videos, PDFs, etc.)
  size: number;
  contentType: string;
  timing?: ResponseTiming;
  sizeBreakdown?: SizeBreakdown;
  requestSize?: SizeBreakdown;
  networkInfo?: NetworkInfo;
}

// Script execution output
export interface ScriptLogEntry {
  type: 'log' | 'warn' | 'error' | 'info';
  args: string[];
  timestamp: number;
}

export interface ScriptOutput {
  logs: ScriptLogEntry[];
  error?: string;
  duration: number;
}

export interface ScriptsOutput {
  pre?: ScriptOutput;
  post?: ScriptOutput;
}

/** Resolved request data after variable/function interpolation */
export interface ResolvedRequest {
  url: string;
  method: string;
  headers: Array<{ key: string; value: string }>;
  body?: string | null;
}

export interface RequestExecution {
  id: string;
  requestId: string;
  request: Request;
  /** The actual request sent after variable/function interpolation */
  resolvedRequest?: ResolvedRequest;
  response: Response | null;
  error?: string;
  errorCode?: string;
  timestamp: number;
  duration: number;
  scriptsOutput?: ScriptsOutput;
}

export interface Environment {
  id: string;
  name: string;
  variables: KeyValuePair[];
  isActive: boolean;
  color?: string; // Custom color (hex code)
  emoji?: string; // Custom emoji
}

export interface Tab {
  id: string;
  type: 'request' | 'collection' | 'environment' | 'websocket' | 'workspace' | 'diff';
  title: string;
  request?: Request;
  collectionId?: string;
  environmentId?: string;
  workspaceId?: string;
  websocket?: WebSocketConnection;
  isDirty?: boolean;
  initialSubTab?: string; // For initially opening a specific sub-tab (e.g., 'auth' for collection)
  subTab?: string; // Currently selected sub-tab (persisted)
  // Per-tab request execution state (independent per tab)
  isLoading?: boolean;
  execution?: RequestExecution;
  // Diff tab properties
  diff?: {
    filePath: string;
    oldContent: string;
    newContent: string;
    status: 'added' | 'modified' | 'deleted';
  };
}

// WebSocket Types
export type WebSocketConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface WebSocketMessage {
  id: string;
  type: 'sent' | 'received' | 'system';
  content: string;
  timestamp: number;
  // For system messages like connection status
  systemType?: 'connected' | 'disconnected' | 'error' | 'info';
  // Connection handshake details (for the initial connection message)
  connectionDetails?: {
    requestUrl?: string;
    requestMethod?: string;
    statusCode?: number;
    statusText?: string;
    requestHeaders?: Record<string, string>;
    responseHeaders?: Record<string, string>;
  };
}

export interface WebSocketSettings {
  handshakeTimeout: number; // ms, 0 = no timeout
  reconnectionAttempts: number; // 0 = no reconnection
  reconnectionInterval: number; // ms
  maxMessageSize: number; // MB, 0 = unlimited
}

export interface WebSocketConnection {
  id: string;
  name: string;
  url: string;
  status: WebSocketConnectionStatus;
  headers: KeyValuePair[];
  queryParams: KeyValuePair[];
  messages: WebSocketMessage[];
  messageToSend: string;
  settings: WebSocketSettings;
  collectionId?: string;
}

// Proxy profile for CORS proxy configuration
export interface ProxyProfile {
  id: string;
  name: string;
  url: string; // Proxy URL (e.g., "https://proxy.echolon.app")
  isDefault?: boolean; // Whether this is a predefined profile
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  colorScheme: ColorScheme;
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  autoSave: boolean;
  requestTimeout: number;
  followRedirects: boolean;
  validateSSL: boolean;
  proxyEnabled: boolean;
  proxyUrl?: string;
  showLineNumbers?: boolean;
  highlightActiveLine?: boolean;
  maxHistoryEntries?: number;
  autoCheckUpdates?: boolean;
  defaultSyncFrequencyMins?: number; // Default sync frequency for new URL imports
  sendUserAgent?: boolean; // Whether to send User-Agent header with requests (default: true)
  debugMode?: boolean; // Show debug information like startup time
  customUpdateServerUrl?: string; // Custom update server URL (only used when debugMode is true)
  sampleCreated?: boolean; // Whether the sample collection has been created on first app start
  persistHistory?: boolean; // Whether to persist request history to disk (default: true)
  historyMaxBinarySize?: number; // Max binary response size to store in history in KB (default: 50)
  // Mocking settings
  mockingMaxCapturedRequests?: number; // Maximum captured requests to store (default: 1000)
  mockingSaveDebounceMs?: number; // Debounce time for saving captured requests (default: 1000)
  mockingShowQuickTest?: boolean; // Show Quick Test section in mocking panel (default: true)
  mockingAutoSave?: boolean; // Auto-save mocked response on blur (default: false)
  // CORS Proxy settings (for web mode)
  proxyProfiles?: ProxyProfile[]; // List of proxy profiles
  activeProxyProfileId?: string | null; // Currently selected proxy profile ID (null = no proxy)
}

export interface ConsoleEntry {
  id: string;
  type: 'info' | 'warn' | 'error' | 'success';
  message: string;
  timestamp: number;
  details?: string;
}

export interface HistoryEntry {
  id: string;
  request: Request;
  /** The actual request sent after variable/function interpolation */
  resolvedRequest?: ResolvedRequest;
  response: Response | null;
  timestamp: number;
  duration: number;
  /** If true, the response body was omitted because it exceeded the size limit */
  responseBodyOmitted?: boolean;
  /** Original size of the omitted response body in bytes */
  responseBodyOriginalSize?: number;
}

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
  // Workspace-level environments
  environments?: WorkspaceEnvironment[];
  // Currently selected workspace environment
  selectedEnvironmentId?: string;
}

// Mocking Types
export type MockMode = 'local' | 'cloud';
export type CloudProxyStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface MockAPI {
  id: string;
  name: string;
  description?: string;
  endpoint: string;  // e.g., "my-api.local" or "myapi.post.dog"
  port: number;
  isLocal: boolean;  // true for .local, false for cloud
  isRunning: boolean;
  routes: MockRoute[];
  createdAt: number;
  updatedAt: number;
  // Local mock server settings
  forwardTo?: string;  // optional URL to forward unmocked requests to (local mode)
  // Cloud proxy settings
  mode?: MockMode;  // 'local' | 'cloud', defaults to 'local'
  cloudNamespace?: string;  // namespace for cloud proxy (e.g., "test" for test.echolon.app)
  cloudServerUrl?: string;  // cloud proxy server URL
  cloudForwardTo?: string;  // optional URL to forward requests to (cloud mode)
  cloudStatus?: CloudProxyStatus;  // cloud proxy connection status
}

export interface CloudProxyRequest {
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body?: string;
}

export interface CloudProxyResponse {
  id: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body?: string;
  servedByMock?: boolean;
}

export interface MockRoute {
  id: string;
  method: HttpMethod;
  path: string;  // e.g., "/users", "/posts/:id"
  mockedResponse?: MockedResponse;
  isMocked: boolean;
}

export interface MockedResponse {
  status: number;
  statusText: string;
  headers: ResponseHeader[];
  body: string;
  delay?: number;  // Optional delay in ms
}

export interface CapturedRequest {
  id: string;
  mockApiId: string;
  method: HttpMethod;
  path: string;
  url: string;
  headers: ResponseHeader[];
  queryParams: Record<string, string>;
  body?: string;
  timestamp: number;
  response?: {
    status: number;
    statusText: string;
    headers: ResponseHeader[];
    body: string;
    duration: number;
    servedByMock?: boolean;
  };
  isMocked: boolean;
}

// Swagger/OpenAPI types for import
export interface SwaggerPath {
  [method: string]: {
    summary?: string;
    description?: string;
    operationId?: string;
    tags?: string[];
    parameters?: Array<{
      name: string;
      in: 'query' | 'header' | 'path' | 'body';
      required?: boolean;
      type?: string;
      description?: string;
      schema?: object;
      example?: unknown;
    }>;
    requestBody?: {
      content: {
        [contentType: string]: {
          schema: object;
        };
      };
    };
    responses?: {
      [code: string]: {
        description: string;
      };
    };
    security?: Array<{ [schemeName: string]: string[] }>;
  };
}

export interface SwaggerSecurityScheme {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect';
  description?: string;
  name?: string;
  in?: 'query' | 'header' | 'cookie';
  scheme?: string;
  bearerFormat?: string;
  flows?: {
    authorizationCode?: {
      authorizationUrl: string;
      tokenUrl: string;
      scopes: { [scope: string]: string };
    };
    clientCredentials?: {
      tokenUrl: string;
      scopes: { [scope: string]: string };
    };
    password?: {
      tokenUrl: string;
      scopes: { [scope: string]: string };
    };
    implicit?: {
      authorizationUrl: string;
      scopes: { [scope: string]: string };
    };
  };
}

export interface SwaggerDocument {
  openapi?: string;
  swagger?: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{
    url: string;
    description?: string;
  }>;
  host?: string;
  basePath?: string;
  schemes?: string[];
  paths: {
    [path: string]: SwaggerPath;
  };
  tags?: Array<{
    name: string;
    description?: string;
  }>;
  components?: {
    securitySchemes?: {
      [name: string]: SwaggerSecurityScheme;
    };
  };
  securityDefinitions?: {
    [name: string]: SwaggerSecurityScheme;
  };
  security?: Array<{ [schemeName: string]: string[] }>;
}
