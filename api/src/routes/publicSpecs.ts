/**
 * Public Specs Routes
 * 
 * Handles S3 pre-signed URL generation and public spec management.
 * AWS credentials are stored server-side, never exposed to the client.
 */

import { Router, Request, Response } from 'express';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const router = Router();

// Configuration
const BUCKET_NAME = process.env.AWS_BUCKET || 'echolon-public-specs';
const REGION = process.env.AWS_REGION || 'eu-central-1';
const URL_EXPIRY = 300; // Pre-signed URLs expire in 5 minutes

// Reserved subdomains that cannot be used
const RESERVED_SUBDOMAINS = [
  'www', 'api', 'app', 'web', 'admin', 'dashboard', 'docs', 'help',
  'support', 'status', 'blog', 'mail', 'email', 'cdn', 'static',
  'assets', 'img', 'images', 'css', 'js', 'fonts', 'media',
  'echolon', 'echo', 'spec', 'specs', 'public', 'private',
];

const MIN_SUBDOMAIN_LENGTH = 3;
const MAX_SUBDOMAIN_LENGTH = 63;

// Lazy-loaded S3 client
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    const accessKeyId = process.env.AWS_ACCESS_KEY;
    const secretAccessKey = process.env.AWS_ACCESS_KEY_SECRET;

    //console.log('AWS_ACCESS_KEY:', process.env.AWS_ACCESS_KEY);
    //console.log('AWS_ACCESS_KEY_SECRET:', process.env.AWS_ACCESS_KEY_SECRET);
    if (!accessKeyId || !secretAccessKey) {
      console.warn('[PublicSpecs] AWS credentials not found in environment variables');
    }

    s3Client = new S3Client({
      region: REGION,
      credentials: accessKeyId && secretAccessKey ? {
        accessKeyId,
        secretAccessKey,
      } : undefined,
    });
  }
  return s3Client;
}

/**
 * Validate subdomain format
 */
function validateSubdomain(subdomain: string): { valid: boolean; reason?: string } {
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
 * GET /api/public-specs/check/:subdomain
 * Query params: ?userId=xxx (optional) - if provided, allows access if user owns the subdomain
 */
router.get('/check/:subdomain', async (req: Request, res: Response) => {
  const { subdomain } = req.params;
  const { userId } = req.query;

  // Validate format
  const validation = validateSubdomain(subdomain);
  if (!validation.valid) {
    return res.json({
      available: false,
      reason: 'invalid',
      message: validation.reason,
    });
  }

  try {
    const client = getS3Client();
    
    // Try to get the manifest to check ownership
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `${subdomain}/manifest.json`,
    });

    try {
      const response = await client.send(getCommand);
      const body = await response.Body?.transformToString();
      
      if (body) {
        const manifest = JSON.parse(body);
        
        // If userId is provided and matches the owner, it's available for this user
        if (userId && manifest.ownerId === userId) {
          return res.json({ 
            available: true,
            owned: true,
            message: 'You own this subdomain',
          });
        }
        
        // If manifest has no ownerId (legacy/unclaimed), allow claiming by publishing
        // This lets users claim subdomains they previously published before ownership was added
        if (!manifest.ownerId) {
          return res.json({
            available: true,
            owned: false,
            unclaimed: true,
            message: 'This subdomain is unclaimed - publishing will claim ownership',
          });
        }
        
        // Subdomain exists and owned by someone else
      return res.json({
        available: false,
        reason: 'exists',
        message: 'This subdomain is already taken',
      });
      }
    } catch (error: unknown) {
      // 404 means available
      if (error && typeof error === 'object' && 'name' in error && error.name === 'NotFound') {
        return res.json({ available: true });
      }
      if (error && typeof error === 'object' && '$metadata' in error) {
        const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
        if (metadata?.httpStatusCode === 404) {
          return res.json({ available: true });
        }
      }
      throw error;
    }
    
    // No manifest found
    return res.json({ available: true });
  } catch (error) {
    console.error('Error checking subdomain availability:', error);
    return res.json({ available: true }); // Assume available on error
  }
});

/**
 * Get pre-signed URLs for uploading a spec version
 * POST /api/public-specs/upload-urls
 * 
 * Body: { subdomain, version, userId?, includeEcholon? }
 * Returns: { openapiUrl, htmlUrl, manifestUrl, rootOpenapiUrl, rootHtmlUrl, echolonUrl?, rootEcholonUrl? }
 */
router.post('/upload-urls', async (req: Request, res: Response) => {
  const { subdomain, version, userId, includeEcholon } = req.body;

  if (!subdomain || !version) {
    return res.status(400).json({ 
      error: 'Missing required fields', 
      message: 'subdomain and version are required' 
    });
  }

  // Validate subdomain
  const validation = validateSubdomain(subdomain);
  if (!validation.valid) {
    return res.status(400).json({
      error: 'Invalid subdomain',
      message: validation.reason,
    });
  }

  try {
    const client = getS3Client();
    const versionPath = `${subdomain}/${version}`;

    // Generate pre-signed URLs for each file (versioned and root)
    const urlPromises = [
      // Versioned paths
      getSignedUrl(client, new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${versionPath}/openapi.json`,
        ContentType: 'application/json',
        CacheControl: 'max-age=3600',
      }), { expiresIn: URL_EXPIRY }),
      
      getSignedUrl(client, new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${versionPath}/index.html`,
        ContentType: 'text/html',
        CacheControl: 'max-age=3600',
      }), { expiresIn: URL_EXPIRY }),
      
      getSignedUrl(client, new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${subdomain}/manifest.json`,
        ContentType: 'application/json',
        CacheControl: 'max-age=60',
      }), { expiresIn: URL_EXPIRY }),
      
      // Root paths (for direct access without version)
      getSignedUrl(client, new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${subdomain}/openapi.json`,
        ContentType: 'application/json',
        CacheControl: 'max-age=3600',
      }), { expiresIn: URL_EXPIRY }),
      
      getSignedUrl(client, new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${subdomain}/index.html`,
        ContentType: 'text/html',
        CacheControl: 'max-age=3600',
      }), { expiresIn: URL_EXPIRY }),
      
      // versions.json for version dropdown (versioned path)
      getSignedUrl(client, new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${versionPath}/versions.json`,
        ContentType: 'application/json',
        CacheControl: 'max-age=60',
      }), { expiresIn: URL_EXPIRY }),
      
      // versions.json for version dropdown (root path)
      getSignedUrl(client, new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${subdomain}/versions.json`,
        ContentType: 'application/json',
        CacheControl: 'max-age=60',
      }), { expiresIn: URL_EXPIRY }),
    ];

    // Add echolon.json URLs if requested
    if (includeEcholon) {
      urlPromises.push(
        // Versioned echolon.json
        getSignedUrl(client, new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: `${versionPath}/echolon.json`,
          ContentType: 'application/json',
          CacheControl: 'max-age=3600',
        }), { expiresIn: URL_EXPIRY }),
        
        // Root echolon.json
        getSignedUrl(client, new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: `${subdomain}/echolon.json`,
          ContentType: 'application/json',
          CacheControl: 'max-age=3600',
        }), { expiresIn: URL_EXPIRY }),
      );
    }

    const urls = await Promise.all(urlPromises);
    const [openapiUrl, htmlUrl, manifestUrl, rootOpenapiUrl, rootHtmlUrl, versionedVersionsUrl, rootVersionsUrl, echolonUrl, rootEcholonUrl] = urls;

    const responseUrls: Record<string, string> = {
      openapi: openapiUrl,
      html: htmlUrl,
      manifest: manifestUrl,
      rootOpenapi: rootOpenapiUrl,
      rootHtml: rootHtmlUrl,
      versionedVersions: versionedVersionsUrl,
      rootVersions: rootVersionsUrl,
    };

    if (includeEcholon && echolonUrl && rootEcholonUrl) {
      responseUrls.echolon = echolonUrl;
      responseUrls.rootEcholon = rootEcholonUrl;
    }

    return res.json({
      success: true,
      urls: responseUrls,
      expiresIn: URL_EXPIRY,
    });
  } catch (error) {
    console.error('Error generating upload URLs:', error);
    return res.status(500).json({
      error: 'Failed to generate upload URLs',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get pre-signed URL for reading the manifest
 * GET /api/public-specs/manifest/:subdomain
 */
router.get('/manifest/:subdomain', async (req: Request, res: Response) => {
  const { subdomain } = req.params;

  try {
    const client = getS3Client();
    
    // First check if manifest exists
    const headCommand = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `${subdomain}/manifest.json`,
    });

    try {
      await client.send(headCommand);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && '$metadata' in error) {
        const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
        if (metadata?.httpStatusCode === 404) {
          return res.status(404).json({
            error: 'Not Found',
            message: `No manifest found for subdomain "${subdomain}"`,
          });
        }
      }
      throw error;
    }

    // Get the manifest content
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `${subdomain}/manifest.json`,
    });

    const response = await client.send(getCommand);
    const body = await response.Body?.transformToString();
    
    if (body) {
      return res.json(JSON.parse(body));
    }
    
    return res.status(404).json({
      error: 'Not Found',
      message: 'Manifest is empty',
    });
  } catch (error) {
    console.error('Error getting manifest:', error);
    return res.status(500).json({
      error: 'Failed to get manifest',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get pre-signed URLs for deleting a version
 * POST /api/public-specs/delete-urls
 * 
 * Body: { subdomain, version }
 */
router.post('/delete-urls', async (req: Request, res: Response) => {
  const { subdomain, version } = req.body;

  if (!subdomain || !version) {
    return res.status(400).json({ 
      error: 'Missing required fields', 
      message: 'subdomain and version are required' 
    });
  }

  try {
    const client = getS3Client();
    const versionPath = `${subdomain}/${version}`;

    // Generate pre-signed URLs for deletion
    const [openapiDeleteUrl, htmlDeleteUrl, versionsDeleteUrl, echolonDeleteUrl, manifestUrl] = await Promise.all([
      getSignedUrl(client, new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${versionPath}/openapi.json`,
      }), { expiresIn: URL_EXPIRY }),
      
      getSignedUrl(client, new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${versionPath}/index.html`,
      }), { expiresIn: URL_EXPIRY }),
      
      getSignedUrl(client, new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${versionPath}/versions.json`,
      }), { expiresIn: URL_EXPIRY }),
      
      getSignedUrl(client, new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${versionPath}/echolon.json`,
      }), { expiresIn: URL_EXPIRY }),
      
      // Also provide manifest URL for update after deletion
      getSignedUrl(client, new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${subdomain}/manifest.json`,
        ContentType: 'application/json',
        CacheControl: 'max-age=60',
      }), { expiresIn: URL_EXPIRY }),
    ]);

    return res.json({
      success: true,
      urls: {
        openapiDelete: openapiDeleteUrl,
        htmlDelete: htmlDeleteUrl,
        versionsDelete: versionsDeleteUrl,
        echolonDelete: echolonDeleteUrl,
        manifest: manifestUrl,
      },
      expiresIn: URL_EXPIRY,
    });
  } catch (error) {
    console.error('Error generating delete URLs:', error);
    return res.status(500).json({
      error: 'Failed to generate delete URLs',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get all versions for a subdomain
 * GET /api/public-specs/versions/:subdomain
 */
router.get('/versions/:subdomain', async (req: Request, res: Response) => {
  const { subdomain } = req.params;

  try {
    const client = getS3Client();
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `${subdomain}/manifest.json`,
    });

    try {
      const response = await client.send(getCommand);
      const body = await response.Body?.transformToString();
      
      if (body) {
        const manifest = JSON.parse(body);
        return res.json(manifest.versions || []);
      }
    } catch (error: unknown) {
      if (error && typeof error === 'object' && '$metadata' in error) {
        const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
        if (metadata?.httpStatusCode === 404) {
          return res.json([]);
        }
      }
      throw error;
    }
    
    return res.json([]);
  } catch (error) {
    console.error('Error getting versions:', error);
    return res.status(500).json({
      error: 'Failed to get versions',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get pre-signed URLs for deleting all root files (when disabling sharing completely)
 * POST /api/public-specs/delete-root-urls
 * Body: { subdomain }
 */
router.post('/delete-root-urls', async (req: Request, res: Response) => {
  const { subdomain } = req.body;

  if (!subdomain) {
    return res.status(400).json({ 
      error: 'Missing required field', 
      message: 'subdomain is required' 
    });
  }

  try {
    const client = getS3Client();

    // Generate pre-signed URLs for deleting root files
    const [rootOpenapiDelete, rootHtmlDelete, rootVersionsDelete, rootEcholonDelete, manifestDelete] = await Promise.all([
      getSignedUrl(client, new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${subdomain}/openapi.json`,
      }), { expiresIn: URL_EXPIRY }),
      
      getSignedUrl(client, new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${subdomain}/index.html`,
      }), { expiresIn: URL_EXPIRY }),
      
      getSignedUrl(client, new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${subdomain}/versions.json`,
      }), { expiresIn: URL_EXPIRY }),
      
      getSignedUrl(client, new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${subdomain}/echolon.json`,
      }), { expiresIn: URL_EXPIRY }),
      
      getSignedUrl(client, new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${subdomain}/manifest.json`,
      }), { expiresIn: URL_EXPIRY }),
    ]);

    return res.json({
      success: true,
      urls: {
        rootOpenapiDelete,
        rootHtmlDelete,
        rootVersionsDelete,
        rootEcholonDelete,
        manifestDelete,
      },
      expiresIn: URL_EXPIRY,
    });
  } catch (error) {
    console.error('Error generating root delete URLs:', error);
    return res.status(500).json({
      error: 'Failed to generate delete URLs',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;

