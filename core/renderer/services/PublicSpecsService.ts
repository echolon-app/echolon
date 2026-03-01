/**
 * Public Specs Service
 * 
 * Handles public spec sharing operations including S3 uploads,
 * subdomain checking, and version management.
 */

import { Collection, PublicSharing, PublicSharingVersion } from '@/types';
import { exportToOpenAPIJson } from './OpenAPIExporter';
import { generatePublicSpecHtml } from './PublicSpecHtmlGenerator';
import { collectionToEchoFile } from './EchoFileConverter';

// Declare window.electronAPI for TypeScript (subset used across renderer)
declare global {
  interface Window {
    electronAPI?: {
      publicSpecsCheckSubdomain: (subdomain: string, userId?: string) => Promise<CheckSubdomainResult>;
      publicSpecsUpload: (options: UploadSpecOptions) => Promise<UploadResult>;
      publicSpecsGetVersions: (subdomain: string) => Promise<SpecVersion[]>;
      publicSpecsDeleteVersion: (subdomain: string, version: string) => Promise<boolean>;
      publicSpecsDeleteRootFiles: (subdomain: string) => Promise<boolean>;
      publicSpecsGetManifest: (subdomain: string) => Promise<SpecManifest | null>;
      publicSpecsUpdateManifest: (manifest: SpecManifest) => Promise<boolean>;
      // App / shell (Electron-only)
      openExternal?: (url: string) => Promise<void>;
      getLaunchAtLogin?: () => Promise<{ openAtLogin: boolean }>;
      setLaunchAtLogin?: (openAtLogin: boolean) => Promise<void>;
      openSystemLoginItems?: () => Promise<void>;
      wipeAllData?: () => Promise<{ success: boolean; error?: string }>;
      restartApp?: () => Promise<void>;
      setUpdateServer?: (url: string | null) => Promise<{ success: boolean; feedUrl?: string; error?: string }>;
      computeCompressionSizes?: (payload: { body: string; levels?: { gzip?: number; brotli?: number; zstd?: number }; methods?: ('gzip' | 'brotli' | 'zstd')[] }) => Promise<{ gzip?: number; brotli?: number; zstd?: number }>;
      fetchUrlContent?: (url: string) => Promise<{ success: boolean; content?: string; contentType?: string; error?: string; statusCode?: number }>;
    };
  }
}

// Types matching the main process
interface SpecManifest {
  subdomain: string;
  collectionId: string;
  collectionName: string;
  createdAt: string;
  updatedAt: string;
  versions: SpecVersion[];
}

interface SpecVersion {
  version: string;
  publishedAt: string;
  title?: string;
  description?: string;
}

interface UploadSpecOptions {
  subdomain: string;
  version: string;
  openapiJson: string;
  echolonJson?: string; // Internal Echolon format with extended features
  htmlContent: string;
  rootHtmlContent?: string;
  collectionId: string;
  collectionName: string;
  title?: string;
  description?: string;
  userId?: string;
}

interface UploadResult {
  success: boolean;
  error?: string;
  specUrl?: string;
  htmlUrl?: string;
}

interface CheckSubdomainResult {
  available: boolean;
  reason?: 'exists' | 'invalid' | 'reserved';
  message?: string;
  owned?: boolean;
}

// Adjectives and nouns for random subdomain generation
const ADJECTIVES = [
  'swift', 'rapid', 'quick', 'fast', 'agile', 'smart', 'clever', 'bright',
  'cool', 'sleek', 'smooth', 'clean', 'fresh', 'sharp', 'bold', 'brave',
  'calm', 'cozy', 'crisp', 'deft', 'fair', 'free', 'glad', 'keen',
  'kind', 'neat', 'nice', 'pure', 'rare', 'safe', 'sure', 'tidy',
  'warm', 'wise', 'blue', 'gold', 'jade', 'mint', 'pink', 'ruby',
];

const NOUNS = [
  'api', 'app', 'hub', 'lab', 'dev', 'ops', 'box', 'kit',
  'pro', 'ace', 'one', 'bit', 'byte', 'code', 'data', 'docs',
  'flow', 'form', 'gate', 'grid', 'home', 'link', 'loop', 'mode',
  'node', 'path', 'port', 'rest', 'route', 'spec', 'sync', 'task',
  'test', 'tool', 'view', 'wave', 'work', 'zone', 'core', 'edge',
];

class PublicSpecsService {
  private static instance: PublicSpecsService;

  private constructor() {}

  static getInstance(): PublicSpecsService {
    if (!PublicSpecsService.instance) {
      PublicSpecsService.instance = new PublicSpecsService();
    }
    return PublicSpecsService.instance;
  }

  /**
   * Generate a random subdomain name
   */
  generateRandomSubdomain(): string {
    const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const suffix = Math.random().toString(36).substring(2, 6);
    return `${adjective}-${noun}-${suffix}`;
  }

  /**
   * Check if a subdomain is available
   */
  async checkSubdomain(subdomain: string, userId?: string): Promise<CheckSubdomainResult> {
    if (!window.electronAPI?.publicSpecsCheckSubdomain) {
      // Fallback for web mode or missing API - call the API server directly
      try {
        const url = userId 
          ? `https://api.echolon.app/api/public-specs/check/${subdomain}?userId=${encodeURIComponent(userId)}`
          : `https://api.echolon.app/api/public-specs/check/${subdomain}`;
        const response = await fetch(url);
        return await response.json();
      } catch (error) {
        console.error('Error checking subdomain:', error);
        return { available: true }; // Assume available on error
      }
    }
    return window.electronAPI.publicSpecsCheckSubdomain(subdomain, userId);
  }

  /**
   * Publish a collection to S3
   */
  async publishCollection(
    collection: Collection,
    version: string,
    subdomain: string,
    options?: {
      title?: string;
      description?: string;
      baseUrl?: string;
      userId?: string;
    }
  ): Promise<UploadResult> {
    try {
      // Debug: Log collection structure before export (including tags)
      console.log('[PublicSpecsService] Publishing collection:', {
        id: collection.id,
        name: collection.name,
        requestCount: collection.requests?.length || 0,
        folderCount: collection.folders?.length || 0,
        requests: collection.requests?.map(r => ({ id: r.id, name: r.name, method: r.method, url: r.url, tags: r.tags })),
        folders: collection.folders?.map(f => ({ 
          id: f.id, 
          name: f.name, 
          requestCount: f.requests?.length || 0,
          requests: f.requests?.map(r => ({ id: r.id, name: r.name, method: r.method, url: r.url, tags: r.tags }))
        })),
      });

      // Generate OpenAPI JSON
      const openapiJson = exportToOpenAPIJson(collection, {
        version,
        baseUrl: options?.baseUrl,
        pretty: true,
      });
      
      // Debug: Log generated OpenAPI
      console.log('[PublicSpecsService] Generated OpenAPI:', openapiJson.substring(0, 2000));

      // Generate internal Echolon JSON (includes environments, colors, tags, etc.)
      const echoFile = collectionToEchoFile(collection, collection.workspaceId || 'default');
      const echolonJson = JSON.stringify(echoFile, null, 2);
      console.log('[PublicSpecsService] Generated Echolon JSON:', echolonJson.substring(0, 1000));
      
      // Debug: Log tags in echo file
      console.log('[PublicSpecsService] Echolon requests with tags:', echoFile.requests?.map(r => ({ name: r.name, tags: r.tags })));
      echoFile.folders?.forEach(f => {
        console.log(`[PublicSpecsService] Folder "${f.name}" requests with tags:`, f.requests?.map(r => ({ name: r.name, tags: r.tags })));
      });

      // Generate HTML content for versioned path (use echolon format for full features)
      const htmlContent = generatePublicSpecHtml({
        subdomain,
        version,
        title: options?.title || collection.name,
        description: options?.description || collection.description,
        userId: options?.userId,
        format: 'echolon', // Use echolon format for full feature support
      });

      // Generate HTML content for root path (different versions URL)
      const rootHtmlContent = generatePublicSpecHtml({
        subdomain,
        version,
        title: options?.title || collection.name,
        description: options?.description || collection.description,
        userId: options?.userId,
        format: 'echolon', // Use echolon format for full feature support
      });

      const uploadOptions: UploadSpecOptions = {
        subdomain,
        version,
        openapiJson,
        echolonJson,
        htmlContent,
        rootHtmlContent,
        collectionId: collection.id,
        collectionName: collection.name,
        title: options?.title,
        description: options?.description,
        userId: options?.userId,
      };

      if (!window.electronAPI?.publicSpecsUpload) {
        return {
          success: false,
          error: 'Public specs API not available. This feature requires the desktop app.',
        };
      }

      return window.electronAPI.publicSpecsUpload(uploadOptions);
    } catch (error) {
      console.error('Error publishing collection:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Get all published versions for a subdomain
   */
  async getVersions(subdomain: string): Promise<SpecVersion[]> {
    if (!window.electronAPI?.publicSpecsGetVersions) {
      // Fallback - fetch manifest from S3 directly
      try {
        const response = await fetch(
          `https://api.echolon.app/_internal/public-spec/${subdomain}/manifest`
        );
        if (response.ok) {
          const manifest: SpecManifest = await response.json();
          return manifest.versions;
        }
        return [];
      } catch {
        return [];
      }
    }
    return window.electronAPI.publicSpecsGetVersions(subdomain);
  }

  /**
   * Delete a specific version
   */
  async deleteVersion(subdomain: string, version: string): Promise<boolean> {
    if (!window.electronAPI?.publicSpecsDeleteVersion) {
      return false;
    }
    return window.electronAPI.publicSpecsDeleteVersion(subdomain, version);
  }

  /**
   * Delete all root files for a subdomain (when disabling sharing completely)
   */
  async deleteRootFiles(subdomain: string): Promise<boolean> {
    if (!window.electronAPI?.publicSpecsDeleteRootFiles) {
      return false;
    }
    return window.electronAPI.publicSpecsDeleteRootFiles(subdomain);
  }

  /**
   * Get the manifest for a subdomain
   */
  async getManifest(subdomain: string): Promise<SpecManifest | null> {
    if (!window.electronAPI?.publicSpecsGetManifest) {
      // Fallback - fetch manifest from S3 directly
      try {
        const response = await fetch(
          `https://api.echolon.app/_internal/public-spec/${subdomain}/manifest`
        );
        if (response.ok) {
          return await response.json();
        }
        return null;
      } catch {
        return null;
      }
    }
    return window.electronAPI.publicSpecsGetManifest(subdomain);
  }

  /**
   * Get the public URL for a spec version
   */
  getSpecUrl(subdomain: string, version: string): string {
    return `https://${subdomain}.api.echolon.app/${version}/`;
  }

  /**
   * Get the OpenAPI JSON URL for a spec version
   */
  getOpenAPIUrl(subdomain: string, version?: string): string {
    if (version) {
      return `https://${subdomain}.api.echolon.app/${version}/openapi.json`;
    }
    return `https://${subdomain}.api.echolon.app/openapi.json`;
  }

  /**
   * Get the Echolon JSON URL for a spec version (internal format with extended features)
   */
  getEcholonUrl(subdomain: string, version?: string): string {
    if (version) {
      return `https://${subdomain}.api.echolon.app/${version}/echolon.json`;
    }
    return `https://${subdomain}.api.echolon.app/echolon.json`;
  }

  /**
   * Convert PublicSharing data to/from SpecManifest format
   */
  publicSharingToVersions(sharing: PublicSharing | undefined): PublicSharingVersion[] {
    return sharing?.versions || [];
  }

  /**
   * Update collection's publicSharing field after successful publish
   */
  updateCollectionPublicSharing(
    collection: Collection,
    subdomain: string,
    version: string,
    title?: string,
    description?: string
  ): PublicSharing {
    const now = Date.now();
    const existingSharing = collection.publicSharing || {
      enabled: true,
      subdomain,
      versions: [],
    };

    // Find or create version entry
    const versions = [...(existingSharing.versions || [])];
    const existingVersionIndex = versions.findIndex(v => v.version === version);
    
    const versionEntry: PublicSharingVersion = {
      version,
      publishedAt: now,
      title,
      description,
    };

    if (existingVersionIndex >= 0) {
      versions[existingVersionIndex] = versionEntry;
    } else {
      versions.push(versionEntry);
    }

    // Sort versions (newest first by semver)
    versions.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));

    return {
      ...existingSharing,
      enabled: true,
      subdomain,
      versions,
      lastPublishedAt: now,
    };
  }
}

export const publicSpecsService = PublicSpecsService.getInstance();
export default publicSpecsService;

