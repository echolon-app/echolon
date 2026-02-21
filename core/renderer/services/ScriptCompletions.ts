/**
 * Script Autocompletion Definitions
 * 
 * Provides autocompletion suggestions for pre-request and post-request scripts.
 * Based on the Echolon scripting API.
 */

export type ScriptContext = 'pre' | 'post';

export interface ScriptCompletion {
  name: string;
  value: string;
  meta: string;
  description: string;
  score: number;
}

// echo.* methods - available in both pre and post scripts
const echoCompletions: ScriptCompletion[] = [
  {
    name: 'echo.getEnvVar',
    value: 'echo.getEnvVar(\'$1\')',
    meta: 'echo',
    description: 'Get an environment variable value',
    score: 1000,
  },
  {
    name: 'echo.setEnvVar',
    value: 'echo.setEnvVar(\'$1\', $2)',
    meta: 'echo',
    description: 'Set an environment variable (persists for the session)',
    score: 1000,
  },
  {
    name: 'echo.getVar',
    value: 'echo.getVar(\'$1\')',
    meta: 'echo',
    description: 'Get a runtime variable (session-scoped, shared across requests/tabs)',
    score: 1000,
  },
  {
    name: 'echo.setVar',
    value: 'echo.setVar(\'$1\', $2)',
    meta: 'echo',
    description: 'Set a runtime variable (session-scoped, persisted across requests/tabs)',
    score: 1000,
  },
  {
    name: 'echo.sleep',
    value: 'echo.sleep($1)',
    meta: 'echo',
    description: 'Pause execution for specified milliseconds',
    score: 1000,
  },
];

// req.* properties and methods - available in both pre and post scripts
const reqCompletions: ScriptCompletion[] = [
  // Properties
  {
    name: 'req.url',
    value: 'req.url',
    meta: 'req',
    description: 'The request URL (read/write)',
    score: 900,
  },
  {
    name: 'req.method',
    value: 'req.method',
    meta: 'req',
    description: 'The HTTP method (read/write)',
    score: 900,
  },
  {
    name: 'req.headers',
    value: 'req.headers',
    meta: 'req',
    description: 'Headers object (read/write)',
    score: 900,
  },
  {
    name: 'req.body',
    value: 'req.body',
    meta: 'req',
    description: 'Request body (read/write)',
    score: 900,
  },
  // Methods
  {
    name: 'req.getUrl',
    value: 'req.getUrl()',
    meta: 'req',
    description: 'Get the request URL',
    score: 850,
  },
  {
    name: 'req.setUrl',
    value: 'req.setUrl(\'$1\')',
    meta: 'req',
    description: 'Set the request URL',
    score: 850,
  },
  {
    name: 'req.getMethod',
    value: 'req.getMethod()',
    meta: 'req',
    description: 'Get the HTTP method',
    score: 850,
  },
  {
    name: 'req.setMethod',
    value: 'req.setMethod(\'$1\')',
    meta: 'req',
    description: 'Set the HTTP method',
    score: 850,
  },
  {
    name: 'req.getHeaders',
    value: 'req.getHeaders()',
    meta: 'req',
    description: 'Get all headers as an object',
    score: 850,
  },
  {
    name: 'req.getHeader',
    value: 'req.getHeader(\'$1\')',
    meta: 'req',
    description: 'Get a specific header value (case-insensitive)',
    score: 850,
  },
  {
    name: 'req.setHeaders',
    value: 'req.setHeaders($1)',
    meta: 'req',
    description: 'Replace all headers',
    score: 850,
  },
  {
    name: 'req.setHeader',
    value: 'req.setHeader(\'$1\', \'$2\')',
    meta: 'req',
    description: 'Set a specific header',
    score: 850,
  },
  {
    name: 'req.getBody',
    value: 'req.getBody()',
    meta: 'req',
    description: 'Get the request body',
    score: 850,
  },
  {
    name: 'req.setBody',
    value: 'req.setBody($1)',
    meta: 'req',
    description: 'Set the request body',
    score: 850,
  },
];

// res.* properties and methods - only available in post scripts
const resCompletions: ScriptCompletion[] = [
  // Properties (read/write)
  {
    name: 'res.status',
    value: 'res.status',
    meta: 'res',
    description: 'HTTP status code (e.g., 200, 404) - read/write',
    score: 900,
  },
  {
    name: 'res.statusText',
    value: 'res.statusText',
    meta: 'res',
    description: 'HTTP status text (e.g., "OK", "Not Found") - read/write',
    score: 900,
  },
  {
    name: 'res.headers',
    value: 'res.headers',
    meta: 'res',
    description: 'Response headers object - read/write',
    score: 900,
  },
  {
    name: 'res.body',
    value: 'res.body',
    meta: 'res',
    description: 'Response body (string or object) - read/write',
    score: 900,
  },
  {
    name: 'res.responseTime',
    value: 'res.responseTime',
    meta: 'res',
    description: 'Request duration in milliseconds',
    score: 900,
  },
  // Getter methods
  {
    name: 'res.getStatus',
    value: 'res.getStatus()',
    meta: 'res',
    description: 'Get the status code',
    score: 850,
  },
  {
    name: 'res.getStatusText',
    value: 'res.getStatusText()',
    meta: 'res',
    description: 'Get the status text',
    score: 850,
  },
  {
    name: 'res.getHeaders',
    value: 'res.getHeaders()',
    meta: 'res',
    description: 'Get all headers as an object',
    score: 850,
  },
  {
    name: 'res.getHeader',
    value: 'res.getHeader(\'$1\')',
    meta: 'res',
    description: 'Get a specific header (case-insensitive)',
    score: 850,
  },
  {
    name: 'res.getBody',
    value: 'res.getBody()',
    meta: 'res',
    description: 'Get the response body',
    score: 850,
  },
  {
    name: 'res.getResponseTime',
    value: 'res.getResponseTime()',
    meta: 'res',
    description: 'Get the response time in ms',
    score: 850,
  },
  // Setter methods
  {
    name: 'res.setHeader',
    value: 'res.setHeader(\'$1\', \'$2\')',
    meta: 'res',
    description: 'Set a response header (modifies response)',
    score: 850,
  },
  {
    name: 'res.setBody',
    value: 'res.setBody($1)',
    meta: 'res',
    description: 'Set the response body (string or object)',
    score: 850,
  },
];

// console.* methods - available in both pre and post scripts
const consoleCompletions: ScriptCompletion[] = [
  {
    name: 'console.log',
    value: 'console.log($1)',
    meta: 'console',
    description: 'Log a message to the console',
    score: 800,
  },
  {
    name: 'console.warn',
    value: 'console.warn($1)',
    meta: 'console',
    description: 'Log a warning message',
    score: 800,
  },
  {
    name: 'console.error',
    value: 'console.error($1)',
    meta: 'console',
    description: 'Log an error message',
    score: 800,
  },
  {
    name: 'console.info',
    value: 'console.info($1)',
    meta: 'console',
    description: 'Log an info message',
    score: 800,
  },
];

// Common JavaScript utilities
const utilityCompletions: ScriptCompletion[] = [
  {
    name: 'JSON.parse',
    value: 'JSON.parse($1)',
    meta: 'utility',
    description: 'Parse a JSON string into an object',
    score: 700,
  },
  {
    name: 'JSON.stringify',
    value: 'JSON.stringify($1)',
    meta: 'utility',
    description: 'Convert an object to a JSON string',
    score: 700,
  },
  {
    name: 'Date.now',
    value: 'Date.now()',
    meta: 'utility',
    description: 'Get current timestamp in milliseconds',
    score: 700,
  },
  {
    name: 'btoa',
    value: 'btoa($1)',
    meta: 'utility',
    description: 'Base64 encode a string',
    score: 700,
  },
  {
    name: 'atob',
    value: 'atob($1)',
    meta: 'utility',
    description: 'Base64 decode a string',
    score: 700,
  },
  {
    name: 'encodeURIComponent',
    value: 'encodeURIComponent($1)',
    meta: 'utility',
    description: 'URL-encode a string',
    score: 700,
  },
  {
    name: 'decodeURIComponent',
    value: 'decodeURIComponent($1)',
    meta: 'utility',
    description: 'URL-decode a string',
    score: 700,
  },
];

/**
 * Get script completions based on context (pre or post script)
 */
export function getScriptCompletions(context: ScriptContext): ScriptCompletion[] {
  const completions = [
    ...echoCompletions,
    ...reqCompletions,
    ...consoleCompletions,
    ...utilityCompletions,
  ];
  
  // Only include res.* completions for post scripts
  if (context === 'post') {
    completions.push(...resCompletions);
  }
  
  return completions;
}

/**
 * Filter completions based on current input
 */
export function filterCompletions(
  completions: ScriptCompletion[],
  prefix: string
): ScriptCompletion[] {
  if (!prefix) return completions;
  
  const lowerPrefix = prefix.toLowerCase();
  return completions.filter(c => 
    c.name.toLowerCase().includes(lowerPrefix)
  );
}

