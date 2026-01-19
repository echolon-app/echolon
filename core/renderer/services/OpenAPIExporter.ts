/**
 * OpenAPI Exporter
 * 
 * Converts a Collection to OpenAPI 3.0 JSON format.
 * Used for public spec sharing to generate openapi.json from collection data.
 */

import { Collection, Request, Folder, KeyValuePair, AuthConfig, CollectionEnvironment } from '@/types';

// OpenAPI 3.0 Types
interface OpenAPIInfo {
  title: string;
  version: string;
  description?: string;
}

interface OpenAPIServer {
  url: string;
  description?: string;
}

interface OpenAPIParameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  description?: string;
  required?: boolean;
  schema: {
    type: string;
    default?: string;
  };
}

interface OpenAPIRequestBody {
  description?: string;
  required?: boolean;
  content: {
    [mediaType: string]: {
      schema?: object;
      example?: unknown;
    };
  };
}

interface OpenAPIResponse {
  description: string;
  content?: {
    [mediaType: string]: {
      schema?: object;
      example?: unknown;
    };
  };
}

interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenAPIParameter[];
  requestBody?: OpenAPIRequestBody;
  responses: {
    [statusCode: string]: OpenAPIResponse;
  };
  security?: Array<{ [scheme: string]: string[] }>;
}

interface OpenAPIPathItem {
  summary?: string;
  description?: string;
  get?: OpenAPIOperation;
  post?: OpenAPIOperation;
  put?: OpenAPIOperation;
  patch?: OpenAPIOperation;
  delete?: OpenAPIOperation;
  options?: OpenAPIOperation;
  head?: OpenAPIOperation;
  trace?: OpenAPIOperation;
}

interface OpenAPISecurityScheme {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect';
  description?: string;
  name?: string;
  in?: 'query' | 'header' | 'cookie';
  scheme?: string;
  bearerFormat?: string;
}

interface OpenAPIDocument {
  openapi: string;
  info: OpenAPIInfo;
  servers?: OpenAPIServer[];
  paths: {
    [path: string]: OpenAPIPathItem;
  };
  components?: {
    securitySchemes?: {
      [name: string]: OpenAPISecurityScheme;
    };
  };
  security?: Array<{ [scheme: string]: string[] }>;
  tags?: Array<{ name: string; description?: string }>;
}

/**
 * Export a Collection to OpenAPI 3.0 JSON
 * 
 * IMPORTANT: Always generates from the current collection structure,
 * NOT from the original rawSpec. This ensures all current requests,
 * folders, and modifications are included in the exported spec.
 */
export function collectionToOpenAPI(collection: Collection, options?: {
  version?: string;
  baseUrl?: string;
}): OpenAPIDocument {
  const version = options?.version || '1.0.0';
  
  // DEBUG: Log what we're exporting
  console.log('[OpenAPIExporter] === EXPORT START ===');
  console.log('[OpenAPIExporter] Collection:', collection.name);
  console.log('[OpenAPIExporter] Root requests:', collection.requests?.length || 0);
  collection.requests?.forEach((r, i) => {
    console.log(`[OpenAPIExporter] Request ${i}: "${r.name}" ${r.method} "${r.url}"`);
  });
  console.log('[OpenAPIExporter] Folders:', collection.folders?.length || 0);
  collection.folders?.forEach((f, i) => {
    console.log(`[OpenAPIExporter] Folder ${i}: "${f.name}" with ${f.requests?.length || 0} requests`);
    f.requests?.forEach((r, j) => {
      console.log(`[OpenAPIExporter]   Request ${j}: "${r.name}" ${r.method} "${r.url}"`);
    });
  });
  
  // Generate OpenAPI from collection structure (always use current state)
  const doc: OpenAPIDocument = {
    openapi: '3.0.3',
    info: {
      title: collection.name,
      version,
      description: collection.description,
    },
    paths: {},
    tags: [],
  };

  // Generate servers from collection environments
  const servers = generateServersFromEnvironments(collection.environments);
  
  // Extract base URL from first request or use provided (used for path processing)
  const baseUrl = options?.baseUrl || extractBaseUrl(collection);
  
  // If servers from environments, use those; otherwise use extracted base URL
  if (servers.length > 0) {
    doc.servers = servers;
  } else if (baseUrl) {
    doc.servers = [{ url: baseUrl }];
  }

  // Add security schemes based on collection auth
  if (collection.auth && collection.auth.type !== 'none') {
    doc.components = {
      securitySchemes: generateSecuritySchemes(collection.auth),
    };
    doc.security = [{ [getSecuritySchemeName(collection.auth.type)]: [] }];
  }

  // Process folders as tags
  const tagMap = new Map<string, string>();
  
  for (const folder of collection.folders) {
    const tagName = folder.name;
    tagMap.set(folder.id, tagName);
    doc.tags!.push({ name: tagName });
    
    // Process requests in folder
    processRequests(folder.requests, doc.paths, [tagName], baseUrl);
    
    // Process nested folders
    processFolders(folder.folders, doc.paths, doc.tags!, [tagName], baseUrl);
  }

  // Process root-level requests (no tag)
  processRequests(collection.requests, doc.paths, [], baseUrl);

  // Collect all unique request-level tags and add them to doc.tags
  const allRequests = getAllRequests(collection);
  const existingTagNames = new Set(doc.tags!.map(t => t.name));
  
  for (const request of allRequests) {
    if (request.tags) {
      for (const tag of request.tags) {
        if (!existingTagNames.has(tag)) {
          doc.tags!.push({ name: tag });
          existingTagNames.add(tag);
        }
      }
    }
  }

  // Clean up empty arrays
  if (doc.tags && doc.tags.length === 0) {
    delete doc.tags;
  }

  return doc;
}

/**
 * Extract base URL from collection requests
 */
function extractBaseUrl(collection: Collection): string {
  // Check collection variables for baseUrl
  const baseUrlVar = collection.variables?.find(
    v => v.key.toLowerCase() === 'baseurl' || v.key.toLowerCase() === 'base_url'
  );
  if (baseUrlVar && baseUrlVar.value) {
    return baseUrlVar.value;
  }

  // Try to extract from first request URL
  const allRequests = getAllRequests(collection);
  if (allRequests.length > 0) {
    const firstUrl = allRequests[0].url;
    // Handle variable substitution placeholder
    if (firstUrl.startsWith('{{')) {
      return '';
    }
    try {
      const url = new URL(firstUrl);
      return `${url.protocol}//${url.host}`;
    } catch {
      return '';
    }
  }

  return '';
}

/**
 * Get all requests from collection (including in folders)
 */
function getAllRequests(collection: Collection): Request[] {
  const requests: Request[] = [...collection.requests];
  
  function collectFromFolders(folders: Folder[]) {
    for (const folder of folders) {
      requests.push(...folder.requests);
      collectFromFolders(folder.folders);
    }
  }
  
  collectFromFolders(collection.folders);
  return requests;
}

/**
 * Process folders recursively
 */
function processFolders(
  folders: Folder[],
  paths: OpenAPIDocument['paths'],
  tags: Array<{ name: string; description?: string }>,
  parentTags: string[],
  baseUrl: string
) {
  for (const folder of folders) {
    const tagName = [...parentTags, folder.name].join('/');
    tags.push({ name: tagName });
    
    processRequests(folder.requests, paths, [tagName], baseUrl);
    processFolders(folder.folders, paths, tags, [tagName], baseUrl);
  }
}

/**
 * Process requests and add to paths
 */
function processRequests(
  requests: Request[],
  paths: OpenAPIDocument['paths'],
  tags: string[],
  baseUrl: string
) {
  console.log(`[OpenAPIExporter] Processing ${requests?.length || 0} requests, baseUrl="${baseUrl}"`);
  
  if (!requests || requests.length === 0) {
    console.warn('[OpenAPIExporter] No requests to process!');
    return;
  }
  
  for (const request of requests) {
    console.log(`[OpenAPIExporter] Processing: "${request.name}" ${request.method} url="${request.url}" tags=${JSON.stringify(request.tags)}`);
    const { path, operation } = requestToOperation(request, tags, baseUrl);
    console.log(`[OpenAPIExporter] -> Generated path: "${path}" operation.tags=${JSON.stringify(operation.tags)}`);
    
    if (!paths[path]) {
      paths[path] = {};
    }
    
    const method = request.method.toLowerCase() as keyof OpenAPIPathItem;
    if (['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'].includes(method)) {
      // Warn if overwriting an existing operation (duplicate path+method)
      if (paths[path][method]) {
        console.warn(`[OpenAPIExporter] Duplicate operation: ${method.toUpperCase()} ${path} - "${request.name}" will overwrite previous request. OpenAPI only allows one operation per path+method combination.`);
      }
      paths[path][method] = operation;
    }
  }
  
  console.log('[OpenAPIExporter] Final paths:', Object.keys(paths));
}

/**
 * Convert a request to an OpenAPI operation
 */
function requestToOperation(
  request: Request,
  tags: string[],
  baseUrl: string
): { path: string; operation: OpenAPIOperation } {
  // Extract path from URL
  let path = request.url;
  
  // Remove base URL if present
  if (baseUrl && path.startsWith(baseUrl)) {
    path = path.slice(baseUrl.length);
  }
  
  // Handle variable placeholders
  path = path.replace(/\{\{([^}]+)\}\}/g, (_, varName) => {
    if (varName.toLowerCase() === 'baseurl' || varName.toLowerCase() === 'base_url') {
      return '';
    }
    return `{${varName}}`;
  });
  
  // Remove query string from path
  const queryIndex = path.indexOf('?');
  if (queryIndex > -1) {
    path = path.slice(0, queryIndex);
  }
  
  // Ensure path starts with /
  if (!path.startsWith('/')) {
    path = '/' + path;
  }
  
  // Clean up double slashes
  path = path.replace(/\/+/g, '/');
  
  // If path is just /, keep it
  if (path === '') {
    path = '/';
  }

  const operation: OpenAPIOperation = {
    summary: request.name,
    description: request.description,
    responses: {
      '200': {
        description: 'Successful response',
      },
    },
  };

  // Combine folder tags with request-level tags
  const allTags = [...tags];
  if (request.tags && request.tags.length > 0) {
    for (const tag of request.tags) {
      if (!allTags.includes(tag)) {
        allTags.push(tag);
      }
    }
  }
  
  if (allTags.length > 0) {
    operation.tags = allTags;
  }

  // Add parameters
  const parameters: OpenAPIParameter[] = [];

  // Path parameters
  for (const param of request.pathParams || []) {
    if (param.enabled && param.key) {
      parameters.push({
        name: param.key,
        in: 'path',
        required: true,
        description: param.description,
        schema: {
          type: 'string',
          default: param.value,
        },
      });
    }
  }

  // Query parameters
  for (const param of request.queryParams || []) {
    if (param.enabled && param.key) {
      parameters.push({
        name: param.key,
        in: 'query',
        description: param.description,
        schema: {
          type: 'string',
          default: param.value,
        },
      });
    }
  }

  // Header parameters (exclude standard headers)
  const standardHeaders = ['content-type', 'accept', 'authorization', 'user-agent'];
  for (const header of request.headers || []) {
    if (header.enabled && header.key && !standardHeaders.includes(header.key.toLowerCase())) {
      parameters.push({
        name: header.key,
        in: 'header',
        description: header.description,
        schema: {
          type: 'string',
          default: header.value,
        },
      });
    }
  }

  if (parameters.length > 0) {
    operation.parameters = parameters;
  }

  // Request body
  if (request.body && request.body.type !== 'none') {
    operation.requestBody = generateRequestBody(request.body);
  }

  return { path, operation };
}

/**
 * Generate request body from request body config
 */
function generateRequestBody(body: Request['body']): OpenAPIRequestBody {
  const requestBody: OpenAPIRequestBody = {
    content: {},
  };

  switch (body.type) {
    case 'json':
      requestBody.content['application/json'] = {
        schema: { type: 'object' },
      };
      if (body.content) {
        try {
          requestBody.content['application/json'].example = JSON.parse(body.content);
        } catch {
          // Invalid JSON, use as-is
        }
      }
      break;

    case 'form-data':
      requestBody.content['multipart/form-data'] = {
        schema: {
          type: 'object',
          properties: body.formData?.reduce((acc, item) => {
            if (item.enabled && item.key) {
              acc[item.key] = { type: 'string' };
            }
            return acc;
          }, {} as Record<string, { type: string }>),
        },
      };
      break;

    case 'x-www-form-urlencoded':
      requestBody.content['application/x-www-form-urlencoded'] = {
        schema: {
          type: 'object',
          properties: body.formData?.reduce((acc, item) => {
            if (item.enabled && item.key) {
              acc[item.key] = { type: 'string' };
            }
            return acc;
          }, {} as Record<string, { type: string }>),
        },
      };
      break;

    case 'raw':
      requestBody.content['text/plain'] = {};
      if (body.content) {
        requestBody.content['text/plain'].example = body.content;
      }
      break;

    case 'binary':
      requestBody.content['application/octet-stream'] = {};
      break;
  }

  return requestBody;
}

/**
 * Generate servers from collection environments
 * Looks for variables like baseUrl, url, host, server, apiUrl, etc.
 */
function generateServersFromEnvironments(environments?: CollectionEnvironment[]): OpenAPIServer[] {
  if (!environments || environments.length === 0) {
    return [];
  }

  // Variable names that typically contain server URLs (case-insensitive)
  const urlVariableNames = ['baseurl', 'base_url', 'url', 'host', 'server', 'apiurl', 'api_url', 'endpoint', 'base'];
  
  const servers: OpenAPIServer[] = [];
  
  for (const env of environments) {
    // Only include active environments
    if (!env.isActive) continue;
    
    // Find a URL variable in this environment
    for (const variable of env.variables) {
      if (!variable.enabled || !variable.value) continue;
      
      const keyLower = variable.key.toLowerCase();
      if (urlVariableNames.includes(keyLower)) {
        // Validate that the value looks like a URL
        const value = variable.value.trim();
        if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/')) {
          servers.push({
            url: value,
            description: env.name,
          });
          break; // Only use the first matching URL per environment
        }
      }
    }
  }
  
  return servers;
}

/**
 * Generate security schemes from auth config
 */
function generateSecuritySchemes(auth: AuthConfig): { [name: string]: OpenAPISecurityScheme } {
  const schemes: { [name: string]: OpenAPISecurityScheme } = {};

  switch (auth.type) {
    case 'basic':
      schemes.basicAuth = {
        type: 'http',
        scheme: 'basic',
      };
      break;

    case 'bearer':
      schemes.bearerAuth = {
        type: 'http',
        scheme: 'bearer',
      };
      break;

    case 'api-key':
      schemes.apiKeyAuth = {
        type: 'apiKey',
        name: auth.apiKey?.key || 'X-API-Key',
        in: auth.apiKey?.addTo === 'query' ? 'query' : 'header',
      };
      break;

    case 'oauth2':
      schemes.oauth2Auth = {
        type: 'oauth2',
        description: 'OAuth 2.0 authentication',
      };
      break;

    case 'jwt':
      schemes.jwtAuth = {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      };
      break;
  }

  return schemes;
}

/**
 * Get security scheme name for auth type
 */
function getSecuritySchemeName(authType: string): string {
  const nameMap: Record<string, string> = {
    'basic': 'basicAuth',
    'bearer': 'bearerAuth',
    'api-key': 'apiKeyAuth',
    'oauth2': 'oauth2Auth',
    'jwt': 'jwtAuth',
  };
  return nameMap[authType] || 'auth';
}

/**
 * Export collection to OpenAPI JSON string
 */
export function exportToOpenAPIJson(collection: Collection, options?: {
  version?: string;
  baseUrl?: string;
  pretty?: boolean;
}): string {
  const doc = collectionToOpenAPI(collection, options);
  return options?.pretty !== false 
    ? JSON.stringify(doc, null, 2)
    : JSON.stringify(doc);
}

/**
 * Export collection to Echolon JSON format
 * This is the native Echolon format that preserves all features
 */
export function exportToEcholonJson(collection: Collection): string {
  // Create a clean export without internal IDs that might change
  const exportData = {
    echolon: '1.0',
    exportedAt: new Date().toISOString(),
    collection: {
      name: collection.name,
      description: collection.description,
      baseUrl: collection.baseUrl,
      variables: collection.variables,
      auth: collection.auth,
      headers: collection.headers,
      requests: collection.requests,
      folders: collection.folders,
      environments: collection.environments,
      scripts: collection.scripts,
    },
  };
  return JSON.stringify(exportData, null, 2);
}

export default {
  collectionToOpenAPI,
  exportToOpenAPIJson,
  exportToEcholonJson,
};

