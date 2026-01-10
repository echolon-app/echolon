import crypto from 'crypto';

export interface AwsSigV4Config {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  sessionToken?: string;
}

export interface AwsSigV4Request {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | null;
}

export interface AwsSigV4Result {
  headers: Record<string, string>;
  signedHeaders: string;
  signature: string;
}

/**
 * Compute HMAC-SHA256
 */
function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

/**
 * Compute SHA256 hash as hex string
 */
function sha256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * URL encode a string following AWS rules
 * AWS requires specific encoding for path segments and query string values
 */
function uriEncode(str: string, encodeSlash: boolean = true): string {
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

/**
 * Get the signing key using HMAC chain
 */
function getSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string
): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  return kSigning;
}

/**
 * Format date as YYYYMMDDTHHMMSSZ (ISO 8601 basic format)
 */
function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

/**
 * Format date as YYYYMMDD
 */
function formatDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Build canonical headers string
 */
function buildCanonicalHeaders(headers: Record<string, string>): {
  canonicalHeaders: string;
  signedHeaders: string;
} {
  // Convert headers to lowercase keys and trim values
  const normalizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalizedHeaders[key.toLowerCase()] = value.trim().replace(/\s+/g, ' ');
  }

  // Sort headers by name
  const sortedKeys = Object.keys(normalizedHeaders).sort();

  // Build canonical headers string
  const canonicalHeaders = sortedKeys
    .map(key => `${key}:${normalizedHeaders[key]}`)
    .join('\n') + '\n';

  // Build signed headers string
  const signedHeaders = sortedKeys.join(';');

  return { canonicalHeaders, signedHeaders };
}

/**
 * Build canonical query string
 */
function buildCanonicalQueryString(url: URL): string {
  const params = Array.from(url.searchParams.entries());
  
  if (params.length === 0) {
    return '';
  }

  // Sort parameters by name, then by value
  params.sort((a, b) => {
    const keyCompare = a[0].localeCompare(b[0]);
    if (keyCompare !== 0) return keyCompare;
    return a[1].localeCompare(b[1]);
  });

  // URL encode each parameter
  return params
    .map(([key, value]) => `${uriEncode(key)}=${uriEncode(value)}`)
    .join('&');
}

/**
 * Sign a request using AWS Signature Version 4
 */
export function signRequest(
  config: AwsSigV4Config,
  request: AwsSigV4Request,
  timestamp?: Date
): AwsSigV4Result {
  const now = timestamp || new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = formatDateStamp(now);

  // Parse URL
  let url: URL;
  try {
    url = new URL(request.url.startsWith('http') ? request.url : `https://${request.url}`);
  } catch {
    throw new Error('Invalid URL for AWS Signature');
  }

  const host = url.host;
  const canonicalUri = uriEncode(url.pathname || '/', false);
  const canonicalQuerystring = buildCanonicalQueryString(url);

  // Calculate payload hash
  const payloadHash = sha256(request.body || '');

  // Build headers to sign (must include host and x-amz-date)
  const headersToSign: Record<string, string> = {
    ...request.headers,
    'host': host,
    'x-amz-date': amzDate,
  };

  // Add security token header if present
  if (config.sessionToken) {
    headersToSign['x-amz-security-token'] = config.sessionToken;
  }

  // Build canonical headers
  const { canonicalHeaders, signedHeaders } = buildCanonicalHeaders(headersToSign);

  // Create canonical request
  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // Create credential scope
  const credentialScope = `${dateStamp}/${config.region}/${config.service}/aws4_request`;

  // Create string to sign
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');

  // Calculate signature
  const signingKey = getSigningKey(
    config.secretAccessKey,
    dateStamp,
    config.region,
    config.service
  );
  const signature = hmacSha256(signingKey, stringToSign).toString('hex');

  // Build Authorization header
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(', ');

  // Build result headers
  const resultHeaders: Record<string, string> = {
    'Authorization': authorization,
    'X-Amz-Date': amzDate,
    'Host': host,
  };

  if (config.sessionToken) {
    resultHeaders['X-Amz-Security-Token'] = config.sessionToken;
  }

  return {
    headers: resultHeaders,
    signedHeaders,
    signature,
  };
}

/**
 * Get AWS Signature headers for a request
 * Convenience function that returns just the headers to add to a request
 */
export function getAwsSignatureHeaders(
  config: AwsSigV4Config,
  method: string,
  url: string,
  existingHeaders: Record<string, string> = {},
  body?: string | null
): Record<string, string> {
  const result = signRequest(config, {
    method,
    url,
    headers: existingHeaders,
    body,
  });

  return result.headers;
}

