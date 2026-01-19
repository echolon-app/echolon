import { Router, Request, Response } from 'express';
import crypto from 'crypto';

// Import OAuth 2.0 routes
import oauth2Router, { OAUTH2_CONFIG } from './oauth2';

const router = Router();

// ============================================================================
// Authentication Test Credentials
// ============================================================================

// These are TEST credentials for demonstration purposes only
export const AUTH_CREDENTIALS = {
  // Basic Auth - username:password
  basic: {
    username: 'testuser',
    password: 'testpass123',
  },
  // Bearer Token
  bearer: {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dGVzdC10b2tlbi1lY2hvbG9u.test-signature',
  },
  // API Keys
  apiKey: {
    key: 'sk_test_echolon_api_key_12345',
    headerName: 'X-API-Key',
  },
  // JWT (simplified - in production use proper JWT library)
  jwt: {
    secret: 'echolon-jwt-secret-for-testing',
    issuer: 'echolon-sample-api',
  },
  // Digest Auth
  digest: {
    username: 'digestuser',
    password: 'digestpass456',
    realm: 'echolon-api',
    nonce: () => crypto.randomBytes(16).toString('hex'),
  },
  // OAuth 2.0 - imported from oauth2 module
  oauth2: OAUTH2_CONFIG,
};

// Store active nonces for digest auth
const digestNonces = new Map<string, { created: number; nc: number }>();

// ============================================================================
// Authentication Test Endpoints
// ============================================================================

/**
 * @openapi
 * components:
 *   securitySchemes:
 *     basicAuth:
 *       type: http
 *       scheme: basic
 *       description: |
 *         Basic authentication with username and password.
 *         
 *         **Test Credentials:**
 *         - Username: `testuser`
 *         - Password: `testpass123`
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       description: |
 *         Bearer token authentication.
 *         
 *         **Test Token:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dGVzdC10b2tlbi1lY2hvbG9u.test-signature`
 *     apiKeyHeader:
 *       type: apiKey
 *       in: header
 *       name: X-API-Key
 *       description: |
 *         API Key authentication via header.
 *         
 *         **Test Key:** `sk_test_echolon_api_key_12345`
 *     apiKeyQuery:
 *       type: apiKey
 *       in: query
 *       name: api_key
 *       description: |
 *         API Key authentication via query parameter.
 *         
 *         **Test Key:** `sk_test_echolon_api_key_12345`
 *     jwtBearer:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *       description: |
 *         JWT Bearer token authentication.
 *         
 *         Use the `/auth/jwt/token` endpoint to generate a valid JWT token.
 *     digestAuth:
 *       type: http
 *       scheme: digest
 *       description: |
 *         HTTP Digest authentication.
 *         
 *         **Test Credentials:**
 *         - Username: `digestuser`
 *         - Password: `digestpass456`
 */

/**
 * @openapi
 * /auth/basic:
 *   get:
 *     tags:
 *       - 5. Authentication
 *     summary: Test Basic Authentication
 *     description: |
 *       Tests HTTP Basic Authentication.
 *       
 *       **Test Credentials:**
 *       - Username: `testuser`
 *       - Password: `testpass123`
 *     security:
 *       - basicAuth: []
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
 *                 user:
 *                   type: object
 *                   properties:
 *                     username:
 *                       type: string
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
router.get('/basic', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="echolon-api"');
    return res.status(401).json({
      error: 'Missing or invalid Authorization header',
      hint: 'Use Basic auth with username: testuser, password: testpass123',
    });
  }
  
  try {
    const base64Credentials = authHeader.slice(6);
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    const [username, password] = credentials.split(':');
    
    if (username === AUTH_CREDENTIALS.basic.username && password === AUTH_CREDENTIALS.basic.password) {
      return res.json({
        success: true,
        message: 'Basic authentication successful',
        user: {
          username,
          authenticatedAt: new Date().toISOString(),
        },
      });
    }
    
    res.setHeader('WWW-Authenticate', 'Basic realm="echolon-api"');
    return res.status(401).json({
      error: 'Invalid credentials',
      hint: 'Use username: testuser, password: testpass123',
    });
  } catch {
    res.setHeader('WWW-Authenticate', 'Basic realm="echolon-api"');
    return res.status(401).json({
      error: 'Invalid Authorization header format',
      hint: 'Authorization header should be: Basic base64(username:password)',
    });
  }
});

/**
 * @openapi
 * /auth/bearer:
 *   get:
 *     tags:
 *       - 5. Authentication
 *     summary: Test Bearer Token Authentication
 *     description: |
 *       Tests Bearer Token authentication.
 *       
 *       **Test Token:**
 *       ```
 *       eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dGVzdC10b2tlbi1lY2hvbG9u.test-signature
 *       ```
 *     security:
 *       - bearerAuth: []
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
 *                 token:
 *                   type: object
 *                   properties:
 *                     value:
 *                       type: string
 *                     validatedAt:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Authentication failed
 */
router.get('/bearer', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Missing or invalid Authorization header',
      hint: 'Use Bearer token: ' + AUTH_CREDENTIALS.bearer.token,
    });
  }
  
  const token = authHeader.slice(7);
  
  if (token === AUTH_CREDENTIALS.bearer.token) {
    return res.json({
      success: true,
      message: 'Bearer token authentication successful',
      token: {
        value: token.slice(0, 20) + '...',
        validatedAt: new Date().toISOString(),
      },
    });
  }
  
  return res.status(401).json({
    error: 'Invalid bearer token',
    hint: 'Use token: ' + AUTH_CREDENTIALS.bearer.token,
  });
});

/**
 * @openapi
 * /auth/api-key:
 *   get:
 *     tags:
 *       - 5. Authentication
 *     summary: Test API Key Authentication
 *     description: |
 *       Tests API Key authentication via header or query parameter.
 *       
 *       **Test API Key:** `sk_test_echolon_api_key_12345`
 *       
 *       Can be provided as:
 *       - Header: `X-API-Key: sk_test_echolon_api_key_12345`
 *       - Query: `?api_key=sk_test_echolon_api_key_12345`
 *     security:
 *       - apiKeyHeader: []
 *       - apiKeyQuery: []
 *     parameters:
 *       - in: query
 *         name: api_key
 *         schema:
 *           type: string
 *         description: API key (alternative to header)
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
 *                 apiKey:
 *                   type: object
 *                   properties:
 *                     source:
 *                       type: string
 *                       enum: [header, query]
 *                     validatedAt:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Authentication failed
 */
router.get('/api-key', (req: Request, res: Response) => {
  const headerKey = req.headers['x-api-key'] as string;
  const queryKey = req.query.api_key as string;
  
  const apiKey = headerKey || queryKey;
  const source = headerKey ? 'header' : queryKey ? 'query' : null;
  
  if (!apiKey) {
    return res.status(401).json({
      error: 'Missing API key',
      hint: `Provide API key via X-API-Key header or api_key query param. Test key: ${AUTH_CREDENTIALS.apiKey.key}`,
    });
  }
  
  if (apiKey === AUTH_CREDENTIALS.apiKey.key) {
    return res.json({
      success: true,
      message: 'API key authentication successful',
      apiKey: {
        source,
        validatedAt: new Date().toISOString(),
      },
    });
  }
  
  return res.status(401).json({
    error: 'Invalid API key',
    hint: `Use test key: ${AUTH_CREDENTIALS.apiKey.key}`,
  });
});

/**
 * @openapi
 * /auth/jwt:
 *   get:
 *     tags:
 *       - 5. Authentication
 *     summary: Test JWT Bearer Authentication
 *     description: |
 *       Tests JWT Bearer token authentication. This endpoint validates JWT structure and signature.
 *       
 *       **Generate a test JWT:**
 *       Use the `/auth/jwt/token` endpoint to generate a valid test token.
 *     security:
 *       - jwtBearer: []
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
 *                 jwt:
 *                   type: object
 *                   properties:
 *                     header:
 *                       type: object
 *                     payload:
 *                       type: object
 *                     validatedAt:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Authentication failed
 */
router.get('/jwt', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Missing or invalid Authorization header',
      hint: 'Get a test token from /auth/jwt/token endpoint',
    });
  }
  
  const token = authHeader.slice(7);
  
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return res.status(401).json({
        error: 'Invalid JWT format',
        hint: 'JWT must have 3 parts: header.payload.signature',
      });
    }
    
    const [headerB64, payloadB64, signature] = parts;
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    
    // Verify signature (simplified)
    const expectedSignature = crypto
      .createHmac('sha256', AUTH_CREDENTIALS.jwt.secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');
    
    if (signature !== expectedSignature) {
      return res.status(401).json({
        error: 'Invalid JWT signature',
        hint: 'Get a valid token from /auth/jwt/token endpoint',
      });
    }
    
    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return res.status(401).json({
        error: 'JWT has expired',
        hint: 'Get a new token from /auth/jwt/token endpoint',
      });
    }
    
    // Check issuer
    if (payload.iss !== AUTH_CREDENTIALS.jwt.issuer) {
      return res.status(401).json({
        error: 'Invalid JWT issuer',
        hint: 'Token must be issued by echolon-sample-api',
      });
    }
    
    return res.json({
      success: true,
      message: 'JWT authentication successful',
      jwt: {
        header,
        payload,
        validatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return res.status(401).json({
      error: 'Failed to parse JWT',
      hint: 'Get a valid token from /auth/jwt/token endpoint',
    });
  }
});

/**
 * @openapi
 * /auth/jwt/token:
 *   post:
 *     tags:
 *       - 5. Authentication
 *     summary: Generate a test JWT token
 *     description: |
 *       Generates a valid JWT token for testing the `/auth/jwt` endpoint.
 *       
 *       Optionally provide a custom payload and expiration time.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sub:
 *                 type: string
 *                 description: Subject (user identifier)
 *                 default: test-user
 *               name:
 *                 type: string
 *                 description: User's name
 *                 default: Test User
 *               role:
 *                 type: string
 *                 description: User's role
 *                 default: user
 *               expiresIn:
 *                 type: integer
 *                 description: Token expiration in seconds
 *                 default: 3600
 *     responses:
 *       200:
 *         description: JWT token generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 expiresAt:
 *                   type: string
 *                   format: date-time
 *                 usage:
 *                   type: string
 */
router.post('/jwt/token', (req: Request, res: Response) => {
  const { sub = 'test-user', name = 'Test User', role = 'user', expiresIn = 3600 } = req.body || {};
  
  const now = Math.floor(Date.now() / 1000);
  const exp = now + expiresIn;
  
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };
  
  const payload = {
    iss: AUTH_CREDENTIALS.jwt.issuer,
    sub,
    name,
    role,
    iat: now,
    exp,
  };
  
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  
  const signature = crypto
    .createHmac('sha256', AUTH_CREDENTIALS.jwt.secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  
  const token = `${headerB64}.${payloadB64}.${signature}`;
  
  res.json({
    token,
    expiresAt: new Date(exp * 1000).toISOString(),
    usage: 'Add to Authorization header as: Bearer ' + token.slice(0, 30) + '...',
  });
});

/**
 * @openapi
 * /auth/digest:
 *   get:
 *     tags:
 *       - 5. Authentication
 *     summary: Test Digest Authentication
 *     description: |
 *       Tests HTTP Digest Authentication (RFC 7616).
 *       
 *       **Test Credentials:**
 *       - Username: `digestuser`
 *       - Password: `digestpass456`
 *       - Realm: `echolon-api`
 *       
 *       This endpoint implements the challenge-response flow:
 *       1. First request returns 401 with WWW-Authenticate header containing nonce
 *       2. Client computes response hash and sends Authorization header
 *       3. Server validates the response
 *     security:
 *       - digestAuth: []
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
 *                 user:
 *                   type: object
 *                   properties:
 *                     username:
 *                       type: string
 *                     authenticatedAt:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Authentication required or failed
 *         headers:
 *           WWW-Authenticate:
 *             schema:
 *               type: string
 *             description: Digest authentication challenge
 */
router.get('/digest', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  
  // Clean up old nonces (older than 5 minutes)
  const now = Date.now();
  for (const [nonce, data] of digestNonces.entries()) {
    if (now - data.created > 300000) {
      digestNonces.delete(nonce);
    }
  }
  
  if (!authHeader || !authHeader.startsWith('Digest ')) {
    // Send challenge
    const nonce = AUTH_CREDENTIALS.digest.nonce();
    digestNonces.set(nonce, { created: now, nc: 0 });
    
    const challenge = `Digest realm="${AUTH_CREDENTIALS.digest.realm}", nonce="${nonce}", qop="auth", algorithm=MD5`;
    res.setHeader('WWW-Authenticate', challenge);
    return res.status(401).json({
      error: 'Digest authentication required',
      hint: 'Use username: digestuser, password: digestpass456',
    });
  }
  
  // Parse digest auth header
  const authParams: Record<string, string> = {};
  const paramRegex = /(\w+)=(?:"([^"]+)"|([^\s,]+))/g;
  let match;
  while ((match = paramRegex.exec(authHeader)) !== null) {
    authParams[match[1]] = match[2] || match[3];
  }
  
  const { username, realm, nonce, uri, nc, cnonce, qop, response } = authParams;
  
  // Validate nonce
  if (!nonce || !digestNonces.has(nonce)) {
    const newNonce = AUTH_CREDENTIALS.digest.nonce();
    digestNonces.set(newNonce, { created: now, nc: 0 });
    
    const challenge = `Digest realm="${AUTH_CREDENTIALS.digest.realm}", nonce="${newNonce}", qop="auth", algorithm=MD5, stale=true`;
    res.setHeader('WWW-Authenticate', challenge);
    return res.status(401).json({
      error: 'Invalid or expired nonce',
      hint: 'Retry with the new nonce from WWW-Authenticate header',
    });
  }
  
  // Validate credentials
  if (username !== AUTH_CREDENTIALS.digest.username || realm !== AUTH_CREDENTIALS.digest.realm) {
    return res.status(401).json({
      error: 'Invalid credentials',
      hint: 'Use username: digestuser, password: digestpass456, realm: echolon-api',
    });
  }
  
  // Calculate expected response
  const ha1 = crypto.createHash('md5')
    .update(`${AUTH_CREDENTIALS.digest.username}:${AUTH_CREDENTIALS.digest.realm}:${AUTH_CREDENTIALS.digest.password}`)
    .digest('hex');
  
  const ha2 = crypto.createHash('md5')
    .update(`${req.method}:${uri}`)
    .digest('hex');
  
  let expectedResponse: string;
  if (qop === 'auth') {
    expectedResponse = crypto.createHash('md5')
      .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
      .digest('hex');
  } else {
    expectedResponse = crypto.createHash('md5')
      .update(`${ha1}:${nonce}:${ha2}`)
      .digest('hex');
  }
  
  if (response !== expectedResponse) {
    return res.status(401).json({
      error: 'Invalid digest response',
      hint: 'The computed response hash does not match',
    });
  }
  
  // Clean up used nonce
  digestNonces.delete(nonce);
  
  return res.json({
    success: true,
    message: 'Digest authentication successful',
    user: {
      username,
      authenticatedAt: new Date().toISOString(),
    },
  });
});

// ============================================================================
// OAuth 2.0 Routes (mounted from separate module)
// ============================================================================

router.use('/oauth2', oauth2Router);

// ============================================================================
// Credentials Endpoint
// ============================================================================

/**
 * @openapi
 * /auth/credentials:
 *   get:
 *     tags:
 *       - 5. Authentication
 *     summary: Get test credentials
 *     description: Returns all test credentials for the authentication endpoints
 *     responses:
 *       200:
 *         description: Test credentials
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 basic:
 *                   type: object
 *                   properties:
 *                     username:
 *                       type: string
 *                     password:
 *                       type: string
 *                 bearer:
 *                   type: object
 *                   properties:
 *                     token:
 *                       type: string
 *                 apiKey:
 *                   type: object
 *                   properties:
 *                     key:
 *                       type: string
 *                     headerName:
 *                       type: string
 *                 jwt:
 *                   type: object
 *                   properties:
 *                     note:
 *                       type: string
 *                 digest:
 *                   type: object
 *                   properties:
 *                     username:
 *                       type: string
 *                     password:
 *                       type: string
 *                     realm:
 *                       type: string
 *                 oauth2:
 *                   type: object
 *                   properties:
 *                     clients:
 *                       type: array
 *                       items:
 *                         type: object
 *                     users:
 *                       type: array
 *                       items:
 *                         type: object
 *                     endpoints:
 *                       type: object
 */
router.get('/credentials', (_req: Request, res: Response) => {
  res.json({
    basic: {
      username: AUTH_CREDENTIALS.basic.username,
      password: AUTH_CREDENTIALS.basic.password,
      example: `Authorization: Basic ${Buffer.from(`${AUTH_CREDENTIALS.basic.username}:${AUTH_CREDENTIALS.basic.password}`).toString('base64')}`,
    },
    bearer: {
      token: AUTH_CREDENTIALS.bearer.token,
      example: `Authorization: Bearer ${AUTH_CREDENTIALS.bearer.token}`,
    },
    apiKey: {
      key: AUTH_CREDENTIALS.apiKey.key,
      headerName: AUTH_CREDENTIALS.apiKey.headerName,
      exampleHeader: `X-API-Key: ${AUTH_CREDENTIALS.apiKey.key}`,
      exampleQuery: `?api_key=${AUTH_CREDENTIALS.apiKey.key}`,
    },
    jwt: {
      note: 'Generate a token using POST /auth/jwt/token',
      tokenEndpoint: '/auth/jwt/token',
    },
    digest: {
      username: AUTH_CREDENTIALS.digest.username,
      password: AUTH_CREDENTIALS.digest.password,
      realm: AUTH_CREDENTIALS.digest.realm,
    },
    oauth2: {
      clients: AUTH_CREDENTIALS.oauth2.clients.map(c => ({
        clientId: c.clientId,
        clientSecret: c.clientSecret || '(public client - no secret required)',
        name: c.name,
        redirectUris: c.redirectUris,
      })),
      users: AUTH_CREDENTIALS.oauth2.users.map(u => ({
        username: u.username,
        password: u.password,
      })),
      endpoints: {
        authorize: '/auth/oauth2/authorize',
        token: '/auth/oauth2/token',
        resource: '/auth/oauth2/resource',
        revoke: '/auth/oauth2/revoke',
        introspect: '/auth/oauth2/introspect',
      },
      flows: {
        authorization_code: {
          description: 'Standard OAuth 2.0 authorization code flow',
          steps: [
            '1. GET /auth/oauth2/authorize?response_type=code&client_id=echolon-test-client&redirect_uri=http://localhost:3000/callback&scope=read',
            '2. User is redirected with authorization code',
            '3. POST /auth/oauth2/token with grant_type=authorization_code&code=<code>&redirect_uri=<uri>&client_id=<id>&client_secret=<secret>',
          ],
        },
        client_credentials: {
          description: 'Machine-to-machine authentication',
          example: 'POST /auth/oauth2/token with grant_type=client_credentials&client_id=echolon-test-client&client_secret=echolon-test-secret-12345&scope=read',
        },
        password: {
          description: 'Direct username/password authentication',
          example: 'POST /auth/oauth2/token with grant_type=password&client_id=echolon-test-client&username=oauth_user&password=oauth_pass123&scope=read',
        },
        implicit: {
          description: 'Implicit flow (returns token directly in redirect)',
          example: 'GET /auth/oauth2/authorize?response_type=token&client_id=echolon-test-client&redirect_uri=http://localhost:3000/callback&scope=read',
        },
      },
    },
    awsSignature: {
      note: 'AWS Signature v4 endpoints are at /auth/aws-sig/*',
      credentialsEndpoint: '/auth/aws-sig/credentials',
      testEndpoint: '/auth/aws-sig/test',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      service: 'execute-api',
      sessionToken: 'FwoGZXIvYXdzEBYaDKWQ8DqEvDcWPbCwZyLYAQ==',
    },
  });
});

export default router;
