/**
 * WebSocket Connection Manager
 * Manages WebSocket connections that persist across tab switches
 */

type WebSocketEventHandler = {
  onopen?: (event: Event) => void;
  onmessage?: (event: MessageEvent) => void;
  onerror?: (event: Event) => void;
  onclose?: (event: CloseEvent) => void;
};

interface ManagedConnection {
  ws: WebSocket;
  url: string;
  handlers: WebSocketEventHandler;
}

class WebSocketManager {
  private connections: Map<string, ManagedConnection> = new Map();

  /**
   * Get an existing WebSocket connection for a tab
   */
  getConnection(tabId: string): WebSocket | null {
    const connection = this.connections.get(tabId);
    return connection?.ws || null;
  }

  /**
   * Check if a connection exists and is open
   */
  isConnected(tabId: string): boolean {
    const ws = this.getConnection(tabId);
    return ws !== null && ws.readyState === WebSocket.OPEN;
  }

  /**
   * Check if a connection is in connecting state
   */
  isConnecting(tabId: string): boolean {
    const ws = this.getConnection(tabId);
    return ws !== null && ws.readyState === WebSocket.CONNECTING;
  }

  /**
   * Create a new WebSocket connection for a tab
   */
  connect(
    tabId: string,
    url: string,
    handlers: WebSocketEventHandler
  ): WebSocket {
    // Close existing connection if any
    this.disconnect(tabId);

    const ws = new WebSocket(url);

    // Wrap handlers to update the stored handlers reference
    ws.onopen = (event) => {
      const connection = this.connections.get(tabId);
      connection?.handlers.onopen?.(event);
    };

    ws.onmessage = (event) => {
      const connection = this.connections.get(tabId);
      connection?.handlers.onmessage?.(event);
    };

    ws.onerror = (event) => {
      const connection = this.connections.get(tabId);
      connection?.handlers.onerror?.(event);
    };

    ws.onclose = (event) => {
      const connection = this.connections.get(tabId);
      connection?.handlers.onclose?.(event);
      // Remove from connections when closed
      this.connections.delete(tabId);
    };

    this.connections.set(tabId, { ws, url, handlers });
    return ws;
  }

  /**
   * Update event handlers for an existing connection
   * This is called when the component remounts to attach new handlers
   */
  updateHandlers(tabId: string, handlers: WebSocketEventHandler): void {
    const connection = this.connections.get(tabId);
    if (connection) {
      connection.handlers = handlers;
    }
  }

  /**
   * Disconnect a WebSocket connection
   */
  disconnect(tabId: string): void {
    const connection = this.connections.get(tabId);
    if (connection) {
      if (connection.ws.readyState === WebSocket.OPEN || 
          connection.ws.readyState === WebSocket.CONNECTING) {
        connection.ws.close();
      }
      this.connections.delete(tabId);
    }
  }

  /**
   * Send a message through a WebSocket connection
   */
  send(tabId: string, data: string | ArrayBuffer | Blob): boolean {
    const connection = this.connections.get(tabId);
    if (connection && connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.send(data);
      return true;
    }
    return false;
  }

  /**
   * Get the URL of a connection
   */
  getUrl(tabId: string): string | null {
    const connection = this.connections.get(tabId);
    return connection?.url || null;
  }

  /**
   * Disconnect all connections (for cleanup)
   */
  disconnectAll(): void {
    for (const [tabId] of this.connections) {
      this.disconnect(tabId);
    }
  }
}

// Singleton instance
export const websocketManager = new WebSocketManager();
export default websocketManager;

