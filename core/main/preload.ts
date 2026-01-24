import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import {
  UPDATE_CHANNELS,
  APP_CHANNELS,
  MOCK_SERVER_CHANNELS,
  CLOUD_PROXY_CHANNELS,
  FILE_STORAGE_CHANNELS,
  GIT_CHANNELS,
  GITHUB_CHANNELS,
  PUBLIC_SPECS_CHANNELS,
} from '../shared/ipc-channels';

// HTTP Request options interface
interface HttpRequestOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
  timeout?: number;
}

interface HttpResponseResult {
  success: boolean;
  status?: number;
  statusText?: string;
  headers?: Array<{ key: string; value: string }>;
  body?: string;
  bodyBase64?: string; // Base64-encoded body for binary content (images, videos, PDFs, etc.)
  size?: number;
  duration: number;
  error?: string;
  errorCode?: string;
}

// Mock server types
interface MockServerConfig {
  id: string;
  port: number;
  routes: Array<{
    id: string;
    method: string;
    path: string;
    mockedResponse?: {
      status: number;
      statusText: string;
      headers: Array<{ key: string; value: string }>;
      body: string;
      delay?: number;
    };
    isMocked: boolean;
  }>;
  forwardTo?: string;  // optional URL to forward unmocked requests to
}

interface CapturedRequest {
  id: string;
  mockApiId: string;
  method: string;
  path: string;
  url: string;
  headers: Array<{ key: string; value: string }>;
  queryParams: Record<string, string>;
  body?: string;
  timestamp: number;
  response?: {
    status: number;
    statusText: string;
    headers: Array<{ key: string; value: string }>;
    body: string;
    duration: number;
  };
  isMocked: boolean;
}

// Cloud Proxy types
type CloudProxyConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface CloudProxyConfig {
  serverUrl: string;
  namespace: string;
  userId: string;
  forwardTo?: string;
}

interface CloudProxyRequest {
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body?: string;
}

interface CloudProxyResponse {
  id: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body?: string;
}

interface CloudProxyForwardedResponse {
  method: string;
  path: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body?: string;
  timestamp: number;
  servedByMock?: boolean;
}

interface CloudProxyStatusEvent {
  status: CloudProxyConnectionStatus;
  namespace?: string;
  serverUrl?: string;
}

// Mock stored on proxy server
interface CloudStoredMock {
  id: string;
  method: string;
  path: string;
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    delay?: number;
  };
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// URL fetch result for spec import
interface FetchUrlResult {
  success: boolean;
  content?: string;
  contentType?: string;
  error?: string;
}

// File Storage types (simplified versions for preload)
interface EchoFile {
  $schema: string;
  version: string;
  metadata: {
    id: string;
    name: string;
    description?: string;
    createdAt: string;
    modifiedAt: string;
    workspaceId: string;
  };
  settings: {
    defaultEnvironmentId?: string;
    defaultHeaders?: Array<{ id: string; key: string; value: string; enabled: boolean }>;
    auth?: { type: string; [key: string]: unknown };
  };
  environments: Array<{
    id: string;
    name: string;
    variables: Array<{ id: string; key: string; value: string; enabled: boolean }>;
    isActive: boolean;
  }>;
  openapi?: Record<string, unknown>;
  requests: Array<{
    id: string;
    name: string;
    method: string;
    url: string;
    headers: Array<{ id: string; key: string; value: string; enabled: boolean }>;
    queryParams: Array<{ id: string; key: string; value: string; enabled: boolean }>;
    body: { type: string; content: string; formData?: Array<{ id: string; key: string; value: string; enabled: boolean }> };
    auth: { type: string; [key: string]: unknown };
    scripts: { pre: string; post: string };
  }>;
  folders: Array<{
    id: string;
    name: string;
    requests: EchoFile['requests'];
    folders: unknown[];
  }>;
}

interface WorkspaceEnvironmentFile {
  id: string;
  name: string;
  variables: Array<{ id: string; key: string; value: string; description?: string; enabled: boolean }>;
  isActive: boolean;
  color?: string;
  emoji?: string;
}

interface WorkspaceFile {
  id: string;
  name: string;
  description?: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
  environments?: WorkspaceEnvironmentFile[];
  selectedEnvironmentId?: string;
}

interface EcholonConfig {
  version: string;
  echolonPath: string;
  theme: 'light' | 'dark' | 'system';
  colorScheme: string;
  settings: Record<string, unknown>;
  github?: {
    authMethod: 'oauth' | 'pat';
    accessToken?: string;
    refreshToken?: string;
    username?: string;
    linkedRepos?: Array<{
      workspaceId: string;
      owner: string;
      repo: string;
      branch: string;
    }>;
  };
  ui?: Record<string, unknown>;
}

interface GlobalEnvironmentsFile {
  version: string;
  selectedEnvironmentId?: string;
  environments: Array<{
    id: string;
    name: string;
    variables: Array<{ id: string; key: string; value: string; enabled: boolean }>;
    isActive: boolean;
  }>;
}

interface FileChangedEvent {
  event: string;
  filename: string | null;
  dirPath: string;
}

// GitHub types
interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  name: string | null;
  email: string | null;
}

interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: {
    login: string;
    avatar_url: string;
  };
  description: string | null;
  default_branch: string;
  html_url: string;
  clone_url: string;
  pushed_at: string;
}

interface GitHubBranch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
}

interface GitHubCommit {
  sha: string;
  message: string;
  author: {
    name: string;
    email: string;
    date: string;
  };
  committer: {
    name: string;
    email: string;
    date: string;
  };
  html_url: string;
  parents: Array<{ sha: string }>;
}

interface GitHubContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: 'file' | 'dir';
  content?: string;
  encoding?: string;
  html_url: string;
  download_url: string | null;
}

interface GitHubFileChange {
  path: string;
  content: string;
  sha?: string;
}

interface GitHubApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

// Git types (isomorphic-git)
interface GitStatus {
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: string[];
}

interface GitFileStatus {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

interface GitCommitInfo {
  oid: string;
  message: string;
  author: {
    name: string;
    email: string;
    timestamp: number;
  };
  parent: string[];
}

interface GitBranchInfo {
  name: string;
  current: boolean;
  remote?: string;
}

interface GitRemote {
  name: string;
  url: string;
}

interface GitCredentials {
  username: string;
  password: string;
}

// Public Specs types
interface SpecManifest {
  subdomain: string;
  collectionId: string;
  collectionName: string;
  createdAt: string;
  updatedAt: string;
  versions: SpecVersion[];
}

interface SpecVersion {
  version: string;
  publishedAt: string;
  title?: string;
  description?: string;
}

interface UploadSpecOptions {
  subdomain: string;
  version: string;
  openapiJson: string;
  echolonJson?: string; // Internal Echolon format with extended features
  htmlContent: string;
  collectionId: string;
  collectionName: string;
  title?: string;
  description?: string;
}

interface UploadResult {
  success: boolean;
  error?: string;
  specUrl?: string;
  htmlUrl?: string;
}

interface CheckSubdomainResult {
  available: boolean;
  reason?: 'exists' | 'invalid' | 'reserved';
  message?: string;
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getAppVersion: () => ipcRenderer.invoke(APP_CHANNELS.GET_APP_VERSION),

  // HTTP Request - bypasses CORS by going through Node.js
  makeHttpRequest: (options: HttpRequestOptions): Promise<HttpResponseResult> => 
    ipcRenderer.invoke(APP_CHANNELS.MAKE_HTTP_REQUEST, options),

  // Execute script - runs in main process to bypass CSP
  executeScript: (options: {
    script: string;
    context: {
      request: { url: string; method: string; headers: Record<string, string>; body?: string | null };
      response?: { status: number; statusText: string; headers: Record<string, string>; body: string; responseTime: number };
      envVars: Record<string, string>;
      runtimeVars: Record<string, string>;
    };
  }): Promise<{
    logs: Array<{ type: 'log' | 'warn' | 'error' | 'info'; args: string[]; timestamp: number }>;
    error?: string;
    duration: number;
    envVars: Record<string, string>;
    runtimeVars: Record<string, string>;
    modifiedResponse?: { status: number; statusText: string; headers: Record<string, string>; body: string; responseTime: number };
  }> => ipcRenderer.invoke(APP_CHANNELS.EXECUTE_SCRIPT, options),

  // Compute Digest Auth - computes MD5/SHA-256 hash for digest authentication
  computeDigestAuth: (options: {
    wwwAuthHeader: string;
    username: string;
    password: string;
    method: string;
    uri: string;
  }): Promise<{
    success: boolean;
    header?: string;
    error?: string;
    challenge?: {
      realm: string;
      nonce: string;
      algorithm?: string;
      qop?: string;
      opaque?: string;
    };
  }> => ipcRenderer.invoke(APP_CHANNELS.COMPUTE_DIGEST_AUTH, options),

  // Update functions
  checkForUpdates: () => ipcRenderer.invoke(UPDATE_CHANNELS.CHECK_FOR_UPDATES),
  downloadUpdate: () => ipcRenderer.invoke(UPDATE_CHANNELS.DOWNLOAD_UPDATE),
  installUpdate: () => ipcRenderer.invoke(UPDATE_CHANNELS.INSTALL_UPDATE),
  quitAndInstallLater: () => ipcRenderer.invoke(UPDATE_CHANNELS.QUIT_AND_INSTALL_LATER),
  setUpdateServer: (url: string | null): Promise<{ success: boolean; feedUrl?: string; error?: string }> =>
    ipcRenderer.invoke(UPDATE_CHANNELS.SET_UPDATE_SERVER, url),

  // Shell functions
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(APP_CHANNELS.OPEN_EXTERNAL, url),

  // App control
  restartApp: (): Promise<void> =>
    ipcRenderer.invoke(APP_CHANNELS.RESTART_APP),
  wipeAllData: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(APP_CHANNELS.WIPE_ALL_DATA),
  toggleDevTools: (): Promise<void> =>
    ipcRenderer.invoke(APP_CHANNELS.TOGGLE_DEV_TOOLS),

  // Capture page screenshot (no user prompt, Electron-only)
  capturePage: (): Promise<{ success: boolean; data?: string; error?: string }> =>
    ipcRenderer.invoke(APP_CHANNELS.CAPTURE_PAGE),

  // Mock Server functions
  startMockServer: (config: MockServerConfig): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(MOCK_SERVER_CHANNELS.START_MOCK_SERVER, config),
  stopMockServer: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(MOCK_SERVER_CHANNELS.STOP_MOCK_SERVER, id),
  getMockServerStatus: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(MOCK_SERVER_CHANNELS.GET_MOCK_SERVER_STATUS, id),
  updateMockRoutes: (id: string, routes: MockServerConfig['routes']): Promise<void> =>
    ipcRenderer.invoke(MOCK_SERVER_CHANNELS.UPDATE_MOCK_ROUTES, { id, routes }),
  getLocalHostname: (): Promise<string> =>
    ipcRenderer.invoke(MOCK_SERVER_CHANNELS.GET_LOCAL_HOSTNAME),
  onMockRequestReceived: (callback: (request: CapturedRequest) => void) => {
    const handler = (_event: IpcRendererEvent, request: CapturedRequest) => callback(request);
    ipcRenderer.on(MOCK_SERVER_CHANNELS.MOCK_REQUEST_RECEIVED, handler);
    return () => ipcRenderer.removeListener(MOCK_SERVER_CHANNELS.MOCK_REQUEST_RECEIVED, handler);
  },

  // Cloud Proxy functions
  cloudProxyConnect: (config: CloudProxyConfig): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(CLOUD_PROXY_CHANNELS.CONNECT, config),
  cloudProxyDisconnect: (): Promise<void> =>
    ipcRenderer.invoke(CLOUD_PROXY_CHANNELS.DISCONNECT),
  cloudProxyGetStatus: (): Promise<{ status: CloudProxyConnectionStatus; namespace?: string }> =>
    ipcRenderer.invoke(CLOUD_PROXY_CHANNELS.STATUS),
  cloudProxySendResponse: (response: CloudProxyResponse): Promise<void> =>
    ipcRenderer.invoke(CLOUD_PROXY_CHANNELS.SEND_RESPONSE, response),
  cloudProxyCheckNamespace: (serverUrl: string, namespace: string): Promise<{ available: boolean; connected: boolean }> =>
    ipcRenderer.invoke(CLOUD_PROXY_CHANNELS.CHECK_NAMESPACE, { serverUrl, namespace }),
  onCloudProxyStatusChanged: (callback: (event: CloudProxyStatusEvent) => void) => {
    const handler = (_event: IpcRendererEvent, data: CloudProxyStatusEvent) => callback(data);
    ipcRenderer.on(CLOUD_PROXY_CHANNELS.STATUS_CHANGED, handler);
    return () => ipcRenderer.removeListener(CLOUD_PROXY_CHANNELS.STATUS_CHANGED, handler);
  },
  onCloudProxyRequestReceived: (callback: (request: CloudProxyRequest) => void) => {
    const handler = (_event: IpcRendererEvent, request: CloudProxyRequest) => callback(request);
    ipcRenderer.on(CLOUD_PROXY_CHANNELS.REQUEST_RECEIVED, handler);
    return () => ipcRenderer.removeListener(CLOUD_PROXY_CHANNELS.REQUEST_RECEIVED, handler);
  },
  onCloudProxyForwardedResponse: (callback: (response: CloudProxyForwardedResponse) => void) => {
    const handler = (_event: IpcRendererEvent, response: CloudProxyForwardedResponse) => callback(response);
    ipcRenderer.on(CLOUD_PROXY_CHANNELS.FORWARDED_RESPONSE, handler);
    return () => ipcRenderer.removeListener(CLOUD_PROXY_CHANNELS.FORWARDED_RESPONSE, handler);
  },

  // Cloud Proxy Mock Management
  cloudProxyFetchMocks: (serverUrl: string, namespace: string): Promise<{ success: boolean; mocks: CloudStoredMock[]; error?: string }> =>
    ipcRenderer.invoke(CLOUD_PROXY_CHANNELS.FETCH_MOCKS, { serverUrl, namespace }),
  cloudProxySyncMocks: (serverUrl: string, namespace: string, mocks: CloudStoredMock[]): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(CLOUD_PROXY_CHANNELS.SYNC_MOCKS, { serverUrl, namespace, mocks }),
  cloudProxyUploadMock: (serverUrl: string, namespace: string, mock: CloudStoredMock): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(CLOUD_PROXY_CHANNELS.UPLOAD_MOCK, { serverUrl, namespace, mock }),
  cloudProxyDeleteMock: (serverUrl: string, namespace: string, mockId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(CLOUD_PROXY_CHANNELS.DELETE_MOCK, { serverUrl, namespace, mockId }),

  // URL Content Fetch - bypasses CORS for spec import
  fetchUrlContent: (url: string): Promise<FetchUrlResult> =>
    ipcRenderer.invoke(APP_CHANNELS.FETCH_URL_CONTENT, url),

  // ==================== File Storage ====================
  
  // Initialization
  initFileStorage: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.INIT_FILE_STORAGE),
  getEcholonPath: (): Promise<string> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.GET_ECHOLON_PATH),
  setEcholonPath: (newPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.SET_ECHOLON_PATH, newPath),
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.SELECT_DIRECTORY),
  openInFileManager: (): Promise<void> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.OPEN_IN_FILE_MANAGER),

  // Config
  readConfig: (): Promise<EcholonConfig | null> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.READ_CONFIG),
  writeConfig: (config: EcholonConfig): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.WRITE_CONFIG, config),
  updateConfig: (updates: Partial<EcholonConfig>): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.UPDATE_CONFIG, updates),

  // Environments
  readEnvironments: (): Promise<GlobalEnvironmentsFile | null> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.READ_ENVIRONMENTS),
  writeEnvironments: (environments: GlobalEnvironmentsFile): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.WRITE_ENVIRONMENTS, environments),

  // Workspaces
  getAllWorkspaces: (): Promise<WorkspaceFile[]> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.GET_ALL_WORKSPACES),
  createWorkspace: (name: string, description?: string, color?: string): Promise<{ success: boolean; workspace?: WorkspaceFile; error?: string }> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.CREATE_WORKSPACE, { name, description, color }),
  readWorkspace: (workspaceName: string): Promise<WorkspaceFile | null> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.READ_WORKSPACE, workspaceName),
  updateWorkspace: (workspaceName: string, updates: Partial<WorkspaceFile>): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.UPDATE_WORKSPACE, { workspaceName, updates }),
  renameWorkspace: (oldName: string, newName: string): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.RENAME_WORKSPACE, { oldName, newName }),
  deleteWorkspace: (workspaceName: string): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.DELETE_WORKSPACE, workspaceName),

  // Collections
  getAllCollections: (workspaceName: string): Promise<EchoFile[]> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.GET_ALL_COLLECTIONS, workspaceName),
  getAllCollectionsAllWorkspaces: (): Promise<{ workspace: string; collections: EchoFile[] }[]> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.GET_ALL_COLLECTIONS_ALL_WORKSPACES),
  readCollection: (workspaceName: string, collectionName: string): Promise<EchoFile | null> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.READ_COLLECTION, { workspaceName, collectionName }),
  writeCollection: (workspaceName: string, collectionName: string, collection: EchoFile): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.WRITE_COLLECTION, { workspaceName, collectionName, collection }),
  deleteCollection: (workspaceName: string, collectionName: string): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.DELETE_COLLECTION, { workspaceName, collectionName }),
  renameCollection: (workspaceName: string, oldName: string, newName: string): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.RENAME_COLLECTION, { workspaceName, oldName, newName }),
  showCollectionInFinder: (workspaceName: string, collectionName: string): Promise<void> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.SHOW_COLLECTION_IN_FINDER, { workspaceName, collectionName }),

  // File watching
  watchDirectory: (dirPath: string): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.WATCH_DIRECTORY, dirPath),
  unwatchDirectory: (dirPath: string): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.UNWATCH_DIRECTORY, dirPath),
  onFileChanged: (callback: (event: FileChangedEvent) => void) => {
    const handler = (_event: IpcRendererEvent, data: FileChangedEvent) => callback(data);
    ipcRenderer.on(FILE_STORAGE_CHANNELS.FILE_CHANGED, handler);
    return () => ipcRenderer.removeListener(FILE_STORAGE_CHANNELS.FILE_CHANGED, handler);
  },

  // Generic data files (for app state)
  readDataFile: <T>(filename: string): Promise<T | null> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.READ_DATA_FILE, filename),
  writeDataFile: <T>(filename: string, data: T): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.WRITE_DATA_FILE, { filename, data }),

  // Mocking data (per workspace/endpoint)
  readMockRequests: <T>(workspaceName: string, mockApiName: string, endpoint: string): Promise<T | null> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.READ_MOCK_REQUESTS, { workspaceName, mockApiName, endpoint }),
  writeMockRequests: <T>(workspaceName: string, mockApiName: string, endpoint: string, data: T): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.WRITE_MOCK_REQUESTS, { workspaceName, mockApiName, endpoint, data }),
  readAllMockRequests: <T>(workspaceName: string, mockApiName: string): Promise<{ endpoint: string; requests: T }[]> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.READ_ALL_MOCK_REQUESTS, { workspaceName, mockApiName }),
  readAllMockingData: <T>(workspaceName: string): Promise<{ mockApiName: string; endpoint: string; requests: T }[]> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.READ_ALL_MOCKING_DATA, workspaceName),
  deleteMockApiData: (workspaceName: string, mockApiName: string): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.DELETE_MOCK_API_DATA, { workspaceName, mockApiName }),
  deleteMockEndpointData: (workspaceName: string, mockApiName: string, endpoint: string): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.DELETE_MOCK_ENDPOINT_DATA, { workspaceName, mockApiName, endpoint }),
  clearMockingData: (workspaceName: string): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.CLEAR_MOCKING_DATA, workspaceName),

  // OpenAPI export for public sharing
  writeCollectionOpenAPI: (workspaceName: string, collectionId: string, openapiJson: string, version?: string): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.WRITE_COLLECTION_OPENAPI, { workspaceName, collectionId, openapiJson, version }),
  readCollectionOpenAPI: (workspaceName: string, collectionId: string, version?: string): Promise<string | null> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.READ_COLLECTION_OPENAPI, { workspaceName, collectionId, version }),

  // Request history (per workspace)
  readHistory: <T>(workspaceName: string): Promise<T | null> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.READ_HISTORY, workspaceName),
  writeHistory: <T>(workspaceName: string, data: T): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.WRITE_HISTORY, { workspaceName, data }),
  clearHistory: (workspaceName: string): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.CLEAR_HISTORY, workspaceName),

  // Workspace data files (workspace-specific state like sync states, pending changes)
  readWorkspaceDataFile: <T>(workspaceName: string, filename: string): Promise<T | null> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.READ_WORKSPACE_DATA_FILE, { workspaceName, filename }),
  writeWorkspaceDataFile: <T>(workspaceName: string, filename: string, data: T): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.WRITE_WORKSPACE_DATA_FILE, { workspaceName, filename, data }),
  deleteWorkspaceDataFile: (workspaceName: string, filename: string): Promise<boolean> =>
    ipcRenderer.invoke(FILE_STORAGE_CHANNELS.DELETE_WORKSPACE_DATA_FILE, { workspaceName, filename }),

  // ==================== Git (isomorphic-git) ====================

  // Repository operations
  gitInit: (dir: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.INIT, dir),
  gitIsRepo: (dir: string): Promise<boolean> =>
    ipcRenderer.invoke(GIT_CHANNELS.IS_REPO, dir),
  gitClone: (url: string, dir: string, branch?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.CLONE, { url, dir, branch }),

  // Status
  gitStatus: (dir: string): Promise<{ success: boolean; status?: GitStatus; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.STATUS, dir),

  // Staging
  gitAdd: (dir: string, filepath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.ADD, { dir, filepath }),
  gitAddAll: (dir: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.ADD_ALL, dir),
  gitUnstage: (dir: string, filepath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.UNSTAGE, { dir, filepath }),
  gitDiscardChanges: (dir: string, filepath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.DISCARD_CHANGES, { dir, filepath }),

  // Commits
  gitCommit: (dir: string, message: string, author: { name: string; email: string }): Promise<{ success: boolean; oid?: string; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.COMMIT, { dir, message, author }),
  gitLog: (dir: string, depth?: number): Promise<{ success: boolean; commits?: GitCommitInfo[]; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.LOG, { dir, depth }),

  // Branches
  gitListBranches: (dir: string): Promise<{ success: boolean; branches?: GitBranchInfo[]; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.LIST_BRANCHES, dir),
  gitCurrentBranch: (dir: string): Promise<{ success: boolean; branch?: string; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.CURRENT_BRANCH, dir),
  gitCreateBranch: (dir: string, name: string, checkout?: boolean): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.CREATE_BRANCH, { dir, name, checkout }),
  gitCheckout: (dir: string, ref: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.CHECKOUT, { dir, ref }),
  gitDeleteBranch: (dir: string, name: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.DELETE_BRANCH, { dir, name }),

  // Remotes
  gitListRemotes: (dir: string): Promise<{ success: boolean; remotes?: GitRemote[]; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.LIST_REMOTES, dir),
  gitAddRemote: (dir: string, name: string, url: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.ADD_REMOTE, { dir, name, url }),
  gitRemoveRemote: (dir: string, name: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.REMOVE_REMOTE, { dir, name }),

  // Sync
  gitPush: (dir: string, remote?: string, branch?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.PUSH, { dir, remote, branch }),
  gitPull: (dir: string, remote?: string, branch?: string, author?: { name: string; email: string }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.PULL, { dir, remote, branch, author }),
  gitFetch: (dir: string, remote?: string, branch?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.FETCH, { dir, remote, branch }),

  // Credentials
  gitSetCredentials: (credentials: GitCredentials | null): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(GIT_CHANNELS.SET_CREDENTIALS, credentials),

  // Utils
  gitCreateGitignore: (dir: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.CREATE_GITIGNORE, dir),
  gitGetFileForDiff: (dir: string, filepath: string): Promise<{ success: boolean; oldContent?: string; newContent?: string; error?: string }> =>
    ipcRenderer.invoke(GIT_CHANNELS.GET_FILE_FOR_DIFF, { dir, filepath }),

  // ==================== GitHub ====================

  // Authentication
  githubAuthWithPAT: (token: string): Promise<GitHubApiResponse<GitHubUser>> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.AUTH_WITH_PAT, token),
  githubStartOAuth: (): Promise<{ success: boolean; url?: string; error?: string }> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.START_OAUTH),
  githubLogout: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.LOGOUT),
  githubGetCurrentUser: (): Promise<GitHubApiResponse<GitHubUser>> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.GET_CURRENT_USER),
  githubIsAuthenticated: (): Promise<boolean> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.IS_AUTHENTICATED),
  githubSetAccessToken: (token: string | null): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.SET_ACCESS_TOKEN, token),

  // Repositories
  githubListRepos: (options?: { visibility?: string; sort?: string; per_page?: number; page?: number }): Promise<GitHubApiResponse<GitHubRepository[]>> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.LIST_REPOS, options),
  githubGetRepo: (owner: string, repo: string): Promise<GitHubApiResponse<GitHubRepository>> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.GET_REPO, { owner, repo }),
  githubCreateRepo: (options: { name: string; description?: string; private?: boolean; auto_init?: boolean }): Promise<GitHubApiResponse<GitHubRepository>> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.CREATE_REPO, options),

  // Branches
  githubListBranches: (owner: string, repo: string): Promise<GitHubApiResponse<GitHubBranch[]>> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.LIST_BRANCHES, { owner, repo }),
  githubGetBranch: (owner: string, repo: string, branch: string): Promise<GitHubApiResponse<GitHubBranch>> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.GET_BRANCH, { owner, repo, branch }),
  githubCreateBranch: (owner: string, repo: string, branchName: string, sourceSha: string): Promise<GitHubApiResponse<{ ref: string; object: { sha: string } }>> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.CREATE_BRANCH, { owner, repo, branchName, sourceSha }),

  // Commits
  githubListCommits: (owner: string, repo: string, options?: { sha?: string; path?: string; per_page?: number; page?: number }): Promise<GitHubApiResponse<Array<{ sha: string; commit: GitHubCommit; html_url: string }>>> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.LIST_COMMITS, { owner, repo, options }),
  githubGetCommit: (owner: string, repo: string, sha: string): Promise<GitHubApiResponse<{ sha: string; commit: GitHubCommit; files?: Array<{ filename: string; status: string; patch?: string }> }>> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.GET_COMMIT, { owner, repo, sha }),

  // Contents
  githubGetContents: (owner: string, repo: string, path: string, ref?: string): Promise<GitHubApiResponse<GitHubContent | GitHubContent[]>> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.GET_CONTENTS, { owner, repo, path, ref }),
  githubCreateOrUpdateFile: (owner: string, repo: string, path: string, options: { message: string; content: string; sha?: string; branch?: string }): Promise<GitHubApiResponse<{ content: GitHubContent; commit: { sha: string } }>> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.CREATE_OR_UPDATE_FILE, { owner, repo, path, options }),
  githubDeleteFile: (owner: string, repo: string, path: string, options: { message: string; sha: string; branch?: string }): Promise<GitHubApiResponse<{ commit: { sha: string } }>> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.DELETE_FILE, { owner, repo, path, options }),

  // Comparison
  githubCompareCommits: (owner: string, repo: string, base: string, head: string): Promise<GitHubApiResponse<{ status: string; ahead_by: number; behind_by: number; commits: Array<{ sha: string; commit: GitHubCommit }>; files: Array<{ filename: string; status: string; patch?: string }> }>> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.COMPARE_COMMITS, { owner, repo, base, head }),

  // Batch operations
  githubPushChanges: (owner: string, repo: string, branch: string, message: string, changes: GitHubFileChange[]): Promise<GitHubApiResponse<{ sha: string }>> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.PUSH_CHANGES, { owner, repo, branch, message, changes }),
  githubPullLatest: (owner: string, repo: string, branch: string): Promise<GitHubApiResponse<{ sha: string; commit: GitHubCommit; tree: Array<{ path: string; type: string; sha: string }> }>> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.PULL_LATEST, { owner, repo, branch }),

  // Workspace linking
  githubSetupWorkspaceGit: (workspaceName: string, owner: string, repo: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(GITHUB_CHANNELS.SETUP_WORKSPACE_GIT, { workspaceName, owner, repo }),

  // ==================== Public Specs ====================
  publicSpecsCheckSubdomain: (subdomain: string, userId?: string): Promise<CheckSubdomainResult> =>
    ipcRenderer.invoke(PUBLIC_SPECS_CHANNELS.CHECK_SUBDOMAIN, { subdomain, userId }),
  publicSpecsUpload: (options: UploadSpecOptions): Promise<UploadResult> =>
    ipcRenderer.invoke(PUBLIC_SPECS_CHANNELS.UPLOAD_SPEC, options),
  publicSpecsGetVersions: (subdomain: string): Promise<SpecVersion[]> =>
    ipcRenderer.invoke(PUBLIC_SPECS_CHANNELS.GET_VERSIONS, subdomain),
  publicSpecsDeleteVersion: (subdomain: string, version: string): Promise<boolean> =>
    ipcRenderer.invoke(PUBLIC_SPECS_CHANNELS.DELETE_VERSION, { subdomain, version }),
  publicSpecsDeleteRootFiles: (subdomain: string): Promise<boolean> =>
    ipcRenderer.invoke(PUBLIC_SPECS_CHANNELS.DELETE_ROOT_FILES, subdomain),
  publicSpecsGetManifest: (subdomain: string): Promise<SpecManifest | null> =>
    ipcRenderer.invoke(PUBLIC_SPECS_CHANNELS.GET_MANIFEST, subdomain),
  publicSpecsUpdateManifest: (manifest: SpecManifest): Promise<boolean> =>
    ipcRenderer.invoke(PUBLIC_SPECS_CHANNELS.UPDATE_MANIFEST, manifest),

  // Event listeners
  onUpdateAvailable: (callback: (data: { version: string; releaseNotes: string | null; releaseDate: string; releaseName?: string }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { version: string; releaseNotes: string | null; releaseDate: string; releaseName?: string }) => callback(data);
    ipcRenderer.on(UPDATE_CHANNELS.UPDATE_AVAILABLE, handler);
    return () => ipcRenderer.removeListener(UPDATE_CHANNELS.UPDATE_AVAILABLE, handler);
  },
  onUpdateNotAvailable: (callback: (data: { currentVersion: string }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { currentVersion: string }) => callback(data);
    ipcRenderer.on(UPDATE_CHANNELS.UPDATE_NOT_AVAILABLE, handler);
    return () => ipcRenderer.removeListener(UPDATE_CHANNELS.UPDATE_NOT_AVAILABLE, handler);
  },
  onUpdateDownloaded: (callback: (data: { version: string; releaseNotes: string | null; releaseDate: string; releaseName?: string }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { version: string; releaseNotes: string | null; releaseDate: string; releaseName?: string }) => callback(data);
    ipcRenderer.on(UPDATE_CHANNELS.UPDATE_DOWNLOADED, handler);
    return () => ipcRenderer.removeListener(UPDATE_CHANNELS.UPDATE_DOWNLOADED, handler);
  },
  onUpdateError: (callback: (data: { message: string }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { message: string }) => callback(data);
    ipcRenderer.on(UPDATE_CHANNELS.UPDATE_ERROR, handler);
    return () => ipcRenderer.removeListener(UPDATE_CHANNELS.UPDATE_ERROR, handler);
  },
  onDownloadProgress: (callback: (data: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => callback(data);
    ipcRenderer.on(UPDATE_CHANNELS.UPDATE_DOWNLOAD_PROGRESS, handler);
    return () => ipcRenderer.removeListener(UPDATE_CHANNELS.UPDATE_DOWNLOAD_PROGRESS, handler);
  },

  // Menu event listeners
  onOpenSettings: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('open-settings', handler);
    return () => ipcRenderer.removeListener('open-settings', handler);
  },
  onNewRequest: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('new-request', handler);
    return () => ipcRenderer.removeListener('new-request', handler);
  },
  onNewCollection: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('new-collection', handler);
    return () => ipcRenderer.removeListener('new-collection', handler);
  },
  onImportCollection: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('import-collection', handler);
    return () => ipcRenderer.removeListener('import-collection', handler);
  },
  onExportCollection: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('export-collection', handler);
    return () => ipcRenderer.removeListener('export-collection', handler);
  },
  onSendRequest: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('send-request', handler);
    return () => ipcRenderer.removeListener('send-request', handler);
  },
  onSaveRequest: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('save-request', handler);
    return () => ipcRenderer.removeListener('save-request', handler);
  },
  onDuplicateRequest: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('duplicate-request', handler);
    return () => ipcRenderer.removeListener('duplicate-request', handler);
  },
  onToggleSidebar: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('toggle-sidebar', handler);
    return () => ipcRenderer.removeListener('toggle-sidebar', handler);
  },
  onToggleConsole: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('toggle-console', handler);
    return () => ipcRenderer.removeListener('toggle-console', handler);
  },
  onCheckForUpdates: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('check-for-updates', handler);
    return () => ipcRenderer.removeListener('check-for-updates', handler);
  },

  // Deep link handler
  onDeepLink: (callback: (data: { action: string; path: string; params: Record<string, string>; url: string }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { action: string; path: string; params: Record<string, string>; url: string }) => callback(data);
    ipcRenderer.on(APP_CHANNELS.DEEP_LINK, handler);
    return () => ipcRenderer.removeListener(APP_CHANNELS.DEEP_LINK, handler);
  },
});

// Type definitions for the exposed API
declare global {
  interface Window {
    electronAPI: {
      getAppVersion: () => Promise<string>;
      makeHttpRequest: (options: HttpRequestOptions) => Promise<HttpResponseResult>;
      executeScript: (options: {
        script: string;
        context: {
          request: { url: string; method: string; headers: Record<string, string>; body?: string | null };
          response?: { status: number; statusText: string; headers: Record<string, string>; body: string; responseTime: number };
          envVars: Record<string, string>;
          runtimeVars: Record<string, string>;
        };
      }) => Promise<{
        logs: Array<{ type: 'log' | 'warn' | 'error' | 'info'; args: string[]; timestamp: number }>;
        error?: string;
        duration: number;
        envVars: Record<string, string>;
        runtimeVars: Record<string, string>;
        modifiedResponse?: { status: number; statusText: string; headers: Record<string, string>; body: string; responseTime: number };
      }>;
      computeDigestAuth: (options: {
        wwwAuthHeader: string;
        username: string;
        password: string;
        method: string;
        uri: string;
      }) => Promise<{
        success: boolean;
        header?: string;
        error?: string;
        challenge?: {
          realm: string;
          nonce: string;
          algorithm?: string;
          qop?: string;
          opaque?: string;
        };
      }>;
      checkForUpdates: () => Promise<{ updateAvailable: boolean; version?: string; releaseNotes?: string | null; releaseDate?: string }>;
      downloadUpdate: () => Promise<{ success: boolean }>;
      installUpdate: () => void;
      quitAndInstallLater: () => Promise<{ success: boolean; updatePending: boolean }>;
      setUpdateServer: (url: string | null) => Promise<{ success: boolean; feedUrl?: string; error?: string }>;
      // Shell
      openExternal: (url: string) => Promise<void>;
      // App control
      restartApp: () => Promise<void>;
      wipeAllData: () => Promise<{ success: boolean; error?: string }>;
      toggleDevTools: () => Promise<void>;
      // Capture page screenshot
      capturePage: () => Promise<{ success: boolean; data?: string; error?: string }>;
      // Mock Server
      startMockServer: (config: MockServerConfig) => Promise<{ success: boolean; error?: string }>;
      stopMockServer: (id: string) => Promise<boolean>;
      getMockServerStatus: (id: string) => Promise<boolean>;
      updateMockRoutes: (id: string, routes: MockServerConfig['routes']) => Promise<void>;
      getLocalHostname: () => Promise<string>;
      onMockRequestReceived: (callback: (request: CapturedRequest) => void) => () => void;
      // Cloud Proxy
      cloudProxyConnect: (config: CloudProxyConfig) => Promise<{ success: boolean; error?: string }>;
      cloudProxyDisconnect: () => Promise<void>;
      cloudProxyGetStatus: () => Promise<{ status: CloudProxyConnectionStatus; namespace?: string }>;
      cloudProxySendResponse: (response: CloudProxyResponse) => Promise<void>;
      cloudProxyCheckNamespace: (serverUrl: string, namespace: string) => Promise<{ available: boolean; connected: boolean }>;
      onCloudProxyStatusChanged: (callback: (event: CloudProxyStatusEvent) => void) => () => void;
      onCloudProxyRequestReceived: (callback: (request: CloudProxyRequest) => void) => () => void;
      onCloudProxyForwardedResponse: (callback: (response: CloudProxyForwardedResponse) => void) => () => void;
      // Cloud Proxy Mock Management
      cloudProxyFetchMocks: (serverUrl: string, namespace: string) => Promise<{ success: boolean; mocks: CloudStoredMock[]; error?: string }>;
      cloudProxySyncMocks: (serverUrl: string, namespace: string, mocks: CloudStoredMock[]) => Promise<{ success: boolean; error?: string }>;
      cloudProxyUploadMock: (serverUrl: string, namespace: string, mock: CloudStoredMock) => Promise<{ success: boolean; error?: string }>;
      cloudProxyDeleteMock: (serverUrl: string, namespace: string, mockId: string) => Promise<{ success: boolean; error?: string }>;
      // URL Content Fetch
      fetchUrlContent: (url: string) => Promise<{ success: boolean; content?: string; contentType?: string; error?: string }>;
      // File Storage
      initFileStorage: () => Promise<{ success: boolean; error?: string }>;
      getEcholonPath: () => Promise<string>;
      setEcholonPath: (newPath: string) => Promise<{ success: boolean; error?: string }>;
      selectDirectory: () => Promise<string | null>;
      openInFileManager: () => Promise<void>;
      readConfig: () => Promise<EcholonConfig | null>;
      writeConfig: (config: EcholonConfig) => Promise<boolean>;
      updateConfig: (updates: Partial<EcholonConfig>) => Promise<boolean>;
      readEnvironments: () => Promise<GlobalEnvironmentsFile | null>;
      writeEnvironments: (environments: GlobalEnvironmentsFile) => Promise<boolean>;
      getAllWorkspaces: () => Promise<WorkspaceFile[]>;
      createWorkspace: (name: string, description?: string, color?: string) => Promise<{ success: boolean; workspace?: WorkspaceFile; error?: string }>;
      readWorkspace: (workspaceName: string) => Promise<WorkspaceFile | null>;
      updateWorkspace: (workspaceName: string, updates: Partial<WorkspaceFile>) => Promise<boolean>;
      renameWorkspace: (oldName: string, newName: string) => Promise<boolean>;
      deleteWorkspace: (workspaceName: string) => Promise<boolean>;
      getAllCollections: (workspaceName: string) => Promise<EchoFile[]>;
      getAllCollectionsAllWorkspaces: () => Promise<{ workspace: string; collections: EchoFile[] }[]>;
      readCollection: (workspaceName: string, collectionName: string) => Promise<EchoFile | null>;
      writeCollection: (workspaceName: string, collectionName: string, collection: EchoFile) => Promise<boolean>;
      deleteCollection: (workspaceName: string, collectionName: string) => Promise<boolean>;
      renameCollection: (workspaceName: string, oldName: string, newName: string) => Promise<boolean>;
      showCollectionInFinder: (workspaceName: string, collectionName: string) => Promise<void>;
      watchDirectory: (dirPath: string) => Promise<boolean>;
      unwatchDirectory: (dirPath: string) => Promise<boolean>;
      onFileChanged: (callback: (event: FileChangedEvent) => void) => () => void;
      readDataFile: <T>(filename: string) => Promise<T | null>;
      writeDataFile: <T>(filename: string, data: T) => Promise<boolean>;
      // Mocking data
      readMockRequests: <T>(workspaceName: string, mockApiName: string, endpoint: string) => Promise<T | null>;
      writeMockRequests: <T>(workspaceName: string, mockApiName: string, endpoint: string, data: T) => Promise<boolean>;
      readAllMockRequests: <T>(workspaceName: string, mockApiName: string) => Promise<{ endpoint: string; requests: T }[]>;
      readAllMockingData: <T>(workspaceName: string) => Promise<{ mockApiName: string; endpoint: string; requests: T }[]>;
      deleteMockApiData: (workspaceName: string, mockApiName: string) => Promise<boolean>;
      deleteMockEndpointData: (workspaceName: string, mockApiName: string, endpoint: string) => Promise<boolean>;
      clearMockingData: (workspaceName: string) => Promise<boolean>;
      // OpenAPI export
      writeCollectionOpenAPI: (workspaceName: string, collectionId: string, openapiJson: string, version?: string) => Promise<boolean>;
      readCollectionOpenAPI: (workspaceName: string, collectionId: string, version?: string) => Promise<string | null>;
      // Request history (per workspace)
      readHistory: <T>(workspaceName: string) => Promise<T | null>;
      writeHistory: <T>(workspaceName: string, data: T) => Promise<boolean>;
      clearHistory: (workspaceName: string) => Promise<boolean>;
      // Workspace data files (workspace-specific state)
      readWorkspaceDataFile: <T>(workspaceName: string, filename: string) => Promise<T | null>;
      writeWorkspaceDataFile: <T>(workspaceName: string, filename: string, data: T) => Promise<boolean>;
      deleteWorkspaceDataFile: (workspaceName: string, filename: string) => Promise<boolean>;
      // Git (isomorphic-git)
      gitInit: (dir: string) => Promise<{ success: boolean; error?: string }>;
      gitIsRepo: (dir: string) => Promise<boolean>;
      gitClone: (url: string, dir: string, branch?: string) => Promise<{ success: boolean; error?: string }>;
      gitStatus: (dir: string) => Promise<{ success: boolean; status?: GitStatus; error?: string }>;
      gitAdd: (dir: string, filepath: string) => Promise<{ success: boolean; error?: string }>;
      gitAddAll: (dir: string) => Promise<{ success: boolean; error?: string }>;
      gitUnstage: (dir: string, filepath: string) => Promise<{ success: boolean; error?: string }>;
      gitDiscardChanges: (dir: string, filepath: string) => Promise<{ success: boolean; error?: string }>;
      gitCommit: (dir: string, message: string, author: { name: string; email: string }) => Promise<{ success: boolean; oid?: string; error?: string }>;
      gitLog: (dir: string, depth?: number) => Promise<{ success: boolean; commits?: GitCommitInfo[]; error?: string }>;
      gitListBranches: (dir: string) => Promise<{ success: boolean; branches?: GitBranchInfo[]; error?: string }>;
      gitCurrentBranch: (dir: string) => Promise<{ success: boolean; branch?: string; error?: string }>;
      gitCreateBranch: (dir: string, name: string, checkout?: boolean) => Promise<{ success: boolean; error?: string }>;
      gitCheckout: (dir: string, ref: string) => Promise<{ success: boolean; error?: string }>;
      gitDeleteBranch: (dir: string, name: string) => Promise<{ success: boolean; error?: string }>;
      gitListRemotes: (dir: string) => Promise<{ success: boolean; remotes?: GitRemote[]; error?: string }>;
      gitAddRemote: (dir: string, name: string, url: string) => Promise<{ success: boolean; error?: string }>;
      gitRemoveRemote: (dir: string, name: string) => Promise<{ success: boolean; error?: string }>;
      gitPush: (dir: string, remote?: string, branch?: string) => Promise<{ success: boolean; error?: string }>;
      gitPull: (dir: string, remote?: string, branch?: string, author?: { name: string; email: string }) => Promise<{ success: boolean; error?: string }>;
      gitFetch: (dir: string, remote?: string, branch?: string) => Promise<{ success: boolean; error?: string }>;
      gitSetCredentials: (credentials: GitCredentials | null) => Promise<{ success: boolean }>;
      gitCreateGitignore: (dir: string) => Promise<{ success: boolean; error?: string }>;
      gitGetFileForDiff: (dir: string, filepath: string) => Promise<{ success: boolean; oldContent?: string; newContent?: string; error?: string }>;
      // GitHub
      githubAuthWithPAT: (token: string) => Promise<GitHubApiResponse<GitHubUser>>;
      githubStartOAuth: () => Promise<{ success: boolean; url?: string; error?: string }>;
      githubLogout: () => Promise<{ success: boolean }>;
      githubGetCurrentUser: () => Promise<GitHubApiResponse<GitHubUser>>;
      githubIsAuthenticated: () => Promise<boolean>;
      githubSetAccessToken: (token: string | null) => Promise<{ success: boolean }>;
      githubListRepos: (options?: { visibility?: string; sort?: string; per_page?: number; page?: number }) => Promise<GitHubApiResponse<GitHubRepository[]>>;
      githubGetRepo: (owner: string, repo: string) => Promise<GitHubApiResponse<GitHubRepository>>;
      githubCreateRepo: (options: { name: string; description?: string; private?: boolean; auto_init?: boolean }) => Promise<GitHubApiResponse<GitHubRepository>>;
      githubListBranches: (owner: string, repo: string) => Promise<GitHubApiResponse<GitHubBranch[]>>;
      githubGetBranch: (owner: string, repo: string, branch: string) => Promise<GitHubApiResponse<GitHubBranch>>;
      githubCreateBranch: (owner: string, repo: string, branchName: string, sourceSha: string) => Promise<GitHubApiResponse<{ ref: string; object: { sha: string } }>>;
      githubListCommits: (owner: string, repo: string, options?: { sha?: string; path?: string; per_page?: number; page?: number }) => Promise<GitHubApiResponse<Array<{ sha: string; commit: GitHubCommit; html_url: string }>>>;
      githubGetCommit: (owner: string, repo: string, sha: string) => Promise<GitHubApiResponse<{ sha: string; commit: GitHubCommit; files?: Array<{ filename: string; status: string; patch?: string }> }>>;
      githubGetContents: (owner: string, repo: string, path: string, ref?: string) => Promise<GitHubApiResponse<GitHubContent | GitHubContent[]>>;
      githubCreateOrUpdateFile: (owner: string, repo: string, path: string, options: { message: string; content: string; sha?: string; branch?: string }) => Promise<GitHubApiResponse<{ content: GitHubContent; commit: { sha: string } }>>;
      githubDeleteFile: (owner: string, repo: string, path: string, options: { message: string; sha: string; branch?: string }) => Promise<GitHubApiResponse<{ commit: { sha: string } }>>;
      githubCompareCommits: (owner: string, repo: string, base: string, head: string) => Promise<GitHubApiResponse<{ status: string; ahead_by: number; behind_by: number; commits: Array<{ sha: string; commit: GitHubCommit }>; files: Array<{ filename: string; status: string; patch?: string }> }>>;
      githubPushChanges: (owner: string, repo: string, branch: string, message: string, changes: GitHubFileChange[]) => Promise<GitHubApiResponse<{ sha: string }>>;
      githubPullLatest: (owner: string, repo: string, branch: string) => Promise<GitHubApiResponse<{ sha: string; commit: GitHubCommit; tree: Array<{ path: string; type: string; sha: string }> }>>;
      githubSetupWorkspaceGit: (workspaceName: string, owner: string, repo: string) => Promise<{ success: boolean; error?: string }>;
      // Public Specs
      publicSpecsCheckSubdomain: (subdomain: string, userId?: string) => Promise<CheckSubdomainResult>;
      publicSpecsUpload: (options: UploadSpecOptions) => Promise<UploadResult>;
      publicSpecsGetVersions: (subdomain: string) => Promise<SpecVersion[]>;
      publicSpecsDeleteVersion: (subdomain: string, version: string) => Promise<boolean>;
      publicSpecsGetManifest: (subdomain: string) => Promise<SpecManifest | null>;
      publicSpecsUpdateManifest: (manifest: SpecManifest) => Promise<boolean>;
      // Updates
      onUpdateAvailable: (callback: (data: { version: string; releaseNotes: string | null; releaseDate: string; releaseName?: string }) => void) => () => void;
      onUpdateNotAvailable: (callback: (data: { currentVersion: string }) => void) => () => void;
      onUpdateDownloaded: (callback: (data: { version: string; releaseNotes: string | null; releaseDate: string; releaseName?: string }) => void) => () => void;
      onUpdateError: (callback: (data: { message: string }) => void) => () => void;
      onDownloadProgress: (callback: (data: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => void) => () => void;
      onOpenSettings: (callback: () => void) => () => void;
      onNewRequest: (callback: () => void) => () => void;
      onNewCollection: (callback: () => void) => () => void;
      onImportCollection: (callback: () => void) => () => void;
      onExportCollection: (callback: () => void) => () => void;
      onSendRequest: (callback: () => void) => () => void;
      onSaveRequest: (callback: () => void) => () => void;
      onDuplicateRequest: (callback: () => void) => () => void;
      onToggleSidebar: (callback: () => void) => () => void;
      onToggleConsole: (callback: () => void) => () => void;
      onCheckForUpdates: (callback: () => void) => () => void;
      // Deep link
      onDeepLink: (callback: (data: { action: string; path: string; params: Record<string, string>; url: string }) => void) => () => void;
    };
  }
}
