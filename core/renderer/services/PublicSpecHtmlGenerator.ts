/**
 * Public Spec HTML Generator
 * 
 * Generates the HTML page that embeds the Echolon web viewer
 * for public API documentation.
 * 
 * Supports two spec formats:
 * - openapi: Standard OpenAPI 3.0 spec (limited features)
 * - echolon: Internal Echolon format with extended features (environments, colors, tags, etc.)
 */

export type SpecFormat = 'openapi' | 'echolon';

interface GenerateHtmlOptions {
  subdomain: string;
  version: string;
  title?: string;
  description?: string;
  theme?: 'light' | 'dark';
  userId?: string;
  /** 
   * Spec format to use for the data-url attribute.
   * 'openapi' uses ./openapi.json, 'echolon' uses ./echolon.json
   * Default is 'openapi' for compatibility.
   */
  format?: SpecFormat;
}

const WEB_ECHOLON_BASE = 'https://echolon-web.s3.eu-central-1.amazonaws.com';
const SCRIPT_URL = `${WEB_ECHOLON_BASE}/assets/index-latest.js`;
const CSS_URL = `${WEB_ECHOLON_BASE}/assets/index-latest.css`;

/**
 * Generate the HTML content for a public spec page
 */
export function generatePublicSpecHtml(options: GenerateHtmlOptions): string {
  const {
    subdomain,
    version,
    title = 'API Reference',
    description = '',
    theme = 'dark',
    userId = '',
    format = 'openapi',
  } = options;

  const pageTitle = title || `${subdomain} API Reference`;
  const metaDescription = description || `API documentation for ${subdomain}`;
  
  // The spec URL relative to this HTML file (openapi.json or echolon.json)
  const specUrl = format === 'echolon' ? './echolon.json' : './openapi.json';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${escapeHtml(metaDescription)}">
  <meta name="robots" content="index, follow">
  ${userId ? `<meta name="echolon-owner" content="${escapeHtml(userId)}">` : ''}
  
  <!-- Open Graph / Social Media -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(metaDescription)}">
  <meta property="og:url" content="https://${subdomain}.api.echolon.app/${version}/">
  
  <title>${escapeHtml(pageTitle)}</title>
  
  <!-- Favicon -->
  <link rel="icon" type="image/svg+xml" href="${WEB_ECHOLON_BASE}/favicon.svg">
  
  <!-- Echolon Web Styles -->
  <link rel="stylesheet" href="${CSS_URL}">
  
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { 
      height: 100%; 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    }
    #echolon { height: 100%; }
    
    /* Loading state */
    .echolon-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      background: ${theme === 'dark' ? '#0a0a0a' : '#ffffff'};
      color: ${theme === 'dark' ? '#e5e5e5' : '#171717'};
    }
    .echolon-loading__spinner {
      width: 40px;
      height: 40px;
      border: 3px solid ${theme === 'dark' ? '#262626' : '#e5e5e5'};
      border-top-color: ${theme === 'dark' ? '#22c55e' : '#16a34a'};
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    .echolon-loading p {
      margin-top: 16px;
      font-size: 14px;
      opacity: 0.7;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    /* Error state */
    .echolon-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 24px;
      text-align: center;
      background: ${theme === 'dark' ? '#0a0a0a' : '#ffffff'};
      color: ${theme === 'dark' ? '#e5e5e5' : '#171717'};
    }
    .echolon-error h2 {
      font-size: 20px;
      margin-bottom: 8px;
      color: #ef4444;
    }
    .echolon-error p {
      font-size: 14px;
      opacity: 0.7;
      max-width: 400px;
    }
  </style>
</head>
<body>
  <div id="echolon">
    <div class="echolon-loading">
      <div class="echolon-loading__spinner"></div>
      <p>Loading API documentation...</p>
    </div>
  </div>
  
  <!-- Echolon Web Configuration -->
  <script
    id="api-reference"
    data-url="${specUrl}"
    data-format="${format}"
    data-theme="${theme}"
    data-view="reference"
    data-readonly="true"
    data-title="${escapeHtml(pageTitle)}"
    data-versions-url="./versions.json"
  ></script>
  
  <!-- Echolon Web Script -->
  <script type="module" src="${SCRIPT_URL}"></script>
  
  <!-- Fallback for older browsers -->
  <noscript>
    <div class="echolon-error">
      <h2>JavaScript Required</h2>
      <p>This API documentation requires JavaScript to be enabled. Please enable JavaScript and refresh the page.</p>
    </div>
  </noscript>
</body>
</html>`;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, char => htmlEntities[char] || char);
}

/**
 * Generate a versions.json file content for version switching
 * URL format: ../{version}/ - relative path from current version folder to sibling version folder
 */
export function generateVersionsJson(versions: Array<{
  version: string;
  publishedAt: string;
  title?: string;
  description?: string;
}>): string {
  return JSON.stringify({
    versions: versions.map(v => ({
      version: v.version,
      publishedAt: v.publishedAt,
      title: v.title,
      description: v.description,
      url: `../${v.version}/`,
    })),
  }, null, 2);
}

export default {
  generatePublicSpecHtml,
  generateVersionsJson,
};

