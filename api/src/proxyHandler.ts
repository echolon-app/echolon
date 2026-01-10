import { Request, Response } from 'express';
import https from 'https';
import http from 'http';
import zlib from 'zlib';
import { URL } from 'url';
import { WSManager } from './wsManager';
import { mockStore } from './mockStore';
import { StoredMock } from './types';

export class ProxyHandler {
  private wsManager: WSManager;

  constructor(wsManager: WSManager) {
    this.wsManager = wsManager;
  }

  async handleRequest(req: Request, res: Response, namespace: string): Promise<void> {
    const method = req.method;
    const path = req.path;

    console.log(`[Proxy] ${method} ${namespace}.echolon.app${path}`);

    // Build request details for notification
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        headers[key] = value;
      } else if (Array.isArray(value)) {
        headers[key] = value.join(', ');
      }
    }
    delete headers['host'];
    delete headers['connection'];
    delete headers['content-length'];

    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') {
        query[key] = value;
      }
    }

    let body: string | undefined;
    if (req.body) {
      if (typeof req.body === 'string') {
        body = req.body;
      } else if (Buffer.isBuffer(req.body)) {
        body = req.body.toString('utf-8');
      } else {
        body = JSON.stringify(req.body);
      }
    }

    // Notify connected client about the request (for request list)
    if (this.wsManager.isNamespaceConnected(namespace)) {
      this.wsManager.notifyRequest(namespace, {
        method,
        path,
        headers,
        query,
        body,
      });
    }

    // Check if there's a mock for this route
    const mock = mockStore.findMock(namespace, method, path);
    
    if (mock) {
      console.log(`[Proxy] Serving mocked response for ${method} ${path}`);
      return this.serveMockedResponse(res, mock, namespace, method, path);
    }

    // No mock - check if we should forward to an endpoint
    const client = this.wsManager.getClient(namespace);
    if (client?.forwardTo) {
      console.log(`[Proxy] Forwarding ${method} ${path} to ${client.forwardTo}`);
      return this.forwardRequest(req, res, namespace, client.forwardTo, {
        method,
        path,
        headers,
        query,
        body,
      });
    }

    // No mock and no forwardTo - return 404
    console.log(`[Proxy] No mock found for ${method} ${path} - returning 404`);
    res.status(404).json({
      error: 'Not Found',
      message: `No mock configured for ${method} ${path}`,
      namespace,
      hint: 'Create a mock for this route in the Echolon app, or configure a forward endpoint.',
    });
  }

  /**
   * Forward request to the configured endpoint
   */
  private async forwardRequest(
    req: Request,
    res: Response,
    namespace: string,
    forwardTo: string,
    requestDetails: {
      method: string;
      path: string;
      headers: Record<string, string>;
      query: Record<string, string>;
      body?: string;
    }
  ): Promise<void> {
    return new Promise((resolve) => {
      try {
        // Build the target URL
        const targetUrl = new URL(requestDetails.path, forwardTo);
        
        // Add query parameters
        for (const [key, value] of Object.entries(requestDetails.query)) {
          targetUrl.searchParams.append(key, value);
        }

        const isHttps = targetUrl.protocol === 'https:';
        const httpModule = isHttps ? https : http;

        // Remove accept-encoding to get uncompressed response
        // This avoids issues with gzip/deflate responses
        const forwardHeaders = { ...requestDetails.headers };
        delete forwardHeaders['accept-encoding'];
        
        const options: http.RequestOptions = {
          hostname: targetUrl.hostname,
          port: targetUrl.port || (isHttps ? 443 : 80),
          path: targetUrl.pathname + targetUrl.search,
          method: requestDetails.method,
          headers: {
            ...forwardHeaders,
            'host': targetUrl.host,
            // Allow compressed responses - we'll decompress them
            'accept-encoding': 'gzip, deflate',
          },
        };

        console.log(`[Proxy] Forwarding to: ${targetUrl.toString()}`);

        const proxyReq = httpModule.request(options, (proxyRes) => {
          const chunks: Buffer[] = [];

          proxyRes.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });

          proxyRes.on('end', async () => {
            try {
              // Concatenate all chunks into a single buffer
              const buffer = Buffer.concat(chunks);
              
              // Check content-encoding and decompress if needed
              const contentEncoding = proxyRes.headers['content-encoding'];
              let decompressedBuffer: Buffer;
              
              if (contentEncoding === 'gzip') {
                decompressedBuffer = zlib.gunzipSync(buffer);
              } else if (contentEncoding === 'deflate') {
                decompressedBuffer = zlib.inflateSync(buffer);
              } else if (contentEncoding === 'br') {
                decompressedBuffer = zlib.brotliDecompressSync(buffer);
              } else {
                decompressedBuffer = buffer;
              }
              
              // Convert to string for text responses
              const responseBody = decompressedBuffer.toString('utf-8');

              // Build response headers
              const responseHeaders: Record<string, string> = {};
              for (const [key, value] of Object.entries(proxyRes.headers)) {
                if (typeof value === 'string') {
                  responseHeaders[key] = value;
                } else if (Array.isArray(value)) {
                  responseHeaders[key] = value.join(', ');
                }
              }

              // Notify client about the response (man-in-the-middle view)
              if (this.wsManager.isNamespaceConnected(namespace)) {
                this.wsManager.notifyResponse(namespace, {
                  method: requestDetails.method,
                  path: requestDetails.path,
                  status: proxyRes.statusCode || 200,
                  statusText: proxyRes.statusMessage || 'OK',
                  headers: responseHeaders,
                  body: responseBody,
                  servedByMock: false,
                });
              }

              // Set response headers (skip hop-by-hop and encoding headers)
              const skipHeaders = ['transfer-encoding', 'connection', 'keep-alive', 'content-encoding', 'content-length'];
              for (const [key, value] of Object.entries(responseHeaders)) {
                if (!skipHeaders.includes(key.toLowerCase())) {
                  res.setHeader(key, value);
                }
              }

              // Add CORS headers
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
              res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

              // Send decompressed response
              res.status(proxyRes.statusCode || 200);
              if (responseBody) {
                res.send(responseBody);
              } else {
                res.end();
              }
              resolve();
            } catch (decompressError) {
              console.error(`[Proxy] Decompression error:`, decompressError);
              res.status(502).json({
                error: 'Bad Gateway',
                message: 'Failed to decompress response from upstream server',
                details: (decompressError as Error).message,
              });
              resolve();
            }
          });
        });

        proxyReq.on('error', (error) => {
          console.error(`[Proxy] Forward error:`, error);
          res.status(502).json({
            error: 'Bad Gateway',
            message: `Failed to forward request to ${forwardTo}`,
            details: error.message,
          });
          resolve();
        });

        // Set timeout
        proxyReq.setTimeout(30000, () => {
          proxyReq.destroy();
          res.status(504).json({
            error: 'Gateway Timeout',
            message: `Request to ${forwardTo} timed out`,
          });
          resolve();
        });

        // Send body if present
        if (requestDetails.body) {
          proxyReq.write(requestDetails.body);
        }
        proxyReq.end();

      } catch (error) {
        console.error(`[Proxy] Forward error:`, error);
        res.status(500).json({
          error: 'Internal Server Error',
          message: `Failed to forward request: ${(error as Error).message}`,
        });
        resolve();
      }
    });
  }

  /**
   * Serve a mocked response
   */
  private async serveMockedResponse(
    res: Response, 
    mock: StoredMock, 
    namespace: string, 
    method: string, 
    path: string
  ): Promise<void> {
    const { response } = mock;

    // Apply delay if configured
    if (response.delay && response.delay > 0) {
      await new Promise(resolve => setTimeout(resolve, response.delay));
    }

    // Headers to skip - encoding headers are not valid since we store decompressed content
    const skipHeaders = ['content-encoding', 'content-length', 'transfer-encoding'];

    // Set response headers (excluding encoding-related headers)
    if (response.headers) {
      for (const [key, value] of Object.entries(response.headers)) {
        if (!skipHeaders.includes(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      }
    }

    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

    // Ensure Content-Type is set
    if (!response.headers || !response.headers['content-type']) {
      res.setHeader('Content-Type', 'application/json');
    }

    // Notify client about the mocked response
    if (this.wsManager.isNamespaceConnected(namespace)) {
      this.wsManager.notifyResponse(namespace, {
        method,
        path,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers || {},
        body: response.body,
        servedByMock: true,
      });
    }

    // Send response
    res.status(response.status);
    
    if (response.body) {
      res.send(response.body);
    } else {
      res.end();
    }
  }
}
