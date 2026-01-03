/**
 * .echo File Format v1.0
 * 
 * A JSON-based format for storing API collections with OpenAPI compatibility.
 * File extension: .json (stored in collections folder)
 */

import { KeyValuePair, AuthConfig, RequestBody, CollectionEnvironment, Folder, Request } from '../renderer/types';

// Schema version for the .echo format
export const ECHO_FORMAT_VERSION = '1.0';
export const ECHO_SCHEMA_URL = 'https://echolon.app/schemas/echo-v1.json';

/**
 * Metadata for the .echo file
 */
export interface EchoMetadata {
  id: string;
  name: string;
  description?: string;
  createdAt: string; // ISO 8601 date string
  modifiedAt: string; // ISO 8601 date string
  workspaceId: string;
  collapsed?: boolean; // UI state - whether collection is collapsed in sidebar
}

/**
 * Collection-level settings
 */
export interface EchoSettings {
  defaultEnvironmentId?: string;
  defaultHeaders?: KeyValuePair[];
  auth?: AuthConfig;
}

/**
 * Request definition in .echo format
 */
export interface EchoRequest {
  id: string;
  operationId?: string;
  name: string;
  method: string;
  url: string;
  headers: KeyValuePair[];
  queryParams: KeyValuePair[];
  body: RequestBody;
  auth: AuthConfig;
  scripts: {
    pre: string;
    post: string;
  };
}

/**
 * Folder structure in .echo format
 */
export interface EchoFolder {
  id: string;
  name: string;
  requests: EchoRequest[];
  folders: EchoFolder[];
  collapsed?: boolean;
}

/**
 * OpenAPI spec embedded in .echo file (optional)
 */
export interface EchoOpenAPI {
  openapi?: string;
  swagger?: string;
  info?: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{
    url: string;
    description?: string;
  }>;
  paths?: Record<string, unknown>;
}

/**
 * Spec source information for URL-imported collections
 */
export interface EchoSpecSource {
  type: 'url' | 'file';
  format?: 'openapi' | 'postman' | 'insomnia';
  url?: string;
  syncFrequencyMins?: number;
  lastSyncedAt?: number;
}

/**
 * Complete .echo file structure
 */
export interface EchoFile {
  $schema: string;
  version: string;
  metadata: EchoMetadata;
  settings: EchoSettings;
  environments: CollectionEnvironment[];
  openapi?: EchoOpenAPI;
  specSource?: EchoSpecSource;
  requests: EchoRequest[];
  folders: EchoFolder[];
}

/**
 * Workspace environment in file format
 */
export interface WorkspaceEnvironmentFile {
  id: string;
  name: string;
  variables: KeyValuePair[];
  isActive: boolean;
  color?: string;
  emoji?: string;
}

/**
 * Workspace metadata file (workspace.json)
 */
export interface WorkspaceFile {
  id: string;
  name: string;
  description?: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
  // Workspace-level environments
  environments?: WorkspaceEnvironmentFile[];
  selectedEnvironmentId?: string;
}

/**
 * Global config file (config.json)
 */
export interface EcholonConfig {
  version: string;
  echolonPath: string;
  theme: 'light' | 'dark' | 'system';
  colorScheme: string;
  settings: {
    fontSize: number;
    tabSize: number;
    wordWrap: boolean;
    autoSave: boolean;
    requestTimeout: number;
    followRedirects: boolean;
    validateSSL: boolean;
    proxyEnabled: boolean;
    proxyUrl?: string;
    showLineNumbers?: boolean;
    highlightActiveLine?: boolean;
    maxHistoryEntries?: number;
    autoCheckUpdates?: boolean;
    defaultSyncFrequencyMins?: number;
    sendUserAgent?: boolean;
  };
  github?: {
    authMethod: 'oauth' | 'pat';
    accessToken?: string; // Encrypted PAT or OAuth token
    refreshToken?: string; // OAuth refresh token
    username?: string;
    linkedRepos?: Array<{
      workspaceId: string;
      owner: string;
      repo: string;
      branch: string;
    }>;
  };
  ui?: {
    panelSizes?: {
      leftPanelWidth: number;
      consoleHeight: number;
      responseHeight: number;
    };
    sidebarView?: string;
    activeWorkspaceId?: string;
  };
}

/**
 * Global environments file (environments.json)
 */
export interface GlobalEnvironmentsFile {
  version: string;
  selectedEnvironmentId?: string;
  environments: Array<{
    id: string;
    name: string;
    variables: KeyValuePair[];
    isActive: boolean;
    color?: string;
    emoji?: string;
  }>;
}

/**
 * File system paths for Echolon storage
 */
export interface EcholonPaths {
  root: string;           // ~/Echolon
  config: string;         // ~/Echolon/config.json
  environments: string;   // ~/Echolon/environments.json
  workspaces: string;     // ~/Echolon/workspaces/
}

/**
 * Get the default Echolon path based on platform
 */
export function getDefaultEcholonPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return `${home}/Echolon`;
}

/**
 * Get all Echolon paths from a root directory
 */
export function getEcholonPaths(rootPath: string): EcholonPaths {
  return {
    root: rootPath,
    config: `${rootPath}/config.json`,
    environments: `${rootPath}/environments.json`,
    workspaces: `${rootPath}/workspaces`,
  };
}

/**
 * Create a default config file
 */
export function createDefaultConfig(echolonPath: string): EcholonConfig {
  return {
    version: ECHO_FORMAT_VERSION,
    echolonPath,
    theme: 'dark',
    colorScheme: 'midnight',
    settings: {
      fontSize: 13,
      tabSize: 2,
      wordWrap: true,
      autoSave: true,
      requestTimeout: 30000,
      followRedirects: true,
      validateSSL: true,
      proxyEnabled: false,
    },
    ui: {
      panelSizes: {
        leftPanelWidth: 280,
        consoleHeight: 200,
        responseHeight: 300,
      },
      sidebarView: 'collections',
    },
  };
}

/**
 * Create a default global environments file
 */
export function createDefaultEnvironmentsFile(): GlobalEnvironmentsFile {
  return {
    version: ECHO_FORMAT_VERSION,
    environments: [],
  };
}

/**
 * Create a default workspace file
 */
export function createDefaultWorkspaceFile(
  id: string,
  name: string,
  description?: string,
  color?: string
): WorkspaceFile {
  const now = new Date().toISOString();
  return {
    id,
    name,
    description,
    color,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Create a new empty .echo file
 */
export function createEmptyEchoFile(
  id: string,
  name: string,
  workspaceId: string,
  description?: string
): EchoFile {
  const now = new Date().toISOString();
  return {
    $schema: ECHO_SCHEMA_URL,
    version: ECHO_FORMAT_VERSION,
    metadata: {
      id,
      name,
      description,
      createdAt: now,
      modifiedAt: now,
      workspaceId,
    },
    settings: {},
    environments: [],
    requests: [],
    folders: [],
  };
}

