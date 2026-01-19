import { Router, Request, Response } from 'express';
import express from 'express';
import crypto from 'crypto';

const router = Router();

// ============================================================================
// OAuth 2.0 Configuration
// ============================================================================

export const OAUTH2_CONFIG = {
  // Registered clients
  clients: [
    {
      clientId: 'echolon-test-client',
      clientSecret: 'echolon-test-secret-12345',
      redirectUris: ['http://localhost:3000/callback', 'https://echolon.app/callback', 'http://127.0.0.1/callback'],
      name: 'Echolon Test App',
    },
    {
      clientId: 'public-client',
      clientSecret: null, // Public client (no secret required)
      redirectUris: ['http://localhost:3000/callback', 'http://127.0.0.1/callback'],
      name: 'Public Test App',
    },
  ],
  // Test user for password grant
  users: [
    { username: 'oauth_user', password: 'oauth_pass123', userId: 'user-001' },
    { username: 'admin', password: 'admin123', userId: 'user-002' },
  ],
  // Token settings
  accessTokenLifetime: 3600, // 1 hour
  refreshTokenLifetime: 86400, // 24 hours
};

// ============================================================================
// Token Storage (In-memory for demo purposes)
// ============================================================================

const oauthAuthorizationCodes = new Map<string, {
  code: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  userId: string;
  expiresAt: number;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}>();

const oauthAccessTokens = new Map<string, {
  token: string;
  clientId: string;
  userId?: string;
  scope: string;
  expiresAt: number;
  tokenType: string;
}>();

const oauthRefreshTokens = new Map<string, {
  token: string;
  clientId: string;
  userId?: string;
  scope: string;
  expiresAt: number;
}>();

// ============================================================================
// Helper Functions
// ============================================================================

function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

function findClient(clientId: string) {
  return OAUTH2_CONFIG.clients.find(c => c.clientId === clientId);
}

function validateClientCredentials(clientId: string, clientSecret: string | null): boolean {
  const client = findClient(clientId);
  if (!client) return false;
  if (client.clientSecret === null) return true;
  return client.clientSecret === clientSecret;
}

function validateUserCredentials(username: string, password: string) {
  return OAUTH2_CONFIG.users.find(
    u => u.username === username && u.password === password
  );
}

// ============================================================================
// OpenAPI Security Schemes
// ============================================================================

/**
 * @openapi
 * components:
 *   securitySchemes:
 *     oauth2AuthCode:
 *       type: oauth2
 *       description: |
 *         OAuth 2.0 Authorization Code flow.
 *         
 *         **Test Client:**
 *         - Client ID: `echolon-test-client`
 *         - Client Secret: `echolon-test-secret-12345`
 *         - Redirect URIs: `http://localhost:3000/callback`, `https://echolon.app/callback`
 *       flows:
 *         authorizationCode:
 *           authorizationUrl: https://sample-api.echolon.app/auth/oauth2/authorize
 *           tokenUrl: https://sample-api.echolon.app/auth/oauth2/token
 *           scopes:
 *             read: Read access to resources
 *             write: Write access to resources
 *             profile: Access to user profile
 *             admin: Administrative access
 *     oauth2ClientCredentials:
 *       type: oauth2
 *       description: |
 *         OAuth 2.0 Client Credentials flow (machine-to-machine).
 *         
 *         **Test Client:**
 *         - Client ID: `echolon-test-client`
 *         - Client Secret: `echolon-test-secret-12345`
 *       flows:
 *         clientCredentials:
 *           tokenUrl: https://sample-api.echolon.app/auth/oauth2/token
 *           scopes:
 *             read: Read access to resources
 *             write: Write access to resources
 *     oauth2Password:
 *       type: oauth2
 *       description: |
 *         OAuth 2.0 Password Grant flow.
 *         
 *         **Test Credentials:**
 *         - Client ID: `echolon-test-client`
 *         - Username: `oauth_user`
 *         - Password: `oauth_pass123`
 *       flows:
 *         password:
 *           tokenUrl: https://sample-api.echolon.app/auth/oauth2/token
 *           scopes:
 *             read: Read access to resources
 *             write: Write access to resources
 *             profile: Access to user profile
 */

// ============================================================================
// OAuth 2.0 Endpoints
// ============================================================================

/**
 * @openapi
 * /auth/oauth2/authorize:
 *   get:
 *     tags:
 *       - 6. Authentication/OAuth 2.0
 *     summary: OAuth 2.0 Authorization Endpoint
 *     description: |
 *       Initiates the OAuth 2.0 authorization flow. This endpoint is used for:
 *       - **Authorization Code** flow (response_type=code)
 *       - **Implicit** flow (response_type=token)
 *       
 *       For testing purposes, this endpoint automatically approves the authorization
 *       and returns the code/token without showing a login UI.
 *       
 *       **Test Client:**
 *       - Client ID: `echolon-test-client`
 *       - Redirect URIs: `http://localhost:3000/callback`, `https://echolon.app/callback`
 *       
 *       **PKCE Support:**
 *       For Authorization Code flow, PKCE is supported:
 *       - `code_challenge`: The challenge derived from code_verifier
 *       - `code_challenge_method`: Either `plain` or `S256`
 *     parameters:
 *       - in: query
 *         name: response_type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [code, token]
 *         description: The type of response (code for auth code, token for implicit)
 *       - in: query
 *         name: client_id
 *         required: true
 *         schema:
 *           type: string
 *         description: The client identifier
 *       - in: query
 *         name: redirect_uri
 *         required: true
 *         schema:
 *           type: string
 *         description: The URI to redirect to after authorization
 *       - in: query
 *         name: scope
 *         schema:
 *           type: string
 *         description: Space-separated list of scopes (e.g., "read write profile")
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         description: Opaque value to prevent CSRF attacks
 *       - in: query
 *         name: code_challenge
 *         schema:
 *           type: string
 *         description: PKCE code challenge (for authorization code flow)
 *       - in: query
 *         name: code_challenge_method
 *         schema:
 *           type: string
 *           enum: [plain, S256]
 *         description: PKCE code challenge method
 *     responses:
 *       302:
 *         description: Redirects to redirect_uri with code or token
 *       400:
 *         description: Invalid request parameters
 */
router.get('/authorize', (req: Request, res: Response) => {
  const {
    response_type,
    client_id,
    redirect_uri,
    scope = 'read',
    state,
    code_challenge,
    code_challenge_method,
  } = req.query as Record<string, string>;

  // Validate required parameters
  if (!response_type || !client_id || !redirect_uri) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing required parameters: response_type, client_id, redirect_uri',
    });
  }

  // Validate client
  const client = findClient(client_id);
  if (!client) {
    return res.status(400).json({
      error: 'invalid_client',
      error_description: 'Unknown client_id',
    });
  }

  // Validate redirect_uri
  if (!client.redirectUris.includes(redirect_uri)) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Invalid redirect_uri for this client',
    });
  }

  // Handle different response types
  if (response_type === 'code') {
    // Authorization Code flow
    const code = generateToken(16);
    const expiresAt = Date.now() + 600000; // 10 minutes

    oauthAuthorizationCodes.set(code, {
      code,
      clientId: client_id,
      redirectUri: redirect_uri,
      scope,
      userId: 'test-user-001', // In production, this would be the authenticated user
      expiresAt,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
    });

    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set('code', code);
    if (state) redirectUrl.searchParams.set('state', state);

    return res.redirect(302, redirectUrl.toString());
  } else if (response_type === 'token') {
    // Implicit flow
    const accessToken = generateToken();
    const expiresIn = OAUTH2_CONFIG.accessTokenLifetime;

    oauthAccessTokens.set(accessToken, {
      token: accessToken,
      clientId: client_id,
      userId: 'test-user-001',
      scope,
      expiresAt: Date.now() + expiresIn * 1000,
      tokenType: 'Bearer',
    });

    // Implicit flow returns token in fragment (hash)
    const redirectUrl = new URL(redirect_uri);
    const fragment = new URLSearchParams({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: String(expiresIn),
      scope,
      ...(state && { state }),
    });

    return res.redirect(302, `${redirectUrl.origin}${redirectUrl.pathname}#${fragment.toString()}`);
  }

  return res.status(400).json({
    error: 'unsupported_response_type',
    error_description: 'response_type must be "code" or "token"',
  });
});

/**
 * @openapi
 * /auth/oauth2/token:
 *   post:
 *     tags:
 *       - 6. Authentication/OAuth 2.0
 *     summary: OAuth 2.0 Token Endpoint
 *     description: |
 *       Exchange credentials for an access token. Supports multiple grant types:
 *       
 *       **Authorization Code** (`grant_type=authorization_code`):
 *       - Exchange an authorization code for tokens
 *       - Requires: `code`, `redirect_uri`, `client_id`
 *       - PKCE: Include `code_verifier` if PKCE was used
 *       
 *       **Client Credentials** (`grant_type=client_credentials`):
 *       - Machine-to-machine authentication
 *       - Requires: `client_id`, `client_secret`
 *       
 *       **Password Grant** (`grant_type=password`):
 *       - Direct username/password exchange
 *       - Requires: `username`, `password`, `client_id`
 *       - Test user: `oauth_user` / `oauth_pass123`
 *       
 *       **Refresh Token** (`grant_type=refresh_token`):
 *       - Exchange a refresh token for new tokens
 *       - Requires: `refresh_token`, `client_id`
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required:
 *               - grant_type
 *             properties:
 *               grant_type:
 *                 type: string
 *                 enum: [authorization_code, client_credentials, password, refresh_token]
 *                 description: The grant type
 *               code:
 *                 type: string
 *                 description: Authorization code (for authorization_code grant)
 *               redirect_uri:
 *                 type: string
 *                 description: Must match the redirect_uri from authorization (for authorization_code grant)
 *               client_id:
 *                 type: string
 *                 description: The client identifier
 *               client_secret:
 *                 type: string
 *                 description: The client secret (for confidential clients)
 *               username:
 *                 type: string
 *                 description: User's username (for password grant)
 *               password:
 *                 type: string
 *                 description: User's password (for password grant)
 *               refresh_token:
 *                 type: string
 *                 description: Refresh token (for refresh_token grant)
 *               scope:
 *                 type: string
 *                 description: Space-separated list of scopes
 *               code_verifier:
 *                 type: string
 *                 description: PKCE code verifier (for authorization_code with PKCE)
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - grant_type
 *             properties:
 *               grant_type:
 *                 type: string
 *                 enum: [authorization_code, client_credentials, password, refresh_token]
 *               code:
 *                 type: string
 *               redirect_uri:
 *                 type: string
 *               client_id:
 *                 type: string
 *               client_secret:
 *                 type: string
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *               refresh_token:
 *                 type: string
 *               scope:
 *                 type: string
 *               code_verifier:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 access_token:
 *                   type: string
 *                   description: The access token
 *                 token_type:
 *                   type: string
 *                   description: Token type (always "Bearer")
 *                 expires_in:
 *                   type: integer
 *                   description: Token lifetime in seconds
 *                 refresh_token:
 *                   type: string
 *                   description: Refresh token (not returned for client_credentials)
 *                 scope:
 *                   type: string
 *                   description: Granted scopes
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Invalid client credentials
 */
router.post('/token', express.urlencoded({ extended: true }), (req: Request, res: Response) => {
  // Support both form-urlencoded and JSON
  const body = req.body || {};
  const {
    grant_type,
    code,
    redirect_uri,
    client_id,
    client_secret,
    username,
    password,
    refresh_token,
    scope,
    code_verifier,
  } = body;

  // Also check Authorization header for client credentials
  let authClientId = client_id;
  let authClientSecret = client_secret;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Basic ')) {
    try {
      const base64Credentials = authHeader.slice(6);
      const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
      const [id, secret] = credentials.split(':');
      authClientId = authClientId || id;
      authClientSecret = authClientSecret || secret;
    } catch {
      // Ignore parse errors
    }
  }

  if (!grant_type) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing grant_type parameter',
    });
  }

  // Handle different grant types
  switch (grant_type) {
    case 'authorization_code': {
      if (!code || !authClientId) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing required parameters for authorization_code grant',
        });
      }

      const authCode = oauthAuthorizationCodes.get(code);
      if (!authCode) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Invalid or expired authorization code',
        });
      }

      // Validate the code
      if (authCode.clientId !== authClientId) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Authorization code was not issued to this client',
        });
      }

      if (redirect_uri && authCode.redirectUri !== redirect_uri) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'redirect_uri mismatch',
        });
      }

      if (authCode.expiresAt < Date.now()) {
        oauthAuthorizationCodes.delete(code);
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Authorization code has expired',
        });
      }

      // Validate PKCE if it was used
      if (authCode.codeChallenge) {
        if (!code_verifier) {
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'code_verifier required for PKCE',
          });
        }

        let computedChallenge: string;
        if (authCode.codeChallengeMethod === 'S256') {
          computedChallenge = crypto
            .createHash('sha256')
            .update(code_verifier)
            .digest('base64url');
        } else {
          computedChallenge = code_verifier;
        }

        if (computedChallenge !== authCode.codeChallenge) {
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Invalid code_verifier',
          });
        }
      }

      // Delete the used code
      oauthAuthorizationCodes.delete(code);

      // Generate tokens
      const accessToken = generateToken();
      const refreshToken = generateToken();
      const expiresIn = OAUTH2_CONFIG.accessTokenLifetime;

      oauthAccessTokens.set(accessToken, {
        token: accessToken,
        clientId: authClientId,
        userId: authCode.userId,
        scope: authCode.scope,
        expiresAt: Date.now() + expiresIn * 1000,
        tokenType: 'Bearer',
      });

      oauthRefreshTokens.set(refreshToken, {
        token: refreshToken,
        clientId: authClientId,
        userId: authCode.userId,
        scope: authCode.scope,
        expiresAt: Date.now() + OAUTH2_CONFIG.refreshTokenLifetime * 1000,
      });

      return res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: expiresIn,
        refresh_token: refreshToken,
        scope: authCode.scope,
      });
    }

    case 'client_credentials': {
      if (!authClientId || !authClientSecret) {
        return res.status(401).json({
          error: 'invalid_client',
          error_description: 'Client authentication required',
        });
      }

      if (!validateClientCredentials(authClientId, authClientSecret)) {
        return res.status(401).json({
          error: 'invalid_client',
          error_description: 'Invalid client credentials',
        });
      }

      const accessToken = generateToken();
      const expiresIn = OAUTH2_CONFIG.accessTokenLifetime;
      const grantedScope = scope || 'read';

      oauthAccessTokens.set(accessToken, {
        token: accessToken,
        clientId: authClientId,
        scope: grantedScope,
        expiresAt: Date.now() + expiresIn * 1000,
        tokenType: 'Bearer',
      });

      // Client credentials doesn't return refresh token
      return res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: expiresIn,
        scope: grantedScope,
      });
    }

    case 'password': {
      if (!username || !password || !authClientId) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing required parameters for password grant',
        });
      }

      // Validate client
      const client = findClient(authClientId);
      if (!client) {
        return res.status(401).json({
          error: 'invalid_client',
          error_description: 'Unknown client',
        });
      }

      // Confidential clients must authenticate
      if (client.clientSecret && !validateClientCredentials(authClientId, authClientSecret)) {
        return res.status(401).json({
          error: 'invalid_client',
          error_description: 'Client authentication failed',
        });
      }

      // Validate user credentials
      const user = validateUserCredentials(username, password);
      if (!user) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Invalid username or password',
        });
      }

      const accessToken = generateToken();
      const refreshToken = generateToken();
      const expiresIn = OAUTH2_CONFIG.accessTokenLifetime;
      const grantedScope = scope || 'read';

      oauthAccessTokens.set(accessToken, {
        token: accessToken,
        clientId: authClientId,
        userId: user.userId,
        scope: grantedScope,
        expiresAt: Date.now() + expiresIn * 1000,
        tokenType: 'Bearer',
      });

      oauthRefreshTokens.set(refreshToken, {
        token: refreshToken,
        clientId: authClientId,
        userId: user.userId,
        scope: grantedScope,
        expiresAt: Date.now() + OAUTH2_CONFIG.refreshTokenLifetime * 1000,
      });

      return res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: expiresIn,
        refresh_token: refreshToken,
        scope: grantedScope,
      });
    }

    case 'refresh_token': {
      if (!refresh_token || !authClientId) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing required parameters for refresh_token grant',
        });
      }

      const storedRefresh = oauthRefreshTokens.get(refresh_token);
      if (!storedRefresh) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Invalid refresh token',
        });
      }

      if (storedRefresh.clientId !== authClientId) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Refresh token was not issued to this client',
        });
      }

      if (storedRefresh.expiresAt < Date.now()) {
        oauthRefreshTokens.delete(refresh_token);
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Refresh token has expired',
        });
      }

      // Generate new tokens
      const newAccessToken = generateToken();
      const newRefreshToken = generateToken();
      const expiresIn = OAUTH2_CONFIG.accessTokenLifetime;
      const grantedScope = scope || storedRefresh.scope;

      // Revoke old refresh token
      oauthRefreshTokens.delete(refresh_token);

      oauthAccessTokens.set(newAccessToken, {
        token: newAccessToken,
        clientId: authClientId,
        userId: storedRefresh.userId,
        scope: grantedScope,
        expiresAt: Date.now() + expiresIn * 1000,
        tokenType: 'Bearer',
      });

      oauthRefreshTokens.set(newRefreshToken, {
        token: newRefreshToken,
        clientId: authClientId,
        userId: storedRefresh.userId,
        scope: grantedScope,
        expiresAt: Date.now() + OAUTH2_CONFIG.refreshTokenLifetime * 1000,
      });

      return res.json({
        access_token: newAccessToken,
        token_type: 'Bearer',
        expires_in: expiresIn,
        refresh_token: newRefreshToken,
        scope: grantedScope,
      });
    }

    default:
      return res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: `Grant type '${grant_type}' is not supported`,
      });
  }
});

/**
 * @openapi
 * /auth/oauth2/resource:
 *   get:
 *     tags:
 *       - 6. Authentication/OAuth 2.0
 *     summary: OAuth 2.0 Protected Resource
 *     description: |
 *       A protected resource that requires a valid OAuth 2.0 access token.
 *       
 *       Include the access token in the Authorization header:
 *       ```
 *       Authorization: Bearer <access_token>
 *       ```
 *     security:
 *       - oauth2AuthCode: [read]
 *       - oauth2ClientCredentials: [read]
 *       - oauth2Password: [read]
 *     responses:
 *       200:
 *         description: Resource data
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
 *                     clientId:
 *                       type: string
 *                     userId:
 *                       type: string
 *                     scope:
 *                       type: string
 *                     expiresIn:
 *                       type: integer
 *                 data:
 *                   type: object
 *                   properties:
 *                     secretMessage:
 *                       type: string
 *                     timestamp:
 *                       type: string
 *       401:
 *         description: Invalid or missing access token
 */
router.get('/resource', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'invalid_token',
      error_description: 'Missing or invalid Authorization header. Use: Bearer <access_token>',
    });
  }

  const token = authHeader.slice(7);
  const tokenData = oauthAccessTokens.get(token);

  if (!tokenData) {
    return res.status(401).json({
      error: 'invalid_token',
      error_description: 'Access token is invalid or has been revoked',
    });
  }

  if (tokenData.expiresAt < Date.now()) {
    oauthAccessTokens.delete(token);
    return res.status(401).json({
      error: 'invalid_token',
      error_description: 'Access token has expired',
    });
  }

  return res.json({
    success: true,
    message: 'OAuth 2.0 authentication successful',
    token: {
      clientId: tokenData.clientId,
      userId: tokenData.userId || null,
      scope: tokenData.scope,
      expiresIn: Math.floor((tokenData.expiresAt - Date.now()) / 1000),
    },
    data: {
      secretMessage: 'This is protected data accessible only with a valid OAuth 2.0 token!',
      timestamp: new Date().toISOString(),
    },
  });
});

/**
 * @openapi
 * /auth/oauth2/revoke:
 *   post:
 *     tags:
 *       - 6. Authentication/OAuth 2.0
 *     summary: OAuth 2.0 Token Revocation
 *     description: |
 *       Revoke an access token or refresh token.
 *       
 *       Follows RFC 7009 (OAuth 2.0 Token Revocation).
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: The token to revoke
 *               token_type_hint:
 *                 type: string
 *                 enum: [access_token, refresh_token]
 *                 description: A hint about the type of token
 *     responses:
 *       200:
 *         description: Token revoked (or was already invalid)
 */
router.post('/revoke', express.urlencoded({ extended: true }), (req: Request, res: Response) => {
  const { token, token_type_hint } = req.body || {};

  if (!token) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing token parameter',
    });
  }

  // Try to revoke based on hint, or try both
  if (token_type_hint === 'refresh_token' || !token_type_hint) {
    oauthRefreshTokens.delete(token);
  }
  if (token_type_hint === 'access_token' || !token_type_hint) {
    oauthAccessTokens.delete(token);
  }

  // Always return 200 even if token wasn't found (per RFC 7009)
  return res.status(200).json({
    success: true,
    message: 'Token revoked successfully',
  });
});

/**
 * @openapi
 * /auth/oauth2/introspect:
 *   post:
 *     tags:
 *       - 6. Authentication/OAuth 2.0
 *     summary: OAuth 2.0 Token Introspection
 *     description: |
 *       Introspect an access token to check its validity and metadata.
 *       
 *       Follows RFC 7662 (OAuth 2.0 Token Introspection).
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: The token to introspect
 *     responses:
 *       200:
 *         description: Token introspection response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 active:
 *                   type: boolean
 *                   description: Whether the token is valid
 *                 client_id:
 *                   type: string
 *                 username:
 *                   type: string
 *                 scope:
 *                   type: string
 *                 exp:
 *                   type: integer
 *                 token_type:
 *                   type: string
 */
router.post('/introspect', express.urlencoded({ extended: true }), (req: Request, res: Response) => {
  const { token } = req.body || {};

  if (!token) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing token parameter',
    });
  }

  const tokenData = oauthAccessTokens.get(token);

  if (!tokenData || tokenData.expiresAt < Date.now()) {
    return res.json({ active: false });
  }

  return res.json({
    active: true,
    client_id: tokenData.clientId,
    username: tokenData.userId || null,
    scope: tokenData.scope,
    exp: Math.floor(tokenData.expiresAt / 1000),
    token_type: tokenData.tokenType,
  });
});

/**
 * @openapi
 * /auth/oauth2/credentials:
 *   get:
 *     tags:
 *       - 6. Authentication/OAuth 2.0
 *     summary: Get OAuth 2.0 test credentials
 *     description: Returns all test credentials for OAuth 2.0 authentication
 *     responses:
 *       200:
 *         description: OAuth 2.0 test credentials
 */
router.get('/credentials', (_req: Request, res: Response) => {
  res.json({
    clients: OAUTH2_CONFIG.clients.map(c => ({
      clientId: c.clientId,
      clientSecret: c.clientSecret || '(public client - no secret required)',
      name: c.name,
      redirectUris: c.redirectUris,
    })),
    users: OAUTH2_CONFIG.users.map(u => ({
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
        example: 'POST /auth/oauth2/token with grant_type=password&client_id=echolon-test-client&client_secret=echolon-test-secret-12345&username=oauth_user&password=oauth_pass123&scope=read',
      },
      implicit: {
        description: 'Implicit flow (returns token directly in redirect)',
        example: 'GET /auth/oauth2/authorize?response_type=token&client_id=echolon-test-client&redirect_uri=http://localhost:3000/callback&scope=read',
      },
    },
  });
});

export default router;

