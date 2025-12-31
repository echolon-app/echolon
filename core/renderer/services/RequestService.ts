import { Request, Response, RequestExecution, Environment, ResponseTiming, SizeBreakdown, NetworkInfo, Collection, AuthConfig, AppSettings, CollectionEnvironment } from '@/types';
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

  // Replace {{variables}} with actual values
  // Collection environment variables have priority over global environment variables
  private interpolateVariables(
    text: string, 
    environment: Environment | null, 
    collectionEnv?: CollectionEnvironment | null
  ): string {
    if (!text) return text;
    if (!environment && !collectionEnv) return text;

    return text.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
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

    // Add auth headers
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
    let url = this.interpolateVariables(request.url, environment, collectionEnv);

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

    try {
      const headers = this.prepareHeaders(request, environment, collection, collectionEnvironment);
      const url = this.buildUrl(request, environment, collection, collectionEnvironment);
      const body = this.prepareBody(request, environment, headers, collectionEnvironment);

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

      return {
        id: executionId,
        requestId: request.id,
        request,
        response,
        timestamp: startTime,
        duration: result.duration,
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

  // Create a new empty request
  createEmptyRequest(): Request {
    return {
      id: uuidv4(),
      name: 'New Request',
      method: 'GET',
      url: '',
      headers: [],
      queryParams: [],
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
