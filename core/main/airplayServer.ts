import { BrowserWindow } from 'electron';
import http from 'http';
import crypto from 'crypto';
import plist from 'plist';

// @noble/curves for X25519 support
// The package exports './ed25519.js' (with .js extension)
let x25519Lib: any = null;
try {
  x25519Lib = require('@noble/curves/ed25519.js').x25519;
} catch (e) {
  // Will be handled in code - library might not be available
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
const logDebug = (message: string, ...args: any[]): void => {
  if (DEBUG_MODE) {
    console.log(`[AirPlay:DEBUG] ${message}`, ...args);
  }
};

const logInfo = (message: string, ...args: any[]): void => {
  console.log(`[AirPlay:INFO] ${message}`, ...args);
};

const logError = (message: string, ...args: any[]): void => {
  console.error(`[AirPlay:ERROR] ${message}`, ...args);
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
      this.handleRTSPSetup(req, res, corsHeaders, isRTSP).catch((err) => {
        logError('[AirPlay] Error handling RTSP SETUP:', err);
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

    // Get or generate ED25519 public key (32 bytes)
    // For now, use the persistent public key if available, otherwise generate one
    if (!this.persistentPublicKey) {
      // Generate ED25519 key pair (we only need the public key for this response)
      // In a full implementation, we'd use a persistent key from the pairing system
      this.persistentPublicKey = crypto.randomBytes(32);
      logInfo(`Generated new persistent public key for pairing`);
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
        // Load the library if not already loaded
        if (!x25519Lib) {
          try {
            x25519Lib = require('@noble/curves/ed25519.js').x25519;
          } catch (loadErr) {
            logError(`Failed to load @noble/curves:`, loadErr);
            throw new Error('@noble/curves not available');
          }
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
      
      // Ensure we have persistent ED25519 key pair
      if (!this.persistentPrivateKey) {
        try {
          const ed25519KeyPair = crypto.generateKeyPairSync('ed25519');
          this.persistentPrivateKey = ed25519KeyPair.privateKey;
          this.persistentPublicKey = ed25519KeyPair.publicKey.export({ format: 'der', type: 'spki' });
          logInfo(`Generated new ED25519 key pair for pairing`);
        } catch (err) {
          logError(`Failed to generate ED25519 key pair:`, err);
        }
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
      responseBody = Buffer.concat([serverX25519Key, signature]);
      
      logInfo(`Pair-verify step 1: returning server X25519 key (32 bytes) + signature (64 bytes) = ${responseBody.length} bytes`);
      logDebug(`Server X25519 key (hex): ${serverX25519Key.toString('hex')}`);
      logDebug(`Signature (hex): ${signature.toString('hex').substring(0, 32)}...`);

      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': responseBody.length.toString(),
        'CSeq': cseq,
        'Server': 'AirTunes/220.68',
        ...corsHeaders,
      });
      res.end(responseBody);
    } else if (step === 0) {
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
          const cipher = crypto.createCipheriv('aes-128-ctr', aesKey, aesIV);
          
          // Fake round: encrypt zeros (advances counter)
          const fakeRound = Buffer.concat([
            cipher.update(Buffer.alloc(PAIRING_SIG_SIZE)),
            cipher.final(),
          ]);
          
          // Now encrypt the encrypted signature to decrypt it
          const decryptedSignature = Buffer.concat([
            cipher.update(clientSignature),
            cipher.final(),
          ]);
          
          logDebug(`Decrypted client signature (${decryptedSignature.length} bytes)`);
          
          // Create verifier
          const verifier = crypto.createVerify('ed25519');
          
          // UxPlay verifies: ecdh_theirs (client X25519) + ecdh_ours (server X25519)
          // NOT client ED25519, NOT shared secret!
          const messageToVerify = Buffer.concat([
            session.clientX25519Key,  // client X25519 public key (32 bytes)
            session.serverX25519Key,  // server X25519 public key (32 bytes)
          ]);
          
          logDebug(`Verifying message: client X25519 (${session.clientX25519Key.length} bytes) + server X25519 (${session.serverX25519Key.length} bytes) = ${messageToVerify.length} bytes`);
          
          verifier.update(messageToVerify);
          
          // Create a public key object from the raw ED25519 public key
          const ed25519OID = Buffer.from([0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70]); // SEQUENCE { OID id-Ed25519 }
          const publicKeyBitString = Buffer.concat([
            Buffer.from([0x03, 0x21, 0x00]), // BIT STRING with 0 unused bits, length 33
            session.clientED25519Key,
          ]);
          const algorithmIdentifier = Buffer.concat([ed25519OID, publicKeyBitString]);
          const spkiStructure = Buffer.concat([
            Buffer.from([0x30, algorithmIdentifier.length]), // SEQUENCE with length
            algorithmIdentifier,
          ]);
          
          const clientPublicKeyObj = crypto.createPublicKey({
            key: spkiStructure,
            format: 'der',
            type: 'spki',
          });
          
          // Use crypto.verify() directly (not verifier.verify())
          signatureValid = crypto.verify(null, messageToVerify, clientPublicKeyObj, decryptedSignature);
          
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
        logError(`Pair-verify step 2: signature verification failed, closing connection`);
        // UxPlay sets http_response_set_disconnect(response, 1) on failure
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': '0',
          'CSeq': cseq,
          'Server': 'AirTunes/220.68',
          ...corsHeaders,
        });
        res.end();
        // Close connection after response
        req.socket.end();
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
    try {
      const parsed = bplistParser.parseBuffer(requestBody);
      if (parsed && parsed.length > 0) {
        requestData = parsed[0];
        logInfo(`SETUP request parsed successfully`);
        logDebug(`SETUP request keys:`, Object.keys(requestData));
      } else {
        logError(`SETUP request plist is empty`);
        res.writeHead(400, {
          'Content-Type': 'text/plain',
        });
        res.end('Bad Request: Invalid plist');
        return;
      }
    } catch (err) {
      logError(`Error parsing SETUP request plist:`, err);
      res.writeHead(400, {
        'Content-Type': 'text/plain',
      });
      res.end('Bad Request: Invalid plist format');
      return;
    }

    // Extract device info
    const deviceID = requestData.deviceID || 'unknown';
    const name = requestData.name || 'Unknown Device';
    const model = requestData.model || 'Unknown Model';
    logInfo(`SETUP 1`);
    logInfo(`Connection request from ${name} (${model}) with deviceID = ${deviceID}`);

    // Extract ekey and eiv (FairPlay encrypted keys)
    let aeskey: Buffer | null = null;
    let aesiv: Buffer | null = null;
    
    if (requestData.ekey && requestData.eiv) {
      const ekey = Buffer.isBuffer(requestData.ekey) ? requestData.ekey : Buffer.from(requestData.ekey, 'base64');
      const eiv = Buffer.isBuffer(requestData.eiv) ? requestData.eiv : Buffer.from(requestData.eiv, 'base64');
      
      logInfo(`eiv_len = ${eiv.length}`);
      logDebug(`16 byte aesiv (needed for AES-CBC audio decryption iv): ${eiv.toString('hex')}`);
      
      logInfo(`ekey_len = ${ekey.length}`);
      logDebug(`ekey: ${ekey.toString('hex').substring(0, 100)}...`);
      
      // Decrypt ekey using FairPlay (stub for now)
      // In production, this should call fairplay_decrypt()
      // For now, we'll generate a stub key
      if (ekey.length === 72) {
        // FairPlay decrypt - stub implementation
        // TODO: Implement proper FairPlay decryption using fairplay library
        aeskey = crypto.randomBytes(16); // Stub: should decrypt from ekey
        logDebug(`Generated stub aeskey (should be FairPlay-decrypted from ekey): ${aeskey.toString('hex')}`);
        logInfo(`fairplay_decrypt ret = 0 (stub)`);
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
    } else {
      logError(`Missing ekey or eiv in SETUP request`);
      res.writeHead(400, {
        'Content-Type': 'text/plain',
      });
      res.end('Bad Request: Missing ekey or eiv');
      return;
    }

    // Extract timing port from request
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
    
    // Build response plist
    const responseData: Record<string, any> = {
      timingPort: timingLPort,
      eventPort: 0, // Not used in mirror mode
    };
    
    // Check for streams array (for video mirroring)
    if (requestData.streams && Array.isArray(requestData.streams)) {
      logInfo(`SETUP request includes ${requestData.streams.length} stream(s)`);
      // TODO: Process streams array and add stream responses
      // For now, we'll just return timingPort and eventPort
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

  private async handleFPSetup(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    corsHeaders: Record<string, string>,
    isRTSP: boolean = false,
    method?: string
  ): Promise<void> {
    logInfo(`=== HANDLING FP-SETUP REQUEST ===`);
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
      // FairPlay setup - return 142 bytes
      // Without FairPlay library, we'll return a stub response
      // In production, this should call fairplay_setup()
      responseBody = Buffer.alloc(142);
      // Fill with pattern that starts with FPLY (FairPlay magic)
      responseBody.write('FPLY', 0); // Magic bytes
      responseBody[4] = 0x03; // Version
      responseBody[5] = 0x01; // Type
      responseBody[6] = 0x02; // Response type
      // Rest is FairPlay-specific data - for now, fill with zeros
      // TODO: Implement proper FairPlay setup using fairplay library
      logDebug(`Generated stub FP-setup response (142 bytes)`);
    } else if (requestBody.length === 164) {
      logInfo(`FP-setup: Handshake (164 bytes) -> returning 32 bytes`);
      // FairPlay handshake - return 32 bytes
      // Without FairPlay library, we'll return a stub response
      // In production, this should call fairplay_handshake()
      responseBody = Buffer.alloc(32);
      // Fill with pattern that starts with FPLY
      responseBody.write('FPLY', 0); // Magic bytes
      responseBody[4] = 0x03; // Version
      responseBody[5] = 0x01; // Type
      responseBody[6] = 0x04; // Response type (handshake complete)
      // Rest is FairPlay-specific data - for now, fill with zeros
      // TODO: Implement proper FairPlay handshake using fairplay library
      logDebug(`Generated stub FP-handshake response (32 bytes)`);
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
        const statusCode = (res as any)._statusCode || 200;
        const responseHeaders = (res as any)._headers || {};
        const bodyChunks = (res as any)._bodyChunks || [];
        
        if (chunk) {
          const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bodyChunks.push(chunkBuffer);
        }
        
        const responseBody = Buffer.concat(bodyChunks);
        
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
        socket.write(fullResponse);
        
        logInfo(`[RTSP_PARSER] Response sent: ${statusCode}, total ${fullResponse.length} bytes (headers: ${headerBlock.length}, body: ${responseBody.length})`);
        
        // Ensure socket stays open and readable for next request
        if (!socket.destroyed && socket.readable) {
          socket.resume();
          logDebug(`[RTSP_PARSER] Socket resumed, ready for next request`);
        } else {
          logError(`[RTSP_PARSER] Socket is destroyed or not readable after response!`);
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

export const airplayServer = new AirPlayServer();
