import http, { IncomingMessage, ServerResponse } from 'http';
import https from 'https';
import zlib from 'zlib';
import { BrowserWindow } from 'electron';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { execFile } from 'node:child_process'


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

class MockServerManager {
  private servers: Map<string, http.Server> = new Map();
  private configs: Map<string, MockServerConfig> = new Map();
  private mainWindow: BrowserWindow | null = null;

  setMainWindow(window: BrowserWindow | null) {
    this.mainWindow = window;
  }

  getLocalHostname(): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('scutil', ['--get', 'LocalHostName'], (err, stdout) => {
        if (err) return reject(err)
        const name = stdout.trim()
        resolve(name ? `${name}.local` : '')
      })
    })
  }

  getLocalHostnameBonjour(): string {
    // Get the computer name and format it as a .local hostname
    // macOS uses Bonjour/mDNS which resolves computerName.local
    const hostname = os.hostname();
    console.log('hostname::', hostname);
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

  async startServer(config: MockServerConfig): Promise<{ success: boolean; error?: string }> {
    // Stop existing server if running
    if (this.servers.has(config.id)) {
      await this.stopServer(config.id);
    }

    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        this.handleRequest(config.id, req, res);
      });

      server.on('error', (err: NodeJS.ErrnoException) => {
        console.error(`Mock server error for ${config.id}:`, err);
        let errorMessage = err.message;
        if (err.code === 'EADDRINUSE') {
          errorMessage = `Port ${config.port} is already in use. Try a different port.`;
        } else if (err.code === 'EACCES') {
          errorMessage = `Permission denied for port ${config.port}. Try a port above 1024.`;
        }
        resolve({ success: false, error: errorMessage });
      });

      server.listen(config.port, '0.0.0.0', () => {
        console.log(`Mock server ${config.id} started on port ${config.port}`);
        this.servers.set(config.id, server);
        this.configs.set(config.id, config);
        resolve({ success: true });
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
      responseBody = mock.body;
      
      // Use mock headers but fix content-length to match actual body
      if (mock.headers.length > 0) {
        // Filter out content-length and transfer-encoding, we'll set correct content-length
        responseHeaders = mock.headers.filter(h => {
          const lowerKey = h.key.toLowerCase();
          return lowerKey !== 'content-length' && lowerKey !== 'transfer-encoding';
        });
        // Add correct content-length for the actual body
        responseHeaders.push({ key: 'Content-Length', value: String(Buffer.byteLength(responseBody, 'utf8')) });
      }
    } else if (config.forwardTo) {
      // Forward to real API if configured
      try {
        const forwardedResponse = await this.forwardRequest(
          config.forwardTo,
          req.method || 'GET',
          path,
          queryParams,
          headers,
          body
        );
        responseStatus = forwardedResponse.status;
        responseStatusText = forwardedResponse.statusText;
        responseHeaders = forwardedResponse.headers;
        responseBody = forwardedResponse.body;
      } catch (error) {
        console.error('[MockServer] Failed to forward request:', error);
        responseStatus = 502;
        responseStatusText = 'Bad Gateway';
        responseBody = JSON.stringify({ 
          error: 'Failed to forward request', 
          message: (error as Error).message,
          timestamp: new Date().toISOString(),
        });
      }
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

  private async forwardRequest(
    forwardTo: string,
    method: string,
    path: string,
    queryParams: Record<string, string>,
    headers: Array<{ key: string; value: string }>,
    body?: string
  ): Promise<{
    status: number;
    statusText: string;
    headers: Array<{ key: string; value: string }>;
    body: string;
  }> {
    const targetUrl = new URL(path, forwardTo);
    
    // Add query parameters
    for (const [key, value] of Object.entries(queryParams)) {
      targetUrl.searchParams.set(key, value);
    }

    return new Promise((resolve, reject) => {
      const isHttps = targetUrl.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      // Build headers object, excluding host (we'll set the target host)
      const reqHeaders: Record<string, string> = {};
      for (const h of headers) {
        if (h.key.toLowerCase() !== 'host') {
          reqHeaders[h.key] = h.value;
        }
      }
      reqHeaders['host'] = targetUrl.host;

      const options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: method,
        headers: reqHeaders,
      };

      console.log(`[MockServer] Forwarding ${method} ${path} to ${targetUrl.toString()}`);

      const req = httpModule.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => {
          chunks.push(Buffer.from(chunk));
        });
        res.on('end', async () => {
          const responseHeaders: Array<{ key: string; value: string }> = [];
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') {
              responseHeaders.push({ key, value });
            } else if (Array.isArray(value)) {
              responseHeaders.push({ key, value: value.join(', ') });
            }
          }

          // Combine all chunks into a single buffer
          const rawBody = Buffer.concat(chunks);
          
          // Check content-encoding and decompress if needed
          const contentEncoding = (res.headers['content-encoding'] || '').toLowerCase().trim();
          let responseBody: string;
          let wasDecompressed = false;
          
          console.log(`[MockServer] Response content-encoding: "${contentEncoding}", body size: ${rawBody.length} bytes`);
          
          try {
            if (contentEncoding === 'gzip' || contentEncoding === 'x-gzip') {
              console.log('[MockServer] Decompressing gzip response...');
              const decompressed = zlib.gunzipSync(rawBody);
              responseBody = decompressed.toString('utf-8');
              wasDecompressed = true;
              console.log(`[MockServer] Decompressed to ${responseBody.length} chars`);
            } else if (contentEncoding === 'deflate') {
              console.log('[MockServer] Decompressing deflate response...');
              // Try raw deflate first, then zlib-wrapped deflate
              try {
                const decompressed = zlib.inflateRawSync(rawBody);
                responseBody = decompressed.toString('utf-8');
              } catch {
                const decompressed = zlib.inflateSync(rawBody);
                responseBody = decompressed.toString('utf-8');
              }
              wasDecompressed = true;
              console.log(`[MockServer] Decompressed to ${responseBody.length} chars`);
            } else if (contentEncoding === 'br') {
              console.log('[MockServer] Decompressing brotli response...');
              const decompressed = zlib.brotliDecompressSync(rawBody);
              responseBody = decompressed.toString('utf-8');
              wasDecompressed = true;
              console.log(`[MockServer] Decompressed to ${responseBody.length} chars`);
            } else {
              responseBody = rawBody.toString('utf-8');
            }
          } catch (decompressError) {
            console.error('[MockServer] Failed to decompress response:', decompressError);
            // Fall back to raw string if decompression fails
            responseBody = rawBody.toString('utf-8');
          }

          // If we decompressed the body, remove content-encoding and update content-length
          // Otherwise the browser will try to decompress already-decompressed data
          let finalHeaders = responseHeaders;
          if (wasDecompressed) {
            finalHeaders = responseHeaders.filter(h => {
              const lowerKey = h.key.toLowerCase();
              return lowerKey !== 'content-encoding' && lowerKey !== 'content-length' && lowerKey !== 'transfer-encoding';
            });
            // Add correct content-length for the decompressed body
            finalHeaders.push({ key: 'content-length', value: String(Buffer.byteLength(responseBody, 'utf-8')) });
          }

          resolve({
            status: res.statusCode || 500,
            statusText: res.statusMessage || 'Unknown',
            headers: finalHeaders,
            body: responseBody,
          });
        });
      });

      req.on('error', (error) => {
        console.error('[MockServer] Forward request error:', error);
        reject(error);
      });
      
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (body) {
        req.write(body);
      }
      req.end();
    });
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

