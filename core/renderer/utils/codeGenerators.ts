import { Request, Environment, Collection, KeyValuePair, AuthConfig } from '@/types';

export function interpolateVariables(
  text: string,
  environment: Environment | null
): string {
  if (!text || !environment) return text;

  return text.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
    const variable = environment.variables.find(
      v => v.key === varName.trim() && v.enabled
    );
    return variable ? variable.value : match;
  });
}

// Interpolate both environment variables and path parameters
// Collection variables have priority over global environment variables
export function interpolateAll(
  text: string,
  environment: Environment | null,
  pathParams?: KeyValuePair[],
  collection?: Collection | null
): string {
  if (!text) return text;
  
  let result = text;
  
  // Get active collection environment (if any)
  const activeCollectionEnv = collection?.environments?.find(e => e.isActive);
  
  // Interpolate environment variables {{var}}
  // Priority: collection environment > collection variables > global environment
  result = result.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
    const trimmedName = varName.trim();
    
    // 1. Check active collection environment first (highest priority)
    if (activeCollectionEnv) {
      const collEnvVar = activeCollectionEnv.variables.find(
        v => v.key === trimmedName && v.enabled
      );
      if (collEnvVar) return collEnvVar.value;
    }
    
    // 2. Check collection-level variables
    if (collection?.variables) {
      const collVar = collection.variables.find(
        v => v.key === trimmedName && v.enabled
      );
      if (collVar) return collVar.value;
    }
    
    // 3. Fall back to global environment
    if (environment) {
      const globalVar = environment.variables.find(
        v => v.key === trimmedName && v.enabled
      );
      if (globalVar) return globalVar.value;
    }
    
    return match; // Keep original if not found
  });
  
  // Then, interpolate path parameters :param
  if (pathParams && pathParams.length > 0) {
    result = result.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, paramName) => {
      const param = pathParams.find(p => p.key === paramName);
      return param && param.value ? param.value : match;
    });
  }
  
  return result;
}

// Helper to build URL with query params - resolves all variables and path params
function buildUrl(request: Request, interpolate: (text: string) => string): string {
  let url = interpolate(request.url);
  if (!url) {
    url = 'http://localhost';
  } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  try {
    const enabledParams = request.queryParams.filter(p => p.enabled && p.key);
    if (enabledParams.length > 0) {
      const urlObj = new URL(url);
      enabledParams.forEach(p => {
        urlObj.searchParams.set(interpolate(p.key), interpolate(p.value));
      });
      url = urlObj.toString();
    }
  } catch {
    // Invalid URL, use as-is
  }
  return url;
}

// Build a fully resolved URL (env vars + path params + query params)
export function buildResolvedUrl(
  request: Request,
  environment: Environment | null,
  collection?: Collection | null
): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  return buildUrl(request, interpolate);
}

// Helper to get effective auth (request auth takes precedence over collection auth)
function getEffectiveAuth(request: Request, collection: Collection | null): AuthConfig {
  // If request has auth configured, use it
  if (request.auth.type !== 'none') {
    return request.auth;
  }
  // Otherwise, use collection auth if available
  if (collection?.auth && collection.auth.type !== 'none') {
    return collection.auth;
  }
  // Default to no auth
  return { type: 'none' };
}

// Helper to build headers object
function buildHeaders(
  request: Request, 
  interpolate: (text: string) => string,
  collection: Collection | null
): Record<string, string> {
  const headers: Record<string, string> = {};
  
  // First, add collection-level headers (can be overridden by request headers)
  if (collection?.headers) {
    collection.headers
      .filter(h => h.enabled && h.key)
      .forEach(h => {
        headers[interpolate(h.key)] = interpolate(h.value);
      });
  }
  
  // Then add request-level headers (these override collection headers)
  request.headers
    .filter(h => h.enabled && h.key)
    .forEach(h => {
      headers[interpolate(h.key)] = interpolate(h.value);
    });

  // Auth - use effective auth (request or collection)
  const auth = getEffectiveAuth(request, collection);
  if (auth.type === 'basic' && auth.basic) {
    const credentials = btoa(
      `${interpolate(auth.basic.username)}:${interpolate(auth.basic.password)}`
    );
    headers['Authorization'] = `Basic ${credentials}`;
  } else if (auth.type === 'bearer' && auth.bearer) {
    headers['Authorization'] = `Bearer ${interpolate(auth.bearer.token)}`;
  } else if (auth.type === 'api-key' && auth.apiKey && auth.apiKey.addTo === 'header') {
    headers[interpolate(auth.apiKey.key)] = interpolate(auth.apiKey.value);
  } else if (auth.type === 'oauth2' && auth.oauth2?.accessToken) {
    const tokenType = auth.oauth2.tokenType || 'Bearer';
    headers['Authorization'] = `${tokenType} ${interpolate(auth.oauth2.accessToken)}`;
  } else if (auth.type === 'jwt' && auth.jwt?.token) {
    const prefix = auth.jwt.prefix || 'Bearer';
    const headerName = auth.jwt.headerName || 'Authorization';
    headers[headerName] = `${prefix} ${interpolate(auth.jwt.token)}`;
  }

  // Content-Type for body
  if (request.body.type === 'json') {
    headers['Content-Type'] = 'application/json';
  } else if (request.body.type === 'x-www-form-urlencoded') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  return headers;
}

// Helper to build body string
function buildBody(request: Request, interpolate: (text: string) => string): string | null {
  if (request.body.type === 'none') return null;
  
  if (request.body.type === 'json' || request.body.type === 'raw') {
    return interpolate(request.body.content);
  } else if (request.body.type === 'x-www-form-urlencoded') {
    const params = new URLSearchParams();
    request.body.formData
      ?.filter(f => f.enabled && f.key)
      .forEach(f => {
        params.set(interpolate(f.key), interpolate(f.value));
      });
    return params.toString();
  }
  return null;
}

// Escape string for various languages
const escape = {
  singleQuote: (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
  doubleQuote: (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"'),
  backtick: (s: string) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$'),
};

// ============== CURL ==============
export function generateCurl(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const parts: string[] = ['curl'];

  if (request.method !== 'GET') {
    parts.push(`-X ${request.method}`);
  }

  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  // Add all headers (collection + request headers are already merged in buildHeaders)
  Object.entries(headers).forEach(([key, value]) => {
    if (key !== 'Content-Type') { // Content-Type will be added with body
      parts.push(`-H '${key}: ${escape.singleQuote(value)}'`);
    }
  });

  if (body) {
    if (request.body.type === 'json') {
      parts.push(`-H 'Content-Type: application/json'`);
    } else if (request.body.type === 'x-www-form-urlencoded') {
      parts.push(`-H 'Content-Type: application/x-www-form-urlencoded'`);
    }
    parts.push(`-d '${escape.singleQuote(body)}'`);
  }

  parts.push(`'${url}'`);
  return parts.join(' \\\n  ');
}

// ============== JavaScript - Fetch ==============
export function generateJavaScriptFetch(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`const response = await fetch('${escape.singleQuote(url)}', {`);
  lines.push(`  method: '${request.method}',`);
  
  if (Object.keys(headers).length > 0) {
    lines.push(`  headers: {`);
    Object.entries(headers).forEach(([key, value], index, arr) => {
      const comma = index < arr.length - 1 ? ',' : '';
      lines.push(`    '${key}': '${escape.singleQuote(value)}'${comma}`);
    });
    lines.push(`  },`);
  }
  
  if (body) {
    if (request.body.type === 'json') {
      try {
        const parsed = JSON.parse(body);
        const formatted = JSON.stringify(parsed, null, 2)
          .split('\n')
          .map((line, i) => i === 0 ? line : '  ' + line)
          .join('\n');
        lines.push(`  body: JSON.stringify(${formatted}),`);
      } catch {
        lines.push(`  body: \`${escape.backtick(body)}\`,`);
      }
    } else {
      lines.push(`  body: '${escape.singleQuote(body)}',`);
    }
  }
  
  lines.push(`});`);
  lines.push(``);
  lines.push(`const data = await response.json();`);
  lines.push(`console.log(data);`);

  return lines.join('\n');
}

// ============== JavaScript - jQuery ==============
export function generateJavaScriptJQuery(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`$.ajax({`);
  lines.push(`  url: '${escape.singleQuote(url)}',`);
  lines.push(`  type: '${request.method}',`);
  
  if (Object.keys(headers).length > 0) {
    lines.push(`  headers: {`);
    Object.entries(headers).forEach(([key, value], index, arr) => {
      const comma = index < arr.length - 1 ? ',' : '';
      lines.push(`    '${key}': '${escape.singleQuote(value)}'${comma}`);
    });
    lines.push(`  },`);
  }
  
  if (body) {
    if (request.body.type === 'json') {
      lines.push(`  contentType: 'application/json',`);
      lines.push(`  data: JSON.stringify(${body}),`);
    } else {
      lines.push(`  data: '${escape.singleQuote(body)}',`);
    }
  }
  
  lines.push(`  success: function(data) {`);
  lines.push(`    console.log(data);`);
  lines.push(`  },`);
  lines.push(`  error: function(xhr, status, error) {`);
  lines.push(`    console.error(error);`);
  lines.push(`  }`);
  lines.push(`});`);

  return lines.join('\n');
}

// ============== JavaScript - XHR ==============
export function generateJavaScriptXHR(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`const xhr = new XMLHttpRequest();`);
  lines.push(`xhr.open('${request.method}', '${escape.singleQuote(url)}');`);
  lines.push(``);
  
  Object.entries(headers).forEach(([key, value]) => {
    lines.push(`xhr.setRequestHeader('${key}', '${escape.singleQuote(value)}');`);
  });
  
  lines.push(``);
  lines.push(`xhr.onreadystatechange = function() {`);
  lines.push(`  if (xhr.readyState === 4) {`);
  lines.push(`    console.log(xhr.status);`);
  lines.push(`    console.log(xhr.responseText);`);
  lines.push(`  }`);
  lines.push(`};`);
  lines.push(``);
  
  if (body) {
    if (request.body.type === 'json') {
      lines.push(`xhr.send(JSON.stringify(${body}));`);
    } else {
      lines.push(`xhr.send('${escape.singleQuote(body)}');`);
    }
  } else {
    lines.push(`xhr.send();`);
  }

  return lines.join('\n');
}

// ============== Node.js - Axios ==============
export function generateNodeAxios(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`const axios = require('axios');`);
  lines.push(``);
  lines.push(`const response = await axios({`);
  lines.push(`  method: '${request.method.toLowerCase()}',`);
  lines.push(`  url: '${escape.singleQuote(url)}',`);
  
  if (Object.keys(headers).length > 0) {
    lines.push(`  headers: {`);
    Object.entries(headers).forEach(([key, value], index, arr) => {
      const comma = index < arr.length - 1 ? ',' : '';
      lines.push(`    '${key}': '${escape.singleQuote(value)}'${comma}`);
    });
    lines.push(`  },`);
  }
  
  if (body) {
    if (request.body.type === 'json') {
      try {
        const parsed = JSON.parse(body);
        const formatted = JSON.stringify(parsed, null, 2)
          .split('\n')
          .map((line, i) => i === 0 ? line : '  ' + line)
          .join('\n');
        lines.push(`  data: ${formatted},`);
      } catch {
        lines.push(`  data: '${escape.singleQuote(body)}',`);
      }
    } else {
      lines.push(`  data: '${escape.singleQuote(body)}',`);
    }
  }
  
  lines.push(`});`);
  lines.push(``);
  lines.push(`console.log(response.data);`);

  return lines.join('\n');
}

// ============== Node.js - Native (http/https) ==============
export function generateNodeNative(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);
  const isHttps = url.startsWith('https');

  const lines: string[] = [];
  lines.push(`const ${isHttps ? 'https' : 'http'} = require('${isHttps ? 'https' : 'http'}');`);
  lines.push(``);
  lines.push(`const options = {`);
  lines.push(`  method: '${request.method}',`);
  
  if (Object.keys(headers).length > 0) {
    lines.push(`  headers: {`);
    Object.entries(headers).forEach(([key, value], index, arr) => {
      const comma = index < arr.length - 1 ? ',' : '';
      lines.push(`    '${key}': '${escape.singleQuote(value)}'${comma}`);
    });
    lines.push(`  },`);
  }
  
  lines.push(`};`);
  lines.push(``);
  lines.push(`const req = ${isHttps ? 'https' : 'http'}.request('${escape.singleQuote(url)}', options, (res) => {`);
  lines.push(`  let data = '';`);
  lines.push(`  res.on('data', (chunk) => { data += chunk; });`);
  lines.push(`  res.on('end', () => { console.log(JSON.parse(data)); });`);
  lines.push(`});`);
  lines.push(``);
  lines.push(`req.on('error', (error) => { console.error(error); });`);
  
  if (body) {
    lines.push(``);
    if (request.body.type === 'json') {
      lines.push(`req.write(JSON.stringify(${body}));`);
    } else {
      lines.push(`req.write('${escape.singleQuote(body)}');`);
    }
  }
  
  lines.push(`req.end();`);

  return lines.join('\n');
}

// ============== Node.js - Request (deprecated but still used) ==============
export function generateNodeRequest(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`const request = require('request');`);
  lines.push(``);
  lines.push(`const options = {`);
  lines.push(`  method: '${request.method}',`);
  lines.push(`  url: '${escape.singleQuote(url)}',`);
  
  if (Object.keys(headers).length > 0) {
    lines.push(`  headers: {`);
    Object.entries(headers).forEach(([key, value], index, arr) => {
      const comma = index < arr.length - 1 ? ',' : '';
      lines.push(`    '${key}': '${escape.singleQuote(value)}'${comma}`);
    });
    lines.push(`  },`);
  }
  
  if (body) {
    if (request.body.type === 'json') {
      lines.push(`  json: ${body},`);
    } else {
      lines.push(`  body: '${escape.singleQuote(body)}',`);
    }
  }
  
  lines.push(`};`);
  lines.push(``);
  lines.push(`request(options, function(error, response, body) {`);
  lines.push(`  if (error) throw new Error(error);`);
  lines.push(`  console.log(body);`);
  lines.push(`});`);

  return lines.join('\n');
}

// ============== Node.js - Unirest ==============
export function generateNodeUnirest(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`const unirest = require('unirest');`);
  lines.push(``);
  lines.push(`unirest('${request.method}', '${escape.singleQuote(url)}')`);
  
  if (Object.keys(headers).length > 0) {
    lines.push(`  .headers({`);
    Object.entries(headers).forEach(([key, value], index, arr) => {
      const comma = index < arr.length - 1 ? ',' : '';
      lines.push(`    '${key}': '${escape.singleQuote(value)}'${comma}`);
    });
    lines.push(`  })`);
  }
  
  if (body) {
    if (request.body.type === 'json') {
      lines.push(`  .send(${body})`);
    } else {
      lines.push(`  .send('${escape.singleQuote(body)}')`);
    }
  }
  
  lines.push(`  .end(function(res) {`);
  lines.push(`    if (res.error) throw new Error(res.error);`);
  lines.push(`    console.log(res.body);`);
  lines.push(`  });`);

  return lines.join('\n');
}

// ============== Python - Requests ==============
export function generatePythonRequests(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`import requests`);
  if (body && request.body.type === 'json') {
    lines.push(`import json`);
  }
  lines.push(``);
  lines.push(`url = "${escape.doubleQuote(url)}"`);
  
  if (Object.keys(headers).length > 0) {
    lines.push(``);
    lines.push(`headers = {`);
    Object.entries(headers).forEach(([key, value], index, arr) => {
      const comma = index < arr.length - 1 ? ',' : '';
      lines.push(`    "${key}": "${escape.doubleQuote(value)}"${comma}`);
    });
    lines.push(`}`);
  }
  
  if (body) {
    lines.push(``);
    if (request.body.type === 'json') {
      try {
        const parsed = JSON.parse(body);
        lines.push(`payload = ${JSON.stringify(parsed, null, 4).replace(/null/g, 'None').replace(/true/g, 'True').replace(/false/g, 'False')}`);
      } catch {
        lines.push(`payload = """${body}"""`);
      }
    } else {
      lines.push(`payload = "${escape.doubleQuote(body)}"`);
    }
  }
  
  lines.push(``);
  const hasHeaders = Object.keys(headers).length > 0;
  const hasBody = !!body;
  let callArgs = `url`;
  if (hasHeaders) callArgs += `, headers=headers`;
  if (hasBody) {
    if (request.body.type === 'json') {
      callArgs += `, json=payload`;
    } else {
      callArgs += `, data=payload`;
    }
  }
  
  lines.push(`response = requests.${request.method.toLowerCase()}(${callArgs})`);
  lines.push(``);
  lines.push(`print(response.status_code)`);
  lines.push(`print(response.json())`);

  return lines.join('\n');
}

// ============== Python - http.client ==============
export function generatePythonHttpClient(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);
  
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = new URL('http://localhost');
  }
  
  const isHttps = parsedUrl.protocol === 'https:';
  const path = parsedUrl.pathname + parsedUrl.search;

  const lines: string[] = [];
  lines.push(`import http.client`);
  if (body && request.body.type === 'json') {
    lines.push(`import json`);
  }
  lines.push(``);
  lines.push(`conn = http.client.${isHttps ? 'HTTPSConnection' : 'HTTPConnection'}("${parsedUrl.host}")`);
  lines.push(``);
  
  if (Object.keys(headers).length > 0) {
    lines.push(`headers = {`);
    Object.entries(headers).forEach(([key, value], index, arr) => {
      const comma = index < arr.length - 1 ? ',' : '';
      lines.push(`    "${key}": "${escape.doubleQuote(value)}"${comma}`);
    });
    lines.push(`}`);
    lines.push(``);
  }
  
  if (body) {
    if (request.body.type === 'json') {
      lines.push(`payload = json.dumps(${body})`);
    } else {
      lines.push(`payload = "${escape.doubleQuote(body)}"`);
    }
    lines.push(``);
  }
  
  const hasHeaders = Object.keys(headers).length > 0;
  const hasBody = !!body;
  let reqArgs = `"${request.method}", "${path}"`;
  if (hasBody) reqArgs += `, payload`;
  if (hasHeaders) reqArgs += `, headers`;
  
  lines.push(`conn.request(${reqArgs})`);
  lines.push(``);
  lines.push(`res = conn.getresponse()`);
  lines.push(`data = res.read()`);
  lines.push(``);
  lines.push(`print(data.decode("utf-8"))`);

  return lines.join('\n');
}

// ============== Go - Native ==============
export function generateGoNative(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`package main`);
  lines.push(``);
  lines.push(`import (`);
  lines.push(`	"fmt"`);
  lines.push(`	"io"`);
  lines.push(`	"net/http"`);
  if (body) {
    lines.push(`	"strings"`);
  }
  lines.push(`)`);
  lines.push(``);
  lines.push(`func main() {`);
  
  if (body) {
    lines.push(`	payload := strings.NewReader(\`${body}\`)`);
    lines.push(``);
    lines.push(`	req, err := http.NewRequest("${request.method}", "${escape.doubleQuote(url)}", payload)`);
  } else {
    lines.push(`	req, err := http.NewRequest("${request.method}", "${escape.doubleQuote(url)}", nil)`);
  }
  
  lines.push(`	if err != nil {`);
  lines.push(`		panic(err)`);
  lines.push(`	}`);
  lines.push(``);
  
  Object.entries(headers).forEach(([key, value]) => {
    lines.push(`	req.Header.Add("${key}", "${escape.doubleQuote(value)}")`);
  });
  
  lines.push(``);
  lines.push(`	client := &http.Client{}`);
  lines.push(`	res, err := client.Do(req)`);
  lines.push(`	if err != nil {`);
  lines.push(`		panic(err)`);
  lines.push(`	}`);
  lines.push(`	defer res.Body.Close()`);
  lines.push(``);
  lines.push(`	body, err := io.ReadAll(res.Body)`);
  lines.push(`	if err != nil {`);
  lines.push(`		panic(err)`);
  lines.push(`	}`);
  lines.push(``);
  lines.push(`	fmt.Println(string(body))`);
  lines.push(`}`);

  return lines.join('\n');
}

// ============== Java - OkHttp ==============
export function generateJavaOkHttp(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`OkHttpClient client = new OkHttpClient();`);
  lines.push(``);
  
  if (body) {
    const mediaType = request.body.type === 'json' ? 'application/json' : 'text/plain';
    lines.push(`MediaType mediaType = MediaType.parse("${mediaType}");`);
    lines.push(`RequestBody body = RequestBody.create(mediaType, "${escape.doubleQuote(body)}");`);
    lines.push(``);
  }
  
  lines.push(`Request request = new Request.Builder()`);
  lines.push(`  .url("${escape.doubleQuote(url)}")`);
  
  if (body) {
    lines.push(`  .${request.method.toLowerCase()}(body)`);
  } else if (request.method !== 'GET') {
    lines.push(`  .method("${request.method}", null)`);
  }
  
  Object.entries(headers).forEach(([key, value]) => {
    lines.push(`  .addHeader("${key}", "${escape.doubleQuote(value)}")`);
  });
  
  lines.push(`  .build();`);
  lines.push(``);
  lines.push(`Response response = client.newCall(request).execute();`);
  lines.push(`System.out.println(response.body().string());`);

  return lines.join('\n');
}

// ============== Java - Unirest ==============
export function generateJavaUnirest(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`HttpResponse<String> response = Unirest.${request.method.toLowerCase()}("${escape.doubleQuote(url)}")`);
  
  Object.entries(headers).forEach(([key, value]) => {
    lines.push(`  .header("${key}", "${escape.doubleQuote(value)}")`);
  });
  
  if (body) {
    lines.push(`  .body("${escape.doubleQuote(body)}")`);
  }
  
  lines.push(`  .asString();`);
  lines.push(``);
  lines.push(`System.out.println(response.getBody());`);

  return lines.join('\n');
}

// ============== C# - HttpClient ==============
export function generateCSharpHttpClient(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`using System.Net.Http;`);
  lines.push(``);
  lines.push(`var client = new HttpClient();`);
  lines.push(``);
  lines.push(`var request = new HttpRequestMessage(HttpMethod.${request.method.charAt(0) + request.method.slice(1).toLowerCase()}, "${escape.doubleQuote(url)}");`);
  
  Object.entries(headers).forEach(([key, value]) => {
    if (key.toLowerCase() !== 'content-type') {
      lines.push(`request.Headers.Add("${key}", "${escape.doubleQuote(value)}");`);
    }
  });
  
  if (body) {
    const contentType = headers['Content-Type'] || 'text/plain';
    lines.push(`request.Content = new StringContent("${escape.doubleQuote(body)}", System.Text.Encoding.UTF8, "${contentType}");`);
  }
  
  lines.push(``);
  lines.push(`var response = await client.SendAsync(request);`);
  lines.push(`var content = await response.Content.ReadAsStringAsync();`);
  lines.push(`Console.WriteLine(content);`);

  return lines.join('\n');
}

// ============== C# - RestSharp ==============
export function generateCSharpRestSharp(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`var client = new RestClient("${escape.doubleQuote(url)}");`);
  lines.push(`var request = new RestRequest(Method.${request.method});`);
  
  Object.entries(headers).forEach(([key, value]) => {
    lines.push(`request.AddHeader("${key}", "${escape.doubleQuote(value)}");`);
  });
  
  if (body) {
    if (request.body.type === 'json') {
      lines.push(`request.AddJsonBody("${escape.doubleQuote(body)}");`);
    } else {
      lines.push(`request.AddParameter("text/plain", "${escape.doubleQuote(body)}", ParameterType.RequestBody);`);
    }
  }
  
  lines.push(``);
  lines.push(`IRestResponse response = client.Execute(request);`);
  lines.push(`Console.WriteLine(response.Content);`);

  return lines.join('\n');
}

// ============== PHP - cURL ==============
export function generatePHPCurl(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`<?php`);
  lines.push(``);
  lines.push(`$curl = curl_init();`);
  lines.push(``);
  lines.push(`curl_setopt_array($curl, [`);
  lines.push(`  CURLOPT_URL => "${escape.doubleQuote(url)}",`);
  lines.push(`  CURLOPT_RETURNTRANSFER => true,`);
  lines.push(`  CURLOPT_CUSTOMREQUEST => "${request.method}",`);
  
  if (Object.keys(headers).length > 0) {
    lines.push(`  CURLOPT_HTTPHEADER => [`);
    Object.entries(headers).forEach(([key, value], index, arr) => {
      const comma = index < arr.length - 1 ? ',' : '';
      lines.push(`    "${key}: ${escape.doubleQuote(value)}"${comma}`);
    });
    lines.push(`  ],`);
  }
  
  if (body) {
    lines.push(`  CURLOPT_POSTFIELDS => '${escape.singleQuote(body)}',`);
  }
  
  lines.push(`]);`);
  lines.push(``);
  lines.push(`$response = curl_exec($curl);`);
  lines.push(`$err = curl_error($curl);`);
  lines.push(``);
  lines.push(`curl_close($curl);`);
  lines.push(``);
  lines.push(`if ($err) {`);
  lines.push(`  echo "cURL Error: " . $err;`);
  lines.push(`} else {`);
  lines.push(`  echo $response;`);
  lines.push(`}`);

  return lines.join('\n');
}

// ============== PHP - Guzzle ==============
export function generatePHPGuzzle(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`<?php`);
  lines.push(`require_once 'vendor/autoload.php';`);
  lines.push(``);
  lines.push(`$client = new \\GuzzleHttp\\Client();`);
  lines.push(``);
  lines.push(`$response = $client->request('${request.method}', '${escape.singleQuote(url)}', [`);
  
  if (Object.keys(headers).length > 0) {
    lines.push(`  'headers' => [`);
    Object.entries(headers).forEach(([key, value], index, arr) => {
      const comma = index < arr.length - 1 ? ',' : '';
      lines.push(`    '${key}' => '${escape.singleQuote(value)}'${comma}`);
    });
    lines.push(`  ],`);
  }
  
  if (body) {
    if (request.body.type === 'json') {
      lines.push(`  'json' => ${body},`);
    } else {
      lines.push(`  'body' => '${escape.singleQuote(body)}',`);
    }
  }
  
  lines.push(`]);`);
  lines.push(``);
  lines.push(`echo $response->getBody();`);

  return lines.join('\n');
}

// ============== Ruby - Net::HTTP ==============
export function generateRubyNetHttp(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`require 'net/http'`);
  lines.push(`require 'uri'`);
  if (body && request.body.type === 'json') {
    lines.push(`require 'json'`);
  }
  lines.push(``);
  lines.push(`uri = URI.parse("${escape.doubleQuote(url)}")`);
  lines.push(``);
  lines.push(`http = Net::HTTP.new(uri.host, uri.port)`);
  lines.push(`http.use_ssl = uri.scheme == 'https'`);
  lines.push(``);
  lines.push(`request = Net::HTTP::${request.method.charAt(0) + request.method.slice(1).toLowerCase()}.new(uri.request_uri)`);
  
  Object.entries(headers).forEach(([key, value]) => {
    lines.push(`request["${key}"] = "${escape.doubleQuote(value)}"`);
  });
  
  if (body) {
    lines.push(`request.body = '${escape.singleQuote(body)}'`);
  }
  
  lines.push(``);
  lines.push(`response = http.request(request)`);
  lines.push(`puts response.body`);

  return lines.join('\n');
}

// ============== Rust - reqwest ==============
export function generateRustReqwest(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`use reqwest;`);
  lines.push(``);
  lines.push(`#[tokio::main]`);
  lines.push(`async fn main() -> Result<(), Box<dyn std::error::Error>> {`);
  lines.push(`    let client = reqwest::Client::new();`);
  lines.push(``);
  lines.push(`    let response = client`);
  lines.push(`        .${request.method.toLowerCase()}("${escape.doubleQuote(url)}")`);
  
  Object.entries(headers).forEach(([key, value]) => {
    lines.push(`        .header("${key}", "${escape.doubleQuote(value)}")`);
  });
  
  if (body) {
    lines.push(`        .body("${escape.doubleQuote(body)}")`);
  }
  
  lines.push(`        .send()`);
  lines.push(`        .await?;`);
  lines.push(``);
  lines.push(`    let body = response.text().await?;`);
  lines.push(`    println!("{}", body);`);
  lines.push(``);
  lines.push(`    Ok(())`);
  lines.push(`}`);

  return lines.join('\n');
}

// ============== Swift - URLSession ==============
export function generateSwiftURLSession(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`import Foundation`);
  lines.push(``);
  lines.push(`let url = URL(string: "${escape.doubleQuote(url)}")!`);
  lines.push(`var request = URLRequest(url: url)`);
  lines.push(`request.httpMethod = "${request.method}"`);
  
  Object.entries(headers).forEach(([key, value]) => {
    lines.push(`request.setValue("${escape.doubleQuote(value)}", forHTTPHeaderField: "${key}")`);
  });
  
  if (body) {
    lines.push(`request.httpBody = "${escape.doubleQuote(body)}".data(using: .utf8)`);
  }
  
  lines.push(``);
  lines.push(`let task = URLSession.shared.dataTask(with: request) { data, response, error in`);
  lines.push(`    if let error = error {`);
  lines.push(`        print("Error: \\(error)")`);
  lines.push(`        return`);
  lines.push(`    }`);
  lines.push(`    if let data = data, let string = String(data: data, encoding: .utf8) {`);
  lines.push(`        print(string)`);
  lines.push(`    }`);
  lines.push(`}`);
  lines.push(`task.resume()`);

  return lines.join('\n');
}

// ============== Kotlin - OkHttp ==============
export function generateKotlinOkHttp(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`val client = OkHttpClient()`);
  lines.push(``);
  
  if (body) {
    const mediaType = request.body.type === 'json' ? 'application/json' : 'text/plain';
    lines.push(`val mediaType = "${mediaType}".toMediaType()`);
    lines.push(`val body = "${escape.doubleQuote(body)}".toRequestBody(mediaType)`);
    lines.push(``);
  }
  
  lines.push(`val request = Request.Builder()`);
  lines.push(`    .url("${escape.doubleQuote(url)}")`);
  
  if (body) {
    lines.push(`    .${request.method.toLowerCase()}(body)`);
  } else if (request.method !== 'GET') {
    lines.push(`    .method("${request.method}", null)`);
  }
  
  Object.entries(headers).forEach(([key, value]) => {
    lines.push(`    .addHeader("${key}", "${escape.doubleQuote(value)}")`);
  });
  
  lines.push(`    .build()`);
  lines.push(``);
  lines.push(`val response = client.newCall(request).execute()`);
  lines.push(`println(response.body?.string())`);

  return lines.join('\n');
}

// ============== Dart - http ==============
export function generateDartHttp(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`import 'package:http/http.dart' as http;`);
  lines.push(``);
  lines.push(`void main() async {`);
  
  if (Object.keys(headers).length > 0) {
    lines.push(`  var headers = {`);
    Object.entries(headers).forEach(([key, value], index, arr) => {
      const comma = index < arr.length - 1 ? ',' : '';
      lines.push(`    '${key}': '${escape.singleQuote(value)}'${comma}`);
    });
    lines.push(`  };`);
    lines.push(``);
  }
  
  const hasHeaders = Object.keys(headers).length > 0;
  const hasBody = !!body;
  
  let methodCall = `http.${request.method.toLowerCase()}`;
  if (request.method === 'DELETE') {
    methodCall = `http.delete`;
  }
  
  lines.push(`  var response = await ${methodCall}(`);
  lines.push(`    Uri.parse('${escape.singleQuote(url)}'),`);
  if (hasHeaders) {
    lines.push(`    headers: headers,`);
  }
  if (hasBody) {
    lines.push(`    body: '${escape.singleQuote(body)}',`);
  }
  lines.push(`  );`);
  lines.push(``);
  lines.push(`  print(response.statusCode);`);
  lines.push(`  print(response.body);`);
  lines.push(`}`);

  return lines.join('\n');
}

// ============== Dart - dio ==============
export function generateDartDio(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`import 'package:dio/dio.dart';`);
  lines.push(``);
  lines.push(`void main() async {`);
  lines.push(`  var dio = Dio();`);
  lines.push(``);
  
  if (Object.keys(headers).length > 0) {
    lines.push(`  dio.options.headers = {`);
    Object.entries(headers).forEach(([key, value], index, arr) => {
      const comma = index < arr.length - 1 ? ',' : '';
      lines.push(`    '${key}': '${escape.singleQuote(value)}'${comma}`);
    });
    lines.push(`  };`);
    lines.push(``);
  }
  
  let methodCall = request.method.toLowerCase();
  let args = `'${escape.singleQuote(url)}'`;
  
  if (body) {
    if (request.body.type === 'json') {
      args += `, data: ${body}`;
    } else {
      args += `, data: '${escape.singleQuote(body)}'`;
    }
  }
  
  lines.push(`  var response = await dio.${methodCall}(${args});`);
  lines.push(``);
  lines.push(`  print(response.statusCode);`);
  lines.push(`  print(response.data);`);
  lines.push(`}`);

  return lines.join('\n');
}

// ============== Shell - wget ==============
export function generateShellWget(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const parts: string[] = ['wget'];
  parts.push(`--method=${request.method}`);
  parts.push(`-O -`);
  
  Object.entries(headers).forEach(([key, value]) => {
    parts.push(`--header='${key}: ${escape.singleQuote(value)}'`);
  });
  
  if (body) {
    parts.push(`--body-data='${escape.singleQuote(body)}'`);
  }
  
  parts.push(`'${url}'`);

  return parts.join(' \\\n  ');
}

// ============== Shell - HTTPie ==============
export function generateShellHttpie(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const parts: string[] = ['http'];
  parts.push(request.method);
  parts.push(`'${url}'`);
  
  Object.entries(headers).forEach(([key, value]) => {
    parts.push(`'${key}:${escape.singleQuote(value)}'`);
  });
  
  if (body && request.body.type === 'json') {
    try {
      const parsed = JSON.parse(body);
      Object.entries(parsed).forEach(([key, value]) => {
        if (typeof value === 'string') {
          parts.push(`${key}='${escape.singleQuote(value)}'`);
        } else {
          parts.push(`${key}:=${JSON.stringify(value)}`);
        }
      });
    } catch {
      parts.push(`--raw='${escape.singleQuote(body)}'`);
    }
  } else if (body) {
    parts.push(`--raw='${escape.singleQuote(body)}'`);
  }

  return parts.join(' \\\n  ');
}

// ============== C - libcurl ==============
export function generateCLibcurl(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`#include <stdio.h>`);
  lines.push(`#include <curl/curl.h>`);
  lines.push(``);
  lines.push(`int main(void) {`);
  lines.push(`    CURL *curl;`);
  lines.push(`    CURLcode res;`);
  lines.push(``);
  lines.push(`    curl = curl_easy_init();`);
  lines.push(`    if(curl) {`);
  lines.push(`        curl_easy_setopt(curl, CURLOPT_URL, "${escape.doubleQuote(url)}");`);
  
  if (request.method !== 'GET') {
    lines.push(`        curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "${request.method}");`);
  }
  
  if (Object.keys(headers).length > 0) {
    lines.push(``);
    lines.push(`        struct curl_slist *headers = NULL;`);
    Object.entries(headers).forEach(([key, value]) => {
      lines.push(`        headers = curl_slist_append(headers, "${key}: ${escape.doubleQuote(value)}");`);
    });
    lines.push(`        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);`);
  }
  
  if (body) {
    lines.push(``);
    lines.push(`        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, "${escape.doubleQuote(body)}");`);
  }
  
  lines.push(``);
  lines.push(`        res = curl_easy_perform(curl);`);
  lines.push(`        if(res != CURLE_OK)`);
  lines.push(`            fprintf(stderr, "curl_easy_perform() failed: %s\\n", curl_easy_strerror(res));`);
  lines.push(``);
  lines.push(`        curl_easy_cleanup(curl);`);
  lines.push(`    }`);
  lines.push(`    return 0;`);
  lines.push(`}`);

  return lines.join('\n');
}

// ============== R - httr ==============
export function generateRHttr(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`library(httr)`);
  lines.push(``);
  
  let methodCall = request.method;
  let args = [`"${escape.doubleQuote(url)}"`];
  
  if (Object.keys(headers).length > 0) {
    const headerArgs = Object.entries(headers)
      .map(([key, value]) => `"${key}" = "${escape.doubleQuote(value)}"`)
      .join(', ');
    args.push(`add_headers(${headerArgs})`);
  }
  
  if (body) {
    args.push(`body = "${escape.doubleQuote(body)}"`);
  }
  
  lines.push(`response <- ${methodCall}(${args.join(', ')})`);
  lines.push(``);
  lines.push(`print(status_code(response))`);
  lines.push(`print(content(response, "text"))`);

  return lines.join('\n');
}

// ============== R - RCurl ==============
export function generateRRCurl(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`library(RCurl)`);
  lines.push(``);
  
  if (Object.keys(headers).length > 0) {
    lines.push(`headers <- c(`);
    Object.entries(headers).forEach(([key, value], index, arr) => {
      const comma = index < arr.length - 1 ? ',' : '';
      lines.push(`  "${key}" = "${escape.doubleQuote(value)}"${comma}`);
    });
    lines.push(`)`);
    lines.push(``);
  }
  
  let args = [`url = "${escape.doubleQuote(url)}"`];
  args.push(`customrequest = "${request.method}"`);
  
  if (Object.keys(headers).length > 0) {
    args.push(`httpheader = headers`);
  }
  
  if (body) {
    args.push(`postfields = "${escape.doubleQuote(body)}"`);
  }
  
  lines.push(`response <- getURL(${args.join(', ')})`);
  lines.push(`print(response)`);

  return lines.join('\n');
}

// ============== Objective-C - NSURLSession ==============
export function generateObjectiveCNSURLSession(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`#import <Foundation/Foundation.h>`);
  lines.push(``);
  lines.push(`NSURL *url = [NSURL URLWithString:@"${escape.doubleQuote(url)}"];`);
  lines.push(`NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];`);
  lines.push(`[request setHTTPMethod:@"${request.method}"];`);
  
  Object.entries(headers).forEach(([key, value]) => {
    lines.push(`[request setValue:@"${escape.doubleQuote(value)}" forHTTPHeaderField:@"${key}"];`);
  });
  
  if (body) {
    lines.push(`[request setHTTPBody:[@"${escape.doubleQuote(body)}" dataUsingEncoding:NSUTF8StringEncoding]];`);
  }
  
  lines.push(``);
  lines.push(`NSURLSession *session = [NSURLSession sharedSession];`);
  lines.push(`NSURLSessionDataTask *task = [session dataTaskWithRequest:request`);
  lines.push(`    completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {`);
  lines.push(`        if (error) {`);
  lines.push(`            NSLog(@"Error: %@", error);`);
  lines.push(`            return;`);
  lines.push(`        }`);
  lines.push(`        NSString *result = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];`);
  lines.push(`        NSLog(@"%@", result);`);
  lines.push(`    }];`);
  lines.push(`[task resume];`);

  return lines.join('\n');
}

// ============== OCaml - Cohttp ==============
export function generateOCamlCohttp(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`open Lwt`);
  lines.push(`open Cohttp`);
  lines.push(`open Cohttp_lwt_unix`);
  lines.push(``);
  lines.push(`let () =`);
  lines.push(`  let uri = Uri.of_string "${escape.doubleQuote(url)}" in`);
  
  if (Object.keys(headers).length > 0) {
    lines.push(`  let headers = Header.of_list [`);
    Object.entries(headers).forEach(([key, value], index, arr) => {
      const semicolon = index < arr.length - 1 ? ';' : '';
      lines.push(`    ("${key}", "${escape.doubleQuote(value)}")${semicolon}`);
    });
    lines.push(`  ] in`);
  }
  
  if (body) {
    lines.push(`  let body = Cohttp_lwt.Body.of_string "${escape.doubleQuote(body)}" in`);
  }
  
  const method = request.method.charAt(0) + request.method.slice(1).toLowerCase();
  let args = `uri`;
  if (Object.keys(headers).length > 0) {
    args = `~headers ${args}`;
  }
  if (body) {
    args = `~body ${args}`;
  }
  
  lines.push(`  Lwt_main.run (`);
  lines.push(`    Client.${method.toLowerCase()} ${args} >>= fun (resp, body) ->`);
  lines.push(`    Cohttp_lwt.Body.to_string body >>= fun body_str ->`);
  lines.push(`    Lwt_io.printl body_str`);
  lines.push(`  )`);

  return lines.join('\n');
}

// ============== PHP - HTTP_Request2 ==============
export function generatePHPHttpRequest2(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`<?php`);
  lines.push(`require_once 'HTTP/Request2.php';`);
  lines.push(``);
  lines.push(`$request = new HTTP_Request2();`);
  lines.push(`$request->setUrl('${escape.singleQuote(url)}');`);
  lines.push(`$request->setMethod(HTTP_Request2::METHOD_${request.method});`);
  
  if (Object.keys(headers).length > 0) {
    lines.push(`$request->setHeader([`);
    Object.entries(headers).forEach(([key, value], index, arr) => {
      const comma = index < arr.length - 1 ? ',' : '';
      lines.push(`  '${key}' => '${escape.singleQuote(value)}'${comma}`);
    });
    lines.push(`]);`);
  }
  
  if (body) {
    lines.push(`$request->setBody('${escape.singleQuote(body)}');`);
  }
  
  lines.push(``);
  lines.push(`try {`);
  lines.push(`  $response = $request->send();`);
  lines.push(`  echo $response->getBody();`);
  lines.push(`} catch (HTTP_Request2_Exception $e) {`);
  lines.push(`  echo 'Error: ' . $e->getMessage();`);
  lines.push(`}`);

  return lines.join('\n');
}

// ============== PHP - pecl_http ==============
export function generatePHPPeclHttp(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);

  const lines: string[] = [];
  lines.push(`<?php`);
  lines.push(``);
  lines.push(`$client = new http\\Client;`);
  lines.push(`$request = new http\\Client\\Request;`);
  lines.push(``);
  lines.push(`$request->setRequestUrl('${escape.singleQuote(url)}');`);
  lines.push(`$request->setRequestMethod('${request.method}');`);
  
  if (Object.keys(headers).length > 0) {
    lines.push(`$request->setHeaders([`);
    Object.entries(headers).forEach(([key, value], index, arr) => {
      const comma = index < arr.length - 1 ? ',' : '';
      lines.push(`  '${key}' => '${escape.singleQuote(value)}'${comma}`);
    });
    lines.push(`]);`);
  }
  
  if (body) {
    lines.push(``);
    lines.push(`$body = new http\\Message\\Body;`);
    lines.push(`$body->append('${escape.singleQuote(body)}');`);
    lines.push(`$request->setBody($body);`);
  }
  
  lines.push(``);
  lines.push(`$client->enqueue($request)->send();`);
  lines.push(`$response = $client->getResponse();`);
  lines.push(``);
  lines.push(`echo $response->getBody();`);

  return lines.join('\n');
}

// ============== HTTP (raw) ==============
export function generateHTTPRaw(request: Request, environment: Environment | null = null, collection: Collection | null = null): string {
  const interpolate = (text: string) => interpolateAll(text, environment, request.pathParams, collection);
  const url = buildUrl(request, interpolate);
  const headers = buildHeaders(request, interpolate, collection);
  const body = buildBody(request, interpolate);
  
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = new URL('http://localhost');
  }
  
  const path = parsedUrl.pathname + parsedUrl.search || '/';

  const lines: string[] = [];
  lines.push(`${request.method} ${path} HTTP/1.1`);
  lines.push(`Host: ${parsedUrl.host}`);
  
  Object.entries(headers).forEach(([key, value]) => {
    lines.push(`${key}: ${value}`);
  });
  
  if (body) {
    lines.push(`Content-Length: ${body.length}`);
    lines.push(``);
    lines.push(body);
  }

  return lines.join('\n');
}

// Code format definitions
export interface CodeFormat {
  id: string;
  name: string;
  language: string;
  aceMode: string;
  generator: (request: Request, environment: Environment | null, collection: Collection | null) => string;
}

export const CODE_FORMATS: CodeFormat[] = [
  // Shell / cURL
  { id: 'curl', name: 'cURL', language: 'Shell', aceMode: 'sh', generator: generateCurl },
  { id: 'httpie', name: 'Shell - HTTPie', language: 'Shell', aceMode: 'sh', generator: generateShellHttpie },
  { id: 'wget', name: 'Shell - wget', language: 'Shell', aceMode: 'sh', generator: generateShellWget },
  
  // JavaScript
  { id: 'fetch', name: 'JavaScript - Fetch', language: 'JavaScript', aceMode: 'javascript', generator: generateJavaScriptFetch },
  { id: 'jquery', name: 'JavaScript - jQuery', language: 'JavaScript', aceMode: 'javascript', generator: generateJavaScriptJQuery },
  { id: 'xhr', name: 'JavaScript - XHR', language: 'JavaScript', aceMode: 'javascript', generator: generateJavaScriptXHR },
  
  // Node.js
  { id: 'node-axios', name: 'Node.js - Axios', language: 'JavaScript', aceMode: 'javascript', generator: generateNodeAxios },
  { id: 'node-native', name: 'Node.js - Native', language: 'JavaScript', aceMode: 'javascript', generator: generateNodeNative },
  { id: 'node-request', name: 'Node.js - Request', language: 'JavaScript', aceMode: 'javascript', generator: generateNodeRequest },
  { id: 'node-unirest', name: 'Node.js - Unirest', language: 'JavaScript', aceMode: 'javascript', generator: generateNodeUnirest },
  
  // Python
  { id: 'python-requests', name: 'Python - Requests', language: 'Python', aceMode: 'python', generator: generatePythonRequests },
  { id: 'python-http', name: 'Python - http.client', language: 'Python', aceMode: 'python', generator: generatePythonHttpClient },
  
  // Go
  { id: 'go', name: 'Go - Native', language: 'Go', aceMode: 'golang', generator: generateGoNative },
  
  // Java
  { id: 'java-okhttp', name: 'Java - OkHttp', language: 'Java', aceMode: 'java', generator: generateJavaOkHttp },
  { id: 'java-unirest', name: 'Java - Unirest', language: 'Java', aceMode: 'java', generator: generateJavaUnirest },
  
  // Kotlin
  { id: 'kotlin-okhttp', name: 'Kotlin - OkHttp', language: 'Kotlin', aceMode: 'kotlin', generator: generateKotlinOkHttp },
  
  // C#
  { id: 'csharp-httpclient', name: 'C# - HttpClient', language: 'C#', aceMode: 'csharp', generator: generateCSharpHttpClient },
  { id: 'csharp-restsharp', name: 'C# - RestSharp', language: 'C#', aceMode: 'csharp', generator: generateCSharpRestSharp },
  
  // PHP
  { id: 'php-curl', name: 'PHP - cURL', language: 'PHP', aceMode: 'php', generator: generatePHPCurl },
  { id: 'php-guzzle', name: 'PHP - Guzzle', language: 'PHP', aceMode: 'php', generator: generatePHPGuzzle },
  { id: 'php-http-request2', name: 'PHP - HTTP_Request2', language: 'PHP', aceMode: 'php', generator: generatePHPHttpRequest2 },
  { id: 'php-pecl-http', name: 'PHP - pecl_http', language: 'PHP', aceMode: 'php', generator: generatePHPPeclHttp },
  
  // Ruby
  { id: 'ruby-net-http', name: 'Ruby - Net::HTTP', language: 'Ruby', aceMode: 'ruby', generator: generateRubyNetHttp },
  
  // Rust
  { id: 'rust-reqwest', name: 'Rust - reqwest', language: 'Rust', aceMode: 'rust', generator: generateRustReqwest },
  
  // Swift
  { id: 'swift-urlsession', name: 'Swift - URLSession', language: 'Swift', aceMode: 'swift', generator: generateSwiftURLSession },
  
  // Dart
  { id: 'dart-http', name: 'Dart - http', language: 'Dart', aceMode: 'dart', generator: generateDartHttp },
  { id: 'dart-dio', name: 'Dart - dio', language: 'Dart', aceMode: 'dart', generator: generateDartDio },
  
  // C
  { id: 'c-libcurl', name: 'C - libcurl', language: 'C', aceMode: 'c_cpp', generator: generateCLibcurl },
  
  // R
  { id: 'r-httr', name: 'R - httr', language: 'R', aceMode: 'r', generator: generateRHttr },
  { id: 'r-rcurl', name: 'R - RCurl', language: 'R', aceMode: 'r', generator: generateRRCurl },
  
  // Objective-C
  { id: 'objc-nsurlsession', name: 'Objective-C - NSURLSession', language: 'Objective-C', aceMode: 'objectivec', generator: generateObjectiveCNSURLSession },
  
  // OCaml
  { id: 'ocaml-cohttp', name: 'OCaml - Cohttp', language: 'OCaml', aceMode: 'ocaml', generator: generateOCamlCohttp },
  
  // HTTP Raw
  { id: 'http', name: 'HTTP', language: 'HTTP', aceMode: 'text', generator: generateHTTPRaw },
];

// Export for backwards compatibility
export const generateCurlCommand = generateCurl;
export const generateFetchCode = generateJavaScriptFetch;

