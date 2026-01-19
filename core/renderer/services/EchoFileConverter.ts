/**
 * Echo File Converter
 * 
 * Converts between internal Echolon types and the .echo file format.
 */

import {
  EchoFile,
  EchoRequest,
  EchoFolder,
  EchoMetadata,
  EchoSettings,
  EchoPublicSharing,
  WorkspaceFile,
  GlobalEnvironmentsFile,
  ECHO_SCHEMA_URL,
  ECHO_FORMAT_VERSION,
} from '../../shared/echoFormat';
import {
  Collection,
  Request,
  Folder,
  Workspace,
  Environment,
  KeyValuePair,
  AuthConfig,
  RequestBody,
  CollectionEnvironment,
} from '@/types';

/**
 * Convert a Collection to an EchoFile
 */
export function collectionToEchoFile(collection: Collection, workspaceName: string): EchoFile {
  return {
    $schema: ECHO_SCHEMA_URL,
    version: ECHO_FORMAT_VERSION,
    metadata: {
      id: collection.id,
      name: collection.name,
      description: collection.description,
      createdAt: new Date(collection.createdAt).toISOString(),
      modifiedAt: new Date(collection.updatedAt).toISOString(),
      workspaceId: collection.workspaceId || workspaceName,
      collapsed: collection.collapsed,
      order: collection.order,
    },
    settings: {
      defaultEnvironmentId: collection.defaultEnvironmentId,
      defaultHeaders: collection.headers,
      auth: collection.auth,
    },
    environments: collection.environments || [],
    openapi: collection.specSource?.rawSpec ? tryParseJson(collection.specSource.rawSpec) : undefined,
    // Save specSource info (URL, sync frequency, etc.) separately from the raw spec content
    specSource: collection.specSource ? {
      type: collection.specSource.type,
      format: collection.specSource.format,
      url: collection.specSource.url,
      syncFrequencyMins: collection.specSource.syncFrequencyMins,
      lastSyncedAt: collection.specSource.lastSyncedAt,
    } : undefined,
    // Save public sharing configuration
    publicSharing: collection.publicSharing ? {
      enabled: collection.publicSharing.enabled,
      subdomain: collection.publicSharing.subdomain,
      versions: collection.publicSharing.versions,
      lastPublishedAt: collection.publicSharing.lastPublishedAt,
    } : undefined,
    requests: collection.requests.map(requestToEchoRequest),
    folders: collection.folders.map(folderToEchoFolder),
  };
}

/**
 * Convert an EchoFile to a Collection
 */
export function echoFileToCollection(echoFile: EchoFile, workspaceId: string): Collection {
  // Validate the echo file has required metadata
  if (!echoFile || !echoFile.metadata || !echoFile.metadata.id) {
    throw new Error(`Invalid echo file: missing metadata.id. Got: ${JSON.stringify(echoFile?.metadata)}`);
  }

  // Build specSource from both the saved specSource metadata and the raw openapi content
  let specSource = undefined;
  if (echoFile.specSource || echoFile.openapi) {
    specSource = {
      type: echoFile.specSource?.type || 'file' as const,
      format: echoFile.specSource?.format || 'openapi' as const,
      url: echoFile.specSource?.url,
      syncFrequencyMins: echoFile.specSource?.syncFrequencyMins ?? 0,
      lastSyncedAt: echoFile.specSource?.lastSyncedAt,
      rawSpec: echoFile.openapi ? JSON.stringify(echoFile.openapi) : undefined,
    };
  }
  
  return {
    id: echoFile.metadata.id,
    name: echoFile.metadata.name,
    description: echoFile.metadata.description,
    createdAt: new Date(echoFile.metadata.createdAt).getTime(),
    updatedAt: new Date(echoFile.metadata.modifiedAt).getTime(),
    workspaceId,
    collapsed: echoFile.metadata.collapsed,
    order: echoFile.metadata.order,
    requests: (echoFile.requests || []).map(echoRequestToRequest),
    folders: (echoFile.folders || []).map(echoFolderToFolder),
    environments: echoFile.environments as CollectionEnvironment[],
    headers: echoFile.settings?.defaultHeaders as KeyValuePair[],
    auth: echoFile.settings?.auth as AuthConfig,
    defaultEnvironmentId: echoFile.settings?.defaultEnvironmentId,
    specSource,
    // Restore public sharing configuration
    publicSharing: echoFile.publicSharing ? {
      enabled: echoFile.publicSharing.enabled,
      subdomain: echoFile.publicSharing.subdomain,
      versions: echoFile.publicSharing.versions,
      lastPublishedAt: echoFile.publicSharing.lastPublishedAt,
    } : undefined,
  };
}

/**
 * Convert a Request to an EchoRequest
 */
function requestToEchoRequest(request: Request): EchoRequest {
  return {
    id: request.id,
    name: request.name,
    description: request.description,
    method: request.method,
    url: request.url,
    headers: request.headers,
    queryParams: request.queryParams,
    pathParams: request.pathParams,
    body: request.body,
    auth: request.auth,
    scripts: request.scripts,
    tags: request.tags,
    isDeprecated: request.isDeprecated,
  } as EchoRequest;
}

/**
 * Convert an EchoRequest to a Request
 */
function echoRequestToRequest(echoRequest: EchoRequest): Request {
  return {
    id: echoRequest.id,
    name: echoRequest.name,
    description: echoRequest.description,
    method: echoRequest.method,
    url: echoRequest.url,
    headers: echoRequest.headers as KeyValuePair[],
    queryParams: echoRequest.queryParams as KeyValuePair[],
    pathParams: echoRequest.pathParams as KeyValuePair[] || [],
    body: echoRequest.body as RequestBody,
    auth: echoRequest.auth as AuthConfig,
    scripts: echoRequest.scripts || { pre: '', post: '' },
    tags: echoRequest.tags,
    isDeprecated: echoRequest.isDeprecated,
  };
}

/**
 * Convert a Folder to an EchoFolder
 */
function folderToEchoFolder(folder: Folder): EchoFolder {
  return {
    id: folder.id,
    name: folder.name,
    requests: folder.requests.map(requestToEchoRequest),
    folders: folder.folders.map(folderToEchoFolder),
    collapsed: folder.collapsed,
    isDeprecated: folder.isDeprecated,
  };
}

/**
 * Convert an EchoFolder to a Folder
 */
function echoFolderToFolder(echoFolder: EchoFolder): Folder {
  return {
    id: echoFolder.id,
    name: echoFolder.name,
    requests: echoFolder.requests.map(echoRequestToRequest),
    folders: echoFolder.folders.map(f => echoFolderToFolder(f as EchoFolder)),
    collapsed: echoFolder.collapsed,
    isDeprecated: echoFolder.isDeprecated,
  };
}

/**
 * Convert a Workspace to a WorkspaceFile
 */
export function workspaceToWorkspaceFile(workspace: Workspace): WorkspaceFile {
  return {
    id: workspace.id,
    name: workspace.name,
    description: workspace.description,
    color: workspace.color,
    createdAt: new Date(workspace.createdAt).toISOString(),
    updatedAt: new Date(workspace.updatedAt).toISOString(),
    environments: workspace.environments?.map(e => ({
      id: e.id,
      name: e.name,
      variables: e.variables,
      isActive: e.isActive,
      color: e.color,
      emoji: e.emoji,
    })),
    selectedEnvironmentId: workspace.selectedEnvironmentId,
  };
}

/**
 * Convert a WorkspaceFile to a Workspace
 */
export function workspaceFileToWorkspace(workspaceFile: WorkspaceFile): Workspace {
  if (!workspaceFile || !workspaceFile.id) {
    throw new Error(`Invalid workspace file: missing id. Got: ${JSON.stringify(workspaceFile)}`);
  }
  return {
    id: workspaceFile.id,
    name: workspaceFile.name,
    description: workspaceFile.description,
    color: workspaceFile.color,
    createdAt: new Date(workspaceFile.createdAt).getTime(),
    updatedAt: new Date(workspaceFile.updatedAt).getTime(),
    environments: (workspaceFile.environments || [])
      .filter(e => e && e.id)
      .map(e => ({
      id: e.id,
      name: e.name,
      variables: e.variables,
      isActive: e.isActive,
      color: e.color,
      emoji: e.emoji,
    })),
    selectedEnvironmentId: workspaceFile.selectedEnvironmentId,
  };
}

/**
 * Convert Environments array to GlobalEnvironmentsFile
 */
export function environmentsToGlobalFile(
  environments: Environment[],
  selectedEnvironmentId: string | null
): GlobalEnvironmentsFile {
  return {
    version: ECHO_FORMAT_VERSION,
    selectedEnvironmentId: selectedEnvironmentId || undefined,
    environments: environments.map(env => ({
      id: env.id,
      name: env.name,
      variables: env.variables,
      isActive: env.isActive,
      color: env.color,
      emoji: env.emoji,
    })),
  };
}

/**
 * Convert GlobalEnvironmentsFile to Environments array
 */
export function globalFileToEnvironments(globalFile: GlobalEnvironmentsFile): {
  environments: Environment[];
  selectedId: string | null;
} {
  return {
    environments: (globalFile.environments || [])
      .filter(env => env && typeof env.id === 'string')
      .map(env => ({
      id: env.id,
      name: env.name,
      variables: env.variables as KeyValuePair[],
      isActive: env.isActive,
      color: env.color,
      emoji: env.emoji,
    })),
    selectedId: globalFile.selectedEnvironmentId || null,
  };
}

/**
 * Safely try to parse JSON
 */
function tryParseJson(jsonString: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(jsonString);
  } catch {
    return undefined;
  }
}

/**
 * Create an empty EchoFile
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

/**
 * Validate an EchoFile structure
 */
export function validateEchoFile(data: unknown): data is EchoFile {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const echoFile = data as Record<string, unknown>;

  // Check required top-level fields
  if (typeof echoFile.version !== 'string') return false;
  if (typeof echoFile.metadata !== 'object' || echoFile.metadata === null) return false;
  if (typeof echoFile.settings !== 'object' || echoFile.settings === null) return false;
  if (!Array.isArray(echoFile.requests)) return false;
  if (!Array.isArray(echoFile.folders)) return false;

  // Check metadata
  const metadata = echoFile.metadata as Record<string, unknown>;
  if (typeof metadata.id !== 'string') return false;
  if (typeof metadata.name !== 'string') return false;
  if (typeof metadata.workspaceId !== 'string') return false;

  return true;
}

/**
 * Merge changes into an existing EchoFile
 */
export function mergeEchoFileChanges(
  original: EchoFile,
  changes: Partial<EchoFile>
): EchoFile {
  return {
    ...original,
    ...changes,
    metadata: {
      ...original.metadata,
      ...(changes.metadata || {}),
      modifiedAt: new Date().toISOString(),
    },
    settings: {
      ...original.settings,
      ...(changes.settings || {}),
    },
  };
}

// Export the converter functions
export const echoConverter = {
  collectionToEchoFile,
  echoFileToCollection,
  workspaceToWorkspaceFile,
  workspaceFileToWorkspace,
  environmentsToGlobalFile,
  globalFileToEnvironments,
  createEmptyEchoFile,
  validateEchoFile,
  mergeEchoFileChanges,
};

export default echoConverter;

