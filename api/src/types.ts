import { WebSocket } from 'ws';

// Reserved namespaces that cannot be registered
export const RESERVED_NAMESPACES = [
  'echolon',
  'test',
  'admin',
  'api',
  'root',
  'www',
  'mail',
  'ftp',
  'localhost',
] as const;

// Minimum namespace length
export const MIN_NAMESPACE_LENGTH = 3;

// WebSocket message types
export interface RegisterMessage {
  type: 'register';
  namespace: string;
  userId: string; // Unique user ID to allow reconnection
  forwardTo?: string; // Optional URL to forward requests to
}

export interface RequestMessage {
  type: 'request';
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body?: string;
}

export interface ResponseMessage {
  type: 'response';
  id: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body?: string;
  servedByMock?: boolean;
}

export interface ErrorMessage {
  type: 'error';
  id?: string;
  message: string;
  code?: string;
}

export interface PingMessage {
  type: 'ping';
}

export interface PongMessage {
  type: 'pong';
}

export interface StatusMessage {
  type: 'status';
  connected: boolean;
  namespace?: string;
  message?: string;
}

export type IncomingMessage = RegisterMessage | ResponseMessage | PongMessage;
export type OutgoingMessage = RequestMessage | ErrorMessage | PingMessage | StatusMessage;

// Connected client info
export interface ConnectedClient {
  ws: WebSocket;
  namespace: string;
  userId: string;
  forwardTo?: string;
  connectedAt: number;
  lastPing: number;
}

// Pending request awaiting response
export interface PendingRequest {
  id: string;
  namespace: string;
  resolve: (response: ResponseMessage) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  createdAt: number;
}

// Server configuration
export interface ServerConfig {
  port: number;
  wsPort?: number; // If different from HTTP port
  requestTimeout: number; // ms
  pingInterval: number; // ms
  allowedOrigins?: string[];
}

export const DEFAULT_CONFIG: ServerConfig = {
  port: 3500,
  requestTimeout: 30000, // 30 seconds
  pingInterval: 30000, // 30 seconds
};

// Mock route stored on proxy server
export interface StoredMock {
  id: string;
  method: string;
  path: string;
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    delay?: number;
  };
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// Namespace mocks storage
export interface NamespaceMocks {
  namespace: string;
  mocks: StoredMock[];
}

