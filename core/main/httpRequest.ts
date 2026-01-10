import https from 'https';
import http from 'http';
import { URL, URLSearchParams } from 'url';
import zlib from 'zlib';
import { app } from 'electron';

export interface HttpRequestOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
  timeout?: number;
  sendUserAgent?: boolean; // Whether to send User-Agent header (default: true)
}

export interface ResponseTiming {
  prepare: number;
  socketInit: number;
  dnsLookup: number;
  tcpHandshake: number;
  sslHandshake: number;
  ttfb: number;
  download: number;
  process: number;
  total: number;
}

export interface SizeBreakdown {
  headers: number;
  body: number;
  uncompressed?: number;
  total: number;
}

export interface NetworkInfo {
  httpVersion: string;
  localAddress?: string;
  remoteAddress?: string;
  tlsProtocol?: string;
  cipherName?: string;
  certificateCN?: string;
  issuerCN?: string;
  validUntil?: string;
}

export interface HttpResponseResult {
  success: boolean;
  status?: number;
  statusText?: string;
  headers?: Array<{ key: string; value: string }>;
  body?: string;
  bodyBase64?: string; // Base64-encoded body for binary content (images, videos, PDFs, etc.)
  size?: number;
  duration: number;
  timing?: ResponseTiming;
  sizeBreakdown?: SizeBreakdown;
  requestSize?: SizeBreakdown;
  networkInfo?: NetworkInfo;
  error?: string;
  errorCode?: string;
}

export async function makeHttpRequest(options: HttpRequestOptions): Promise<HttpResponseResult> {
  const startTime = performance.now();
  const { method, url, headers = {}, body, timeout = 30000, sendUserAgent = true } = options;

  // Timing markers
  const timings = {
    start: startTime,
    socketAssigned: 0,
    dnsLookup: 0,
    tcpConnected: 0,
    tlsHandshake: 0,
    firstByte: 0,
    downloadComplete: 0,
    processingComplete: 0,
  };

  // Network info
  const networkData: {
    localAddress?: string;
    remoteAddress?: string;
    tlsProtocol?: string;
    cipherName?: string;
    certificateCN?: string;
    issuerCN?: string;
    validUntil?: string;
  } = {};

  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      // Mark end of prepare phase
      const prepareEnd = performance.now();

      console.log('MAKE_REQ:', method+":"+parsedUrl.toString());

      // Build headers, conditionally including User-Agent
      const requestHeaders: Record<string, string> = {
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        ...headers,
      };
      
      // Add User-Agent header if enabled (and not already set by user)
      if (sendUserAgent && !headers['User-Agent'] && !headers['user-agent']) {
        requestHeaders['User-Agent'] = `Echolon/${app.getVersion()}`;
      }

      const requestOptions: https.RequestOptions = {
        method,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        headers: requestHeaders,
        timeout,
        rejectUnauthorized: false, // Allow self-signed certificates for testing
      };

      const req = transport.request(requestOptions, (res) => {
        // Mark time to first byte
        timings.firstByte = performance.now();
        
        const chunks: Buffer[] = [];
        const encoding = res.headers['content-encoding'];

        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          timings.downloadComplete = performance.now();
          const buffer = Buffer.concat(chunks);

          // Decompress if needed
          let bodyBuffer: Buffer = buffer;
          try {
            // Normalize encoding to lowercase string (header can be string | string[] | undefined)
            const normalizedEncoding = Array.isArray(encoding) 
              ? encoding[0]?.toLowerCase() 
              : encoding?.toLowerCase();
            
            if (normalizedEncoding === 'gzip') {
              bodyBuffer = Buffer.from(zlib.gunzipSync(buffer));
            } else if (normalizedEncoding === 'deflate') {
              // Try inflateSync first, fall back to inflateRawSync for raw deflate
              try {
                bodyBuffer = Buffer.from(zlib.inflateSync(buffer));
              } catch {
                bodyBuffer = Buffer.from(zlib.inflateRawSync(buffer));
              }
            } else if (normalizedEncoding === 'br') {
              bodyBuffer = Buffer.from(zlib.brotliDecompressSync(buffer));
            }
          } catch (decompressError) {
            // If decompression fails, use raw buffer
            console.warn('Decompression failed:', decompressError);
            bodyBuffer = buffer;
          }

          timings.processingComplete = performance.now();

          // Determine content type from headers
          const contentTypeHeader = res.headers['content-type'] || '';
          const contentTypeLower = contentTypeHeader.toLowerCase();
          
          // Check if content is binary (images, videos, PDFs, audio, etc.)
          const isBinaryContent = 
            contentTypeLower.startsWith('image/') ||
            contentTypeLower.startsWith('video/') ||
            contentTypeLower.startsWith('audio/') ||
            contentTypeLower.includes('application/pdf') ||
            contentTypeLower.includes('application/octet-stream') ||
            contentTypeLower.includes('application/zip') ||
            contentTypeLower.includes('application/gzip') ||
            contentTypeLower.includes('font/') ||
            contentTypeLower.includes('application/font') ||
            contentTypeLower.includes('application/vnd.ms-') ||
            contentTypeLower.includes('application/vnd.openxmlformats');
          
          // For binary content, use base64 encoding; for text, use UTF-8
          let bodyText: string | undefined;
          let bodyBase64: string | undefined;
          
          if (isBinaryContent) {
            bodyBase64 = bodyBuffer.toString('base64');
            bodyText = `[Binary content: ${contentTypeHeader}]`;
          } else {
            bodyText = bodyBuffer.toString('utf-8');
          }

          const responseHeaders: Array<{ key: string; value: string }> = [];
          
          // Convert headers to array format
          for (const [key, value] of Object.entries(res.headers)) {
            if (Array.isArray(value)) {
              value.forEach(v => responseHeaders.push({ key, value: v }));
            } else if (value !== undefined) {
              responseHeaders.push({ key, value });
            }
          }

          const duration = Math.round(timings.processingComplete - startTime);
          
          // Calculate timing breakdown
          const timing: ResponseTiming = {
            prepare: Math.round((prepareEnd - startTime) * 100) / 100,
            socketInit: Math.round((timings.socketAssigned > 0 ? timings.socketAssigned - prepareEnd : 0) * 100) / 100,
            dnsLookup: Math.round((timings.dnsLookup > 0 && timings.socketAssigned > 0 ? timings.dnsLookup - timings.socketAssigned : 0) * 100) / 100,
            tcpHandshake: Math.round((timings.tcpConnected > 0 && timings.dnsLookup > 0 ? timings.tcpConnected - timings.dnsLookup : 
                          timings.tcpConnected > 0 && timings.socketAssigned > 0 ? timings.tcpConnected - timings.socketAssigned : 0) * 100) / 100,
            sslHandshake: Math.round((isHttps && timings.tlsHandshake > 0 && timings.tcpConnected > 0 ? timings.tlsHandshake - timings.tcpConnected : 0) * 100) / 100,
            ttfb: Math.round((timings.firstByte > 0 ? timings.firstByte - (isHttps && timings.tlsHandshake > 0 ? timings.tlsHandshake : timings.tcpConnected > 0 ? timings.tcpConnected : prepareEnd) : 0) * 100) / 100,
            download: Math.round((timings.downloadComplete - timings.firstByte) * 100) / 100,
            process: Math.round((timings.processingComplete - timings.downloadComplete) * 100) / 100,
            total: duration,
          };

          // Calculate response size breakdown
          const responseHeadersSize = responseHeaders.reduce((acc, h) => 
            acc + Buffer.byteLength(h.key, 'utf-8') + Buffer.byteLength(h.value, 'utf-8') + 4, // 4 for ": " and "\r\n"
            0
          );
          const compressedBodySize = buffer.length;
          const uncompressedBodySize = bodyBuffer.length;
          
          const sizeBreakdown: SizeBreakdown = {
            headers: responseHeadersSize,
            body: compressedBodySize,
            uncompressed: encoding ? uncompressedBodySize : undefined,
            total: responseHeadersSize + compressedBodySize,
          };

          // Calculate request size breakdown
          const requestHeadersObj = requestOptions.headers as Record<string, string>;
          const requestHeadersSize = Object.entries(requestHeadersObj).reduce((acc, [key, value]) =>
            acc + Buffer.byteLength(key, 'utf-8') + Buffer.byteLength(String(value), 'utf-8') + 4,
            0
          );
          const requestBodySize = body ? Buffer.byteLength(body, 'utf-8') : 0;
          
          const requestSize: SizeBreakdown = {
            headers: requestHeadersSize,
            body: requestBodySize,
            total: requestHeadersSize + requestBodySize,
          };

          // Build network info
          const networkInfo: NetworkInfo = {
            httpVersion: res.httpVersion,
            localAddress: networkData.localAddress,
            remoteAddress: networkData.remoteAddress,
            tlsProtocol: networkData.tlsProtocol,
            cipherName: networkData.cipherName,
            certificateCN: networkData.certificateCN,
            issuerCN: networkData.issuerCN,
            validUntil: networkData.validUntil,
          };

          console.log('Response',res.statusCode, res.statusMessage);

          resolve({
            success: true,
            status: res.statusCode,
            statusText: res.statusMessage || '',
            headers: responseHeaders,
            body: bodyText,
            bodyBase64,
            size: bodyBuffer.length,
            duration,
            timing,
            sizeBreakdown,
            requestSize,
            networkInfo,
          });
        });

        res.on('error', (error) => {
          resolve({
            success: false,
            duration: Date.now() - startTime,
            error: error.message,
            errorCode: (error as NodeJS.ErrnoException).code,
          });
        });
      });

      req.on('error', (error: NodeJS.ErrnoException) => {
        let errorMessage = error.message;
        
        // Provide more descriptive error messages
        switch (error.code) {
          case 'ECONNREFUSED':
            errorMessage = `Connection refused: Unable to connect to ${parsedUrl.hostname}:${parsedUrl.port || (isHttps ? 443 : 80)}`;
            break;
          case 'ENOTFOUND':
            errorMessage = `DNS lookup failed: Host "${parsedUrl.hostname}" not found`;
            break;
          case 'ETIMEDOUT':
            errorMessage = `Connection timed out after ${timeout}ms`;
            break;
          case 'ECONNRESET':
            errorMessage = 'Connection reset by server';
            break;
          case 'CERT_HAS_EXPIRED':
            errorMessage = 'SSL certificate has expired';
            break;
          case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
            errorMessage = 'Unable to verify SSL certificate';
            break;
          case 'DEPTH_ZERO_SELF_SIGNED_CERT':
            errorMessage = 'Self-signed SSL certificate detected';
            break;
        }

        resolve({
          success: false,
          duration: Date.now() - startTime,
          error: errorMessage,
          errorCode: error.code,
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          success: false,
          duration: Date.now() - startTime,
          error: `Request timed out after ${timeout}ms`,
          errorCode: 'ETIMEDOUT',
        });
      });

      // Track socket events for timing and network info
      req.on('socket', (socket) => {
        timings.socketAssigned = performance.now();
        
        // DNS lookup event (only fires if DNS lookup is needed)
        socket.on('lookup', () => {
          timings.dnsLookup = performance.now();
        });

        // TCP connection established
        socket.on('connect', () => {
          timings.tcpConnected = performance.now();
          // If no DNS lookup happened (cached or IP address), use socket time
          if (timings.dnsLookup === 0) {
            timings.dnsLookup = timings.socketAssigned;
          }
          
          // Capture socket addresses
          networkData.localAddress = socket.localAddress;
          networkData.remoteAddress = socket.remoteAddress;
        });

        // TLS handshake completed (for HTTPS only)
        socket.on('secureConnect', () => {
          timings.tlsHandshake = performance.now();
          
          // Capture TLS info from secure socket
          const tlsSocket = socket as import('tls').TLSSocket;
          if (tlsSocket.getProtocol) {
            networkData.tlsProtocol = tlsSocket.getProtocol() || undefined;
          }
          if (tlsSocket.getCipher) {
            const cipher = tlsSocket.getCipher();
            networkData.cipherName = cipher?.name;
          }
          if (tlsSocket.getPeerCertificate) {
            const cert = tlsSocket.getPeerCertificate();
            if (cert && Object.keys(cert).length > 0) {
              // Extract Common Name from subject
              networkData.certificateCN = cert.subject?.CN;
              networkData.issuerCN = cert.issuer?.CN;
              // Format valid_to date
              if (cert.valid_to) {
                networkData.validUntil = cert.valid_to;
              }
            }
          }
        });
      });

      // Send body if present
      if (body) {
        req.write(body);
      }

      req.end();
    } catch (error) {
      resolve({
        success: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        errorCode: 'UNKNOWN',
      });
    }
  });
}

