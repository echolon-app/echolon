import { app, BrowserWindow, shell, ipcMain } from 'electron';
import path from 'path';
import crypto from 'crypto';
import { setupMenu } from './menu';
import { setupUpdater } from './updater';
import { makeHttpRequest, HttpRequestOptions, HttpResponseResult } from './httpRequest';
import { mockServerManager } from './mockServer';
import { cloudProxyManager, CloudProxyConfig, ProxyResponse, StoredMock, CLOUD_PROXY_CHANNELS } from './cloudProxy';
import { fileStorageManager } from './fileStorage';
import { githubManager, GitHubFileChange } from './github';
import { EchoFile, EcholonConfig, GlobalEnvironmentsFile, WorkspaceFile } from '../shared/echoFormat';

// IPC channel constants (duplicated here to avoid cross-rootDir import issues)
const IPC_CHANNELS = {
  MAKE_HTTP_REQUEST: 'make-http-request',
  GET_APP_VERSION: 'get-app-version',
  START_MOCK_SERVER: 'start-mock-server',
  STOP_MOCK_SERVER: 'stop-mock-server',
  GET_MOCK_SERVER_STATUS: 'get-mock-server-status',
  UPDATE_MOCK_ROUTES: 'update-mock-routes',
  GET_LOCAL_HOSTNAME: 'get-local-hostname',
  FETCH_URL_CONTENT: 'fetch-url-content',
  EXECUTE_SCRIPT: 'execute-script',
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
  // Generic data files
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

// Disable GPU acceleration for better compatibility
app.disableHardwareAcceleration();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// This is only needed for production builds with Squirrel installer
try {
  if (require('electron-squirrel-startup')) {
    app.quit();
  }
} catch {
  // electron-squirrel-startup not available in dev mode, ignore
}

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;

function createWindow(): void {
  // Get icon path - use resources folder for packaged app, core/assets for dev
  const iconPath = isDev 
    ? path.join(__dirname, '../../core/assets/app-icon/logo.png')
    : path.join(__dirname, '../../resources/icon.png');

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Echolon',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#0a0a0a', // Match default terminal theme for instant correct bg
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
    },
  });

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();

    if (process.platform === 'darwin') {
      app.dock.setIcon(path.join(__dirname, '../../resources/icon.png'))
      app.setName('Echolon')
      app.dock.setBadge('') // forces Dock refresh sometimes
     // app.dock.setTitle('Echolon')
    }


  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    mockServerManager.setMainWindow(null);
    cloudProxyManager.setMainWindow(null);
  });

  // Set main window reference for mock server and cloud proxy
  mockServerManager.setMainWindow(mainWindow);
  cloudProxyManager.setMainWindow(mainWindow);
}

// Mock server config interface
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

// Setup IPC handlers
function setupIpcHandlers(): void {
  // HTTP Request handler - bypasses CORS
  ipcMain.handle(IPC_CHANNELS.MAKE_HTTP_REQUEST, async (_event, options: HttpRequestOptions): Promise<HttpResponseResult> => {
    return makeHttpRequest(options);
  });

  // Get app version
  ipcMain.handle(IPC_CHANNELS.GET_APP_VERSION, () => {
    return app.getVersion();
  });

  // Execute script - runs in main process to bypass CSP restrictions
  ipcMain.handle(IPC_CHANNELS.EXECUTE_SCRIPT, async (_event, options: {
    script: string;
    context: {
      request: { url: string; method: string; headers: Record<string, string>; body?: string | null };
      response?: { status: number; statusText: string; headers: Record<string, string>; body: string; responseTime: number };
      envVars: Record<string, string>;
      runtimeVars: Record<string, string>;
    };
  }) => {
    const { script, context } = options;
    const startTime = Date.now();
    const logs: Array<{ type: 'log' | 'warn' | 'error' | 'info'; args: string[]; timestamp: number }> = [];
    
    // Store for variables set during script execution
    const updatedEnvVars: Record<string, string> = { ...context.envVars };
    const updatedRuntimeVars: Record<string, string> = { ...context.runtimeVars };

    if (!script || script.trim() === '') {
      return { logs, duration: 0, envVars: updatedEnvVars, runtimeVars: updatedRuntimeVars };
    }

    // Create log capture
    const createLogCapture = (type: 'log' | 'warn' | 'error' | 'info') => {
      return (...args: unknown[]) => {
        logs.push({
          type,
          args: args.map(arg => {
            if (typeof arg === 'string') return arg;
            try {
              return JSON.stringify(arg, null, 2);
            } catch {
              return String(arg);
            }
          }),
          timestamp: Date.now(),
        });
      };
    };

    const customConsole = {
      log: createLogCapture('log'),
      warn: createLogCapture('warn'),
      error: createLogCapture('error'),
      info: createLogCapture('info'),
    };

    // Create the `echo` API object
    const echo = {
      getEnvVar: (name: string) => updatedEnvVars[name],
      setEnvVar: (name: string, value: string) => { updatedEnvVars[name] = value; },
      getVar: (name: string) => updatedRuntimeVars[name],
      setVar: (name: string, value: string) => { updatedRuntimeVars[name] = value; },
      sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
    };

    // Create the `req` request object
    const reqData = { ...context.request };
    const req = {
      url: reqData.url,
      method: reqData.method,
      headers: { ...reqData.headers },
      body: reqData.body || null,
      getUrl: () => reqData.url,
      getMethod: () => reqData.method,
      getHeaders: () => ({ ...reqData.headers }),
      getHeader: (name: string) => {
        const lowerName = name.toLowerCase();
        const key = Object.keys(reqData.headers).find(k => k.toLowerCase() === lowerName);
        return key ? reqData.headers[key] : undefined;
      },
      getBody: () => reqData.body,
      setUrl: (url: string) => { reqData.url = url; req.url = url; },
      setMethod: (method: string) => { reqData.method = method; req.method = method; },
      setHeaders: (headers: Record<string, string>) => { reqData.headers = { ...headers }; req.headers = { ...headers }; },
      setHeader: (name: string, value: string) => { reqData.headers[name] = value; req.headers[name] = value; },
      setBody: (body: string) => { reqData.body = body; req.body = body; },
    };

    // Create the `res` response object (only for post-request scripts)
    const res = context.response ? {
      status: context.response.status,
      statusText: context.response.statusText,
      headers: { ...context.response.headers },
      body: context.response.body,
      responseTime: context.response.responseTime,
      getStatus: () => context.response!.status,
      getStatusText: () => context.response!.statusText,
      getHeaders: () => ({ ...context.response!.headers }),
      getHeader: (name: string) => {
        const lowerName = name.toLowerCase();
        const key = Object.keys(context.response!.headers).find(k => k.toLowerCase() === lowerName);
        return key ? context.response!.headers[key] : undefined;
      },
      getBody: () => context.response!.body,
      getResponseTime: () => context.response!.responseTime,
    } : null;

    try {
      // Create sandboxed function - this works in Node.js (main process) without CSP
      const scriptFunction = new Function(
        'console', 'echo', 'req', 'res',
        'crypto', 'btoa', 'atob', 'Date', 'Math', 'JSON',
        'Array', 'Object', 'String', 'Number', 'Boolean',
        'parseInt', 'parseFloat', 'isNaN', 'isFinite',
        'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
        script
      );

      // Node.js doesn't have btoa/atob natively, so we provide them
      const btoa = (str: string) => Buffer.from(str, 'binary').toString('base64');
      const atob = (str: string) => Buffer.from(str, 'base64').toString('binary');

      scriptFunction(
        customConsole, echo, req, res,
        crypto, btoa, atob, Date, Math, JSON,
        Array, Object, String, Number, Boolean,
        parseInt, parseFloat, isNaN, isFinite,
        encodeURIComponent, decodeURIComponent, encodeURI, decodeURI
      );

      return {
        logs,
        duration: Date.now() - startTime,
        envVars: updatedEnvVars,
        runtimeVars: updatedRuntimeVars,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      
      logs.push({
        type: 'error',
        args: [`Script Error: ${errorMessage}${errorStack ? `\n${errorStack}` : ''}`],
        timestamp: Date.now(),
      });

      return {
        logs,
        error: errorMessage,
        duration: Date.now() - startTime,
        envVars: updatedEnvVars,
        runtimeVars: updatedRuntimeVars,
      };
    }
  });

  // Fetch URL content - for spec import, bypasses CORS
  ipcMain.handle(IPC_CHANNELS.FETCH_URL_CONTENT, async (_event, url: string) => {
    try {
      const result = await makeHttpRequest({
        method: 'GET',
        url,
        timeout: 30000,
      });
      
      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to fetch URL',
        };
      }
      
      // Extract content type from headers
      const contentTypeHeader = result.headers?.find(
        h => h.key.toLowerCase() === 'content-type'
      );
      
      return {
        success: true,
        content: result.body,
        contentType: contentTypeHeader?.value,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Mock Server handlers
  ipcMain.handle(IPC_CHANNELS.START_MOCK_SERVER, async (_event, config: MockServerConfig): Promise<boolean> => {
    return mockServerManager.startServer(config);
  });

  ipcMain.handle(IPC_CHANNELS.STOP_MOCK_SERVER, async (_event, id: string): Promise<boolean> => {
    return mockServerManager.stopServer(id);
  });

  ipcMain.handle(IPC_CHANNELS.GET_MOCK_SERVER_STATUS, (_event, id: string): boolean => {
    return mockServerManager.isServerRunning(id);
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_MOCK_ROUTES, (_event, { id, routes }: { id: string; routes: MockServerConfig['routes'] }): void => {
    mockServerManager.updateRoutes(id, routes);
  });

  ipcMain.handle(IPC_CHANNELS.GET_LOCAL_HOSTNAME, (): string => {
    return mockServerManager.getLocalHostname();
  });

  // Cloud Proxy handlers
  ipcMain.handle(CLOUD_PROXY_CHANNELS.CONNECT, async (_event, config: CloudProxyConfig) => {
    return cloudProxyManager.connect(config);
  });

  ipcMain.handle(CLOUD_PROXY_CHANNELS.DISCONNECT, () => {
    cloudProxyManager.disconnect();
  });

  ipcMain.handle(CLOUD_PROXY_CHANNELS.STATUS, () => {
    return {
      status: cloudProxyManager.getStatus(),
      namespace: cloudProxyManager.getConfig()?.namespace,
    };
  });

  ipcMain.handle(CLOUD_PROXY_CHANNELS.SEND_RESPONSE, (_event, response: ProxyResponse) => {
    cloudProxyManager.sendResponse(response);
  });

  ipcMain.handle(CLOUD_PROXY_CHANNELS.CHECK_NAMESPACE, async (_event, { serverUrl, namespace }: { serverUrl: string; namespace: string }) => {
    return cloudProxyManager.checkNamespace(serverUrl, namespace);
  });

  // Cloud Proxy Mock Management handlers
  ipcMain.handle(CLOUD_PROXY_CHANNELS.FETCH_MOCKS, async (_event, { serverUrl, namespace }: { serverUrl: string; namespace: string }) => {
    return cloudProxyManager.fetchMocks(serverUrl, namespace);
  });

  ipcMain.handle(CLOUD_PROXY_CHANNELS.SYNC_MOCKS, async (_event, { serverUrl, namespace, mocks }: { serverUrl: string; namespace: string; mocks: StoredMock[] }) => {
    return cloudProxyManager.syncMocks(serverUrl, namespace, mocks);
  });

  ipcMain.handle(CLOUD_PROXY_CHANNELS.UPLOAD_MOCK, async (_event, { serverUrl, namespace, mock }: { serverUrl: string; namespace: string; mock: StoredMock }) => {
    return cloudProxyManager.uploadMock(serverUrl, namespace, mock);
  });

  ipcMain.handle(CLOUD_PROXY_CHANNELS.DELETE_MOCK, async (_event, { serverUrl, namespace, mockId }: { serverUrl: string; namespace: string; mockId: string }) => {
    return cloudProxyManager.deleteMock(serverUrl, namespace, mockId);
  });

  // ==================== File Storage Handlers ====================

  // Initialization
  ipcMain.handle(FILE_STORAGE_CHANNELS.INIT_FILE_STORAGE, async () => {
    return fileStorageManager.initialize();
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.GET_ECHOLON_PATH, () => {
    return fileStorageManager.getEcholonPath();
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.SET_ECHOLON_PATH, async (_event, newPath: string) => {
    return fileStorageManager.setEcholonPath(newPath);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.SELECT_DIRECTORY, async () => {
    return fileStorageManager.selectDirectory();
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.OPEN_IN_FILE_MANAGER, async () => {
    return fileStorageManager.openInFileManager();
  });

  // Config
  ipcMain.handle(FILE_STORAGE_CHANNELS.READ_CONFIG, async () => {
    return fileStorageManager.readConfig();
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.WRITE_CONFIG, async (_event, config: EcholonConfig) => {
    return fileStorageManager.writeConfig(config);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.UPDATE_CONFIG, async (_event, updates: Partial<EcholonConfig>) => {
    return fileStorageManager.updateConfig(updates);
  });

  // Environments
  ipcMain.handle(FILE_STORAGE_CHANNELS.READ_ENVIRONMENTS, async () => {
    return fileStorageManager.readEnvironments();
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.WRITE_ENVIRONMENTS, async (_event, environments: GlobalEnvironmentsFile) => {
    return fileStorageManager.writeEnvironments(environments);
  });

  // Workspaces
  ipcMain.handle(FILE_STORAGE_CHANNELS.GET_ALL_WORKSPACES, async () => {
    return fileStorageManager.getAllWorkspaces();
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.CREATE_WORKSPACE, async (_event, { name, description, color }: { name: string; description?: string; color?: string }) => {
    return fileStorageManager.createWorkspace(name, description, color);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.READ_WORKSPACE, async (_event, workspaceName: string) => {
    return fileStorageManager.readWorkspace(workspaceName);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.UPDATE_WORKSPACE, async (_event, { workspaceName, updates }: { workspaceName: string; updates: Partial<WorkspaceFile> }) => {
    return fileStorageManager.updateWorkspace(workspaceName, updates);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.RENAME_WORKSPACE, async (_event, { oldName, newName }: { oldName: string; newName: string }) => {
    return fileStorageManager.renameWorkspace(oldName, newName);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.DELETE_WORKSPACE, async (_event, workspaceName: string) => {
    return fileStorageManager.deleteWorkspace(workspaceName);
  });

  // Collections
  ipcMain.handle(FILE_STORAGE_CHANNELS.GET_ALL_COLLECTIONS, async (_event, workspaceName: string) => {
    return fileStorageManager.getAllCollections(workspaceName);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.GET_ALL_COLLECTIONS_ALL_WORKSPACES, async () => {
    return fileStorageManager.getAllCollectionsAllWorkspaces();
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.READ_COLLECTION, async (_event, { workspaceName, collectionName }: { workspaceName: string; collectionName: string }) => {
    return fileStorageManager.readCollection(workspaceName, collectionName);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.WRITE_COLLECTION, async (_event, { workspaceName, collectionName, collection }: { workspaceName: string; collectionName: string; collection: EchoFile }) => {
    return fileStorageManager.writeCollection(workspaceName, collectionName, collection);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.DELETE_COLLECTION, async (_event, { workspaceName, collectionName }: { workspaceName: string; collectionName: string }) => {
    return fileStorageManager.deleteCollection(workspaceName, collectionName);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.RENAME_COLLECTION, async (_event, { workspaceName, oldName, newName }: { workspaceName: string; oldName: string; newName: string }) => {
    return fileStorageManager.renameCollection(workspaceName, oldName, newName);
  });

  // File watching - set up watcher and send events to renderer
  ipcMain.handle(FILE_STORAGE_CHANNELS.WATCH_DIRECTORY, (_event, dirPath: string) => {
    fileStorageManager.watchDirectory(dirPath, (event, filename) => {
      if (mainWindow) {
        mainWindow.webContents.send(FILE_STORAGE_CHANNELS.FILE_CHANGED, { event, filename, dirPath });
      }
    });
    return true;
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.UNWATCH_DIRECTORY, (_event, dirPath: string) => {
    fileStorageManager.unwatchDirectory(dirPath);
    return true;
  });

  // Generic data files
  ipcMain.handle(FILE_STORAGE_CHANNELS.READ_DATA_FILE, async (_event, filename: string) => {
    return fileStorageManager.readDataFile(filename);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.WRITE_DATA_FILE, async (_event, { filename, data }: { filename: string; data: unknown }) => {
    return fileStorageManager.writeDataFile(filename, data);
  });

  // Mocking data (per workspace/endpoint)
  ipcMain.handle(FILE_STORAGE_CHANNELS.READ_MOCK_REQUESTS, async (_event, { workspaceName, mockApiName, endpoint }: { workspaceName: string; mockApiName: string; endpoint: string }) => {
    return fileStorageManager.readMockRequests(workspaceName, mockApiName, endpoint);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.WRITE_MOCK_REQUESTS, async (_event, { workspaceName, mockApiName, endpoint, data }: { workspaceName: string; mockApiName: string; endpoint: string; data: unknown }) => {
    return fileStorageManager.writeMockRequests(workspaceName, mockApiName, endpoint, data);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.READ_ALL_MOCK_REQUESTS, async (_event, { workspaceName, mockApiName }: { workspaceName: string; mockApiName: string }) => {
    return fileStorageManager.readAllMockRequests(workspaceName, mockApiName);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.READ_ALL_MOCKING_DATA, async (_event, workspaceName: string) => {
    return fileStorageManager.readAllMockingData(workspaceName);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.DELETE_MOCK_API_DATA, async (_event, { workspaceName, mockApiName }: { workspaceName: string; mockApiName: string }) => {
    return fileStorageManager.deleteMockApiData(workspaceName, mockApiName);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.DELETE_MOCK_ENDPOINT_DATA, async (_event, { workspaceName, mockApiName, endpoint }: { workspaceName: string; mockApiName: string; endpoint: string }) => {
    return fileStorageManager.deleteMockEndpointData(workspaceName, mockApiName, endpoint);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.CLEAR_MOCKING_DATA, async (_event, workspaceName: string) => {
    return fileStorageManager.clearMockingData(workspaceName);
  });

  // ==================== GitHub Handlers ====================

  // Authentication
  ipcMain.handle(GITHUB_CHANNELS.AUTH_WITH_PAT, async (_event, token: string) => {
    return githubManager.authenticateWithPAT(token);
  });

  ipcMain.handle(GITHUB_CHANNELS.START_OAUTH, async () => {
    return githubManager.startOAuthFlow();
  });

  ipcMain.handle(GITHUB_CHANNELS.LOGOUT, () => {
    githubManager.logout();
    return { success: true };
  });

  ipcMain.handle(GITHUB_CHANNELS.GET_CURRENT_USER, async () => {
    return githubManager.getCurrentUser();
  });

  ipcMain.handle(GITHUB_CHANNELS.IS_AUTHENTICATED, () => {
    return githubManager.isAuthenticated();
  });

  ipcMain.handle(GITHUB_CHANNELS.SET_ACCESS_TOKEN, (_event, token: string | null) => {
    githubManager.setAccessToken(token);
    return { success: true };
  });

  // Repositories
  ipcMain.handle(GITHUB_CHANNELS.LIST_REPOS, async (_event, options?: { visibility?: string; sort?: string; per_page?: number; page?: number }) => {
    return githubManager.listRepositories(options as Parameters<typeof githubManager.listRepositories>[0]);
  });

  ipcMain.handle(GITHUB_CHANNELS.GET_REPO, async (_event, { owner, repo }: { owner: string; repo: string }) => {
    return githubManager.getRepository(owner, repo);
  });

  ipcMain.handle(GITHUB_CHANNELS.CREATE_REPO, async (_event, options: { name: string; description?: string; private?: boolean; auto_init?: boolean }) => {
    return githubManager.createRepository(options);
  });

  // Branches
  ipcMain.handle(GITHUB_CHANNELS.LIST_BRANCHES, async (_event, { owner, repo }: { owner: string; repo: string }) => {
    return githubManager.listBranches(owner, repo);
  });

  ipcMain.handle(GITHUB_CHANNELS.GET_BRANCH, async (_event, { owner, repo, branch }: { owner: string; repo: string; branch: string }) => {
    return githubManager.getBranch(owner, repo, branch);
  });

  ipcMain.handle(GITHUB_CHANNELS.CREATE_BRANCH, async (_event, { owner, repo, branchName, sourceSha }: { owner: string; repo: string; branchName: string; sourceSha: string }) => {
    return githubManager.createBranch(owner, repo, branchName, sourceSha);
  });

  // Commits
  ipcMain.handle(GITHUB_CHANNELS.LIST_COMMITS, async (_event, { owner, repo, options }: { owner: string; repo: string; options?: { sha?: string; path?: string; per_page?: number; page?: number } }) => {
    return githubManager.listCommits(owner, repo, options);
  });

  ipcMain.handle(GITHUB_CHANNELS.GET_COMMIT, async (_event, { owner, repo, sha }: { owner: string; repo: string; sha: string }) => {
    return githubManager.getCommit(owner, repo, sha);
  });

  // Contents
  ipcMain.handle(GITHUB_CHANNELS.GET_CONTENTS, async (_event, { owner, repo, path, ref }: { owner: string; repo: string; path: string; ref?: string }) => {
    return githubManager.getContents(owner, repo, path, ref);
  });

  ipcMain.handle(GITHUB_CHANNELS.CREATE_OR_UPDATE_FILE, async (_event, { owner, repo, path, options }: { owner: string; repo: string; path: string; options: { message: string; content: string; sha?: string; branch?: string } }) => {
    return githubManager.createOrUpdateFile(owner, repo, path, options);
  });

  ipcMain.handle(GITHUB_CHANNELS.DELETE_FILE, async (_event, { owner, repo, path, options }: { owner: string; repo: string; path: string; options: { message: string; sha: string; branch?: string } }) => {
    return githubManager.deleteFile(owner, repo, path, options);
  });

  // Comparison
  ipcMain.handle(GITHUB_CHANNELS.COMPARE_COMMITS, async (_event, { owner, repo, base, head }: { owner: string; repo: string; base: string; head: string }) => {
    return githubManager.compareCommits(owner, repo, base, head);
  });

  // Batch operations
  ipcMain.handle(GITHUB_CHANNELS.PUSH_CHANGES, async (_event, { owner, repo, branch, message, changes }: { owner: string; repo: string; branch: string; message: string; changes: GitHubFileChange[] }) => {
    return githubManager.pushChanges(owner, repo, branch, message, changes);
  });

  ipcMain.handle(GITHUB_CHANNELS.PULL_LATEST, async (_event, { owner, repo, branch }: { owner: string; repo: string; branch: string }) => {
    return githubManager.pullLatest(owner, repo, branch);
  });
}

// App ready
app.whenReady().then(async () => {
  setupIpcHandlers();
  
  // Initialize file storage before creating window
  await fileStorageManager.initialize();
  
  createWindow();
  setupMenu(mainWindow);
  
  if (!isDev) {
    setupUpdater(mainWindow);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up file watchers before quitting
app.on('before-quit', () => {
  fileStorageManager.unwatchAll();
});

// Security: Prevent new window creation
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.origin !== 'http://localhost:5173' && !navigationUrl.startsWith('file://')) {
      event.preventDefault();
    }
  });
});
