/**
 * Utility to extract response examples and schemas from OpenAPI specs
 * for a given request path and method.
 */

interface SpecResponseInfo {
  example: string | null;
  schema: string | null;
}

interface OpenAPISchema {
  type?: string | string[];
  format?: string;
  properties?: Record<string, OpenAPISchema>;
  items?: OpenAPISchema;
  $ref?: string;
  allOf?: OpenAPISchema[];
  oneOf?: OpenAPISchema[];
  anyOf?: OpenAPISchema[];
  enum?: unknown[];
  default?: unknown;
  example?: unknown;
  description?: string;
  required?: string[];
  additionalProperties?: boolean | OpenAPISchema;
}

interface OpenAPIDocument {
  openapi?: string;
  swagger?: string;
  paths?: Record<string, Record<string, OpenAPIOperation>>;
  components?: {
    schemas?: Record<string, OpenAPISchema>;
  };
  definitions?: Record<string, OpenAPISchema>; // Swagger 2.0
}

interface OpenAPIOperation {
  responses?: Record<string, OpenAPIResponse>;
}

interface OpenAPIResponse {
  description?: string;
  content?: Record<string, { schema?: OpenAPISchema; example?: unknown }>;
  schema?: OpenAPISchema; // Swagger 2.0
  examples?: Record<string, unknown>; // Swagger 2.0
}

/**
 * Extract the path from a full URL
 * Handles URLs like {{baseUrl}}/api/v1/teams or https://api.example.com/api/v1/teams
 */
function extractPathFromUrl(url: string): string {
  // Remove variable placeholders like {{baseUrl}}
  let cleanUrl = url.replace(/\{\{[^}]+\}\}/g, '');
  
  // If it starts with http, extract path
  if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) {
    try {
      const urlObj = new URL(cleanUrl);
      return urlObj.pathname;
    } catch {
      // If URL parsing fails, try to extract path manually
    }
  }
  
  // Remove leading slashes that might be doubled after variable removal
  cleanUrl = cleanUrl.replace(/^\/+/, '/');
  
  // If it's just a path, return it
  if (cleanUrl.startsWith('/')) {
    return cleanUrl.split('?')[0]; // Remove query params
  }
  
  // Try to extract path from something like "api.example.com/path"
  const pathMatch = cleanUrl.match(/^[^\/]+(.*)$/);
  if (pathMatch && pathMatch[1]) {
    return pathMatch[1].split('?')[0];
  }
  
  return '/' + cleanUrl.split('?')[0];
}

/**
 * Normalize a path to match OpenAPI spec format
 * Converts path params like :id to {id} format
 */
function normalizePath(path: string): string {
  // Convert :param to {param}
  return path.replace(/:(\w+)/g, '{$1}');
}

/**
 * Check if a spec path matches a request path
 * Handles path parameters like /users/{id} matching /users/123
 */
function pathMatches(specPath: string, requestPath: string): boolean {
  const specParts = specPath.split('/').filter(Boolean);
  const requestParts = normalizePath(requestPath).split('/').filter(Boolean);
  
  if (specParts.length !== requestParts.length) {
    return false;
  }
  
  return specParts.every((specPart, index) => {
    const requestPart = requestParts[index];
    // Path parameter in spec
    if (specPart.startsWith('{') && specPart.endsWith('}')) {
      return true;
    }
    // Path parameter in request (converted from :param)
    if (requestPart.startsWith('{') && requestPart.endsWith('}')) {
      return true;
    }
    return specPart.toLowerCase() === requestPart.toLowerCase();
  });
}

/**
 * Resolve a $ref to the actual schema
 */
function resolveRef(ref: string, doc: OpenAPIDocument): OpenAPISchema | null {
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
  
  return current as OpenAPISchema | null;
}

/**
 * Generate a sample value from a schema
 */
function generateSampleFromSchema(
  schema: OpenAPISchema,
  doc: OpenAPIDocument,
  depth = 0,
  seen = new Set<string>()
): unknown {
  if (depth > 10) return null; // Prevent infinite recursion
  
  // Handle $ref
  if (schema.$ref) {
    // Track circular references
    if (seen.has(schema.$ref)) {
      return '[Circular Reference]';
    }
    seen.add(schema.$ref);
    
    const resolved = resolveRef(schema.$ref, doc);
    if (resolved) {
      return generateSampleFromSchema(resolved, doc, depth + 1, seen);
    }
    return null;
  }
  
  // Return example if available
  if (schema.example !== undefined) {
    return schema.example;
  }
  
  // Return default if available
  if (schema.default !== undefined) {
    return schema.default;
  }
  
  // Return first enum value if available
  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[0];
  }
  
  // Handle type as array (OpenAPI 3.1+)
  const type = Array.isArray(schema.type) 
    ? schema.type.find(t => t !== 'null') || schema.type[0]
    : schema.type;
  
  switch (type) {
    case 'object': {
      const obj: Record<string, unknown> = {};
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          obj[key] = generateSampleFromSchema(propSchema, doc, depth + 1, new Set(seen));
        }
      }
      return obj;
    }
    
    case 'array': {
      if (schema.items) {
        const item = generateSampleFromSchema(schema.items, doc, depth + 1, new Set(seen));
        return [item];
      }
      return [];
    }
    
    case 'string': {
      switch (schema.format) {
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
          return 'string';
      }
    }
    
    case 'integer':
      return 1;
    
    case 'number':
      return 1.0;
    
    case 'boolean':
      return true;
    
    case 'null':
      return null;
    
    default:
      // If no type but has properties, treat as object
      if (schema.properties) {
        const obj: Record<string, unknown> = {};
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          obj[key] = generateSampleFromSchema(propSchema, doc, depth + 1, new Set(seen));
        }
        return obj;
      }
      
      // Handle allOf, oneOf, anyOf
      if (schema.allOf) {
        const combined: Record<string, unknown> = {};
        for (const subSchema of schema.allOf) {
          const result = generateSampleFromSchema(subSchema, doc, depth + 1, new Set(seen));
          if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
            Object.assign(combined, result);
          }
        }
        return combined;
      }
      
      if (schema.oneOf || schema.anyOf) {
        const options = schema.oneOf || schema.anyOf;
        if (options && options.length > 0) {
          return generateSampleFromSchema(options[0], doc, depth + 1, new Set(seen));
        }
      }
      
      return 'string';
  }
}

/**
 * Build the full schema with resolved $refs for display
 */
function buildDisplaySchema(
  schema: OpenAPISchema,
  doc: OpenAPIDocument,
  depth = 0,
  seen = new Set<string>()
): unknown {
  if (depth > 10) return '[max depth]';
  
  // Handle $ref
  if (schema.$ref) {
    if (seen.has(schema.$ref)) {
      return '[circular]';
    }
    seen.add(schema.$ref);
    
    const resolved = resolveRef(schema.$ref, doc);
    if (resolved) {
      return buildDisplaySchema(resolved, doc, depth + 1, seen);
    }
    return { $ref: schema.$ref };
  }
  
  // Handle type as array
  const type = schema.type;
  const result: Record<string, unknown> = {};
  
  if (type) result.type = type;
  if (schema.format) result.format = schema.format;
  if (schema.description) result.description = schema.description;
  if (schema.enum) result.enum = schema.enum;
  if (schema.required) result.required = schema.required;
  if (schema.additionalProperties !== undefined) result.additionalProperties = schema.additionalProperties;
  
  // Handle properties
  if (schema.properties) {
    const props: Record<string, unknown> = {};
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      props[key] = buildDisplaySchema(propSchema, doc, depth + 1, new Set(seen));
    }
    result.properties = props;
  }
  
  // Handle items
  if (schema.items) {
    result.items = buildDisplaySchema(schema.items, doc, depth + 1, new Set(seen));
  }
  
  // Handle allOf, oneOf, anyOf
  if (schema.allOf) {
    result.allOf = schema.allOf.map(s => buildDisplaySchema(s, doc, depth + 1, new Set(seen)));
  }
  if (schema.oneOf) {
    result.oneOf = schema.oneOf.map(s => buildDisplaySchema(s, doc, depth + 1, new Set(seen)));
  }
  if (schema.anyOf) {
    result.anyOf = schema.anyOf.map(s => buildDisplaySchema(s, doc, depth + 1, new Set(seen)));
  }
  
  return result;
}

/**
 * Extract response info from OpenAPI spec for a given path and method
 */
export function extractSpecResponseInfo(
  rawSpec: string | undefined,
  requestUrl: string,
  requestMethod: string
): SpecResponseInfo {
  if (!rawSpec) {
    return { example: null, schema: null };
  }
  
  try {
    // Parse the spec
    let doc: OpenAPIDocument;
    try {
      doc = JSON.parse(rawSpec);
    } catch {
      // Try YAML (basic support - in production would use a YAML parser)
      // For now, return null for YAML specs
      return { example: null, schema: null };
    }
    
    if (!doc.paths) {
      return { example: null, schema: null };
    }
    
    // Extract path from URL
    const requestPath = extractPathFromUrl(requestUrl);
    const method = requestMethod.toLowerCase();
    
    // Find matching path in spec
    let matchedOperation: OpenAPIOperation | null = null;
    
    for (const [specPath, pathItem] of Object.entries(doc.paths)) {
      if (pathMatches(specPath, requestPath) && pathItem[method]) {
        matchedOperation = pathItem[method];
        break;
      }
    }
    
    if (!matchedOperation || !matchedOperation.responses) {
      return { example: null, schema: null };
    }
    
    // Get the successful response (200, 201, or default)
    const successCodes = ['200', '201', '2XX', 'default'];
    let responseSchema: OpenAPISchema | null = null;
    let responseExample: unknown = null;
    
    for (const code of successCodes) {
      const response = matchedOperation.responses[code];
      if (!response) continue;
      
      // OpenAPI 3.0+ style
      if (response.content) {
        const jsonContent = response.content['application/json'];
        if (jsonContent) {
          responseSchema = jsonContent.schema || null;
          responseExample = jsonContent.example;
          break;
        }
        // Try other content types
        const firstContent = Object.values(response.content)[0];
        if (firstContent) {
          responseSchema = firstContent.schema || null;
          responseExample = firstContent.example;
          break;
        }
      }
      
      // Swagger 2.0 style
      if (response.schema) {
        responseSchema = response.schema;
        if (response.examples && response.examples['application/json']) {
          responseExample = response.examples['application/json'];
        }
        break;
      }
    }
    
    if (!responseSchema) {
      return { example: null, schema: null };
    }
    
    // Generate example from schema if not provided
    const example = responseExample !== undefined
      ? responseExample
      : generateSampleFromSchema(responseSchema, doc, 0, new Set());
    
    // Build display schema (with $refs resolved)
    const displaySchema = buildDisplaySchema(responseSchema, doc, 0, new Set());
    
    return {
      example: example !== null ? JSON.stringify(example, null, 2) : null,
      schema: displaySchema !== null ? JSON.stringify(displaySchema, null, 2) : null,
    };
  } catch (error) {
    console.error('Error extracting spec response info:', error);
    return { example: null, schema: null };
  }
}

