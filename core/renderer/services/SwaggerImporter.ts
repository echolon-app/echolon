import { Collection, Request, Folder, KeyValuePair, HttpMethod } from '@/types';
import { SwaggerDocument, SwaggerPath } from '@/types';
import { v4 as uuidv4 } from 'uuid';

export class SwaggerImporter {
  private static instance: SwaggerImporter;

  private constructor() {}

  static getInstance(): SwaggerImporter {
    if (!SwaggerImporter.instance) {
      SwaggerImporter.instance = new SwaggerImporter();
    }
    return SwaggerImporter.instance;
  }

  // Parse JSON or YAML file content
  async parseFile(file: File): Promise<SwaggerDocument> {
    const content = await file.text();
    return this.parseContent(content);
  }

  // Parse content string
  parseContent(content: string): SwaggerDocument {
    // Try JSON first
    try {
      return JSON.parse(content);
    } catch {
      // Try YAML (basic YAML parsing for common cases)
      return this.parseBasicYaml(content);
    }
  }

  // Basic YAML parsing (handles simple cases)
  private parseBasicYaml(content: string): SwaggerDocument {
    // This is a simplified YAML parser for common OpenAPI structures
    // For full YAML support, consider using a library like js-yaml
    const lines = content.split('\n');
    const result: Record<string, unknown> = {};
    const stack: { indent: number; obj: Record<string, unknown>; key?: string }[] = [
      { indent: -1, obj: result },
    ];

    for (const line of lines) {
      if (line.trim() === '' || line.trim().startsWith('#')) continue;

      const indent = line.search(/\S/);
      const trimmedLine = line.trim();

      // Handle key-value pairs
      const colonIndex = trimmedLine.indexOf(':');
      if (colonIndex > 0) {
        const key = trimmedLine.substring(0, colonIndex).trim();
        let value: unknown = trimmedLine.substring(colonIndex + 1).trim();

        // Remove quotes
        if ((value as string).startsWith('"') && (value as string).endsWith('"')) {
          value = (value as string).slice(1, -1);
        }
        if ((value as string).startsWith("'") && (value as string).endsWith("'")) {
          value = (value as string).slice(1, -1);
        }

        // Pop stack to find parent
        while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
          stack.pop();
        }

        const parent = stack[stack.length - 1].obj;

        if (value === '' || value === null) {
          // This is an object key
          const newObj: Record<string, unknown> = {};
          parent[key] = newObj;
          stack.push({ indent, obj: newObj, key });
        } else {
          // This is a simple value
          parent[key] = value;
        }
      }
    }

    return result as unknown as SwaggerDocument;
  }

  // Convert Swagger/OpenAPI document to Collection
  import(doc: SwaggerDocument): Collection {
    const collection: Collection = {
      id: uuidv4(),
      name: doc.info?.title || 'Imported API',
      description: doc.info?.description,
      requests: [],
      folders: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Get base URL
    let baseUrl = '';
    if (doc.servers && doc.servers.length > 0) {
      baseUrl = doc.servers[0].url;
    } else if (doc.host) {
      const scheme = doc.schemes?.[0] || 'https';
      baseUrl = `${scheme}://${doc.host}${doc.basePath || ''}`;
    }

    // Group paths by tags or first path segment
    const groups: Map<string, Request[]> = new Map();

    for (const [path, pathItem] of Object.entries(doc.paths || {})) {
      const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

      for (const method of methods) {
        const operation = (pathItem as SwaggerPath)[method];
        if (!operation) continue;

        const request = this.createRequest(path, method, operation, baseUrl);

        // Group by tag or path segment
        const groupName = this.getGroupName(path);
        
        if (!groups.has(groupName)) {
          groups.set(groupName, []);
        }
        groups.get(groupName)!.push(request);
      }
    }

    // Create folders for groups
    for (const [groupName, requests] of groups) {
      if (groups.size === 1) {
        // If only one group, add requests directly to collection
        collection.requests = requests;
      } else {
        const folder: Folder = {
          id: uuidv4(),
          name: groupName,
          requests,
          folders: [],
        };
        collection.folders.push(folder);
      }
    }

    return collection;
  }

  private getGroupName(path: string): string {
    const segments = path.split('/').filter(Boolean);
    if (segments.length > 0) {
      return segments[0].charAt(0).toUpperCase() + segments[0].slice(1);
    }
    return 'Requests';
  }

  private createRequest(
    path: string,
    method: string,
    operation: SwaggerPath[string],
    baseUrl: string
  ): Request {
    const headers: KeyValuePair[] = [];
    const queryParams: KeyValuePair[] = [];

    // Process parameters
    if (operation.parameters) {
      for (const param of operation.parameters) {
        const kvp: KeyValuePair = {
          id: uuidv4(),
          key: param.name,
          value: '',
          description: param.in === 'query' ? `Query parameter` : undefined,
          enabled: param.required || false,
        };

        if (param.in === 'query') {
          queryParams.push(kvp);
        } else if (param.in === 'header') {
          headers.push(kvp);
        }
      }
    }

    // Handle request body (OpenAPI 3.0)
    let bodyContent = '';
    let bodyType: 'none' | 'json' | 'form-data' | 'x-www-form-urlencoded' | 'raw' = 'none';

    if (operation.requestBody?.content) {
      const contentTypes = Object.keys(operation.requestBody.content);
      if (contentTypes.includes('application/json')) {
        bodyType = 'json';
        headers.push({
          id: uuidv4(),
          key: 'Content-Type',
          value: 'application/json',
          enabled: true,
        });
      } else if (contentTypes.includes('application/x-www-form-urlencoded')) {
        bodyType = 'x-www-form-urlencoded';
      } else if (contentTypes.includes('multipart/form-data')) {
        bodyType = 'form-data';
      }
    }

    return {
      id: uuidv4(),
      name: operation.summary || `${method.toUpperCase()} ${path}`,
      method: method.toUpperCase() as HttpMethod,
      url: `${baseUrl}${path}`,
      headers,
      queryParams,
      body: {
        type: bodyType,
        content: bodyContent,
      },
      auth: { type: 'none' },
      scripts: { pre: '', post: '' },
    };
  }

  // Validate if content is valid Swagger/OpenAPI
  isValidSwagger(content: string): boolean {
    try {
      const doc = this.parseContent(content);
      return !!(doc.openapi || doc.swagger) && !!doc.info && !!doc.paths;
    } catch {
      return false;
    }
  }
}

export const swaggerImporter = SwaggerImporter.getInstance();
export default swaggerImporter;

