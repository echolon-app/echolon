import { BrowserWindow } from 'electron';
import http from 'http';
import crypto from 'crypto';
import plist from 'plist';

// bplist packages don't have TypeScript types
const bplistParser = require('bplist-parser');
const bplistCreator = require('bplist-creator');

type ConnectionStatus = 'idle' | 'starting' | 'pairing' | 'connected' | 'error';

interface AirPlayServerStatus {
  status: ConnectionStatus;
  pairingCode?: string;
  error?: string;
}

class AirPlayServer {
  private server: http.Server | null = null;
  private mainWindow: BrowserWindow | null = null;
  private status: ConnectionStatus = 'idle';
  private pairingCode: string | null = null;
  private bonjourService: any = null; // Will be typed when bonjour is added
  private port: number = 7000;
  private readonly portRange = [7000, 7001, 7002, 7003, 7004, 7005];
  private persistentPublicKey: Buffer | null = null; // Persistent ED25519 public key for pairing

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
        // Log all incoming connections
        console.log(`[AirPlay] New connection from ${req.socket.remoteAddress}:${req.socket.remotePort}`);
        
        // Log connection errors
        req.socket.on('error', (err) => {
          console.error('[AirPlay] Socket error:', err);
        });
        
        // Log when connection closes
        req.socket.on('close', () => {
          console.log(`[AirPlay] Connection closed from ${req.socket.remoteAddress}:${req.socket.remotePort}`);
        });
        
        this.handleRequest(req, res);
      });
      
      // Log server errors
      this.server.on('error', (err) => {
        console.error('[AirPlay] Server error:', err);
      });
      
      this.server.on('clientError', (err, socket) => {
        console.error('[AirPlay] Client error:', err);
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
              console.log(`[AirPlay] Server started on port ${port}`);
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
          console.log('[AirPlay] Server stopped');
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
          name: 'Echolon V4',
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
        console.log('[AirPlay] Service advertised via Bonjour');
      } else {
        console.warn('[AirPlay] Bonjour not available, service will not be discoverable');
      }
    } catch (error) {
      console.error('[AirPlay] Failed to advertise service:', error);
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

    console.log(`[AirPlay] ${method} ${url}`, {
      headers: req.headers,
    });

    // Log response errors
    res.on('error', (err) => {
      console.error(`[AirPlay] Response error for ${method} ${url}:`, err);
    });

    // Log when response finishes
    res.on('finish', () => {
      console.log(`[AirPlay] Response finished for ${method} ${url}, status: ${res.statusCode}`);
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

    // Add CORS headers to all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, User-Agent, X-Apple-*',
    };

    // Handle AirPlay protocol endpoints
    // Log all requests to see what iPhone is trying
    console.log(`[AirPlay] Routing ${method} ${url} - checking handlers...`);
    
    if (url === '/server-info' || url === '/info') {
      this.handleServerInfo(req, res, corsHeaders).catch((err) => {
        console.error('[AirPlay] Error handling server-info:', err);
        res.writeHead(500, {
          'Content-Type': 'text/plain',
          ...corsHeaders,
        });
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
    } else {
      console.log(`[AirPlay] Unhandled endpoint: ${url}`);
      res.writeHead(404, {
        'Content-Type': 'text/plain',
        ...corsHeaders,
      });
      res.end('Not Found');
    }
  }

  private async handleServerInfo(req: http.IncomingMessage, res: http.ServerResponse, corsHeaders: Record<string, string>): Promise<void> {
    console.log('[AirPlay] Handling server-info request');
    
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
      console.log('[AirPlay] Request body received:', requestBody.length, 'bytes');
      
      // Try to decode binary PLIST request
      try {
        if (requestBody.toString('ascii', 0, 8) === 'bplist00') {
          const parsed = bplistParser.parseBuffer(requestBody);
          requestData = parsed[0];
          console.log('[AirPlay] Decoded binary PLIST request:', JSON.stringify(requestData));
        }
      } catch (err) {
        console.log('[AirPlay] Could not decode binary PLIST request:', err);
      }
    }

    // Build server-info response matching UxPlay implementation
    const deviceId = this.getDeviceId();
    
    // Check if iPhone is requesting specific qualifiers (txtAirPlay or txtRAOP)
    const wantsTxtAirPlay = requestData?.qualifier?.includes('txtAirPlay') || 
                            req.url?.includes('txtAirPlay');
    const wantsTxtRAOP = requestData?.qualifier?.includes('txtRAOP') || 
                         req.url?.includes('txtRAOP');
    
    // UxPlay's logic: if content_type exists AND it's a txtAirPlay-only request, return early
    // BUT: if CSeq exists, iPhone expects full response (CSeq indicates RTSP/HTTP request, not Bluetooth LE)
    // Note: Node.js HTTP headers are lowercase, so 'cseq' not 'CSeq'
    const hasCSeq = req.headers['cseq'] !== undefined || req.headers['CSeq'] !== undefined;
    console.log('[AirPlay] Debug: hasCSeq =', hasCSeq, ', cseq header =', req.headers['cseq'], ', hasContentType =', hasContentType, ', wantsTxtAirPlay =', wantsTxtAirPlay, ', requestData?.deviceID =', requestData?.deviceID);
    
    // Early return ONLY for Bluetooth LE discovery (no CSeq header)
    // UxPlay line 109: "if (content_type) { goto finished; }" - but this is for Bluetooth LE
    // When iPhone sends CSeq, it's a proper RTSP request and expects full response
    if (!hasCSeq && hasContentType && wantsTxtAirPlay && !requestData?.deviceID) {
      console.log('[AirPlay] Early return for txtAirPlay-only request (Bluetooth LE discovery - no CSeq)');
      const txtRecord = [
        `deviceid=${deviceId}`,
        `features=0x5A7FFFF7`,
        `model=AppleTV6,2`,
        `osvers=11.0`,
        `srcvers=220.68`,
      ].join('\0');
      const txtBuffer = Buffer.from(txtRecord, 'utf8');
      
      // Create minimal response with just txtAirPlay
      const minimalResponse: Record<string, any> = {
        txtAirPlay: txtBuffer, // Keep as Buffer - bplist-creator should handle it
      };
      
      try {
        const responseBody = bplistCreator(minimalResponse);
        console.log('[AirPlay] txtAirPlay-only response created, size:', responseBody.length, 'bytes');
        console.log('[AirPlay] Response starts with:', responseBody.toString('ascii', 0, 8));
        
        // Verify the encoding
        try {
          const verify = bplistParser.parseBuffer(responseBody);
          console.log('[AirPlay] ✓ txtAirPlay-only response decodes correctly');
          if (verify[0].txtAirPlay) {
            const decodedTxt = Buffer.isBuffer(verify[0].txtAirPlay) 
              ? verify[0].txtAirPlay.toString('utf8')
              : Buffer.from(verify[0].txtAirPlay).toString('utf8');
            console.log('[AirPlay] Decoded txtAirPlay content:', decodedTxt);
            console.log('[AirPlay] txtAirPlay length:', decodedTxt.length);
          }
        } catch (verifyErr) {
          console.error('[AirPlay] ✗ txtAirPlay-only response decode failed:', verifyErr);
        }
        
        const responseHeaders: Record<string, string> = {
          'Content-Type': 'application/x-apple-binary-plist',
          'Content-Length': responseBody.length.toString(),
        };
        res.writeHead(200, responseHeaders);
        res.end(responseBody);
        return;
      } catch (err) {
        console.error('[AirPlay] Error creating txtAirPlay-only response:', err);
        res.writeHead(500);
        res.end();
        return;
      }
    }
    
    // If CSeq is present, continue to full response (iPhone expects full info even if it requested txtAirPlay)
    
    // Full server-info response matching UxPlay structure
    // Based on UxPlay's raop_handler_info implementation
    const serverInfo: Record<string, any> = {
      deviceID: deviceId, // MAC address format
      macAddress: deviceId, // UxPlay includes both deviceID and macAddress
      features: 0x5A7FFFF7, // INTEGER bitmask
      model: 'AppleTV6,2',
      protocolVersion: '1.1',
      sourceVersion: '220.68',
      statusFlags: 68, // UxPlay uses 68, not 4! (68 = ready, 4 might mean something else)
      name: 'Echolon V2', // Server name
      pi: 'B8E5AA8E-58B1-4136-A5C6-2650298C23D2', // Pairing identifier (from UxPlay)
      vv: 2, // Version (UxPlay uses AIRPLAY_VV which is "2")
      keepAliveLowPower: 1, // UxPlay includes this
      keepAliveSendStatsAsBody: true, // UxPlay includes this
      sdk: 'AirPlay;2.0.4',
    };
    
    // Add public key (pk) as binary data - UxPlay includes this
    // Generate a persistent public key (32 bytes for ED25519)
    // For now, use a fixed key - in production this should be persistent
    if (!this.persistentPublicKey) {
      this.persistentPublicKey = crypto.randomBytes(32);
    }
    serverInfo.pk = this.persistentPublicKey; // Buffer should work with bplist-creator
    
    // iPhone explicitly requests txtAirPlay - include it as binary data
    if (wantsTxtAirPlay) {
      console.log('[AirPlay] iPhone requested txtAirPlay qualifier - including TXT record as binary data');
      const txtRecord = [
        `deviceid=${deviceId}`,
        `features=0x5A7FFFF7`,
        `model=AppleTV6,2`,
        `osvers=11.0`,
        `srcvers=220.68`,
      ].join('\0');
      const txtBuffer = Buffer.from(txtRecord, 'utf8');
      serverInfo.txtAirPlay = txtBuffer; // Keep as Buffer
    }
    
    if (wantsTxtRAOP) {
      console.log('[AirPlay] iPhone requested txtRAOP qualifier - including RAOP TXT record');
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
    }

    // Log what we're sending
    console.log('[AirPlay] Server info to send:', JSON.stringify(serverInfo, null, 2));

    // Check if iPhone wants binary PLIST response
    const wantsBinary = hasContentType || 
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
        console.log('[AirPlay] Sending binary PLIST response, size:', responseBody.length, 'bytes');
        
        // Verify binary PLIST format
        if (responseBody.toString('ascii', 0, 8) === 'bplist00') {
          console.log('[AirPlay] ✓ Valid binary PLIST format');
        } else {
          console.error('[AirPlay] ✗ Invalid binary PLIST format! First 8 bytes:', responseBody.toString('ascii', 0, 8));
        }
        
        // Try to decode it back to verify structure
        try {
          const verify = bplistParser.parseBuffer(responseBody);
          console.log('[AirPlay] ✓ Binary PLIST decoded back:', JSON.stringify(verify[0], null, 2));
          // Check if txtAirPlay is properly encoded
          if (verify[0].txtAirPlay) {
            console.log('[AirPlay] txtAirPlay in decoded response:', 
              Buffer.isBuffer(verify[0].txtAirPlay) ? 'Buffer' : typeof verify[0].txtAirPlay);
          }
        } catch (verifyErr) {
          console.error('[AirPlay] ✗ Binary PLIST cannot be decoded back:', verifyErr);
        }
      } catch (err) {
        console.error('[AirPlay] Error creating binary PLIST:', err);
        // Fallback to XML
        const plistXml = this.plistEncode(serverInfo);
        responseBody = Buffer.from(plistXml, 'utf8');
        responseContentType = 'text/x-apple-plist+xml';
        console.log('[AirPlay] Falling back to XML PLIST');
      }
    } else {
      const plistXml = this.plistEncode(serverInfo);
      responseBody = Buffer.from(plistXml, 'utf8');
      responseContentType = 'text/x-apple-plist+xml';
      console.log('[AirPlay] Sending XML PLIST response');
    }

    // Important AirPlay headers
    const cseq = Array.isArray(req.headers['cseq']) ? req.headers['cseq'][0] : (req.headers['cseq'] || '0');
    const responseHeaders: Record<string, string> = {
      'Content-Type': responseContentType,
      'Content-Length': responseBody.length.toString(),
      'Server': 'AirPlay/220.68',
      'CSeq': cseq,
      'X-Apple-ProtocolVersion': '1',
    };

    console.log('[AirPlay] Response headers:', responseHeaders);
    console.log('[AirPlay] Response body preview (first 100 bytes hex):', responseBody.toString('hex').substring(0, 100));
    
    // Use HTTP/1.1 as required by AirPlay spec
    res.writeHead(200, responseHeaders);
    res.end(responseBody);
    
    // Log after sending to see if there are any errors
    res.on('finish', () => {
      console.log('[AirPlay] Response sent successfully, status code:', res.statusCode);
    });
    res.on('error', (err) => {
      console.error('[AirPlay] Error sending response:', err);
    });
  }

  private async handlePairSetup(req: http.IncomingMessage, res: http.ServerResponse, corsHeaders: Record<string, string>): Promise<void> {
    console.log('[AirPlay] Handling pair-setup request');
    
    // Read request body (binary PLIST)
    let requestData: any = null;
    if (req.headers['content-length'] && parseInt(req.headers['content-length']) > 0) {
      const body: Buffer[] = [];
      for await (const chunk of req) {
        body.push(chunk);
      }
      const requestBody = Buffer.concat(body);
      console.log('[AirPlay] Pair-setup request body:', requestBody.length, 'bytes');
      
      try {
        if (requestBody.toString('ascii', 0, 8) === 'bplist00') {
          const parsed = bplistParser.parseBuffer(requestBody);
          requestData = parsed[0];
          console.log('[AirPlay] Decoded pair-setup request:', JSON.stringify(requestData));
        }
      } catch (err) {
        console.log('[AirPlay] Could not decode pair-setup request:', err);
      }
    }

    // AirPlay pairing uses SRP (Secure Remote Password) protocol
    // The pairing flow typically has multiple steps (M1, M2, M3, M4, M5)
    // For now, we'll implement a simplified version that accepts pairing
    
    // Check what step we're on (if method is specified)
    const method = requestData?.method || requestData?.state || 'start';
    console.log('[AirPlay] Pair-setup method/state:', method);

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
      console.log('[AirPlay] Pair-setup step 1: returning salt and public key');
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
      console.log('[AirPlay] Pair-setup step 2: verifying and returning server proof');
    }
    // Step 3: Exchange encryption keys
    else if (method === 2 || method === 'exchange') {
      // Generate session key
      const sessionKey = crypto.randomBytes(32);
      
      responseData = {
        sessionKey: sessionKey.toString('base64'),
        state: 3, // Complete
      };
      console.log('[AirPlay] Pair-setup step 3: exchanging keys');
    }
    // Default: accept pairing
    else {
      responseData = {
        state: 3, // Complete
      };
      console.log('[AirPlay] Pair-setup: accepting pairing');
    }

    // Encode response as binary PLIST
    let responseBody: Buffer;
    try {
      responseBody = bplistCreator(responseData);
      console.log('[AirPlay] Pair-setup response:', JSON.stringify(responseData));
    } catch (err) {
      console.error('[AirPlay] Error creating pair-setup response:', err);
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
    console.log('[AirPlay] Handling pair-verify request');
    
    // Read request body (binary PLIST)
    let requestData: any = null;
    if (req.headers['content-length'] && parseInt(req.headers['content-length']) > 0) {
      const body: Buffer[] = [];
      for await (const chunk of req) {
        body.push(chunk);
      }
      const requestBody = Buffer.concat(body);
      console.log('[AirPlay] Pair-verify request body:', requestBody.length, 'bytes');
      
      try {
        if (requestBody.toString('ascii', 0, 8) === 'bplist00') {
          const parsed = bplistParser.parseBuffer(requestBody);
          requestData = parsed[0];
          console.log('[AirPlay] Decoded pair-verify request:', JSON.stringify(requestData));
        }
      } catch (err) {
        console.log('[AirPlay] Could not decode pair-verify request:', err);
      }
    }

    // Pair verification typically involves:
    // 1. Client sends public key
    // 2. Server responds with public key and encrypted data
    // 3. Client sends encrypted data
    // 4. Server verifies and completes
    
    const method = requestData?.method || requestData?.state || 'start';
    console.log('[AirPlay] Pair-verify method/state:', method);

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
      console.log('[AirPlay] Pair-verify step 1: returning server public key');
    }
    // Step 2: Client sends encrypted data - verify and complete
    else if (method === 1 || method === 'verify') {
      // In full implementation, verify the encrypted data
      // For now, accept it
      responseData = {
        state: 2, // Complete
      };
      console.log('[AirPlay] Pair-verify step 2: verification complete');
      
      // Update status to connected
      this.status = 'connected';
      this.sendStatusUpdate();
    }
    // Default: accept verification
    else {
      responseData = {
        state: 2, // Complete
      };
      this.status = 'connected';
      this.sendStatusUpdate();
      console.log('[AirPlay] Pair-verify: accepting verification');
    }

    // Encode response as binary PLIST
    let responseBody: Buffer;
    try {
      responseBody = bplistCreator(responseData);
      console.log('[AirPlay] Pair-verify response:', JSON.stringify(responseData));
    } catch (err) {
      console.error('[AirPlay] Error creating pair-verify response:', err);
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
    console.log('[AirPlay] Handling play request');
    // Video stream handler
    // In a full implementation, this would receive and process video streams
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      ...corsHeaders,
    });
    res.end();
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
