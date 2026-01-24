import { Collection, Request, Folder, KeyValuePair, HttpMethod, SpecFormat, SpecSource, Environment, CollectionEnvironment, AuthConfig } from '@/types';
import { SwaggerDocument, SwaggerPath, SwaggerSecurityScheme } from '@/types';

// Map of security scheme names to their definitions
type SecuritySchemeMap = { [name: string]: SwaggerSecurityScheme };
import { EchoFile } from '../../shared/echoFormat';
import { echoFileToCollection } from './EchoFileConverter';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Server info from OpenAPI spec
// ============================================================================

export interface ServerInfo {
  url: string;
  description?: string;
}

// ============================================================================
// Generic Spec Importer Adapter Interface
// ============================================================================

export interface SpecImportResult {
  collection: Collection;
  rawSpec: string;
  format: SpecFormat;
  // Note: Environments from servers are now embedded in collection.environments (as CollectionEnvironment[])
}

export interface SpecImportOptions {
  baseUrlVariableName?: string; // e.g., "baseUrl" -> {{baseUrl}}
  baseUrlValue?: string; // Actual base URL value to store as collection variable
  createEnvironments?: boolean; // Whether to create environments from servers (default: true)
}

export interface SpecInfo {
  name: string;
  version?: string;
  description?: string;
  baseUrl?: string;
  servers?: ServerInfo[];
}

export interface SpecImporterAdapter {
  format: SpecFormat;
  
  // Check if this adapter can handle the given content
  canParse(content: string): boolean;
  
  // Parse and convert content to a Collection (and optionally environments)
  parse(content: string, options?: SpecImportOptions): { collection: Collection; environments?: Environment[] };
  
  // Get info about the spec without full parsing (including base URL and servers)
  getInfo(content: string): SpecInfo | null;
}

// ============================================================================
// OpenAPI / Swagger Adapter
// ============================================================================

export class OpenAPIAdapter implements SpecImporterAdapter {
  format: SpecFormat = 'openapi';

  canParse(content: string): boolean {
    try {
      const doc = this.parseContent(content);
      return !!(doc.openapi || doc.swagger) && !!doc.info && !!doc.paths;
    } catch {
      return false;
    }
  }

  getInfo(content: string): SpecInfo | null {
    try {
      const doc = this.parseContent(content);
      if (!doc.info) return null;
      
      // Extract servers array
      const servers: ServerInfo[] = [];
      if (doc.servers && doc.servers.length > 0) {
        for (const server of doc.servers) {
          servers.push({
            url: server.url,
            description: server.description,
          });
        }
      }
      
      return {
        name: doc.info.title,
        version: doc.info.version,
        description: doc.info.description,
        baseUrl: this.extractBaseUrl(doc),
        servers,
      };
    } catch {
      return null;
    }
  }

  parse(content: string, options?: SpecImportOptions): { collection: Collection; environments?: Environment[] } {
    const doc = this.parseContent(content);
    const collection = this.convertToCollection(doc, options);
    
    // Generate collection environments from servers array (if enabled)
    const createEnvironments = options?.createEnvironments !== false;
    const baseUrlVarName = options?.baseUrlVariableName || 'baseUrl';
    
    if (createEnvironments && doc.servers && doc.servers.length > 0) {
      const collectionEnvironments: CollectionEnvironment[] = [];
      
      for (let i = 0; i < doc.servers.length; i++) {
        const server = doc.servers[i];
        // Use description as environment name, fallback to URL-based name
        const envName = server.description || this.generateEnvNameFromUrl(server.url);
        
        collectionEnvironments.push({
          id: uuidv4(),
          name: envName,
          variables: [
            {
              id: uuidv4(),
              key: baseUrlVarName,
              value: server.url,
              description: `Server URL for ${envName}`,
              enabled: true,
            },
          ],
          isActive: i === 0, // First environment is active by default
        });
      }
      
      // Attach environments to the collection
      collection.environments = collectionEnvironments;
      
      // Set the first environment as the default (selected) environment
      if (collectionEnvironments.length > 0) {
        collection.defaultEnvironmentId = collectionEnvironments[0].id;
      }
    } else if (createEnvironments && options?.baseUrlValue) {
      // No servers in spec, but user explicitly provided a baseUrl value - create a "Default" environment
      const defaultEnvId = uuidv4();
      collection.environments = [{
        id: defaultEnvId,
        name: 'Default',
        variables: [
          {
            id: uuidv4(),
            key: baseUrlVarName,
            value: options.baseUrlValue,
            description: 'Base URL for API requests',
            enabled: true,
          },
        ],
        isActive: true,
      }];
      collection.defaultEnvironmentId = defaultEnvId;
    }
    
    return { collection };
  }
  
  // Generate a readable environment name from URL
  private generateEnvNameFromUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname;
      
      // Try to detect environment from hostname
      if (hostname.includes('localhost') || hostname === '127.0.0.1') {
        return 'Local Development';
      }
      if (hostname.includes('dev') || hostname.includes('development')) {
        return 'Development';
      }
      if (hostname.includes('staging') || hostname.includes('stage')) {
        return 'Staging';
      }
      if (hostname.includes('prod') || hostname.includes('production')) {
        return 'Production';
      }
      if (hostname.includes('test')) {
        return 'Testing';
      }
      
      // Fallback to hostname
      return hostname;
    } catch {
      return 'Server';
    }
  }
  
  // Extract base URL from OpenAPI spec
  private extractBaseUrl(doc: SwaggerDocument): string {
    if (doc.servers && doc.servers.length > 0) {
      return doc.servers[0].url;
    } else if (doc.host) {
      const scheme = doc.schemes?.[0] || 'https';
      return `${scheme}://${doc.host}${doc.basePath || ''}`;
    }
    return '';
  }

  // Parse JSON or YAML content string
  private parseContent(content: string): SwaggerDocument {
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
    const lines = content.split('\n');
    const result: Record<string, unknown> = {};
    const stack: { indent: number; obj: Record<string, unknown>; key?: string }[] = [
      { indent: -1, obj: result },
    ];

    for (const line of lines) {
      if (line.trim() === '' || line.trim().startsWith('#')) continue;

      const indent = line.search(/\S/);
      const trimmedLine = line.trim();

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
          const newObj: Record<string, unknown> = {};
          parent[key] = newObj;
          stack.push({ indent, obj: newObj, key });
        } else {
          parent[key] = value;
        }
      }
    }

    return result as unknown as SwaggerDocument;
  }

  // Convert Swagger/OpenAPI document to Collection
  private convertToCollection(doc: SwaggerDocument, options?: SpecImportOptions): Collection {
    const baseUrl = this.extractBaseUrl(doc);
    const baseUrlVarName = options?.baseUrlVariableName || 'baseUrl';

    const collection: Collection = {
      id: uuidv4(),
      name: doc.info?.title || 'Imported API',
      description: doc.info?.description,
      requests: [],
      folders: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // URL prefix: use variable if provided, otherwise use actual base URL
    const urlPrefix = baseUrlVarName ? `{{${baseUrlVarName}}}` : baseUrl;

    // Get security schemes (OpenAPI 3.0 or Swagger 2.0)
    const securitySchemes: SecuritySchemeMap = 
      doc.components?.securitySchemes || 
      doc.securityDefinitions || 
      {};

    // Get global security requirements
    const globalSecurity = doc.security || [];

    // Group paths by tags (like Postman does) or fallback to first path segment
    const groups: Map<string, Request[]> = new Map();
    // Track used tags for better folder naming
    const tagDescriptions: Map<string, string> = new Map();
    // Track tag order from the spec's tags array
    const tagOrder: string[] = [];
    
    // Extract tag descriptions and order from spec if available
    if (doc.tags) {
      for (const tag of doc.tags as Array<{name: string; description?: string}>) {
        tagDescriptions.set(tag.name, tag.description || '');
        // Store the tag name with first letter capitalized (matching getGroupName behavior)
        tagOrder.push(tag.name.charAt(0).toUpperCase() + tag.name.slice(1));
      }
    }

    for (const [path, pathItem] of Object.entries(doc.paths || {})) {
      const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

      for (const method of methods) {
        const operation = (pathItem as SwaggerPath)[method];
        if (!operation) continue;

        // Use operation-level security if defined, otherwise fall back to global
        const operationSecurity = operation.security ?? globalSecurity;

        const request = this.createRequest(path, method, operation, urlPrefix, doc, securitySchemes, operationSecurity);
        
        // Get group name from tags (Postman behavior) or fallback to path segment
        const groupName = this.getGroupName(path, operation.tags);
        
        if (!groups.has(groupName)) {
          groups.set(groupName, []);
        }
        groups.get(groupName)!.push(request);
      }
    }

    // Create folders for each group (always create folders like Postman)
    for (const [groupName, requests] of groups) {
      const folder: Folder = {
        id: uuidv4(),
        name: groupName,
        requests,
        folders: [],
        collapsed: true, // Collapsed by default on import
      };
      collection.folders.push(folder);
    }

    // Sort folders based on tags array order from the spec, then alphabetically for any remaining
    collection.folders.sort((a, b) => {
      const aIndex = tagOrder.indexOf(a.name);
      const bIndex = tagOrder.indexOf(b.name);
      
      // If both are in tag order, use that order
      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      }
      // If only a is in tag order, it comes first
      if (aIndex !== -1) return -1;
      // If only b is in tag order, it comes first
      if (bIndex !== -1) return 1;
      // Neither is in tag order, sort alphabetically
      return a.name.localeCompare(b.name);
    });

    return collection;
  }

  // Get group name from tags (like Postman) or first path segment
  private getGroupName(path: string, tags?: string[]): string {
    // Prefer tags like Postman does
    if (tags && tags.length > 0) {
      // Capitalize first letter of tag
      return tags[0].charAt(0).toUpperCase() + tags[0].slice(1);
    }
    
    // Fallback to first path segment
    const segments = path.split('/').filter(Boolean);
    if (segments.length > 0) {
      // Handle path params like {version} or :version
      const segment = segments[0].replace(/[{}:]/g, '');
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    }
    return 'Requests';
  }

  private createRequest(
    path: string,
    method: string,
    operation: SwaggerPath[string],
    urlPrefix: string,
    doc: SwaggerDocument,
    securitySchemes: SecuritySchemeMap,
    operationSecurity: Array<{ [schemeName: string]: string[] }>
  ): Request {
    const headers: KeyValuePair[] = [];
    const queryParams: KeyValuePair[] = [];
    const pathParams: KeyValuePair[] = [];

    // Process parameters
    if (operation.parameters) {
      for (const param of operation.parameters) {
        if (param.in === 'query') {
          queryParams.push({
            id: uuidv4(),
            key: param.name,
            value: this.getSampleValueForParam(param),
            description: param.description || this.getParamTypeDescription(param),
            enabled: param.required || false,
          });
        } else if (param.in === 'header') {
          headers.push({
            id: uuidv4(),
            key: param.name,
            value: this.getSampleValueForParam(param),
            description: param.description || undefined,
            enabled: param.required || false,
          });
        } else if (param.in === 'path') {
          pathParams.push({
            id: uuidv4(),
            key: param.name,
            value: this.getSampleValueForParam(param),
            description: param.description || this.getParamTypeDescription(param),
            enabled: true,
          });
        }
      }
    }

    // Handle request body (OpenAPI 3.0)
    let bodyContent = '';
    let bodyType: 'none' | 'json' | 'form-data' | 'x-www-form-urlencoded' | 'raw' = 'none';
    let formData: KeyValuePair[] = [];

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
        // Generate sample JSON body from schema
        const jsonContent = operation.requestBody.content['application/json'];
        if (jsonContent?.schema) {
          bodyContent = this.generateSampleJson(jsonContent.schema, doc);
        }
      } else if (contentTypes.includes('application/x-www-form-urlencoded')) {
        bodyType = 'x-www-form-urlencoded';
        // Parse schema properties to create form data entries
        const formContent = operation.requestBody.content['application/x-www-form-urlencoded'];
        if (formContent?.schema) {
          formData = this.parseSchemaToFormData(formContent.schema, doc);
        }
      } else if (contentTypes.includes('multipart/form-data')) {
        bodyType = 'form-data';
        // Parse schema properties to create form data entries
        const formContent = operation.requestBody.content['multipart/form-data'];
        if (formContent?.schema) {
          formData = this.parseSchemaToFormData(formContent.schema, doc);
        }
      }
    }

    // Convert security requirements to auth config
    const auth = this.convertSecurityToAuth(operationSecurity, securitySchemes);

    return {
      id: uuidv4(),
      name: operation.summary || `${method.toUpperCase()} ${path}`,
      description: operation.description || undefined,
      method: method.toUpperCase() as HttpMethod,
      url: `${urlPrefix}${path}`,
      headers,
      queryParams,
      pathParams,
      body: {
        type: bodyType,
        content: bodyContent,
        formData: formData.length > 0 ? formData : undefined,
      },
      auth,
      scripts: { pre: '', post: '' },
    };
  }

  /**
   * Convert OpenAPI security requirements to Echolon AuthConfig
   */
  private convertSecurityToAuth(
    security: Array<{ [schemeName: string]: string[] }>,
    securitySchemes: SecuritySchemeMap
  ): AuthConfig {
    // If no security requirements, return 'none'
    if (!security || security.length === 0) {
      return { type: 'none' };
    }

    // Get the first security requirement (we only support one at a time)
    const firstRequirement = security[0];
    const schemeName = Object.keys(firstRequirement)[0];
    
    if (!schemeName) {
      return { type: 'none' };
    }

    const scheme = securitySchemes[schemeName];
    if (!scheme) {
      return { type: 'none' };
    }

    // Map OpenAPI security scheme to Echolon auth type
    switch (scheme.type) {
      case 'http':
        if (scheme.scheme === 'basic') {
          return {
            type: 'basic',
            basic: { username: '', password: '' },
          };
        }
        if (scheme.scheme === 'bearer') {
          if (scheme.bearerFormat === 'JWT') {
            return {
              type: 'jwt',
              jwt: { token: '', prefix: 'Bearer' },
            };
          }
          return {
            type: 'bearer',
            bearer: { token: '' },
          };
        }
        if (scheme.scheme === 'digest') {
          return {
            type: 'digest',
            digest: { username: '', password: '' },
          };
        }
        break;

      case 'apiKey':
        // Check for AWS Signature v4 extension
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((scheme as any)['x-amazon-apigateway-authtype'] === 'awsSigv4') {
          return {
            type: 'aws-signature',
            awsSignature: {
              accessKeyId: '',
              secretAccessKey: '',
              region: 'us-east-1',
              service: 'execute-api',
            },
          };
        }
        return {
          type: 'api-key',
          apiKey: {
            key: scheme.name || 'X-API-Key',
            value: '',
            addTo: scheme.in === 'query' ? 'query' : 'header',
          },
        };

      case 'oauth2':
        // Determine grant type from available flows
        let grantType: 'authorization_code' | 'client_credentials' | 'password' | 'implicit' = 'authorization_code';
        let authorizationUrl = '';
        let tokenUrl = '';
        
        if (scheme.flows?.authorizationCode) {
          grantType = 'authorization_code';
          authorizationUrl = scheme.flows.authorizationCode.authorizationUrl;
          tokenUrl = scheme.flows.authorizationCode.tokenUrl;
        } else if (scheme.flows?.clientCredentials) {
          grantType = 'client_credentials';
          tokenUrl = scheme.flows.clientCredentials.tokenUrl;
        } else if (scheme.flows?.password) {
          grantType = 'password';
          tokenUrl = scheme.flows.password.tokenUrl;
        } else if (scheme.flows?.implicit) {
          grantType = 'implicit';
          authorizationUrl = scheme.flows.implicit.authorizationUrl;
        }

        return {
          type: 'oauth2',
          oauth2: {
            grantType,
            accessToken: '',
            tokenType: 'Bearer',
            clientId: '',
            authorizationUrl,
            tokenUrl,
          },
        };

      case 'openIdConnect':
        // Map to OAuth2 with authorization_code flow
        return {
          type: 'oauth2',
          oauth2: {
            grantType: 'authorization_code',
            accessToken: '',
            tokenType: 'Bearer',
            clientId: '',
          },
        };
    }

    return { type: 'none' };
  }

  // Get sample value based on parameter type
  private getSampleValueForParam(param: {
    name: string;
    type?: string;
    schema?: { type?: string; format?: string; enum?: unknown[]; default?: unknown; example?: unknown };
    format?: string;
    enum?: unknown[];
    default?: unknown;
    example?: unknown;
  }): string {
    // Check for example first
    if (param.example !== undefined) {
      return String(param.example);
    }
    
    // Check schema for OpenAPI 3.0
    if (param.schema) {
      if (param.schema.example !== undefined) {
        return String(param.schema.example);
      }
      if (param.schema.default !== undefined) {
        return String(param.schema.default);
      }
      if (param.schema.enum && param.schema.enum.length > 0) {
        return String(param.schema.enum[0]);
      }
      return this.getSampleValueByType(param.schema.type, param.schema.format);
    }
    
    // Swagger 2.0 style
    if (param.default !== undefined) {
      return String(param.default);
    }
    if (param.enum && param.enum.length > 0) {
      return String(param.enum[0]);
    }
    
    return this.getSampleValueByType(param.type, param.format);
  }

  // Get sample value based on type and format
  private getSampleValueByType(type?: string, format?: string): string {
    switch (type) {
      case 'integer':
        if (format === 'int64') return '0';
        return '0';
      case 'number':
        if (format === 'float' || format === 'double') return '0.0';
        return '0';
      case 'boolean':
        return 'true';
      case 'string':
        switch (format) {
          case 'date':
            return new Date().toISOString().split('T')[0];
          case 'date-time':
            return new Date().toISOString();
          case 'email':
            return 'user@example.com';
          case 'uri':
          case 'url':
            return 'https://example.com';
          case 'uuid':
            return '00000000-0000-0000-0000-000000000000';
          default:
            return '';
        }
      case 'array':
        return '';
      default:
        return '';
    }
  }

  // Parse OpenAPI schema to form data entries
  private parseSchemaToFormData(
    schema: { 
      type?: string;
      properties?: Record<string, {
        type?: string;
        format?: string;
        description?: string;
        enum?: unknown[];
        default?: unknown;
        example?: unknown;
      }>;
      required?: string[];
    },
    doc: SwaggerDocument
  ): KeyValuePair[] {
    const formData: KeyValuePair[] = [];
    
    // Handle $ref if present
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schemaRef = (schema as any).$ref;
    if (schemaRef) {
      const resolved = this.resolveRef(schemaRef, doc);
      if (resolved) {
        return this.parseSchemaToFormData(resolved, doc);
      }
    }

    if (schema.properties) {
      const requiredFields = schema.required || [];
      
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        const isRequired = requiredFields.includes(propName);
        
        // Get sample value for this property
        let value = '';
        if (propSchema.example !== undefined) {
          value = String(propSchema.example);
        } else if (propSchema.default !== undefined) {
          value = String(propSchema.default);
        } else if (propSchema.enum && propSchema.enum.length > 0) {
          value = String(propSchema.enum[0]);
        } else {
          value = this.getSampleValueByType(propSchema.type, propSchema.format);
        }

        formData.push({
          id: uuidv4(),
          key: propName,
          value,
          description: propSchema.description || undefined,
          enabled: isRequired,
        });
      }
    }

    return formData;
  }

  // Get human-readable type description for parameter
  private getParamTypeDescription(param: {
    type?: string;
    schema?: { type?: string; format?: string };
    format?: string;
    required?: boolean;
  }): string {
    const type = param.schema?.type || param.type || 'string';
    const format = param.schema?.format || param.format;
    const parts: string[] = [];
    
    parts.push(type);
    if (format) {
      parts.push(`(${format})`);
    }
    if (param.required) {
      parts.push('*required');
    }
    
    return parts.join(' ');
  }

  // Generate sample JSON from schema (handles $ref resolution)
  private generateSampleJson(schema: object, doc: SwaggerDocument, depth = 0): string {
    if (depth > 5) return '{}'; // Prevent infinite recursion
    
    try {
      const sample = this.buildSampleObject(schema, doc, depth);
      return JSON.stringify(sample, null, 2);
    } catch {
      return '{}';
    }
  }

  // Build sample object from schema
  private buildSampleObject(schema: Record<string, unknown>, doc: SwaggerDocument, depth: number): unknown {
    // Handle $ref
    if (schema.$ref) {
      const resolved = this.resolveRef(schema.$ref as string, doc);
      if (resolved) {
        return this.buildSampleObject(resolved, doc, depth + 1);
      }
      return {};
    }

    const type = schema.type as string | undefined;
    const example = schema.example;
    const defaultVal = schema.default;
    const enumVals = schema.enum as unknown[] | undefined;

    // Return example if available
    if (example !== undefined) {
      return example;
    }

    // Return default if available
    if (defaultVal !== undefined) {
      return defaultVal;
    }

    // Return first enum value if available
    if (enumVals && enumVals.length > 0) {
      return enumVals[0];
    }

    switch (type) {
      case 'object': {
        const obj: Record<string, unknown> = {};
        const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
        if (properties) {
          for (const [key, propSchema] of Object.entries(properties)) {
            obj[key] = this.buildSampleObject(propSchema, doc, depth + 1);
          }
        }
        return obj;
      }

      case 'array': {
        const items = schema.items as Record<string, unknown> | undefined;
        if (items) {
          return [this.buildSampleObject(items, doc, depth + 1)];
        }
        return [];
      }

      case 'string': {
        const format = schema.format as string | undefined;
        return this.getSampleStringValue(format);
      }

      case 'integer':
        return 0;

      case 'number':
        return 0.0;

      case 'boolean':
        return true;

      case 'null':
        return null;

      default:
        // If no type specified but has properties, treat as object
        if (schema.properties) {
          const obj: Record<string, unknown> = {};
          const properties = schema.properties as Record<string, Record<string, unknown>>;
          for (const [key, propSchema] of Object.entries(properties)) {
            obj[key] = this.buildSampleObject(propSchema, doc, depth + 1);
          }
          return obj;
        }
        
        // allOf, oneOf, anyOf support
        if (schema.allOf) {
          const combined: Record<string, unknown> = {};
          for (const subSchema of schema.allOf as Record<string, unknown>[]) {
            const result = this.buildSampleObject(subSchema, doc, depth + 1);
            if (typeof result === 'object' && result !== null) {
              Object.assign(combined, result);
            }
          }
          return combined;
        }
        
        if (schema.oneOf || schema.anyOf) {
          const options = (schema.oneOf || schema.anyOf) as Record<string, unknown>[];
          if (options.length > 0) {
            return this.buildSampleObject(options[0], doc, depth + 1);
          }
        }
        
        return 'string';
    }
  }

  // Get sample string value based on format
  private getSampleStringValue(format?: string): string {
    switch (format) {
      case 'date':
        return new Date().toISOString().split('T')[0];
      case 'date-time':
        return new Date().toISOString();
      case 'email':
        return 'user@example.com';
      case 'uri':
      case 'url':
        return 'https://example.com';
      case 'uuid':
        return '00000000-0000-0000-0000-000000000000';
      case 'hostname':
        return 'example.com';
      case 'ipv4':
        return '127.0.0.1';
      case 'ipv6':
        return '::1';
      case 'binary':
        return '<binary>';
      case 'byte':
        return 'YmFzZTY0';
      case 'password':
        return '********';
      default:
        return 'string';
    }
  }

  // Resolve $ref to actual schema
  private resolveRef(ref: string, doc: SwaggerDocument): Record<string, unknown> | null {
    if (!ref.startsWith('#/')) return null;
    
    const path = ref.slice(2).split('/');
    let current: unknown = doc;
    
    for (const segment of path) {
      if (current && typeof current === 'object') {
        current = (current as Record<string, unknown>)[segment];
      } else {
        return null;
      }
    }
    
    return current as Record<string, unknown> | null;
  }
}

// ============================================================================
// Postman Collection Types
// ============================================================================

interface PostmanCollection {
  info: {
    _postman_id?: string;
    name: string;
    description?: string;
    schema?: string;
    version?: string;
  };
  item: PostmanItem[];
  variable?: PostmanVariable[];
  auth?: PostmanAuth;
  event?: PostmanEvent[];
}

interface PostmanItem {
  name: string;
  description?: string;
  item?: PostmanItem[]; // For folders
  request?: PostmanRequest; // For requests
  response?: PostmanResponse[];
  event?: PostmanEvent[];
  auth?: PostmanAuth;
}

interface PostmanRequest {
  method: string;
  header?: PostmanHeader[];
  url: PostmanUrl | string;
  body?: PostmanBody;
  auth?: PostmanAuth;
  description?: string;
}

interface PostmanUrl {
  raw?: string;
  protocol?: string;
  host?: string | string[];
  port?: string;
  path?: string | string[];
  query?: PostmanQueryParam[];
  variable?: PostmanVariable[];
}

interface PostmanHeader {
  key: string;
  value: string;
  description?: string;
  disabled?: boolean;
  type?: string;
}

interface PostmanQueryParam {
  key: string;
  value?: string;
  description?: string;
  disabled?: boolean;
}

interface PostmanVariable {
  id?: string;
  key: string;
  value?: string;
  description?: string;
  disabled?: boolean;
  type?: string;
}

interface PostmanBody {
  mode?: 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql';
  raw?: string;
  urlencoded?: PostmanUrlEncodedParam[];
  formdata?: PostmanFormDataParam[];
  options?: {
    raw?: {
      language?: string;
    };
  };
  graphql?: {
    query?: string;
    variables?: string;
  };
}

interface PostmanUrlEncodedParam {
  key: string;
  value?: string;
  description?: string;
  disabled?: boolean;
  type?: string;
}

interface PostmanFormDataParam {
  key: string;
  value?: string;
  description?: string;
  disabled?: boolean;
  type?: 'text' | 'file';
  src?: string;
}

interface PostmanAuth {
  type: string;
  basic?: Array<{ key: string; value: string }>;
  bearer?: Array<{ key: string; value: string }>;
  apikey?: Array<{ key: string; value: string }>;
  oauth2?: Array<{ key: string; value: string }>;
}

interface PostmanResponse {
  name?: string;
  originalRequest?: PostmanRequest;
  status?: string;
  code?: number;
  header?: PostmanHeader[];
  body?: string;
}

interface PostmanEvent {
  listen: 'prerequest' | 'test';
  script?: {
    type?: string;
    exec?: string | string[];
  };
}

// ============================================================================
// Postman Collection Adapter
// ============================================================================

export class PostmanAdapter implements SpecImporterAdapter {
  format: SpecFormat = 'postman';

  canParse(content: string): boolean {
    try {
      const doc = JSON.parse(content);
      // Check for Postman collection structure - must have info and item
      // Can be v2.0 or v2.1 schema
      if (!doc.info || !doc.item) return false;
      
      // Check for Postman-specific fields
      const hasPostmanId = !!doc.info._postman_id;
      const hasPostmanSchema = doc.info.schema?.includes('getpostman.com') || 
                               doc.info.schema?.includes('postman.com');
      
      return hasPostmanId || hasPostmanSchema || this.looksLikePostman(doc);
    } catch {
      return false;
    }
  }

  // Additional heuristics to detect Postman collections
  private looksLikePostman(doc: PostmanCollection): boolean {
    // Check if items have the Postman request structure
    if (doc.item && doc.item.length > 0) {
      const firstItem = doc.item[0];
      // Folders have nested item arrays, requests have request objects
      if (firstItem.request) {
        return typeof firstItem.request === 'object' && 
               'method' in firstItem.request &&
               'url' in firstItem.request;
      }
      if (firstItem.item) {
        return true; // Has folder structure
      }
    }
    return false;
  }

  getInfo(content: string): SpecInfo | null {
    try {
      const doc: PostmanCollection = JSON.parse(content);
      if (!doc.info) return null;
      
      // Extract base URL from variables if available
      let baseUrl: string | undefined;
      if (doc.variable) {
        const baseUrlVar = doc.variable.find(v => 
          v.key.toLowerCase() === 'baseurl' || 
          v.key.toLowerCase() === 'base_url' ||
          v.key.toLowerCase() === 'host'
        );
        if (baseUrlVar?.value) {
          baseUrl = baseUrlVar.value;
        }
      }
      
      return {
        name: doc.info.name,
        description: typeof doc.info.description === 'string' ? doc.info.description : undefined,
        version: doc.info.version,
        baseUrl,
      };
    } catch {
      return null;
    }
  }

  parse(content: string, options?: SpecImportOptions): { collection: Collection; environments?: Environment[] } {
    const doc: PostmanCollection = JSON.parse(content);
    const collection = this.convertToCollection(doc, options);
    
    // Postman collections don't typically have multiple environments in the collection
    // They use separate environment files, so we don't generate environments here
    return { collection };
  }

  private convertToCollection(doc: PostmanCollection, options?: SpecImportOptions): Collection {
    // Extract variables from Postman collection
    const variables: KeyValuePair[] = [];
    const baseUrlVarName = options?.baseUrlVariableName || 'baseUrl';
    
    if (doc.variable) {
      for (const v of doc.variable) {
        if (v.key) {
          variables.push({
            id: uuidv4(),
            key: v.key,
            value: v.value || '',
            description: v.description,
            enabled: !v.disabled,
          });
        }
      }
    }

    // Process items (can be folders or requests)
    const { folders, requests } = this.processItems(doc.item, doc);

    // Check if all requests share the same auth - if so, set it at collection level
    const sharedAuth = this.detectSharedAuth(requests, folders);
    
    const collection: Collection = {
      id: uuidv4(),
      name: doc.info.name || 'Imported Postman Collection',
      description: typeof doc.info.description === 'string' ? doc.info.description : undefined,
      requests: [],
      folders: [],
      variables: variables.length > 0 ? variables : undefined,
      auth: sharedAuth || this.convertAuth(doc.auth),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Create a "Default" collection environment when user explicitly provides a baseUrl value
    if (options?.baseUrlValue) {
      const defaultEnvId = uuidv4();
      collection.environments = [{
        id: defaultEnvId,
        name: 'Default',
        variables: [
          {
            id: uuidv4(),
            key: baseUrlVarName,
            value: options.baseUrlValue,
            description: 'Base URL for API requests',
            enabled: true,
          },
        ],
        isActive: true,
      }];
      collection.defaultEnvironmentId = defaultEnvId;
    }

    // If shared auth was detected, remove auth from individual requests
    if (sharedAuth) {
      this.clearRequestAuth(requests);
      this.clearFolderAuth(folders);
    }

    collection.folders = folders;
    collection.requests = requests;

    return collection;
  }

  // Detect if all requests share the same auth configuration
  private detectSharedAuth(requests: Request[], folders: Folder[]): AuthConfig | null {
    const allAuths: AuthConfig[] = [];
    
    // Collect auth from root requests
    for (const req of requests) {
      if (req.auth && req.auth.type !== 'none') {
        allAuths.push(req.auth);
      }
    }
    
    // Collect auth from folder requests recursively
    const collectFolderAuth = (folder: Folder) => {
      for (const req of folder.requests) {
        if (req.auth && req.auth.type !== 'none') {
          allAuths.push(req.auth);
        }
      }
      for (const subFolder of folder.folders) {
        collectFolderAuth(subFolder);
      }
    };
    
    for (const folder of folders) {
      collectFolderAuth(folder);
    }
    
    // If no auth found, return null
    if (allAuths.length === 0) {
      return null;
    }
    
    // Check if all auth configs are the same
    const firstAuth = allAuths[0];
    const allSame = allAuths.every(auth => this.authConfigsEqual(auth, firstAuth));
    
    if (allSame) {
      return firstAuth;
    }
    
    return null;
  }

  // Compare two auth configs for equality
  private authConfigsEqual(a: AuthConfig, b: AuthConfig): boolean {
    if (a.type !== b.type) return false;
    
    switch (a.type) {
      case 'basic':
        return a.basic?.username === b.basic?.username && 
               a.basic?.password === b.basic?.password;
      case 'bearer':
        return a.bearer?.token === b.bearer?.token;
      case 'apiKey':
        return a.apiKey?.key === b.apiKey?.key && 
               a.apiKey?.value === b.apiKey?.value &&
               a.apiKey?.addTo === b.apiKey?.addTo;
      case 'oauth2':
        return a.oauth2?.accessToken === b.oauth2?.accessToken &&
               a.oauth2?.tokenType === b.oauth2?.tokenType;
      case 'none':
        return true;
      default:
        return JSON.stringify(a) === JSON.stringify(b);
    }
  }

  // Clear auth from requests (set to 'none')
  private clearRequestAuth(requests: Request[]): void {
    for (const req of requests) {
      req.auth = { type: 'none' };
    }
  }

  // Clear auth from folder requests recursively
  private clearFolderAuth(folders: Folder[]): void {
    for (const folder of folders) {
      this.clearRequestAuth(folder.requests);
      this.clearFolderAuth(folder.folders);
    }
  }

  private processItems(items: PostmanItem[], doc: PostmanCollection): { folders: Folder[]; requests: Request[] } {
    const folders: Folder[] = [];
    const requests: Request[] = [];

    for (const item of items) {
      if (item.item) {
        // This is a folder
        const folder = this.createFolder(item, doc);
        folders.push(folder);
      } else if (item.request) {
        // This is a request
        const request = this.createRequest(item, doc);
        requests.push(request);
      }
    }

    return { folders, requests };
  }

  private createFolder(item: PostmanItem, doc: PostmanCollection): Folder {
    const { folders: nestedFolders, requests } = this.processItems(item.item || [], doc);

    return {
      id: uuidv4(),
      name: item.name,
      requests,
      folders: nestedFolders,
      collapsed: true, // Collapsed by default on import
    };
  }

  private createRequest(item: PostmanItem, doc: PostmanCollection): Request {
    const postmanReq = item.request!;
    
    // Parse URL
    const { url, queryParams, pathParams } = this.parseUrl(postmanReq.url);
    
    // Parse headers
    const headers = this.parseHeaders(postmanReq.header);
    
    // Parse body
    const body = this.parseBody(postmanReq.body);
    
    // Parse auth (request-level, fallback to item-level, then collection-level)
    const auth = this.convertAuth(postmanReq.auth || item.auth || doc.auth);
    
    // Parse scripts
    const scripts = this.parseScripts(item.event);

    return {
      id: uuidv4(),
      name: item.name,
      description: item.description || postmanReq.description || undefined,
      method: (postmanReq.method || 'GET').toUpperCase() as HttpMethod,
      url,
      headers,
      queryParams,
      pathParams,
      body,
      auth: auth || { type: 'none' },
      scripts,
    };
  }

  private parseUrl(postmanUrl: PostmanUrl | string): { url: string; queryParams: KeyValuePair[]; pathParams: KeyValuePair[] } {
    const queryParams: KeyValuePair[] = [];
    const pathParams: KeyValuePair[] = [];
    let url: string;

    if (typeof postmanUrl === 'string') {
      // Simple string URL
      url = postmanUrl;
      
      // Extract query params from URL string
      try {
        const urlObj = new URL(url.replace(/\{\{[^}]+\}\}/g, 'placeholder'));
        // URL is valid, but we keep the original with variables
      } catch {
        // URL contains variables, just use as-is
      }
    } else {
      // Complex URL object
      if (postmanUrl.raw) {
        url = postmanUrl.raw;
      } else {
        // Build URL from parts
        const parts: string[] = [];
        
        if (postmanUrl.protocol) {
          parts.push(postmanUrl.protocol + '://');
        }
        
        if (postmanUrl.host) {
          const host = Array.isArray(postmanUrl.host) 
            ? postmanUrl.host.join('.') 
            : postmanUrl.host;
          parts.push(host);
        }
        
        if (postmanUrl.port) {
          parts.push(':' + postmanUrl.port);
        }
        
        if (postmanUrl.path) {
          const path = Array.isArray(postmanUrl.path)
            ? '/' + postmanUrl.path.join('/')
            : postmanUrl.path;
          parts.push(path);
        }
        
        url = parts.join('');
      }

      // Extract query parameters
      if (postmanUrl.query) {
        for (const param of postmanUrl.query) {
          queryParams.push({
            id: uuidv4(),
            key: param.key,
            value: param.value || '',
            description: param.description,
            enabled: !param.disabled,
          });
        }
      }

      // Extract path variables
      if (postmanUrl.variable) {
        for (const v of postmanUrl.variable) {
          pathParams.push({
            id: uuidv4(),
            key: v.key,
            value: v.value || '',
            description: v.description,
            enabled: true,
          });
        }
      }
    }
    
    // Also extract path variables from URL pattern (e.g., :id, :userId)
    const pathVarMatches = url.match(/(?<!\{):([a-zA-Z_][a-zA-Z0-9_]*)/g);
    if (pathVarMatches) {
      for (const match of pathVarMatches) {
        const varName = match.slice(1); // Remove : prefix
        // Only add if not already in pathParams
        if (!pathParams.some(p => p.key === varName)) {
          pathParams.push({
            id: uuidv4(),
            key: varName,
            value: '',
            enabled: true,
          });
        }
      }
    }
    
    // Also extract path variables from OpenAPI-style {id} format (single braces, not {{var}})
    const openApiPathVarMatches = url.match(/(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})/g);
    if (openApiPathVarMatches) {
      for (const match of openApiPathVarMatches) {
        const varName = match.slice(1, -1); // Remove { and }
        // Only add if not already in pathParams
        if (!pathParams.some(p => p.key === varName)) {
          pathParams.push({
            id: uuidv4(),
            key: varName,
            value: '',
            enabled: true,
          });
        }
      }
    }

    // Remove query string from URL if we extracted params separately
    if (queryParams.length > 0) {
      const queryIndex = url.indexOf('?');
      if (queryIndex > -1) {
        url = url.substring(0, queryIndex);
      }
    }

    return { url, queryParams, pathParams };
  }

  private parseHeaders(headers?: PostmanHeader[]): KeyValuePair[] {
    if (!headers) return [];

    return headers.map(h => ({
      id: uuidv4(),
      key: h.key,
      value: h.value,
      description: h.description,
      enabled: !h.disabled,
    }));
  }

  private parseBody(body?: PostmanBody): { type: 'none' | 'json' | 'form-data' | 'x-www-form-urlencoded' | 'raw' | 'binary'; content: string } {
    if (!body || !body.mode) {
      return { type: 'none', content: '' };
    }

    switch (body.mode) {
      case 'raw': {
        // Check if it's JSON
        const isJson = body.options?.raw?.language === 'json' || 
                      this.looksLikeJson(body.raw || '');
        return {
          type: isJson ? 'json' : 'raw',
          content: body.raw || '',
        };
      }

      case 'urlencoded': {
        // Convert to x-www-form-urlencoded format
        const content = (body.urlencoded || [])
          .filter(p => !p.disabled)
          .map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value || '')}`)
          .join('&');
        return {
          type: 'x-www-form-urlencoded',
          content,
        };
      }

      case 'formdata': {
        // Store as JSON representation of form data
        const formData = (body.formdata || [])
          .filter(p => !p.disabled)
          .map(p => ({
            key: p.key,
            value: p.value || '',
            type: p.type || 'text',
            description: p.description,
          }));
        return {
          type: 'form-data',
          content: JSON.stringify(formData, null, 2),
        };
      }

      case 'graphql': {
        // Store GraphQL as JSON with query and variables
        const graphqlContent = {
          query: body.graphql?.query || '',
          variables: body.graphql?.variables ? JSON.parse(body.graphql.variables) : {},
        };
        return {
          type: 'json',
          content: JSON.stringify(graphqlContent, null, 2),
        };
      }

      case 'file':
        return {
          type: 'binary',
          content: '',
        };

      default:
        return { type: 'none', content: '' };
    }
  }

  private looksLikeJson(content: string): boolean {
    const trimmed = content.trim();
    return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
           (trimmed.startsWith('[') && trimmed.endsWith(']'));
  }

  private convertAuth(auth?: PostmanAuth): AuthConfig | undefined {
    if (!auth) return undefined;

    switch (auth.type) {
      case 'basic': {
        const basicAuth = this.getAuthValues(auth.basic);
        return {
          type: 'basic',
          basic: {
            username: basicAuth['username'] || '',
            password: basicAuth['password'] || '',
          },
        };
      }

      case 'bearer': {
        const bearerAuth = this.getAuthValues(auth.bearer);
        return {
          type: 'bearer',
          bearer: {
            token: bearerAuth['token'] || '',
          },
        };
      }

      case 'apikey': {
        const apiKeyAuth = this.getAuthValues(auth.apikey);
        return {
          type: 'apiKey',
          apiKey: {
            key: apiKeyAuth['key'] || 'X-API-Key',
            value: apiKeyAuth['value'] || '',
            addTo: (apiKeyAuth['in'] === 'query' ? 'query' : 'header') as 'header' | 'query',
          },
        };
      }

      case 'oauth2': {
        const oauth2Auth = this.getAuthValues(auth.oauth2);
        return {
          type: 'oauth2',
          oauth2: {
            grantType: 'client_credentials',
            accessToken: oauth2Auth['accessToken'] || oauth2Auth['access_token'] || '',
            tokenType: oauth2Auth['tokenType'] || 'Bearer',
            clientId: oauth2Auth['clientId'] || oauth2Auth['client_id'] || '',
            clientSecret: oauth2Auth['clientSecret'] || oauth2Auth['client_secret'] || '',
          },
        };
      }

      case 'noauth':
      default:
        return { type: 'none' };
    }
  }

  private getAuthValues(authData?: Array<{ key: string; value: string }> | Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    if (!authData) return result;
    
    // Handle array format: [{ key: 'token', value: 'abc' }]
    if (Array.isArray(authData)) {
      for (const item of authData) {
        if (item.key && item.value !== undefined) {
        result[item.key] = item.value;
      }
    }
    } 
    // Handle object format: { token: 'abc' }
    else if (typeof authData === 'object') {
      for (const [key, value] of Object.entries(authData)) {
        if (typeof value === 'string') {
          result[key] = value;
        }
      }
    }
    
    return result;
  }

  private parseScripts(events?: PostmanEvent[]): { pre: string; post: string } {
    const scripts = { pre: '', post: '' };
    
    if (!events) return scripts;

    for (const event of events) {
      if (event.script?.exec) {
        const code = Array.isArray(event.script.exec) 
          ? event.script.exec.join('\n')
          : event.script.exec;
        
        if (event.listen === 'prerequest') {
          scripts.pre = code;
        } else if (event.listen === 'test') {
          scripts.post = code;
        }
      }
    }

    return scripts;
  }
}

// ============================================================================
// Echolon Format Adapter
// ============================================================================

export class EcholonAdapter implements SpecImporterAdapter {
  format: SpecFormat = 'echolon';

  canParse(content: string): boolean {
    try {
      const doc = JSON.parse(content);
      // Check for Echolon file structure:
      // - $schema containing 'echolon' (if present)
      // - OR: version, metadata with id/name, and requests/folders arrays
      
      // Strong match: $schema contains 'echolon'
      if (doc.$schema && typeof doc.$schema === 'string' && doc.$schema.includes('echolon')) {
        return true;
      }
      
      // Structural match: has the required Echolon structure
      const hasVersion = typeof doc.version === 'string';
      const hasMetadata = doc.metadata && 
                          typeof doc.metadata.id === 'string' && 
                          typeof doc.metadata.name === 'string';
      const hasRequestsOrFolders = Array.isArray(doc.requests) || Array.isArray(doc.folders);
      const hasSettings = doc.settings !== undefined; // Echolon files have settings
      
      // Must NOT look like OpenAPI (no 'openapi'/'swagger' version string at root, no 'paths')
      const looksLikeOpenAPI = (typeof doc.openapi === 'string') || 
                               (typeof doc.swagger === 'string') || 
                               doc.paths !== undefined;
      
      return hasVersion && hasMetadata && hasRequestsOrFolders && hasSettings && !looksLikeOpenAPI;
    } catch {
      return false;
    }
  }

  getInfo(content: string): SpecInfo | null {
    try {
      const doc: EchoFile = JSON.parse(content);
      if (!doc.metadata) return null;

      // Extract base URL from environments if available
      let baseUrl: string | undefined;
      const servers: ServerInfo[] = [];
      
      if (doc.environments && doc.environments.length > 0) {
        for (const env of doc.environments) {
          // Look for baseUrl variable in each environment
          const baseUrlVar = env.variables?.find(v => 
            v.key.toLowerCase() === 'baseurl' || 
            v.key.toLowerCase() === 'base_url'
          );
          if (baseUrlVar?.value) {
            servers.push({
              url: baseUrlVar.value,
              description: env.name,
            });
            if (!baseUrl) {
              baseUrl = baseUrlVar.value;
            }
          }
        }
      }

      return {
        name: doc.metadata.name,
        description: doc.metadata.description,
        baseUrl,
        servers,
      };
    } catch {
      return null;
    }
  }

  parse(content: string, _options?: SpecImportOptions): { collection: Collection; environments?: Environment[] } {
    const doc: EchoFile = JSON.parse(content);
    
    // Use the EchoFileConverter to convert to Collection
    // Use a default workspace ID since we're importing
    const collection = echoFileToCollection(doc, doc.metadata.workspaceId || 'imported');
    
    return { collection };
  }
}

// ============================================================================
// Main Spec Importer Service
// ============================================================================

export class SpecImporter {
  private static instance: SpecImporter;
  private adapters: SpecImporterAdapter[] = [];

  private constructor() {
    // Register default adapters
    // Note: Echolon adapter is first to ensure it has priority over OpenAPI
    // (since Echolon files may contain an embedded OpenAPI spec)
    this.registerAdapter(new EcholonAdapter());
    this.registerAdapter(new OpenAPIAdapter());
    this.registerAdapter(new PostmanAdapter());
  }

  static getInstance(): SpecImporter {
    if (!SpecImporter.instance) {
      SpecImporter.instance = new SpecImporter();
    }
    return SpecImporter.instance;
  }

  registerAdapter(adapter: SpecImporterAdapter): void {
    this.adapters.push(adapter);
  }

  // Detect the format of a spec content
  detectFormat(content: string): SpecFormat | null {
    for (const adapter of this.adapters) {
      if (adapter.canParse(content)) {
        return adapter.format;
      }
    }
    return null;
  }

  // Get info about a spec without full parsing
  getSpecInfo(content: string): (SpecInfo & { format: SpecFormat }) | null {
    for (const adapter of this.adapters) {
      if (adapter.canParse(content)) {
        const info = adapter.getInfo(content);
        if (info) {
          return { format: adapter.format, ...info };
        }
      }
    }
    return null;
  }

  // Parse file content
  async parseFile(file: File, options?: SpecImportOptions): Promise<SpecImportResult> {
    const content = await file.text();
    return this.parseContent(content, options);
  }

  // Parse content string
  parseContent(content: string, options?: SpecImportOptions): SpecImportResult {
    for (const adapter of this.adapters) {
      if (adapter.canParse(content)) {
        const result = adapter.parse(content, options);
        return {
          collection: result.collection,
          rawSpec: content,
          format: adapter.format,
        };
      }
    }
    throw new Error('Unable to detect spec format. Supported formats: OpenAPI/Swagger, Echolon.');
  }

  // Import from URL (uses Electron IPC to bypass CORS in desktop, fetch in web)
  async importFromUrl(url: string, options?: SpecImportOptions): Promise<SpecImportResult & { specSource: SpecSource }> {
    let content: string;
    
    if (window.electronAPI?.fetchUrlContent) {
      // Desktop app: use Electron IPC to bypass CORS
      const result = await window.electronAPI.fetchUrlContent(url);
      
      if (!result.success || !result.content) {
        throw new Error(result.error || 'Failed to fetch URL content');
      }
      content = result.content;
    } else {
      // Web mode: use fetch directly (requires CORS to be enabled on the server)
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
      }
      content = await response.text();
    }

    const importResult = this.parseContent(content, options);
    const now = Date.now();
    
    // Create spec source metadata
    const specSource: SpecSource = {
      type: 'url',
      format: importResult.format,
      url,
      lastSyncedAt: now,
      syncFrequencyMins: 30, // Default to 30 minutes
      rawSpec: importResult.rawSpec,
    };

    // Attach import metadata to collection
    importResult.collection.specSource = specSource;
    importResult.collection.importedAt = now;

    return {
      ...importResult,
      specSource,
    };
  }

  // Create spec source for file import
  createFileSpecSource(content: string, format: SpecFormat): SpecSource {
    return {
      type: 'file',
      format,
      syncFrequencyMins: 0, // Files don't auto-sync
      rawSpec: content,
    };
  }

  // Validate URL format
  isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const specImporter = SpecImporter.getInstance();
export default specImporter;

