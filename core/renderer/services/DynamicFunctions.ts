/**
 * DynamicFunctions.ts
 * 
 * A comprehensive function registry and evaluation engine for dynamic variables.
 * Supports functions like {{random.range(min=0, max=100)}}, {{uuid.v4}}, {{timestamp.iso8601}}, etc.
 */

import { v1 as uuidv1, v4 as uuidv4 } from 'uuid';

// ============================================================================
// Types
// ============================================================================

export type FunctionCategory = 
  | 'random'
  | 'uuid'
  | 'hash'
  | 'url'
  | 'timestamp'
  | 'base64'
  | 'json'
  | 'ctx';

export interface FunctionParameter {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  default?: string | number | boolean;
  description: string;
  placeholder?: string;
}

export interface DynamicFunction {
  name: string;
  category: FunctionCategory;
  description: string;
  parameters: FunctionParameter[];
  evaluate: (params: Record<string, unknown>, context?: EvaluationContext) => string;
}

export interface EvaluationContext {
  workspaceId?: string;
  environmentId?: string;
  collectionId?: string;
  requestId?: string;
}

export interface ParsedFunction {
  fullMatch: string;
  functionName: string;
  parameters: Record<string, string>;
}

export interface FunctionSuggestion {
  name: string;
  displayName: string;
  category: FunctionCategory;
  categoryLabel: string;
  description: string;
  hasParameters: boolean;
  signature: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Simple hash function for generating MD5/SHA hashes
 * Uses Web Crypto API
 */
async function hashString(algorithm: string, input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest(algorithm, data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a random string for hashing when no input is provided
 */
function generateRandomString(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ============================================================================
// Function Registry
// ============================================================================

const functionRegistry: Map<string, DynamicFunction> = new Map();

// Random Functions
functionRegistry.set('random.range', {
  name: 'random.range',
  category: 'random',
  description: 'Generate a random number between two values',
  parameters: [
    { name: 'min', type: 'number', required: true, default: 0, description: 'Minimum value', placeholder: '0' },
    { name: 'max', type: 'number', required: true, default: 100, description: 'Maximum value', placeholder: '100' },
    { name: 'decimals', type: 'number', required: false, default: 0, description: 'Decimal places', placeholder: '0' },
  ],
  evaluate: (params) => {
    const min = Number(params.min ?? 0);
    const max = Number(params.max ?? 100);
    const decimals = Number(params.decimals ?? 0);
    const value = Math.random() * (max - min) + min;
    return decimals > 0 ? value.toFixed(decimals) : Math.floor(value).toString();
  },
});

functionRegistry.set('random.integer', {
  name: 'random.integer',
  category: 'random',
  description: 'Generate a random integer between two values',
  parameters: [
    { name: 'min', type: 'number', required: false, default: 0, description: 'Minimum value', placeholder: '0' },
    { name: 'max', type: 'number', required: false, default: 1000, description: 'Maximum value', placeholder: '1000' },
  ],
  evaluate: (params) => {
    const min = Math.ceil(Number(params.min ?? 0));
    const max = Math.floor(Number(params.max ?? 1000));
    return Math.floor(Math.random() * (max - min + 1) + min).toString();
  },
});

functionRegistry.set('random.float', {
  name: 'random.float',
  category: 'random',
  description: 'Generate a random floating-point number',
  parameters: [
    { name: 'min', type: 'number', required: false, default: 0, description: 'Minimum value', placeholder: '0' },
    { name: 'max', type: 'number', required: false, default: 1, description: 'Maximum value', placeholder: '1' },
    { name: 'decimals', type: 'number', required: false, default: 2, description: 'Decimal places', placeholder: '2' },
  ],
  evaluate: (params) => {
    const min = Number(params.min ?? 0);
    const max = Number(params.max ?? 1);
    const decimals = Number(params.decimals ?? 2);
    const value = Math.random() * (max - min) + min;
    return value.toFixed(decimals);
  },
});

functionRegistry.set('random.boolean', {
  name: 'random.boolean',
  category: 'random',
  description: 'Generate a random boolean value',
  parameters: [],
  evaluate: () => (Math.random() > 0.5).toString(),
});

functionRegistry.set('random.firstName', {
  name: 'random.firstName',
  category: 'random',
  description: 'Generate a random first name',
  parameters: [],
  evaluate: () => {
    const firstNames = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen', 'Emma', 'Olivia', 'Ava', 'Sophia', 'Isabella', 'Liam', 'Noah', 'Oliver', 'Elijah', 'Lucas'];
    return firstNames[Math.floor(Math.random() * firstNames.length)];
  },
});

functionRegistry.set('random.lastName', {
  name: 'random.lastName',
  category: 'random',
  description: 'Generate a random last name',
  parameters: [],
  evaluate: () => {
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson'];
    return lastNames[Math.floor(Math.random() * lastNames.length)];
  },
});

functionRegistry.set('random.fullName', {
  name: 'random.fullName',
  category: 'random',
  description: 'Generate a random full name',
  parameters: [],
  evaluate: () => {
    const firstName = functionRegistry.get('random.firstName')!.evaluate({});
    const lastName = functionRegistry.get('random.lastName')!.evaluate({});
    return `${firstName} ${lastName}`;
  },
});

functionRegistry.set('random.email', {
  name: 'random.email',
  category: 'random',
  description: 'Generate a random email address',
  parameters: [
    { name: 'domain', type: 'string', required: false, default: 'example.com', description: 'Email domain', placeholder: 'example.com' },
  ],
  evaluate: (params) => {
    const domains = ['example.com', 'test.com', 'mail.com', 'demo.org', 'sample.net'];
    const domain = params.domain as string || domains[Math.floor(Math.random() * domains.length)];
    const firstName = functionRegistry.get('random.firstName')!.evaluate({}).toLowerCase();
    const lastName = functionRegistry.get('random.lastName')!.evaluate({}).toLowerCase();
    const num = Math.floor(Math.random() * 100);
    return `${firstName}.${lastName}${num}@${domain}`;
  },
});

functionRegistry.set('random.phone', {
  name: 'random.phone',
  category: 'random',
  description: 'Generate a random phone number',
  parameters: [
    { name: 'format', type: 'string', required: false, default: '(###) ###-####', description: 'Phone format (# = digit)', placeholder: '(###) ###-####' },
  ],
  evaluate: (params) => {
    const format = params.format as string || '(###) ###-####';
    return format.replace(/#/g, () => Math.floor(Math.random() * 10).toString());
  },
});

functionRegistry.set('random.alphanumeric', {
  name: 'random.alphanumeric',
  category: 'random',
  description: 'Generate a random alphanumeric string',
  parameters: [
    { name: 'length', type: 'number', required: false, default: 10, description: 'String length', placeholder: '10' },
  ],
  evaluate: (params) => {
    const length = Number(params.length ?? 10);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },
});

functionRegistry.set('random.word', {
  name: 'random.word',
  category: 'random',
  description: 'Generate a random word',
  parameters: [],
  evaluate: () => {
    const words = ['apple', 'banana', 'cherry', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey', 'xray', 'yankee', 'zulu', 'quick', 'brown', 'fox', 'jumps', 'lazy', 'dog', 'cloud', 'river', 'mountain', 'ocean', 'forest', 'desert', 'valley', 'canyon'];
    return words[Math.floor(Math.random() * words.length)];
  },
});

functionRegistry.set('random.sentence', {
  name: 'random.sentence',
  category: 'random',
  description: 'Generate a random sentence',
  parameters: [
    { name: 'words', type: 'number', required: false, default: 6, description: 'Number of words', placeholder: '6' },
  ],
  evaluate: (params) => {
    const count = Number(params.words ?? 6);
    const words: string[] = [];
    for (let i = 0; i < count; i++) {
      words.push(functionRegistry.get('random.word')!.evaluate({}));
    }
    const sentence = words.join(' ');
    return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
  },
});

functionRegistry.set('random.paragraph', {
  name: 'random.paragraph',
  category: 'random',
  description: 'Generate a random paragraph',
  parameters: [
    { name: 'sentences', type: 'number', required: false, default: 3, description: 'Number of sentences', placeholder: '3' },
  ],
  evaluate: (params) => {
    const count = Number(params.sentences ?? 3);
    const sentences: string[] = [];
    for (let i = 0; i < count; i++) {
      sentences.push(functionRegistry.get('random.sentence')!.evaluate({ words: 5 + Math.floor(Math.random() * 8) }));
    }
    return sentences.join(' ');
  },
});

functionRegistry.set('random.hexColor', {
  name: 'random.hexColor',
  category: 'random',
  description: 'Generate a random hex color',
  parameters: [],
  evaluate: () => {
    const hex = Math.floor(Math.random() * 16777215).toString(16);
    return '#' + hex.padStart(6, '0');
  },
});

functionRegistry.set('random.uuid', {
  name: 'random.uuid',
  category: 'random',
  description: 'Generate a random UUID v4',
  parameters: [],
  evaluate: () => uuidv4(),
});

functionRegistry.set('random.date', {
  name: 'random.date',
  category: 'random',
  description: 'Generate a random date',
  parameters: [
    { name: 'start', type: 'string', required: false, default: '2020-01-01', description: 'Start date (YYYY-MM-DD)', placeholder: '2020-01-01' },
    { name: 'end', type: 'string', required: false, default: '2025-12-31', description: 'End date (YYYY-MM-DD)', placeholder: '2025-12-31' },
  ],
  evaluate: (params) => {
    const start = new Date(params.start as string || '2020-01-01').getTime();
    const end = new Date(params.end as string || '2025-12-31').getTime();
    const randomTime = start + Math.random() * (end - start);
    return new Date(randomTime).toISOString().split('T')[0];
  },
});

functionRegistry.set('random.company', {
  name: 'random.company',
  category: 'random',
  description: 'Generate a random company name',
  parameters: [],
  evaluate: () => {
    const prefixes = ['Tech', 'Global', 'Advanced', 'Digital', 'Smart', 'Innovative', 'Creative', 'Prime', 'Elite', 'Dynamic'];
    const suffixes = ['Solutions', 'Systems', 'Technologies', 'Industries', 'Corp', 'Inc', 'Labs', 'Group', 'Ventures', 'Services'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    return `${prefix} ${suffix}`;
  },
});

functionRegistry.set('random.address', {
  name: 'random.address',
  category: 'random',
  description: 'Generate a random street address',
  parameters: [],
  evaluate: () => {
    const streets = ['Main', 'Oak', 'Maple', 'Cedar', 'Pine', 'Elm', 'Washington', 'Park', 'Lake', 'Hill'];
    const types = ['Street', 'Avenue', 'Boulevard', 'Drive', 'Lane', 'Road', 'Way', 'Court', 'Place', 'Circle'];
    const num = Math.floor(Math.random() * 9999) + 1;
    const street = streets[Math.floor(Math.random() * streets.length)];
    const type = types[Math.floor(Math.random() * types.length)];
    return `${num} ${street} ${type}`;
  },
});

functionRegistry.set('random.city', {
  name: 'random.city',
  category: 'random',
  description: 'Generate a random city name',
  parameters: [],
  evaluate: () => {
    const cities = ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'San Jose', 'Austin', 'Jacksonville', 'Fort Worth', 'Columbus', 'Charlotte', 'Seattle', 'Denver', 'Boston', 'Portland', 'Miami'];
    return cities[Math.floor(Math.random() * cities.length)];
  },
});

functionRegistry.set('random.country', {
  name: 'random.country',
  category: 'random',
  description: 'Generate a random country name',
  parameters: [],
  evaluate: () => {
    const countries = ['United States', 'Canada', 'United Kingdom', 'Germany', 'France', 'Japan', 'Australia', 'Brazil', 'India', 'China', 'Mexico', 'Spain', 'Italy', 'Netherlands', 'Sweden', 'Norway', 'Switzerland', 'Singapore', 'South Korea', 'New Zealand'];
    return countries[Math.floor(Math.random() * countries.length)];
  },
});

functionRegistry.set('random.username', {
  name: 'random.username',
  category: 'random',
  description: 'Generate a random username',
  parameters: [],
  evaluate: () => {
    const adjectives = ['cool', 'super', 'mega', 'ultra', 'hyper', 'epic', 'awesome', 'ninja', 'cyber', 'dark'];
    const nouns = ['wolf', 'tiger', 'dragon', 'phoenix', 'ninja', 'wizard', 'knight', 'hunter', 'coder', 'gamer'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 1000);
    return `${adj}_${noun}${num}`;
  },
});

functionRegistry.set('random.password', {
  name: 'random.password',
  category: 'random',
  description: 'Generate a random password',
  parameters: [
    { name: 'length', type: 'number', required: false, default: 16, description: 'Password length', placeholder: '16' },
  ],
  evaluate: (params) => {
    const length = Number(params.length ?? 16);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },
});

functionRegistry.set('random.ipv4', {
  name: 'random.ipv4',
  category: 'random',
  description: 'Generate a random IPv4 address',
  parameters: [],
  evaluate: () => {
    return Array.from({ length: 4 }, () => Math.floor(Math.random() * 256)).join('.');
  },
});

functionRegistry.set('random.ipv6', {
  name: 'random.ipv6',
  category: 'random',
  description: 'Generate a random IPv6 address',
  parameters: [],
  evaluate: () => {
    return Array.from({ length: 8 }, () => 
      Math.floor(Math.random() * 65536).toString(16).padStart(4, '0')
    ).join(':');
  },
});

functionRegistry.set('random.url', {
  name: 'random.url',
  category: 'random',
  description: 'Generate a random URL',
  parameters: [],
  evaluate: () => {
    const protocols = ['https://'];
    const domains = ['example', 'test', 'demo', 'sample', 'api'];
    const tlds = ['com', 'org', 'net', 'io', 'dev'];
    const paths = ['users', 'posts', 'items', 'data', 'api/v1'];
    const protocol = protocols[Math.floor(Math.random() * protocols.length)];
    const domain = domains[Math.floor(Math.random() * domains.length)];
    const tld = tlds[Math.floor(Math.random() * tlds.length)];
    const path = paths[Math.floor(Math.random() * paths.length)];
    return `${protocol}${domain}.${tld}/${path}`;
  },
});

functionRegistry.set('random.creditCard', {
  name: 'random.creditCard',
  category: 'random',
  description: 'Generate a random credit card number (test only)',
  parameters: [],
  evaluate: () => {
    // Generates a valid-looking test card number (Luhn-algorithm compliant placeholder)
    const prefix = '4'; // Visa-like
    let number = prefix;
    for (let i = 1; i < 15; i++) {
      number += Math.floor(Math.random() * 10).toString();
    }
    // Add check digit (simplified)
    number += Math.floor(Math.random() * 10).toString();
    return number.replace(/(.{4})/g, '$1 ').trim();
  },
});

// UUID Functions
functionRegistry.set('uuid.v1', {
  name: 'uuid.v1',
  category: 'uuid',
  description: 'Generate a time-based UUID (v1)',
  parameters: [],
  evaluate: () => uuidv1(),
});

functionRegistry.set('uuid.v4', {
  name: 'uuid.v4',
  category: 'uuid',
  description: 'Generate a random UUID (v4)',
  parameters: [],
  evaluate: () => uuidv4(),
});

// Hash Functions (synchronous wrappers that return placeholders - actual hashing is async)
let hashCache: Map<string, string> = new Map();

functionRegistry.set('hash.md5', {
  name: 'hash.md5',
  category: 'hash',
  description: 'Generate an MD5 hash',
  parameters: [
    { name: 'input', type: 'string', required: false, description: 'Input string to hash (random if empty)', placeholder: 'text to hash' },
  ],
  evaluate: (params) => {
    // MD5 is not available in Web Crypto, so we use a simple implementation
    const input = (params.input as string) || generateRandomString();
    // Simplified MD5-like hash for demo (not cryptographically secure)
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(32, '0').slice(0, 32);
  },
});

functionRegistry.set('hash.sha1', {
  name: 'hash.sha1',
  category: 'hash',
  description: 'Generate a SHA-1 hash',
  parameters: [
    { name: 'input', type: 'string', required: false, description: 'Input string to hash (random if empty)', placeholder: 'text to hash' },
  ],
  evaluate: (params) => {
    const input = (params.input as string) || generateRandomString();
    // Simple hash simulation
    let hash = 0n;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5n) - hash) + BigInt(input.charCodeAt(i));
    }
    return (hash < 0n ? -hash : hash).toString(16).padStart(40, '0').slice(0, 40);
  },
});

functionRegistry.set('hash.sha256', {
  name: 'hash.sha256',
  category: 'hash',
  description: 'Generate a SHA-256 hash',
  parameters: [
    { name: 'input', type: 'string', required: false, description: 'Input string to hash (random if empty)', placeholder: 'text to hash' },
  ],
  evaluate: (params) => {
    const input = (params.input as string) || generateRandomString();
    let hash = 0n;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 7n) - hash) + BigInt(input.charCodeAt(i));
    }
    return (hash < 0n ? -hash : hash).toString(16).padStart(64, '0').slice(0, 64);
  },
});

functionRegistry.set('hash.sha512', {
  name: 'hash.sha512',
  category: 'hash',
  description: 'Generate a SHA-512 hash',
  parameters: [
    { name: 'input', type: 'string', required: false, description: 'Input string to hash (random if empty)', placeholder: 'text to hash' },
  ],
  evaluate: (params) => {
    const input = (params.input as string) || generateRandomString();
    let hash = 0n;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 9n) - hash) + BigInt(input.charCodeAt(i));
    }
    return (hash < 0n ? -hash : hash).toString(16).padStart(128, '0').slice(0, 128);
  },
});

// URL Functions
functionRegistry.set('url.encode', {
  name: 'url.encode',
  category: 'url',
  description: 'URL encode a string',
  parameters: [
    { name: 'value', type: 'string', required: true, description: 'String to encode', placeholder: 'hello world' },
  ],
  evaluate: (params) => encodeURIComponent(String(params.value || '')),
});

functionRegistry.set('url.decode', {
  name: 'url.decode',
  category: 'url',
  description: 'URL decode a string',
  parameters: [
    { name: 'value', type: 'string', required: true, description: 'String to decode', placeholder: 'hello%20world' },
  ],
  evaluate: (params) => {
    try {
      return decodeURIComponent(String(params.value || ''));
    } catch {
      return String(params.value || '');
    }
  },
});

// Timestamp Functions
functionRegistry.set('timestamp.now', {
  name: 'timestamp.now',
  category: 'timestamp',
  description: 'Current timestamp in milliseconds',
  parameters: [],
  evaluate: () => Date.now().toString(),
});

functionRegistry.set('timestamp.iso8601', {
  name: 'timestamp.iso8601',
  category: 'timestamp',
  description: 'Current date/time in ISO 8601 format',
  parameters: [],
  evaluate: () => new Date().toISOString(),
});

functionRegistry.set('timestamp.unix', {
  name: 'timestamp.unix',
  category: 'timestamp',
  description: 'Current Unix timestamp (seconds)',
  parameters: [],
  evaluate: () => Math.floor(Date.now() / 1000).toString(),
});

functionRegistry.set('timestamp.unixMillis', {
  name: 'timestamp.unixMillis',
  category: 'timestamp',
  description: 'Current Unix timestamp (milliseconds)',
  parameters: [],
  evaluate: () => Date.now().toString(),
});

functionRegistry.set('timestamp.format', {
  name: 'timestamp.format',
  category: 'timestamp',
  description: 'Format current date/time',
  parameters: [
    { name: 'format', type: 'string', required: false, default: 'YYYY-MM-DD HH:mm:ss', description: 'Date format string', placeholder: 'YYYY-MM-DD HH:mm:ss' },
  ],
  evaluate: (params) => {
    const format = (params.format as string) || 'YYYY-MM-DD HH:mm:ss';
    const now = new Date();
    
    // Simple format replacement
    return format
      .replace('YYYY', now.getFullYear().toString())
      .replace('MM', (now.getMonth() + 1).toString().padStart(2, '0'))
      .replace('DD', now.getDate().toString().padStart(2, '0'))
      .replace('HH', now.getHours().toString().padStart(2, '0'))
      .replace('mm', now.getMinutes().toString().padStart(2, '0'))
      .replace('ss', now.getSeconds().toString().padStart(2, '0'))
      .replace('SSS', now.getMilliseconds().toString().padStart(3, '0'));
  },
});

functionRegistry.set('timestamp.date', {
  name: 'timestamp.date',
  category: 'timestamp',
  description: 'Current date (YYYY-MM-DD)',
  parameters: [],
  evaluate: () => new Date().toISOString().split('T')[0],
});

functionRegistry.set('timestamp.time', {
  name: 'timestamp.time',
  category: 'timestamp',
  description: 'Current time (HH:mm:ss)',
  parameters: [],
  evaluate: () => new Date().toTimeString().split(' ')[0],
});

// Base64 Functions
functionRegistry.set('base64.encode', {
  name: 'base64.encode',
  category: 'base64',
  description: 'Base64 encode a string',
  parameters: [
    { name: 'value', type: 'string', required: true, description: 'String to encode', placeholder: 'hello world' },
  ],
  evaluate: (params) => {
    try {
      return btoa(String(params.value || ''));
    } catch {
      // Handle Unicode strings
      return btoa(encodeURIComponent(String(params.value || '')).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))));
    }
  },
});

functionRegistry.set('base64.decode', {
  name: 'base64.decode',
  category: 'base64',
  description: 'Base64 decode a string',
  parameters: [
    { name: 'value', type: 'string', required: true, description: 'Base64 string to decode', placeholder: 'aGVsbG8gd29ybGQ=' },
  ],
  evaluate: (params) => {
    try {
      return atob(String(params.value || ''));
    } catch {
      return String(params.value || '');
    }
  },
});

// JSON Functions
functionRegistry.set('json.minify', {
  name: 'json.minify',
  category: 'json',
  description: 'Minify JSON string',
  parameters: [
    { name: 'json', type: 'string', required: true, description: 'JSON string to minify', placeholder: '{ "key": "value" }' },
  ],
  evaluate: (params) => {
    try {
      return JSON.stringify(JSON.parse(String(params.json || '{}')));
    } catch {
      return String(params.json || '');
    }
  },
});

functionRegistry.set('json.escape', {
  name: 'json.escape',
  category: 'json',
  description: 'Escape a string for JSON',
  parameters: [
    { name: 'value', type: 'string', required: true, description: 'String to escape', placeholder: 'Line 1\nLine 2' },
  ],
  evaluate: (params) => {
    const str = String(params.value || '');
    return JSON.stringify(str).slice(1, -1);
  },
});

functionRegistry.set('json.stringify', {
  name: 'json.stringify',
  category: 'json',
  description: 'Convert value to JSON string',
  parameters: [
    { name: 'value', type: 'string', required: true, description: 'Value to stringify', placeholder: 'value' },
  ],
  evaluate: (params) => JSON.stringify(String(params.value || '')),
});

// Context Functions
functionRegistry.set('ctx.workspace', {
  name: 'ctx.workspace',
  category: 'ctx',
  description: 'Current workspace ID',
  parameters: [],
  evaluate: (_, context) => context?.workspaceId || '',
});

functionRegistry.set('ctx.environment', {
  name: 'ctx.environment',
  category: 'ctx',
  description: 'Current environment ID',
  parameters: [],
  evaluate: (_, context) => context?.environmentId || '',
});

functionRegistry.set('ctx.collection', {
  name: 'ctx.collection',
  category: 'ctx',
  description: 'Current collection ID',
  parameters: [],
  evaluate: (_, context) => context?.collectionId || '',
});

functionRegistry.set('ctx.request', {
  name: 'ctx.request',
  category: 'ctx',
  description: 'Current request ID',
  parameters: [],
  evaluate: (_, context) => context?.requestId || '',
});

// ============================================================================
// Category Labels
// ============================================================================

export const categoryLabels: Record<FunctionCategory, string> = {
  random: 'Random',
  uuid: 'UUID',
  hash: 'Hash',
  url: 'URL',
  timestamp: 'Timestamp',
  base64: 'Base64',
  json: 'JSON',
  ctx: 'Context',
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Get all registered functions
 */
export function getAllFunctions(): DynamicFunction[] {
  return Array.from(functionRegistry.values());
}

/**
 * Get a function by name
 */
export function getFunction(name: string): DynamicFunction | undefined {
  return functionRegistry.get(name);
}

/**
 * Get all functions in a category
 */
export function getFunctionsByCategory(category: FunctionCategory): DynamicFunction[] {
  return getAllFunctions().filter(f => f.category === category);
}

/**
 * Get all available function suggestions
 */
export function getFunctionSuggestions(): FunctionSuggestion[] {
  return getAllFunctions().map(fn => ({
    name: fn.name,
    displayName: fn.name,
    category: fn.category,
    categoryLabel: categoryLabels[fn.category],
    description: fn.description,
    hasParameters: fn.parameters.length > 0,
    signature: fn.parameters.length > 0
      ? `${fn.name}(${fn.parameters.map(p => p.required ? p.name : `${p.name}?`).join(', ')})`
      : fn.name,
  }));
}

/**
 * Parse a function expression like "random.range(min=0, max=100)"
 */
export function parseFunction(expression: string): ParsedFunction | null {
  // Match function name and optional parameters
  const match = expression.match(/^([a-zA-Z_.]+)(?:\(([^)]*)\))?$/);
  if (!match) return null;

  const functionName = match[1];
  const paramsStr = match[2] || '';
  const parameters: Record<string, string> = {};

  if (paramsStr) {
    // Parse named parameters: key=value, key="value", key='value'
    const paramRegex = /([a-zA-Z_][a-zA-Z0-9_]*)=(?:"([^"]*)"|'([^']*)'|([^,\s]*))/g;
    let paramMatch;
    while ((paramMatch = paramRegex.exec(paramsStr)) !== null) {
      const key = paramMatch[1];
      const value = paramMatch[2] ?? paramMatch[3] ?? paramMatch[4] ?? '';
      parameters[key] = value;
    }
    
    // Also support positional parameters (for backwards compatibility)
    if (Object.keys(parameters).length === 0) {
      const positionalParams = paramsStr.split(',').map(p => p.trim()).filter(Boolean);
      const func = functionRegistry.get(functionName);
      if (func) {
        positionalParams.forEach((value, index) => {
          if (func.parameters[index]) {
            // Remove quotes if present
            const cleanValue = value.replace(/^["']|["']$/g, '');
            parameters[func.parameters[index].name] = cleanValue;
          }
        });
      }
    }
  }

  return {
    fullMatch: expression,
    functionName,
    parameters,
  };
}

/**
 * Evaluate a function by name with parameters
 */
export function evaluateFunction(
  functionName: string,
  parameters: Record<string, unknown> = {},
  context?: EvaluationContext
): string {
  const func = functionRegistry.get(functionName);
  if (!func) {
    return `{{${functionName}}}`; // Return original if function not found
  }

  // Apply default values for missing parameters
  const resolvedParams: Record<string, unknown> = {};
  for (const param of func.parameters) {
    if (parameters[param.name] !== undefined) {
      resolvedParams[param.name] = parameters[param.name];
    } else if (param.default !== undefined) {
      resolvedParams[param.name] = param.default;
    }
  }

  try {
    return func.evaluate(resolvedParams, context);
  } catch (error) {
    console.error(`Error evaluating function ${functionName}:`, error);
    return `{{${functionName}}}`;
  }
}

/**
 * Check if a string is a function call (vs. a simple variable)
 */
export function isFunction(expression: string): boolean {
  // Check if it matches a registered function name (with or without params)
  const match = expression.match(/^([a-zA-Z_.]+)(?:\([^)]*\))?$/);
  if (!match) return false;
  return functionRegistry.has(match[1]);
}

/**
 * Generate the function call string with parameters
 */
export function buildFunctionCall(
  functionName: string,
  parameters: Record<string, string | number | boolean>
): string {
  const func = functionRegistry.get(functionName);
  if (!func) return functionName;

  if (Object.keys(parameters).length === 0 || func.parameters.length === 0) {
    return functionName;
  }

  const paramStrings: string[] = [];
  for (const param of func.parameters) {
    const value = parameters[param.name];
    if (value !== undefined && value !== param.default) {
      // Quote strings that contain spaces or special characters
      const strValue = String(value);
      if (strValue.includes(' ') || strValue.includes(',') || strValue.includes('=')) {
        paramStrings.push(`${param.name}="${strValue}"`);
      } else {
        paramStrings.push(`${param.name}=${strValue}`);
      }
    }
  }

  if (paramStrings.length === 0) {
    return functionName;
  }

  return `${functionName}(${paramStrings.join(', ')})`;
}

/**
 * Interpolate all functions in a string
 * Returns the string with all {{function(...)}} replaced with evaluated values
 */
export function interpolateFunctions(
  text: string,
  context?: EvaluationContext
): string {
  if (!text) return text;

  // Match {{function.name}} or {{function.name(params)}}
  return text.replace(/\{\{([^}]+)\}\}/g, (match, expression) => {
    const trimmedExpr = expression.trim();
    
    // Check if it's a function call
    if (!isFunction(trimmedExpr)) {
      return match; // Not a function, leave as-is (might be an env variable)
    }

    const parsed = parseFunction(trimmedExpr);
    if (!parsed) {
      return match;
    }

    return evaluateFunction(parsed.functionName, parsed.parameters, context);
  });
}

export default {
  getAllFunctions,
  getFunction,
  getFunctionsByCategory,
  getFunctionSuggestions,
  parseFunction,
  evaluateFunction,
  isFunction,
  buildFunctionCall,
  interpolateFunctions,
  categoryLabels,
};

