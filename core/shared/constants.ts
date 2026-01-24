export const APP_NAME = 'Echolon';
export const APP_VERSION = '1.0.0';

export const STORAGE_KEYS = {
  COLLECTIONS: 'echolonCollections',
  ENVIRONMENTS: 'echolonEnvironments',
  SELECTED_ENVIRONMENT: 'echolonSelectedEnvironment',
  HISTORY: 'echolonHistory',
  SETTINGS: 'echolonSettings',
  THEME: 'echolonTheme',
  COLOR_SCHEME: 'echolonColorScheme',
  TABS: 'echolonTabs',
  ACTIVE_TAB: 'echolonActiveTab',
  PANEL_SIZES: 'echolonPanelSizes',
  WORKSPACES: 'echolonWorkspaces',
  ACTIVE_WORKSPACE: 'echolonActiveWorkspace',
  MOCK_APIS: 'echolonMockApis',
  CAPTURED_REQUESTS: 'echolonCapturedRequests',
  ACTIVE_MOCK_API_ID: 'echolonActiveMockApiId',
  USER_ID: 'echolonUserId',
  SIDEBAR_VIEW: 'echolonSidebarView',
  CUSTOM_HTTP_METHODS: 'echolonCustomHttpMethods',
  PENDING_SPEC_CHANGES: 'echolonPendingSpecChanges',
} as const;

export const WORKSPACE_COLORS = [
  '#6366f1', // Indigo (primary)
  '#f43f5e', // Rose
  '#22c55e', // Green
  '#f59e0b', // Amber
  '#06b6d4', // Cyan
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#14b8a6', // Teal
] as const;

export const HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const;

export const METHOD_COLORS: Record<string, string> = {
  GET: '#61affe',
  POST: '#49cc90',
  PUT: '#fca130',
  PATCH: '#50e3c2',
  DELETE: '#f93e3e',
  HEAD: '#9012fe',
  OPTIONS: '#0d5aa7',
};

export const DEFAULT_HEADERS = [
  // Common Request Headers
  'Accept',
  'Accept-Charset',
  'Accept-Encoding',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Connection',
  'Content-Disposition',
  'Content-Encoding',
  'Content-Language',
  'Content-Length',
  'Content-Type',
  'Cookie',
  'Date',
  'ETag',
  'Expect',
  'Forwarded',
  'From',
  'Host',
  'If-Match',
  'If-Modified-Since',
  'If-None-Match',
  'If-Range',
  'If-Unmodified-Since',
  'Keep-Alive',
  'Max-Forwards',
  'Origin',
  'Pragma',
  'Proxy-Authorization',
  'Range',
  'Referer',
  'TE',
  'Trailer',
  'Transfer-Encoding',
  'Upgrade',
  'User-Agent',
  'Via',
  'Warning',
  // CORS Headers
  'Access-Control-Allow-Credentials',
  'Access-Control-Allow-Headers',
  'Access-Control-Allow-Methods',
  'Access-Control-Allow-Origin',
  'Access-Control-Expose-Headers',
  'Access-Control-Max-Age',
  'Access-Control-Request-Headers',
  'Access-Control-Request-Method',
  // Security Headers
  'Content-Security-Policy',
  'Strict-Transport-Security',
  'X-Content-Type-Options',
  'X-Frame-Options',
  'X-XSS-Protection',
  // Custom/Common Headers
  'X-API-Key',
  'X-Auth-Token',
  'X-Correlation-ID',
  'X-Custom-Header',
  'X-Forwarded-For',
  'X-Forwarded-Host',
  'X-Forwarded-Proto',
  'X-Real-IP',
  'X-Request-ID',
  'X-Requested-With',
];

export const CONTENT_TYPES = [
  'application/json',
  'application/xml',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
  'text/html',
  'text/xml',
];

export const AUTH_TYPES = [
  'none',
  'basic',
  'bearer',
  'api-key',
  'oauth2',
  'jwt',
  'digest',
  'aws-signature',
] as const;

// IPC channels are now defined in ./ipc-channels.ts
// Import from there: import { UPDATE_CHANNELS, APP_CHANNELS, ... } from './ipc-channels';


// Sync frequency options in minutes (0 = manual only)
export const SYNC_FREQUENCY_OPTIONS = [
  { value: 0, label: 'Manual only' },
   { value: 1, label: 'Every 1 minute' },
   { value: 5, label: 'Every 5 minutes' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 360, label: 'Every 6 hours' },
  { value: 1440, label: 'Every 24 hours' },
] as const;

// Default sample request for testing
export const SAMPLE_REQUEST = {
  name: 'Sample Todos',
  method: 'GET' as const,
  url: 'https://sample-api.echolon.app/tasks',
};
