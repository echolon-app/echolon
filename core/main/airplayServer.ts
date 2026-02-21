import { BrowserWindow } from 'electron';
import http from 'http';
import crypto from 'crypto';
import plist from 'plist';
import dgram from 'dgram';
import net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { playfairDecrypt } from './fairplay';

// Polyfill crypto.getRandomValues for @noble/curves (required for Node.js)
// @noble/curves expects Web Crypto API's getRandomValues, but Node.js doesn't expose it globally
if (!crypto.getRandomValues) {
  (crypto as any).getRandomValues = function <T extends ArrayBufferView | null>(array: T): T {
    if (!array) {
      throw new Error('getRandomValues requires an array-like object');
    }
    const buffer = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    crypto.randomFillSync(buffer);
    return array;
  };
}

// Also ensure it's available globally (some libraries check globalThis.crypto)
if (typeof globalThis !== 'undefined' && !globalThis.crypto) {
  (globalThis as any).crypto = crypto;
} else if (typeof globalThis !== 'undefined' && globalThis.crypto && !globalThis.crypto.getRandomValues) {
  (globalThis.crypto as any).getRandomValues = crypto.getRandomValues;
}

// @noble/curves for X25519 support
// The package exports './ed25519.js' (with .js extension)
// Note: This is an ES module, so we must use dynamic import() instead of require()
let x25519Lib: any = null;
let x25519LibPromise: Promise<any> | null = null;

// Lazy loader function for @noble/curves (ES module)
async function loadX25519Lib(): Promise<any> {
  if (x25519Lib) {
    return x25519Lib;
  }
  
  if (!x25519LibPromise) {
    x25519LibPromise = import('@noble/curves/ed25519.js').then((module) => {
      x25519Lib = module.x25519;
      return x25519Lib;
    }).catch((err) => {
      console.error('[AirPlay] Failed to load @noble/curves:', err);
      x25519LibPromise = null; // Reset promise so we can retry
      throw err;
    });
  }
  
  return x25519LibPromise;
}

// bplist packages don't have TypeScript types
const bplistParser = require('bplist-parser');
const bplistCreator = require('bplist-creator');

type ConnectionStatus = 'idle' | 'starting' | 'pairing' | 'connected' | 'error';
type ConnectionType = 'UNKNOWN' | 'RAOP' | 'AIRPLAY' | 'BLE' | 'HLS';

interface AirPlayServerStatus {
  status: ConnectionStatus;
  pairingCode?: string;
  error?: string;
}

enum PairingStatus {
  INITIAL = 'initial',
  SETUP = 'setup',
  HANDSHAKE = 'handshake',
  FINISHED = 'finished',
}

interface PairingSession {
  status: PairingStatus;
  handshakeStarted: boolean;
  setupStatus: boolean;
  clientX25519Key?: Buffer;
  clientED25519Key?: Buffer;
  serverX25519Key?: Buffer;
  serverX25519PrivateKey?: Buffer;
  ecdh?: crypto.ECDH; // X25519 ECDH instance
  sharedSecret?: Buffer; // Computed shared secret from ECDH
}

interface ConnectionState {
  type: ConnectionType;
  socket: any;
  remoteAddress?: string;
  remotePort?: number;
  createdAt: number;
  pairingSession?: PairingSession;
}

// Debug mode flag
const DEBUG_MODE = process.env.AIRPLAY_DEBUG === '1' || process.env.AIRPLAY_DEBUG === 'true';

// Logging helper functions
// File logging for debugging
// Use process.cwd() or a fixed path since __dirname might not be available in Electron
const LOG_FILE = path.join(process.cwd(), 'airplay-debug.log');

const writeToLogFile = (level: string, message: string, ...args: any[]): void => {
  try {
    const timestamp = new Date().toISOString();
    const argsStr = args.length > 0 ? ' ' + args.map(a => {
      if (a === null) return 'null';
      if (a === undefined) return 'undefined';
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    }).join(' ') : '';
    const logLine = `[${timestamp}] [${level}] ${message}${argsStr}\n`;
    
    // Force synchronous write with error handling
    try {
      const fd = fs.openSync(LOG_FILE, 'a', 0o666);
      const buffer = Buffer.from(logLine, 'utf8');
      fs.writeSync(fd, buffer, 0, buffer.length, null);
      fs.fsyncSync(fd); // Force write to disk immediately
      fs.closeSync(fd);
    } catch (writeErr: any) {
      // Log write error to console
      console.error(`[LOG_FILE_ERROR] Failed to append to ${LOG_FILE}:`, writeErr?.message || String(writeErr));
      console.error(`[LOG_FILE_ERROR] Error code:`, writeErr?.code);
      console.error(`[LOG_FILE_ERROR] Error stack:`, writeErr?.stack);
      
      // Try to create file if it doesn't exist
      if (writeErr?.code === 'ENOENT') {
        try {
          fs.writeFileSync(LOG_FILE, logLine, { encoding: 'utf8', flag: 'w', mode: 0o666 });
          console.log(`[LOG_FILE] Created new log file: ${LOG_FILE}`);
        } catch (createErr) {
          console.error(`[LOG_FILE_ERROR] Failed to create log file:`, createErr);
        }
      }
    }
  } catch (err: any) {
    // Log to console as fallback, but don't throw
    try {
      console.error(`[LOG_FILE_ERROR] Outer catch - Failed to write to ${LOG_FILE}:`, err?.message || String(err));
      console.error(`[LOG_FILE_ERROR] Error code:`, err?.code);
      console.error(`[LOG_FILE_ERROR] Error stack:`, err?.stack);
    } catch {
      // Ignore if even console.error fails
    }
  }
};

// Test file logging on startup
try {
  writeToLogFile('INFO', '=== AirPlay Server Starting - File Logging Test ===');
  console.log(`[AirPlay] Log file initialized at: ${LOG_FILE}`);
} catch (err) {
  console.error(`[AirPlay] Failed to initialize log file:`, err);
}

const logDebug = (message: string, ...args: any[]): void => {
  if (DEBUG_MODE) {
    console.log(`[AirPlay:DEBUG] ${message}`, ...args);
  }
  writeToLogFile('DEBUG', message, ...args);
};

const logInfo = (message: string, ...args: any[]): void => {
  console.log(`[AirPlay:INFO] ${message}`, ...args);
  writeToLogFile('INFO', message, ...args);
};

const logError = (message: string, ...args: any[]): void => {
  console.error(`[AirPlay:ERROR] ${message}`, ...args);
  writeToLogFile('ERROR', message, ...args);
};

const logRequest = (req: http.IncomingMessage, method: string, url: string, isRTSP: boolean): void => {
  logInfo(`=== REQUEST START ===`);
  logInfo(`Method: ${method}`);
  logInfo(`URL: ${url}`);
  logInfo(`Protocol: ${isRTSP ? 'RTSP/1.0' : 'HTTP/1.1'}`);
  logInfo(`Remote: ${req.socket.remoteAddress}:${req.socket.remotePort}`);
  logInfo(`Headers:`, JSON.stringify(req.headers, null, 2));
  logDebug(`HTTP Version: ${req.httpVersion}`);
  logDebug(`Raw Headers:`, req.rawHeaders);
};

const logResponse = (res: http.ServerResponse, headers: Record<string, string>, bodySize: number, bodyPreview?: Buffer): void => {
  logInfo(`=== RESPONSE ===`);
  logInfo(`Status: ${res.statusCode} ${res.statusMessage || 'OK'}`);
  logInfo(`Headers:`, JSON.stringify(headers, null, 2));
  logInfo(`Body Size: ${bodySize} bytes`);
  if (bodyPreview) {
    logDebug(`Body Preview (hex): ${bodyPreview.toString('hex').substring(0, 200)}`);
    logDebug(`Body Preview (ascii): ${bodyPreview.toString('ascii', 0, Math.min(100, bodyPreview.length))}`);
  }
};

class AirPlayServer {
  private server: http.Server | null = null;
  private mainWindow: BrowserWindow | null = null;
  private status: ConnectionStatus = 'idle';
  private pairingCode: string | null = null;
  private bonjourService: any = null; // Will be typed when bonjour is added
  private port: number = 7000;
  private readonly portRange = [7000, 7001, 7002, 7003, 7004, 7005];
  private persistentPublicKey: Buffer | null = null; // Persistent ED25519 public key for pairing
  private persistentPrivateKey: crypto.KeyObject | null = null; // Persistent ED25519 private key for pairing
  private usePin: boolean = false; // If false, skip pair-verify for already-paired devices (like UxPlay)
  private connections: Map<string, ConnectionState> = new Map(); // Track connections by socket ID

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  async start(): Promise<{ success: boolean; error?: string; pairingCode?: string }> {
    if (this.server) {
      return { success: false, error: 'Server is already running' };
    }

    try {
      this.status = 'starting';
      this.sendStatusUpdate();

      // Generate pairing code (4 digits)
      this.pairingCode = Math.floor(1000 + Math.random() * 9000).toString();
      this.status = 'pairing';
      this.sendStatusUpdate();

      // Create HTTP server
      this.server = http.createServer((req, res) => {
        // Keep RTSP connections alive (RTSP uses persistent connections)
        // Node.js HTTP/1.0 closes by default, but RTSP needs to stay open
        if (req.headers['cseq'] && !req.headers['x-apple-session-id']) {
          // This is an RTSP request - keep connection alive
          req.socket.setKeepAlive(true);
          // Don't let Node.js auto-close the connection
          res.shouldKeepAlive = true;
        }
        
        const socketId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
        logInfo(`=== NEW CONNECTION ===`);
        logInfo(`Socket ID: ${socketId}`);
        logInfo(`Remote Address: ${req.socket.remoteAddress}`);
        logInfo(`Remote Port: ${req.socket.remotePort}`);
        logInfo(`Local Address: ${req.socket.localAddress}`);
        logInfo(`Local Port: ${req.socket.localPort}`);
        
        // Track connection
        const connState: ConnectionState = {
          type: 'UNKNOWN',
          socket: req.socket,
          remoteAddress: req.socket.remoteAddress,
          remotePort: req.socket.remotePort,
          createdAt: Date.now(),
        };
        this.connections.set(socketId, connState);
        logDebug(`Connection tracked: ${socketId}, total connections: ${this.connections.size}`);
        
        // Log connection errors
        req.socket.on('error', (err) => {
          logError(`Socket error on ${socketId}:`, err);
          this.connections.delete(socketId);
        });
        
        // Log when connection closes
        req.socket.on('close', () => {
          logInfo(`=== CONNECTION CLOSED ===`);
          logInfo(`Socket ID: ${socketId}`);
          logInfo(`Connection duration: ${Date.now() - connState.createdAt}ms`);
          logInfo(`Connection type was: ${connState.type}`);
          this.connections.delete(socketId);
          logDebug(`Connection removed: ${socketId}, remaining connections: ${this.connections.size}`);
        });
        
        this.handleRequest(req, res);
      });
      
      // Log server errors
      this.server.on('error', (err) => {
        logError(`Server error:`, err);
      });
      
      this.server.on('clientError', (err, socket) => {
        logError(`Client error:`, err);
        const socketInfo = socket as any;
        logDebug(`Client error socket: ${socketInfo.remoteAddress}:${socketInfo.remotePort}`);
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      });

      // Try to find an available port
      let portFound = false;
      let lastError: Error | null = null;

      for (const port of this.portRange) {
        try {
          await new Promise<void>((resolve, reject) => {
            this.server!.listen(port, () => {
              this.port = port;
              logInfo(`=== SERVER STARTED ===`);
              logInfo(`Port: ${port}`);
              logInfo(`Debug mode: ${DEBUG_MODE ? 'ENABLED' : 'DISABLED'}`);
              portFound = true;
              resolve();
            });
            this.server!.on('error', (err: NodeJS.ErrnoException) => {
              if (err.code === 'EADDRINUSE') {
                // Port is in use, try next one
                this.server!.close();
                reject(err);
              } else {
                // Other error, reject immediately
                reject(err);
              }
            });
          });
          break; // Successfully bound to port
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (lastError.message.includes('EADDRINUSE')) {
            // Try next port
            continue;
          } else {
            // Other error, fail immediately
            throw error;
          }
        }
      }

      if (!portFound) {
        throw new Error(`All ports ${this.portRange.join(', ')} are in use`);
      }

      // Advertise via mDNS/Bonjour
      await this.advertiseService();

      return { success: true, pairingCode: this.pairingCode };
    } catch (error) {
      // Clean up server if it was created
      if (this.server) {
        try {
          this.server.close();
        } catch {
          // Ignore cleanup errors
        }
        this.server = null;
      }
      
      this.status = 'error';
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.sendStatusUpdate({ error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  async stop(): Promise<void> {
    if (this.bonjourService) {
      try {
        this.bonjourService.stop();
        this.bonjourService = null;
      } catch (error) {
        console.error('[AirPlay] Error stopping Bonjour service:', error);
      }
    }

    if (this.server) {
      return new Promise<void>((resolve) => {
        // Remove all listeners to prevent errors
        this.server!.removeAllListeners('error');
        
        this.server!.close(() => {
          logInfo(`=== SERVER STOPPED ===`);
          logInfo(`Active connections closed: ${this.connections.size}`);
          this.connections.clear();
          this.server = null;
          this.status = 'idle';
          this.pairingCode = null;
          this.sendStatusUpdate();
          resolve();
        });
        
        // Force close if it takes too long
        setTimeout(() => {
          if (this.server) {
            this.server.removeAllListeners();
            this.server = null;
            this.status = 'idle';
            this.pairingCode = null;
            this.sendStatusUpdate();
            resolve();
          }
        }, 1000);
      });
    }
  }

  getStatus(): AirPlayServerStatus {
    return {
      status: this.status,
      pairingCode: this.pairingCode || undefined,
    };
  }

  private async advertiseService(): Promise<void> {
    try {
      // Try to use bonjour if available
      const bonjour = await import('bonjour').catch(() => null);
      
      if (bonjour) {
        const bonjourInstance = bonjour.default();
        this.bonjourService = bonjourInstance.publish({
          name: 'Echolon V8',
          type: 'airplay',
          port: this.port,
          txt: {
            deviceid: this.getDeviceId(),
            features: '0x5A7FFFF7', // String in Bonjour TXT records
            model: 'AppleTV6,2', // Match the model in server-info
            osvers: '11.0',
            srcvers: '220.68',
          },
        });
        logInfo(`=== BONJOUR SERVICE ADVERTISED ===`);
        logInfo(`Type: airplay`);
        logInfo(`Port: ${this.port}`);
        logDebug(`TXT Records:`, {
          deviceid: this.getDeviceId(),
          features: '0x5A7FFFF7',
          model: 'AppleTV6,2',
          osvers: '11.0',
          srcvers: '220.68',
        });
      } else {
        logError(`Bonjour not available, service will not be discoverable`);
      }
    } catch (error) {
      logError(`Failed to advertise service:`, error);
    }
  }

  private getDeviceId(): string {
    // Generate a consistent device ID (MAC address format)
    // In a real implementation, this should be stored persistently
    const mac = crypto.randomBytes(6);
    mac[0] = (mac[0] | 0x02) & 0xfe; // Set locally administered bit
    return mac.toString('hex').match(/.{1,2}/g)!.join(':').toUpperCase();
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url || '/';
    const method = req.method || 'GET';
    const socketId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
    console.log('AIRPLAY_REQ:', req.url, req.method, req.socket.remoteAddress, req.socket.remotePort);
    
    // Check if this is an RTSP request
    // RTSP requests can be detected by:
    // 1. X-Apple-QR header (Bluetooth LE discovery)
    // 2. URL containing RTSP/1.0
    // 3. HTTP version being RTSP/1.0 (if Node.js exposes it)
    // 4. CSeq header (RTSP always uses CSeq, HTTP/1.1 AirPlay uses X-Apple-Session-ID)
    // Note: Node.js HTTP server parses RTSP/1.0 as HTTP/1.0 or HTTP/1.1, so we need to detect by headers
    const hasXAppleQR = req.headers['x-apple-qr'] !== undefined;
    const urlHasRTSP = url.includes('RTSP/1.0');
    const httpVersionRTSP = (req as any).httpVersion === 'RTSP/1.0';
    const hasCSeq = req.headers['cseq'] !== undefined || req.headers['CSeq'] !== undefined;
    const hasXAppleSessionID = req.headers['x-apple-session-id'] !== undefined || req.headers['X-Apple-Session-ID'] !== undefined;
    
    // RTSP detection: If CSeq is present but NOT X-Apple-Session-ID, it's RTSP
    // AirPlay HTTP uses X-Apple-Session-ID, RTSP uses CSeq
    const isRTSP = hasXAppleQR || httpVersionRTSP || urlHasRTSP || (hasCSeq && !hasXAppleSessionID);

    logRequest(req, method, url, isRTSP);
    logDebug(`RTSP Detection: hasXAppleQR=${hasXAppleQR}, urlHasRTSP=${urlHasRTSP}, httpVersionRTSP=${httpVersionRTSP}, hasCSeq=${hasCSeq}, hasXAppleSessionID=${hasXAppleSessionID}, isRTSP=${isRTSP}`);

    // Update connection type based on detection
    const connState = this.connections.get(socketId);
    if (connState) {
      if (isRTSP && !req.headers['cseq'] && (url.includes('txtAirPlay') || url.includes('txtRAOP'))) {
        connState.type = 'BLE';
        logDebug(`Connection ${socketId} identified as BLE (Bluetooth LE discovery)`);
      } else if (isRTSP && req.headers['cseq']) {
        connState.type = 'RAOP';
        logDebug(`Connection ${socketId} identified as RAOP (RTSP with CSeq)`);
      } else if (req.headers['x-apple-session-id']) {
        connState.type = 'AIRPLAY';
        logDebug(`Connection ${socketId} identified as AIRPLAY (HTTP with X-Apple-Session-ID)`);
      }
    }

    // Log response errors
    res.on('error', (err) => {
      logError(`Response error for ${method} ${url} on ${socketId}:`, err);
    });

    // Log when response finishes
    res.on('finish', () => {
      logInfo(`=== RESPONSE FINISHED ===`);
      logInfo(`Method: ${method}`);
      logInfo(`URL: ${url}`);
      logInfo(`Status: ${res.statusCode}`);
      logInfo(`Socket: ${socketId}`);
      logDebug(`Response headers sent:`, res.getHeaders());
    });

    // Handle OPTIONS requests (CORS preflight)
    if (method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, User-Agent, X-Apple-*',
        'Content-Length': '0',
      });
      res.end();
      return;
    }

    // Add CORS headers to all responses (for HTTP, not RTSP)
    const corsHeaders: Record<string, string> = isRTSP ? {} : {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, User-Agent, X-Apple-*',
    };

    // Handle AirPlay protocol endpoints
    logDebug(`Routing ${method} ${url} - checking handlers...`);
    
    // Parse URL to extract path and query params
    // RTSP requests may have format: "/info?txtAirPlay&txtRAOP RTSP/1.0"
    const cleanUrl = url.split(' ')[0]; // Remove protocol version if present
    let pathname = cleanUrl.split('?')[0];
    const queryString = cleanUrl.includes('?') ? cleanUrl.split('?')[1] : '';
    const searchParams = new URLSearchParams(queryString);
    
    logDebug(`Parsed URL - pathname: ${pathname}, queryString: ${queryString}`);
    logDebug(`Search params:`, Array.from(searchParams.entries()));
    
    if (pathname === '/server-info' || pathname === '/info') {
      this.handleServerInfo(req, res, corsHeaders, isRTSP, searchParams, method).catch((err) => {
        console.error('[AirPlay] Error handling server-info:', err);
        if (isRTSP) {
          res.writeHead(500, {
            'Content-Type': 'text/plain',
          });
        } else {
          res.writeHead(500, {
            'Content-Type': 'text/plain',
            ...corsHeaders,
          });
        }
        res.end('Internal Server Error');
      });
    } else if (url.startsWith('/pair-setup')) {
      this.handlePairSetup(req, res, corsHeaders).catch((err) => {
        console.error('[AirPlay] Error handling pair-setup:', err);
        res.writeHead(500, {
          'Content-Type': 'text/plain',
          ...corsHeaders,
        });
        res.end('Internal Server Error');
      });
    } else if (url.startsWith('/pair-verify')) {
      this.handlePairVerify(req, res, corsHeaders).catch((err) => {
        console.error('[AirPlay] Error handling pair-verify:', err);
        res.writeHead(500, {
          'Content-Type': 'text/plain',
          ...corsHeaders,
        });
        res.end('Internal Server Error');
      });
    } else if (url.startsWith('/play')) {
      this.handlePlay(req, res, corsHeaders);
    } else if (pathname === '/fp-setup') {
      logInfo(`[FAIRPLAY] /fp-setup request received - calling handleFPSetup`);
      this.handleFPSetup(req, res, corsHeaders, isRTSP, method).catch((err) => {
        logError('[AirPlay] Error handling fp-setup:', err);
        if (isRTSP) {
          res.writeHead(500, {
            'Content-Type': 'text/plain',
          });
        } else {
          res.writeHead(500, {
            'Content-Type': 'text/plain',
            ...corsHeaders,
          });
        }
        res.end('Internal Server Error');
      });
    } else if (method === 'SETUP' && isRTSP) {
      // RTSP SETUP method - handles session initialization with FairPlay keys
      logInfo(`[FAIRPLAY] RTSP SETUP request received - calling handleRTSPSetup`);
      this.handleRTSPSetup(req, res, corsHeaders, isRTSP).catch((err) => {
        logError('[AirPlay] Error handling RTSP SETUP:', err);
        res.writeHead(500, {
          'Content-Type': 'text/plain',
        });
        res.end('Internal Server Error');
      });
    } else if (method === 'RECORD' && isRTSP) {
      // RTSP RECORD method - starts the streaming session
      this.handleRTSPRecord(req, res, corsHeaders, isRTSP).catch((err) => {
        logError('[AirPlay] Error handling RTSP RECORD:', err);
        res.writeHead(500, {
          'Content-Type': 'text/plain',
        });
        res.end('Internal Server Error');
      });
    } else if (method === 'POST' && pathname === '/feedback' && isRTSP) {
      // RTSP POST /feedback - client heartbeat/keepalive
      this.handleRTSPFeedback(req, res, corsHeaders, isRTSP).catch((err) => {
        logError('[AirPlay] Error handling RTSP feedback:', err);
        res.writeHead(500, {
          'Content-Type': 'text/plain',
        });
        res.end('Internal Server Error');
      });
    } else {
      logInfo(`Unhandled endpoint: ${url}`);
      res.writeHead(404, {
        'Content-Type': 'text/plain',
        ...corsHeaders,
      });
      res.end('Not Found');
    }
  }

  private async handleServerInfo(
    req: http.IncomingMessage, 
    res: http.ServerResponse, 
    corsHeaders: Record<string, string>,
    isRTSP: boolean = false,
    searchParams?: URLSearchParams,
    method?: string
  ): Promise<void> {
    // Re-detect RTSP here since we have more context
    // RTSP requests have CSeq but NOT X-Apple-Session-ID
    const hasCSeqHeader = req.headers['cseq'] !== undefined || req.headers['CSeq'] !== undefined;
    const hasXAppleSessionID = req.headers['x-apple-session-id'] !== undefined || req.headers['X-Apple-Session-ID'] !== undefined;
    const isActuallyRTSP = isRTSP || (hasCSeqHeader && !hasXAppleSessionID);
    
    logInfo(`=== HANDLING SERVER-INFO REQUEST ===`);
    logInfo(`isRTSP (initial): ${isRTSP}`);
    logInfo(`isRTSP (detected): ${isActuallyRTSP}`);
    logInfo(`hasCSeqHeader: ${hasCSeqHeader}, hasXAppleSessionID: ${hasXAppleSessionID}`);
    logInfo(`hasSearchParams: ${!!searchParams}`);
    if (searchParams) {
      logDebug(`Search params:`, Array.from(searchParams.entries()));
    }
    
    // Read request body if present (iPhone sends binary PLIST in body)
    let requestData: any = null;
    const contentType = req.headers['content-type'] || '';
    const hasContentType = contentType.includes('application/x-apple-binary-plist');
    
    if (req.headers['content-length'] && parseInt(req.headers['content-length']) > 0) {
      const body: Buffer[] = [];
      for await (const chunk of req) {
        body.push(chunk);
      }
      const requestBody = Buffer.concat(body);
      logInfo(`Request body received: ${requestBody.length} bytes`);
      logDebug(`Request body preview (hex): ${requestBody.toString('hex').substring(0, 200)}`);
      logDebug(`Request body preview (ascii): ${requestBody.toString('ascii', 0, Math.min(100, requestBody.length))}`);
      
      // Try to decode binary PLIST request
      try {
        if (requestBody.toString('ascii', 0, 8) === 'bplist00') {
          logDebug(`Detected binary PLIST format (bplist00)`);
          const parsed = bplistParser.parseBuffer(requestBody);
          requestData = parsed[0];
          logInfo(`Decoded binary PLIST request:`, JSON.stringify(requestData, null, 2));
          logDebug(`Request data keys:`, Object.keys(requestData));
        } else {
          logDebug(`Request body is not binary PLIST (first 8 bytes: ${requestBody.toString('ascii', 0, 8)})`);
        }
      } catch (err) {
        logError(`Could not decode binary PLIST request:`, err);
      }
    } else {
      logDebug(`No request body (content-length: ${req.headers['content-length']})`);
    }

    // Build server-info response matching UxPlay implementation
    const deviceId = this.getDeviceId();
    
    // Check if iPhone is requesting specific qualifiers (txtAirPlay or txtRAOP)
    // Check query params first (RTSP requests use query params), then request body, then URL
    const wantsTxtAirPlay = searchParams?.has('txtAirPlay') ||
                            requestData?.qualifier?.includes('txtAirPlay') || 
                            req.url?.includes('txtAirPlay');
    const wantsTxtRAOP = searchParams?.has('txtRAOP') ||
                         requestData?.qualifier?.includes('txtRAOP') || 
                         req.url?.includes('txtRAOP');
    
    // UxPlay's logic: if content_type exists, return early with just txtAirPlay/txtRAOP
    // UxPlay line 108-111: "if (content_type) { goto finished; }"
    // This applies even when CSeq is present - if there's a Content-Type header, return early
    // Note: Node.js HTTP headers are lowercase, so 'cseq' not 'CSeq'
    const hasCSeq = req.headers['cseq'] !== undefined || req.headers['CSeq'] !== undefined;
    logDebug(`Request analysis:`);
    logDebug(`  hasCSeq: ${hasCSeq}`);
    logDebug(`  cseq header: ${req.headers['cseq'] || req.headers['CSeq'] || 'none'}`);
    logDebug(`  hasContentType: ${hasContentType}`);
    logDebug(`  wantsTxtAirPlay: ${wantsTxtAirPlay}`);
    logDebug(`  wantsTxtRAOP: ${wantsTxtRAOP}`);
    logDebug(`  requestData?.deviceID: ${requestData?.deviceID || 'none'}`);
    logDebug(`  requestData?.qualifier: ${requestData?.qualifier ? JSON.stringify(requestData.qualifier) : 'none'}`);
    
    // Early return if Content-Type exists (UxPlay line 108-111)
    // This happens even with CSeq - if Content-Type header is present, return early
    // UxPlay logic: "if (content_type) { goto finished; }" - returns early with just txtAirPlay/txtRAOP
    // Note: UxPlay checks ONLY content_type, not whether txtAirPlay/txtRAOP were added
    if (hasContentType) {
      logInfo(`=== EARLY RETURN: Content-Type Present ===`);
      logInfo(`Returning txtAirPlay/txtRAOP-only response (has content-type header, CSeq: ${hasCSeq ? 'present' : 'absent'})`);
      
      const minimalResponse: Record<string, any> = {};
      
      // Add txtAirPlay if requested
      // Must match UxPlay's dnssd_register_airplay TXT record exactly (dnssd.c lines 377-398)
      // IMPORTANT: DNS-SD TXT records use binary format with length prefixes, NOT null-separated strings!
      // Each entry is: [1 byte length][key=value bytes]
      if (wantsTxtAirPlay) {
        // Get the same values used in full serverInfo
        const featuresStr = '0x5A7FFEE6,0x0'; // FEATURES_1,FEATURES_2 from UxPlay (with bit 27 ON for legacy pairing)
        // Generate or get persistent public key (should be same across sessions)
        if (!this.persistentPublicKey) {
          this.persistentPublicKey = crypto.randomBytes(32);
        }
        const pk = this.persistentPublicKey.toString('base64'); // Base64 encoded public key
        const pi = 'B8E5AA8E-58B1-4136-A5C6-2650298C23D2'; // Pairing identifier
        const vv = '2'; // Version
        const srcvers = '220.68'; // Source version
        const model = 'AppleTV6,2';
        const pw = 'false'; // Password required (false for no password)
        const flags = '0x4'; // Status flags
        
        // Build binary DNS-SD TXT record format (with length prefixes)
        // Format: [length byte][key=value][length byte][key=value]...
        const txtParts: Buffer[] = [];
        
        const addTxtEntry = (key: string, value: string) => {
          const entry = `${key}=${value}`;
          const entryBuffer = Buffer.from(entry, 'utf8');
          if (entryBuffer.length > 255) {
            logError(`TXT entry too long: ${entry.substring(0, 50)}... (${entryBuffer.length} bytes)`);
            return;
          }
          const lengthBuffer = Buffer.from([entryBuffer.length]);
          txtParts.push(lengthBuffer);
          txtParts.push(entryBuffer);
          logDebug(`Added TXT entry: ${entry} (${entryBuffer.length} bytes)`);
        };
        
        addTxtEntry('deviceid', deviceId);
        addTxtEntry('features', featuresStr);
        addTxtEntry('pw', pw);
        addTxtEntry('flags', flags);
        addTxtEntry('model', model);
        addTxtEntry('pk', pk);
        addTxtEntry('pi', pi);
        addTxtEntry('srcvers', srcvers);
        addTxtEntry('vv', vv);
        
        const txtBuffer = Buffer.concat(txtParts);
        minimalResponse.txtAirPlay = txtBuffer; // Keep as Buffer - bplist-creator should handle it
        logDebug(`Added txtAirPlay to early return response (${txtBuffer.length} bytes, binary DNS-SD format)`);
        
        // Verify format: first byte should be length of first entry
        if (txtBuffer.length > 0) {
          const firstEntryLength = txtBuffer[0];
          logDebug(`First TXT entry length byte: ${firstEntryLength}, actual first entry: ${txtBuffer.toString('utf8', 1, 1 + firstEntryLength)}`);
        }
      }
      
      // Add txtRAOP if requested
      // IMPORTANT: DNS-SD TXT records use binary format with length prefixes
      if (wantsTxtRAOP) {
        // Build binary DNS-SD TXT record format (with length prefixes)
        const txtParts: Buffer[] = [];
        
        const addTxtEntry = (key: string, value: string) => {
          const entry = `${key}=${value}`;
          const entryBuffer = Buffer.from(entry, 'utf8');
          if (entryBuffer.length > 255) {
            logError(`TXT entry too long: ${entry.substring(0, 50)}... (${entryBuffer.length} bytes)`);
            return;
          }
          const lengthBuffer = Buffer.from([entryBuffer.length]);
          txtParts.push(lengthBuffer);
          txtParts.push(entryBuffer);
        };
        
        addTxtEntry('ch', '2');
        addTxtEntry('cn', '0,1');
        addTxtEntry('et', '0,1');
        addTxtEntry('ek', '1');
        addTxtEntry('sv', 'false');
        addTxtEntry('da', 'true');
        addTxtEntry('sr', '44100');
        addTxtEntry('ss', '16');
        addTxtEntry('vn', '3');
        addTxtEntry('tp', 'UDP');
        addTxtEntry('vs', '220.68');
        addTxtEntry('am', 'AppleTV6,2');
        addTxtEntry('md', '0,1,2');
        
        const raopBuffer = Buffer.concat(txtParts);
        minimalResponse.txtRAOP = raopBuffer;
        logDebug(`Added txtRAOP to early return response (${raopBuffer.length} bytes, binary DNS-SD format)`);
      }
      
      // Ensure we have something to return (UxPlay would have added txtAirPlay/txtRAOP by this point)
      if (Object.keys(minimalResponse).length === 0) {
        logError(`Content-Type present but no txtAirPlay/txtRAOP to return - this should not happen`);
        // Fall through to full response instead of returning empty
      } else {
      try {
        const responseBody = bplistCreator(minimalResponse);
        logInfo(`txtAirPlay-only response created, size: ${responseBody.length} bytes`);
        logDebug(`Response starts with: ${responseBody.toString('ascii', 0, 8)}`);
          
          // Log the exact binary response for comparison with UxPlay
          logInfo(`=== EXACT BINARY RESPONSE (first 100 bytes) ===`);
          logInfo(`Hex: ${responseBody.slice(0, 100).toString('hex')}`);
          logInfo(`ASCII preview: ${responseBody.slice(0, 100).toString('ascii').replace(/[^\x20-\x7E]/g, '.')}`);
        
        // Verify the encoding
        try {
          const verify = bplistParser.parseBuffer(responseBody);
          logInfo(`✓ txtAirPlay-only response decodes correctly`);
          if (verify[0].txtAirPlay) {
              const txtData = Buffer.isBuffer(verify[0].txtAirPlay) 
                ? verify[0].txtAirPlay
                : Buffer.from(verify[0].txtAirPlay);
              
              logInfo(`=== txtAirPlay BINARY DATA ===`);
              logInfo(`Length: ${txtData.length} bytes`);
              logInfo(`Hex (first 100 bytes): ${txtData.slice(0, 100).toString('hex')}`);
              logInfo(`ASCII preview: ${txtData.slice(0, 100).toString('ascii').replace(/[^\x20-\x7E]/g, '.')}`);
              
              // Decode to show the entries
              const decodedTxt = txtData.toString('utf8');
            logDebug(`Decoded txtAirPlay content: ${decodedTxt}`);
            logDebug(`txtAirPlay length: ${decodedTxt.length}`);
              
              // Parse the DNS-SD format to show individual entries
              let offset = 0;
              const entries: string[] = [];
              while (offset < txtData.length) {
                const entryLength = txtData[offset];
                if (entryLength === 0 || offset + entryLength >= txtData.length) break;
                const entry = txtData.toString('utf8', offset + 1, offset + 1 + entryLength);
                entries.push(entry);
                logDebug(`TXT entry [${offset}]: length=${entryLength}, value="${entry}"`);
                offset += 1 + entryLength;
              }
              logInfo(`Parsed ${entries.length} TXT entries`);
          }
        } catch (verifyErr) {
          logError(`✗ txtAirPlay-only response decode failed:`, verifyErr);
        }
        
        // Add RTSP headers if this is an RTSP request
        const responseHeaders: Record<string, string> = {
          'Content-Type': 'application/x-apple-binary-plist',
          'Content-Length': responseBody.length.toString(),
        };
        
        // Add CSeq if present in request (UxPlay always includes CSeq in response)
          // Also add RTSP-specific headers
          const cseqHeader = req.headers['cseq'] || req.headers['CSeq'];
          const cseq = Array.isArray(cseqHeader) ? cseqHeader[0] : (cseqHeader || '0');
          if (hasCSeqHeader) {
          responseHeaders['CSeq'] = cseq;
          }
          
          // Set Server header based on protocol
          // Use isActuallyRTSP for accurate detection
          responseHeaders['Server'] = isActuallyRTSP ? 'AirTunes/220.68' : 'AirPlay/220.68'; // UxPlay uses AirTunes/220.68 for RTSP
          
          // Add Audio-Jack-Status for RTSP requests (UxPlay line 336)
          // This is CRITICAL - RTSP responses MUST include this header
          // UxPlay log shows this header is always present for RTSP GET /info responses
          if (isActuallyRTSP && hasCSeqHeader) {
            responseHeaders['Audio-Jack-Status'] = 'connected; type=digital';
            logDebug(`Added Audio-Jack-Status header for RTSP request`);
        }
        
        logResponse(res, responseHeaders, responseBody.length, responseBody);
          
          // For RTSP, we MUST write RTSP/1.0 status line (UxPlay line 303: http_response_init(*response, protocol, 200, "OK"))
          // Node.js HTTP server writes HTTP/1.1, so we need to write manually
          // CRITICAL: After writing manually, we need to ensure Node.js HTTP parser can handle the next request
          if (isActuallyRTSP) {
            // Write RTSP response manually to match UxPlay's behavior exactly
            const statusLine = 'RTSP/1.0 200 OK\r\n';
            const headerLines = Object.entries(responseHeaders)
              .map(([key, value]) => `${key}: ${value}`)
              .join('\r\n');
            const headerBlock = Buffer.from(`${statusLine}${headerLines}\r\n\r\n`, 'utf8');
            
            logInfo(`=== SENDING RTSP RESPONSE (matching UxPlay) ===`);
            logInfo(`Status line: RTSP/1.0 200 OK`);
            logInfo(`Body size: ${responseBody.length} bytes`);
            
            // Write response directly to socket (matching UxPlay's http_response_finish behavior)
            req.socket.write(headerBlock);
            req.socket.write(responseBody);
            
            // CRITICAL: We need to properly end the response so Node.js HTTP parser can handle next request
            // The parser is tied to the IncomingMessage/ServerResponse lifecycle
            // Mark response as finished but don't let Node.js write anything
            (res as any)._headerSent = true;
            (res as any)._hasBody = true;
            (res as any)._sent = true;
            (res as any).finished = true;
            
            if ((res as any)._writableState) {
              (res as any)._writableState.ended = true;
            }
            
            // Emit finish event
            res.emit('finish');
            
            // CRITICAL: Node.js HTTP parser won't parse next RTSP request after we bypass response handling
            // We need to manually parse RTSP requests on this socket
            // Set up raw socket parser for subsequent RTSP requests
            const socketId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
            this.setupRTSPParser(req.socket, socketId);
            
            logInfo(`RTSP response written, raw socket parser set up for next request`);
            return;
          } else {
        res.writeHead(200, responseHeaders);
        res.end(responseBody);
        return;
          }
      } catch (err) {
        logError(`Error creating txtAirPlay-only response:`, err);
        res.writeHead(500);
        res.end();
        return;
        }
      }
    }
    
    // If CSeq is present, continue to full response (iPhone expects full info even if it requested txtAirPlay)
    logInfo(`=== BUILDING FULL SERVER-INFO RESPONSE ===`);
    
    // Full server-info response matching UxPlay structure
    // Based on UxPlay's raop_handler_info implementation
    const serverInfo: Record<string, any> = {
      deviceID: deviceId, // MAC address format
      macAddress: deviceId, // UxPlay includes both deviceID and macAddress
      features: 0x5A7FFFF7, // INTEGER bitmask
      model: 'AppleTV6,2',
      protocolVersion: '1.1', // Changed from '1.0' to match UxPlay
      sourceVersion: '220.68',
      statusFlags: 68, // UxPlay uses 68, not 4! (68 = ready, 4 might mean something else)
      name: 'Echolon V8', // Server name
      pi: 'B8E5AA8E-58B1-4136-A5C6-2650298C23D2', // Pairing identifier (from UxPlay)
      vv: 2, // Version (UxPlay uses AIRPLAY_VV which is "2")
      keepAliveLowPower: 1, // UxPlay includes this
      keepAliveSendStatsAsBody: true, // UxPlay includes this
      sdk: 'AirPlay;2.0.4',
    };
    
    logDebug(`Basic server info fields set:`, Object.keys(serverInfo));
    
    // Add public key (pk) as binary data - UxPlay includes this
    // Generate a persistent public key (32 bytes for ED25519)
    // For now, use a fixed key - in production this should be persistent
    if (!this.persistentPublicKey) {
      this.persistentPublicKey = crypto.randomBytes(32);
    }
    serverInfo.pk = this.persistentPublicKey; // Buffer should work with bplist-creator
    
    // iPhone explicitly requests txtAirPlay - include it as binary data
    if (wantsTxtAirPlay) {
      logInfo(`iPhone requested txtAirPlay qualifier - including TXT record as binary data`);
      const txtRecord = [
        `deviceid=${deviceId}`,
        `features=0x5A7FFFF7`,
        `model=AppleTV6,2`,
        `osvers=11.0`,
        `srcvers=220.68`,
      ].join('\0');
      const txtBuffer = Buffer.from(txtRecord, 'utf8');
      serverInfo.txtAirPlay = txtBuffer; // Keep as Buffer
      logDebug(`txtAirPlay TXT record length: ${txtBuffer.length} bytes`);
    }
    
    if (wantsTxtRAOP) {
      logInfo(`iPhone requested txtRAOP qualifier - including RAOP TXT record`);
      // RAOP TXT record (for audio)
      const raopTxtRecord = [
        `ch=2`,
        `cn=0,1`,
        `et=0,1`,
        `ek=1`,
        `sv=false`,
        `da=true`,
        `sr=44100`,
        `ss=16`,
        `vn=3`,
        `tp=UDP`,
        `vs=220.68`,
        `am=AppleTV6,2`,
        `md=0,1,2`,
      ].join('\0');
      const raopBuffer = Buffer.from(raopTxtRecord, 'utf8');
      serverInfo.txtRAOP = raopBuffer;
      logDebug(`txtRAOP TXT record length: ${raopBuffer.length} bytes`);
    }

    // Add missing fields that iPhone expects (only if CSeq is present - full response)
    if (hasCSeq) {
      logInfo(`Adding extended fields for full response (CSeq present)`);
      
      // initialVolume: -15.0 (real number, not integer) - UxPlay line 168
      serverInfo.initialVolume = -15.0;
      logDebug(`Added initialVolume: ${serverInfo.initialVolume}`);
      
      // audioLatencies array - UxPlay lines 171-193
      // Note: outputLatencyMicros is boolean false, not integer 0 (see UxPlay line 173, 184)
      serverInfo.audioLatencies = [
        {
          type: 100,
          inputLatencyMicros: 0,
          outputLatencyMicros: false, // Boolean false, not 0!
          audioType: 'default',
        },
        {
          type: 101,
          inputLatencyMicros: 0,
          outputLatencyMicros: false, // Boolean false, not 0!
          audioType: 'default',
        },
      ];
      logDebug(`Added audioLatencies array with ${serverInfo.audioLatencies.length} entries`);
      
      // audioFormats array - UxPlay lines 195-213
      serverInfo.audioFormats = [
        {
          type: 100,
          audioInputFormats: 0x3fffffc,
          audioOutputFormats: 0x3fffffc,
        },
        {
          type: 101,
          audioInputFormats: 0x3fffffc,
          audioOutputFormats: 0x3fffffc,
        },
      ];
      logDebug(`Added audioFormats array with ${serverInfo.audioFormats.length} entries`);
      
      // displays array - UxPlay lines 215-243
      // Default display configuration (1920x1080 @ 60Hz)
      // Note: maxFPS is 30, not 60 (see UxPlay log line 404)
      // refreshRate is 0.016666666666666666 (more precise 1/60)
      serverInfo.displays = [
        {
          uuid: 'e0ff8a27-6738-3d56-8a16-cc53aacee925',
          widthPhysical: 0,
          heightPhysical: 0,
          width: 1920,
          height: 1080,
          widthPixels: 1920,
          heightPixels: 1080,
          rotation: false,
          refreshRate: 0.016666666666666666, // 60Hz as real number (1/60) - more precise
          maxFPS: 30, // UxPlay uses 30, not 60
          overscanned: false,
          features: 14,
        },
      ];
      logDebug(`Added displays array with ${serverInfo.displays.length} display(s)`);
      logDebug(`Display config: ${serverInfo.displays[0].width}x${serverInfo.displays[0].height} @ ${1/serverInfo.displays[0].refreshRate}Hz, maxFPS: ${serverInfo.displays[0].maxFPS}`);
    } else {
      logInfo(`Skipping extended fields (no CSeq - BLE discovery)`);
    }

    // Log what we're sending
    logInfo(`Server info structure prepared with ${Object.keys(serverInfo).length} fields`);
    if (DEBUG_MODE) {
      logDebug(`Server info to send:`, JSON.stringify(serverInfo, (key, value) => {
        if (Buffer.isBuffer(value)) {
          return `<Buffer ${value.length} bytes>`;
        }
        return value;
      }, 2));
    }

    // Check if iPhone wants binary PLIST response
    // RTSP requests always use binary PLIST
    const wantsBinary = isActuallyRTSP || // RTSP always uses binary plist
                        hasContentType || 
                        req.headers['accept']?.includes('binary-plist') ||
                        requestData !== null;

    let responseBody: Buffer;
    let responseContentType: string;

    if (wantsBinary) {
      // Generate binary PLIST response
      try {
        // bplist-creator should handle Buffer objects correctly
        // According to bplist-creator docs, it supports Buffer for binary data
        const plistData: Record<string, any> = { ...serverInfo };
        
        // Ensure binary fields are Buffers (not Uint8Array)
        // bplist-creator expects Buffer for binary data
        if (plistData.txtAirPlay && !Buffer.isBuffer(plistData.txtAirPlay)) {
          plistData.txtAirPlay = Buffer.from(plistData.txtAirPlay);
        }
        if (plistData.txtRAOP && !Buffer.isBuffer(plistData.txtRAOP)) {
          plistData.txtRAOP = Buffer.from(plistData.txtRAOP);
        }
        if (plistData.pk && !Buffer.isBuffer(plistData.pk)) {
          plistData.pk = Buffer.from(plistData.pk);
        }
        
        responseBody = bplistCreator(plistData);
        responseContentType = 'application/x-apple-binary-plist';
        logInfo(`Sending binary PLIST response, size: ${responseBody.length} bytes`);
        
        // Verify binary PLIST format
        if (responseBody.toString('ascii', 0, 8) === 'bplist00') {
          logInfo(`✓ Valid binary PLIST format`);
        } else {
          logError(`✗ Invalid binary PLIST format! First 8 bytes: ${responseBody.toString('ascii', 0, 8)}`);
        }
        
        // Try to decode it back to verify structure
        if (DEBUG_MODE) {
          try {
            const verify = bplistParser.parseBuffer(responseBody);
            logDebug(`✓ Binary PLIST decoded back successfully`);
            logDebug(`Decoded keys:`, Object.keys(verify[0]));
            // Check if txtAirPlay is properly encoded
            if (verify[0].txtAirPlay) {
              logDebug(`txtAirPlay in decoded response:`, 
                Buffer.isBuffer(verify[0].txtAirPlay) ? 'Buffer' : typeof verify[0].txtAirPlay);
            }
            // Verify critical fields
            if (verify[0].displays) {
              logDebug(`displays array verified: ${verify[0].displays.length} display(s)`);
            }
            if (verify[0].audioFormats) {
              logDebug(`audioFormats array verified: ${verify[0].audioFormats.length} format(s)`);
            }
            if (verify[0].audioLatencies) {
              logDebug(`audioLatencies array verified: ${verify[0].audioLatencies.length} latency entry/entries`);
            }
            if (verify[0].initialVolume !== undefined) {
              logDebug(`initialVolume verified: ${verify[0].initialVolume} (type: ${typeof verify[0].initialVolume})`);
            }
          } catch (verifyErr) {
            logError(`✗ Binary PLIST cannot be decoded back:`, verifyErr);
          }
        }
      } catch (err) {
        logError(`Error creating binary PLIST:`, err);
        // Fallback to XML
        const plistXml = this.plistEncode(serverInfo);
        responseBody = Buffer.from(plistXml, 'utf8');
        responseContentType = 'text/x-apple-plist+xml';
        logInfo(`Falling back to XML PLIST`);
      }
    } else {
      const plistXml = this.plistEncode(serverInfo);
      responseBody = Buffer.from(plistXml, 'utf8');
      responseContentType = 'text/x-apple-plist+xml';
      logInfo(`Sending XML PLIST response`);
    }

    // Important AirPlay headers
    const cseqHeader = req.headers['cseq'] || req.headers['CSeq'];
    const cseq = Array.isArray(cseqHeader) ? cseqHeader[0] : (cseqHeader || '0');
    const responseHeaders: Record<string, string> = {
      'Content-Type': responseContentType,
      'Content-Length': responseBody.length.toString(),
      'Server': isActuallyRTSP ? 'AirTunes/220.68' : 'AirPlay/220.68', // UxPlay uses AirTunes/220.68 for RTSP
      'CSeq': cseq,
      'X-Apple-ProtocolVersion': '1',
    };
    
    // Add RTSP-specific headers from captured response
    if (isActuallyRTSP) {
      responseHeaders['Date'] = new Date().toUTCString();
      responseHeaders['X-Apple-ProcessingTime'] = '12'; // Processing time in ms
      responseHeaders['X-Apple-RequestReceivedTimestamp'] = Date.now().toString();
      
      // Add Audio-Jack-Status header for RTSP requests with CSeq (UxPlay line 336)
      // This is CRITICAL - RTSP responses MUST include this header (except for RECORD)
      // UxPlay log shows this is always present for GET /info RTSP responses
      const requestMethod = method || req.method || 'GET';
      if (hasCSeqHeader && requestMethod !== 'RECORD') {
        responseHeaders['Audio-Jack-Status'] = 'connected; type=digital';
        logDebug(`Added Audio-Jack-Status header for RTSP request (method: ${requestMethod})`);
      }
    }

    logResponse(res, responseHeaders, responseBody.length, responseBody);
    
    // For RTSP, we need to write the status line manually
    // Node.js HTTP doesn't support RTSP directly, but we can write the status line
    if (isRTSP) {
      // Write RTSP status line: RTSP/1.0 200 OK
      res.statusCode = 200;
      res.statusMessage = 'OK';
      logDebug(`RTSP response: statusCode=${res.statusCode}, statusMessage=${res.statusMessage}`);
      // Note: Node.js HTTP will write "HTTP/1.1 200 OK" by default
      // For true RTSP support, we'd need raw socket access, but this should work for most clients
      logInfo(`Note: Node.js HTTP server will write HTTP/1.1 instead of RTSP/1.0 (limitation)`);
    }
    
    res.writeHead(200, responseHeaders);
    res.end(responseBody);
    
    // Log after sending to see if there are any errors
    res.on('finish', () => {
      logInfo(`Response sent successfully, status code: ${res.statusCode}`);
    });
    res.on('error', (err) => {
      logError(`Error sending response:`, err);
    });
  }

  private async handlePairSetup(req: http.IncomingMessage, res: http.ServerResponse, corsHeaders: Record<string, string>): Promise<void> {
    logInfo(`=== HANDLING PAIR-SETUP REQUEST ===`);
    
    // Get connection state for this socket
    const socketId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
    const connState = this.connections.get(socketId);
    
    // Initialize pairing session if it doesn't exist
    if (connState && !connState.pairingSession) {
      connState.pairingSession = {
        status: PairingStatus.INITIAL,
        handshakeStarted: false,
        setupStatus: false,
      };
    }
    
    const session = connState?.pairingSession;
    
    // NOTE: UxPlay's raop_handler_pairsetup does NOT skip - it always processes pair-setup
    // Only pair-verify has skip logic (when use_pin is false and status is INITIAL/FINISHED)
    
    // Read request body (UxPlay expects exactly 32 bytes, not a plist)
    let requestBody: Buffer = Buffer.alloc(0);
    if (req.headers['content-length'] && parseInt(req.headers['content-length']) > 0) {
      const body: Buffer[] = [];
      for await (const chunk of req) {
        body.push(chunk);
      }
      requestBody = Buffer.concat(body);
      logInfo(`Pair-setup request body: ${requestBody.length} bytes`);
      logDebug(`Request body preview (hex): ${requestBody.toString('hex')}`);
    }

    // UxPlay's raop_handler_pairsetup:
    // - Expects exactly 32 bytes of data
    // - Gets ED25519 public key from pairing system
    // - Sets setup status
    // - Returns 32-byte public key as raw binary (application/octet-stream)
    
    if (requestBody.length !== 32) {
      logError(`Invalid pair-setup data: expected 32 bytes, got ${requestBody.length} bytes`);
      const cseq = Array.isArray(req.headers['cseq']) ? req.headers['cseq'][0] : (req.headers['cseq'] || '0');
      res.writeHead(400, {
        'CSeq': cseq,
        'Content-Length': '0',
        ...corsHeaders,
      });
      res.end();
      return;
    }

    // Get or generate ED25519 key pair (CRITICAL: must use same key pair in pair-setup and pair-verify!)
    // The client will verify the signature in pair-verify using the public key from pair-setup
    if (!this.persistentPrivateKey || !this.persistentPublicKey) {
      try {
        // Generate ED25519 key pair - this MUST be the same key used in pair-verify!
        const ed25519KeyPair = crypto.generateKeyPairSync('ed25519');
        this.persistentPrivateKey = ed25519KeyPair.privateKey;
        // Export public key as raw 32-byte buffer (not DER format)
        const publicKeyDer = ed25519KeyPair.publicKey.export({ format: 'der', type: 'spki' });
        // Extract the raw 32-byte public key from the DER structure
        // ED25519 public key in SPKI format: SEQUENCE { AlgorithmIdentifier, BIT STRING { 32-byte key } }
        // The key is the last 32 bytes of the DER structure
        this.persistentPublicKey = publicKeyDer.slice(-32);
        logInfo(`Generated new persistent ED25519 key pair for pairing (public key will be used in pair-setup, private key in pair-verify)`);
        logDebug(`Public key (hex): ${this.persistentPublicKey.toString('hex')}`);
      } catch (err) {
        logError(`Failed to generate ED25519 key pair:`, err);
        // Fallback to random bytes (will cause verification failure)
        this.persistentPublicKey = crypto.randomBytes(32);
      }
    }
    
    // Set pairing setup status (in UxPlay: pairing_session_set_setup_status)
    // Update session status to SETUP
    if (connState && session) {
      session.status = PairingStatus.SETUP;
      session.setupStatus = true;
      logInfo(`Pair-setup: session status updated to SETUP`);
    }
    
    logInfo(`Pair-setup: returning ED25519 public key (32 bytes)`);
    logDebug(`Public key (hex): ${this.persistentPublicKey.toString('hex')}`);

    // Return the 32-byte public key as raw binary (not a plist!)
    const responseBody = Buffer.from(this.persistentPublicKey);
    
    const cseq = Array.isArray(req.headers['cseq']) ? req.headers['cseq'][0] : (req.headers['cseq'] || '0');
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': responseBody.length.toString(),
      'CSeq': cseq,
      ...corsHeaders,
    });
    res.end(responseBody);
  }

  /**
   * Check handshake status (UxPlay: pairing_session_check_handshake_status)
   * Returns true if status is INITIAL or FINISHED (should skip if usePin is false)
   * Returns false if status is SETUP or HANDSHAKE (should process)
   */
  private checkHandshakeStatus(session: PairingSession): boolean {
    // UxPlay returns 0 for SETUP/HANDSHAKE, -1 otherwise
    // In boolean terms: true means skip (status is INITIAL or FINISHED)
    return session.status === PairingStatus.INITIAL || session.status === PairingStatus.FINISHED;
  }

  private async handlePairVerify(req: http.IncomingMessage, res: http.ServerResponse, corsHeaders: Record<string, string>): Promise<void> {
    logInfo(`=== HANDLING PAIR-VERIFY REQUEST ===`);
    
    // Get connection state for this socket
    const socketId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
    const connState = this.connections.get(socketId);
    
    // Initialize pairing session if it doesn't exist
    if (connState && !connState.pairingSession) {
      connState.pairingSession = {
        status: PairingStatus.INITIAL,
        handshakeStarted: false,
        setupStatus: false,
      };
    }
    
    const session = connState?.pairingSession;
    
    // UxPlay checks: if (pairing_session_check_handshake_status(conn->session))
    // pairing_session_check_handshake_status returns 0 for SETUP/HANDSHAKE, -1 otherwise
    // If it returns non-zero (status is INITIAL or FINISHED) and use_pin is false, return early
    // This allows already-paired devices to skip pair-verify when use_pin is false
    if (session) {
      const handshakeStatus = this.checkHandshakeStatus(session);
      if (handshakeStatus && !this.usePin) {
        // Handshake is already finished (or initial), and PIN is not required
        // Skip pair-verify (UxPlay returns early without response)
        logInfo(`Pair-verify skipped: handshake status=${session.status}, usePin=${this.usePin}`);
        return; // Return early without sending response
      }
    }
    
    // Read request body (UxPlay expects raw binary, not plist)
    let requestBody: Buffer = Buffer.alloc(0);
    if (req.headers['content-length'] && parseInt(req.headers['content-length']) > 0) {
      const body: Buffer[] = [];
      for await (const chunk of req) {
        body.push(chunk);
      }
      requestBody = Buffer.concat(body);
      logInfo(`Pair-verify request body: ${requestBody.length} bytes`);
      logDebug(`Request body preview (hex): ${requestBody.toString('hex')}`);
    }

    // UxPlay's raop_handler_pairverify:
    // - Checks first byte: data[0] == 1 (step 1) or data[0] == 0 (step 2)
    // - Step 1: Expects 4 + X25519_KEY_SIZE(32) + ED25519_KEY_SIZE(32) = 68 bytes
    //   Returns: X25519_KEY_SIZE(32) + PAIRING_SIG_SIZE(64) = 96 bytes raw binary
    // - Step 2: Expects 4 + PAIRING_SIG_SIZE(64) = 68 bytes
    //   Returns: empty body (just headers)
    // - Content-Type: application/octet-stream (not plist!)
    
    if (requestBody.length < 4) {
      logError(`Invalid pair-verify data: expected at least 4 bytes, got ${requestBody.length} bytes`);
      const cseq = Array.isArray(req.headers['cseq']) ? req.headers['cseq'][0] : (req.headers['cseq'] || '0');
      res.writeHead(400, {
        'CSeq': cseq,
        'Content-Length': '0',
        ...corsHeaders,
      });
      res.end();
      return;
    }

    const step = requestBody[0];
    const X25519_KEY_SIZE = 32;
    const ED25519_KEY_SIZE = 32;
    const PAIRING_SIG_SIZE = 64;

    logDebug(`Pair-verify step detected: ${step} (expected 1 for step 1, 0 for step 2)`);
    logDebug(`Pair-verify request body length: ${requestBody.length} bytes`);

    let responseBody: Buffer;
    const cseq = Array.isArray(req.headers['cseq']) ? req.headers['cseq'][0] : (req.headers['cseq'] || '0');

    if (step === 1) {
      // Step 1: Client sends X25519 public key + ED25519 public key
      // Expected: 4 + 32 + 32 = 68 bytes
      if (requestBody.length !== 4 + X25519_KEY_SIZE + ED25519_KEY_SIZE) {
        logError(`Invalid pair-verify step 1 data: expected ${4 + X25519_KEY_SIZE + ED25519_KEY_SIZE} bytes, got ${requestBody.length} bytes`);
        res.writeHead(400, {
          'CSeq': cseq,
          'Content-Length': '0',
          ...corsHeaders,
        });
        res.end();
        return;
      }

      // Extract client's keys
      const clientX25519Key = requestBody.slice(4, 4 + X25519_KEY_SIZE);
      const clientED25519Key = requestBody.slice(4 + X25519_KEY_SIZE, 4 + X25519_KEY_SIZE + ED25519_KEY_SIZE);
      
      logInfo(`Pair-verify step 1: received client X25519 key (${clientX25519Key.length} bytes) and ED25519 key (${clientED25519Key.length} bytes)`);
      logDebug(`Client X25519 key (hex): ${clientX25519Key.toString('hex')}`);
      logDebug(`Client ED25519 key (hex): ${clientED25519Key.toString('hex')}`);

      // Store client keys in session (UxPlay: pairing_session_handshake)
      if (session) {
        session.clientX25519Key = clientX25519Key;
        session.clientED25519Key = clientED25519Key;
        session.handshakeStarted = true;
      }

      // Initialize X25519 ECDH key exchange (UxPlay: pairing_session_handshake)
      // Use @noble/curves for proper X25519 implementation
      let serverX25519Key: Buffer;
      let sharedSecret: Buffer;
      let serverX25519PrivateKey: Buffer;
      
      try {
        // Generate X25519 key pair using @noble/curves
        // Load the library if not already loaded (using dynamic import for ES module)
        if (!x25519Lib) {
          x25519Lib = await loadX25519Lib();
        }
        
        // Generate X25519 key pair using @noble/curves
        // x25519.utils.randomSecretKey() generates a random 32-byte private key
        // Alternatively, we could use x25519.keygen() which returns { privateKey, publicKey }
        const privateKeyBytes = x25519Lib.utils.randomSecretKey();
        serverX25519PrivateKey = Buffer.from(privateKeyBytes);
        
        // x25519.getPublicKey(privateKey) generates public key from private key
        const publicKeyBytes = x25519Lib.getPublicKey(privateKeyBytes);
        serverX25519Key = Buffer.from(publicKeyBytes);
        
        // Compute shared secret: X25519(serverPrivateKey, clientPublicKey)
        const sharedSecretBytes = x25519Lib.getSharedSecret(privateKeyBytes, clientX25519Key);
        sharedSecret = Buffer.from(sharedSecretBytes);
        
        logInfo(`X25519 ECDH initialized: public key (${serverX25519Key.length} bytes), shared secret (${sharedSecret.length} bytes)`);
        logDebug(`Server X25519 public key (hex): ${serverX25519Key.toString('hex')}`);
        logDebug(`Shared secret (hex): ${sharedSecret.toString('hex').substring(0, 32)}...`);
        
        // Store ECDH state in session
        if (session) {
          session.serverX25519Key = serverX25519Key;
          session.serverX25519PrivateKey = serverX25519PrivateKey;
          session.sharedSecret = sharedSecret;
        }
    } catch (err) {
        logError(`Failed to create X25519 ECDH:`, err);
        // Fallback: generate random keys (will cause verification failure but allows testing)
        serverX25519Key = crypto.randomBytes(X25519_KEY_SIZE);
        sharedSecret = crypto.randomBytes(32);
        serverX25519PrivateKey = crypto.randomBytes(X25519_KEY_SIZE);
        if (session) {
          session.serverX25519Key = serverX25519Key;
          session.serverX25519PrivateKey = serverX25519PrivateKey;
          session.sharedSecret = sharedSecret;
        }
      }

      // Generate ED25519 signature (UxPlay: pairing_session_get_signature)
      // UxPlay signs: server X25519 (32 bytes) + client X25519 (32 bytes) = 64 bytes
      // Then encrypts the signature with AES-CTR using keys derived from shared secret
      
      // CRITICAL: Use the SAME persistent ED25519 key pair from pair-setup!
      // The client verifies the signature using the public key it received in pair-setup
      if (!this.persistentPrivateKey) {
        logError(`No persistent private key available - pair-setup must be called first!`);
        throw new Error('No persistent private key available - pair-setup must be called first');
      }

      let signature: Buffer;
      try {
        if (this.persistentPrivateKey) {
          // UxPlay signs: ecdh_ours (server X25519) + ecdh_theirs (client X25519)
          // NOT client ED25519, NOT shared secret!
          const messageToSign = Buffer.concat([
            serverX25519Key,  // server X25519 public key (32 bytes)
            clientX25519Key,  // client X25519 public key (32 bytes)
          ]);
          
          logDebug(`Signing message: server X25519 (${serverX25519Key.length} bytes) + client X25519 (${clientX25519Key.length} bytes) = ${messageToSign.length} bytes`);
          
          // Use crypto.sign() directly with ED25519 key (not createSign with digest)
          // crypto.sign() works directly with ED25519 keys in Node.js 12.0.0+
          signature = crypto.sign(null, messageToSign, this.persistentPrivateKey);
          
          // ED25519 signatures are 64 bytes
          if (signature.length !== PAIRING_SIG_SIZE) {
            logError(`Invalid signature length: expected ${PAIRING_SIG_SIZE}, got ${signature.length}`);
            signature = crypto.randomBytes(PAIRING_SIG_SIZE);
          } else {
            logDebug(`Generated ED25519 signature (${signature.length} bytes) before encryption`);
            
            // UxPlay then encrypts the signature with AES-CTR
            // Derive encryption key and IV from shared secret using SHA512 (not PBKDF2)
            // UxPlay's derive_key_internal: SHA512(salt + shared_secret), then take first keylen bytes
            const SALT_KEY = 'Pair-Verify-AES-Key';
            const SALT_IV = 'Pair-Verify-AES-IV';
            
            // Derive AES key (16 bytes) and IV (16 bytes) from shared secret
            // SHA512(salt + shared_secret), take first 16 bytes
            const keyHash = crypto.createHash('sha512').update(SALT_KEY).update(sharedSecret).digest();
            const ivHash = crypto.createHash('sha512').update(SALT_IV).update(sharedSecret).digest();
            const aesKey = keyHash.slice(0, 16);
            const aesIV = ivHash.slice(0, 16);
            
            logDebug(`Derived AES key and IV from shared secret`);
            
            // Encrypt signature with AES-CTR
            // UxPlay: pairing_session_get_signature() encrypts directly without fake round
            // aes_ctr_encrypt(aes_ctx, signature, signature, PAIRING_SIG_SIZE);
            const cipher = crypto.createCipheriv('aes-128-ctr', aesKey, aesIV);
            const encryptedSignature = Buffer.concat([
              cipher.update(signature),
              cipher.final(),
            ]);
            
            signature = encryptedSignature;
            logDebug(`Encrypted signature (${signature.length} bytes)`);
            logDebug(`Encrypted signature (hex): ${signature.toString('hex').substring(0, 32)}...`);
          }
        } else {
          throw new Error('No persistent private key available');
        }
      } catch (err) {
        logError(`Failed to generate ED25519 signature:`, err);
        // Fallback to random signature (will cause verification failure)
        signature = crypto.randomBytes(PAIRING_SIG_SIZE);
      }
      
      // Response: X25519 public key (32 bytes) + ED25519 signature (64 bytes) = 96 bytes
      // UxPlay: memcpy(*response_data, public_key, sizeof(public_key));
      //        memcpy(*response_data + sizeof(public_key), signature, sizeof(signature));
      responseBody = Buffer.concat([serverX25519Key, signature]);
      
      // Verify response format matches UxPlay exactly
      if (responseBody.length !== 96) {
        logError(`Invalid response body length: expected 96 bytes, got ${responseBody.length}`);
      }
      if (serverX25519Key.length !== 32) {
        logError(`Invalid X25519 key length: expected 32 bytes, got ${serverX25519Key.length}`);
      }
      if (signature.length !== 64) {
        logError(`Invalid signature length: expected 64 bytes, got ${signature.length}`);
      }
      
      logInfo(`Pair-verify step 1: returning server X25519 key (32 bytes) + signature (64 bytes) = ${responseBody.length} bytes`);
      logDebug(`Server X25519 key (hex): ${serverX25519Key.toString('hex')}`);
      logDebug(`Signature (hex): ${signature.toString('hex').substring(0, 32)}...`);
      logDebug(`Full response body (hex, first 64 bytes): ${responseBody.toString('hex').substring(0, 128)}`);

      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
      'Content-Length': responseBody.length.toString(),
      'CSeq': cseq,
        'Server': 'AirTunes/220.68',
      ...corsHeaders,
    });
    res.end(responseBody);
      logInfo(`Pair-verify step 1: response sent (${responseBody.length} bytes), waiting for step 2...`);
    } else if (step === 0) {
      logInfo(`Pair-verify step 2: received (step byte = ${step})`);
      // Step 2: Client sends signature for verification
      // Expected: 4 + 64 = 68 bytes
      if (requestBody.length !== 4 + PAIRING_SIG_SIZE) {
        logError(`Invalid pair-verify step 2 data: expected ${4 + PAIRING_SIG_SIZE} bytes, got ${requestBody.length} bytes`);
        res.writeHead(400, {
          'CSeq': cseq,
          'Content-Length': '0',
          ...corsHeaders,
        });
        res.end();
        return;
      }

      const clientSignature = requestBody.slice(4, 4 + PAIRING_SIG_SIZE);
      logInfo(`Pair-verify step 2: received client signature (${clientSignature.length} bytes)`);
      logDebug(`Client signature (hex): ${clientSignature.toString('hex').substring(0, 32)}...`);

      // Verify the client's signature (UxPlay: pairing_session_finish)
      // UxPlay: First decrypts the signature, then verifies with client X25519 + server X25519
      let signatureValid = false;
      
      if (session && session.clientX25519Key && session.serverX25519Key && session.sharedSecret && session.clientED25519Key) {
        try {
          // UxPlay first decrypts the signature with AES-CTR
          const SALT_KEY = 'Pair-Verify-AES-Key';
          const SALT_IV = 'Pair-Verify-AES-IV';
          
          // Derive AES key and IV from shared secret (same as step 1)
          const keyHash = crypto.createHash('sha512').update(SALT_KEY).update(session.sharedSecret).digest();
          const ivHash = crypto.createHash('sha512').update(SALT_IV).update(session.sharedSecret).digest();
          const aesKey = keyHash.slice(0, 16);
          const aesIV = ivHash.slice(0, 16);
          
          // Decrypt the signature
          // UxPlay: One fake round (encrypt zeros), then encrypt the encrypted signature to decrypt it
          // In CTR mode, encryption and decryption are the same operation
          // CRITICAL: We can't reuse a cipher after final(), so we need to process both operations
          // in a single cipher instance, or manually advance the counter
          // Approach: Create one cipher, process fake round + signature together
          const cipher = crypto.createCipheriv('aes-128-ctr', aesKey, aesIV);
          
          // Process both: fake round (64 bytes zeros) + encrypted signature (64 bytes)
          // This advances the counter correctly
          const combinedInput = Buffer.concat([
            Buffer.alloc(PAIRING_SIG_SIZE), // Fake round: zeros
            clientSignature, // Encrypted signature to decrypt
          ]);
          
          const combinedOutput = Buffer.concat([
            cipher.update(combinedInput),
            cipher.final(),
          ]);
          
          // Extract the decrypted signature (second 64 bytes)
          const decryptedSignature = combinedOutput.slice(PAIRING_SIG_SIZE);
          
          logDebug(`Decrypted client signature (${decryptedSignature.length} bytes)`);
          logDebug(`Decrypted signature (hex, first 32 bytes): ${decryptedSignature.toString('hex').substring(0, 64)}`);
          
          // UxPlay verifies: ecdh_theirs (client X25519) + ecdh_ours (server X25519)
          // NOT client ED25519, NOT shared secret!
          const messageToVerify = Buffer.concat([
            session.clientX25519Key,  // client X25519 public key (32 bytes)
            session.serverX25519Key,  // server X25519 public key (32 bytes)
          ]);
          
          logDebug(`Verifying message: client X25519 (${session.clientX25519Key.length} bytes) + server X25519 (${session.serverX25519Key.length} bytes) = ${messageToVerify.length} bytes`);
          logDebug(`Message to verify (hex, first 32 bytes): ${messageToVerify.toString('hex').substring(0, 64)}`);
          
          // Create a public key object from the raw ED25519 public key
          // ED25519 public key in SPKI format: SEQUENCE { AlgorithmIdentifier, BIT STRING { 32-byte key } }
          // AlgorithmIdentifier: SEQUENCE { OID id-Ed25519 }
          // OID for Ed25519: 1.3.101.112 (0x2b 0x65 0x70 in DER encoding)
          const ed25519OID = Buffer.from([0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70]); // SEQUENCE { OID id-Ed25519 }
          const publicKeyBitString = Buffer.concat([
            Buffer.from([0x03, 0x21, 0x00]), // BIT STRING with 0 unused bits, length 33 (32 bytes + 1 byte header)
            session.clientED25519Key, // 32-byte raw public key
          ]);
          const algorithmIdentifier = Buffer.concat([ed25519OID, publicKeyBitString]);
          const spkiStructure = Buffer.concat([
            Buffer.from([0x30, algorithmIdentifier.length]), // SEQUENCE with length
            algorithmIdentifier,
          ]);
          
          logDebug(`SPKI structure length: ${spkiStructure.length} bytes`);
          logDebug(`SPKI structure (hex, first 32 bytes): ${spkiStructure.toString('hex').substring(0, 64)}`);
          
          let clientPublicKeyObj: crypto.KeyObject;
          try {
            clientPublicKeyObj = crypto.createPublicKey({
              key: spkiStructure,
              format: 'der',
              type: 'spki',
            });
            logDebug(`Created public key object successfully`);
          } catch (keyErr) {
            logError(`Failed to create public key object:`, keyErr);
            throw keyErr;
          }
          
          // Use crypto.verify() directly with ED25519 (null = no digest algorithm)
          // Signature: decryptedSignature (64 bytes)
          // Message: messageToVerify (client X25519 + server X25519, 64 bytes)
          // Public key: clientPublicKeyObj (from client ED25519 public key)
          try {
            signatureValid = crypto.verify(null, messageToVerify, clientPublicKeyObj, decryptedSignature);
            logDebug(`crypto.verify() returned: ${signatureValid}`);
          } catch (verifyErr) {
            logError(`crypto.verify() threw error:`, verifyErr);
            signatureValid = false;
          }
          
          if (signatureValid) {
            logInfo(`Pair-verify step 2: signature verified successfully`);
          } else {
            logError(`Pair-verify step 2: signature verification failed`);
          }
        } catch (keyErr) {
          logError(`Failed to verify signature:`, keyErr);
          // Don't accept invalid signatures - this should fail
          signatureValid = false;
        }
      } else {
        logError(`Missing session data for signature verification`);
        signatureValid = false;
      }

      if (!signatureValid) {
        logError(`Pair-verify step 2: signature verification failed`);
        // UxPlay sets http_response_set_disconnect(response, 1) on failure
        // But we should still send a response and let the client decide to close
        // Don't immediately close the socket - the client might send fp-setup anyway
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': '0',
          'CSeq': cseq,
          'Server': 'AirTunes/220.68',
          ...corsHeaders,
        });
        res.end();
        // Don't close socket immediately - let client decide
        // The client will likely close on its own if verification fails
        logInfo(`Pair-verify step 2: sent failure response (empty body), connection may close`);
        return;
      }
      
      // Update pairing session status to FINISHED (UxPlay: session->status = STATUS_FINISHED)
      if (session) {
        session.status = PairingStatus.FINISHED;
        logInfo(`Pairing session status updated to FINISHED`);
      }
      
      // Update status to connected
      this.status = 'connected';
      this.sendStatusUpdate();
      logInfo(`Status updated to: connected`);

      // Response: empty body (just headers)
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': '0',
        'CSeq': cseq,
        'Server': 'AirTunes/220.68',
        ...corsHeaders,
      });
      res.end();
    } else {
      logError(`Invalid pair-verify step: expected 0 or 1, got ${step}`);
      res.writeHead(400, {
        'CSeq': cseq,
        'Content-Length': '0',
        ...corsHeaders,
      });
      res.end();
    }
  }

  private handlePlay(req: http.IncomingMessage, res: http.ServerResponse, corsHeaders: Record<string, string>): void {
    logInfo(`=== HANDLING PLAY REQUEST ===`);
    // Video stream handler
    // In a full implementation, this would receive and process video streams
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      ...corsHeaders,
    });
    res.end();
  }

  private async handleRTSPSetup(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    corsHeaders: Record<string, string>,
    isRTSP: boolean = false
  ): Promise<void> {
    // CRITICAL: Log immediately to file and console
    // Try direct file write first to test
    try {
      const testLine = `[${new Date().toISOString()}] [INFO] === HANDLING RTSP SETUP REQUEST === (DIRECT WRITE)\n`;
      fs.appendFileSync(LOG_FILE, testLine, { encoding: 'utf8', flag: 'a' });
      console.log('[DIRECT_WRITE] Successfully wrote to log file');
    } catch (directErr: any) {
      console.error('[DIRECT_WRITE] Failed:', directErr?.message, directErr?.code);
    }
    
    writeToLogFile('INFO', '=== HANDLING RTSP SETUP REQUEST ===!');
    console.log('=== HANDLING RTSP SETUP REQUEST ===');
    logInfo(`=== HANDLING RTSP SETUP REQUEST ===`);
    
    // Read request body (binary plist)
    let requestBody: Buffer | null = null;
    if (req.headers['content-length'] && parseInt(req.headers['content-length']) > 0) {
      const body: Buffer[] = [];
      for await (const chunk of req) {
        body.push(chunk);
      }
      requestBody = Buffer.concat(body);
      logInfo(`SETUP request body received: ${requestBody.length} bytes`);
    } else {
      logError(`SETUP request has no body (content-length: ${req.headers['content-length']})`);
      res.writeHead(400, {
        'Content-Type': 'text/plain',
      });
      res.end('Bad Request: Missing body');
      return;
    }

    // Parse binary plist
    let requestData: any = null;
    writeToLogFile('INFO', 'Starting plist parsing...');
    console.log('Starting plist parsing...');
    
    try {
      writeToLogFile('INFO', `Calling bplistParser.parseBuffer with ${requestBody.length} bytes`);
      console.log(`Calling bplistParser.parseBuffer with ${requestBody.length} bytes`);
      
      const parsed = bplistParser.parseBuffer(requestBody);
      
      writeToLogFile('INFO', `Plist parsed, result: ${parsed ? 'not null' : 'null'}, length: ${parsed?.length || 0}`);
      console.log(`Plist parsed, result: ${parsed ? 'not null' : 'null'}, length: ${parsed?.length || 0}`);
      
      if (parsed && parsed.length > 0) {
        requestData = parsed[0];
        writeToLogFile('INFO', `SETUP request parsed successfully, requestData keys: ${Object.keys(requestData).join(', ')}`);
        console.log(`SETUP request parsed successfully, requestData keys: ${Object.keys(requestData).join(', ')}`);
        logInfo(`SETUP request parsed successfully`);
        logDebug(`SETUP request keys:`, Object.keys(requestData));
      } else {
        writeToLogFile('ERROR', 'SETUP request plist is empty');
        console.error('SETUP request plist is empty');
        logError(`SETUP request plist is empty`);
        res.writeHead(400, {
          'Content-Type': 'text/plain',
        });
        res.end('Bad Request: Invalid plist');
        return;
      }
    } catch (err) {
      writeToLogFile('ERROR', `Error parsing SETUP request plist: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`Error parsing SETUP request plist:`, err);
      logError(`Error parsing SETUP request plist:`, err);
      res.writeHead(400, {
        'Content-Type': 'text/plain',
      });
      res.end('Bad Request: Invalid plist format');
      return;
    }
    
    writeToLogFile('INFO', 'Plist parsing try-catch completed successfully');
    console.log('Plist parsing try-catch completed successfully');
    
    // Force immediate file write to ensure we see this
    writeToLogFile('INFO', '[FAIRPLAY] ===== AFTER PLIST PARSING TRY-CATCH =====');
    console.log('[FAIRPLAY] ===== AFTER PLIST PARSING TRY-CATCH =====');
    
    writeToLogFile('INFO', `[FAIRPLAY] requestData is: ${requestData ? 'not null' : 'null'}`);
    console.log(`[FAIRPLAY] requestData is: ${requestData ? 'not null' : 'null'}`);
    
    writeToLogFile('INFO', `[FAIRPLAY] requestData type: ${typeof requestData}`);
    console.log(`[FAIRPLAY] requestData type: ${typeof requestData}`);
    
    if (requestData) {
      const keys = Object.keys(requestData);
      writeToLogFile('INFO', `[FAIRPLAY] requestData keys: ${keys.join(', ')}`);
      console.log(`[FAIRPLAY] requestData keys: ${keys.join(', ')}`);
    }
    
    writeToLogFile('INFO', '[FAIRPLAY] About to check requestData...');
    console.log('[FAIRPLAY] About to check requestData...');
    
    if (!requestData) {
      logError(`[FAIRPLAY] requestData is null after parsing!`);
      res.writeHead(400, {
        'Content-Type': 'text/plain',
      });
      res.end('Bad Request: Failed to parse plist');
      return;
    }
    
    logInfo(`[FAIRPLAY] SETUP request parsed requestData, keys: ${Object.keys(requestData).join(', ')}`);

    // Extract device info
    const deviceID = requestData.deviceID || 'unknown';
    const name = requestData.name || 'Unknown Device';
    const model = requestData.model || 'Unknown Model';
    
    // Check if this is first SETUP (with ekey/eiv) or second SETUP (with streams only)
    // Log ALL keys to see what's actually in the request
    const allKeys = Object.keys(requestData);
    writeToLogFile('INFO', `[FAIRPLAY] ALL requestData keys: ${allKeys.join(', ')}`);
    console.log(`[FAIRPLAY] ALL requestData keys: ${allKeys.join(', ')}`);
    
    // Check for ekey/eiv with direct file writes
    writeToLogFile('INFO', `[FAIRPLAY] requestData.ekey exists: ${!!requestData.ekey}, type: ${typeof requestData.ekey}`);
    console.log(`[FAIRPLAY] requestData.ekey exists: ${!!requestData.ekey}, type: ${typeof requestData.ekey}`);
    
    writeToLogFile('INFO', `[FAIRPLAY] requestData.eiv exists: ${!!requestData.eiv}, type: ${typeof requestData.eiv}`);
    console.log(`[FAIRPLAY] requestData.eiv exists: ${!!requestData.eiv}, type: ${typeof requestData.eiv}`);
    
    writeToLogFile('INFO', `[FAIRPLAY] requestData.streams exists: ${!!requestData.streams}, type: ${typeof requestData.streams}`);
    console.log(`[FAIRPLAY] requestData.streams exists: ${!!requestData.streams}, type: ${typeof requestData.streams}`);
    
    logInfo(`[FAIRPLAY] SETUP requestData.ekey exists: ${!!requestData.ekey}, type: ${typeof requestData.ekey}`);
    logInfo(`[FAIRPLAY] SETUP requestData.eiv exists: ${!!requestData.eiv}, type: ${typeof requestData.eiv}`);
    logInfo(`[FAIRPLAY] SETUP requestData.streams exists: ${!!requestData.streams}, type: ${typeof requestData.streams}`);
    
    const hasEkeyEiv = requestData.ekey && requestData.eiv;
    const hasStreams = requestData.streams && Array.isArray(requestData.streams);
    
    writeToLogFile('INFO', `[FAIRPLAY] hasEkeyEiv: ${hasEkeyEiv}, hasStreams: ${hasStreams}`);
    console.log(`[FAIRPLAY] hasEkeyEiv: ${hasEkeyEiv}, hasStreams: ${hasStreams}`);
    
    logInfo(`[FAIRPLAY] hasEkeyEiv: ${hasEkeyEiv}, hasStreams: ${hasStreams}`);
    
    if (hasEkeyEiv) {
      logInfo(`SETUP 1 (initial setup with ekey/eiv)`);
      logInfo(`Connection request from ${name} (${model}) with deviceID = ${deviceID}`);
    } else if (hasStreams) {
      logInfo(`SETUP 2 (stream setup - processing streams array)`);
    } else {
      logError(`SETUP request missing both ekey/eiv and streams`);
      res.writeHead(400, {
        'Content-Type': 'text/plain',
      });
      res.end('Bad Request: Missing ekey/eiv or streams');
      return;
    }
    logInfo(`[FAIRPLAY] TEST`);

    // Extract ekey and eiv (FairPlay encrypted keys) - only for first SETUP
    let aeskey: Buffer | null = null;
    let aesiv: Buffer | null = null;
    
    if (hasEkeyEiv) {
      logInfo(`[FAIRPLAY] SETUP request has ekey/eiv - extracting keys`);
      const ekey = Buffer.isBuffer(requestData.ekey) ? requestData.ekey : Buffer.from(requestData.ekey, 'base64');
      const eiv = Buffer.isBuffer(requestData.eiv) ? requestData.eiv : Buffer.from(requestData.eiv, 'base64');
      
      logInfo(`[FAIRPLAY] eiv_len = ${eiv.length}`);
      logDebug(`16 byte aesiv (needed for AES-CBC audio decryption iv): ${eiv.toString('hex')}`);
      
      logInfo(`[FAIRPLAY] ekey_len = ${ekey.length}`);
      logDebug(`ekey: ${ekey.toString('hex').substring(0, 100)}...`);
      
      // Decrypt ekey using FairPlay
      // UxPlay: fairplay_decrypt(conn->fairplay, (unsigned char*) eaeskey, aeskey)
      // Requires the FairPlay key message (164 bytes) stored from /fp-setup handshake
      logInfo(`[FAIRPLAY] Checking if ekey length is 72: ${ekey.length === 72}`);
      if (ekey.length === 72) {
        // Get FairPlay key message from connection state
        const socketId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
        writeToLogFile('INFO', `[FAIRPLAY] Checking for fairplayKeyMsg in connection state for socket ${socketId}`);
        console.log(`[FAIRPLAY] Checking for fairplayKeyMsg in connection state for socket ${socketId}`);
        logInfo(`[FAIRPLAY] Checking for fairplayKeyMsg in connection state for socket ${socketId}`);
        
        writeToLogFile('INFO', `[FAIRPLAY] Total connections: ${this.connections.size}, all socket IDs: ${Array.from(this.connections.keys()).join(', ')}`);
        console.log(`[FAIRPLAY] Total connections: ${this.connections.size}, all socket IDs: ${Array.from(this.connections.keys()).join(', ')}`);
        logInfo(`[FAIRPLAY] Total connections: ${this.connections.size}, all socket IDs: ${Array.from(this.connections.keys()).join(', ')}`);
        
        const connState = this.connections.get(socketId);
        const fairplayKeyMsg = (connState as any)?.fairplayKeyMsg;
        
        writeToLogFile('INFO', `[FAIRPLAY] Connection state exists: ${!!connState}`);
        console.log(`[FAIRPLAY] Connection state exists: ${!!connState}`);
        logInfo(`[FAIRPLAY] Connection state exists: ${!!connState}`);
        
        writeToLogFile('INFO', `[FAIRPLAY] fairplayKeyMsg exists: ${!!fairplayKeyMsg}`);
        console.log(`[FAIRPLAY] fairplayKeyMsg exists: ${!!fairplayKeyMsg}`);
        logInfo(`[FAIRPLAY] fairplayKeyMsg exists: ${!!fairplayKeyMsg}`);
        
        writeToLogFile('INFO', `[FAIRPLAY] fairplayKeyMsg length: ${fairplayKeyMsg?.length || 0}`);
        console.log(`[FAIRPLAY] fairplayKeyMsg length: ${fairplayKeyMsg?.length || 0}`);
        logInfo(`[FAIRPLAY] fairplayKeyMsg length: ${fairplayKeyMsg?.length || 0}`);
        
        if (connState) {
          writeToLogFile('INFO', `[FAIRPLAY] Connection state keys: ${Object.keys(connState).join(', ')}`);
          console.log(`[FAIRPLAY] Connection state keys: ${Object.keys(connState).join(', ')}`);
          logInfo(`[FAIRPLAY] Connection state keys: ${Object.keys(connState).join(', ')}`);
        }
        
        if (!fairplayKeyMsg || fairplayKeyMsg.length !== 164) {
          logError(`[FAIRPLAY] Cannot decrypt ekey - FairPlay key message not found or invalid (length: ${fairplayKeyMsg?.length || 0}, expected 164)`);
          logError(`[FAIRPLAY] FairPlay key message must be stored from /fp-setup handshake (164 bytes)`);
          logError(`[FAIRPLAY] Connection state keys: ${connState ? Object.keys(connState).join(', ') : 'N/A'}`);
          // Fall back to stub for now (will fail decryption)
          aeskey = crypto.randomBytes(16);
          logError(`[FAIRPLAY] Using random stub aeskey - decryption will fail!`);
        } else {
          // Decrypt ekey using FairPlay decryption
          // UxPlay: playfair_decrypt(fp->keymsg, ekey, aeskey)
          // Where fp->keymsg is the 164-byte buffer from fp-setup
          // ekey is the 72-byte encrypted key from SETUP
          // aeskey is the 16-byte decrypted key
          aeskey = Buffer.alloc(16);
          try {
            logInfo(`[FAIRPLAY] Calling playfairDecrypt with fairplayKeyMsg (${fairplayKeyMsg.length} bytes), ekey (${ekey.length} bytes)`);
            logInfo(`[FAIRPLAY] fairplayKeyMsg (first 32 bytes): ${fairplayKeyMsg.slice(0, 32).toString('hex')}`);
            logInfo(`[FAIRPLAY] ekey (first 32 bytes): ${ekey.slice(0, 32).toString('hex')}`);
            logInfo(`[FAIRPLAY] ekey (last 16 bytes): ${ekey.slice(56, 72).toString('hex')}`);
            playfairDecrypt(fairplayKeyMsg, ekey, aeskey);
            logInfo(`[FAIRPLAY] Decryption successful! aeskey: ${aeskey.toString('hex')}`);
            logInfo(`[FAIRPLAY] aeskey (first 8 bytes): ${aeskey.slice(0, 8).toString('hex')}`);
          } catch (err) {
            logError(`[FAIRPLAY] Decryption failed:`, err);
            logError(`[FAIRPLAY] Error details:`, err instanceof Error ? err.stack : String(err));
            // Fall back to stub for now (will fail decryption)
            aeskey = crypto.randomBytes(16);
            logError(`[FAIRPLAY] Using random stub aeskey - decryption will fail!`);
          }
        }
        
        logDebug(`ekey length: ${ekey.length}, aeskey: ${aeskey.toString('hex')}`);
      } else {
        logError(`Invalid ekey length: ${ekey.length} (expected 72)`);
        res.writeHead(400, {
          'Content-Type': 'text/plain',
        });
        res.end('Bad Request: Invalid ekey length');
        return;
      }
      
      if (eiv.length === 16) {
        aesiv = eiv;
      } else {
        logError(`Invalid eiv length: ${eiv.length} (expected 16)`);
        res.writeHead(400, {
          'Content-Type': 'text/plain',
        });
        res.end('Bad Request: Invalid eiv length');
        return;
      }
      
      // Extract timing port from request (only in first SETUP)
      const timingRPort = requestData.timingPort || 0;
      logInfo(`timing_rport = ${timingRPort}`);
      
      // Generate local timing port (UDP port for NTP)
      // In production, this should bind to a UDP socket
      // For now, generate a random port in the ephemeral range
      const timingLPort = Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;
      logInfo(`timing_lport = ${timingLPort} (stub - should bind to UDP socket)`);
      
      // TODO: Start NTP timing synchronization
      // TODO: Initialize RTP audio handler with aeskey and aesiv
      // TODO: Initialize RTP mirror handler for video
      
      // Store aeskey/aesiv for this connection (needed for stream setup)
      const socketId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
      const connState = this.connections.get(socketId);
      if (connState) {
        (connState as any).aeskey = aeskey;
        (connState as any).aesiv = aesiv;
        (connState as any).timingLPort = timingLPort;
      }
    }
    
    // Build response plist
    const responseData: Record<string, any> = {};
    
    // For first SETUP, include timingPort and eventPort
    if (hasEkeyEiv) {
      const socketId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
      const connState = this.connections.get(socketId);
      const timingLPort = (connState as any)?.timingLPort || Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;
      responseData.timingPort = timingLPort;
      responseData.eventPort = 0; // Not used in mirror mode
    }
    
    // Process streams array (for both first and second SETUP)
    // UxPlay processes streams after initializing RTP handlers
    const responseStreams: any[] = [];
    
    if (hasStreams) {
      logInfo(`SETUP request includes ${requestData.streams.length} stream(s)`);
      
      for (const reqStream of requestData.streams) {
        const streamType = reqStream.type;
        logDebug(`Processing stream type: ${streamType}`);
        
        if (streamType === 110) {
          // Mirroring (video)
          // UxPlay: raop_rtp_mirror_init_aes + raop_rtp_mirror_start
          const streamConnectionID = reqStream.streamConnectionID || 0;
          logDebug(`Stream type 110 (mirroring): streamConnectionID = ${streamConnectionID}`);
          
          // Get connection state to retrieve aeskey
          const socketId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
          const connState = this.connections.get(socketId);
          const aeskey = (connState as any)?.aeskey;
          
          if (!aeskey) {
            logError(`Cannot initialize mirror stream - aeskey not found in connection state`);
            // Still return a port so client doesn't fail immediately
            const mirrorDataPort = Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;
            responseStreams.push({
              type: 110,
              dataPort: mirrorDataPort,
            });
          } else {
            // Initialize RTP mirror handler
            logInfo(`[FAIRPLAY] Creating RTPMirrorHandler with aeskey: ${aeskey.toString('hex')}`);
            logInfo(`[FAIRPLAY] aeskey length: ${aeskey.length}, streamConnectionID: ${streamConnectionID}`);
            writeToLogFile('INFO', `[FAIRPLAY] Creating RTPMirrorHandler with aeskey: ${aeskey.toString('hex')}`);
            console.log(`[FAIRPLAY] Creating RTPMirrorHandler with aeskey: ${aeskey.toString('hex')}`);
            
            const mirrorHandler = new RTPMirrorHandler(aeskey, streamConnectionID, this);
            try {
              const mirrorDataPort = await mirrorHandler.start();
              
              if (mirrorDataPort > 0) {
                // Store handler in connection state
                if (connState) {
                  (connState as any).rtpMirrorHandler = mirrorHandler;
                }
                
                responseStreams.push({
                  type: 110,
                  dataPort: mirrorDataPort,
                });
                logInfo(`Mirror stream initialized: dataPort=${mirrorDataPort}, streamConnectionID=${streamConnectionID}`);
              } else {
                logError(`Failed to initialize mirror stream - invalid port`);
                const mirrorDataPort = Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;
                responseStreams.push({
                  type: 110,
                  dataPort: mirrorDataPort,
                });
              }
            } catch (err) {
              logError(`Failed to start mirror handler:`, err);
              const mirrorDataPort = Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;
              responseStreams.push({
                type: 110,
                dataPort: mirrorDataPort,
              });
            }
          }
          
        } else if (streamType === 96) {
          // Audio
          // UxPlay: raop_rtp_start_audio
          const controlPort = reqStream.controlPort || 0;
          const ct = reqStream.ct || 0;
          const spf = reqStream.spf || 0;
          const audioFormat = reqStream.audioFormat || 0;
          const isMedia = reqStream.isMedia || false;
          const usingScreen = reqStream.usingScreen || false;
          
          logDebug(`Stream type 96 (audio): controlPort=${controlPort}, ct=${ct}, spf=${spf}, audioFormat=${audioFormat}`);
          
          // Get connection state to retrieve aeskey/aesiv
          const socketId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
          const connState = this.connections.get(socketId);
          const aeskey = (connState as any)?.aeskey;
          const aesiv = (connState as any)?.aesiv;
          
          if (!aeskey || !aesiv) {
            logError(`Cannot initialize audio stream - aeskey/aesiv not found in connection state`);
            // Still return ports so client doesn't fail immediately
            const audioControlPort = Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;
            const audioDataPort = Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;
            responseStreams.push({
              type: 96,
              dataPort: audioDataPort,
              controlPort: audioControlPort,
            });
          } else {
            // Initialize RTP audio handler
            const audioHandler = new RTPAudioHandler(aeskey, aesiv, controlPort, this);
            try {
              const ports = await audioHandler.start();
              
              if (ports.controlPort > 0 && ports.dataPort > 0) {
                // Store handler in connection state
                if (connState) {
                  (connState as any).rtpAudioHandler = audioHandler;
                }
                
                responseStreams.push({
                  type: 96,
                  dataPort: ports.dataPort,
                  controlPort: ports.controlPort,
                });
                logInfo(`Audio stream initialized: controlPort=${ports.controlPort}, dataPort=${ports.dataPort}`);
              } else {
                logError(`Failed to initialize audio stream - invalid ports`);
                const audioControlPort = Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;
                const audioDataPort = Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;
                responseStreams.push({
                  type: 96,
                  dataPort: audioDataPort,
                  controlPort: audioControlPort,
                });
              }
            } catch (err) {
              logError(`Failed to start audio handler:`, err);
              const audioControlPort = Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;
              const audioDataPort = Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;
              responseStreams.push({
                type: 96,
                dataPort: audioDataPort,
                controlPort: audioControlPort,
              });
            }
          }
          
        } else {
          logError(`Unknown stream type: ${streamType}`);
        }
      }
      
      if (responseStreams.length > 0) {
        responseData.streams = responseStreams;
        logInfo(`SETUP response includes ${responseStreams.length} stream(s)`);
      }
    }

    // Create binary plist response
    let responseBody: Buffer;
    try {
      responseBody = bplistCreator(responseData);
      logInfo(`SETUP response created: ${responseBody.length} bytes`);
    } catch (err) {
      logError(`Error creating SETUP response plist:`, err);
      res.writeHead(500, {
        'Content-Type': 'text/plain',
      });
      res.end('Internal Server Error');
      return;
    }

    // Build response headers
    const cseqHeader = req.headers['cseq'] || req.headers['CSeq'];
    const cseq = Array.isArray(cseqHeader) ? cseqHeader[0] : (cseqHeader || '0');
    const responseHeaders: Record<string, string> = {
      'Content-Type': 'application/x-apple-binary-plist',
      'Content-Length': responseBody.length.toString(),
      'Server': 'AirTunes/220.68', // UxPlay uses AirTunes/220.68 for RTSP
      'CSeq': cseq,
      'Audio-Jack-Status': 'connected; type=digital', // Required for RTSP SETUP
    };

    logResponse(res, responseHeaders, responseBody.length, responseBody);
    
    res.writeHead(200, responseHeaders);
    res.end(responseBody);
  }

  private async handleRTSPRecord(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    corsHeaders: Record<string, string>,
    isRTSP: boolean = false
  ): Promise<void> {
    logInfo(`=== HANDLING RTSP RECORD REQUEST ===`);
    
    // UxPlay's raop_handler_record:
    // - Calculates audio latency: ad = (audio_delay_micros * AUDIO_SAMPLE_RATE / SECOND_IN_USECS)
    // - Adds Audio-Latency header
    // - Adds Audio-Jack-Status: "connected; type=analog"
    // - No response body
    
    // Calculate audio latency (stub for now - UxPlay uses actual audio delay)
    // UxPlay: ad = (audio_delay_micros * 44100 / 1000000)
    // For now, use a reasonable default (e.g., 0 or small value)
    const AUDIO_SAMPLE_RATE = 44100;
    const SECOND_IN_USECS = 1000000;
    const audioDelayMicros = 0; // TODO: Use actual audio delay from session
    const audioLatency = Math.floor((audioDelayMicros * AUDIO_SAMPLE_RATE) / SECOND_IN_USECS);
    
    logDebug(`Audio latency: ${audioLatency} (calculated from ${audioDelayMicros} microseconds)`);
    
    // Build response headers
    const cseqHeader = req.headers['cseq'] || req.headers['CSeq'];
    const cseq = Array.isArray(cseqHeader) ? cseqHeader[0] : (cseqHeader || '0');
    const responseHeaders: Record<string, string> = {
      'Audio-Latency': audioLatency.toString(),
      'Audio-Jack-Status': 'connected; type=analog', // UxPlay uses "analog" for RECORD
      'Server': 'AirTunes/220.68',
      'CSeq': cseq,
    };
    
    logInfo(`RECORD response headers:`, responseHeaders);
    
    // RTSP RECORD response: 200 OK with no body
    res.writeHead(200, responseHeaders);
    res.end();
  }

  private async handleRTSPFeedback(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    corsHeaders: Record<string, string>,
    isRTSP: boolean = false
  ): Promise<void> {
    logInfo(`=== HANDLING RTSP FEEDBACK REQUEST ===`);
    
    // UxPlay's raop_handler_feedback:
    // - Just logs and calls callback (heartbeat/keepalive)
    // - Returns 200 OK with no body
    
    logDebug(`RTSP feedback received (client heartbeat)`);
    
    // Build response headers
    const cseqHeader = req.headers['cseq'] || req.headers['CSeq'];
    const cseq = Array.isArray(cseqHeader) ? cseqHeader[0] : (cseqHeader || '0');
    const responseHeaders: Record<string, string> = {
      'Server': 'AirTunes/220.68',
      'CSeq': cseq,
    };
    
    // RTSP feedback response: 200 OK with no body
    res.writeHead(200, responseHeaders);
    res.end();
  }

  private async handleFPSetup(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    corsHeaders: Record<string, string>,
    isRTSP: boolean = false,
    method?: string
  ): Promise<void> {
    logInfo(`[FAIRPLAY] === HANDLING FP-SETUP REQUEST ===`);
    logInfo(`isRTSP: ${isRTSP}`);
    
    // Re-detect RTSP here since we have more context
    const hasCSeqHeader = req.headers['cseq'] !== undefined || req.headers['CSeq'] !== undefined;
    const hasXAppleSessionID = req.headers['x-apple-session-id'] !== undefined || req.headers['X-Apple-Session-ID'] !== undefined;
    const isActuallyRTSP = isRTSP || (hasCSeqHeader && !hasXAppleSessionID);
    
    logInfo(`isRTSP (detected): ${isActuallyRTSP}`);
    logInfo(`hasCSeqHeader: ${hasCSeqHeader}, hasXAppleSessionID: ${hasXAppleSessionID}`);
    
    // Read request body (binary FairPlay data)
    let requestBody: Buffer | null = null;
    if (req.headers['content-length'] && parseInt(req.headers['content-length']) > 0) {
      const body: Buffer[] = [];
      for await (const chunk of req) {
        body.push(chunk);
      }
      requestBody = Buffer.concat(body);
      logInfo(`FP-setup request body received: ${requestBody.length} bytes`);
      logDebug(`Request body preview (hex): ${requestBody.toString('hex').substring(0, 100)}`);
      logDebug(`Request body preview (ascii): ${requestBody.toString('ascii', 0, Math.min(32, requestBody.length))}`);
    } else {
      logError(`FP-setup request has no body (content-length: ${req.headers['content-length']})`);
      res.writeHead(400, {
        'Content-Type': 'text/plain',
      ...corsHeaders,
    });
      res.end('Bad Request: Missing body');
      return;
    }

    // UxPlay handles two cases:
    // 1. 16 bytes -> fairplay_setup -> 142 bytes response
    // 2. 164 bytes -> fairplay_handshake -> 32 bytes response
    let responseBody: Buffer;
    
    if (requestBody.length === 16) {
      logInfo(`FP-setup: Initial setup (16 bytes) -> returning 142 bytes`);
      
      // Check FairPlay version (must be 0x03)
      if (requestBody[4] !== 0x03) {
        logError(`Unsupported FairPlay version: 0x${requestBody[4].toString(16)} (expected 0x03)`);
        res.writeHead(400, {
          'Content-Type': 'text/plain',
      ...corsHeaders,
    });
        res.end('Bad Request: Unsupported FairPlay version');
        return;
      }
      
      // Extract mode from request (byte 14)
      const mode = requestBody[14];
      logDebug(`FairPlay mode: ${mode}`);
      
      // UxPlay uses predefined reply messages based on mode (0-3)
      // These are the actual FairPlay setup responses from UxPlay's fairplay_playfair.c
      const replyMessages = [
        // Mode 0
        Buffer.from([
          0x46, 0x50, 0x4c, 0x59, 0x03, 0x01, 0x02, 0x00, 0x00, 0x00, 0x00, 0x82, 0x02, 0x00, 0x0f, 0x9f,
          0x3f, 0x9e, 0x0a, 0x25, 0x21, 0xdb, 0xdf, 0x31, 0x2a, 0xb2, 0xbf, 0xb2, 0x9e, 0x8d, 0x23, 0x2b,
          0x63, 0x76, 0xa8, 0xc8, 0x18, 0x70, 0x1d, 0x22, 0xae, 0x93, 0xd8, 0x27, 0x37, 0xfe, 0xaf, 0x9d,
          0xb4, 0xfd, 0xf4, 0x1c, 0x2d, 0xba, 0x9d, 0x1f, 0x49, 0xca, 0xaa, 0xbf, 0x65, 0x91, 0xac, 0x1f,
          0x7b, 0xc6, 0xf7, 0xe0, 0x66, 0x3d, 0x21, 0xaf, 0xe0, 0x15, 0x65, 0x95, 0x3e, 0xab, 0x81, 0xf4,
          0x18, 0xce, 0xed, 0x09, 0x5a, 0xdb, 0x7c, 0x3d, 0x0e, 0x25, 0x49, 0x09, 0xa7, 0x98, 0x31, 0xd4,
          0x9c, 0x39, 0x82, 0x97, 0x34, 0x34, 0xfa, 0xcb, 0x42, 0xc6, 0x3a, 0x1c, 0xd9, 0x11, 0xa6, 0xfe,
          0x94, 0x1a, 0x8a, 0x6d, 0x4a, 0x74, 0x3b, 0x46, 0xc3, 0xa7, 0x64, 0x9e, 0x44, 0xc7, 0x89, 0x55,
          0xe4, 0x9d, 0x81, 0x55, 0x00, 0x95, 0x49, 0xc4, 0xe2, 0xf7, 0xa3, 0xf6, 0xd5, 0xba
        ]),
        // Mode 1
        Buffer.from([
          0x46, 0x50, 0x4c, 0x59, 0x03, 0x01, 0x02, 0x00, 0x00, 0x00, 0x00, 0x82, 0x02, 0x01, 0xcf, 0x32,
          0xa2, 0x57, 0x14, 0xb2, 0x52, 0x4f, 0x8a, 0xa0, 0xad, 0x7a, 0xf1, 0x64, 0xe3, 0x7b, 0xcf, 0x44,
          0x24, 0xe2, 0x00, 0x04, 0x7e, 0xfc, 0x0a, 0xd6, 0x7a, 0xfc, 0xd9, 0x5d, 0xed, 0x1c, 0x27, 0x30,
          0xbb, 0x59, 0x1b, 0x96, 0x2e, 0xd6, 0x3a, 0x9c, 0x4d, 0xed, 0x88, 0xba, 0x8f, 0xc7, 0x8d, 0xe6,
          0x4d, 0x91, 0xcc, 0xfd, 0x5c, 0x7b, 0x56, 0xda, 0x88, 0xe3, 0x1f, 0x5c, 0xce, 0xaf, 0xc7, 0x43,
          0x19, 0x95, 0xa0, 0x16, 0x65, 0xa5, 0x4e, 0x19, 0x39, 0xd2, 0x5b, 0x94, 0xdb, 0x64, 0xb9, 0xe4,
          0x5d, 0x8d, 0x06, 0x3e, 0x1e, 0x6a, 0xf0, 0x7e, 0x96, 0x56, 0x16, 0x2b, 0x0e, 0xfa, 0x40, 0x42,
          0x75, 0xea, 0x5a, 0x44, 0xd9, 0x59, 0x1c, 0x72, 0x56, 0xb9, 0xfb, 0xe6, 0x51, 0x38, 0x98, 0xb8,
          0x02, 0x27, 0x72, 0x19, 0x88, 0x57, 0x16, 0x50, 0x94, 0x2a, 0xd9, 0x46, 0x68, 0x8a
        ]),
        // Mode 2
        Buffer.from([
          0x46, 0x50, 0x4c, 0x59, 0x03, 0x01, 0x02, 0x00, 0x00, 0x00, 0x00, 0x82, 0x02, 0x02, 0xc1, 0x69,
          0xa3, 0x52, 0xee, 0xed, 0x35, 0xb1, 0x8c, 0xdd, 0x9c, 0x58, 0xd6, 0x4f, 0x16, 0xc1, 0x51, 0x9a,
          0x89, 0xeb, 0x53, 0x17, 0xbd, 0x0d, 0x43, 0x36, 0xcd, 0x68, 0xf6, 0x38, 0xff, 0x9d, 0x01, 0x6a,
          0x5b, 0x52, 0xb7, 0xfa, 0x92, 0x16, 0xb2, 0xb6, 0x54, 0x82, 0xc7, 0x84, 0x44, 0x11, 0x81, 0x21,
          0xa2, 0xc7, 0xfe, 0xd8, 0x3d, 0xb7, 0x11, 0x9e, 0x91, 0x82, 0xaa, 0xd7, 0xd1, 0x8c, 0x70, 0x63,
          0xe2, 0xa4, 0x57, 0x55, 0x59, 0x10, 0xaf, 0x9e, 0x0e, 0xfc, 0x76, 0x34, 0x7d, 0x16, 0x40, 0x43,
          0x80, 0x7f, 0x58, 0x1e, 0xe4, 0xfb, 0xe4, 0x2c, 0xa9, 0xde, 0xdc, 0x1b, 0x5e, 0xb2, 0xa3, 0xaa,
          0x3d, 0x2e, 0xcd, 0x59, 0xe7, 0xee, 0xe7, 0x0b, 0x36, 0x29, 0xf2, 0x2a, 0xfd, 0x16, 0x1d, 0x87,
          0x73, 0x53, 0xdd, 0xb9, 0x9a, 0xdc, 0x8e, 0x07, 0x00, 0x6e, 0x56, 0xf8, 0x50, 0xce
        ]),
        // Mode 3
        Buffer.from([
          0x46, 0x50, 0x4c, 0x59, 0x03, 0x01, 0x02, 0x00, 0x00, 0x00, 0x00, 0x82, 0x02, 0x03, 0x90, 0x01,
          0xe1, 0x72, 0x7e, 0x0f, 0x57, 0xf9, 0xf5, 0x88, 0x0d, 0xb1, 0x04, 0xa6, 0x25, 0x7a, 0x23, 0xf5,
          0xcf, 0xff, 0x1a, 0xbb, 0xe1, 0xe9, 0x30, 0x45, 0x25, 0x1a, 0xfb, 0x97, 0xeb, 0x9f, 0xc0, 0x01,
          0x1e, 0xbe, 0x0f, 0x3a, 0x81, 0xdf, 0x5b, 0x69, 0x1d, 0x76, 0xac, 0xb2, 0xf7, 0xa5, 0xc7, 0x08,
          0xe3, 0xd3, 0x28, 0xf5, 0x6b, 0xb3, 0x9d, 0xbd, 0xe5, 0xf2, 0x9c, 0x8a, 0x17, 0xf4, 0x81, 0x48,
          0x7e, 0x3a, 0xe8, 0x63, 0xc6, 0x78, 0x32, 0x54, 0x22, 0xe6, 0xf7, 0x8e, 0x16, 0x6d, 0x18, 0xaa,
          0x7f, 0xd6, 0x36, 0x25, 0x8b, 0xce, 0x28, 0x72, 0x6f, 0x66, 0x1f, 0x73, 0x88, 0x93, 0xce, 0x44,
          0x31, 0x1e, 0x4b, 0xe6, 0xc0, 0x53, 0x51, 0x93, 0xe5, 0xef, 0x72, 0xe8, 0x68, 0x62, 0x33, 0x72,
          0x9c, 0x22, 0x7d, 0x82, 0x0c, 0x99, 0x94, 0x45, 0xd8, 0x92, 0x46, 0xc8, 0xc3, 0x59
        ]),
      ];
      
      // Select response based on mode (default to mode 0 if invalid)
      const selectedMode = mode >= 0 && mode < replyMessages.length ? mode : 0;
      responseBody = replyMessages[selectedMode];
      
      logDebug(`Generated FP-setup response (142 bytes) for mode ${selectedMode}`);
    } else if (requestBody.length === 164) {
      logInfo(`FP-setup: Handshake (164 bytes) -> returning 32 bytes`);
      
      // Check FairPlay version (must be 0x03)
      if (requestBody[4] !== 0x03) {
        logError(`Unsupported FairPlay version: 0x${requestBody[4].toString(16)} (expected 0x03)`);
        res.writeHead(400, {
          'Content-Type': 'text/plain',
          ...corsHeaders,
        });
        res.end('Bad Request: Unsupported FairPlay version');
        return;
      }
      
      // UxPlay stores the 164-byte key message for later use in fairplay_decrypt
      // Store it in connection state (matching UxPlay's fp->keymsg)
      const socketId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
      writeToLogFile('INFO', `[FAIRPLAY] Storing key message for socket ${socketId}`);
      console.log(`[FAIRPLAY] Storing key message for socket ${socketId}`);
      logInfo(`[FAIRPLAY] Storing key message for socket ${socketId}`);
      
      // Get or create connection state
      let connState = this.connections.get(socketId);
      if (!connState) {
        // Create connection state if it doesn't exist
        writeToLogFile('INFO', `[FAIRPLAY] Creating new connection state for socket ${socketId}`);
        console.log(`[FAIRPLAY] Creating new connection state for socket ${socketId}`);
        logInfo(`[FAIRPLAY] Creating new connection state for socket ${socketId}`);
        connState = {
          type: 'UNKNOWN',
          socket: req.socket,
          remoteAddress: req.socket.remoteAddress,
          remotePort: req.socket.remotePort,
          createdAt: Date.now(),
        };
        this.connections.set(socketId, connState);
      }
      
      // Store the key message (164 bytes) - needed to decrypt ekey later
      (connState as any).fairplayKeyMsg = Buffer.from(requestBody);
      writeToLogFile('INFO', `[FAIRPLAY] Stored FairPlay key message (164 bytes) for connection ${socketId}`);
      console.log(`[FAIRPLAY] Stored FairPlay key message (164 bytes) for connection ${socketId}`);
      logInfo(`[FAIRPLAY] Stored FairPlay key message (164 bytes) for connection ${socketId}`);
      
      writeToLogFile('INFO', `[FAIRPLAY] Key message (first 32 bytes): ${requestBody.slice(0, 32).toString('hex')}`);
      console.log(`[FAIRPLAY] Key message (first 32 bytes): ${requestBody.slice(0, 32).toString('hex')}`);
      logInfo(`[FAIRPLAY] Key message (first 32 bytes): ${requestBody.slice(0, 32).toString('hex')}`);
      
      writeToLogFile('INFO', `[FAIRPLAY] Connection state now has keys: ${Object.keys(connState).join(', ')}`);
      console.log(`[FAIRPLAY] Connection state now has keys: ${Object.keys(connState).join(', ')}`);
      logInfo(`[FAIRPLAY] Connection state now has keys: ${Object.keys(connState).join(', ')}`);
      
      writeToLogFile('INFO', `[FAIRPLAY] Total connections: ${this.connections.size}, all socket IDs: ${Array.from(this.connections.keys()).join(', ')}`);
      console.log(`[FAIRPLAY] Total connections: ${this.connections.size}, all socket IDs: ${Array.from(this.connections.keys()).join(', ')}`);
      logInfo(`[FAIRPLAY] Total connections: ${this.connections.size}, all socket IDs: ${Array.from(this.connections.keys()).join(', ')}`);
      
      // UxPlay handshake response: fp_header (12 bytes) + req[144:164] (20 bytes) = 32 bytes
      // fp_header = {0x46, 0x50, 0x4c, 0x59, 0x03, 0x01, 0x04, 0x00, 0x00, 0x00, 0x00, 0x14}
      const fpHeader = Buffer.from([
        0x46, 0x50, 0x4c, 0x59, 0x03, 0x01, 0x04, 0x00, 0x00, 0x00, 0x00, 0x14
      ]);
      
      // Copy last 20 bytes from request (bytes 144-164)
      const requestSuffix = requestBody.slice(144, 164);
      
      responseBody = Buffer.concat([fpHeader, requestSuffix]);
      
      logDebug(`Generated FP-handshake response (32 bytes)`);
    } else {
      logError(`Invalid fp-setup data length: ${requestBody.length} (expected 16 or 164)`);
      res.writeHead(400, {
        'Content-Type': 'text/plain',
        ...corsHeaders,
      });
      res.end('Bad Request: Invalid data length');
      return;
    }

    // Build response headers
    const cseqHeader = req.headers['cseq'] || req.headers['CSeq'];
    const cseq = Array.isArray(cseqHeader) ? cseqHeader[0] : (cseqHeader || '0');
    const responseHeaders: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': responseBody.length.toString(),
      'Server': isActuallyRTSP ? 'AirTunes/220.68' : 'AirPlay/220.68', // UxPlay uses AirTunes/220.68 for RTSP
      'CSeq': cseq,
    };
    
    // Add RTSP-specific headers
    if (isActuallyRTSP) {
      // Add Audio-Jack-Status header for RTSP requests (UxPlay line 336)
      // This is CRITICAL - RTSP responses MUST include this header
      if (hasCSeqHeader) {
        responseHeaders['Audio-Jack-Status'] = 'connected; type=digital';
        logDebug(`Added Audio-Jack-Status header for RTSP request`);
      }
    }

    logResponse(res, responseHeaders, responseBody.length, responseBody);
    logDebug(`FP-setup response body preview (hex): ${responseBody.toString('hex').substring(0, 100)}`);
    
    res.writeHead(200, responseHeaders);
    res.end(responseBody);
  }

  private plistEncode(obj: Record<string, unknown>): string {
    // Simple PLIST encoding (basic implementation)
    // In production, use a proper PLIST library like plist
    const escapeXml = (str: string): string => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    const entries = Object.entries(obj).map(([key, value]) => {
      const escapedKey = escapeXml(String(key));
      const escapedValue = escapeXml(String(value));
      return `  <key>${escapedKey}</key>\n  <string>${escapedValue}</string>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${entries}
</dict>
</plist>`;
  }

  private sendStatusUpdate(updates?: Partial<AirPlayServerStatus>): void {
    if (!this.mainWindow) return;

    const status: AirPlayServerStatus = {
      status: this.status,
      pairingCode: this.pairingCode || undefined,
      ...updates,
    };

    this.mainWindow.webContents.send('airplay:status-update', status);
  }

  /**
   * Send video frame to renderer process for decoding and rendering
   * Matching UxPlay's video_process callback
   */
  public sendVideoFrame(data: {
    isH265: boolean;
    nalCount: number;
    data: Buffer;
    ntpTimeLocal: bigint;
    ntpTimeRemote: bigint;
  }): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      logDebug(`[VIDEO_IPC] Cannot send video frame - mainWindow is null or destroyed`);
      return;
    }

    // Send video data to renderer (as base64 for IPC)
    // Renderer will decode H.264/H.265 and render frames
    const base64Data = data.data.toString('base64');
    logInfo(`[VIDEO_IPC] Sending video frame to renderer: ${data.nalCount} NAL units, ${data.data.length} bytes, isH265=${data.isH265}`);
    
    this.mainWindow.webContents.send('airplay:video-frame', {
      isH265: data.isH265,
      nalCount: data.nalCount,
      data: base64Data,
      ntpTimeLocal: data.ntpTimeLocal.toString(),
      ntpTimeRemote: data.ntpTimeRemote.toString(),
    });
  }

  /**
   * Send audio frame to renderer process for decoding and playback
   * Matching UxPlay's audio_process callback
   */
  public sendAudioFrame(data: {
    data: Buffer;
    ct: number;
    syncStatus: number;
    ntpTimeLocal: bigint;
    ntpTimeRemote: bigint;
    rtpTime: number;
    seqnum: number;
  }): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    // Send audio data to renderer (as base64 for IPC)
    // Renderer will decode AAC-ELD/ALAC and play via Web Audio API
    this.mainWindow.webContents.send('airplay:audio-frame', {
      data: data.data.toString('base64'),
      ct: data.ct,
      syncStatus: data.syncStatus,
      ntpTimeLocal: data.ntpTimeLocal.toString(),
      ntpTimeRemote: data.ntpTimeRemote.toString(),
      rtpTime: data.rtpTime,
      seqnum: data.seqnum,
    });
  }

  /**
   * Set up raw socket parser for RTSP requests after first response
   * Node.js HTTP parser won't parse subsequent RTSP requests after we bypass response handling
   */
  private setupRTSPParser(socket: any, socketId: string): void {
    // Check if parser is already set up for this socket
    if ((socket as any)._rtspParserSetup) {
      logDebug(`[RTSP_PARSER] Parser already set up for socket ${socketId}, skipping`);
      return;
    }
    
    // Mark socket as having parser set up
    (socket as any)._rtspParserSetup = true;
    
    // Remove Node.js HTTP parser's data listener
    socket.removeAllListeners('data');
    
    let buffer = Buffer.alloc(0);
    let headersComplete = false;
    let contentLength = 0;
    let bodyReceived = 0;
    // Store request state for when body arrives in chunks
    let currentMethod = '';
    let currentUrl = '';
    let currentProtocol = '';
    let currentHeaders: Record<string, string> = {};
    
    const parseRTSPRequest = (data: Buffer): void => {
      buffer = Buffer.concat([buffer, data]);
      
      // Parse request line: METHOD URL PROTOCOL\r\n
      if (!headersComplete) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) {
          // Headers not complete yet, wait for more data
          return;
        }
        
        const headerBlock = buffer.slice(0, headerEnd);
        const headerLines = headerBlock.toString('utf8').split('\r\n');
        
        // Parse request line
        const requestLine = headerLines[0];
        const parts = requestLine.split(' ');
        if (parts.length < 3) {
          logError(`[RTSP_PARSER] Invalid request line: ${requestLine}`);
          return;
        }
        
        currentMethod = parts[0];
        currentUrl = parts[1];
        currentProtocol = parts[2];
        
        logInfo(`[RTSP_PARSER] Parsed request: ${currentMethod} ${currentUrl} ${currentProtocol}`);
        
        // Parse headers
        currentHeaders = {};
        for (let i = 1; i < headerLines.length; i++) {
          const line = headerLines[i];
          const colonIndex = line.indexOf(':');
          if (colonIndex > 0) {
            const key = line.slice(0, colonIndex).trim().toLowerCase();
            const value = line.slice(colonIndex + 1).trim();
            currentHeaders[key] = value;
          }
        }
        
        // Get content length
        contentLength = parseInt(currentHeaders['content-length'] || '0', 10);
        headersComplete = true;
        
        // Check if we have the body already
        const bodyStart = headerEnd + 4;
        const bodyData = buffer.slice(bodyStart);
        
        if (bodyData.length >= contentLength) {
          // We have the full request, process it
          const body = bodyData.slice(0, contentLength);
          buffer = bodyData.slice(contentLength);
          headersComplete = false;
          bodyReceived = 0;
          
          this.handleRTSPRequest(socket, socketId, currentMethod, currentUrl, currentProtocol, currentHeaders, body);
          
          // If there's more data in buffer, parse next request
          if (buffer.length > 0) {
            parseRTSPRequest(Buffer.alloc(0));
          }
        } else {
          // Need more data for body - store what we have so far
          bodyReceived = bodyData.length;
          buffer = bodyData;
        }
      } else {
        // Headers complete, receiving body
        bodyReceived += buffer.length;
        
        if (bodyReceived >= contentLength) {
          const body = buffer.slice(0, contentLength);
          buffer = buffer.slice(contentLength);
          headersComplete = false;
          bodyReceived = 0;
          
          // Process the request with stored state
          this.handleRTSPRequest(socket, socketId, currentMethod, currentUrl, currentProtocol, currentHeaders, body);
          
          // If there's more data in buffer, parse next request
          if (buffer.length > 0) {
            parseRTSPRequest(Buffer.alloc(0));
          }
        }
      }
    };
    
    socket.on('data', (data: Buffer) => {
      logDebug(`[RTSP_PARSER] Received ${data.length} bytes on socket ${socketId}`);
      parseRTSPRequest(data);
    });
    
    socket.on('error', (err: Error) => {
      logError(`[RTSP_PARSER] Socket error on ${socketId}:`, err);
      this.connections.delete(socketId);
    });
    
    socket.on('close', () => {
      logInfo(`[RTSP_PARSER] Socket closed: ${socketId}`);
      this.connections.delete(socketId);
    });
    
    // Resume socket to start receiving data
    socket.resume();
    logInfo(`[RTSP_PARSER] Raw socket parser set up for socket ${socketId}`);
  }
  
  /**
   * Handle parsed RTSP request from raw socket parser
   */
  private handleRTSPRequest(
    socket: any,
    socketId: string,
    method: string,
    url: string,
    protocol: string,
    headers: Record<string, string>,
    body: Buffer
  ): void {
    logInfo(`[RTSP_PARSER] Handling RTSP request: ${method} ${url}`);
    
    // Create mock IncomingMessage that supports async iteration
    // Node.js IncomingMessage implements Symbol.asyncIterator for for-await-of loops
    const req = {
      method,
      url,
      headers,
      socket,
      httpVersion: '1.0',
      httpVersionMajor: 1,
      httpVersionMinor: 0,
      rawHeaders: Object.entries(headers).flat(),
      on: (event: string, handler: Function) => {
        if (event === 'data' && body.length > 0) {
          // Emit body data
          setImmediate(() => handler(body));
        }
        if (event === 'end') {
          setImmediate(() => handler());
        }
      },
      readable: true,
      readableLength: body.length,
      // Implement async iterator for for-await-of loops
      [Symbol.asyncIterator]: async function* () {
        if (body.length > 0) {
          yield body;
        }
      },
    } as any;
    
    // Create mock ServerResponse that writes RTSP responses
    const res = {
      socket,
      shouldKeepAlive: true,
      writeHead: (statusCode: number, responseHeaders?: Record<string, string>) => {
        logInfo(`[RTSP_PARSER] writeHead called: ${statusCode}`);
        // Store headers for write/end
        (res as any)._statusCode = statusCode;
        (res as any)._headers = responseHeaders || {};
      },
      write: (chunk: Buffer | string) => {
        const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        logDebug(`[RTSP_PARSER] write called: ${chunkBuffer.length} bytes`);
        // Store chunks for end()
        if (!(res as any)._bodyChunks) {
          (res as any)._bodyChunks = [];
        }
        (res as any)._bodyChunks.push(chunkBuffer);
        return true;
      },
      end: (chunk?: Buffer | string) => {
        // Prevent double writes - if response already sent, return early
        if ((res as any)._responseSent) {
          logDebug(`[RTSP_PARSER] Response already sent, ignoring duplicate end() call`);
          return;
        }
        
        const statusCode = (res as any)._statusCode || 200;
        const responseHeaders = (res as any)._headers || {};
        const bodyChunks = (res as any)._bodyChunks || [];
        
        if (chunk) {
          const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bodyChunks.push(chunkBuffer);
        }
        
        const responseBody = Buffer.concat(bodyChunks);
        
        // Mark response as sent before writing
        (res as any)._responseSent = true;
        
        // Ensure Server header is present (UxPlay always includes it for RTSP)
        if (!responseHeaders['Server'] && !responseHeaders['server']) {
          responseHeaders['Server'] = 'AirTunes/220.68';
        }
        
        // Add Audio-Jack-Status header for RTSP requests (UxPlay always includes this)
        // UxPlay log shows: Audio-Jack-Status: connected; type=digital
        if (!responseHeaders['Audio-Jack-Status'] && !responseHeaders['audio-jack-status']) {
          responseHeaders['Audio-Jack-Status'] = 'connected; type=digital';
        }
        
        // Write RTSP response manually
        // UxPlay's http_response_finish adds headers in this exact order (from log):
        // 1. Audio-Jack-Status (from raop.c line 336)
        // 2. Content-Type (from handler)
        // 3. Server (from raop.c)
        // 4. CSeq (from raop.c)
        // 5. Content-Length (added by http_response_finish, then \r\n\r\n)
        // Match this exact order
        const orderedHeaders: string[] = [];
        
        // First: Audio-Jack-Status (from raop.c)
        if (responseHeaders['Audio-Jack-Status'] || responseHeaders['audio-jack-status']) {
          orderedHeaders.push(`Audio-Jack-Status: ${responseHeaders['Audio-Jack-Status'] || responseHeaders['audio-jack-status']}`);
        }
        
        // Second: Content-Type (added by handler)
        if (responseHeaders['Content-Type'] || responseHeaders['content-type']) {
          orderedHeaders.push(`Content-Type: ${responseHeaders['Content-Type'] || responseHeaders['content-type']}`);
        }
        
        // Third: Server (added by raop.c)
        if (responseHeaders['Server'] || responseHeaders['server']) {
          orderedHeaders.push(`Server: ${responseHeaders['Server'] || responseHeaders['server']}`);
        }
        
        // Fourth: CSeq (added by raop.c)
        if (responseHeaders['CSeq'] || responseHeaders['cseq']) {
          orderedHeaders.push(`CSeq: ${responseHeaders['CSeq'] || responseHeaders['cseq']}`);
        }
        
        // Fifth: Content-Length (added by http_response_finish)
        if (responseHeaders['Content-Length'] || responseHeaders['content-length']) {
          orderedHeaders.push(`Content-Length: ${responseHeaders['Content-Length'] || responseHeaders['content-length']}`);
        }
        
        // Add any other headers (shouldn't be any for RTSP, but just in case)
        for (const [key, value] of Object.entries(responseHeaders)) {
          const lowerKey = key.toLowerCase();
          if (lowerKey !== 'audio-jack-status' && lowerKey !== 'content-type' && lowerKey !== 'server' && lowerKey !== 'cseq' && lowerKey !== 'content-length') {
            orderedHeaders.push(`${key}: ${value}`);
          }
        }
        
        const statusLine = `RTSP/1.0 ${statusCode} OK\r\n`;
        const headerLines = orderedHeaders.join('\r\n');
        const headerBlock = Buffer.from(`${statusLine}${headerLines}\r\n\r\n`, 'utf8');
        
        logInfo(`[RTSP_PARSER] Writing RTSP response: ${statusCode}`);
        logDebug(`[RTSP_PARSER] Headers: ${headerLines}`);
        logDebug(`[RTSP_PARSER] Body size: ${responseBody.length} bytes`);
        logDebug(`[RTSP_PARSER] Header block size: ${headerBlock.length} bytes`);
        if (responseBody.length > 0) {
          logDebug(`[RTSP_PARSER] Response body preview (hex): ${responseBody.toString('hex').substring(0, 64)}...`);
        }
        
        // Write response atomically (headers + body together)
        const fullResponse = Buffer.concat([headerBlock, responseBody]);
        
        // Check if socket is writable before writing
        if (socket.destroyed) {
          logError(`[RTSP_PARSER] Cannot write response - socket is destroyed`);
          return;
        }
        if (!socket.writable) {
          logError(`[RTSP_PARSER] Cannot write response - socket is not writable (writable: ${socket.writable}, readable: ${socket.readable}, destroyed: ${socket.destroyed})`);
          return;
        }
        
        try {
          socket.write(fullResponse, (err) => {
            if (err) {
              logError(`[RTSP_PARSER] Error writing response:`, err);
            }
          });
          
          logInfo(`[RTSP_PARSER] Response sent: ${statusCode}, total ${fullResponse.length} bytes (headers: ${headerBlock.length}, body: ${responseBody.length})`);
          
          // Ensure socket stays open and readable for next request
          if (!socket.destroyed && socket.readable) {
            socket.resume();
            logDebug(`[RTSP_PARSER] Socket resumed, ready for next request`);
          } else {
            logError(`[RTSP_PARSER] Socket is destroyed or not readable after response!`);
          }
        } catch (err) {
          logError(`[RTSP_PARSER] Exception writing response:`, err);
        }
        
        // Don't set up parser again - it's already set up and will handle the next request
        // The parser is persistent and will continue listening for data
        // We only set it up once after the first response, then it persists
        logDebug(`[RTSP_PARSER] Response complete, parser will handle next request`);
        
        return true;
      },
      on: () => {},
      emit: () => {},
      finished: false,
      _headerSent: false,
    } as any;
    
    // Handle the request using existing handler
    this.handleRequest(req, res);
  }
}

/**
 * RTP Mirror Handler for video streaming (TCP)
 * Matches UxPlay's raop_rtp_mirror implementation
 */
class RTPMirrorHandler {
  private server: net.Server | null = null;
  private clientSocket: net.Socket | null = null;
  private aesKey: Buffer;
  private aesIV: Buffer;
  private streamConnectionID: number;
  private dataPort: number = 0;
  private running: boolean = false;
  private nextDecryptCount: number = 0; // For handling partial blocks (matching UxPlay's mirror_buffer)
  private overflowBuffer: Buffer = Buffer.alloc(16); // For partial block decryption
  private spsPpsBuffer: Buffer | null = null; // Store SPS/PPS for prepending to IDR frames
  private spsPpsLength: number = 0;
  private lastNtpTimestamp: bigint = BigInt(0);
  private ctrCounter: Buffer; // Track CTR counter state (increments for each block)
  private ctrCipher: ReturnType<typeof crypto.createCipheriv> | null = null; // Maintain cipher state across packets
  private airplayServer: AirPlayServer; // Reference to parent server for IPC
  private isH265: boolean = false; // Track video codec (H.264 or H.265)

  constructor(aeskey: Buffer, streamConnectionID: number, airplayServer: AirPlayServer) {
    // Store original FairPlay-decrypted aeskey for logging
    const originalAeskey = aeskey;
    this.streamConnectionID = streamConnectionID;
    
    // Derive AES-CTR key and IV from streamConnectionID (matching UxPlay's mirror_buffer_init_aes)
    // UxPlay: "AirPlayStreamKey{streamConnectionID}" + aeskey_audio -> SHA512 -> first 16 bytes
    // UxPlay: "AirPlayStreamIV{streamConnectionID}" + aeskey_audio -> SHA512 -> first 16 bytes
    // CRITICAL: UxPlay uses PRIu64 (unsigned 64-bit), so convert negative values to unsigned
    // Convert to unsigned 64-bit to match UxPlay's behavior
    // JavaScript numbers are 64-bit floats, but we need to handle negative 32-bit ints as unsigned 64-bit
    // For negative numbers, convert to unsigned 64-bit: (value >>> 0) gives unsigned 32-bit, but we need 64-bit
    // Actually, for string formatting, we can use BigInt to get proper 64-bit unsigned representation
    let unsignedStreamConnectionID: string;
    if (streamConnectionID < 0) {
      // Convert negative 32-bit int to unsigned 64-bit: add 2^32
      const unsigned64 = BigInt(streamConnectionID) + BigInt(0x100000000);
      unsignedStreamConnectionID = unsigned64.toString();
    } else {
      unsignedStreamConnectionID = streamConnectionID.toString();
    }
    const keyString = `AirPlayStreamKey${unsignedStreamConnectionID}`;
    const ivString = `AirPlayStreamIV${unsignedStreamConnectionID}`;
    
    writeToLogFile('INFO', `RTPMirrorHandler: streamConnectionID (signed): ${streamConnectionID}, (unsigned64): ${unsignedStreamConnectionID}`);
    console.log(`RTPMirrorHandler: streamConnectionID (signed): ${streamConnectionID}, (unsigned64): ${unsignedStreamConnectionID}`);
    logInfo(`RTPMirrorHandler: streamConnectionID (signed): ${streamConnectionID}, (unsigned64): ${unsignedStreamConnectionID}`);
    
    writeToLogFile('INFO', `RTPMirrorHandler: keyString: ${keyString}`);
    console.log(`RTPMirrorHandler: keyString: ${keyString}`);
    logInfo(`RTPMirrorHandler: keyString: ${keyString}`);
    
    // CRITICAL: Log to file immediately
    const logMsg = `RTPMirrorHandler: Initializing with FairPlay aeskey: ${originalAeskey.toString('hex')}`;
    writeToLogFile('INFO', logMsg);
    console.log(logMsg);
    logInfo(logMsg);
    
    writeToLogFile('INFO', `RTPMirrorHandler: streamConnectionID: ${streamConnectionID}`);
    console.log(`RTPMirrorHandler: streamConnectionID: ${streamConnectionID}`);
    logInfo(`RTPMirrorHandler: streamConnectionID: ${streamConnectionID}`);
    
    // Verify aeskey is valid (not random stub)
    if (originalAeskey.length !== 16) {
      const errMsg = `[CRITICAL] Invalid aeskey length: ${originalAeskey.length} (expected 16)`;
      writeToLogFile('ERROR', errMsg);
      console.error(errMsg);
      logError(errMsg);
    }
    
    // Check if aeskey is all zeros or random-looking (stub key)
    const isStubKey = originalAeskey.every(b => b === 0) || 
                      originalAeskey.toString('hex').match(/^[0-9a-f]{32}$/i) === null;
    if (isStubKey) {
      const warnMsg = `[CRITICAL] aeskey appears to be stub/random: ${originalAeskey.toString('hex')}`;
      writeToLogFile('ERROR', warnMsg);
      console.error(warnMsg);
      logError(warnMsg);
    }
    
    // CRITICAL: UxPlay uses strlen() to get the string length, then hashes:
    // sha_update(ctx, aeskey_video, strlen((char*) aeskey_video));  // String only
    // sha_update(ctx, mirror_buffer->aeskey_audio, RAOP_AESKEY_LEN);  // Then the 16-byte key
    // In Node.js, update() with a string will UTF-8 encode it (which matches ASCII for these strings)
    // But we need to make sure we're using the string bytes, not the full buffer
    const keyStringBytes = Buffer.from(keyString, 'utf8'); // Explicitly convert to bytes
    const ivStringBytes = Buffer.from(ivString, 'utf8');   // Explicitly convert to bytes
    
    writeToLogFile('INFO', `RTPMirrorHandler: keyString: "${keyString}" (${keyString.length} chars, ${keyStringBytes.length} bytes)`);
    console.log(`RTPMirrorHandler: keyString: "${keyString}" (${keyString.length} chars, ${keyStringBytes.length} bytes)`);
    logInfo(`RTPMirrorHandler: keyString: "${keyString}" (${keyString.length} chars, ${keyStringBytes.length} bytes)`);
    
    writeToLogFile('INFO', `RTPMirrorHandler: ivString: "${ivString}" (${ivString.length} chars, ${ivStringBytes.length} bytes)`);
    console.log(`RTPMirrorHandler: ivString: "${ivString}" (${ivString.length} chars, ${ivStringBytes.length} bytes)`);
    logInfo(`RTPMirrorHandler: ivString: "${ivString}" (${ivString.length} chars, ${ivStringBytes.length} bytes)`);
    
    writeToLogFile('INFO', `RTPMirrorHandler: aeskey being hashed: ${aeskey.toString('hex')}`);
    console.log(`RTPMirrorHandler: aeskey being hashed: ${aeskey.toString('hex')}`);
    logInfo(`RTPMirrorHandler: aeskey being hashed: ${aeskey.toString('hex')}`);
    
    // Hash: string bytes + aeskey (matching UxPlay's sha_update calls)
    const keyHash = crypto.createHash('sha512').update(keyStringBytes).update(aeskey).digest();
    const ivHash = crypto.createHash('sha512').update(ivStringBytes).update(aeskey).digest();
    
    this.aesKey = keyHash.slice(0, 16);
    this.aesIV = ivHash.slice(0, 16);
    this.ctrCounter = Buffer.from(this.aesIV); // Initialize counter from IV
    
    writeToLogFile('INFO', `RTPMirrorHandler: Derived keyHash (first 32 bytes): ${keyHash.slice(0, 32).toString('hex')}`);
    console.log(`RTPMirrorHandler: Derived keyHash (first 32 bytes): ${keyHash.slice(0, 32).toString('hex')}`);
    logInfo(`RTPMirrorHandler: Derived keyHash (first 32 bytes): ${keyHash.slice(0, 32).toString('hex')}`);
    
    writeToLogFile('INFO', `RTPMirrorHandler: Derived ivHash (first 32 bytes): ${ivHash.slice(0, 32).toString('hex')}`);
    console.log(`RTPMirrorHandler: Derived ivHash (first 32 bytes): ${ivHash.slice(0, 32).toString('hex')}`);
    logInfo(`RTPMirrorHandler: Derived ivHash (first 32 bytes): ${ivHash.slice(0, 32).toString('hex')}`);
    
    // Create persistent cipher for AES-CTR (maintains counter state)
    // UxPlay: aes_ctr_init uses AES_ENCRYPT mode (encryption and decryption are the same in CTR)
    // In Node.js, we use createCipheriv for CTR mode (not createDecipheriv)
    // Note: CTR mode uses encryption for both encrypt and decrypt operations
    // IMPORTANT: The cipher will be recreated for each connection, so counter starts from IV
    // CRITICAL: In OpenSSL CTR mode, the IV is used as the initial counter value
    // Node.js crypto should handle this the same way, but let's verify the IV format
    // The IV should be exactly 16 bytes (128 bits) for AES-128-CTR
    if (this.aesIV.length !== 16) {
      const errMsg = `[CRITICAL] Invalid AES IV length: ${this.aesIV.length} (expected 16)`;
      writeToLogFile('ERROR', errMsg);
      console.error(errMsg);
      logError(errMsg);
    }
    
    writeToLogFile('INFO', `RTPMirrorHandler: Creating cipher with key (${this.aesKey.length} bytes): ${this.aesKey.toString('hex')}`);
    console.log(`RTPMirrorHandler: Creating cipher with key (${this.aesKey.length} bytes): ${this.aesKey.toString('hex')}`);
    logInfo(`RTPMirrorHandler: Creating cipher with key (${this.aesKey.length} bytes): ${this.aesKey.toString('hex')}`);
    
    writeToLogFile('INFO', `RTPMirrorHandler: Creating cipher with IV (${this.ctrCounter.length} bytes): ${this.ctrCounter.toString('hex')}`);
    console.log(`RTPMirrorHandler: Creating cipher with IV (${this.ctrCounter.length} bytes): ${this.ctrCounter.toString('hex')}`);
    logInfo(`RTPMirrorHandler: Creating cipher with IV (${this.ctrCounter.length} bytes): ${this.ctrCounter.toString('hex')}`);
    
    const cipher = crypto.createCipheriv('aes-128-ctr', this.aesKey, this.ctrCounter);
    cipher.setAutoPadding(false);
    this.ctrCipher = cipher;
    
    writeToLogFile('INFO', `RTPMirrorHandler: Cipher created successfully`);
    console.log(`RTPMirrorHandler: Cipher created successfully`);
    logInfo(`RTPMirrorHandler: Cipher created successfully`);
    
    // Initialize state (matching UxPlay's mirror_buffer_init)
    this.nextDecryptCount = 0;
    this.overflowBuffer.fill(0);
    
    this.airplayServer = airplayServer;
    
    const derivedMsg = `RTPMirrorHandler: Derived AES-CTR key/IV from streamConnectionID ${streamConnectionID}`;
    writeToLogFile('INFO', derivedMsg);
    console.log(derivedMsg);
    logInfo(derivedMsg);
    
    writeToLogFile('INFO', `RTPMirrorHandler: Original FairPlay aeskey: ${originalAeskey.toString('hex')}`);
    console.log(`RTPMirrorHandler: Original FairPlay aeskey: ${originalAeskey.toString('hex')}`);
    logInfo(`RTPMirrorHandler: Original FairPlay aeskey: ${originalAeskey.toString('hex')}`);
    
    writeToLogFile('INFO', `RTPMirrorHandler: Derived AES key: ${this.aesKey.toString('hex')}`);
    console.log(`RTPMirrorHandler: Derived AES key: ${this.aesKey.toString('hex')}`);
    logInfo(`RTPMirrorHandler: Derived AES key: ${this.aesKey.toString('hex')}`);
    
    writeToLogFile('INFO', `RTPMirrorHandler: Derived AES IV: ${this.aesIV.toString('hex')}`);
    console.log(`RTPMirrorHandler: Derived AES IV: ${this.aesIV.toString('hex')}`);
    logInfo(`RTPMirrorHandler: Derived AES IV: ${this.aesIV.toString('hex')}`);
    
    writeToLogFile('INFO', `RTPMirrorHandler: Initialized with nextDecryptCount=0`);
    console.log(`RTPMirrorHandler: Initialized with nextDecryptCount=0`);
    logInfo(`RTPMirrorHandler: Initialized with nextDecryptCount=0`);
  }

  async start(): Promise<number> {
    if (this.running) {
      logError(`RTPMirrorHandler: Already running`);
      return this.dataPort;
    }

    return new Promise((resolve, reject) => {
      // Create TCP server (matching UxPlay's TCP socket for video)
      this.server = net.createServer((socket) => {
      logInfo(`RTPMirrorHandler: Client connected for video streaming`);
      this.clientSocket = socket;
      
      // Reset state for new connection (matching UxPlay's behavior)
      // Each new connection should start with fresh counter state
      this.nextDecryptCount = 0;
      this.overflowBuffer.fill(0);
      // Recreate cipher with fresh counter state
      const cipher = crypto.createCipheriv('aes-128-ctr', this.aesKey, this.ctrCounter);
      cipher.setAutoPadding(false);
      this.ctrCipher = cipher;
      logDebug(`RTPMirrorHandler: Reset state for new connection: nextDecryptCount=0, cipher recreated`);
      
      // Set socket options (matching UxPlay)
      socket.setKeepAlive(true, 60000); // 60 seconds
      socket.setNoDelay(true);
      
      // Handle incoming data
      let headerBuffer = Buffer.alloc(0);
      let expectingHeader = true;
      
      socket.on('data', (data: Buffer) => {
        logDebug(`RTPMirrorHandler: Received ${data.length} bytes on TCP socket`);
        headerBuffer = Buffer.concat([headerBuffer, data]);
        logDebug(`RTPMirrorHandler: Buffer now has ${headerBuffer.length} bytes, expectingHeader=${expectingHeader}`);
        
        // Process packets while we have enough data
        while (true) {
          // First 128 bytes are header (matching UxPlay)
          if (headerBuffer.length < 128) {
            logDebug(`RTPMirrorHandler: Not enough data for header (need 128, have ${headerBuffer.length})`);
            break; // Need more data
          }
          
          const header = headerBuffer.slice(0, 128);
          // UxPlay: byteutils_get_int reads LITTLE-ENDIAN (not big-endian!)
          const payloadSize = header.readUInt32LE(0); // packet[0:3] = payload size (little-endian)
          const payloadType = header.readUInt16LE(4); // packet[4:5] = payload type (little-endian)
          const payloadOption = header.readUInt16LE(6); // packet[6:7] = payload option (little-endian)
          // UxPlay: byteutils_get_long reads LITTLE-ENDIAN 64-bit integer
          const ntpTimestamp = header.readBigUInt64LE(8); // packet[8:15] = NTP timestamp (little-endian)
          
          logInfo(`RTPMirrorHandler: Header parsed - payloadSize=${payloadSize}, type=0x${payloadType.toString(16)}, option=0x${payloadOption.toString(16)}, bufferLength=${headerBuffer.length}`);
          
          // Validate payload size (should be reasonable - max ~10MB for video packets)
          if (payloadSize > 10 * 1024 * 1024) {
            logError(`RTPMirrorHandler: Invalid payload size ${payloadSize} (too large), resetting buffer`);
            headerBuffer = Buffer.alloc(0);
            expectingHeader = true;
            break;
          }
          
          // Check if we have the full packet (header + payload)
          if (headerBuffer.length < 128 + payloadSize) {
            logDebug(`RTPMirrorHandler: Waiting for more data - need ${128 + payloadSize} bytes, have ${headerBuffer.length}`);
            expectingHeader = false; // Need more data for payload
            break; // Wait for more data
          }
          
          // We have a complete packet
          const payload = headerBuffer.slice(128, 128 + payloadSize);
          logInfo(`RTPMirrorHandler: Processing video packet - type=0x${payloadType.toString(16)}, size=${payload.length}, payloadSize=${payloadSize}`);
          this.processVideoPacket(payload, payloadType, payloadOption, ntpTimestamp);
          
          // Remove processed packet from buffer
          headerBuffer = headerBuffer.slice(128 + payloadSize);
          expectingHeader = true; // Next packet starts with header
          logDebug(`RTPMirrorHandler: Processed packet, buffer now has ${headerBuffer.length} bytes remaining`);
        }
      });
      
      socket.on('error', (err) => {
        logError(`RTPMirrorHandler: Socket error:`, err);
      });
      
      socket.on('close', () => {
        logInfo(`RTPMirrorHandler: Client disconnected`);
        this.clientSocket = null;
      });
      });

      // Bind to a random port (UxPlay binds to requested port or finds available)
      this.server.listen(0, () => {
        const address = this.server?.address();
        if (address && typeof address === 'object' && 'port' in address) {
          this.dataPort = address.port;
          this.running = true;
          logInfo(`RTPMirrorHandler: TCP server listening on port ${this.dataPort}`);
          resolve(this.dataPort);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });

      this.server.on('error', (err) => {
        logError(`RTPMirrorHandler: Server error:`, err);
        this.running = false;
        reject(err);
      });
    });
  }

  private processVideoPacket(payload: Buffer, payloadType: number, payloadOption: number, ntpTimestamp: bigint): void {
    // UxPlay packet types:
    // 0x0000: encrypted non-IDR NAL unit
    // 0x0010: encrypted IDR NAL unit  
    // 0x0100: unencrypted SPS+PPS NAL unit
    // 0x0200: unencrypted (old protocol)
    // 0x0500: unencrypted streaming report
    
    if (payloadType === 0x0000 || payloadType === 0x0010) {
      // Encrypted packet - decrypt with AES-CTR
      logDebug(`RTPMirrorHandler: Processing encrypted video packet (type=0x${payloadType.toString(16)}, size=${payload.length})`);
      
      // Decrypt with AES-CTR (matching UxPlay's mirror_buffer_decrypt)
      const decrypted = this.decryptVideoPacket(payload);
      
      // Debug: log first few bytes of encrypted and decrypted data to verify decryption
      // IMPORTANT: When nextDecryptCount > 0, the first bytes are XORed (continuation of previous packet)
      // So we should check NAL size starting from nextDecryptCount, not offset 0
      if (payload.length >= 16 && decrypted.length >= 16) {
        // Note: nextDecryptCount is checked BEFORE decryption, so we need to check it before calling decryptVideoPacket
        // Actually, we check it after, so it might have changed. Let's check the decrypted data directly.
        logDebug(`RTPMirrorHandler: Packet - First 16 bytes encrypted: ${payload.slice(0, 16).toString('hex')}`);
        logDebug(`RTPMirrorHandler: Packet - First 16 bytes decrypted: ${decrypted.slice(0, 16).toString('hex')}`);
        
        // Check NAL size at offset 0 first (for first packet or if decryption is correct)
        const nalOffset = 0; // Always check offset 0 first
        if (decrypted.length >= nalOffset + 4) {
          const nalSize = decrypted.readUInt32BE(nalOffset);
          logDebug(`RTPMirrorHandler: NAL size at offset ${nalOffset}: ${nalSize}, nextDecryptCount: ${this.nextDecryptCount}, payloadSize: ${payload.length}`);
          
          // For first packet, also log the key/IV to verify derivation
          // Note: We check nextDecryptCount after decryption, so we can't reliably detect first packet here
          // Instead, we'll log key/IV once when cipher is initialized
          if (nalSize > 0 && nalSize < 10 * 1024 * 1024) {
            logDebug(`RTPMirrorHandler: Found valid NAL size ${nalSize} at offset ${nalOffset}`);
          }
        }
      }
      
      // Replace NAL size prefixes with start codes (0x00000001)
      // UxPlay: AirPlay prepends NALs with their size, we replace with 4-byte start code
      const nalUnits = this.replaceNalSizeWithStartCode(decrypted);
      
      if (nalUnits.length === 0) {
        logError(`RTPMirrorHandler: Failed to parse NAL units from decrypted data (${decrypted.length} bytes)`);
        return; // Skip this packet
      }
      
      // Check if we need to prepend SPS/PPS
      let finalPayload: Buffer;
      if (payloadType === 0x0010 && this.spsPpsBuffer && this.spsPpsLength > 0) {
        // IDR frame - prepend SPS/PPS if available and timestamp matches
        if (ntpTimestamp === this.lastNtpTimestamp) {
          finalPayload = Buffer.concat([this.spsPpsBuffer, nalUnits]);
          logDebug(`RTPMirrorHandler: Prepended SPS/PPS to IDR frame`);
          this.spsPpsBuffer = null;
          this.spsPpsLength = 0;
        } else {
          logDebug(`RTPMirrorHandler: SPS/PPS timestamp mismatch, discarding`);
          this.spsPpsBuffer = null;
          this.spsPpsLength = 0;
          finalPayload = nalUnits;
        }
      } else {
        finalPayload = nalUnits;
      }
      
      // Count NAL units (matching UxPlay's nalus_count)
      let nalCount = 0;
      let offset = 0;
      while (offset < finalPayload.length) {
        if (offset + 4 <= finalPayload.length && 
            finalPayload[offset] === 0x00 && finalPayload[offset + 1] === 0x00 && 
            finalPayload[offset + 2] === 0x00 && finalPayload[offset + 3] === 0x01) {
          nalCount++;
          offset += 4;
          // Find next start code or end of buffer
          while (offset < finalPayload.length) {
            if (offset + 4 <= finalPayload.length &&
                finalPayload[offset] === 0x00 && finalPayload[offset + 1] === 0x00 &&
                finalPayload[offset + 2] === 0x00 && finalPayload[offset + 3] === 0x01) {
              break; // Found next NAL unit
            }
            offset++;
          }
        } else {
          offset++;
        }
      }
      
      // Send video frame to renderer for decoding and rendering
      // UxPlay: calls video_process callback with video_decode_struct
      const ntpTimeLocal = BigInt(Date.now() * 1000000); // Convert to nanoseconds (stub - should use NTP)
      const ntpTimeRemote = ntpTimestamp;
      
      this.airplayServer.sendVideoFrame({
        isH265: this.isH265,
        nalCount: nalCount,
        data: finalPayload,
        ntpTimeLocal: ntpTimeLocal,
        ntpTimeRemote: ntpTimeRemote,
      });
      
      logDebug(`RTPMirrorHandler: Sent ${nalCount} NAL unit(s) to renderer (${finalPayload.length} bytes)`);
      
    } else if (payloadType === 0x0100) {
      // Unencrypted SPS+PPS packet
      logDebug(`RTPMirrorHandler: Processing unencrypted SPS/PPS packet (size=${payload.length})`);
      
      // Detect codec type from payload option (matching UxPlay)
      // 0x1601: H.264 SPS+PPS
      // 0x1e01: H.265/HEVC SPS+PPS
      // 0x5601: H.264 (stream stopping)
      // 0x5e01: H.265 (stream stopping)
      if (payloadOption === 0x1e01 || payloadOption === 0x5e01) {
        this.isH265 = true;
        logInfo(`RTPMirrorHandler: Detected H.265/HEVC codec`);
      } else {
        this.isH265 = false;
        logInfo(`RTPMirrorHandler: Detected H.264 codec`);
      }
      
      // Store SPS/PPS for prepending to next IDR frame
      this.spsPpsBuffer = Buffer.from(payload);
      this.spsPpsLength = payload.length;
      this.lastNtpTimestamp = ntpTimestamp;
      
      // Notify renderer about codec change
      const mainWindow = (this.airplayServer as any).mainWindow;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('airplay:video-codec', {
          isH265: this.isH265,
          spsPps: payload.toString('base64'),
        });
      }
      
    } else if (payloadType === 0x05 || payloadType === 0x0500) {
      // Streaming report (heartbeat) - UxPlay: packet[4] = 0x05, no timestamp
      // This is a binary plist with video info from client
      logDebug(`RTPMirrorHandler: Streaming report received (type=0x${payloadType.toString(16)}, size=${payload.length})`);
      // No action needed - just acknowledge receipt
      
    } else {
      logDebug(`RTPMirrorHandler: Unknown packet type 0x${payloadType.toString(16)}, option=0x${payloadOption.toString(16)}`);
    }
  }

  /**
   * Decrypt video packet using AES-CTR (matching UxPlay's mirror_buffer_decrypt)
   * UxPlay: aes_ctr_start_fresh_block aligns to block boundary, then decrypts IN-PLACE
   * Note: Node.js crypto maintains counter state internally, but we need to handle partial blocks manually
   */
  private decryptVideoPacket(input: Buffer): Buffer {
    if (!this.ctrCipher) {
      logError(`RTPMirrorHandler: Cipher not initialized`);
      return input; // Return unmodified if cipher not ready
    }
    
    // Store nextDecryptCount BEFORE processing (it will be modified during processing)
    const savedNextDecryptCount = this.nextDecryptCount;
    const isFirstPacket = savedNextDecryptCount === 0;
    
    // Log every packet to track state
    writeToLogFile('INFO', `RTPMirrorHandler: decryptVideoPacket - nextDecryptCount=${savedNextDecryptCount}, inputLen=${input.length}, isFirstPacket=${isFirstPacket}`);
    console.log(`RTPMirrorHandler: decryptVideoPacket - nextDecryptCount=${savedNextDecryptCount}, inputLen=${input.length}, isFirstPacket=${isFirstPacket}`);
    logInfo(`RTPMirrorHandler: decryptVideoPacket - nextDecryptCount=${savedNextDecryptCount}, inputLen=${input.length}, isFirstPacket=${isFirstPacket}`);
    
    if (isFirstPacket) {
      const firstPacketMsg = `RTPMirrorHandler: ===== FIRST PACKET ===== nextDecryptCount=0, inputLen=${input.length}`;
      writeToLogFile('INFO', firstPacketMsg);
      console.log(firstPacketMsg);
      logInfo(firstPacketMsg);
      
      writeToLogFile('INFO', `RTPMirrorHandler: AES key: ${this.aesKey.toString('hex')}`);
      console.log(`RTPMirrorHandler: AES key: ${this.aesKey.toString('hex')}`);
      logInfo(`RTPMirrorHandler: AES key: ${this.aesKey.toString('hex')}`);
      
      writeToLogFile('INFO', `RTPMirrorHandler: AES IV: ${this.aesIV.toString('hex')}`);
      console.log(`RTPMirrorHandler: AES IV: ${this.aesIV.toString('hex')}`);
      logInfo(`RTPMirrorHandler: AES IV: ${this.aesIV.toString('hex')}`);
      
      writeToLogFile('INFO', `RTPMirrorHandler: First 32 bytes encrypted: ${input.slice(0, 32).toString('hex')}`);
      console.log(`RTPMirrorHandler: First 32 bytes encrypted: ${input.slice(0, 32).toString('hex')}`);
      logInfo(`RTPMirrorHandler: First 32 bytes encrypted: ${input.slice(0, 32).toString('hex')}`);
      
      // CRITICAL: Verify cipher is initialized correctly
      if (!this.ctrCipher) {
        const errorMsg = `[CRITICAL] FIRST PACKET - Cipher is null!`;
        writeToLogFile('ERROR', errorMsg);
        console.error(errorMsg);
        logError(errorMsg);
      } else {
        writeToLogFile('INFO', `RTPMirrorHandler: Cipher is initialized`);
        console.log(`RTPMirrorHandler: Cipher is initialized`);
        logInfo(`RTPMirrorHandler: Cipher is initialized`);
      }
    } else {
      // Not first packet - log why
      writeToLogFile('INFO', `RTPMirrorHandler: Not first packet - nextDecryptCount=${savedNextDecryptCount} (previous packet had partial block)`);
      console.log(`RTPMirrorHandler: Not first packet - nextDecryptCount=${savedNextDecryptCount} (previous packet had partial block)`);
      logInfo(`RTPMirrorHandler: Not first packet - nextDecryptCount=${savedNextDecryptCount} (previous packet had partial block)`);
    }
    
    // UxPlay decrypts in-place, but we'll use a separate output buffer for clarity
    const output = Buffer.from(input); // Start with copy of input
    
    // Handle partial block from previous packet (nextDecryptCount > 0)
    // UxPlay: XOR with overflow buffer from previous decrypt
    if (savedNextDecryptCount > 0) {
      logDebug(`RTPMirrorHandler: Handling partial block: nextDecryptCount=${savedNextDecryptCount}, inputLen=${input.length}`);
      for (let i = 0; i < savedNextDecryptCount; i++) {
        output[i] = input[i] ^ this.overflowBuffer[(16 - savedNextDecryptCount) + i];
      }
    }
    
    // UxPlay: aes_ctr_start_fresh_block is called BEFORE every decrypt (line 94)
    // It checks block_offset and advances if needed to align to block boundary
    // Since Node.js crypto doesn't expose block_offset, we need to track it ourselves
    // If nextDecryptCount > 0, we need to advance by (16 - nextDecryptCount) bytes
    // If nextDecryptCount == 0, we might still need to advance if block_offset != 0
    // But we can't check block_offset, so we'll assume it's 0 when nextDecryptCount == 0
    if (savedNextDecryptCount > 0) {
      // UxPlay: aes_ctr_start_fresh_block advances counter to align to block boundary
      // This encrypts waste bytes (zeros) to advance the counter by (16 - block_offset) bytes
      // In Node.js CTR mode, we decrypt zeros to advance the counter (same effect)
      const wasteBytes = 16 - savedNextDecryptCount;
      const wasteBuffer = Buffer.alloc(wasteBytes);
      this.ctrCipher.update(wasteBuffer); // Decrypt zeros to advance counter (discard result)
      logDebug(`RTPMirrorHandler: Advanced counter by ${wasteBytes} bytes (waste block), nextDecryptCount=${savedNextDecryptCount}`);
    } else {
      logDebug(`RTPMirrorHandler: First packet or full block alignment: nextDecryptCount=0, inputLen=${input.length}`);
    }
    
    // Decrypt full 16-byte blocks (UxPlay decrypts in-place)
    // UxPlay: encryptlen = ((inputLen - nextDecryptCount) / 16) * 16
    // After advancing counter with waste bytes, decrypt starting from nextDecryptCount
    const encryptStart = savedNextDecryptCount;
    const encryptLen = Math.floor((input.length - savedNextDecryptCount) / 16) * 16;
    
    // Log for first packet regardless of encryptLen
    if (isFirstPacket) {
      writeToLogFile('INFO', `RTPMirrorHandler: FIRST PACKET - encryptStart=${encryptStart}, encryptLen=${encryptLen}, input.length=${input.length}`);
      console.log(`RTPMirrorHandler: FIRST PACKET - encryptStart=${encryptStart}, encryptLen=${encryptLen}, input.length=${input.length}`);
      logInfo(`RTPMirrorHandler: FIRST PACKET - encryptStart=${encryptStart}, encryptLen=${encryptLen}, input.length=${input.length}`);
    }
    
    if (encryptLen > 0) {
      // UxPlay: aes_ctr_decrypt decrypts IN-PLACE: input+offset is both input and output
      // This means the input buffer is modified directly
      // We need to decrypt the encrypted block and write to output
      // IMPORTANT: We decrypt from input buffer and write to output buffer at the same offset
      const encryptedBlock = input.slice(encryptStart, encryptStart + encryptLen);
      
      // For first packet, log what we're about to decrypt
      if (isFirstPacket && encryptStart === 0) {
        writeToLogFile('INFO', `RTPMirrorHandler: FIRST PACKET - About to decrypt ${encryptLen} bytes starting at offset ${encryptStart}`);
        console.log(`RTPMirrorHandler: FIRST PACKET - About to decrypt ${encryptLen} bytes starting at offset ${encryptStart}`);
        logInfo(`RTPMirrorHandler: FIRST PACKET - About to decrypt ${encryptLen} bytes starting at offset ${encryptStart}`);
        
        writeToLogFile('INFO', `RTPMirrorHandler: FIRST PACKET - Encrypted block (first 32 bytes): ${encryptedBlock.slice(0, 32).toString('hex')}`);
        console.log(`RTPMirrorHandler: FIRST PACKET - Encrypted block (first 32 bytes): ${encryptedBlock.slice(0, 32).toString('hex')}`);
        logInfo(`RTPMirrorHandler: FIRST PACKET - Encrypted block (first 32 bytes): ${encryptedBlock.slice(0, 32).toString('hex')}`);
      }
      
      const decryptedBlock = this.ctrCipher.update(encryptedBlock);
      
      // Log for first packet
      if (isFirstPacket) {
        writeToLogFile('INFO', `RTPMirrorHandler: FIRST PACKET - cipher.update returned ${decryptedBlock.length} bytes`);
        console.log(`RTPMirrorHandler: FIRST PACKET - cipher.update returned ${decryptedBlock.length} bytes`);
        logInfo(`RTPMirrorHandler: FIRST PACKET - cipher.update returned ${decryptedBlock.length} bytes`);
      }
      if (decryptedBlock.length > 0) {
        // Copy decrypted data to output at the correct offset
        decryptedBlock.copy(output, encryptStart);
        logDebug(`RTPMirrorHandler: Decrypted ${decryptedBlock.length} bytes starting at offset ${encryptStart}`);
        
        // Log first packet decryption details
        if (isFirstPacket && encryptStart === 0 && decryptedBlock.length >= 16) {
          const firstDecryptedMsg = `RTPMirrorHandler: FIRST PACKET - First 16 bytes decrypted: ${decryptedBlock.slice(0, 16).toString('hex')}`;
          writeToLogFile('INFO', firstDecryptedMsg);
          console.log(firstDecryptedMsg);
          logInfo(firstDecryptedMsg);
          
          // Check NAL size immediately
          if (decryptedBlock.length >= 4) {
            const nalSizeBE = decryptedBlock.readUInt32BE(0);
            const nalSizeLE = decryptedBlock.readUInt32LE(0);
            
            // Check if there's a start code (0x00000001) in the first few bytes
            let startCodeOffset = -1;
            for (let i = 0; i < Math.min(decryptedBlock.length - 3, 32); i++) {
              if (decryptedBlock[i] === 0x00 && decryptedBlock[i + 1] === 0x00 && 
                  decryptedBlock[i + 2] === 0x00 && decryptedBlock[i + 3] === 0x01) {
                startCodeOffset = i;
                break;
              }
            }
            
            const nalSizeMsg = `RTPMirrorHandler: FIRST PACKET - NAL size BE: ${nalSizeBE} (0x${nalSizeBE.toString(16)}), LE: ${nalSizeLE} (0x${nalSizeLE.toString(16)}), start code at offset: ${startCodeOffset}`;
            writeToLogFile('INFO', nalSizeMsg);
            console.log(nalSizeMsg);
            logInfo(nalSizeMsg);
            
            // Log first 64 bytes to see the pattern
            writeToLogFile('INFO', `RTPMirrorHandler: FIRST PACKET - First 64 bytes: ${decryptedBlock.slice(0, Math.min(64, decryptedBlock.length)).toString('hex')}`);
            console.log(`RTPMirrorHandler: FIRST PACKET - First 64 bytes: ${decryptedBlock.slice(0, Math.min(64, decryptedBlock.length)).toString('hex')}`);
            logInfo(`RTPMirrorHandler: FIRST PACKET - First 64 bytes: ${decryptedBlock.slice(0, Math.min(64, decryptedBlock.length)).toString('hex')}`);
            
            const nalSize = nalSizeBE; // Use BE for now
            
            // Verify decryption by checking if encrypted XOR decrypted gives us the keystream
            // In CTR mode: ciphertext = plaintext XOR keystream
            // So: keystream = ciphertext XOR plaintext
            // We can verify by XORing encrypted and decrypted to get the keystream
            // Then encrypt zeros with a fresh cipher to get the expected keystream
            try {
              const originalEncrypted = encryptedBlock.slice(0, 16);
              const decrypted = decryptedBlock.slice(0, 16);
              
              // Calculate keystream from actual data: keystream = encrypted XOR decrypted
              const actualKeystream = Buffer.alloc(16);
              for (let i = 0; i < 16; i++) {
                actualKeystream[i] = originalEncrypted[i] ^ decrypted[i];
              }
              
              // Get expected keystream by encrypting zeros with fresh cipher (starts at IV)
              const testCipher = crypto.createCipheriv('aes-128-ctr', this.aesKey, this.aesIV);
              testCipher.setAutoPadding(false);
              const zeros = Buffer.alloc(16, 0);
              const expectedKeystream = testCipher.update(zeros);
              
              writeToLogFile('INFO', `RTPMirrorHandler: FIRST PACKET - Actual keystream (from data): ${actualKeystream.toString('hex')}`);
              console.log(`RTPMirrorHandler: FIRST PACKET - Actual keystream (from data): ${actualKeystream.toString('hex')}`);
              logInfo(`RTPMirrorHandler: FIRST PACKET - Actual keystream (from data): ${actualKeystream.toString('hex')}`);
              
              writeToLogFile('INFO', `RTPMirrorHandler: FIRST PACKET - Expected keystream (from cipher): ${expectedKeystream.toString('hex')}`);
              console.log(`RTPMirrorHandler: FIRST PACKET - Expected keystream (from cipher): ${expectedKeystream.toString('hex')}`);
              logInfo(`RTPMirrorHandler: FIRST PACKET - Expected keystream (from cipher): ${expectedKeystream.toString('hex')}`);
              
              if (actualKeystream.equals(expectedKeystream)) {
                writeToLogFile('INFO', `RTPMirrorHandler: FIRST PACKET - Keystream MATCHES: Decryption is correct!`);
                console.log(`RTPMirrorHandler: FIRST PACKET - Keystream MATCHES: Decryption is correct!`);
                logInfo(`RTPMirrorHandler: FIRST PACKET - Keystream MATCHES: Decryption is correct!`);
              } else {
                writeToLogFile('ERROR', `RTPMirrorHandler: FIRST PACKET - Keystream MISMATCH: Decryption is WRONG!`);
                console.error(`RTPMirrorHandler: FIRST PACKET - Keystream MISMATCH: Decryption is WRONG!`);
                logError(`RTPMirrorHandler: FIRST PACKET - Keystream MISMATCH: Decryption is WRONG!`);
                
                // Calculate difference
                const diff = Buffer.alloc(16);
                for (let i = 0; i < 16; i++) {
                  diff[i] = actualKeystream[i] ^ expectedKeystream[i];
                }
                writeToLogFile('ERROR', `RTPMirrorHandler: FIRST PACKET - Keystream difference: ${diff.toString('hex')}`);
                console.error(`RTPMirrorHandler: FIRST PACKET - Keystream difference: ${diff.toString('hex')}`);
                logError(`RTPMirrorHandler: FIRST PACKET - Keystream difference: ${diff.toString('hex')}`);
              }
            } catch (err) {
              writeToLogFile('ERROR', `RTPMirrorHandler: FIRST PACKET - Verification error: ${err instanceof Error ? err.message : String(err)}`);
              console.error(`RTPMirrorHandler: FIRST PACKET - Verification error:`, err);
              logError(`RTPMirrorHandler: FIRST PACKET - Verification error:`, err);
            }
            
            if (nalSize > 10 * 1024 * 1024) {
              const errorMsg = `[CRITICAL] FIRST PACKET - Invalid NAL size ${nalSize} - decryption is WRONG!`;
              writeToLogFile('ERROR', errorMsg);
              console.error(errorMsg);
              logError(errorMsg);
              
              // Also log the key/IV used for debugging
              writeToLogFile('ERROR', `[CRITICAL] AES key used: ${this.aesKey.toString('hex')}`);
              console.error(`[CRITICAL] AES key used: ${this.aesKey.toString('hex')}`);
              logError(`[CRITICAL] AES key used: ${this.aesKey.toString('hex')}`);
              
              writeToLogFile('ERROR', `[CRITICAL] AES IV used: ${this.aesIV.toString('hex')}`);
              console.error(`[CRITICAL] AES IV used: ${this.aesIV.toString('hex')}`);
              logError(`[CRITICAL] AES IV used: ${this.aesIV.toString('hex')}`);
            }
          }
        }
      } else {
        logError(`RTPMirrorHandler: Cipher.update returned empty buffer for ${encryptLen} bytes`);
      }
    }
    
    // Handle remaining bytes (< 16 bytes)
    // UxPlay: restlen = (inputLen - nextDecryptCount) % 16
    const restLen = (input.length - savedNextDecryptCount) % 16;
    if (restLen > 0) {
      const restStart = input.length - restLen;
      
      // Copy remaining bytes to overflow buffer
      this.overflowBuffer.fill(0);
      input.copy(this.overflowBuffer, 0, restStart, restStart + restLen);
      
      // UxPlay: Reset nextDecryptCount to 0 BEFORE processing remaining bytes (line 103)
      // Then if restlen > 0, it sets nextDecryptCount = 16 - restlen
      // We'll do the same
      this.nextDecryptCount = 0;
      
      // Decrypt a full 16-byte block (UxPlay decrypts overflowBuffer as 16 bytes in-place)
      // Use the persistent cipher
      const overflowDecrypted = this.ctrCipher.update(this.overflowBuffer);
      overflowDecrypted.copy(this.overflowBuffer, 0);
      
      // Copy only the needed bytes to output
      for (let j = 0; j < restLen; j++) {
        output[restStart + j] = this.overflowBuffer[j];
      }
      
      // Store remaining decrypted bytes for next packet (UxPlay line 112)
      this.nextDecryptCount = 16 - restLen;
      logDebug(`RTPMirrorHandler: Set nextDecryptCount=${this.nextDecryptCount} for next packet (restLen=${restLen})`);
    } else {
      // UxPlay: Reset nextDecryptCount to 0 if no remaining bytes (line 103)
      this.nextDecryptCount = 0;
    }
    
    // Log final decrypted output for first packet
    if (isFirstPacket && output.length >= 16) {
      const finalOutputMsg = `RTPMirrorHandler: FIRST PACKET - Final output first 16 bytes: ${output.slice(0, 16).toString('hex')}`;
      writeToLogFile('INFO', finalOutputMsg);
      console.log(finalOutputMsg);
      logInfo(finalOutputMsg);
    }
    
    return output;
  }

  /**
   * Increment CTR counter (big-endian 128-bit counter)
   * UxPlay: Counter increments for each 16-byte block
   */
  private incrementCounter(blocks: number): void {
    // Increment counter as big-endian 128-bit integer
    // For simplicity, we'll increment the last 8 bytes (64-bit counter)
    // This matches typical CTR mode implementations
    let carry = blocks;
    for (let i = 15; i >= 8 && carry > 0; i--) {
      const sum = this.ctrCounter[i] + carry;
      this.ctrCounter[i] = sum & 0xff;
      carry = sum >> 8;
    }
  }

  /**
   * Replace NAL size prefixes with start codes (0x00000001)
   * UxPlay: AirPlay prepends NALs with their size (4 bytes BE), we replace with start code
   * IMPORTANT: When nextDecryptCount > 0, the first bytes are XORed (continuation of previous packet)
   * So we should start parsing from nextDecryptCount, not offset 0
   */
  private replaceNalSizeWithStartCode(payload: Buffer): Buffer {
    const nalStartCode = Buffer.from([0x00, 0x00, 0x00, 0x01]);
    const chunks: Buffer[] = [];
    
    // If nextDecryptCount > 0, the first bytes are XORed (continuation of previous packet's last NAL)
    // We should start parsing NAL units from nextDecryptCount
    // But actually, those XORed bytes are already part of a NAL unit, so we might need to handle them differently
    // For now, let's try starting from 0 and see if we get valid NAL sizes
    let offset = 0;
    
    // If we have a partial block from previous packet, try starting from nextDecryptCount
    // But first, let's check if offset 0 has a valid NAL size
    if (this.nextDecryptCount > 0) {
      // Check if offset 0 has valid NAL size (might be wrong due to XOR)
      const nalSizeAt0 = payload.readUInt32BE(0);
      if (nalSizeAt0 > 0 && nalSizeAt0 < 10 * 1024 * 1024 && offset + 4 + nalSizeAt0 <= payload.length) {
        // Offset 0 might be valid, but let's also check nextDecryptCount
        logDebug(`RTPMirrorHandler: nextDecryptCount=${this.nextDecryptCount}, checking NAL size at offset 0: ${nalSizeAt0}`);
      }
      // Try starting from nextDecryptCount (after XORed bytes)
      if (payload.length > this.nextDecryptCount + 4) {
        const nalSizeAtOffset = payload.readUInt32BE(this.nextDecryptCount);
        if (nalSizeAtOffset > 0 && nalSizeAtOffset < 10 * 1024 * 1024 && 
            this.nextDecryptCount + 4 + nalSizeAtOffset <= payload.length) {
          logDebug(`RTPMirrorHandler: Valid NAL size found at offset ${this.nextDecryptCount}: ${nalSizeAtOffset}`);
          offset = this.nextDecryptCount; // Start from after XORed bytes
        }
      }
    }
    
    while (offset < payload.length) {
      if (offset + 4 > payload.length) {
        // Not enough bytes for size prefix
        logDebug(`RTPMirrorHandler: Trailing data at end of payload (${payload.length - offset} bytes)`);
        break;
      }
      
      // Read NAL size (4 bytes, big-endian) - matching UxPlay's byteutils_get_int_be
      const nalSize = payload.readInt32BE(offset); // Use readInt32BE to match UxPlay's check for < 0
      
      // Validate NAL size (matching UxPlay's validation)
      // UxPlay checks: nc_len < 0 || nalu_size + 4 > payload_size
      if (nalSize < 0 || offset + 4 > payload.length) {
        logError(`RTPMirrorHandler: Invalid NAL size ${nalSize} at offset ${offset}, payload length=${payload.length}`);
        // If we started from nextDecryptCount and it's invalid, try offset 0 once
        if (offset === this.nextDecryptCount && this.nextDecryptCount > 0 && offset === this.nextDecryptCount) {
          logDebug(`RTPMirrorHandler: Trying offset 0 instead of ${this.nextDecryptCount}`);
          offset = 0;
          continue; // Try once more at offset 0
        }
        // If offset 0 also fails, try searching for a valid NAL size or start code
        if (offset === 0) {
          // Try to find a valid NAL size by checking multiple offsets
          let foundValid = false;
          for (let searchOffset = 0; searchOffset < Math.min(payload.length - 4, 64); searchOffset++) {
            const testNalSize = payload.readInt32BE(searchOffset);
            if (testNalSize > 0 && testNalSize < 10 * 1024 * 1024 && searchOffset + 4 + testNalSize <= payload.length) {
              // Check if the NAL unit starts with valid header (forbidden_zero_bit must be 0)
              const nalHeader = payload[searchOffset + 4];
              if ((nalHeader & 0x80) === 0) { // First bit must be 0
                logInfo(`RTPMirrorHandler: Found valid NAL size ${testNalSize} at offset ${searchOffset} (skipped ${searchOffset} bytes)`);
                offset = searchOffset;
                foundValid = true;
                break;
              }
            }
          }
          if (!foundValid && this.nextDecryptCount > 0) {
            logError(`RTPMirrorHandler: Both offset 0 and ${this.nextDecryptCount} failed - no valid NAL found`);
            break; // Stop trying
          }
          if (!foundValid) {
            // Skip one byte and try again (but limit attempts to prevent infinite loop)
            offset += 1;
            if (offset > Math.min(payload.length - 4, 64)) {
              logError(`RTPMirrorHandler: Exceeded search limit (tried ${offset} offsets) - no valid NAL found, skipping packet`);
              return Buffer.alloc(0); // Return empty buffer to skip this packet
            }
            continue;
          }
        } else {
          // Skip one byte and try again
          offset += 1;
          if (offset > Math.min(payload.length - 4, 64)) {
            logError(`RTPMirrorHandler: Exceeded search limit (tried ${offset} offsets) - no valid NAL found, skipping packet`);
            return Buffer.alloc(0);
          }
          continue;
        }
      }
      
      // Additional validation: NAL size must be reasonable (1 byte to 10MB)
      if (nalSize === 0 || nalSize > 10 * 1024 * 1024) {
        logError(`RTPMirrorHandler: Invalid NAL size ${nalSize} at offset ${offset} (out of range)`);
        offset += 1;
        if (offset > Math.min(payload.length - 4, 64)) {
          logError(`RTPMirrorHandler: Exceeded search limit - skipping packet`);
          return Buffer.alloc(0);
        }
        continue;
      }
      
      if (offset + 4 + nalSize > payload.length) {
        logError(`RTPMirrorHandler: NAL size ${nalSize} exceeds payload at offset ${offset} (payload length=${payload.length})`);
        break;
      }
      
      // UxPlay checks: "first bit of h264 nalu MUST be 0 ("forbidden_zero_bit")"
      const nalHeader = payload[offset + 4];
      if (nalHeader & 0x80) {
        logError(`RTPMirrorHandler: Invalid NAL header at offset ${offset + 4}: forbidden_zero_bit is set (0x${nalHeader.toString(16)})`);
        // Try next offset
        offset += 1;
        if (offset > Math.min(payload.length - 4, 64)) {
          logError(`RTPMirrorHandler: Exceeded search limit - skipping packet`);
          return Buffer.alloc(0);
        }
        continue;
      }
      
      // Replace size prefix with start code
      chunks.push(nalStartCode);
      
      // Copy NAL unit data
      const nalData = payload.slice(offset + 4, offset + 4 + nalSize);
      chunks.push(nalData);
      
      // Log NAL type for debugging
      const nalType = nalHeader & 0x1f; // Lower 5 bits for H.264
      logDebug(`RTPMirrorHandler: Found NAL unit type ${nalType}, size ${nalSize} at offset ${offset}`);
      
      offset += 4 + nalSize;
    }
    
    if (chunks.length === 0) {
      logError(`RTPMirrorHandler: No valid NAL units found in payload of ${payload.length} bytes`);
      return Buffer.alloc(0);
    }
    
    return Buffer.concat(chunks);
  }

  stop(): void {
    if (this.clientSocket) {
      this.clientSocket.destroy();
      this.clientSocket = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.running = false;
    logInfo(`RTPMirrorHandler: Stopped`);
  }
}

/**
 * RTP Audio Handler for audio streaming (UDP)
 * Matches UxPlay's raop_rtp implementation
 */
class RTPAudioHandler {
  private controlSocket: dgram.Socket | null = null;
  private dataSocket: dgram.Socket | null = null;
  private aesKey: Buffer;
  private aesIV: Buffer;
  private remoteControlPort: number;
  private controlPort: number = 0;
  private dataPort: number = 0;
  private running: boolean = false;
  private airplayServer: AirPlayServer; // Reference to parent server for IPC

  constructor(aeskey: Buffer, aesiv: Buffer, remoteControlPort: number, airplayServer: AirPlayServer) {
    this.aesKey = aeskey;
    this.aesIV = aesiv;
    this.remoteControlPort = remoteControlPort;
    this.airplayServer = airplayServer;
  }

  async start(): Promise<{ controlPort: number; dataPort: number }> {
    if (this.running) {
      logError(`RTPAudioHandler: Already running`);
      return { controlPort: this.controlPort, dataPort: this.dataPort };
    }

    return new Promise((resolve, reject) => {
      let controlPortReady = false;
      let dataPortReady = false;

      const checkReady = () => {
        if (controlPortReady && dataPortReady) {
          this.running = true;
          resolve({ controlPort: this.controlPort, dataPort: this.dataPort });
        }
      };

      // Create UDP sockets (matching UxPlay's UDP sockets for audio)
      // Control socket for resend requests
      this.controlSocket = dgram.createSocket('udp6');
      this.controlSocket.bind(0, () => {
        const address = this.controlSocket?.address();
        if (address && typeof address === 'object' && 'port' in address) {
          this.controlPort = address.port;
          logInfo(`RTPAudioHandler: Control socket bound to port ${this.controlPort}`);
          controlPortReady = true;
          checkReady();
        }
      });

      // Data socket for audio RTP packets
      this.dataSocket = dgram.createSocket('udp6');
      this.dataSocket.bind(0, () => {
        const address = this.dataSocket?.address();
        if (address && typeof address === 'object' && 'port' in address) {
          this.dataPort = address.port;
          logInfo(`RTPAudioHandler: Data socket bound to port ${this.dataPort}`);
          
          // Start receiving RTP packets
          this.setupDataSocket();
          dataPortReady = true;
          checkReady();
        }
      });

      this.controlSocket.on('error', (err) => {
        logError(`RTPAudioHandler: Control socket error:`, err);
        if (!controlPortReady) reject(err);
      });

      this.dataSocket.on('error', (err) => {
        logError(`RTPAudioHandler: Data socket error:`, err);
        if (!dataPortReady) reject(err);
      });
    });
  }

  private setupDataSocket(): void {
    if (!this.dataSocket) return;

    this.dataSocket.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
      // Parse RTP packet
      // RTP header is 12 bytes minimum (can be longer with CSRC/extension)
      if (msg.length < 12) {
        logDebug(`RTPAudioHandler: Packet too short (${msg.length} bytes)`);
        return;
      }

      // Parse RTP header (matching UxPlay's RTP parsing)
      const version = (msg[0] >> 6) & 0x03; // Bits 0-1
      const padding = (msg[0] >> 5) & 0x01; // Bit 2
      const extension = (msg[0] >> 4) & 0x01; // Bit 3
      const csrcCount = msg[0] & 0x0f; // Bits 4-7
      const marker = (msg[1] >> 7) & 0x01; // Bit 0
      const payloadType = msg[1] & 0x7f; // Bits 1-7
      const sequenceNumber = msg.readUInt16BE(2);
      const timestamp = msg.readUInt32BE(4);
      const ssrc = msg.readUInt32BE(8);

      // RTP header length: 12 bytes + (csrcCount * 4) + extension header if present
      let headerLength = 12 + (csrcCount * 4);
      if (extension) {
        const extensionLength = msg.readUInt16BE(headerLength + 2);
        headerLength += 4 + (extensionLength * 4);
      }

      const payload = msg.slice(headerLength);
      
      logDebug(`RTPAudioHandler: RTP packet - seq=${sequenceNumber}, timestamp=${timestamp}, payloadType=${payloadType}, payloadSize=${payload.length}`);

      // Decrypt audio payload with AES-CBC (matching UxPlay's raop_buffer_decrypt)
      // UxPlay: First 12 bytes are unencrypted header, rest is encrypted payload
      if (payload.length < 12) {
        logDebug(`RTPAudioHandler: Payload too short (${payload.length} bytes)`);
        return;
      }

      const encryptedPayload = payload.slice(12);
      const decryptedPayload = this.decryptAudioPacket(encryptedPayload);
      
      // Combine header + decrypted payload
      const audioFrame = Buffer.concat([payload.slice(0, 12), decryptedPayload]);
      
      logDebug(`RTPAudioHandler: Decrypted ${decryptedPayload.length} bytes of audio data`);
      
      // TODO: Parse audio format (AAC-ELD or ALAC based on payload[0])
      // TODO: Decode audio
      // TODO: Play audio via Web Audio API
    });
  }

  /**
   * Decrypt audio packet using AES-CBC (matching UxPlay's raop_buffer_decrypt)
   * UxPlay: Decrypts in 16-byte blocks, copies remainder unencrypted
   */
  private decryptAudioPacket(encryptedData: Buffer): Buffer {
    const output = Buffer.alloc(encryptedData.length);
    
    // Decrypt full 16-byte blocks
    const encryptedLen = Math.floor(encryptedData.length / 16) * 16;
    
    if (encryptedLen > 0) {
      // Create AES-CBC decipher
      const decipher = crypto.createDecipheriv('aes-128-cbc', this.aesKey, this.aesIV);
      decipher.setAutoPadding(false);
      
      // Decrypt encrypted blocks
      const encryptedBlock = encryptedData.slice(0, encryptedLen);
      const decryptedBlock = decipher.update(encryptedBlock);
      decryptedBlock.copy(output, 0);
      decipher.final();
      
      // Reset cipher for next packet (UxPlay calls aes_cbc_reset)
      // Note: We create a new cipher each time, so no reset needed
    }
    
    // Copy remaining bytes unencrypted (UxPlay: memcpy remainder)
    if (encryptedData.length > encryptedLen) {
      encryptedData.copy(output, encryptedLen, encryptedLen);
    }
    
    return output;
  }

  stop(): void {
    if (this.controlSocket) {
      this.controlSocket.close();
      this.controlSocket = null;
    }
    if (this.dataSocket) {
      this.dataSocket.close();
      this.dataSocket = null;
    }
    this.running = false;
    logInfo(`RTPAudioHandler: Stopped`);
  }
}

export const airplayServer = new AirPlayServer();
