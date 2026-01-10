import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import {
  ConnectedClient,
  IncomingMessage,
  OutgoingMessage,
  RegisterMessage,
  ResponseMessage,
  PendingRequest,
  ServerConfig,
  StatusMessage,
  RESERVED_NAMESPACES,
  MIN_NAMESPACE_LENGTH,
} from './types';

export class WSManager {
  private wss: WebSocketServer;
  private config: ServerConfig;
  private clients: Map<string, ConnectedClient> = new Map(); // namespace -> client
  private pendingRequests: Map<string, PendingRequest> = new Map(); // requestId -> pending
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(wss: WebSocketServer, config: ServerConfig) {
    this.wss = wss;
    this.config = config;
    this.setupWebSocketServer();
    this.startPingInterval();
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws: WebSocket, req) => {
      console.log(`[WS] New connection from ${req.socket.remoteAddress}`);

      let clientNamespace: string | null = null;

      ws.on('message', (data: Buffer) => {
        try {
          const message: IncomingMessage = JSON.parse(data.toString());
          this.handleMessage(ws, message, (ns) => {
            clientNamespace = ns;
          });
        } catch (error) {
          console.error('[WS] Failed to parse message:', error);
          this.sendError(ws, 'Invalid message format');
        }
      });

      ws.on('close', () => {
        console.log(`[WS] Connection closed${clientNamespace ? ` for namespace: ${clientNamespace}` : ''}`);
        if (clientNamespace) {
          this.removeClient(clientNamespace);
        }
      });

      ws.on('error', (error) => {
        console.error(`[WS] Connection error${clientNamespace ? ` for namespace: ${clientNamespace}` : ''}:`, error);
        if (clientNamespace) {
          this.removeClient(clientNamespace);
        }
      });

      // Send welcome message
      this.send(ws, {
        type: 'status',
        connected: true,
        message: 'Connected to Echolon Proxy. Send a "register" message with your namespace.',
      });
    });
  }

  private handleMessage(ws: WebSocket, message: IncomingMessage, setNamespace: (ns: string) => void): void {
    switch (message.type) {
      case 'register':
        this.handleRegister(ws, message as RegisterMessage, setNamespace);
        break;

      case 'response':
        this.handleResponse(message as ResponseMessage);
        break;

      case 'pong':
        // Update last ping time
        for (const [ns, client] of this.clients.entries()) {
          if (client.ws === ws) {
            client.lastPing = Date.now();
            break;
          }
        }
        break;

      default:
        console.warn('[WS] Unknown message type:', (message as any).type);
    }
  }

  private handleRegister(ws: WebSocket, message: RegisterMessage, setNamespace: (ns: string) => void): void {
    const { namespace, userId, forwardTo } = message;

    // Validate userId
    if (!userId) {
      this.sendError(ws, 'User ID is required.');
      return;
    }

    // Validate namespace format
    if (!namespace || !/^[a-z0-9-]+$/.test(namespace)) {
      this.sendError(ws, 'Invalid namespace. Use lowercase letters, numbers, and hyphens only.');
      return;
    }

    // Check minimum length
    if (namespace.length < MIN_NAMESPACE_LENGTH) {
      this.sendError(ws, `Namespace must be at least ${MIN_NAMESPACE_LENGTH} characters long.`);
      return;
    }

    // Check reserved namespaces
    if (RESERVED_NAMESPACES.includes(namespace as any)) {
      this.sendError(ws, `Namespace "${namespace}" is reserved and cannot be used.`);
      return;
    }

    // Check if namespace is already taken
    const existingClient = this.clients.get(namespace);
    if (existingClient) {
      // If same userId, allow reconnection (kick old connection)
      if (existingClient.userId === userId) {
        console.log(`[WS] User ${userId} reconnecting to namespace: ${namespace} - disconnecting old connection`);
        this.send(existingClient.ws, {
          type: 'status',
          connected: false,
          message: 'Disconnected: Another session connected with the same user.',
        });
        existingClient.ws.close();
        this.clients.delete(namespace);
      } else {
        // Different userId - namespace is taken
        this.sendError(ws, `Namespace "${namespace}" is already in use by another user.`);
        return;
      }
    }

    // Register the client
    const client: ConnectedClient = {
      ws,
      namespace,
      userId,
      forwardTo,
      connectedAt: Date.now(),
      lastPing: Date.now(),
    };

    this.clients.set(namespace, client);
    setNamespace(namespace);

    console.log(`[WS] Registered namespace: ${namespace} (user: ${userId})${forwardTo ? ` -> ${forwardTo}` : ''}`);

    // Send success response
    this.send(ws, {
      type: 'status',
      connected: true,
      namespace,
      message: `Successfully registered as ${namespace}.echolon.app`,
    });
  }

  private handleResponse(message: ResponseMessage): void {
    const pending = this.pendingRequests.get(message.id);
    if (!pending) {
      console.warn(`[WS] Received response for unknown request: ${message.id}`);
      return;
    }

    // Clear timeout and resolve promise
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.id);
    pending.resolve(message);
  }

  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      const now = Date.now();
      const timeout = this.config.pingInterval * 2; // Consider dead after 2 missed pings

      for (const [namespace, client] of this.clients.entries()) {
        // Check if client has timed out
        if (now - client.lastPing > timeout) {
          console.log(`[WS] Client ${namespace} timed out, disconnecting`);
          client.ws.close();
          this.removeClient(namespace);
          continue;
        }

        // Send ping
        this.send(client.ws, { type: 'ping' });
      }
    }, this.config.pingInterval);
  }

  private removeClient(namespace: string): void {
    const client = this.clients.get(namespace);
    if (client) {
      this.clients.delete(namespace);
      console.log(`[WS] Removed client: ${namespace}`);

      // Reject all pending requests for this namespace
      for (const [id, pending] of this.pendingRequests.entries()) {
        if (pending.namespace === namespace) {
          clearTimeout(pending.timeout);
          pending.reject(new Error('Client disconnected'));
          this.pendingRequests.delete(id);
        }
      }
    }
  }

  // Public methods

  isNamespaceConnected(namespace: string): boolean {
    return this.clients.has(namespace);
  }

  getClient(namespace: string): ConnectedClient | undefined {
    return this.clients.get(namespace);
  }

  getConnectedNamespaces(): string[] {
    return Array.from(this.clients.keys());
  }

  async sendRequest(namespace: string, request: Omit<import('./types').RequestMessage, 'type' | 'id'>): Promise<ResponseMessage> {
    const client = this.clients.get(namespace);
    if (!client) {
      throw new Error(`No client connected for namespace: ${namespace}`);
    }

    const id = uuidv4();
    const message: import('./types').RequestMessage = {
      type: 'request',
      id,
      ...request,
    };

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, this.config.requestTimeout);

      // Store pending request
      this.pendingRequests.set(id, {
        id,
        namespace,
        resolve,
        reject,
        timeout,
        createdAt: Date.now(),
      });

      // Send request to client
      this.send(client.ws, message);
    });
  }

  /**
   * Notify client about an incoming request without waiting for response.
   * This is used to populate the request list even for unmocked routes.
   */
  notifyRequest(namespace: string, request: Omit<import('./types').RequestMessage, 'type' | 'id'>): void {
    const client = this.clients.get(namespace);
    if (!client) {
      return; // No client connected, nothing to notify
    }

    const id = uuidv4();
    const message: import('./types').RequestMessage = {
      type: 'request',
      id,
      ...request,
    };

    // Send request notification (fire and forget)
    this.send(client.ws, message);
    console.log(`[WS] Notified ${namespace} about ${request.method} ${request.path}`);
  }

  /**
   * Notify client about a response (forwarded or mocked).
   * This allows the client to see responses from the forwarded endpoint or mocked responses.
   */
  notifyResponse(namespace: string, response: {
    method: string;
    path: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body?: string;
    servedByMock?: boolean;
  }): void {
    const client = this.clients.get(namespace);
    if (!client) {
      return;
    }

    const message = {
      type: 'forwardedResponse',
      ...response,
      timestamp: Date.now(),
    };

    this.send(client.ws, message as any);
    const source = response.servedByMock ? 'mocked' : 'forwarded';
    console.log(`[WS] Notified ${namespace} about ${source} response: ${response.status} ${response.statusText}`);
  }

  private send(ws: WebSocket, message: OutgoingMessage | StatusMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendError(ws: WebSocket, message: string, id?: string): void {
    this.send(ws, {
      type: 'error',
      id,
      message,
    });
  }

  shutdown(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    // Close all connections
    for (const [namespace, client] of this.clients.entries()) {
      this.send(client.ws, {
        type: 'status',
        connected: false,
        message: 'Server shutting down',
      });
      client.ws.close();
    }

    this.clients.clear();
    this.pendingRequests.clear();
  }
}

