import { ResponseCookie } from '@/types';
import { fileStorageManager, webFileSystemManager } from '@/services';
import { isElectron } from '@/utils';

interface StoredCookie extends ResponseCookie {
  createdAt: number; // Timestamp when cookie was received
  lastAccessed?: number; // Last time cookie was sent with request
}

interface CookieStorage {
  cookies: StoredCookie[];
}

/**
 * Cookie Service - Manages cookie storage and retrieval (Cookie Jar)
 * 
 * Implements RFC 6265 cookie specification:
 * - Domain matching (exact and subdomain)
 * - Path matching (longest prefix)
 * - Expiration handling
 * - Secure flag enforcement
 */
export class CookieService {
  private static instance: CookieService;
  private cookies: Map<string, StoredCookie> = new Map(); // Key: `${name}:${domain}:${path}`
  private workspaceName: string | null = null;
  private storageManager: typeof fileStorageManager | typeof webFileSystemManager | null = null;
  private isWebMode: boolean = false;
  private isWebFileSystemEnabled: boolean = false;

  private constructor() {}

  static getInstance(): CookieService {
    if (!CookieService.instance) {
      CookieService.instance = new CookieService();
    }
    return CookieService.instance;
  }

  /**
   * Initialize the cookie service with workspace and storage manager
   */
  initialize(
    workspaceName: string,
    storageManager: typeof fileStorageManager | typeof webFileSystemManager,
    isWebMode: boolean = false,
    isWebFileSystemEnabled: boolean = false
  ): void {
    this.workspaceName = workspaceName;
    this.storageManager = storageManager;
    this.isWebMode = isWebMode;
    this.isWebFileSystemEnabled = isWebFileSystemEnabled;
  }

  /**
   * Generate a unique key for a cookie
   */
  private getCookieKey(name: string, domain: string, path: string): string {
    return `${name}:${domain}:${path}`;
  }

  /**
   * Check if a domain matches another domain (supports subdomain matching)
   */
  private domainMatches(cookieDomain: string | undefined, requestDomain: string): boolean {
    if (!cookieDomain) return false;
    
    // Normalize domains for comparison (remove leading dots, convert to lowercase)
    const normalizedCookieDomain = cookieDomain.startsWith('.') 
      ? cookieDomain.substring(1).toLowerCase()
      : cookieDomain.toLowerCase();
    const normalizedRequestDomain = requestDomain.toLowerCase();
    
    // Exact match
    if (normalizedCookieDomain === normalizedRequestDomain) return true;
    
    // Subdomain match: .example.com matches sub.example.com and example.com
    if (cookieDomain.startsWith('.')) {
      return normalizedRequestDomain.endsWith('.' + normalizedCookieDomain) || 
             normalizedRequestDomain === normalizedCookieDomain;
    }
    
    // Also check if request domain is a subdomain of cookie domain
    // e.g., cookie domain "example.com" should match "sub.example.com"
    if (normalizedRequestDomain.endsWith('.' + normalizedCookieDomain)) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if a path matches another path (longest prefix match)
   */
  private pathMatches(cookiePath: string | undefined, requestPath: string): boolean {
    if (!cookiePath) {
      // If cookie has no path, default to / which matches everything
      return true;
    }
    
    // Normalize paths
    const normalizedCookiePath = cookiePath.endsWith('/') && cookiePath !== '/' 
      ? cookiePath.slice(0, -1) 
      : cookiePath;
    const normalizedRequestPath = requestPath.endsWith('/') && requestPath !== '/'
      ? requestPath.slice(0, -1)
      : requestPath;
    
    // Exact match
    if (normalizedCookiePath === normalizedRequestPath) return true;
    
    // Prefix match: /api matches /api/users, / matches everything
    if (normalizedCookiePath === '/') return true;
    
    if (normalizedRequestPath.startsWith(normalizedCookiePath)) {
      // Ensure it's a complete path segment (not /api matching /api2)
      const nextChar = normalizedRequestPath[normalizedCookiePath.length];
      return nextChar === '/' || nextChar === undefined;
    }
    
    return false;
  }

  /**
   * Check if a cookie has expired
   */
  private isExpired(cookie: StoredCookie): boolean {
    if (!cookie.expires) return false;
    
    try {
      const expiresDate = new Date(cookie.expires);
      return expiresDate.getTime() < Date.now();
    } catch {
      return false;
    }
  }

  /**
   * Extract domain from URL
   */
  private getDomainFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      // Normalize: remove port if present, convert to lowercase
      let hostname = urlObj.hostname.toLowerCase();
      // Handle localhost variations
      if (hostname === '127.0.0.1' || hostname === '0.0.0.0') {
        hostname = 'localhost';
      }
      return hostname;
    } catch {
      return '';
    }
  }

  /**
   * Extract path from URL
   */
  private getPathFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.pathname || '/';
    } catch {
      return '/';
    }
  }

  /**
   * Check if URL is HTTPS
   */
  private isHttps(url: string): boolean {
    try {
      return new URL(url).protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Add a cookie from a Set-Cookie header response
   */
  addCookie(cookie: ResponseCookie, requestUrl: string): void {
    if (!this.workspaceName || !this.storageManager) {
      console.warn('[CookieService] Not initialized, cookie not stored:', cookie.name);
      return;
    }

    const requestDomain = this.getDomainFromUrl(requestUrl);
    const requestPath = this.getPathFromUrl(requestUrl);

    // Determine cookie domain (defaults to request domain)
    const cookieDomain = cookie.domain || requestDomain;
    
    // Determine cookie path (defaults to request path or /)
    let cookiePath = cookie.path;
    if (!cookiePath) {
      cookiePath = requestPath;
      // If path doesn't end with /, use parent directory
      if (!cookiePath.endsWith('/')) {
        const lastSlash = cookiePath.lastIndexOf('/');
        cookiePath = lastSlash > 0 ? cookiePath.substring(0, lastSlash + 1) : '/';
      }
    }

    // Create stored cookie
    const storedCookie: StoredCookie = {
      ...cookie,
      domain: cookieDomain,
      path: cookiePath,
      createdAt: Date.now(),
    };

    // Check expiration
    if (this.isExpired(storedCookie)) {
      return; // Don't store expired cookies
    }

    // Store cookie
    const key = this.getCookieKey(cookie.name, cookieDomain, cookiePath);
    this.cookies.set(key, storedCookie);
    console.log('[CookieService] Stored cookie:', cookie.name, 'domain:', cookieDomain, 'path:', cookiePath);

    // Persist to storage
    this.saveCookies();
  }

  /**
   * Get cookies that match a request URL
   */
  getCookiesForUrl(url: string): ResponseCookie[] {
    if (!this.workspaceName || !this.storageManager) {
      // Not initialized yet, return empty array
      return [];
    }

    const requestDomain = this.getDomainFromUrl(url);
    const requestPath = this.getPathFromUrl(url);
    const isSecure = this.isHttps(url);

    const matchingCookies: StoredCookie[] = [];

    console.log('[CookieService] Looking for cookies for URL:', url, 'domain:', requestDomain, 'path:', requestPath, 'total cookies:', this.cookies.size);
    
    // Find all matching cookies
    for (const cookie of this.cookies.values()) {
      console.log('[CookieService] Checking cookie:', cookie.name, 'domain:', cookie.domain, 'path:', cookie.path);
      
      // Skip expired cookies
      if (this.isExpired(cookie)) {
        console.log('[CookieService] Cookie expired:', cookie.name);
        continue;
      }

      // Check domain match
      if (!this.domainMatches(cookie.domain, requestDomain)) {
        console.log('[CookieService] Domain mismatch:', cookie.domain, 'vs', requestDomain, 'for cookie:', cookie.name);
        continue;
      }

      // Check path match
      if (!this.pathMatches(cookie.path, requestPath)) {
        console.log('[CookieService] Path mismatch:', cookie.path, 'vs', requestPath, 'for cookie:', cookie.name);
        continue;
      }
      
      console.log('[CookieService] Cookie matched:', cookie.name);

      // Check secure flag (only enforce if cookie explicitly requires HTTPS)
      // In development, allow secure cookies over HTTP for testing
      // In production, this should be enforced
      if (cookie.secure && !isSecure) {
        // Allow secure cookies over HTTP in development (localhost)
        const isLocalhost = requestDomain === 'localhost' || requestDomain.startsWith('127.0.0.1') || requestDomain.startsWith('0.0.0.0');
        if (!isLocalhost) {
          continue; // Skip secure cookies on non-localhost HTTP
        }
      }

      matchingCookies.push(cookie);
    }

    // Sort by path length (longest first) and creation time (oldest first)
    matchingCookies.sort((a, b) => {
      const pathDiff = (b.path?.length || 0) - (a.path?.length || 0);
      if (pathDiff !== 0) return pathDiff;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

    // Update lastAccessed
    const now = Date.now();
    matchingCookies.forEach(cookie => {
      cookie.lastAccessed = now;
      const key = this.getCookieKey(cookie.name, cookie.domain || '', cookie.path || '');
      this.cookies.set(key, cookie);
    });

    // Persist if any cookies were accessed
    if (matchingCookies.length > 0) {
      this.saveCookies();
    }

    return matchingCookies;
  }

  /**
   * Build Cookie header value from matching cookies
   */
  buildCookieHeader(url: string): string {
    const cookies = this.getCookiesForUrl(url);
    if (cookies.length === 0) {
      console.log('[CookieService] No cookies found for URL:', url, 'Total cookies:', this.cookies.size);
      return '';
    }
    const header = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    console.log('[CookieService] Building Cookie header for URL:', url, 'Cookies:', cookies.map(c => c.name).join(', '));
    return header;
  }

  /**
   * Get all stored cookies
   */
  getAllCookies(): ResponseCookie[] {
    // Remove expired cookies first
    this.clearExpiredCookies();
    
    return Array.from(this.cookies.values());
  }

  /**
   * Get cookies by domain
   */
  getCookiesByDomain(domain: string): ResponseCookie[] {
    return Array.from(this.cookies.values()).filter(c => 
      c.domain && this.domainMatches(c.domain, domain)
    );
  }

  /**
   * Get cookies by path
   */
  getCookiesByPath(path: string): ResponseCookie[] {
    return Array.from(this.cookies.values()).filter(c => 
      c.path && this.pathMatches(c.path, path)
    );
  }

  /**
   * Delete a specific cookie
   */
  deleteCookie(name: string, domain: string, path: string): void {
    const key = this.getCookieKey(name, domain, path);
    this.cookies.delete(key);
    this.saveCookies();
  }

  /**
   * Update a cookie
   */
  updateCookie(name: string, domain: string, path: string, updates: Partial<ResponseCookie>): void {
    const key = this.getCookieKey(name, domain, path);
    const existing = this.cookies.get(key);
    if (existing) {
      const updated: StoredCookie = {
        ...existing,
        ...updates,
        createdAt: existing.createdAt, // Preserve creation time
      };
      this.cookies.set(key, updated);
      this.saveCookies();
    }
  }

  /**
   * Clear all cookies (optionally filtered by domain/path)
   */
  clearCookies(domain?: string, path?: string): void {
    if (!domain && !path) {
      // Clear all
      this.cookies.clear();
    } else {
      // Clear filtered
      const toDelete: string[] = [];
      for (const [key, cookie] of this.cookies.entries()) {
        const domainMatch = !domain || (cookie.domain && this.domainMatches(cookie.domain, domain));
        const pathMatch = !path || (cookie.path && this.pathMatches(cookie.path, path));
        
        if (domainMatch && pathMatch) {
          toDelete.push(key);
        }
      }
      toDelete.forEach(key => this.cookies.delete(key));
    }
    this.saveCookies();
  }

  /**
   * Clear expired cookies
   */
  clearExpiredCookies(): number {
    const toDelete: string[] = [];
    for (const [key, cookie] of this.cookies.entries()) {
      if (this.isExpired(cookie)) {
        toDelete.push(key);
      }
    }
    toDelete.forEach(key => this.cookies.delete(key));
    
    if (toDelete.length > 0) {
      this.saveCookies();
    }
    
    return toDelete.length;
  }

  /**
   * Load cookies from storage
   */
  async loadCookies(): Promise<void> {
    if (!this.workspaceName || !this.storageManager) {
      return;
    }

    try {
      const data = await this.storageManager.readWorkspaceDataFile<CookieStorage>(
        this.workspaceName,
        'cookies'
      );

      if (data && data.cookies) {
        this.cookies.clear();
        data.cookies.forEach(cookie => {
          // Skip expired cookies on load
          if (!this.isExpired(cookie)) {
            const key = this.getCookieKey(
              cookie.name,
              cookie.domain || '',
              cookie.path || ''
            );
            this.cookies.set(key, cookie);
          }
        });
      }
    } catch (error) {
      console.error('[CookieService] Error loading cookies:', error);
    }
  }

  /**
   * Save cookies to storage
   */
  private async saveCookies(): Promise<void> {
    if (!this.workspaceName || !this.storageManager) {
      return;
    }

    try {
      const data: CookieStorage = {
        cookies: Array.from(this.cookies.values()),
      };
      await this.storageManager.writeWorkspaceDataFile(
        this.workspaceName,
        'cookies',
        data
      );
    } catch (error) {
      console.error('[CookieService] Error saving cookies:', error);
    }
  }
}

export const cookieService = CookieService.getInstance();
