import { Collection, Request, Folder, SpecChange, PendingSpecChanges, SwaggerDocument, SwaggerPath } from '@/types';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Types for Diff Comparison
// ============================================================================

interface ParameterSignature {
  name: string;
  in: string;
  required?: boolean;
  type?: string;
  description?: string;
  schema?: string; // Stringified schema for comparison
}

interface EndpointSignature {
  path: string;
  method: string;
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: ParameterSignature[];
  hasRequestBody?: boolean;
  requestBodySchema?: string; // Stringified for comparison
  responseStatuses?: string[];
  responseDescriptions?: Record<string, string>; // status code -> description
  deprecated?: boolean;
}

interface DiffResult {
  added: EndpointSignature[];
  removed: EndpointSignature[];
  modified: Array<{
    path: string;
    method: string;
    changes: string[];
    old: EndpointSignature;
    new: EndpointSignature;
  }>;
}

// ============================================================================
// Spec Differ Service
// ============================================================================

export class SpecDiffer {
  private static instance: SpecDiffer;

  private constructor() {}

  static getInstance(): SpecDiffer {
    if (!SpecDiffer.instance) {
      SpecDiffer.instance = new SpecDiffer();
    }
    return SpecDiffer.instance;
  }

  /**
   * Compare two OpenAPI spec strings and return the differences
   */
  compareSpecs(oldSpec: string, newSpec: string): DiffResult {
    const oldEndpoints = this.extractEndpoints(oldSpec);
    const newEndpoints = this.extractEndpoints(newSpec);

    const oldMap = new Map(oldEndpoints.map(e => [`${e.method}:${e.path}`, e]));
    const newMap = new Map(newEndpoints.map(e => [`${e.method}:${e.path}`, e]));

    const added: EndpointSignature[] = [];
    const removed: EndpointSignature[] = [];
    const modified: DiffResult['modified'] = [];

    // Find added endpoints
    for (const [key, endpoint] of newMap) {
      if (!oldMap.has(key)) {
        added.push(endpoint);
      }
    }

    // Find removed endpoints
    for (const [key, endpoint] of oldMap) {
      if (!newMap.has(key)) {
        removed.push(endpoint);
      }
    }

    // Find modified endpoints
    for (const [key, newEndpoint] of newMap) {
      const oldEndpoint = oldMap.get(key);
      if (oldEndpoint) {
        const changes = this.detectChanges(oldEndpoint, newEndpoint);
        if (changes.length > 0) {
          modified.push({
            path: newEndpoint.path,
            method: newEndpoint.method,
            changes,
            old: oldEndpoint,
            new: newEndpoint,
          });
        }
      }
    }

    return { added, removed, modified };
  }

  /**
   * Create a PendingSpecChanges object from diff results
   */
  createPendingChanges(
    collectionId: string,
    diffResult: DiffResult,
    newRawSpec: string
  ): PendingSpecChanges {
    const changes: SpecChange[] = [];

    // Added endpoints
    for (const endpoint of diffResult.added) {
      const details: string[] = [];
      if (endpoint.description) details.push(`Description: ${endpoint.description.slice(0, 100)}${endpoint.description.length > 100 ? '...' : ''}`);
      if (endpoint.parameters && endpoint.parameters.length > 0) {
        details.push(`Parameters: ${endpoint.parameters.map(p => `${p.name} (${p.in}${p.required ? ', required' : ''})`).join(', ')}`);
      }
      if (endpoint.hasRequestBody) details.push('Has request body');
      if (endpoint.responseStatuses && endpoint.responseStatuses.length > 0) {
        details.push(`Response codes: ${endpoint.responseStatuses.join(', ')}`);
      }
      if (endpoint.tags && endpoint.tags.length > 0) {
        details.push(`Tags: ${endpoint.tags.join(', ')}`);
      }

      changes.push({
        id: uuidv4(),
        type: 'added',
        path: endpoint.path,
        method: endpoint.method.toUpperCase(),
        description: endpoint.summary || `New ${endpoint.method.toUpperCase()} ${endpoint.path}`,
        details: details.length > 0 ? details.join('\n') : undefined,
        newValue: endpoint,
        selected: true,
      });
    }

    // Removed endpoints
    for (const endpoint of diffResult.removed) {
      const details: string[] = [];
      if (endpoint.summary) details.push(`Summary: ${endpoint.summary}`);
      if (endpoint.description) details.push(`Description: ${endpoint.description.slice(0, 100)}${endpoint.description.length > 100 ? '...' : ''}`);
      if (endpoint.parameters && endpoint.parameters.length > 0) {
        details.push(`Parameters: ${endpoint.parameters.map(p => p.name).join(', ')}`);
      }
      if (endpoint.responseStatuses && endpoint.responseStatuses.length > 0) {
        details.push(`Response codes: ${endpoint.responseStatuses.join(', ')}`);
      }

      changes.push({
        id: uuidv4(),
        type: 'removed',
        path: endpoint.path,
        method: endpoint.method.toUpperCase(),
        description: `Route deleted: ${endpoint.method.toUpperCase()} ${endpoint.path}${endpoint.summary ? ` - ${endpoint.summary}` : ''}`,
        details: details.length > 0 ? details.join('\n') : undefined,
        oldValue: endpoint,
        selected: false, // Don't select removals by default
      });
    }

    // Modified endpoints
    for (const mod of diffResult.modified) {
      changes.push({
        id: uuidv4(),
        type: 'modified',
        path: mod.path,
        method: mod.method.toUpperCase(),
        description: `${mod.new.summary || mod.path}: ${mod.changes.length} change(s)`,
        details: mod.changes.join('\n'),
        oldValue: mod.old,
        newValue: mod.new,
        selected: true,
      });
    }

    return {
      collectionId,
      detectedAt: Date.now(),
      changes,
      newRawSpec,
    };
  }

  /**
   * Check if two specs are identical (no changes)
   */
  areSpecsEqual(oldSpec: string, newSpec: string): boolean {
    const diff = this.compareSpecs(oldSpec, newSpec);
    return diff.added.length === 0 && 
           diff.removed.length === 0 && 
           diff.modified.length === 0;
  }

  /**
   * Apply selected changes to a collection
   */
  applyChanges(
    collection: Collection,
    pendingChanges: PendingSpecChanges,
    selectedIds: string[]
  ): Collection {
    const selectedChanges = pendingChanges.changes.filter(c => selectedIds.includes(c.id));
    let updatedCollection = { ...collection };

    for (const change of selectedChanges) {
      switch (change.type) {
        case 'added':
          updatedCollection = this.addEndpoint(updatedCollection, change);
          break;
        case 'removed':
          updatedCollection = this.removeEndpoint(updatedCollection, change);
          break;
        case 'modified':
          updatedCollection = this.updateEndpoint(updatedCollection, change);
          break;
      }
    }

    return {
      ...updatedCollection,
      updatedAt: Date.now(),
    };
  }

  /**
   * Merge rawSpec with newSpec for only the selected changes.
   * This updates the rawSpec per-route basis so that:
   * - Applied routes: updated to match newSpec (won't show as changed next time)
   * - Non-applied routes: keep old rawSpec values (will still show as changed next time)
   */
  mergeSpecForSelectedChanges(
    oldRawSpec: string,
    newRemoteSpec: string,
    selectedChanges: SpecChange[]
  ): string {
    try {
      const oldDoc = this.parseSpec(oldRawSpec);
      const newDoc = this.parseSpec(newRemoteSpec);
      
      if (!oldDoc || !newDoc) {
        return newRemoteSpec; // Fallback to full update
      }

      // Create a merged document starting from oldDoc
      const mergedDoc = JSON.parse(JSON.stringify(oldDoc));
      
      // Ensure paths object exists
      if (!mergedDoc.paths) {
        mergedDoc.paths = {};
      }

      // For each selected change, update that specific route in the merged doc
      for (const change of selectedChanges) {
        const path = change.path;
        const method = change.method.toLowerCase();

        if (change.type === 'added') {
          // Add the new endpoint from newDoc
          if (newDoc.paths?.[path]?.[method]) {
            if (!mergedDoc.paths[path]) {
              mergedDoc.paths[path] = {};
            }
            mergedDoc.paths[path][method] = newDoc.paths[path][method];
          }
        } else if (change.type === 'removed') {
          // Remove the endpoint from mergedDoc
          if (mergedDoc.paths[path]?.[method]) {
            delete mergedDoc.paths[path][method];
            // Clean up empty path objects
            if (Object.keys(mergedDoc.paths[path]).length === 0) {
              delete mergedDoc.paths[path];
            }
          }
        } else if (change.type === 'modified') {
          // Update the endpoint to match newDoc
          if (newDoc.paths?.[path]?.[method]) {
            if (!mergedDoc.paths[path]) {
              mergedDoc.paths[path] = {};
            }
            mergedDoc.paths[path][method] = newDoc.paths[path][method];
          }
        }
      }

      return JSON.stringify(mergedDoc, null, 2);
    } catch (error) {
      console.error('Failed to merge specs:', error);
      return newRemoteSpec; // Fallback to full update
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private extractEndpoints(specContent: string): EndpointSignature[] {
    try {
      const doc = this.parseSpec(specContent);
      if (!doc || !doc.paths) return [];

      const endpoints: EndpointSignature[] = [];
      const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

      for (const [path, pathItem] of Object.entries(doc.paths)) {
        for (const method of methods) {
          const operation = (pathItem as SwaggerPath)[method];
          if (!operation) continue;

          // Extract parameters with full details
          const parameters: ParameterSignature[] = operation.parameters?.map(p => ({
            name: p.name,
            in: p.in,
            required: p.required,
            type: p.type,
            description: p.description,
            schema: p.schema ? JSON.stringify(p.schema) : undefined,
          })) || [];

          // Extract response descriptions
          const responseDescriptions: Record<string, string> = {};
          if (operation.responses) {
            for (const [code, response] of Object.entries(operation.responses)) {
              if (typeof response === 'object' && response !== null && 'description' in response) {
                responseDescriptions[code] = (response as { description: string }).description;
              }
            }
          }

          // Extract request body schema
          let requestBodySchema: string | undefined;
          if (operation.requestBody?.content) {
            const contentTypes = Object.values(operation.requestBody.content);
            if (contentTypes.length > 0 && contentTypes[0]?.schema) {
              requestBodySchema = JSON.stringify(contentTypes[0].schema);
            }
          }

          endpoints.push({
            path,
            method,
            summary: operation.summary,
            description: operation.description,
            operationId: operation.operationId,
            tags: operation.tags,
            parameters,
            hasRequestBody: !!operation.requestBody,
            requestBodySchema,
            responseStatuses: operation.responses ? Object.keys(operation.responses) : undefined,
            responseDescriptions,
            deprecated: (operation as { deprecated?: boolean }).deprecated,
          });
        }
      }

      return endpoints;
    } catch {
      return [];
    }
  }

  private parseSpec(content: string): SwaggerDocument | null {
    try {
      return JSON.parse(content);
    } catch {
      // Could add YAML parsing here if needed
      return null;
    }
  }

  private detectChanges(oldEndpoint: EndpointSignature, newEndpoint: EndpointSignature): string[] {
    const changes: string[] = [];

    // Check summary change
    if (oldEndpoint.summary !== newEndpoint.summary) {
      if (!oldEndpoint.summary && newEndpoint.summary) {
        changes.push('Summary added');
      } else if (oldEndpoint.summary && !newEndpoint.summary) {
        changes.push('Summary removed');
      } else {
        changes.push('Summary updated');
      }
    }

    // Check description change
    if (oldEndpoint.description !== newEndpoint.description) {
      if (!oldEndpoint.description && newEndpoint.description) {
        changes.push('Description added');
      } else if (oldEndpoint.description && !newEndpoint.description) {
        changes.push('Description removed');
      } else {
        changes.push('Description updated');
      }
    }

    // Check operationId change
    if (oldEndpoint.operationId !== newEndpoint.operationId) {
      changes.push('Operation ID changed');
    }

    // Check tags change
    const oldTags = (oldEndpoint.tags || []).sort().join(',');
    const newTags = (newEndpoint.tags || []).sort().join(',');
    if (oldTags !== newTags) {
      changes.push('Tags changed');
    }

    // Check deprecated status
    if (oldEndpoint.deprecated !== newEndpoint.deprecated) {
      changes.push(newEndpoint.deprecated ? 'Marked as deprecated' : 'No longer deprecated');
    }

    // Detailed parameter change detection
    const paramChanges = this.detectParameterChanges(oldEndpoint.parameters || [], newEndpoint.parameters || []);
    changes.push(...paramChanges);

    // Check request body change
    if (oldEndpoint.hasRequestBody !== newEndpoint.hasRequestBody) {
      changes.push(newEndpoint.hasRequestBody ? 'Request body added' : 'Request body removed');
    } else if (oldEndpoint.hasRequestBody && newEndpoint.hasRequestBody) {
      // Both have request body, check if schema changed
      if (oldEndpoint.requestBodySchema !== newEndpoint.requestBodySchema) {
        changes.push('Request body schema changed');
      }
    }

    // Check response statuses change
    const oldStatuses = new Set(oldEndpoint.responseStatuses || []);
    const newStatuses = new Set(newEndpoint.responseStatuses || []);
    
    const addedStatuses = [...newStatuses].filter(s => !oldStatuses.has(s));
    const removedStatuses = [...oldStatuses].filter(s => !newStatuses.has(s));
    
    if (addedStatuses.length > 0) {
      changes.push(`Response codes added: ${addedStatuses.join(', ')}`);
    }
    if (removedStatuses.length > 0) {
      changes.push(`Response codes removed: ${removedStatuses.join(', ')}`);
    }

    // Check response descriptions changed
    const oldDescriptions = oldEndpoint.responseDescriptions || {};
    const newDescriptions = newEndpoint.responseDescriptions || {};
    for (const status of Object.keys(newDescriptions)) {
      if (oldStatuses.has(status) && oldDescriptions[status] !== newDescriptions[status]) {
        changes.push(`Response ${status} description changed`);
      }
    }

    return changes;
  }

  private detectParameterChanges(oldParams: ParameterSignature[], newParams: ParameterSignature[]): string[] {
    const changes: string[] = [];
    
    const oldParamMap = new Map(oldParams.map(p => [`${p.in}:${p.name}`, p]));
    const newParamMap = new Map(newParams.map(p => [`${p.in}:${p.name}`, p]));
    
    // Find added parameters
    const addedParams: string[] = [];
    for (const [key, param] of newParamMap) {
      if (!oldParamMap.has(key)) {
        addedParams.push(`${param.name} (${param.in})`);
      }
    }
    if (addedParams.length > 0) {
      changes.push(`Parameters added: ${addedParams.join(', ')}`);
    }

    // Find removed parameters
    const removedParams: string[] = [];
    for (const [key, param] of oldParamMap) {
      if (!newParamMap.has(key)) {
        removedParams.push(`${param.name} (${param.in})`);
      }
    }
    if (removedParams.length > 0) {
      changes.push(`Parameters removed: ${removedParams.join(', ')}`);
    }

    // Find modified parameters
    const modifiedParams: string[] = [];
    for (const [key, newParam] of newParamMap) {
      const oldParam = oldParamMap.get(key);
      if (oldParam) {
        const paramChanges: string[] = [];
        
        if (oldParam.required !== newParam.required) {
          paramChanges.push(newParam.required ? 'now required' : 'now optional');
        }
        if (oldParam.type !== newParam.type) {
          paramChanges.push('type changed');
        }
        if (oldParam.schema !== newParam.schema) {
          paramChanges.push('schema changed');
        }
        if (oldParam.description !== newParam.description) {
          paramChanges.push('description changed');
        }
        
        if (paramChanges.length > 0) {
          modifiedParams.push(`${newParam.name}: ${paramChanges.join(', ')}`);
        }
      }
    }
    if (modifiedParams.length > 0) {
      changes.push(`Parameters modified: ${modifiedParams.join('; ')}`);
    }

    return changes;
  }

  private addEndpoint(collection: Collection, change: SpecChange): Collection {
    const endpoint = change.newValue as EndpointSignature;
    
    // First check if a request with the same path and method already exists
    const existingRequest = this.findRequestByPathAndMethod(collection, change.path, change.method);
    if (existingRequest) {
      // Request already exists - update it instead of adding a duplicate
      return this.updateEndpoint(collection, change);
    }
    
    // Create a new request
    const newRequest: Request = {
      id: uuidv4(),
      name: endpoint.summary || `${endpoint.method.toUpperCase()} ${endpoint.path}`,
      method: endpoint.method.toUpperCase(),
      url: endpoint.path, // Will need base URL from collection
      headers: [],
      queryParams: endpoint.parameters
        ?.filter(p => p.in === 'query')
        .map(p => ({
          id: uuidv4(),
          key: p.name,
          value: '',
          enabled: p.required || false,
        })) || [],
      body: { type: 'none', content: '' },
      auth: { type: 'none' },
      scripts: { pre: '', post: '' },
    };

    // Get group name from tags (like the importer does) or fallback to path
    const groupName = this.getGroupNameFromTags(endpoint.path, endpoint.tags);
    
    // Try to find the folder - check both exact match and nested path
    let targetFolder = this.findFolderByName(collection.folders, groupName);

    if (targetFolder) {
      // Add request to existing folder
      return {
        ...collection,
        folders: this.addRequestToFolder(collection.folders, targetFolder.id, newRequest),
      };
    } else {
      // Create the folder structure if it doesn't exist
      // Tags like "Features/Screens/Teams/Base" should create nested folders
      const updatedCollection = this.ensureFolderPath(collection, groupName);
      targetFolder = this.findFolderByName(updatedCollection.folders, groupName);
      
      if (targetFolder) {
        return {
          ...updatedCollection,
          folders: this.addRequestToFolder(updatedCollection.folders, targetFolder.id, newRequest),
        };
      } else {
        // Fallback: add to root if folder creation failed
        return {
          ...updatedCollection,
          requests: [...updatedCollection.requests, newRequest],
        };
      }
    }
  }

  private getGroupNameFromTags(path: string, tags?: string[]): string {
    // Prefer tags like the importer does
    if (tags && tags.length > 0) {
      // Capitalize first letter of tag
      return tags[0].charAt(0).toUpperCase() + tags[0].slice(1);
    }
    
    // Fallback to first path segment
    return this.getGroupName(path);
  }

  private findFolderByName(folders: Folder[], name: string): Folder | null {
    // Check if the name contains "/" for nested folder path
    if (name.includes('/')) {
      const parts = name.split('/');
      let currentFolders = folders;
      let currentFolder: Folder | null = null;
      
      for (const part of parts) {
        currentFolder = currentFolders.find(f => 
          f.name.toLowerCase() === part.toLowerCase()
        ) || null;
        
        if (!currentFolder) {
          // Try to find the full path name as a single folder (legacy format)
          return folders.find(f => f.name.toLowerCase() === name.toLowerCase()) || null;
        }
        
        currentFolders = currentFolder.folders;
      }
      
      return currentFolder;
    }
    
    // Simple folder name - search recursively
    for (const folder of folders) {
      if (folder.name.toLowerCase() === name.toLowerCase()) {
        return folder;
      }
      const found = this.findFolderByName(folder.folders, name);
      if (found) return found;
    }
    return null;
  }

  private addRequestToFolder(folders: Folder[], folderId: string, request: Request): Folder[] {
    return folders.map(f => {
      if (f.id === folderId) {
        return { ...f, requests: [...f.requests, request] };
      }
      return {
        ...f,
        folders: this.addRequestToFolder(f.folders, folderId, request),
      };
    });
  }

  private ensureFolderPath(collection: Collection, folderPath: string): Collection {
    // Handle nested folder paths like "Features/Screens/Teams/Base"
    if (folderPath.includes('/')) {
      const parts = folderPath.split('/');
      let updatedCollection = { ...collection };
      let currentFolders = updatedCollection.folders;
      let parentPath: string[] = [];
      
      for (const part of parts) {
        const existingFolder = currentFolders.find(f => 
          f.name.toLowerCase() === part.toLowerCase()
        );
        
        if (!existingFolder) {
          // Create this folder level
          const newFolder: Folder = {
            id: uuidv4(),
            name: part,
            requests: [],
            folders: [],
            collapsed: true,
          };
          
          if (parentPath.length === 0) {
            // Add to root
            updatedCollection = {
              ...updatedCollection,
              folders: [...updatedCollection.folders, newFolder],
            };
            currentFolders = updatedCollection.folders;
          } else {
            // Add to parent folder
            updatedCollection = {
              ...updatedCollection,
              folders: this.addFolderToPath(updatedCollection.folders, parentPath, newFolder),
            };
            // Update currentFolders reference
            currentFolders = this.getFoldersAtPath(updatedCollection.folders, parentPath);
          }
        }
        
        parentPath.push(part);
        const folder = currentFolders.find(f => f.name.toLowerCase() === part.toLowerCase());
        currentFolders = folder?.folders || [];
      }
      
      return updatedCollection;
    }
    
    // Simple folder name - check if it exists, create if not
    const existingFolder = collection.folders.find(f => 
      f.name.toLowerCase() === folderPath.toLowerCase()
    );
    
    if (existingFolder) {
      return collection;
    }
    
    // Create new folder at root level
    const newFolder: Folder = {
      id: uuidv4(),
      name: folderPath,
      requests: [],
      folders: [],
      collapsed: true,
    };
    
    return {
      ...collection,
      folders: [...collection.folders, newFolder],
    };
  }

  private addFolderToPath(folders: Folder[], path: string[], newFolder: Folder): Folder[] {
    if (path.length === 0) {
      return [...folders, newFolder];
    }
    
    const [current, ...rest] = path;
    return folders.map(f => {
      if (f.name.toLowerCase() === current.toLowerCase()) {
        if (rest.length === 0) {
          return { ...f, folders: [...f.folders, newFolder] };
        }
        return { ...f, folders: this.addFolderToPath(f.folders, rest, newFolder) };
      }
      return f;
    });
  }

  private getFoldersAtPath(folders: Folder[], path: string[]): Folder[] {
    if (path.length === 0) {
      return folders;
    }
    
    const [current, ...rest] = path;
    const folder = folders.find(f => f.name.toLowerCase() === current.toLowerCase());
    
    if (!folder) {
      return [];
    }
    
    if (rest.length === 0) {
      return folder.folders;
    }
    
    return this.getFoldersAtPath(folder.folders, rest);
  }

  private removeEndpoint(collection: Collection, change: SpecChange): Collection {
    const findAndRemove = (requests: Request[]): Request[] =>
      requests.filter(r => 
        !(r.url.endsWith(change.path) && r.method.toUpperCase() === change.method)
      );

    const updateFolders = (folders: Folder[]): Folder[] =>
      folders.map(f => ({
        ...f,
        requests: findAndRemove(f.requests),
        folders: updateFolders(f.folders),
      }));

    return {
      ...collection,
      requests: findAndRemove(collection.requests),
      folders: updateFolders(collection.folders),
    };
  }

  private updateEndpoint(collection: Collection, change: SpecChange): Collection {
    const endpoint = change.newValue as EndpointSignature;

    const updateRequest = (request: Request): Request => {
      if (request.url.endsWith(change.path) && request.method.toUpperCase() === change.method) {
        return {
          ...request,
          name: endpoint.summary || request.name,
          queryParams: endpoint.parameters
            ?.filter(p => p.in === 'query')
            .map(p => {
              // Preserve existing values if param exists
              const existing = request.queryParams.find(q => q.key === p.name);
              return {
                id: existing?.id || uuidv4(),
                key: p.name,
                value: existing?.value || '',
                enabled: existing?.enabled ?? (p.required || false),
              };
            }) || request.queryParams,
        };
      }
      return request;
    };

    const updateFolders = (folders: Folder[]): Folder[] =>
      folders.map(f => ({
        ...f,
        requests: f.requests.map(updateRequest),
        folders: updateFolders(f.folders),
      }));

    return {
      ...collection,
      requests: collection.requests.map(updateRequest),
      folders: updateFolders(collection.folders),
    };
  }

  private findRequestByPathAndMethod(collection: Collection, path: string, method: string): Request | null {
    // Check root-level requests
    const rootMatch = collection.requests.find(r => 
      r.url.endsWith(path) && r.method.toUpperCase() === method.toUpperCase()
    );
    if (rootMatch) return rootMatch;
    
    // Check requests in folders recursively
    const findInFolders = (folders: Folder[]): Request | null => {
      for (const folder of folders) {
        const match = folder.requests.find(r => 
          r.url.endsWith(path) && r.method.toUpperCase() === method.toUpperCase()
        );
        if (match) return match;
        
        const nestedMatch = findInFolders(folder.folders);
        if (nestedMatch) return nestedMatch;
      }
      return null;
    };
    
    return findInFolders(collection.folders);
  }

  private getGroupName(path: string): string {
    const segments = path.split('/').filter(Boolean);
    if (segments.length > 0) {
      return segments[0].charAt(0).toUpperCase() + segments[0].slice(1);
    }
    return 'Requests';
  }
}

// Export singleton instance
export const specDiffer = SpecDiffer.getInstance();
export default specDiffer;

