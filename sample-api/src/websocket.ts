import { v4 as uuidv4 } from 'uuid';
import { IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

// ============================================================================
// WebSocket Echo Server
// ============================================================================

export function startWebSocketServer(port: number) {
  const wss = new WebSocketServer({ port });

  // Track connected clients
  let clientCount = 0;

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    clientCount++;
    const clientId = uuidv4().slice(0, 8);
    const clientIp = req.socket.remoteAddress || 'unknown';
    
    console.log(`[WS] Client ${clientId} connected from ${clientIp}. Total clients: ${clientCount}`);

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Connected to Echolon WebSocket Echo Server',
      clientId,
      timestamp: new Date().toISOString(),
    }));

    // Echo back any message received
    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      const rawMessage = data.toString();
      console.log(`[WS] Received from ${clientId}: ${rawMessage.slice(0, 100)}${rawMessage.length > 100 ? '...' : ''}`);

      // Try to parse as JSON and add metadata, otherwise echo raw
      try {
        const parsed = JSON.parse(rawMessage);
        const response = {
          type: 'echo',
          originalMessage: parsed,
          clientId,
          timestamp: new Date().toISOString(),
          receivedAt: Date.now(),
        };
        ws.send(JSON.stringify(response));
      } catch {
        // Not JSON, echo back as-is with wrapper
        if (isBinary) {
          // For binary data, echo back exactly as received
          ws.send(data);
        } else {
          const response = {
            type: 'echo',
            originalMessage: rawMessage,
            clientId,
            timestamp: new Date().toISOString(),
            receivedAt: Date.now(),
          };
          ws.send(JSON.stringify(response));
        }
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      clientCount--;
      console.log(`[WS] Client ${clientId} disconnected (code: ${code}). Total clients: ${clientCount}`);
    });

    ws.on('error', (error: Error) => {
      console.error(`[WS] Error from client ${clientId}:`, error.message);
    });

    // Send periodic ping to keep connection alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);

    ws.on('close', () => {
      clearInterval(pingInterval);
    });
  });

  wss.on('error', (error: Error) => {
    console.error('[WS] Server error:', error.message);
  });

  return wss;
}

