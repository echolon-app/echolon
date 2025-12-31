import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// IPC channel constants (duplicated here to avoid cross-rootDir import issues)
const IPC_CHANNELS = {
  CHECK_FOR_UPDATES: 'check-for-updates',
  UPDATE_AVAILABLE: 'update-available',
  UPDATE_NOT_AVAILABLE: 'update-not-available',
  UPDATE_DOWNLOADED: 'update-downloaded',
  DOWNLOAD_UPDATE: 'download-update',
  INSTALL_UPDATE: 'install-update',
  GET_APP_VERSION: 'get-app-version',
  MAKE_HTTP_REQUEST: 'make-http-request',
  START_MOCK_SERVER: 'start-mock-server',
  STOP_MOCK_SERVER: 'stop-mock-server',
  GET_MOCK_SERVER_STATUS: 'get-mock-server-status',
  MOCK_REQUEST_RECEIVED: 'mock-request-received',
  UPDATE_MOCK_ROUTES: 'update-mock-routes',
  GET_LOCAL_HOSTNAME: 'get-local-hostname',
  // Spec Import
  FETCH_URL_CONTENT: 'fetch-url-content',
  // Cloud Proxy channels
  CLOUD_PROXY_CONNECT: 'cloud-proxy-connect',
  CLOUD_PROXY_DISCONNECT: 'cloud-proxy-disconnect',
  CLOUD_PROXY_STATUS: 'cloud-proxy-status',
  CLOUD_PROXY_STATUS_CHANGED: 'cloud-proxy-status-changed',
  CLOUD_PROXY_REQUEST_RECEIVED: 'cloud-proxy-request-received',
  CLOUD_PROXY_FORWARDED_RESPONSE: 'cloud-proxy-forwarded-response',
  CLOUD_PROXY_SEND_RESPONSE: 'cloud-proxy-send-response',
  CLOUD_PROXY_CHECK_NAMESPACE: 'cloud-proxy-check-namespace',
  // Cloud Proxy Mock Management
  CLOUD_PROXY_FETCH_MOCKS: 'cloud-proxy-fetch-mocks',
  CLOUD_PROXY_UPLOAD_MOCK: 'cloud-proxy-upload-mock',
  CLOUD_PROXY_DELETE_MOCK: 'cloud-proxy-delete-mock',
  CLOUD_PROXY_SYNC_MOCKS: 'cloud-proxy-sync-mocks',
} as const;

// File Storage IPC channels
const FILE_STORAGE_CHANNELS = {
  // Initialization
  INIT_FILE_STORAGE: 'file-storage-init',
  GET_ECHOLON_PATH: 'file-storage-get-path',
  SET_ECHOLON_PATH: 'file-storage-set-path',
  SELECT_DIRECTORY: 'file-storage-select-directory',
  OPEN_IN_FILE_MANAGER: 'file-storage-open-in-file-manager',
  // Config
  READ_CONFIG: 'file-storage-read-config',
  WRITE_CONFIG: 'file-storage-write-config',
  UPDATE_CONFIG: 'file-storage-update-config',
  // Environments
  READ_ENVIRONMENTS: 'file-storage-read-environments',
  WRITE_ENVIRONMENTS: 'file-storage-write-environments',
  // Workspaces
  GET_ALL_WORKSPACES: 'file-storage-get-all-workspaces',
  CREATE_WORKSPACE: 'file-storage-create-workspace',
  READ_WORKSPACE: 'file-storage-read-workspace',
  UPDATE_WORKSPACE: 'file-storage-update-workspace',
  RENAME_WORKSPACE: 'file-storage-rename-workspace',
  DELETE_WORKSPACE: 'file-storage-delete-workspace',
  // Collections
  GET_ALL_COLLECTIONS: 'file-storage-get-all-collections',
  GET_ALL_COLLECTIONS_ALL_WORKSPACES: 'file-storage-get-all-collections-all-workspaces',
  READ_COLLECTION: 'file-storage-read-collection',
  WRITE_COLLECTION: 'file-storage-write-collection',
  DELETE_COLLECTION: 'file-storage-delete-collection',
  RENAME_COLLECTION: 'file-storage-rename-collection',
  // File watching
  WATCH_DIRECTORY: 'file-storage-watch-directory',
  UNWATCH_DIRECTORY: 'file-storage-unwatch-directory',
  FILE_CHANGED: 'file-storage-file-changed',
  // Generic data files (for app state like pending changes, mocks, etc.)
  READ_DATA_FILE: 'file-storage-read-data-file',
  WRITE_DATA_FILE: 'file-storage-write-data-file',
  // Mocking data (per workspace/endpoint)
  READ_MOCK_REQUESTS: 'file-storage-read-mock-requests',
  WRITE_MOCK_REQUESTS: 'file-storage-write-mock-requests',
  READ_ALL_MOCK_REQUESTS: 'file-storage-read-all-mock-requests',
  READ_ALL_MOCKING_DATA: 'file-storage-read-all-mocking-data',
  DELETE_MOCK_API_DATA: 'file-storage-delete-mock-api-data',
  DELETE_MOCK_ENDPOINT_DATA: 'file-storage-delete-mock-endpoint-data',
  CLEAR_MOCKING_DATA: 'file-storage-clear-mocking-data',
} as const;

// GitHub IPC channels
const GITHUB_CHANNELS = {
  // Authentication
  AUTH_WITH_PAT: 'github-auth-with-pat',
  START_OAUTH: 'github-start-oauth',
  LOGOUT: 'github-logout',
  GET_CURRENT_USER: 'github-get-current-user',
  IS_AUTHENTICATED: 'github-is-authenticated',
  SET_ACCESS_TOKEN: 'github-set-access-token',
  // Repositories
  LIST_REPOS: 'github-list-repos',
  GET_REPO: 'github-get-repo',
  CREATE_REPO: 'github-create-repo',
  // Branches
  LIST_BRANCHES: 'github-list-branches',
  GET_BRANCH: 'github-get-branch',
  CREATE_BRANCH: 'github-create-branch',
  // Commits
  LIST_COMMITS: 'github-list-commits',
  GET_COMMIT: 'github-get-commit',
  // Contents
  GET_CONTENTS: 'github-get-contents',
  CREATE_OR_UPDATE_FILE: 'github-create-or-update-file',
  DELETE_FILE: 'github-delete-file',
  // Comparison
  COMPARE_COMMITS: 'github-compare-commits',
  // Batch operations
  PUSH_CHANGES: 'github-push-changes',
  PULL_LATEST: 'github-pull-latest',
} as const;

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

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.GET_APP_VERSION),

  // HTTP Request - bypasses CORS by going through Node.js
  makeHttpRequest: (options: HttpRequestOptions): Promise<HttpResponseResult> => 
    ipcRenderer.invoke(IPC_CHANNELS.MAKE_HTTP_REQUEST, options),

  // Update functions
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.CHECK_FOR_UPDATES),
  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_UPDATE),
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.INSTALL_UPDATE),

  // Mock Server functions
  startMockServer: (config: MockServerConfig): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.START_MOCK_SERVER, config),
  stopMockServer: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.STOP_MOCK_SERVER, id),
  getMockServerStatus: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_MOCK_SERVER_STATUS, id),
  updateMockRoutes: (id: string, routes: MockServerConfig['routes']): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_MOCK_ROUTES, { id, routes }),
  getLocalHostname: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_LOCAL_HOSTNAME),
  onMockRequestReceived: (callback: (request: CapturedRequest) => void) => {
    const handler = (_event: IpcRendererEvent, request: CapturedRequest) => callback(request);
    ipcRenderer.on(IPC_CHANNELS.MOCK_REQUEST_RECEIVED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.MOCK_REQUEST_RECEIVED, handler);
  },

  // Cloud Proxy functions
  cloudProxyConnect: (config: CloudProxyConfig): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLOUD_PROXY_CONNECT, config),
  cloudProxyDisconnect: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLOUD_PROXY_DISCONNECT),
  cloudProxyGetStatus: (): Promise<{ status: CloudProxyConnectionStatus; namespace?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLOUD_PROXY_STATUS),
  cloudProxySendResponse: (response: CloudProxyResponse): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLOUD_PROXY_SEND_RESPONSE, response),
  cloudProxyCheckNamespace: (serverUrl: string, namespace: string): Promise<{ available: boolean; connected: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLOUD_PROXY_CHECK_NAMESPACE, { serverUrl, namespace }),
  onCloudProxyStatusChanged: (callback: (event: CloudProxyStatusEvent) => void) => {
    const handler = (_event: IpcRendererEvent, data: CloudProxyStatusEvent) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.CLOUD_PROXY_STATUS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CLOUD_PROXY_STATUS_CHANGED, handler);
  },
  onCloudProxyRequestReceived: (callback: (request: CloudProxyRequest) => void) => {
    const handler = (_event: IpcRendererEvent, request: CloudProxyRequest) => callback(request);
    ipcRenderer.on(IPC_CHANNELS.CLOUD_PROXY_REQUEST_RECEIVED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CLOUD_PROXY_REQUEST_RECEIVED, handler);
  },
  onCloudProxyForwardedResponse: (callback: (response: CloudProxyForwardedResponse) => void) => {
    const handler = (_event: IpcRendererEvent, response: CloudProxyForwardedResponse) => callback(response);
    ipcRenderer.on(IPC_CHANNELS.CLOUD_PROXY_FORWARDED_RESPONSE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CLOUD_PROXY_FORWARDED_RESPONSE, handler);
  },

  // Cloud Proxy Mock Management
  cloudProxyFetchMocks: (serverUrl: string, namespace: string): Promise<{ success: boolean; mocks: CloudStoredMock[]; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLOUD_PROXY_FETCH_MOCKS, { serverUrl, namespace }),
  cloudProxySyncMocks: (serverUrl: string, namespace: string, mocks: CloudStoredMock[]): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLOUD_PROXY_SYNC_MOCKS, { serverUrl, namespace, mocks }),
  cloudProxyUploadMock: (serverUrl: string, namespace: string, mock: CloudStoredMock): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLOUD_PROXY_UPLOAD_MOCK, { serverUrl, namespace, mock }),
  cloudProxyDeleteMock: (serverUrl: string, namespace: string, mockId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CLOUD_PROXY_DELETE_MOCK, { serverUrl, namespace, mockId }),

  // URL Content Fetch - bypasses CORS for spec import
  fetchUrlContent: (url: string): Promise<FetchUrlResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.FETCH_URL_CONTENT, url),

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

  // Event listeners
  onUpdateAvailable: (callback: (data: { version: string; releaseNotes: string; releaseDate: string }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { version: string; releaseNotes: string; releaseDate: string }) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.UPDATE_AVAILABLE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_AVAILABLE, handler);
  },
  onUpdateNotAvailable: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on(IPC_CHANNELS.UPDATE_NOT_AVAILABLE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_NOT_AVAILABLE, handler);
  },
  onUpdateDownloaded: (callback: (data: { version: string }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { version: string }) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.UPDATE_DOWNLOADED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_DOWNLOADED, handler);
  },
  onDownloadProgress: (callback: (data: { percent: number; transferred: number; total: number }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { percent: number; transferred: number; total: number }) => callback(data);
    ipcRenderer.on('update-download-progress', handler);
    return () => ipcRenderer.removeListener('update-download-progress', handler);
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
});

// Type definitions for the exposed API
declare global {
  interface Window {
    electronAPI: {
      getAppVersion: () => Promise<string>;
      makeHttpRequest: (options: HttpRequestOptions) => Promise<HttpResponseResult>;
      checkForUpdates: () => Promise<unknown>;
      downloadUpdate: () => Promise<void>;
      installUpdate: () => void;
      // Mock Server
      startMockServer: (config: MockServerConfig) => Promise<boolean>;
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
      // Updates
      onUpdateAvailable: (callback: (data: { version: string; releaseNotes: string; releaseDate: string }) => void) => () => void;
      onUpdateNotAvailable: (callback: () => void) => () => void;
      onUpdateDownloaded: (callback: (data: { version: string }) => void) => () => void;
      onDownloadProgress: (callback: (data: { percent: number; transferred: number; total: number }) => void) => () => void;
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
    };
  }
}
