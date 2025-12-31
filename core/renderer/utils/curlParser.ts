import { Request, KeyValuePair, AuthConfig, RequestBody } from '@/types';
import { v4 as uuidv4 } from 'uuid';

export interface ParsedCurl {
  request: Request;
  rawCurl: string;
}

/**
 * Parse a curl command string into a Request object
 */
export function parseCurlCommand(curlString: string): ParsedCurl | null {
  const normalized = normalizeCurlCommand(curlString);
  
  if (!isCurlCommand(normalized)) {
    return null;
  }
  
  const tokens = tokenize(normalized);
  
  let method = 'GET';
  let url = '';
  const headers: KeyValuePair[] = [];
  let body = '';
  let contentType = '';
  let auth: AuthConfig = { type: 'none' };
  const queryParams: KeyValuePair[] = [];
  
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    
    // Skip 'curl' command itself
    if (token === 'curl') {
      i++;
      continue;
    }
    
    // Handle flags
    if (token.startsWith('-')) {
      switch (token) {
        case '-X':
        case '--request':
          if (i + 1 < tokens.length) {
            method = tokens[i + 1].toUpperCase();
            i += 2;
          } else {
            i++;
          }
          break;
          
        case '-H':
        case '--header':
          if (i + 1 < tokens.length) {
            const headerValue = tokens[i + 1];
            const colonIndex = headerValue.indexOf(':');
            if (colonIndex > 0) {
              const key = headerValue.slice(0, colonIndex).trim();
              const value = headerValue.slice(colonIndex + 1).trim();
              
              // Check for Content-Type
              if (key.toLowerCase() === 'content-type') {
                contentType = value;
              }
              
              // Check for Authorization header
              if (key.toLowerCase() === 'authorization') {
                if (value.toLowerCase().startsWith('bearer ')) {
                  auth = {
                    type: 'bearer',
                    bearer: { token: value.slice(7).trim() }
                  };
                } else if (value.toLowerCase().startsWith('basic ')) {
                  try {
                    const decoded = atob(value.slice(6).trim());
                    const [username, password] = decoded.split(':');
                    auth = {
                      type: 'basic',
                      basic: { username: username || '', password: password || '' }
                    };
                  } catch {
                    // If decoding fails, add as regular header
                    headers.push({
                      id: uuidv4(),
                      key,
                      value,
                      enabled: true
                    });
                  }
                } else {
                  // Unknown auth type, add as header
                  headers.push({
                    id: uuidv4(),
                    key,
                    value,
                    enabled: true
                  });
                }
              } else {
                headers.push({
                  id: uuidv4(),
                  key,
                  value,
                  enabled: true
                });
              }
            }
            i += 2;
          } else {
            i++;
          }
          break;
          
        case '-d':
        case '--data':
        case '--data-raw':
        case '--data-binary':
          if (i + 1 < tokens.length) {
            body = tokens[i + 1];
            // If method is still GET and we have body, change to POST
            if (method === 'GET') {
              method = 'POST';
            }
            i += 2;
          } else {
            i++;
          }
          break;
          
        case '--data-urlencode':
          if (i + 1 < tokens.length) {
            // Append to body as URL-encoded
            const param = tokens[i + 1];
            if (body) {
              body += '&' + param;
            } else {
              body = param;
            }
            if (!contentType) {
              contentType = 'application/x-www-form-urlencoded';
            }
            if (method === 'GET') {
              method = 'POST';
            }
            i += 2;
          } else {
            i++;
          }
          break;
          
        case '-u':
        case '--user':
          if (i + 1 < tokens.length) {
            const userPass = tokens[i + 1];
            const [username, ...passwordParts] = userPass.split(':');
            auth = {
              type: 'basic',
              basic: {
                username: username || '',
                password: passwordParts.join(':') || ''
              }
            };
            i += 2;
          } else {
            i++;
          }
          break;
          
        case '-A':
        case '--user-agent':
          if (i + 1 < tokens.length) {
            headers.push({
              id: uuidv4(),
              key: 'User-Agent',
              value: tokens[i + 1],
              enabled: true
            });
            i += 2;
          } else {
            i++;
          }
          break;
          
        case '-b':
        case '--cookie':
          if (i + 1 < tokens.length) {
            headers.push({
              id: uuidv4(),
              key: 'Cookie',
              value: tokens[i + 1],
              enabled: true
            });
            i += 2;
          } else {
            i++;
          }
          break;
          
        case '-e':
        case '--referer':
          if (i + 1 < tokens.length) {
            headers.push({
              id: uuidv4(),
              key: 'Referer',
              value: tokens[i + 1],
              enabled: true
            });
            i += 2;
          } else {
            i++;
          }
          break;
          
        case '-G':
        case '--get':
          method = 'GET';
          i++;
          break;
          
        case '-I':
        case '--head':
          method = 'HEAD';
          i++;
          break;
          
        // Flags to ignore (common but not relevant for building a request)
        case '-v':
        case '--verbose':
        case '-s':
        case '--silent':
        case '-S':
        case '--show-error':
        case '-k':
        case '--insecure':
        case '-L':
        case '--location':
        case '-i':
        case '--include':
        case '-o':
        case '--output':
        case '-O':
        case '--remote-name':
        case '-w':
        case '--write-out':
        case '--compressed':
          // These flags don't take a value
          i++;
          break;
          
        case '-m':
        case '--max-time':
        case '--connect-timeout':
        case '-C':
        case '--continue-at':
        case '-r':
        case '--range':
          // These flags take a value - skip both
          i += 2;
          break;
          
        default:
          // Unknown flag, try to detect if it takes a value
          if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
            i += 2;
          } else {
            i++;
          }
      }
    } else {
      // Not a flag - must be the URL
      if (!url && (token.startsWith('http://') || token.startsWith('https://') || token.includes('.'))) {
        url = token;
      }
      i++;
    }
  }
  
  // Ensure URL has protocol
  if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  
  // Parse query params from URL
  if (url) {
    try {
      const urlObj = new URL(url);
      urlObj.searchParams.forEach((value, key) => {
        queryParams.push({
          id: uuidv4(),
          key,
          value,
          enabled: true
        });
      });
      // Remove query string from URL for clean display
      url = urlObj.origin + urlObj.pathname;
    } catch {
      // Invalid URL, keep as-is
    }
  }
  
  // Determine body type
  let bodyType: RequestBody['type'] = 'none';
  let formData: KeyValuePair[] = [];
  
  if (body) {
    if (contentType.includes('application/json') || isJsonString(body)) {
      bodyType = 'json';
      // Try to pretty-print JSON
      try {
        body = JSON.stringify(JSON.parse(body), null, 2);
      } catch {
        // Keep as-is
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      bodyType = 'x-www-form-urlencoded';
      // Parse form data
      try {
        const params = new URLSearchParams(body);
        params.forEach((value, key) => {
          formData.push({
            id: uuidv4(),
            key,
            value,
            enabled: true
          });
        });
      } catch {
        // Fallback to raw
        bodyType = 'raw';
      }
    } else {
      bodyType = 'raw';
    }
  }
  
  // Generate a name from the URL
  let name = 'Imported Request';
  if (url) {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length > 0) {
        name = `${method} /${pathParts.slice(-2).join('/')}`;
      } else {
        name = `${method} ${urlObj.hostname}`;
      }
    } catch {
      name = `${method} Request`;
    }
  }
  
  // Add empty row at end of arrays
  if (headers.length === 0 || headers[headers.length - 1].key) {
    headers.push({
      id: uuidv4(),
      key: '',
      value: '',
      enabled: true
    });
  }
  
  if (queryParams.length === 0 || queryParams[queryParams.length - 1].key) {
    queryParams.push({
      id: uuidv4(),
      key: '',
      value: '',
      enabled: true
    });
  }
  
  const request: Request = {
    id: uuidv4(),
    name,
    method,
    url,
    headers,
    queryParams,
    body: {
      type: bodyType,
      content: bodyType === 'x-www-form-urlencoded' ? '' : body,
      formData: bodyType === 'x-www-form-urlencoded' ? formData : undefined
    },
    auth,
    scripts: { pre: '', post: '' }
  };
  
  return {
    request,
    rawCurl: curlString
  };
}

/**
 * Check if a string looks like a curl command
 */
export function isCurlCommand(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  return trimmed.startsWith('curl ') || trimmed === 'curl';
}

/**
 * Check if a string looks like a URL
 */
export function isUrl(input: string): boolean {
  const trimmed = input.trim();
  return /^https?:\/\//i.test(trimmed) || 
         /^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(\/|$)/i.test(trimmed);
}

/**
 * Detect the type of input
 */
export type InputType = 'curl' | 'url' | 'unknown';

export function detectInputType(input: string): InputType {
  const trimmed = input.trim();
  
  if (isCurlCommand(trimmed)) {
    return 'curl';
  }
  
  if (isUrl(trimmed)) {
    return 'url';
  }
  
  return 'unknown';
}

/**
 * Normalize a curl command (handle line continuations, etc.)
 */
function normalizeCurlCommand(curlString: string): string {
  return curlString
    // Remove line continuations
    .replace(/\\\s*\n/g, ' ')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenize a curl command string, handling quotes properly
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escape = false;
  
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    
    if (escape) {
      current += char;
      escape = false;
      continue;
    }
    
    if (char === '\\' && !inSingleQuote) {
      escape = true;
      continue;
    }
    
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    
    if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    
    current += char;
  }
  
  if (current) {
    tokens.push(current);
  }
  
  return tokens;
}

/**
 * Check if a string is valid JSON
 */
function isJsonString(str: string): boolean {
  try {
    const parsed = JSON.parse(str);
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return false;
  }
}

/**
 * Example curl commands for the import modal
 */
export const CURL_EXAMPLES = [
  {
    label: 'Simple GET',
    command: 'curl https://api.example.com/users'
  },
  {
    label: 'GET with headers',
    command: `curl -H "Authorization: Bearer token123" https://api.example.com/users`
  },
  {
    label: 'POST with JSON',
    command: `curl -X POST -H "Content-Type: application/json" -d '{"name": "John"}' https://api.example.com/users`
  },
  {
    label: 'POST with form data',
    command: `curl -X POST -d "name=John&email=john@example.com" https://api.example.com/users`
  }
];

/**
 * Example URLs for the import modal
 */
export const URL_EXAMPLES = [
  {
    label: 'Petstore (OpenAPI 3.0)',
    url: 'https://petstore3.swagger.io/api/v3/openapi.json'
  },
  {
    label: 'GitHub REST API',
    url: 'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json'
  }
];

