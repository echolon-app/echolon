import { BrowserWindow } from 'electron';
import http from 'http';
import crypto from 'crypto';
import plist from 'plist';

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

interface ConnectionState {
  type: ConnectionType;
  socket: any;
  remoteAddress?: string;
  remotePort?: number;
  createdAt: number;
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
          name: 'Echolon V7',
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
        logInfo(`Name: Echolon V7`);
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
          
          // Verify the encoding
          try {
            const verify = bplistParser.parseBuffer(responseBody);
            logInfo(`✓ txtAirPlay-only response decodes correctly`);
            if (verify[0].txtAirPlay) {
              const decodedTxt = Buffer.isBuffer(verify[0].txtAirPlay) 
                ? verify[0].txtAirPlay.toString('utf8')
                : Buffer.from(verify[0].txtAirPlay).toString('utf8');
              logDebug(`Decoded txtAirPlay content: ${decodedTxt}`);
              logDebug(`txtAirPlay length: ${decodedTxt.length}`);
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
          
          // For RTSP, write response manually to ensure RTSP/1.0 status line
          // Node.js HTTP server writes HTTP/1.1, but RTSP requires RTSP/1.0
          if (isActuallyRTSP) {
            // Prevent Node.js from writing its own status line
            // We'll write everything manually to the socket
            const statusLine = 'RTSP/1.0 200 OK\r\n';
            const headerLines = Object.entries(responseHeaders)
              .map(([key, value]) => `${key}: ${value}`)
              .join('\r\n');
            const headerBlock = Buffer.from(`${statusLine}${headerLines}\r\n\r\n`, 'utf8');
            
            // Mark response as sent to prevent Node.js from writing headers
            (res as any)._headerSent = true;
            (res as any)._hasBody = true;
            (res as any)._sent = true;
            
            // Write RTSP status line, headers, and body directly to socket
            req.socket.write(headerBlock);
            req.socket.write(responseBody);
            
            // Properly end the response object so Node.js can parse the next request
            // But prevent it from writing anything by marking everything as sent
            (res as any).finished = true;
            
            // Safely set writable state if it exists
            if ((res as any)._writableState) {
              (res as any)._writableState.ended = true;
            }
            
            // Emit finish event so Node.js knows response is complete
            res.emit('finish');
            
            // Ensure socket is ready to receive next request
            // Node.js HTTP server pauses the socket during request handling
            // We need to resume it so it can parse the next RTSP request
            if (req.socket.readable && !req.socket.destroyed) {
              // Resume the socket so Node.js HTTP parser can read the next request
              req.socket.resume();
              
              // Mark request as complete so parser can start parsing next request
              // The request object needs to be in a state where the parser can continue
              (req as any).complete = true;
              
              logDebug(`Socket resumed for next RTSP request, request marked as complete`);
            }
            
            // Socket stays open for next RTSP request - Node.js HTTP server will parse it
            logDebug(`RTSP response written directly to socket (${responseBody.length} bytes), response marked as finished`);
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
      name: 'Echolon V7', // Server name
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
    
    // Read request body (binary PLIST)
    let requestData: any = null;
    if (req.headers['content-length'] && parseInt(req.headers['content-length']) > 0) {
      const body: Buffer[] = [];
      for await (const chunk of req) {
        body.push(chunk);
      }
      const requestBody = Buffer.concat(body);
      logInfo(`Pair-setup request body: ${requestBody.length} bytes`);
      logDebug(`Request body preview (hex): ${requestBody.toString('hex').substring(0, 200)}`);
      
      try {
        if (requestBody.toString('ascii', 0, 8) === 'bplist00') {
          const parsed = bplistParser.parseBuffer(requestBody);
          requestData = parsed[0];
          logInfo(`Decoded pair-setup request:`, JSON.stringify(requestData, null, 2));
        }
      } catch (err) {
        logError(`Could not decode pair-setup request:`, err);
      }
    }

    // AirPlay pairing uses SRP (Secure Remote Password) protocol
    // The pairing flow typically has multiple steps (M1, M2, M3, M4, M5)
    // For now, we'll implement a simplified version that accepts pairing
    
    // Check what step we're on (if method is specified)
    const method = requestData?.method || requestData?.state || 'start';
    logInfo(`Pair-setup method/state: ${method}`);

    let responseData: Record<string, any> = {};
    let statusCode = 200;

    // Step 1: Initial pairing request - return salt and public key
    if (method === 0 || method === 'start' || !requestData) {
      // Generate random salt and public key for SRP
      const salt = crypto.randomBytes(16);
      const publicKey = crypto.randomBytes(32);
      
      responseData = {
        salt: salt.toString('base64'),
        publicKey: publicKey.toString('base64'),
        state: 1, // Next state
      };
      logInfo(`Pair-setup step 1: returning salt and public key`);
    }
    // Step 2: Client sends proof - verify and return server proof
    else if (method === 1 || method === 'verify') {
      // In full SRP, we would verify the client's proof here
      // For now, accept it and return server proof
      const serverProof = crypto.randomBytes(32);
      
      responseData = {
        proof: serverProof.toString('base64'),
        state: 2, // Next state
      };
      logInfo(`Pair-setup step 2: verifying and returning server proof`);
    }
    // Step 3: Exchange encryption keys
    else if (method === 2 || method === 'exchange') {
      // Generate session key
      const sessionKey = crypto.randomBytes(32);
      
      responseData = {
        sessionKey: sessionKey.toString('base64'),
        state: 3, // Complete
      };
      logInfo(`Pair-setup step 3: exchanging keys`);
    }
    // Default: accept pairing
    else {
      responseData = {
        state: 3, // Complete
      };
      logInfo(`Pair-setup: accepting pairing`);
    }

    // Encode response as binary PLIST
    let responseBody: Buffer;
    try {
      responseBody = bplistCreator(responseData);
      logInfo(`Pair-setup response:`, JSON.stringify(responseData, null, 2));
      logDebug(`Pair-setup response body size: ${responseBody.length} bytes`);
    } catch (err) {
      logError(`Error creating pair-setup response:`, err);
      responseBody = Buffer.alloc(0);
    }

    const cseq = Array.isArray(req.headers['cseq']) ? req.headers['cseq'][0] : (req.headers['cseq'] || '0');
    res.writeHead(statusCode, {
      'Content-Type': 'application/x-apple-binary-plist',
      'Content-Length': responseBody.length.toString(),
      'CSeq': cseq,
      'X-Apple-ProtocolVersion': '1',
      ...corsHeaders,
    });
    res.end(responseBody);
  }

  private async handlePairVerify(req: http.IncomingMessage, res: http.ServerResponse, corsHeaders: Record<string, string>): Promise<void> {
    logInfo(`=== HANDLING PAIR-VERIFY REQUEST ===`);
    
    // Read request body (binary PLIST)
    let requestData: any = null;
    if (req.headers['content-length'] && parseInt(req.headers['content-length']) > 0) {
      const body: Buffer[] = [];
      for await (const chunk of req) {
        body.push(chunk);
      }
      const requestBody = Buffer.concat(body);
      logInfo(`Pair-verify request body: ${requestBody.length} bytes`);
      logDebug(`Request body preview (hex): ${requestBody.toString('hex').substring(0, 200)}`);
      
      try {
        if (requestBody.toString('ascii', 0, 8) === 'bplist00') {
          const parsed = bplistParser.parseBuffer(requestBody);
          requestData = parsed[0];
          logInfo(`Decoded pair-verify request:`, JSON.stringify(requestData, null, 2));
        }
      } catch (err) {
        logError(`Could not decode pair-verify request:`, err);
      }
    }

    // Pair verification typically involves:
    // 1. Client sends public key
    // 2. Server responds with public key and encrypted data
    // 3. Client sends encrypted data
    // 4. Server verifies and completes
    
    const method = requestData?.method || requestData?.state || 'start';
    logInfo(`Pair-verify method/state: ${method}`);

    let responseData: Record<string, any> = {};
    let statusCode = 200;

    // Step 1: Client sends public key - return server public key
    if (method === 0 || method === 'start' || !requestData) {
      const serverPublicKey = crypto.randomBytes(32);
      const encryptedData = crypto.randomBytes(16);
      
      responseData = {
        publicKey: serverPublicKey.toString('base64'),
        encryptedData: encryptedData.toString('base64'),
        state: 1,
      };
      logInfo(`Pair-verify step 1: returning server public key`);
    }
    // Step 2: Client sends encrypted data - verify and complete
    else if (method === 1 || method === 'verify') {
      // In full implementation, verify the encrypted data
      // For now, accept it
      responseData = {
        state: 2, // Complete
      };
      logInfo(`Pair-verify step 2: verification complete`);
      
      // Update status to connected
      this.status = 'connected';
      this.sendStatusUpdate();
      logInfo(`Status updated to: connected`);
    }
    // Default: accept verification
    else {
      responseData = {
        state: 2, // Complete
      };
      this.status = 'connected';
      this.sendStatusUpdate();
      logInfo(`Pair-verify: accepting verification, status updated to: connected`);
    }

    // Encode response as binary PLIST
    let responseBody: Buffer;
    try {
      responseBody = bplistCreator(responseData);
      logInfo(`Pair-verify response:`, JSON.stringify(responseData, null, 2));
      logDebug(`Pair-verify response body size: ${responseBody.length} bytes`);
    } catch (err) {
      logError(`Error creating pair-verify response:`, err);
      responseBody = Buffer.alloc(0);
    }

    const cseq = Array.isArray(req.headers['cseq']) ? req.headers['cseq'][0] : (req.headers['cseq'] || '0');
    res.writeHead(statusCode, {
      'Content-Type': 'application/x-apple-binary-plist',
      'Content-Length': responseBody.length.toString(),
      'CSeq': cseq,
      'X-Apple-ProtocolVersion': '1',
      ...corsHeaders,
    });
    res.end(responseBody);
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
}

export const airplayServer = new AirPlayServer();
