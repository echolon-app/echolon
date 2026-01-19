import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron';
import path from 'path';
import crypto from 'crypto';
import { setupMenu } from './menu';
import { setupUpdater } from './updater';
import { makeHttpRequest, HttpRequestOptions, HttpResponseResult } from './httpRequest';
import { parseDigestChallenge, buildDigestAuthHeader, DigestChallenge, DigestAuthParams } from './digestAuth';
import { mockServerManager } from './mockServer';
import { cloudProxyManager, CloudProxyConfig, ProxyResponse, StoredMock } from './cloudProxy';
import { fileStorageManager } from './fileStorage';
import { githubManager, GitHubFileChange } from './github';
import { gitManager } from './git';
import { EchoFile, EcholonConfig, GlobalEnvironmentsFile, WorkspaceFile } from '../shared/echoFormat';
import { onUpdateAvailable } from './updater';
import { 
  APP_CHANNELS, 
  MOCK_SERVER_CHANNELS, 
  CLOUD_PROXY_CHANNELS, 
  FILE_STORAGE_CHANNELS,
  GIT_CHANNELS,
  GITHUB_CHANNELS,
  PUBLIC_SPECS_CHANNELS 
} from '../shared/ipc-channels';
import { s3UploadManager, UploadSpecOptions } from './s3Upload';

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

// Store deep link URL if app wasn't ready when received
let pendingDeepLinkUrl: string | null = null;

// Handle the protocol URL
function handleDeepLink(url: string): void {
  console.log('Deep link received:', url);
  
  // Parse the URL: echolon://action/path?query=params
  try {
    const parsed = new URL(url);
    const action = parsed.hostname; // e.g., 'import', 'open'
    const path = parsed.pathname;   // e.g., '/collection/123'
    const params = Object.fromEntries(parsed.searchParams);
    
    // Send to renderer when window is ready
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send(APP_CHANNELS.DEEP_LINK, { action, path, params, url });
    } else {
      // Store for later if window isn't ready
      pendingDeepLinkUrl = url;
    }
  } catch (err) {
    console.error('Failed to parse deep link:', err);
  }
}

// macOS: Handle open-url event (must be registered before app is ready)
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// Windows/Linux: Handle second-instance for single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    // Someone tried to run a second instance, focus our window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    
    // Handle the protocol URL (Windows passes it in argv)
    const url = commandLine.find(arg => arg.startsWith('echolon://'));
    if (url) {
      handleDeepLink(url);
    }
  });
}

function createWindow(): void {
  // Get icon path - use resources folder for packaged app, core/assets for dev
  console.log('isDev', isDev);
  const iconPath = isDev ? path.join(__dirname, '../../assets/app-icon/logo@512.png')
    : path.join(__dirname, '../../assets/app-icon/logo@512.png');
  //console.log('iconPath', iconPath);

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
      devTools: true, // REMOVE LATER
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
      app.dock.setIcon(path.join(__dirname, '../../assets/app-icon/logo@512.png'))
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
  forwardTo?: string;  // optional URL to forward unmocked requests to
}

// Setup IPC handlers
function setupIpcHandlers(): void {
  // HTTP Request handler - bypasses CORS
  ipcMain.handle(APP_CHANNELS.MAKE_HTTP_REQUEST, async (_event, options: HttpRequestOptions): Promise<HttpResponseResult> => {
    return makeHttpRequest(options);
  });

  // Compute Digest Auth header
  ipcMain.handle(APP_CHANNELS.COMPUTE_DIGEST_AUTH, async (_event, options: {
    wwwAuthHeader: string;
    username: string;
    password: string;
    method: string;
    uri: string;
  }): Promise<{ success: boolean; header?: string; error?: string; challenge?: DigestChallenge }> => {
    try {
      const challenge = parseDigestChallenge(options.wwwAuthHeader);
      if (!challenge) {
        return { success: false, error: 'Invalid WWW-Authenticate header' };
      }

      const params: DigestAuthParams = {
        username: options.username,
        password: options.password,
        method: options.method,
        uri: options.uri,
        challenge,
      };

      const header = buildDigestAuthHeader(params);
      return { success: true, header, challenge };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get app version
  ipcMain.handle(APP_CHANNELS.GET_APP_VERSION, () => {
    return app.getVersion();
  });

  // Open external URL in default browser/app
  ipcMain.handle(APP_CHANNELS.OPEN_EXTERNAL, async (_event, url: string) => {
    await shell.openExternal(url);
  });

  // Execute script - runs in main process to bypass CSP restrictions
  ipcMain.handle(APP_CHANNELS.EXECUTE_SCRIPT, async (_event, options: {
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
    // Now mutable to allow script modifications
    const resData = context.response ? { ...context.response } : null;
    
    // Try to parse body as JSON so users can modify it directly (e.g., res.body.field = value)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsedBody: any = null;
    let bodyIsJson = false;
    if (resData?.body) {
      try {
        parsedBody = JSON.parse(resData.body);
        bodyIsJson = typeof parsedBody === 'object' && parsedBody !== null;
      } catch {
        // Not valid JSON, keep as string
        parsedBody = resData.body;
      }
    }
    
    const res = resData ? {
      get status() { return resData.status; },
      set status(val: number) { resData.status = val; },
      get statusText() { return resData.statusText; },
      set statusText(val: string) { resData.statusText = val; },
      get headers() { return resData.headers; },
      set headers(val: Record<string, string>) { resData.headers = val; },
      // Return parsed JSON object if body was JSON, otherwise return string
      get body() { return bodyIsJson ? parsedBody : resData.body; },
      set body(val: string | Record<string, unknown>) { 
        if (typeof val === 'object' && val !== null) {
          parsedBody = val;
          bodyIsJson = true;
        } else {
          parsedBody = val;
          bodyIsJson = false;
        }
      },
      get responseTime() { return resData.responseTime; },
      // Getter methods
      getStatus: () => resData.status,
      getStatusText: () => resData.statusText,
      getHeaders: () => ({ ...resData.headers }),
      getHeader: (name: string) => {
        const lowerName = name.toLowerCase();
        const key = Object.keys(resData.headers).find(k => k.toLowerCase() === lowerName);
        return key ? resData.headers[key] : undefined;
      },
      getBody: () => bodyIsJson ? parsedBody : resData.body,
      getResponseTime: () => resData.responseTime,
      // Setter methods
      setHeader: (name: string, value: string) => { resData.headers[name] = value; },
      setBody: (val: string | Record<string, unknown>) => {
        if (typeof val === 'object' && val !== null) {
          parsedBody = val;
          bodyIsJson = true;
        } else {
          parsedBody = val;
          bodyIsJson = false;
        }
      },
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

      // Stringify the body if it was parsed as JSON
      const finalBody = bodyIsJson && parsedBody !== null 
        ? JSON.stringify(parsedBody, null, 2) 
        : (parsedBody as string) || resData?.body || '';

      return {
        logs,
        duration: Date.now() - startTime,
        envVars: updatedEnvVars,
        runtimeVars: updatedRuntimeVars,
        // Return modified response data if available
        modifiedResponse: resData ? {
          status: resData.status,
          statusText: resData.statusText,
          headers: resData.headers,
          body: finalBody,
          responseTime: resData.responseTime,
        } : undefined,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      
      logs.push({
        type: 'error',
        args: [`Script Error: ${errorMessage}${errorStack ? `\n${errorStack}` : ''}`],
        timestamp: Date.now(),
      });

      // Stringify the body if it was parsed as JSON
      const finalBody = bodyIsJson && parsedBody !== null 
        ? JSON.stringify(parsedBody, null, 2) 
        : (parsedBody as string) || resData?.body || '';

      return {
        logs,
        error: errorMessage,
        duration: Date.now() - startTime,
        envVars: updatedEnvVars,
        runtimeVars: updatedRuntimeVars,
        // Still return modified response even on error (partial modifications may have been made)
        modifiedResponse: resData ? {
          status: resData.status,
          statusText: resData.statusText,
          headers: resData.headers,
          body: finalBody,
          responseTime: resData.responseTime,
        } : undefined,
      };
    }
  });

  // Fetch URL content - for spec import, bypasses CORS
  ipcMain.handle(APP_CHANNELS.FETCH_URL_CONTENT, async (_event, url: string) => {
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

  // Restart app
  ipcMain.handle(APP_CHANNELS.RESTART_APP, () => {
    if (app.isPackaged) {
      // Production: full app relaunch
      app.relaunch();
      app.quit();
    } else {
      // Development: just reload the window (relaunch doesn't work well with dev server)
      const focusedWindow = BrowserWindow.getFocusedWindow();
      if (focusedWindow) {
        focusedWindow.reload();
      } else {
        // Fallback: reload all windows
        BrowserWindow.getAllWindows().forEach(win => win.reload());
      }
    }
  });

  // Toggle DevTools
  ipcMain.handle(APP_CHANNELS.TOGGLE_DEV_TOOLS, () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const targetWindow = focusedWindow || mainWindow;
    
    if (targetWindow) {
      if (targetWindow.webContents.isDevToolsOpened()) {
        targetWindow.webContents.closeDevTools();
      } else {
        // Use detached mode on Windows/Linux for reliability
        if (process.platform === 'darwin') {
          targetWindow.webContents.openDevTools();
        } else {
          targetWindow.webContents.openDevTools({ mode: 'detach' });
        }
      }
    }
  });

  // Wipe all data - deletes all files in echolon directory
  ipcMain.handle(APP_CHANNELS.WIPE_ALL_DATA, async () => {
    try {
      const echolonPath = fileStorageManager.getEcholonPath();
      const fs = await import('fs/promises');
      const path = await import('path');
      
      // Read directory contents
      const entries = await fs.readdir(echolonPath ?? '', { withFileTypes: true });
      
      // Delete each entry recursively
      for (const entry of entries) {
        const fullPath = path.join(echolonPath ?? '', entry.name);
        if (entry.isDirectory()) {
          await fs.rm(fullPath, { recursive: true, force: true });
        } else {
          await fs.unlink(fullPath);
        }
      }
      
      return { success: true };
    } catch (error) {
      console.error('[Main] Failed to wipe data:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  });

  // Mock Server handlers
  ipcMain.handle(MOCK_SERVER_CHANNELS.START_MOCK_SERVER, async (_event, config: MockServerConfig): Promise<{ success: boolean; error?: string }> => {
    return mockServerManager.startServer(config);
  });

  ipcMain.handle(MOCK_SERVER_CHANNELS.STOP_MOCK_SERVER, async (_event, id: string): Promise<boolean> => {
    return mockServerManager.stopServer(id);
  });

  ipcMain.handle(MOCK_SERVER_CHANNELS.GET_MOCK_SERVER_STATUS, (_event, id: string): boolean => {
    return mockServerManager.isServerRunning(id);
  });

  ipcMain.handle(MOCK_SERVER_CHANNELS.UPDATE_MOCK_ROUTES, (_event, { id, routes }: { id: string; routes: MockServerConfig['routes'] }): void => {
    mockServerManager.updateRoutes(id, routes);
  });

  ipcMain.handle(MOCK_SERVER_CHANNELS.GET_LOCAL_HOSTNAME, async (): Promise<string> => {
    return await  mockServerManager.getLocalHostname();
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

  // OpenAPI export
  ipcMain.handle(FILE_STORAGE_CHANNELS.WRITE_COLLECTION_OPENAPI, async (_event, { workspaceName, collectionId, openapiJson, version }: { workspaceName: string; collectionId: string; openapiJson: string; version?: string }) => {
    return fileStorageManager.writeCollectionOpenAPI(workspaceName, collectionId, openapiJson, version);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.READ_COLLECTION_OPENAPI, async (_event, { workspaceName, collectionId, version }: { workspaceName: string; collectionId: string; version?: string }) => {
    return fileStorageManager.readCollectionOpenAPI(workspaceName, collectionId, version);
  });

  // Request History (per workspace)
  ipcMain.handle(FILE_STORAGE_CHANNELS.READ_HISTORY, async (_event, workspaceName: string) => {
    return fileStorageManager.readHistory(workspaceName);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.WRITE_HISTORY, async (_event, { workspaceName, data }: { workspaceName: string; data: unknown }) => {
    return fileStorageManager.writeHistory(workspaceName, data);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.CLEAR_HISTORY, async (_event, workspaceName: string) => {
    return fileStorageManager.clearHistory(workspaceName);
  });

  // Workspace data files (workspace-specific state like sync states, pending changes)
  ipcMain.handle(FILE_STORAGE_CHANNELS.READ_WORKSPACE_DATA_FILE, async (_event, { workspaceName, filename }: { workspaceName: string; filename: string }) => {
    return fileStorageManager.readWorkspaceDataFile(workspaceName, filename);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.WRITE_WORKSPACE_DATA_FILE, async (_event, { workspaceName, filename, data }: { workspaceName: string; filename: string; data: unknown }) => {
    return fileStorageManager.writeWorkspaceDataFile(workspaceName, filename, data);
  });

  ipcMain.handle(FILE_STORAGE_CHANNELS.DELETE_WORKSPACE_DATA_FILE, async (_event, { workspaceName, filename }: { workspaceName: string; filename: string }) => {
    return fileStorageManager.deleteWorkspaceDataFile(workspaceName, filename);
  });

  // ==================== Git Handlers ====================

  // Repository operations
  ipcMain.handle(GIT_CHANNELS.INIT, async (_event, dir: string) => {
    return gitManager.init(dir);
  });

  ipcMain.handle(GIT_CHANNELS.IS_REPO, async (_event, dir: string) => {
    return gitManager.isRepo(dir);
  });

  ipcMain.handle(GIT_CHANNELS.CLONE, async (_event, { url, dir, branch }: { url: string; dir: string; branch?: string }) => {
    return gitManager.clone(url, dir, branch);
  });

  // Status
  ipcMain.handle(GIT_CHANNELS.STATUS, async (_event, dir: string) => {
    return gitManager.status(dir);
  });

  // Staging
  ipcMain.handle(GIT_CHANNELS.ADD, async (_event, { dir, filepath }: { dir: string; filepath: string }) => {
    return gitManager.add(dir, filepath);
  });

  ipcMain.handle(GIT_CHANNELS.ADD_ALL, async (_event, dir: string) => {
    return gitManager.addAll(dir);
  });

  ipcMain.handle(GIT_CHANNELS.UNSTAGE, async (_event, { dir, filepath }: { dir: string; filepath: string }) => {
    return gitManager.unstage(dir, filepath);
  });

  ipcMain.handle(GIT_CHANNELS.DISCARD_CHANGES, async (_event, { dir, filepath }: { dir: string; filepath: string }) => {
    return gitManager.discardChanges(dir, filepath);
  });

  // Commits
  ipcMain.handle(GIT_CHANNELS.COMMIT, async (_event, { dir, message, author }: { dir: string; message: string; author: { name: string; email: string } }) => {
    return gitManager.commit(dir, message, author);
  });

  ipcMain.handle(GIT_CHANNELS.LOG, async (_event, { dir, depth }: { dir: string; depth?: number }) => {
    return gitManager.log(dir, depth);
  });

  // Branches
  ipcMain.handle(GIT_CHANNELS.LIST_BRANCHES, async (_event, dir: string) => {
    return gitManager.listBranches(dir);
  });

  ipcMain.handle(GIT_CHANNELS.CURRENT_BRANCH, async (_event, dir: string) => {
    return gitManager.currentBranch(dir);
  });

  ipcMain.handle(GIT_CHANNELS.CREATE_BRANCH, async (_event, { dir, name, checkout }: { dir: string; name: string; checkout?: boolean }) => {
    return gitManager.createBranch(dir, name, checkout);
  });

  ipcMain.handle(GIT_CHANNELS.CHECKOUT, async (_event, { dir, ref }: { dir: string; ref: string }) => {
    return gitManager.checkout(dir, ref);
  });

  ipcMain.handle(GIT_CHANNELS.DELETE_BRANCH, async (_event, { dir, name }: { dir: string; name: string }) => {
    return gitManager.deleteBranch(dir, name);
  });

  // Remotes
  ipcMain.handle(GIT_CHANNELS.LIST_REMOTES, async (_event, dir: string) => {
    return gitManager.listRemotes(dir);
  });

  ipcMain.handle(GIT_CHANNELS.ADD_REMOTE, async (_event, { dir, name, url }: { dir: string; name: string; url: string }) => {
    return gitManager.addRemote(dir, name, url);
  });

  ipcMain.handle(GIT_CHANNELS.REMOVE_REMOTE, async (_event, { dir, name }: { dir: string; name: string }) => {
    return gitManager.removeRemote(dir, name);
  });

  // Sync
  ipcMain.handle(GIT_CHANNELS.PUSH, async (_event, { dir, remote, branch }: { dir: string; remote?: string; branch?: string }) => {
    return gitManager.push(dir, remote, branch);
  });

  ipcMain.handle(GIT_CHANNELS.PULL, async (_event, { dir, remote, branch, author }: { dir: string; remote?: string; branch?: string; author?: { name: string; email: string } }) => {
    return gitManager.pull(dir, remote, branch, author);
  });

  ipcMain.handle(GIT_CHANNELS.FETCH, async (_event, { dir, remote, branch }: { dir: string; remote?: string; branch?: string }) => {
    return gitManager.fetch(dir, remote, branch);
  });

  // Credentials
  ipcMain.handle(GIT_CHANNELS.SET_CREDENTIALS, (_event, credentials: { username: string; password: string } | null) => {
    gitManager.setCredentials(credentials);
    return { success: true };
  });

  // Utils
  ipcMain.handle(GIT_CHANNELS.CREATE_GITIGNORE, async (_event, dir: string) => {
    return gitManager.createGitignore(dir);
  });

  ipcMain.handle(GIT_CHANNELS.GET_FILE_FOR_DIFF, async (_event, { dir, filepath }: { dir: string; filepath: string }) => {
    return gitManager.getFileForDiff(dir, filepath);
  });

  // ==================== GitHub Handlers ====================

  // Authentication
  ipcMain.handle(GITHUB_CHANNELS.AUTH_WITH_PAT, async (_event, token: string) => {
    const result = await githubManager.authenticateWithPAT(token);
    // Also set git credentials for isomorphic-git operations
    if (result.success && result.data) {
      gitManager.setCredentials({
        username: result.data.login,
        password: token,
      });
    }
    return result;
  });

  ipcMain.handle(GITHUB_CHANNELS.START_OAUTH, async () => {
    return githubManager.startOAuthFlow();
  });

  ipcMain.handle(GITHUB_CHANNELS.LOGOUT, () => {
    githubManager.logout();
    // Also clear git credentials
    gitManager.setCredentials(null);
    return { success: true };
  });

  ipcMain.handle(GITHUB_CHANNELS.GET_CURRENT_USER, async () => {
    return githubManager.getCurrentUser();
  });

  ipcMain.handle(GITHUB_CHANNELS.IS_AUTHENTICATED, () => {
    return githubManager.isAuthenticated();
  });

  ipcMain.handle(GITHUB_CHANNELS.SET_ACCESS_TOKEN, async (_event, token: string | null) => {
    githubManager.setAccessToken(token);
    // Also sync git credentials for isomorphic-git operations
    if (token) {
      // Get the username from the current user (token is being restored)
      const userResult = await githubManager.getCurrentUser();
      if (userResult.success && userResult.data) {
        gitManager.setCredentials({
          username: userResult.data.login,
          password: token,
        });
      }
    } else {
      gitManager.setCredentials(null);
    }
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

  // Setup git for a workspace when linking to GitHub
  ipcMain.handle(GITHUB_CHANNELS.SETUP_WORKSPACE_GIT, async (_event, { workspaceName, owner, repo }: { workspaceName: string; owner: string; repo: string }) => {
    try {
      const workspacePath = fileStorageManager.getWorkspacePath(workspaceName);
      
      // Initialize git if not already a repo
      const isRepo = await gitManager.isRepo(workspacePath);
      if (!isRepo) {
        const initResult = await gitManager.init(workspacePath);
        if (!initResult.success) {
          return { success: false, error: initResult.error || 'Failed to initialize git repository' };
        }
        // Create .gitignore
        await gitManager.createGitignore(workspacePath);
      }
      
      // Check if origin remote already exists
      const remotesResult = await gitManager.listRemotes(workspacePath);
      if (remotesResult.success && remotesResult.remotes) {
        const hasOrigin = remotesResult.remotes.some(r => r.name === 'origin');
        if (hasOrigin) {
          // Remove existing origin to set the new one
          await gitManager.removeRemote(workspacePath, 'origin');
        }
      }
      
      // Add the origin remote
      const remoteUrl = `https://github.com/${owner}/${repo}.git`;
      const addRemoteResult = await gitManager.addRemote(workspacePath, 'origin', remoteUrl);
      if (!addRemoteResult.success) {
        return { success: false, error: addRemoteResult.error || 'Failed to add remote' };
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to setup git for workspace' };
    }
  });

  // ==================== Public Specs Handlers ====================

  ipcMain.handle(PUBLIC_SPECS_CHANNELS.CHECK_SUBDOMAIN, async (_event, { subdomain, userId }: { subdomain: string; userId?: string }) => {
    return s3UploadManager.checkSubdomainAvailability(subdomain, userId);
  });

  ipcMain.handle(PUBLIC_SPECS_CHANNELS.UPLOAD_SPEC, async (_event, options: UploadSpecOptions) => {
    return s3UploadManager.uploadSpec(options);
  });

  ipcMain.handle(PUBLIC_SPECS_CHANNELS.GET_VERSIONS, async (_event, subdomain: string) => {
    return s3UploadManager.getVersions(subdomain);
  });

  ipcMain.handle(PUBLIC_SPECS_CHANNELS.DELETE_VERSION, async (_event, { subdomain, version }: { subdomain: string; version: string }) => {
    return s3UploadManager.deleteVersion(subdomain, version);
  });

  ipcMain.handle(PUBLIC_SPECS_CHANNELS.DELETE_ROOT_FILES, async (_event, subdomain: string) => {
    return s3UploadManager.deleteRootFiles(subdomain);
  });

  ipcMain.handle(PUBLIC_SPECS_CHANNELS.GET_MANIFEST, async (_event, subdomain: string) => {
    return s3UploadManager.getManifest(subdomain);
  });

  ipcMain.handle(PUBLIC_SPECS_CHANNELS.UPDATE_MANIFEST, async (_event, manifest: Parameters<typeof s3UploadManager.updateManifest>[0]) => {
    return s3UploadManager.updateManifest(manifest);
  });
}

// App ready
app.whenReady().then(async () => {
  checkAppLocation();
  setupIpcHandlers();
  
  // Register as default protocol handler for echolon://
  // This is needed for development; in production, electron-builder handles it
  if (isDev) {
    app.setAsDefaultProtocolClient('echolon');
  }
  
  // Initialize file storage before creating window
  await fileStorageManager.initialize();
  
  createWindow();
  setupMenu(mainWindow);
  
  // Handle any pending deep link URL after window is ready
  if (pendingDeepLinkUrl && mainWindow) {
    // Wait for renderer to be ready
    mainWindow.webContents.once('did-finish-load', () => {
      if (pendingDeepLinkUrl) {
        handleDeepLink(pendingDeepLinkUrl);
        pendingDeepLinkUrl = null;
      }
    });
  }
  
  // Setup auto-updater (always register handlers, but only auto-check in production)
  const config = await fileStorageManager.readConfig();
  setupUpdater(mainWindow, {
    // Only auto-check in production, and respect user setting
    autoCheckUpdates: !isDev && (config?.settings?.autoCheckUpdates ?? true),
    //autoCheckUpdates: true
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  setTimeout(() => {
  /*onUpdateAvailable(mainWindow, {
    version: '1.0.2',
    releaseNotes: 'Initial release',
    releaseDate: new Date().toISOString(),
    releaseName: '1.0.2',
    files: [],
    path: '',
    sha512: '',
  });*/
  }, 5000);


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

function checkAppLocation(): void {
  // Only check on macOS and in production
  if (process.platform !== 'darwin' || !app.isPackaged) {
    return;
  }

  const appPath = app.getAppPath();
  const isInApplications = appPath.startsWith('/Applications/');
  const isTranslocated = appPath.includes('/AppTranslocation/');
  
  if (!isInApplications || isTranslocated) {
    dialog.showMessageBox({
      type: 'warning',
      title: 'Move to Applications',
      message: 'Echolon is not in your Applications folder',
      detail: 'For the best experience (including automatic updates), please move Echolon to your Applications folder.\n\nWould you like to open the Applications folder now?',
      buttons: ['Open Applications Folder', 'Continue Anyway'],
      defaultId: 0,
      cancelId: 1,
    }).then((result) => {
      if (result.response === 0) {
        shell.openPath('/Applications');
      }
    });
  }
}