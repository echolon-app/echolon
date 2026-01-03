import { Request, Response, RequestExecution, Environment, ResponseTiming, SizeBreakdown, NetworkInfo, Collection, AuthConfig, AppSettings, CollectionEnvironment, ScriptOutput, ScriptsOutput, KeyValuePair } from '@/types';
import { v4 as uuidv4 } from 'uuid';
import { SAMPLE_REQUEST } from '../../shared/constants';
import { isElectron } from '@/utils';
import { APP_VERSION } from '@/utils/environment';

interface HttpRequestOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
  timeout?: number;
  sendUserAgent?: boolean;
}

// Get CORS proxy from localStorage (set by WebModeContext)
function getCorsProxy(): string {
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem('echolon_cors_proxy') || '';
  }
  return '';
}

interface HttpResponseResult {
  success: boolean;
  status?: number;
  statusText?: string;
  headers?: Array<{ key: string; value: string }>;
  body?: string;
  size?: number;
  duration: number;
  timing?: ResponseTiming;
  sizeBreakdown?: SizeBreakdown;
  requestSize?: SizeBreakdown;
  networkInfo?: NetworkInfo;
  error?: string;
  errorCode?: string;
}

export class RequestService {
  private static instance: RequestService;

  private constructor() {}

  static getInstance(): RequestService {
    if (!RequestService.instance) {
      RequestService.instance = new RequestService();
    }
    return RequestService.instance;
  }

  // Replace {{variables}} and :pathParams with actual values
  // Collection environment variables have priority over global environment variables
  private interpolateVariables(
    text: string, 
    environment: Environment | null, 
    collectionEnv?: CollectionEnvironment | null,
    pathParams?: KeyValuePair[]
  ): string {
    if (!text) return text;
    
    let result = text;

    // First, interpolate environment variables {{var}}
    if (environment || collectionEnv) {
      result = result.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
      const trimmedName = varName.trim();
      
      // Check collection environment first (higher priority)
      if (collectionEnv) {
        const collVar = collectionEnv.variables.find(
          v => v.key === trimmedName && v.enabled
        );
        if (collVar) return collVar.value;
      }
      
      // Fall back to global environment
      if (environment) {
        const globalVar = environment.variables.find(
          v => v.key === trimmedName && v.enabled
        );
        if (globalVar) return globalVar.value;
      }
      
      return match; // Keep original if not found
    });
    }
    
    // Then, interpolate path parameters :param
    if (pathParams && pathParams.length > 0) {
      result = result.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, paramName) => {
        const param = pathParams.find(p => p.key === paramName);
        return param && param.value ? param.value : match;
      });
    }
    
    return result;
  }

  // Get effective auth (request auth takes precedence over collection auth)
  private getEffectiveAuth(request: Request, collection: Collection | null): AuthConfig {
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

  // Prepare headers as a Record
  private prepareHeaders(
    request: Request, 
    environment: Environment | null, 
    collection: Collection | null,
    collectionEnv?: CollectionEnvironment | null
  ): Record<string, string> {
    const headers: Record<string, string> = {};

    // First, add collection-level headers (these can be overridden by request headers)
    if (collection?.headers) {
      collection.headers
        .filter(h => h.enabled && h.key)
        .forEach(h => {
          headers[this.interpolateVariables(h.key, environment, collectionEnv)] = 
            this.interpolateVariables(h.value, environment, collectionEnv);
        });
    }

    // Add request-level headers (these override collection headers)
    request.headers
      .filter(h => h.enabled && h.key)
      .forEach(h => {
        headers[this.interpolateVariables(h.key, environment, collectionEnv)] = 
          this.interpolateVariables(h.value, environment, collectionEnv);
      });

    // Get effective auth (request overrides collection)
    const auth = this.getEffectiveAuth(request, collection);

    // Add auth headers based on auth type
    if (auth.type === 'basic' && auth.basic) {
      const credentials = btoa(
        `${this.interpolateVariables(auth.basic.username, environment, collectionEnv)}:${this.interpolateVariables(auth.basic.password, environment, collectionEnv)}`
      );
      headers['Authorization'] = `Basic ${credentials}`;
    } else if (auth.type === 'bearer' && auth.bearer) {
      headers['Authorization'] = `Bearer ${this.interpolateVariables(auth.bearer.token, environment, collectionEnv)}`;
    } else if (auth.type === 'api-key' && auth.apiKey && auth.apiKey.addTo === 'header') {
      headers[this.interpolateVariables(auth.apiKey.key, environment, collectionEnv)] = 
        this.interpolateVariables(auth.apiKey.value, environment, collectionEnv);
    } else if (auth.type === 'oauth2' && auth.oauth2?.accessToken) {
      const tokenType = auth.oauth2.tokenType || 'Bearer';
      headers['Authorization'] = `${tokenType} ${this.interpolateVariables(auth.oauth2.accessToken, environment, collectionEnv)}`;
    } else if (auth.type === 'jwt' && auth.jwt?.token) {
      const prefix = auth.jwt.prefix || 'Bearer';
      const headerName = auth.jwt.headerName || 'Authorization';
      headers[headerName] = `${prefix} ${this.interpolateVariables(auth.jwt.token, environment, collectionEnv)}`;
    } else if (auth.type === 'digest' && auth.digest) {
      // Digest auth typically requires a challenge-response flow
      // For simplicity, we pre-calculate if nonce is provided
      // Full digest auth would require making a request first to get the nonce
      if (auth.digest.nonce) {
        const digestHeader = this.buildDigestAuthHeader(auth.digest, request.method, request.url, environment, collectionEnv);
        if (digestHeader) {
          headers['Authorization'] = digestHeader;
        }
      }
    } else if (auth.type === 'aws-signature' && auth.awsSignature) {
      // AWS Signature Version 4 requires signing the request
      // This is a simplified implementation - full AWS Sig V4 is more complex
      const awsHeaders = this.buildAwsSignatureHeaders(
        auth.awsSignature,
        request.method,
        request.url,
        headers,
        environment,
        collectionEnv
      );
      Object.assign(headers, awsHeaders);
    }

    return headers;
  }

  // Build URL with query parameters
  private buildUrl(
    request: Request, 
    environment: Environment | null, 
    collection: Collection | null,
    collectionEnv?: CollectionEnvironment | null
  ): string {
    let url = this.interpolateVariables(request.url, environment, collectionEnv, request.pathParams);

    // Ensure URL has protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    const urlObj = new URL(url);

    // Add enabled query parameters
    request.queryParams
      .filter(p => p.enabled && p.key)
      .forEach(p => {
        urlObj.searchParams.set(
          this.interpolateVariables(p.key, environment, collectionEnv),
          this.interpolateVariables(p.value, environment, collectionEnv)
        );
      });

    // Get effective auth (request overrides collection)
    const auth = this.getEffectiveAuth(request, collection);

    // Add API key if configured for query
    if (auth.type === 'api-key' && auth.apiKey && auth.apiKey.addTo === 'query') {
      urlObj.searchParams.set(
        this.interpolateVariables(auth.apiKey.key, environment, collectionEnv),
        this.interpolateVariables(auth.apiKey.value, environment, collectionEnv)
      );
    }

    return urlObj.toString();
  }

  // Execute a script and capture its output
  // Uses IPC to run in main process (bypasses CSP) when in Electron

  private async executeScript(
    script: string,
    context: {
      request: { url: string; method: string; headers: Record<string, string>; body?: string | null };
      response?: { status: number; statusText: string; headers: Record<string, string>; body: string; responseTime: number };
      envVars: Record<string, string>;
      runtimeVars: Record<string, string>;
    }
  ): Promise<{ output: ScriptOutput; envVars: Record<string, string>; runtimeVars: Record<string, string> }> {
    if (!script || script.trim() === '') {
      return { 
        output: { logs: [], duration: 0 },
        envVars: context.envVars,
        runtimeVars: context.runtimeVars
      };
    }

    // In Electron, use IPC to execute script in main process (bypasses CSP)
    if (isElectron()) {
      const result = await window.electronAPI.executeScript({
        script,
        context: {
          request: context.request,
          response: context.response,
          envVars: context.envVars,
          runtimeVars: context.runtimeVars,
        },
      });

      return {
        output: {
          logs: result.logs,
          error: result.error,
          duration: result.duration,
        },
        envVars: result.envVars,
        runtimeVars: result.runtimeVars,
      };
    }

    // Fallback for web mode - scripts not supported due to CSP
    return {
      output: {
        logs: [{
          type: 'warn',
          args: ['Scripts are not supported in web mode due to browser security restrictions.'],
          timestamp: Date.now(),
        }],
        duration: 0,
      },
      envVars: context.envVars,
      runtimeVars: context.runtimeVars,
    };
  }

  // Prepare request body
  private prepareBody(
    request: Request, 
    environment: Environment | null, 
    headers: Record<string, string>,
    collectionEnv?: CollectionEnvironment | null
  ): string | null {
    if (['GET', 'HEAD'].includes(request.method)) {
      return null;
    }

    switch (request.body.type) {
      case 'json':
        if (!headers['Content-Type']) {
          headers['Content-Type'] = 'application/json';
        }
        return this.interpolateVariables(request.body.content, environment, collectionEnv);

      case 'raw':
        return this.interpolateVariables(request.body.content, environment, collectionEnv);

      case 'x-www-form-urlencoded':
        if (!headers['Content-Type']) {
          headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        const params = new URLSearchParams();
        request.body.formData
          ?.filter(f => f.enabled && f.key)
          .forEach(f => {
            params.set(
              this.interpolateVariables(f.key, environment, collectionEnv),
              this.interpolateVariables(f.value, environment, collectionEnv)
            );
          });
        return params.toString();

      case 'form-data':
        // For form-data, we need to handle it differently
        // For now, convert to URL-encoded
        if (!headers['Content-Type']) {
          headers['Content-Type'] = 'multipart/form-data';
        }
        const formParams = new URLSearchParams();
        request.body.formData
          ?.filter(f => f.enabled && f.key)
          .forEach(f => {
            formParams.set(
              this.interpolateVariables(f.key, environment, collectionEnv),
              this.interpolateVariables(f.value, environment, collectionEnv)
            );
          });
        return formParams.toString();

      default:
        return null;
    }
  }

  // Execute HTTP request via Node.js (through IPC) or fallback to fetch
  async execute(
    request: Request,
    environment: Environment | null,
    timeout: number = 30000,
    collection: Collection | null = null,
    settings?: Partial<AppSettings>,
    collectionEnvironment?: CollectionEnvironment | null,
    corsProxy?: string
  ): Promise<RequestExecution> {
    const startTime = Date.now();
    const executionId = uuidv4();
    const sendUserAgent = settings?.sendUserAgent ?? true; // Default to true
    
    // Track script outputs
    const scriptsOutput: ScriptsOutput = {};
    
    // Create runtime stores for script-set variables
    // Build initial env vars from environments
    let envVars: Record<string, string> = {};
    let runtimeVars: Record<string, string> = {};
    
    // Populate env vars from collection environment
    if (collectionEnvironment) {
      collectionEnvironment.variables
        .filter(v => v.enabled)
        .forEach(v => { envVars[v.key] = v.value; });
    }
    // Populate env vars from global environment (lower priority)
    if (environment) {
      environment.variables
        .filter(v => v.enabled)
        .forEach(v => { 
          if (!(v.key in envVars)) {
            envVars[v.key] = v.value; 
          }
        });
    }

    try {
      const headers = this.prepareHeaders(request, environment, collection, collectionEnvironment);
      const url = this.buildUrl(request, environment, collection, collectionEnvironment);
      const body = this.prepareBody(request, environment, headers, collectionEnvironment);

      // Execute pre-request script if defined
      if (request.scripts.pre && request.scripts.pre.trim()) {
        const preResult = await this.executeScript(request.scripts.pre, {
          request: { url, method: request.method, headers, body },
          envVars,
          runtimeVars,
        });
        scriptsOutput.pre = preResult.output;
        envVars = preResult.envVars;
        runtimeVars = preResult.runtimeVars;
      }

      let result: HttpResponseResult;

      if (isElectron()) {
        // Use IPC to make the request via Node.js (bypasses CORS)
        const options: HttpRequestOptions = {
          method: request.method,
          url,
          headers,
          body,
          timeout,
          sendUserAgent,
        };
        result = await window.electronAPI.makeHttpRequest(options);
      } else {
        // Fallback to browser fetch (may have CORS issues)
        // Get CORS proxy from settings or localStorage
        const effectiveCorsProxy = corsProxy ?? getCorsProxy();
        result = await this.browserFetch(request.method, url, headers, body, timeout, sendUserAgent, effectiveCorsProxy);
      }

      if (!result.success) {
        return {
          id: executionId,
          requestId: request.id,
          request,
          response: null,
          error: result.error || 'Request failed',
          errorCode: result.errorCode,
          timestamp: startTime,
          duration: result.duration,
          scriptsOutput: Object.keys(scriptsOutput).length > 0 ? scriptsOutput : undefined,
        };
      }

      const response: Response = {
        status: result.status || 0,
        statusText: result.statusText || '',
        headers: result.headers || [],
        cookies: this.parseCookies(result.headers || []),
        body: result.body || '',
        size: result.size || 0,
        contentType: this.getContentType(result.headers || []),
        timing: result.timing,
        sizeBreakdown: result.sizeBreakdown,
        requestSize: result.requestSize,
        networkInfo: result.networkInfo,
      };

      // Execute post-request script if defined
      if (request.scripts.post && request.scripts.post.trim()) {
        // Convert response headers to Record for easier script access
        const responseHeaders: Record<string, string> = {};
        (result.headers || []).forEach(h => {
          responseHeaders[h.key] = h.value;
        });

        const postResult = await this.executeScript(request.scripts.post, {
          request: { url, method: request.method, headers, body },
          response: {
            status: result.status || 0,
            statusText: result.statusText || '',
            headers: responseHeaders,
            body: result.body || '',
            responseTime: result.duration,
          },
          envVars,
          runtimeVars,
        });
        scriptsOutput.post = postResult.output;
      }

      return {
        id: executionId,
        requestId: request.id,
        request,
        response,
        timestamp: startTime,
        duration: result.duration,
        scriptsOutput: Object.keys(scriptsOutput).length > 0 ? scriptsOutput : undefined,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return {
        id: executionId,
        requestId: request.id,
        request,
        response: null,
        error: errorMessage,
        timestamp: startTime,
        duration,
        scriptsOutput: Object.keys(scriptsOutput).length > 0 ? scriptsOutput : undefined,
      };
    }
  }

  // Browser fetch fallback (with CORS limitations)
  private async browserFetch(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string | null,
    timeout: number,
    sendUserAgent: boolean = true,
    corsProxy: string = ''
  ): Promise<HttpResponseResult> {
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Add User-Agent if enabled (browser may not allow it due to CORS)
      const fetchHeaders = { ...headers };
      if (sendUserAgent && !headers['User-Agent'] && !headers['user-agent']) {
        // Note: browsers typically don't allow setting User-Agent in fetch
        // but we try anyway for consistency
        fetchHeaders['User-Agent'] = `Echolon/${APP_VERSION}`;
      }

      // Apply CORS proxy if configured
      let fetchUrl = url;
      if (corsProxy) {
        // Handle different proxy URL formats:
        // - "https://proxy.com/" -> append URL directly
        // - "https://proxy.com/?url=" -> URL encode the target
        if (corsProxy.includes('?') || corsProxy.includes('=')) {
          fetchUrl = corsProxy + encodeURIComponent(url);
        } else {
          // Simple prefix proxy (e.g., cors-anywhere style)
          fetchUrl = corsProxy.replace(/\/$/, '') + '/' + url;
        }
      }

      const fetchResponse = await fetch(fetchUrl, {
        method,
        headers: fetchHeaders,
        body,
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeoutId);

      const responseText = await fetchResponse.text();
      const duration = Date.now() - startTime;

      // Parse response headers
      const responseHeaders: Array<{ key: string; value: string }> = [];
      fetchResponse.headers.forEach((value, key) => {
        responseHeaders.push({ key, value });
      });

      return {
        success: true,
        status: fetchResponse.status,
        statusText: fetchResponse.statusText,
        headers: responseHeaders,
        body: responseText,
        size: new Blob([responseText]).size,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      let errorMessage = error instanceof Error ? error.message : 'Unknown error';
      let errorCode = 'UNKNOWN';

      if (error instanceof DOMException && error.name === 'AbortError') {
        errorMessage = `Request timed out after ${timeout}ms`;
        errorCode = 'ETIMEDOUT';
      } else if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        const corsHint = corsProxy 
          ? 'The CORS proxy may be unavailable or misconfigured.'
          : 'This may be a CORS issue. Try configuring a CORS proxy in Settings.';
        errorMessage = `Network error: Unable to reach server. ${corsHint}`;
        errorCode = 'NETWORK_ERROR';
      }

      return {
        success: false,
        duration,
        error: errorMessage,
        errorCode,
      };
    }
  }

  // Parse cookies from response headers
  private parseCookies(headers: Array<{ key: string; value: string }>): { name: string; value: string }[] {
    const cookies: { name: string; value: string }[] = [];
    
    headers
      .filter(h => h.key.toLowerCase() === 'set-cookie')
      .forEach(h => {
        const [nameValue] = h.value.split(';');
        if (nameValue) {
          const [name, value] = nameValue.trim().split('=');
          if (name && value !== undefined) {
            cookies.push({ name: name.trim(), value: value.trim() });
          }
        }
      });

    return cookies;
  }

  // Get content type from response headers
  private getContentType(headers: Array<{ key: string; value: string }>): string {
    const contentTypeHeader = headers.find(h => h.key.toLowerCase() === 'content-type');
    return contentTypeHeader?.value || 'text/plain';
  }

  // Build Digest Auth header (simplified - requires nonce to be pre-provided)
  private buildDigestAuthHeader(
    digest: NonNullable<AuthConfig['digest']>,
    method: string,
    url: string,
    environment: Environment | null,
    collectionEnv?: CollectionEnvironment | null
  ): string | null {
    const username = this.interpolateVariables(digest.username, environment, collectionEnv);
    const password = this.interpolateVariables(digest.password, environment, collectionEnv);
    const realm = digest.realm || '';
    const nonce = digest.nonce || '';
    const algorithm = digest.algorithm || 'MD5';
    const qop = digest.qop || 'auth';

    if (!nonce) return null;

    // Parse URI from URL
    let uri = '/';
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      uri = urlObj.pathname + urlObj.search;
    } catch {
      // Use default
    }

    // Generate cnonce and nc
    const cnonce = Math.random().toString(36).substring(2, 10);
    const nc = '00000001';

    // Calculate response hash (simplified MD5 implementation placeholder)
    // Note: In a real implementation, you'd use a proper crypto library
    // For now, we construct the header with the values and let the server validate
    const response = this.calculateDigestResponse(
      username, realm, password, nonce, nc, cnonce, qop, method, uri, algorithm
    );

    const parts = [
      `Digest username="${username}"`,
      `realm="${realm}"`,
      `nonce="${nonce}"`,
      `uri="${uri}"`,
      `algorithm=${algorithm}`,
      `qop=${qop}`,
      `nc=${nc}`,
      `cnonce="${cnonce}"`,
      `response="${response}"`,
    ];

    return parts.join(', ');
  }

  // Calculate Digest auth response (simplified)
  private calculateDigestResponse(
    username: string,
    realm: string,
    password: string,
    nonce: string,
    nc: string,
    cnonce: string,
    qop: string,
    method: string,
    uri: string,
    _algorithm: string
  ): string {
    // This is a placeholder - actual implementation would need crypto
    // For testing purposes, we generate a hash-like string
    // In production, this should use actual MD5/SHA-256 hashing
    const ha1Input = `${username}:${realm}:${password}`;
    const ha2Input = `${method}:${uri}`;
    const responseInput = `${ha1Input}:${nonce}:${nc}:${cnonce}:${qop}:${ha2Input}`;
    
    // Simple hash simulation - in reality use crypto.subtle or a library
    let hash = 0;
    for (let i = 0; i < responseInput.length; i++) {
      const char = responseInput.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(32, '0');
  }

  // Build AWS Signature V4 headers (simplified)
  private buildAwsSignatureHeaders(
    aws: NonNullable<AuthConfig['awsSignature']>,
    method: string,
    url: string,
    existingHeaders: Record<string, string>,
    environment: Environment | null,
    collectionEnv?: CollectionEnvironment | null
  ): Record<string, string> {
    const accessKeyId = this.interpolateVariables(aws.accessKeyId, environment, collectionEnv);
    const secretAccessKey = this.interpolateVariables(aws.secretAccessKey, environment, collectionEnv);
    const region = this.interpolateVariables(aws.region, environment, collectionEnv);
    const service = this.interpolateVariables(aws.service, environment, collectionEnv);
    const sessionToken = aws.sessionToken 
      ? this.interpolateVariables(aws.sessionToken, environment, collectionEnv) 
      : undefined;

    // Generate timestamp
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);

    // Parse URL
    let host = '';
    let canonicalUri = '/';
    let canonicalQuerystring = '';
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      host = urlObj.host;
      canonicalUri = urlObj.pathname || '/';
      canonicalQuerystring = urlObj.searchParams.toString();
    } catch {
      // Use defaults
    }

    const headers: Record<string, string> = {
      'X-Amz-Date': amzDate,
      'Host': host,
    };

    if (sessionToken) {
      headers['X-Amz-Security-Token'] = sessionToken;
    }

    // Build canonical request components
    const signedHeaders = Object.keys({ ...existingHeaders, ...headers })
      .map(k => k.toLowerCase())
      .sort()
      .join(';');

    // Create credential scope
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

    // In a full implementation, we'd compute the actual signature using HMAC-SHA256
    // For now, we construct the Authorization header structure
    const signature = this.computeAwsSignature(
      method,
      canonicalUri,
      canonicalQuerystring,
      { ...existingHeaders, ...headers },
      '',  // payload hash
      amzDate,
      dateStamp,
      region,
      service,
      secretAccessKey
    );

    headers['Authorization'] = [
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', ');

    return headers;
  }

  // Compute AWS Signature (simplified placeholder)
  private computeAwsSignature(
    method: string,
    canonicalUri: string,
    canonicalQuerystring: string,
    headers: Record<string, string>,
    _payloadHash: string,
    amzDate: string,
    dateStamp: string,
    region: string,
    service: string,
    _secretKey: string
  ): string {
    // This is a placeholder - actual AWS Sig V4 requires HMAC-SHA256
    // For a complete implementation, use crypto.subtle or aws4 library
    const input = `${method}:${canonicalUri}:${canonicalQuerystring}:${JSON.stringify(headers)}:${amzDate}:${dateStamp}:${region}:${service}`;
    
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(64, '0');
  }

  // Create a new empty request
  createEmptyRequest(): Request {
    return {
      id: uuidv4(),
      name: 'New Request',
      method: 'GET',
      url: '',
      headers: [],
      queryParams: [],
      pathParams: [],
      body: {
        type: 'none',
        content: '',
      },
      auth: {
        type: 'none',
      },
      scripts: {
        pre: '',
        post: '',
      },
    };
  }

  // Create sample request
  createSampleRequest(): Request {
    return {
      id: uuidv4(),
      name: SAMPLE_REQUEST.name,
      method: SAMPLE_REQUEST.method,
      url: SAMPLE_REQUEST.url,
      headers: [],
      queryParams: [],
      pathParams: [],
      body: {
        type: 'none',
        content: '',
      },
      auth: {
        type: 'none',
      },
      scripts: {
        pre: '',
        post: '',
      },
    };
  }

  // Duplicate a request
  duplicateRequest(request: Request): Request {
    return {
      ...request,
      id: uuidv4(),
      name: `${request.name} (copy)`,
      headers: request.headers.map(h => ({ ...h, id: uuidv4() })),
      queryParams: request.queryParams.map(p => ({ ...p, id: uuidv4() })),
      body: {
        ...request.body,
        formData: request.body.formData?.map(f => ({ ...f, id: uuidv4() })),
      },
    };
  }
}

export const requestService = RequestService.getInstance();
export default requestService;
