/**
 * S3 Upload Manager for Public Specs
 * 
 * Uses the Echolon API to get pre-signed URLs for S3 uploads.
 * AWS credentials are never stored in the desktop app.
 */

import { net } from 'electron';

// In development, use localhost; in production, use the deployed API
const isDev = !require('electron').app.isPackaged;
const API_BASE_URL = process.env.ECHOLON_API_URL || (isDev ? 'http://localhost:3500' : 'https://api.echolon.app');
const BASE_URL = 'https://api.echolon.app';

// Manifest structure for tracking versions
export interface SpecManifest {
  subdomain: string;
  collectionId: string;
  collectionName: string;
  ownerId?: string; // User ID for ownership verification
  createdAt: string;
  updatedAt: string;
  versions: SpecVersion[];
}

export interface SpecVersion {
  version: string;
  publishedAt: string;
  title?: string;
  description?: string;
}

export interface UploadSpecOptions {
  subdomain: string;
  version: string;
  openapiJson: string;
  echolonJson?: string; // Internal Echolon format with extended features (environments, colors, etc.)
  htmlContent: string;
  rootHtmlContent?: string; // HTML for root path (without version in paths)
  collectionId: string;
  collectionName: string;
  title?: string;
  description?: string;
  userId?: string;
}

export interface UploadResult {
  success: boolean;
  error?: string;
  specUrl?: string;
  htmlUrl?: string;
}

export interface CheckSubdomainResult {
  available: boolean;
  reason?: 'exists' | 'invalid' | 'reserved';
  message?: string;
  owned?: boolean; // True if user owns this subdomain
}

// Reserved subdomains that cannot be used (kept for client-side validation)
const RESERVED_SUBDOMAINS = [
  'www', 'api', 'app', 'web', 'admin', 'dashboard', 'docs', 'help',
  'support', 'status', 'blog', 'mail', 'email', 'cdn', 'static',
  'assets', 'img', 'images', 'css', 'js', 'fonts', 'media',
  'echolon', 'echo', 'spec', 'specs', 'public', 'private',
];

const MIN_SUBDOMAIN_LENGTH = 3;
const MAX_SUBDOMAIN_LENGTH = 63;

/**
 * Helper function to make API requests using Electron's net module
 */
async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  endpoint: string,
  body?: object
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE_URL}${endpoint}`;
    const request = net.request({
      method,
      url,
    });

    request.setHeader('Content-Type', 'application/json');
    request.setHeader('Accept', 'application/json');

    let responseData = '';

    request.on('response', (response) => {
      response.on('data', (chunk) => {
        responseData += chunk.toString();
      });

      response.on('end', () => {
        try {
          const data = JSON.parse(responseData);
          if (response.statusCode && response.statusCode >= 400) {
            reject(new Error(data.message || data.error || `API error: ${response.statusCode}`));
          } else {
            resolve(data as T);
          }
        } catch (e) {
          reject(new Error(`Failed to parse API response: ${responseData}`));
        }
      });
    });

    request.on('error', (error) => {
      reject(error);
    });

    if (body) {
      request.write(JSON.stringify(body));
    }

    request.end();
  });
}

/**
 * Helper function to upload to S3 using a pre-signed URL
 */
async function uploadToPresignedUrl(
  presignedUrl: string,
  content: string,
  contentType: string,
  metadata?: Record<string, string>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: 'PUT',
      url: presignedUrl,
    });

    request.setHeader('Content-Type', contentType);
    
    // Set metadata headers (S3 uses x-amz-meta-* prefix for custom metadata)
    if (metadata) {
      for (const [key, value] of Object.entries(metadata)) {
        request.setHeader(`x-amz-meta-${key}`, value);
      }
    }

    request.on('response', (response) => {
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
        resolve();
      } else {
        let errorData = '';
        response.on('data', (chunk) => {
          errorData += chunk.toString();
        });
        response.on('end', () => {
          reject(new Error(`S3 upload failed: ${response.statusCode} - ${errorData}`));
        });
      }
    });

    request.on('error', (error) => {
      reject(error);
    });

    request.write(content);
    request.end();
  });
}

/**
 * Helper function to delete from S3 using a pre-signed URL
 */
async function deleteFromPresignedUrl(presignedUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: 'DELETE',
      url: presignedUrl,
    });

    request.on('response', (response) => {
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
        resolve();
      } else {
        // S3 delete returns 204 No Content on success
        resolve();
      }
    });

    request.on('error', (error) => {
      reject(error);
    });

    request.end();
  });
}

class S3UploadManager {
  private static instance: S3UploadManager;

  private constructor() {}

  static getInstance(): S3UploadManager {
    if (!S3UploadManager.instance) {
      S3UploadManager.instance = new S3UploadManager();
    }
    return S3UploadManager.instance;
  }

  /**
   * Validate subdomain format (client-side validation)
   */
  validateSubdomain(subdomain: string): { valid: boolean; reason?: string } {
    if (subdomain.length < MIN_SUBDOMAIN_LENGTH) {
      return { valid: false, reason: `Subdomain must be at least ${MIN_SUBDOMAIN_LENGTH} characters` };
    }
    if (subdomain.length > MAX_SUBDOMAIN_LENGTH) {
      return { valid: false, reason: `Subdomain must be at most ${MAX_SUBDOMAIN_LENGTH} characters` };
    }

    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(subdomain) && !/^[a-z0-9]$/.test(subdomain)) {
      return { 
        valid: false, 
        reason: 'Subdomain must contain only lowercase letters, numbers, and hyphens. Cannot start or end with a hyphen.' 
      };
    }

    if (subdomain.includes('--')) {
      return { valid: false, reason: 'Subdomain cannot contain consecutive hyphens' };
    }

    if (RESERVED_SUBDOMAINS.includes(subdomain)) {
      return { valid: false, reason: 'This subdomain is reserved' };
    }

    return { valid: true };
  }

  /**
   * Check if a subdomain is available
   */
  async checkSubdomainAvailability(subdomain: string, userId?: string): Promise<CheckSubdomainResult> {
    // First validate the format locally
    const validation = this.validateSubdomain(subdomain);
    if (!validation.valid) {
      return {
        available: false,
        reason: 'invalid',
        message: validation.reason,
      };
    }

    try {
      const endpoint = userId 
        ? `/api/public-specs/check/${subdomain}?userId=${encodeURIComponent(userId)}`
        : `/api/public-specs/check/${subdomain}`;
      const result = await apiRequest<CheckSubdomainResult>(
        'GET',
        endpoint
      );
      return result;
    } catch (error) {
      console.error('Error checking subdomain availability:', error);
      // On error, assume available (upload will fail if there's a real issue)
      return { available: true };
    }
  }

  /**
   * Get the manifest for a subdomain
   */
  async getManifest(subdomain: string): Promise<SpecManifest | null> {
    try {
      const manifest = await apiRequest<SpecManifest>(
        'GET',
        `/api/public-specs/manifest/${subdomain}`
      );
      return manifest;
    } catch (error) {
      console.error('Error getting manifest:', error);
      return null;
    }
  }

  /**
   * Upload or update the manifest
   */
  async updateManifest(manifest: SpecManifest): Promise<boolean> {
    try {
      // Get a pre-signed URL for the manifest
      const urlsResponse = await apiRequest<{
        success: boolean;
        urls: { openapi: string; html: string; manifest: string };
      }>('POST', '/api/public-specs/upload-urls', {
        subdomain: manifest.subdomain,
        version: '_manifest', // Dummy version to get manifest URL
      });

      if (!urlsResponse.success) {
        throw new Error('Failed to get upload URLs');
      }

      // Upload the manifest
      await uploadToPresignedUrl(
        urlsResponse.urls.manifest,
        JSON.stringify(manifest, null, 2),
        'application/json'
      );

      return true;
    } catch (error) {
      console.error('Error updating manifest:', error);
      return false;
    }
  }

  /**
   * Upload a spec version to S3
   */
  async uploadSpec(options: UploadSpecOptions): Promise<UploadResult> {
    const { subdomain, version, openapiJson, echolonJson, htmlContent, rootHtmlContent, collectionId, collectionName, title, description, userId } = options;

    try {
      // Get pre-signed URLs from the API (include userId for metadata)
      const urlsResponse = await apiRequest<{
        success: boolean;
        urls: { 
          openapi: string; 
          html: string; 
          manifest: string; 
          rootOpenapi: string; 
          rootHtml: string;
          versionedVersions: string;
          rootVersions: string;
          echolon?: string;
          rootEcholon?: string;
        };
      }>('POST', '/api/public-specs/upload-urls', {
        subdomain,
        version,
        userId,
        includeEcholon: !!echolonJson,
      });

      if (!urlsResponse.success) {
        throw new Error('Failed to get upload URLs from API');
      }

      const { urls } = urlsResponse;

      // Upload to versioned path
      await uploadToPresignedUrl(urls.openapi, openapiJson, 'application/json');
      await uploadToPresignedUrl(urls.html, htmlContent, 'text/html');

      // Upload echolon.json if provided
      if (echolonJson && urls.echolon) {
        await uploadToPresignedUrl(urls.echolon, echolonJson, 'application/json');
      }

      // Upload to root path (for direct access without version)
      await uploadToPresignedUrl(urls.rootOpenapi, openapiJson, 'application/json');
      await uploadToPresignedUrl(urls.rootHtml, rootHtmlContent || htmlContent, 'text/html');

      // Upload echolon.json to root as well
      if (echolonJson && urls.rootEcholon) {
        await uploadToPresignedUrl(urls.rootEcholon, echolonJson, 'application/json');
      }

      // Get or create manifest
      let manifest = await this.getManifest(subdomain);
      const now = new Date().toISOString();

      if (!manifest) {
        manifest = {
          subdomain,
          collectionId,
          collectionName,
          ownerId: userId,
          createdAt: now,
          updatedAt: now,
          versions: [],
        };
      } else if (userId && !manifest.ownerId) {
        // Set owner if not already set
        manifest.ownerId = userId;
      }

      // Add or update version
      const existingVersionIndex = manifest.versions.findIndex(v => v.version === version);
      const versionInfo: SpecVersion = {
        version,
        publishedAt: now,
        title,
        description,
      };

      if (existingVersionIndex >= 0) {
        manifest.versions[existingVersionIndex] = versionInfo;
      } else {
        manifest.versions.push(versionInfo);
      }

      // Sort versions (newest first)
      manifest.versions.sort((a, b) => {
        return b.version.localeCompare(a.version, undefined, { numeric: true });
      });

      manifest.updatedAt = now;

      // Upload the manifest
      await uploadToPresignedUrl(urls.manifest, JSON.stringify(manifest, null, 2), 'application/json');

      // Generate and upload versions.json for the version dropdown
      const versionsJson = JSON.stringify({
        versions: manifest.versions.map(v => ({
          version: v.version,
          publishedAt: v.publishedAt,
          title: v.title,
          description: v.description,
          url: `../${v.version}/`, // Relative URL from versioned path
        })),
      }, null, 2);

      // versions.json for root path (different relative URLs)
      const rootVersionsJson = JSON.stringify({
        versions: manifest.versions.map(v => ({
          version: v.version,
          publishedAt: v.publishedAt,
          title: v.title,
          description: v.description,
          url: `./${v.version}/`, // Relative URL from root
        })),
      }, null, 2);

      // Upload versions.json to both paths
      await uploadToPresignedUrl(urls.versionedVersions, versionsJson, 'application/json');
      await uploadToPresignedUrl(urls.rootVersions, rootVersionsJson, 'application/json');

      return {
        success: true,
        specUrl: `${BASE_URL}/${subdomain}/${version}/openapi.json`,
        htmlUrl: `https://${subdomain}.api.echolon.app/`,
      };
    } catch (error) {
      console.error('Error uploading spec:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Get all versions for a subdomain
   */
  async getVersions(subdomain: string): Promise<SpecVersion[]> {
    try {
      const versions = await apiRequest<SpecVersion[]>(
        'GET',
        `/api/public-specs/versions/${subdomain}`
      );
      return versions;
    } catch (error) {
      console.error('Error getting versions:', error);
      return [];
    }
  }

  /**
   * Delete a specific version
   */
  async deleteVersion(subdomain: string, version: string): Promise<boolean> {
    try {
      console.log('[S3Upload] Deleting version:', subdomain, version);
      
      // Get pre-signed URLs for deletion
      const urlsResponse = await apiRequest<{
        success: boolean;
        urls: { 
          openapiDelete: string; 
          htmlDelete: string; 
          versionsDelete: string;
          echolonDelete?: string;
          manifest: string;
        };
      }>('POST', '/api/public-specs/delete-urls', {
        subdomain,
        version,
      });

      if (!urlsResponse.success) {
        throw new Error('Failed to get delete URLs');
      }

      const { urls } = urlsResponse;
      console.log('[S3Upload] Got delete URLs, deleting files...');

      // Delete all files for this version
      const deleteResults = await Promise.allSettled([
        deleteFromPresignedUrl(urls.openapiDelete),
        deleteFromPresignedUrl(urls.htmlDelete),
        urls.versionsDelete ? deleteFromPresignedUrl(urls.versionsDelete) : Promise.resolve(),
        urls.echolonDelete ? deleteFromPresignedUrl(urls.echolonDelete) : Promise.resolve(),
      ]);
      
      console.log('[S3Upload] Delete results:', deleteResults);

      // Update manifest
      const manifest = await this.getManifest(subdomain);
      if (manifest) {
        manifest.versions = manifest.versions.filter(v => v.version !== version);
        manifest.updatedAt = new Date().toISOString();
        await uploadToPresignedUrl(urls.manifest, JSON.stringify(manifest, null, 2), 'application/json');
        console.log('[S3Upload] Manifest updated');
      }

      return true;
    } catch (error) {
      console.error('[S3Upload] Error deleting version:', error);
      return false;
    }
  }

  /**
   * Delete all root files for a subdomain (when disabling sharing completely)
   */
  async deleteRootFiles(subdomain: string): Promise<boolean> {
    try {
      console.log('[S3Upload] Deleting root files for:', subdomain);
      
      // Get pre-signed URLs for deleting root files
      const urlsResponse = await apiRequest<{
        success: boolean;
        urls: { 
          rootOpenapiDelete: string; 
          rootHtmlDelete: string; 
          rootVersionsDelete: string;
          rootEcholonDelete?: string;
          manifestDelete: string;
        };
      }>('POST', '/api/public-specs/delete-root-urls', {
        subdomain,
      });

      if (!urlsResponse.success) {
        throw new Error('Failed to get delete URLs for root files');
      }

      const { urls } = urlsResponse;
      console.log('[S3Upload] Got root delete URLs, deleting files...');

      // Delete all root files
      const deleteResults = await Promise.allSettled([
        deleteFromPresignedUrl(urls.rootOpenapiDelete),
        deleteFromPresignedUrl(urls.rootHtmlDelete),
        deleteFromPresignedUrl(urls.rootVersionsDelete),
        urls.rootEcholonDelete ? deleteFromPresignedUrl(urls.rootEcholonDelete) : Promise.resolve(),
        deleteFromPresignedUrl(urls.manifestDelete),
      ]);
      
      console.log('[S3Upload] Root delete results:', deleteResults);

      return true;
    } catch (error) {
      console.error('[S3Upload] Error deleting root files:', error);
      return false;
    }
  }

  /**
   * Generate a random subdomain name
   */
  generateRandomSubdomain(): string {
    const adjectives = [
      'swift', 'rapid', 'quick', 'fast', 'agile', 'smart', 'clever', 'bright',
      'cool', 'sleek', 'smooth', 'clean', 'fresh', 'sharp', 'bold', 'brave',
      'calm', 'cozy', 'crisp', 'deft', 'fair', 'free', 'glad', 'keen',
      'kind', 'neat', 'nice', 'pure', 'rare', 'safe', 'sure', 'tidy',
      'warm', 'wise', 'blue', 'gold', 'jade', 'mint', 'pink', 'ruby',
    ];

    const nouns = [
      'api', 'app', 'hub', 'lab', 'dev', 'ops', 'box', 'kit',
      'pro', 'ace', 'one', 'bit', 'byte', 'code', 'data', 'docs',
      'flow', 'form', 'gate', 'grid', 'home', 'link', 'loop', 'mode',
      'node', 'path', 'port', 'rest', 'route', 'spec', 'sync', 'task',
      'test', 'tool', 'view', 'wave', 'work', 'zone', 'core', 'edge',
    ];

    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const suffix = Math.random().toString(36).substring(2, 6);

    return `${adjective}-${noun}-${suffix}`;
  }
}

export const s3UploadManager = S3UploadManager.getInstance();
export default s3UploadManager;
