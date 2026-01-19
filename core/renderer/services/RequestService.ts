import { Request, Response, RequestExecution, ResolvedRequest, Environment, ResponseTiming, SizeBreakdown, NetworkInfo, Collection, AuthConfig, AppSettings, CollectionEnvironment, ScriptOutput, ScriptsOutput, KeyValuePair } from '@/types';
import { v4 as uuidv4 } from 'uuid';
import { SAMPLE_REQUEST } from '../../shared/constants';
import { isElectron } from '@/utils';
import { APP_VERSION } from '@/utils/environment';
import {
  isFunction,
  parseFunction,
  evaluateFunction,
  EvaluationContext,
} from '@/services/DynamicFunctions';

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
  bodyBase64?: string; // Base64-encoded body for binary content (images, videos, PDFs, etc.)
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

  // Replace {{variables}}, {{functions}}, and :pathParams with actual values
  // Priority: collection environment > global environment > dynamic functions
  private interpolateVariables(
    text: string, 
    environment: Environment | null, 
    collectionEnv?: CollectionEnvironment | null,
    pathParams?: KeyValuePair[],
    context?: EvaluationContext
  ): string {
    if (!text) return text;
    
    let result = text;

    // First, interpolate environment variables and functions {{var}} or {{function}}
    result = result.replace(/\{\{([^}]+)\}\}/g, (match, expression) => {
      const trimmedExpr = expression.trim();
      
      // 1. Check collection environment first (higher priority)
      if (collectionEnv) {
        const collVar = collectionEnv.variables.find(
          v => v.key === trimmedExpr && v.enabled
        );
        if (collVar) return collVar.value;
      }
      
      // 2. Check global environment
      if (environment) {
        const globalVar = environment.variables.find(
          v => v.key === trimmedExpr && v.enabled
        );
        if (globalVar) return globalVar.value;
      }
      
      // 3. Check if it's a dynamic function
      if (isFunction(trimmedExpr)) {
        const parsed = parseFunction(trimmedExpr);
        if (parsed) {
          return evaluateFunction(parsed.functionName, parsed.parameters, context);
        }
      }
      
      return match; // Keep original if not found
    });
    
    // Then, interpolate path parameters - supports both :param and {param} formats
    if (pathParams && pathParams.length > 0) {
      // Handle :param format (Express-style)
      result = result.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, paramName) => {
        const param = pathParams.find(p => p.key === paramName);
        return param && param.value ? param.value : match;
      });
      
      // Handle {param} format (OpenAPI-style) - single braces only, not {{var}}
      result = result.replace(/(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})/g, (match, paramName) => {
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

    // Get disabled inherited header overrides from request
    // These are stored as headers with id prefix '__inherited_header_override__' and key = original header id
    const disabledInheritedHeaderIds = new Set<string>();
    request.headers
      .filter(h => h.id?.startsWith('__inherited_header_override__') && !h.enabled)
      .forEach(h => {
        // The key field stores the original collection header ID
        disabledInheritedHeaderIds.add(h.key);
      });

    // First, add collection-level headers (these can be overridden by request headers)
    // Skip headers that have been disabled via overrides
    if (collection?.headers) {
      collection.headers
        .filter(h => h.enabled && h.key && !disabledInheritedHeaderIds.has(h.id))
        .forEach(h => {
          headers[this.interpolateVariables(h.key, environment, collectionEnv)] = 
            this.interpolateVariables(h.value, environment, collectionEnv);
        });
    }

    // Add request-level headers (these override collection headers)
    // Filter out override markers (they're just metadata)
    request.headers
      .filter(h => h.enabled && h.key && !h.id?.startsWith('__inherited_header_override__'))
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
    }
    // Note: AWS Signature v4 is handled in execute() after body is prepared
    // since it requires the payload hash

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
  ): Promise<{ 
    output: ScriptOutput; 
    envVars: Record<string, string>; 
    runtimeVars: Record<string, string>;
    modifiedResponse?: { status: number; statusText: string; headers: Record<string, string>; body: string; responseTime: number };
  }> {
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
        modifiedResponse: result.modifiedResponse,
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
      
      // Handle AWS Signature v4 after body is prepared (needs payload hash)
      const effectiveAuth = this.getEffectiveAuth(request, collection);
      if (effectiveAuth.type === 'aws-signature' && effectiveAuth.awsSignature) {
        const awsHeaders = this.buildAwsSignatureHeaders(
          effectiveAuth.awsSignature,
          request.method,
          url,
          headers,
          environment,
          collectionEnvironment,
          body
        );
        Object.assign(headers, awsHeaders);
      }
      
      // Create resolved request object for history
      const resolvedRequest: ResolvedRequest = {
        url,
        method: request.method,
        headers: Object.entries(headers).map(([key, value]) => ({ key, value })),
        body,
      };

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

      // Apply proxy URL transformation if a proxy is configured
      const effectiveCorsProxy = corsProxy ?? getCorsProxy();
      const requestUrl = effectiveCorsProxy ? this.applyProxyToUrl(url, effectiveCorsProxy) : url;

      if (isElectron()) {
        // Use IPC to make the request via Node.js (bypasses CORS)
        const options: HttpRequestOptions = {
          method: request.method,
          url: requestUrl,
          headers,
          body,
          timeout,
          sendUserAgent,
        };
        result = await window.electronAPI.makeHttpRequest(options);
        
        // Handle Digest Auth challenge-response flow
        if (effectiveAuth.type === 'digest' && effectiveAuth.digest && result.status === 401) {
          const digestResult = await this.handleDigestAuthChallenge(
            result,
            effectiveAuth.digest,
            request.method,
            requestUrl,
            headers,
            body,
            timeout,
            sendUserAgent,
            environment,
            collectionEnvironment
          );
          if (digestResult) {
            result = digestResult;
          }
        }
      } else {
        // Fallback to browser fetch (may have CORS issues)
        result = await this.browserFetch(request.method, url, headers, body, timeout, sendUserAgent, effectiveCorsProxy);
      }

      if (!result.success) {
        return {
          id: executionId,
          requestId: request.id,
          request,
          resolvedRequest,
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
        bodyBase64: result.bodyBase64,
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
        
        // Apply modified response from post-request script
        if (postResult.modifiedResponse) {
          const modified = postResult.modifiedResponse;
          response.status = modified.status;
          response.statusText = modified.statusText;
          response.body = modified.body;
          // Convert headers back to array format
          response.headers = Object.entries(modified.headers).map(([key, value]) => ({ key, value }));
          // Update content type if headers changed
          response.contentType = this.getContentType(response.headers);
          // Recalculate cookies if headers changed
          response.cookies = this.parseCookies(response.headers);
        }
      }

      return {
        id: executionId,
        requestId: request.id,
        request,
        resolvedRequest,
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
        fetchUrl = this.applyProxyToUrl(url, corsProxy);
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

  /**
   * Apply proxy URL transformation
   * 
   * Supports multiple proxy URL formats:
   * 1. Echolon proxy: "https://proxy.echolon.app" 
   *    - Transforms: https://api.github.com/path → https://proxy.echolon.app/https/api.github.com/path
   * 2. Query param proxy: "https://proxy.com/?url="
   *    - Transforms: https://api.github.com/path → https://proxy.com/?url=https%3A%2F%2Fapi.github.com%2Fpath
   * 3. Simple prefix proxy: "https://proxy.com/"
   *    - Transforms: https://api.github.com/path → https://proxy.com/https://api.github.com/path
   */
  private applyProxyToUrl(targetUrl: string, proxyBaseUrl: string): string {
    // Check if this is the echolon proxy format
    if (proxyBaseUrl.includes('proxy.echolon.app') || proxyBaseUrl.includes('/proxy')) {
      // Echolon proxy format: {proxyBaseUrl}/{scheme}/{host}/{path}
      try {
        const parsed = new URL(targetUrl);
        const scheme = parsed.protocol.replace(':', ''); // 'https' or 'http'
        const host = parsed.host; // includes port if non-standard
        const pathAndQuery = parsed.pathname + parsed.search;
        
        // Build the proxy URL: proxyBaseUrl/scheme/host/path
        const cleanProxyBase = proxyBaseUrl.replace(/\/+$/, ''); // Remove trailing slashes
        return `${cleanProxyBase}/${scheme}/${host}${pathAndQuery}`;
      } catch {
        // If URL parsing fails, fall back to simple prefix
        return proxyBaseUrl.replace(/\/$/, '') + '/' + targetUrl;
      }
    }
    
    // Query param proxy format (e.g., "https://proxy.com/?url=")
    if (proxyBaseUrl.includes('?') || proxyBaseUrl.includes('=')) {
      return proxyBaseUrl + encodeURIComponent(targetUrl);
    }
    
    // Simple prefix proxy (e.g., cors-anywhere style)
    return proxyBaseUrl.replace(/\/$/, '') + '/' + targetUrl;
  }

  /**
   * Handle Digest Auth challenge-response flow
   * 
   * 1. Parses the WWW-Authenticate header from the 401 response
   * 2. Computes the digest response hash using the main process (proper crypto)
   * 3. Retries the request with the Authorization header
   */
  private async handleDigestAuthChallenge(
    initialResult: HttpResponseResult,
    digestConfig: NonNullable<AuthConfig['digest']>,
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string | null,
    timeout: number,
    sendUserAgent: boolean,
    environment: Environment | null,
    collectionEnv?: CollectionEnvironment | null
  ): Promise<HttpResponseResult | null> {
    // Find WWW-Authenticate header
    const wwwAuthHeader = initialResult.headers?.find(
      h => h.key.toLowerCase() === 'www-authenticate'
    )?.value;

    if (!wwwAuthHeader || !wwwAuthHeader.toLowerCase().startsWith('digest ')) {
      return null;
    }

    // Parse URI from URL
    let uri = '/';
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      uri = urlObj.pathname + urlObj.search;
    } catch {
      // Use default
    }

    // Interpolate credentials
    const username = this.interpolateVariables(digestConfig.username, environment, collectionEnv);
    const password = this.interpolateVariables(digestConfig.password, environment, collectionEnv);

    // Compute digest auth header using main process (proper MD5/SHA-256)
    const digestResult = await window.electronAPI.computeDigestAuth({
      wwwAuthHeader,
      username,
      password,
      method,
      uri,
    });

    if (!digestResult.success || !digestResult.header) {
      console.warn('Digest auth computation failed:', digestResult.error);
      return null;
    }

    // Retry request with Authorization header
    const retryHeaders = {
      ...headers,
      'Authorization': digestResult.header,
    };

    const retryOptions: HttpRequestOptions = {
      method,
      url,
      headers: retryHeaders,
      body,
      timeout,
      sendUserAgent,
    };

    return window.electronAPI.makeHttpRequest(retryOptions);
  }

  // Store pending AWS signature computation
  private pendingAwsSignature: Promise<Record<string, string>> | null = null;

  // Build AWS Signature V4 headers (proper implementation using Web Crypto API)
  private buildAwsSignatureHeaders(
    aws: NonNullable<AuthConfig['awsSignature']>,
    method: string,
    url: string,
    existingHeaders: Record<string, string>,
    environment: Environment | null,
    collectionEnv?: CollectionEnvironment | null,
    body?: string | null
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
      // Build sorted canonical query string
      const params = Array.from(urlObj.searchParams.entries());
      params.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
      canonicalQuerystring = params
        .map(([k, v]) => `${this.uriEncode(k)}=${this.uriEncode(v)}`)
        .join('&');
    } catch {
      // Use defaults
    }

    const headers: Record<string, string> = {
      'X-Amz-Date': amzDate,
      'host': host,
    };

    if (sessionToken) {
      headers['x-amz-security-token'] = sessionToken;
    }

    // Merge existing headers (lowercase keys) for signing
    const allHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(existingHeaders)) {
      allHeaders[key.toLowerCase()] = value.trim().replace(/\s+/g, ' ');
    }
    for (const [key, value] of Object.entries(headers)) {
      allHeaders[key.toLowerCase()] = value.trim().replace(/\s+/g, ' ');
    }

    // Build sorted signed headers list
    const sortedHeaderKeys = Object.keys(allHeaders).sort();
    const signedHeaders = sortedHeaderKeys.join(';');

    // Build canonical headers string
    const canonicalHeaders = sortedHeaderKeys
      .map(key => `${key}:${allHeaders[key]}`)
      .join('\n') + '\n';

    // Create credential scope
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

    // Calculate payload hash (SHA256 of body)
    const payloadHash = this.sha256Sync(body || '');

    // Build canonical request
    const canonicalRequest = [
      method.toUpperCase(),
      this.uriEncode(canonicalUri, false),
      canonicalQuerystring,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    // Create string to sign
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      this.sha256Sync(canonicalRequest),
    ].join('\n');

    // Calculate signature using synchronous HMAC-SHA256 chain
    const signature = this.computeAwsSignatureSync(
      secretAccessKey,
      dateStamp,
      region,
      service,
      stringToSign
    );

    // Build result headers with proper casing for actual request
    const resultHeaders: Record<string, string> = {
      'X-Amz-Date': amzDate,
      'Host': host,
      'Authorization': [
        `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}`,
        `SignedHeaders=${signedHeaders}`,
        `Signature=${signature}`,
      ].join(', '),
    };

    if (sessionToken) {
      resultHeaders['X-Amz-Security-Token'] = sessionToken;
    }

    return resultHeaders;
  }

  // URI encode following AWS rules
  private uriEncode(str: string, encodeSlash: boolean = true): string {
    let encoded = '';
    for (const char of str) {
      if (
        (char >= 'A' && char <= 'Z') ||
        (char >= 'a' && char <= 'z') ||
        (char >= '0' && char <= '9') ||
        char === '_' ||
        char === '-' ||
        char === '~' ||
        char === '.'
      ) {
        encoded += char;
      } else if (char === '/' && !encodeSlash) {
        encoded += char;
      } else {
        encoded += '%' + char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
      }
    }
    return encoded;
  }

  // Synchronous SHA256 hash (using a simple implementation for browser compatibility)
  private sha256Sync(data: string): string {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    
    // SHA-256 constants
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    const rightRotate = (value: number, amount: number) => 
      (value >>> amount) | (value << (32 - amount));

    // Initial hash values
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    // Pre-processing: adding padding bits
    const msgLen = dataBuffer.length;
    const bitLen = msgLen * 8;
    
    // Calculate padding: total length must be multiple of 64 bytes (512 bits)
    // Format: message + 0x80 + zeros + 8-byte length
    // We need (msgLen + 1 + padLen + 8) % 64 == 0
    const padLen = (64 - ((msgLen + 9) % 64)) % 64;
    const paddedLen = msgLen + 1 + padLen + 8;
    
    const padded = new Uint8Array(paddedLen);
    padded.set(dataBuffer);
    padded[msgLen] = 0x80;
    
    // Append original length in bits as 64-bit big-endian
    // For messages < 2^32 bits, high 32 bits are 0
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLen - 8, 0, false); // High 32 bits
    view.setUint32(paddedLen - 4, bitLen, false); // Low 32 bits

    // Process each 64-byte chunk
    for (let i = 0; i < paddedLen; i += 64) {
      const w = new Uint32Array(64);
      
      // Copy chunk into first 16 words
      for (let j = 0; j < 16; j++) {
        w[j] = view.getUint32(i + j * 4, false);
      }
      
      // Extend the first 16 words into the remaining 48 words
      for (let j = 16; j < 64; j++) {
        const s0 = rightRotate(w[j-15], 7) ^ rightRotate(w[j-15], 18) ^ (w[j-15] >>> 3);
        const s1 = rightRotate(w[j-2], 17) ^ rightRotate(w[j-2], 19) ^ (w[j-2] >>> 10);
        w[j] = (w[j-16] + s0 + w[j-7] + s1) >>> 0;
      }

      // Initialize working variables
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

      // Compression function main loop
      for (let j = 0; j < 64; j++) {
        const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[j] + w[j]) >>> 0;
        const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }

      // Add the compressed chunk to the current hash value
      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + h) >>> 0;
    }

    // Produce the final hash value (big-endian)
    return [h0, h1, h2, h3, h4, h5, h6, h7]
      .map(n => n.toString(16).padStart(8, '0'))
      .join('');
  }

  // Synchronous HMAC-SHA256
  private hmacSha256Sync(key: Uint8Array, data: string): Uint8Array {
    const blockSize = 64;
    
    // If key is longer than block size, hash it
    let keyBytes = key;
    if (key.length > blockSize) {
      const hash = this.sha256Sync(String.fromCharCode(...key));
      keyBytes = new Uint8Array(hash.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    }
    
    // Pad key to block size
    const paddedKey = new Uint8Array(blockSize);
    paddedKey.set(keyBytes);
    
    // Create inner and outer padding
    const ipad = new Uint8Array(blockSize);
    const opad = new Uint8Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      ipad[i] = paddedKey[i] ^ 0x36;
      opad[i] = paddedKey[i] ^ 0x5c;
    }
    
    // Inner hash: H(K XOR ipad, data)
    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(data);
    const innerData = new Uint8Array(blockSize + dataBytes.length);
    innerData.set(ipad);
    innerData.set(dataBytes, blockSize);
    const innerHash = this.sha256Sync(String.fromCharCode(...innerData));
    const innerHashBytes = new Uint8Array(innerHash.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    
    // Outer hash: H(K XOR opad, inner hash)
    const outerData = new Uint8Array(blockSize + 32);
    outerData.set(opad);
    outerData.set(innerHashBytes, blockSize);
    const outerHash = this.sha256Sync(String.fromCharCode(...outerData));
    
    return new Uint8Array(outerHash.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  }

  // Compute AWS Signature using HMAC-SHA256 chain
  private computeAwsSignatureSync(
    secretKey: string,
    dateStamp: string,
    region: string,
    service: string,
    stringToSign: string
  ): string {
    const encoder = new TextEncoder();
    
    // AWS signing key derivation: kSecret -> kDate -> kRegion -> kService -> kSigning
    const kSecret = encoder.encode(`AWS4${secretKey}`);
    const kDate = this.hmacSha256Sync(kSecret, dateStamp);
    const kRegion = this.hmacSha256Sync(kDate, region);
    const kService = this.hmacSha256Sync(kRegion, service);
    const kSigning = this.hmacSha256Sync(kService, 'aws4_request');
    
    // Calculate final signature
    const signature = this.hmacSha256Sync(kSigning, stringToSign);
    
    return Array.from(signature)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
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
