import crypto from 'crypto';

export interface DigestChallenge {
  realm: string;
  nonce: string;
  algorithm?: string;
  qop?: string;
  opaque?: string;
}

export interface DigestAuthParams {
  username: string;
  password: string;
  method: string;
  uri: string;
  challenge: DigestChallenge;
  nc?: string;
  cnonce?: string;
}

/**
 * Parse WWW-Authenticate header to extract digest challenge parameters
 */
export function parseDigestChallenge(wwwAuthHeader: string): DigestChallenge | null {
  if (!wwwAuthHeader.toLowerCase().startsWith('digest ')) {
    return null;
  }

  const params: Record<string, string> = {};
  const paramRegex = /(\w+)=(?:"([^"]+)"|([^\s,]+))/g;
  let match;
  
  while ((match = paramRegex.exec(wwwAuthHeader)) !== null) {
    params[match[1].toLowerCase()] = match[2] || match[3];
  }

  if (!params.realm || !params.nonce) {
    return null;
  }

  return {
    realm: params.realm,
    nonce: params.nonce,
    algorithm: params.algorithm || 'MD5',
    qop: params.qop,
    opaque: params.opaque,
  };
}

/**
 * Compute MD5 hash
 */
function md5(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex');
}

/**
 * Compute SHA-256 hash
 */
function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Get hash function based on algorithm
 */
function getHashFunction(algorithm: string): (input: string) => string {
  switch (algorithm.toUpperCase()) {
    case 'SHA-256':
    case 'SHA-256-SESS':
      return sha256;
    case 'MD5':
    case 'MD5-SESS':
    default:
      return md5;
  }
}

/**
 * Build Digest Authorization header
 */
export function buildDigestAuthHeader(params: DigestAuthParams): string {
  const { username, password, method, uri, challenge, nc = '00000001', cnonce } = params;
  const { realm, nonce, algorithm = 'MD5', qop, opaque } = challenge;

  const hash = getHashFunction(algorithm);
  const clientNonce = cnonce || crypto.randomBytes(8).toString('hex');

  // Calculate HA1
  let ha1 = hash(`${username}:${realm}:${password}`);
  
  // For -sess algorithms, HA1 is hashed again with nonce and cnonce
  if (algorithm.toUpperCase().endsWith('-SESS')) {
    ha1 = hash(`${ha1}:${nonce}:${clientNonce}`);
  }

  // Calculate HA2
  // Note: For qop="auth-int", HA2 should include entity body hash, but we use "auth" qop
  const ha2 = hash(`${method.toUpperCase()}:${uri}`);

  // Calculate response
  let response: string;
  if (qop === 'auth' || qop === 'auth-int') {
    response = hash(`${ha1}:${nonce}:${nc}:${clientNonce}:${qop}:${ha2}`);
  } else {
    // Legacy mode without qop
    response = hash(`${ha1}:${nonce}:${ha2}`);
  }

  // Build Authorization header
  const parts = [
    `Digest username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `algorithm=${algorithm}`,
    `response="${response}"`,
  ];

  if (qop) {
    parts.push(`qop=${qop}`);
    parts.push(`nc=${nc}`);
    parts.push(`cnonce="${clientNonce}"`);
  }

  if (opaque) {
    parts.push(`opaque="${opaque}"`);
  }

  return parts.join(', ');
}

