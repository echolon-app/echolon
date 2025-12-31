import { Request, Environment } from '@/types';

export function interpolateVariables(
  text: string,
  environment: Environment | null
): string {
  if (!text || !environment) return text;

  return text.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
    const variable = environment.variables.find(
      v => v.key === varName.trim() && v.enabled
    );
    return variable ? variable.value : match;
  });
}

export function generateCurlCommand(
  request: Request,
  environment: Environment | null = null
): string {
  const interpolate = (text: string) => interpolateVariables(text, environment);
  const parts: string[] = ['curl'];

  // Method
  if (request.method !== 'GET') {
    parts.push(`-X ${request.method}`);
  }

  // URL with query params
  let url = interpolate(request.url);
  if (!url) {
    url = 'http://localhost';
  } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  try {
    const enabledParams = request.queryParams.filter(p => p.enabled && p.key);
    if (enabledParams.length > 0) {
      const urlObj = new URL(url);
      enabledParams.forEach(p => {
        urlObj.searchParams.set(interpolate(p.key), interpolate(p.value));
      });
      url = urlObj.toString();
    }
  } catch {
    // Invalid URL, use as-is
  }

  // Headers
  request.headers
    .filter(h => h.enabled && h.key)
    .forEach(h => {
      parts.push(`-H '${interpolate(h.key)}: ${interpolate(h.value)}'`);
    });

  // Auth
  if (request.auth.type === 'basic' && request.auth.basic) {
    parts.push(
      `-u '${interpolate(request.auth.basic.username)}:${interpolate(
        request.auth.basic.password
      )}'`
    );
  } else if (request.auth.type === 'bearer' && request.auth.bearer) {
    parts.push(
      `-H 'Authorization: Bearer ${interpolate(request.auth.bearer.token)}'`
    );
  } else if (request.auth.type === 'api-key' && request.auth.apiKey) {
    if (request.auth.apiKey.addTo === 'header') {
      parts.push(
        `-H '${interpolate(request.auth.apiKey.key)}: ${interpolate(
          request.auth.apiKey.value
        )}'`
      );
    }
  }

  // Body
  if (request.body.type !== 'none' && request.body.content) {
    if (request.body.type === 'json') {
      parts.push(`-H 'Content-Type: application/json'`);
      parts.push(`-d '${interpolate(request.body.content)}'`);
    } else if (request.body.type === 'raw') {
      parts.push(`-d '${interpolate(request.body.content)}'`);
    } else if (request.body.type === 'x-www-form-urlencoded') {
      parts.push(`-H 'Content-Type: application/x-www-form-urlencoded'`);
      const formData = request.body.formData
        ?.filter(f => f.enabled && f.key)
        .map(f => `${encodeURIComponent(interpolate(f.key))}=${encodeURIComponent(interpolate(f.value))}`)
        .join('&');
      if (formData) {
        parts.push(`-d '${formData}'`);
      }
    }
  }

  // URL (quoted, at the end)
  parts.push(`'${url}'`);

  return parts.join(' \\\n  ');
}

export function generateFetchCode(
  request: Request,
  environment: Environment | null = null
): string {
  const interpolate = (text: string) => interpolateVariables(text, environment);
  
  // Build URL
  let url = interpolate(request.url);
  if (!url) {
    url = 'http://localhost';
  } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  try {
    const enabledParams = request.queryParams.filter(p => p.enabled && p.key);
    if (enabledParams.length > 0) {
      const urlObj = new URL(url);
      enabledParams.forEach(p => {
        urlObj.searchParams.set(interpolate(p.key), interpolate(p.value));
      });
      url = urlObj.toString();
    }
  } catch {
    // Invalid URL, use as-is
  }

  // Build headers
  const headers: Record<string, string> = {};
  
  request.headers
    .filter(h => h.enabled && h.key)
    .forEach(h => {
      headers[interpolate(h.key)] = interpolate(h.value);
    });

  // Auth
  if (request.auth.type === 'basic' && request.auth.basic) {
    const credentials = btoa(
      `${interpolate(request.auth.basic.username)}:${interpolate(request.auth.basic.password)}`
    );
    headers['Authorization'] = `Basic ${credentials}`;
  } else if (request.auth.type === 'bearer' && request.auth.bearer) {
    headers['Authorization'] = `Bearer ${interpolate(request.auth.bearer.token)}`;
  } else if (request.auth.type === 'api-key' && request.auth.apiKey && request.auth.apiKey.addTo === 'header') {
    headers[interpolate(request.auth.apiKey.key)] = interpolate(request.auth.apiKey.value);
  }

  // Build body
  let body: string | null = null;
  if (request.body.type !== 'none') {
    if (request.body.type === 'json') {
      headers['Content-Type'] = 'application/json';
      body = interpolate(request.body.content);
    } else if (request.body.type === 'raw') {
      body = interpolate(request.body.content);
    } else if (request.body.type === 'x-www-form-urlencoded') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const params = new URLSearchParams();
      request.body.formData
        ?.filter(f => f.enabled && f.key)
        .forEach(f => {
          params.set(interpolate(f.key), interpolate(f.value));
        });
      body = params.toString();
    }
  }

  // Generate the code
  const lines: string[] = [];
  
  lines.push(`const response = await fetch('${url}', {`);
  lines.push(`  method: '${request.method}',`);
  
  if (Object.keys(headers).length > 0) {
    lines.push(`  headers: {`);
    Object.entries(headers).forEach(([key, value], index, arr) => {
      const comma = index < arr.length - 1 ? ',' : '';
      lines.push(`    '${key}': '${value}'${comma}`);
    });
    lines.push(`  },`);
  }
  
  if (body) {
    if (request.body.type === 'json') {
      // Try to format JSON nicely
      try {
        const parsed = JSON.parse(body);
        const formatted = JSON.stringify(parsed, null, 2)
          .split('\n')
          .map((line, i) => i === 0 ? line : '  ' + line)
          .join('\n');
        lines.push(`  body: JSON.stringify(${formatted}),`);
      } catch {
        lines.push(`  body: \`${body}\`,`);
      }
    } else {
      lines.push(`  body: '${body}',`);
    }
  }
  
  lines.push(`});`);
  lines.push(``);
  lines.push(`const data = await response.json();`);
  lines.push(`console.log(data);`);

  return lines.join('\n');
}
