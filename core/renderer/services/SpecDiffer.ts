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

    // Find appropriate folder or add to root
    const groupName = this.getGroupName(endpoint.path);
    const existingFolder = collection.folders.find(f => 
      f.name.toLowerCase() === groupName.toLowerCase()
    );

    if (existingFolder) {
      return {
        ...collection,
        folders: collection.folders.map(f =>
          f.id === existingFolder.id
            ? { ...f, requests: [...f.requests, newRequest] }
            : f
        ),
      };
    } else {
      return {
        ...collection,
        requests: [...collection.requests, newRequest],
      };
    }
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

