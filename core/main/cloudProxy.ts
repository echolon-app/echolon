import WebSocket from 'ws';
import { BrowserWindow } from 'electron';
import https from 'https';
import http from 'http';
import { URL } from 'url';

// IPC channel constants
export const CLOUD_PROXY_CHANNELS = {
  CONNECT: 'cloud-proxy-connect',
  DISCONNECT: 'cloud-proxy-disconnect',
  STATUS: 'cloud-proxy-status',
  STATUS_CHANGED: 'cloud-proxy-status-changed',
  REQUEST_RECEIVED: 'cloud-proxy-request-received',
  FORWARDED_RESPONSE: 'cloud-proxy-forwarded-response',
  SEND_RESPONSE: 'cloud-proxy-send-response',
  CHECK_NAMESPACE: 'cloud-proxy-check-namespace',
  // Mock management
  FETCH_MOCKS: 'cloud-proxy-fetch-mocks',
  UPLOAD_MOCK: 'cloud-proxy-upload-mock',
  DELETE_MOCK: 'cloud-proxy-delete-mock',
  SYNC_MOCKS: 'cloud-proxy-sync-mocks',
} as const;

// Types
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface CloudProxyConfig {
  serverUrl: string;
  namespace: string;
  userId: string;
  forwardTo?: string;
}

export interface ProxyRequest {
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body?: string;
}

export interface ProxyResponse {
  id: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body?: string;
}

// Mock stored on proxy server
export interface StoredMock {
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

interface IncomingMessage {
  type: string;
  id?: string;
  [key: string]: any;
}

class CloudProxyManager {
  private ws: WebSocket | null = null;
  private mainWindow: BrowserWindow | null = null;
  private config: CloudProxyConfig | null = null;
  private status: ConnectionStatus = 'disconnected';
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getConfig(): CloudProxyConfig | null {
    return this.config;
  }

  async connect(config: CloudProxyConfig): Promise<{ success: boolean; error?: string }> {
    // Disconnect existing connection
    this.disconnect();
    console.log('[CloudProxy] Will connect to server:', config.serverUrl);

    this.config = config;
    this.setStatus('connecting');

    return new Promise((resolve) => {
      try {
        const wsUrl = config.serverUrl.replace(/^http/, 'ws') + '/ws';
        console.log(`[CloudProxy] Connecting to ${wsUrl}`);

        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
          console.log('[CloudProxy] Connected, registering namespace...');
          this.register();
        });

        this.ws.on('message', (data: Buffer) => {
          try {
            const message: IncomingMessage = JSON.parse(data.toString());
            this.handleMessage(message, resolve);
          } catch (error) {
            console.error('[CloudProxy] Failed to parse message:', error);
          }
        });

        this.ws.on('close', () => {
          console.log('[CloudProxy] Connection closed');
          this.handleDisconnect();
        });

        this.ws.on('error', (error) => {
          console.error('[CloudProxy] WebSocket error:', error);
          this.setStatus('error');
          resolve({ success: false, error: error.message });
        });

        // Timeout for initial connection
        setTimeout(() => {
          if (this.status === 'connecting') {
            this.disconnect();
            resolve({ success: false, error: 'Connection timeout' });
          }
        }, 10000);

      } catch (error) {
        console.error('[CloudProxy] Failed to connect:', error);
        this.setStatus('error');
        resolve({ success: false, error: (error as Error).message });
      }
    });
  }

  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.config = null;
    this.setStatus('disconnected');
  }

  private register(): void {
    if (!this.ws || !this.config) return;

    const message = {
      type: 'register',
      namespace: this.config.namespace,
      userId: this.config.userId,
      forwardTo: this.config.forwardTo,
    };

    console.log(`[CloudProxy] Registering namespace: ${this.config.namespace} with userId: ${this.config.userId}`);
    this.ws.send(JSON.stringify(message));
  }

  private handleMessage(message: IncomingMessage, connectResolve?: (result: { success: boolean; error?: string }) => void): void {
    switch (message.type) {
      case 'status':
        if (message.connected && message.namespace) {
          console.log(`[CloudProxy] Registered as ${message.namespace}.echolon.app`);
          this.setStatus('connected');
          this.startPingInterval();
          connectResolve?.({ success: true });
        } else if (!message.connected) {
          this.setStatus('disconnected');
        }
        break;

      case 'error':
        console.error('[CloudProxy] Server error:', message.message);
        connectResolve?.({ success: false, error: message.message });
        break;

      case 'request':
        this.handleIncomingRequest(message as unknown as ProxyRequest);
        break;

      case 'forwardedResponse':
        this.handleForwardedResponse(message);
        break;

      case 'ping':
        this.sendPong();
        break;
    }
  }

  private handleForwardedResponse(message: IncomingMessage): void {
    const source = message.servedByMock ? 'mocked' : 'forwarded';
    console.log(`[CloudProxy] Received ${source} response: ${message.status} ${message.statusText}`);

    // Send to renderer so it can update the captured request with the response
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(CLOUD_PROXY_CHANNELS.FORWARDED_RESPONSE, {
        method: message.method,
        path: message.path,
        status: message.status,
        statusText: message.statusText,
        headers: message.headers,
        body: message.body,
        timestamp: message.timestamp || Date.now(),
        servedByMock: message.servedByMock || false,
      });
    }
  }

  private async handleIncomingRequest(request: ProxyRequest): Promise<void> {
    console.log(`[CloudProxy] Received request: ${request.method} ${request.path}`);

    // Send request to renderer for interception/modification
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(CLOUD_PROXY_CHANNELS.REQUEST_RECEIVED, request);
    }

    // If forwardTo is configured, automatically forward the request
    if (this.config?.forwardTo) {
      try {
        const response = await this.forwardRequest(request);
        this.sendResponse(response);
      } catch (error) {
        console.error('[CloudProxy] Failed to forward request:', error);
        this.sendResponse({
          id: request.id,
          status: 502,
          statusText: 'Bad Gateway',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Failed to forward request', message: (error as Error).message }),
        });
      }
    }
    // Otherwise, wait for renderer to send response via IPC
  }

  private async forwardRequest(request: ProxyRequest): Promise<ProxyResponse> {
    if (!this.config?.forwardTo) {
      throw new Error('No forward URL configured');
    }

    const targetUrl = new URL(request.path, this.config.forwardTo);
    
    // Add query parameters
    for (const [key, value] of Object.entries(request.query || {})) {
      targetUrl.searchParams.set(key, value);
    }

    return new Promise((resolve, reject) => {
      const isHttps = targetUrl.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: request.method,
        headers: {
          ...request.headers,
          host: targetUrl.host,
        },
      };

      const req = httpModule.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') {
              headers[key] = value;
            } else if (Array.isArray(value)) {
              headers[key] = value.join(', ');
            }
          }

          resolve({
            id: request.id,
            status: res.statusCode || 500,
            statusText: res.statusMessage || 'Unknown',
            headers,
            body,
          });
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (request.body) {
        req.write(request.body);
      }
      req.end();
    });
  }

  sendResponse(response: ProxyResponse): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[CloudProxy] Cannot send response: not connected');
      return;
    }

    const message = {
      type: 'response',
      ...response,
    };

    this.ws.send(JSON.stringify(message));
    console.log(`[CloudProxy] Sent response for request ${response.id}: ${response.status}`);
  }

  private sendPong(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'pong' }));
    }
  }

  private startPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    // Send pong periodically to keep connection alive
    this.pingInterval = setInterval(() => {
      this.sendPong();
    }, 25000);
  }

  private handleDisconnect(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    this.ws = null;
    
    // Only set to disconnected if we weren't already in error state
    if (this.status !== 'error') {
      this.setStatus('disconnected');
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      console.log(`[CloudProxy] Status changed: ${status}`);

      // Notify renderer of status change
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(CLOUD_PROXY_CHANNELS.STATUS_CHANGED, {
          status,
          namespace: this.config?.namespace,
          serverUrl: this.config?.serverUrl,
        });
      }
    }
  }

  async checkNamespace(serverUrl: string, namespace: string): Promise<{ available: boolean; connected: boolean }> {
    return new Promise((resolve) => {
      const url = `${serverUrl}/_internal/check/${namespace}`;
      const isHttps = url.startsWith('https');
      const httpModule = isHttps ? https : http;

      httpModule.get(url, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve({ available: data.available, connected: data.connected });
          } catch {
            resolve({ available: true, connected: false });
          }
        });
      }).on('error', () => {
        resolve({ available: true, connected: false });
      });
    });
  }

  // ============== Mock Management ==============

  /**
   * Fetch all mocks from the proxy server for a namespace
   */
  async fetchMocks(serverUrl: string, namespace: string): Promise<{ success: boolean; mocks: StoredMock[]; error?: string }> {
    return new Promise((resolve) => {
      const url = `${serverUrl}/_internal/mocks/${namespace}`;
      const isHttps = url.startsWith('https');
      const httpModule = isHttps ? https : http;

      console.log(`[CloudProxy] Fetching mocks from ${url}`);

      httpModule.get(url, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            console.log(`[CloudProxy] Fetched ${data.mocks?.length || 0} mocks`);
            resolve({ success: true, mocks: data.mocks || [] });
          } catch (error) {
            console.error('[CloudProxy] Failed to parse mocks response:', error);
            resolve({ success: false, mocks: [], error: 'Failed to parse response' });
          }
        });
      }).on('error', (error) => {
        console.error('[CloudProxy] Failed to fetch mocks:', error);
        resolve({ success: false, mocks: [], error: error.message });
      });
    });
  }

  /**
   * Upload/sync all mocks to the proxy server
   */
  async syncMocks(serverUrl: string, namespace: string, mocks: StoredMock[]): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const url = `${serverUrl}/_internal/mocks/${namespace}`;
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const postData = JSON.stringify({ mocks });

      console.log(`[CloudProxy] Syncing ${mocks.length} mocks to ${url}`);

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = httpModule.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.success) {
              console.log(`[CloudProxy] Successfully synced ${mocks.length} mocks`);
              resolve({ success: true });
            } else {
              resolve({ success: false, error: data.error || 'Unknown error' });
            }
          } catch (error) {
            resolve({ success: false, error: 'Failed to parse response' });
          }
        });
      });

      req.on('error', (error) => {
        console.error('[CloudProxy] Failed to sync mocks:', error);
        resolve({ success: false, error: error.message });
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Upload a single mock to the proxy server
   */
  async uploadMock(serverUrl: string, namespace: string, mock: StoredMock): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const url = `${serverUrl}/_internal/mocks/${namespace}`;
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const postData = JSON.stringify(mock);

      console.log(`[CloudProxy] Uploading mock ${mock.id} to ${url}`);

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = httpModule.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.success) {
              console.log(`[CloudProxy] Successfully uploaded mock ${mock.id}`);
              resolve({ success: true });
            } else {
              resolve({ success: false, error: data.error || 'Unknown error' });
            }
          } catch (error) {
            resolve({ success: false, error: 'Failed to parse response' });
          }
        });
      });

      req.on('error', (error) => {
        console.error('[CloudProxy] Failed to upload mock:', error);
        resolve({ success: false, error: error.message });
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Delete a mock from the proxy server
   */
  async deleteMock(serverUrl: string, namespace: string, mockId: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const url = `${serverUrl}/_internal/mocks/${namespace}/${mockId}`;
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      console.log(`[CloudProxy] Deleting mock ${mockId} from ${url}`);

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname,
        method: 'DELETE',
      };

      const req = httpModule.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.success) {
              console.log(`[CloudProxy] Successfully deleted mock ${mockId}`);
              resolve({ success: true });
            } else {
              resolve({ success: false, error: data.error || 'Unknown error' });
            }
          } catch (error) {
            resolve({ success: false, error: 'Failed to parse response' });
          }
        });
      });

      req.on('error', (error) => {
        console.error('[CloudProxy] Failed to delete mock:', error);
        resolve({ success: false, error: error.message });
      });

      req.end();
    });
  }
}

export const cloudProxyManager = new CloudProxyManager();
export default cloudProxyManager;

