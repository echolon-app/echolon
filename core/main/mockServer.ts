import http, { IncomingMessage, ServerResponse } from 'http';
import { BrowserWindow } from 'electron';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

// IPC channel constant (duplicated here to avoid cross-rootDir import issues)
const IPC_CHANNELS = {
  MOCK_REQUEST_RECEIVED: 'mock-request-received',
} as const;

interface MockRoute {
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
}

interface MockServerConfig {
  id: string;
  port: number;
  routes: MockRoute[];
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

class MockServerManager {
  private servers: Map<string, http.Server> = new Map();
  private configs: Map<string, MockServerConfig> = new Map();
  private mainWindow: BrowserWindow | null = null;

  setMainWindow(window: BrowserWindow | null) {
    this.mainWindow = window;
  }

  getLocalHostname(): string {
    // Get the computer name and format it as a .local hostname
    // macOS uses Bonjour/mDNS which resolves computerName.local
    const hostname = os.hostname();
    //console.log('hostname::', hostname);
    //console.log(os.)
    return hostname.toLowerCase();
    
    // If it already ends with .local, return as-is
    if (hostname.toLowerCase().endsWith('.local')) {
      return hostname.toLowerCase();
    }
  
    // Otherwise, format it as hostname.local
    // Remove any existing domain suffix and clean up the name
    const cleanHostname = hostname
      .split('.')[0]  // Take just the first part if there's a domain
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')  // Replace invalid chars with hyphens
      .replace(/-+/g, '-')  // Collapse multiple hyphens
      .replace(/^-|-$/g, '');  // Remove leading/trailing hyphens
    
    return `${cleanHostname}`;
  }

  async startServer(config: MockServerConfig): Promise<boolean> {
    // Stop existing server if running
    if (this.servers.has(config.id)) {
      await this.stopServer(config.id);
    }

    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        this.handleRequest(config.id, req, res);
      });

      server.on('error', (err) => {
        console.error(`Mock server error for ${config.id}:`, err);
        resolve(false);
      });

      server.listen(config.port, '0.0.0.0', () => {
        console.log(`Mock server ${config.id} started on port ${config.port}`);
        this.servers.set(config.id, server);
        this.configs.set(config.id, config);
        resolve(true);
      });
    });
  }

  async stopServer(id: string): Promise<boolean> {
    const server = this.servers.get(id);
    if (!server) return true;

    return new Promise((resolve) => {
      server.close((err) => {
        if (err) {
          console.error(`Error stopping mock server ${id}:`, err);
          resolve(false);
        } else {
          console.log(`Mock server ${id} stopped`);
          this.servers.delete(id);
          this.configs.delete(id);
          resolve(true);
        }
      });
    });
  }

  isServerRunning(id: string): boolean {
    return this.servers.has(id);
  }

  updateRoutes(id: string, routes: MockRoute[]): void {
    const config = this.configs.get(id);
    if (config) {
      config.routes = routes;
      this.configs.set(id, config);
    }
  }

  private async handleRequest(mockApiId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const startTime = Date.now();
    const config = this.configs.get(mockApiId);
    
    // Add CORS headers for all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    
    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    
    if (!config) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Mock server not configured' }));
      return;
    }

    // Parse URL and extract path and query params
    const url = new URL(req.url || '/', `http://localhost:${config.port}`);
    const path = url.pathname;
    const queryParams: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      queryParams[key] = value;
    });

    // Parse headers
    const headers: Array<{ key: string; value: string }> = [];
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        headers.push({ key, value });
      } else if (Array.isArray(value)) {
        value.forEach(v => headers.push({ key, value: v }));
      }
    }

    // Read body
    let body = '';
    await new Promise<void>((resolve) => {
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', resolve);
    });

    // Find matching route
    const route = this.findMatchingRoute(config.routes, req.method || 'GET', path);

    // Create captured request
    const capturedRequest: CapturedRequest = {
      id: uuidv4(),
      mockApiId,
      method: (req.method || 'GET') as string,
      path,
      url: req.url || '/',
      headers,
      queryParams,
      body: body || undefined,
      timestamp: Date.now(),
      isMocked: route?.isMocked || false,
    };

    // Handle response
    let responseStatus = 200;
    let responseStatusText = 'OK';
    let responseHeaders: Array<{ key: string; value: string }> = [
      { key: 'Content-Type', value: 'application/json' },
      { key: 'Access-Control-Allow-Origin', value: '*' },
      { key: 'Access-Control-Allow-Methods', value: '*' },
      { key: 'Access-Control-Allow-Headers', value: '*' },
    ];
    let responseBody = JSON.stringify({ 
      message: 'No mock configured for this endpoint',
      method: req.method,
      path,
      timestamp: new Date().toISOString(),
    });

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    if (route?.isMocked && route.mockedResponse) {
      const mock = route.mockedResponse;
      
      // Apply delay if configured
      if (mock.delay && mock.delay > 0) {
        await new Promise(resolve => setTimeout(resolve, mock.delay));
      }

      responseStatus = mock.status;
      responseStatusText = mock.statusText;
      responseHeaders = mock.headers.length > 0 ? mock.headers : responseHeaders;
      responseBody = mock.body;
    }

    // Send response
    const headersObj: Record<string, string> = {};
    responseHeaders.forEach(h => {
      headersObj[h.key] = h.value;
    });
    
    res.writeHead(responseStatus, responseStatusText, headersObj);
    res.end(responseBody);

    // Add response to captured request
    capturedRequest.response = {
      status: responseStatus,
      statusText: responseStatusText,
      headers: responseHeaders,
      body: responseBody,
      duration: Date.now() - startTime,
    };

    // Send captured request to renderer
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_CHANNELS.MOCK_REQUEST_RECEIVED, capturedRequest);
    }
  }

  private findMatchingRoute(routes: MockRoute[], method: string, path: string): MockRoute | undefined {
    return routes.find(route => {
      if (route.method !== method) return false;
      
      // Exact match
      if (route.path === path) return true;
      
      // Pattern match with :param
      const routeParts = route.path.split('/');
      const pathParts = path.split('/');
      
      if (routeParts.length !== pathParts.length) return false;
      
      return routeParts.every((part, i) => {
        if (part.startsWith(':')) return true; // Wildcard param
        return part === pathParts[i];
      });
    });
  }
}

export const mockServerManager = new MockServerManager();
export default mockServerManager;

