import { Router, Request, Response } from 'express';
import crypto from 'crypto';

const router = Router();

// ============================================================================
// AWS Signature v4 Test Credentials
// ============================================================================

// These are TEST credentials for demonstration purposes only
// In a real AWS environment, these would be IAM credentials
export const AWS_TEST_CREDENTIALS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'execute-api',
  // Optional session token for temporary credentials
  sessionToken: 'FwoGZXIvYXdzEBYaDKWQ8DqEvDcWPbCwZyLYAQ==',
};

// ============================================================================
// AWS Signature v4 Helpers
// ============================================================================

/**
 * Compute HMAC-SHA256
 */
function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

/**
 * Compute SHA256 hash
 */
function sha256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Get AWS signing key
 */
function getSigningKey(secretKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  return kSigning;
}

/**
 * Parse AWS Authorization header
 */
interface AwsAuthParts {
  algorithm: string;
  credential: string;
  signedHeaders: string;
  signature: string;
  accessKeyId: string;
  credentialScope: string;
}

function parseAwsAuthHeader(authHeader: string): AwsAuthParts | null {
  if (!authHeader || !authHeader.startsWith('AWS4-HMAC-SHA256')) {
    return null;
  }

  try {
    // Format: AWS4-HMAC-SHA256 Credential=..., SignedHeaders=..., Signature=...
    const parts: Record<string, string> = {};
    
    // Extract algorithm (before first space)
    const [algorithm, rest] = authHeader.split(' ', 2);
    
    // Parse key=value pairs
    const pairRegex = /(\w+)=([^,]+)/g;
    let match;
    while ((match = pairRegex.exec(rest)) !== null) {
      parts[match[1]] = match[2].trim();
    }

    if (!parts.Credential || !parts.SignedHeaders || !parts.Signature) {
      return null;
    }

    // Parse credential: accessKeyId/dateStamp/region/service/aws4_request
    const credentialParts = parts.Credential.split('/');
    const accessKeyId = credentialParts[0];
    const credentialScope = credentialParts.slice(1).join('/');

    return {
      algorithm,
      credential: parts.Credential,
      signedHeaders: parts.SignedHeaders,
      signature: parts.Signature,
      accessKeyId,
      credentialScope,
    };
  } catch {
    return null;
  }
}

/**
 * Validate AWS Signature v4
 */
function validateAwsSignature(
  req: Request,
  authParts: AwsAuthParts,
  secretAccessKey: string
): { valid: boolean; reason?: string; expectedSignature?: string } {
  try {
    // Get X-Amz-Date header
    const amzDate = req.headers['x-amz-date'] as string;
    if (!amzDate) {
      return { valid: false, reason: 'Missing X-Amz-Date header' };
    }

    const dateStamp = amzDate.substring(0, 8);
    
    // Parse credential scope
    const scopeParts = authParts.credentialScope.split('/');
    if (scopeParts.length !== 4) {
      return { valid: false, reason: 'Invalid credential scope format' };
    }
    const [scopeDate, region, service, terminator] = scopeParts;
    
    if (scopeDate !== dateStamp) {
      return { valid: false, reason: 'Date mismatch between credential scope and X-Amz-Date' };
    }
    
    if (terminator !== 'aws4_request') {
      return { valid: false, reason: 'Credential scope must end with aws4_request' };
    }

    // Build canonical request
    const method = req.method.toUpperCase();
    const canonicalUri = req.path || '/';
    
    // Build canonical query string (sorted)
    const queryParams = new URLSearchParams(req.query as Record<string, string>);
    const sortedParams = Array.from(queryParams.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const canonicalQuerystring = sortedParams.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

    // Build canonical headers
    const signedHeadersList = authParts.signedHeaders.split(';');
    const canonicalHeaders = signedHeadersList
      .map(h => {
        const value = req.headers[h.toLowerCase()];
        const headerValue = Array.isArray(value) ? value.join(',') : (value || '');
        return `${h.toLowerCase()}:${headerValue.trim()}`;
      })
      .join('\n') + '\n';

    // Get payload hash
    const payloadHash = (req.headers['x-amz-content-sha256'] as string) || sha256(JSON.stringify(req.body) || '');

    // Build canonical request
    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuerystring,
      canonicalHeaders,
      authParts.signedHeaders,
      payloadHash,
    ].join('\n');

    // Create string to sign
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256(canonicalRequest),
    ].join('\n');

    // Calculate signature
    const signingKey = getSigningKey(secretAccessKey, dateStamp, region, service);
    const expectedSignature = hmacSha256(signingKey, stringToSign).toString('hex');

    if (authParts.signature !== expectedSignature) {
      return { 
        valid: false, 
        reason: 'Signature mismatch',
        expectedSignature,
      };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, reason: `Validation error: ${err}` };
  }
}

// ============================================================================
// AWS Signature v4 Endpoints
// ============================================================================

/**
 * @openapi
 * components:
 *   securitySchemes:
 *     awsSigV4:
 *       type: apiKey
 *       in: header
 *       name: Authorization
 *       x-amazon-apigateway-authtype: awsSigv4
 *       description: |
 *         AWS Signature Version 4 authentication.
 *         
 *         **Test Credentials:**
 *         - Access Key ID: `AKIAIOSFODNN7EXAMPLE`
 *         - Secret Access Key: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`
 *         - Region: `us-east-1`
 *         - Service: `execute-api`
 *         
 *         **Required Headers:**
 *         - `Authorization`: AWS4-HMAC-SHA256 Credential=.../SignedHeaders=.../Signature=...
 *         - `X-Amz-Date`: Request timestamp in ISO 8601 format (YYYYMMDDTHHMMSSZ)
 *         - `Host`: The host header
 */

/**
 * @openapi
 * /auth/aws-sig/test:
 *   get:
 *     tags:
 *       - Authentication/AWS Sig V4
 *     summary: Test AWS Signature v4 Authentication
 *     description: |
 *       Tests AWS Signature Version 4 authentication.
 *       
 *       **Test Credentials:**
 *       - Access Key ID: `AKIAIOSFODNN7EXAMPLE`
 *       - Secret Access Key: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`
 *       - Region: `us-east-1`
 *       - Service: `execute-api`
 *       
 *       **Required Headers:**
 *       - `Authorization`: AWS Sig v4 authorization header
 *       - `X-Amz-Date`: Request timestamp (format: YYYYMMDDTHHMMSSZ)
 *       
 *       The endpoint validates the signature using the AWS Signature Version 4 algorithm.
 *     security:
 *       - awsSigV4: []
 *     responses:
 *       200:
 *         description: Authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 auth:
 *                   type: object
 *                   properties:
 *                     accessKeyId:
 *                       type: string
 *                     region:
 *                       type: string
 *                     service:
 *                       type: string
 *                     signedHeaders:
 *                       type: array
 *                       items:
 *                         type: string
 *                     authenticatedAt:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Authentication failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 hint:
 *                   type: string
 */
router.get('/test', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      error: 'Missing Authorization header',
      hint: 'Include AWS Signature v4 Authorization header',
      credentials: {
        accessKeyId: AWS_TEST_CREDENTIALS.accessKeyId,
        secretAccessKey: AWS_TEST_CREDENTIALS.secretAccessKey,
        region: AWS_TEST_CREDENTIALS.region,
        service: AWS_TEST_CREDENTIALS.service,
      },
    });
  }

  // Parse Authorization header
  const authParts = parseAwsAuthHeader(authHeader);
  if (!authParts) {
    return res.status(401).json({
      error: 'Invalid Authorization header format',
      hint: 'Authorization header must start with AWS4-HMAC-SHA256 and contain Credential, SignedHeaders, and Signature',
    });
  }

  // Check if access key matches
  if (authParts.accessKeyId !== AWS_TEST_CREDENTIALS.accessKeyId) {
    return res.status(401).json({
      error: 'Unknown access key',
      hint: `Use test access key: ${AWS_TEST_CREDENTIALS.accessKeyId}`,
    });
  }

  // Validate signature
  const validation = validateAwsSignature(req, authParts, AWS_TEST_CREDENTIALS.secretAccessKey);
  
  if (!validation.valid) {
    return res.status(401).json({
      error: 'Invalid signature',
      reason: validation.reason,
      hint: 'Ensure the signature is computed correctly using AWS Signature v4 algorithm',
      expectedSignature: validation.expectedSignature,
    });
  }

  // Parse credential scope for response
  const scopeParts = authParts.credentialScope.split('/');
  const [, region, service] = scopeParts;

  return res.json({
    success: true,
    message: 'AWS Signature v4 authentication successful',
    auth: {
      accessKeyId: authParts.accessKeyId,
      region,
      service,
      signedHeaders: authParts.signedHeaders.split(';'),
      authenticatedAt: new Date().toISOString(),
    },
  });
});

/**
 * @openapi
 * /auth/aws-sig/test:
 *   post:
 *     tags:
 *       - Authentication/AWS Sig V4
 *     summary: Test AWS Signature v4 with POST body
 *     description: |
 *       Tests AWS Signature Version 4 authentication with a POST request body.
 *       The signature must include the hashed request body.
 *       
 *       **Test Credentials:**
 *       - Access Key ID: `AKIAIOSFODNN7EXAMPLE`
 *       - Secret Access Key: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`
 *       - Region: `us-east-1`
 *       - Service: `execute-api`
 *     security:
 *       - awsSigV4: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               message:
 *                 type: string
 *                 description: A test message
 *             example:
 *               message: "Hello from AWS Sig v4 test!"
 *     responses:
 *       200:
 *         description: Authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 receivedBody:
 *                   type: object
 *                 auth:
 *                   type: object
 *       401:
 *         description: Authentication failed
 */
router.post('/test', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      error: 'Missing Authorization header',
      hint: 'Include AWS Signature v4 Authorization header',
      credentials: {
        accessKeyId: AWS_TEST_CREDENTIALS.accessKeyId,
        secretAccessKey: AWS_TEST_CREDENTIALS.secretAccessKey,
        region: AWS_TEST_CREDENTIALS.region,
        service: AWS_TEST_CREDENTIALS.service,
      },
    });
  }

  // Parse Authorization header
  const authParts = parseAwsAuthHeader(authHeader);
  if (!authParts) {
    return res.status(401).json({
      error: 'Invalid Authorization header format',
      hint: 'Authorization header must start with AWS4-HMAC-SHA256 and contain Credential, SignedHeaders, and Signature',
    });
  }

  // Check if access key matches
  if (authParts.accessKeyId !== AWS_TEST_CREDENTIALS.accessKeyId) {
    return res.status(401).json({
      error: 'Unknown access key',
      hint: `Use test access key: ${AWS_TEST_CREDENTIALS.accessKeyId}`,
    });
  }

  // Validate signature
  const validation = validateAwsSignature(req, authParts, AWS_TEST_CREDENTIALS.secretAccessKey);
  
  if (!validation.valid) {
    return res.status(401).json({
      error: 'Invalid signature',
      reason: validation.reason,
      hint: 'Ensure the signature is computed correctly using AWS Signature v4 algorithm',
      expectedSignature: validation.expectedSignature,
    });
  }

  // Parse credential scope for response
  const scopeParts = authParts.credentialScope.split('/');
  const [, region, service] = scopeParts;

  return res.json({
    success: true,
    message: 'AWS Signature v4 authentication successful (POST)',
    receivedBody: req.body,
    auth: {
      accessKeyId: authParts.accessKeyId,
      region,
      service,
      signedHeaders: authParts.signedHeaders.split(';'),
      authenticatedAt: new Date().toISOString(),
    },
  });
});

/**
 * @openapi
 * /auth/aws-sig/test-session:
 *   get:
 *     tags:
 *       - Authentication/AWS Sig V4
 *     summary: Test AWS Signature v4 with Session Token
 *     description: |
 *       Tests AWS Signature Version 4 authentication with temporary credentials (session token).
 *       This simulates AWS STS temporary credentials.
 *       
 *       **Test Credentials:**
 *       - Access Key ID: `AKIAIOSFODNN7EXAMPLE`
 *       - Secret Access Key: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`
 *       - Session Token: `FwoGZXIvYXdzEBYaDKWQ8DqEvDcWPbCwZyLYAQ==`
 *       - Region: `us-east-1`
 *       - Service: `execute-api`
 *       
 *       **Additional Required Header:**
 *       - `X-Amz-Security-Token`: The session token
 *     security:
 *       - awsSigV4: []
 *     responses:
 *       200:
 *         description: Authentication successful
 *       401:
 *         description: Authentication failed
 */
router.get('/test-session', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const sessionToken = req.headers['x-amz-security-token'] as string;

  if (!authHeader) {
    return res.status(401).json({
      error: 'Missing Authorization header',
      hint: 'Include AWS Signature v4 Authorization header with session token',
      credentials: {
        accessKeyId: AWS_TEST_CREDENTIALS.accessKeyId,
        secretAccessKey: AWS_TEST_CREDENTIALS.secretAccessKey,
        sessionToken: AWS_TEST_CREDENTIALS.sessionToken,
        region: AWS_TEST_CREDENTIALS.region,
        service: AWS_TEST_CREDENTIALS.service,
      },
    });
  }

  // Check session token
  if (!sessionToken) {
    return res.status(401).json({
      error: 'Missing X-Amz-Security-Token header',
      hint: `Include session token header: ${AWS_TEST_CREDENTIALS.sessionToken}`,
    });
  }

  if (sessionToken !== AWS_TEST_CREDENTIALS.sessionToken) {
    return res.status(401).json({
      error: 'Invalid session token',
      hint: `Use test session token: ${AWS_TEST_CREDENTIALS.sessionToken}`,
    });
  }

  // Parse Authorization header
  const authParts = parseAwsAuthHeader(authHeader);
  if (!authParts) {
    return res.status(401).json({
      error: 'Invalid Authorization header format',
      hint: 'Authorization header must start with AWS4-HMAC-SHA256 and contain Credential, SignedHeaders, and Signature',
    });
  }

  // Check if access key matches
  if (authParts.accessKeyId !== AWS_TEST_CREDENTIALS.accessKeyId) {
    return res.status(401).json({
      error: 'Unknown access key',
      hint: `Use test access key: ${AWS_TEST_CREDENTIALS.accessKeyId}`,
    });
  }

  // Validate signature
  const validation = validateAwsSignature(req, authParts, AWS_TEST_CREDENTIALS.secretAccessKey);
  
  if (!validation.valid) {
    return res.status(401).json({
      error: 'Invalid signature',
      reason: validation.reason,
      hint: 'Ensure the signature is computed correctly using AWS Signature v4 algorithm',
    });
  }

  // Parse credential scope for response
  const scopeParts = authParts.credentialScope.split('/');
  const [, region, service] = scopeParts;

  return res.json({
    success: true,
    message: 'AWS Signature v4 with session token authentication successful',
    auth: {
      accessKeyId: authParts.accessKeyId,
      region,
      service,
      hasSessionToken: true,
      signedHeaders: authParts.signedHeaders.split(';'),
      authenticatedAt: new Date().toISOString(),
    },
  });
});

/**
 * @openapi
 * /auth/aws-sig/credentials:
 *   get:
 *     tags:
 *       - Authentication/AWS Sig V4
 *     summary: Get AWS Signature v4 test credentials
 *     description: Returns the test credentials for AWS Signature v4 authentication
 *     responses:
 *       200:
 *         description: Test credentials
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessKeyId:
 *                   type: string
 *                 secretAccessKey:
 *                   type: string
 *                 region:
 *                   type: string
 *                 service:
 *                   type: string
 *                 sessionToken:
 *                   type: string
 *                 endpoints:
 *                   type: object
 *                 signingInstructions:
 *                   type: object
 */
router.get('/credentials', (_req: Request, res: Response) => {
  res.json({
    accessKeyId: AWS_TEST_CREDENTIALS.accessKeyId,
    secretAccessKey: AWS_TEST_CREDENTIALS.secretAccessKey,
    region: AWS_TEST_CREDENTIALS.region,
    service: AWS_TEST_CREDENTIALS.service,
    sessionToken: AWS_TEST_CREDENTIALS.sessionToken,
    endpoints: {
      test: '/auth/aws-sig/test (GET/POST)',
      testWithSession: '/auth/aws-sig/test-session (GET)',
      credentials: '/auth/aws-sig/credentials (GET)',
    },
    signingInstructions: {
      step1: 'Create a canonical request (method, URI, query string, headers, signed headers, payload hash)',
      step2: 'Create a string to sign (algorithm, timestamp, credential scope, canonical request hash)',
      step3: 'Calculate the signing key using HMAC-SHA256 chain',
      step4: 'Calculate the signature using the signing key and string to sign',
      step5: 'Add Authorization header with AWS4-HMAC-SHA256 algorithm',
      requiredHeaders: [
        'Host',
        'X-Amz-Date (format: YYYYMMDDTHHMMSSZ)',
        'Authorization',
        'X-Amz-Security-Token (optional, for temporary credentials)',
      ],
    },
  });
});

export default router;

