import { Environment } from '@/types';
import { 
  isFunction, 
  parseFunction, 
  evaluateFunction, 
  EvaluationContext 
} from '@/services/DynamicFunctions';

// ============================================================================
// Types
// ============================================================================

export interface ParsedExpression {
  fullMatch: string;
  expression: string;
  type: 'variable' | 'function';
  functionName?: string;
  parameters?: Record<string, string>;
}

export type HighlightType = 'text' | 'variable' | 'unresolved' | 'function';

export interface HighlightPart {
  text: string;
  type: HighlightType;
  functionName?: string;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Extract all variable/function expressions from a string
 * Returns array of expressions without the {{ }} wrapper
 */
export function extractVariables(text: string): string[] {
  const matches = text.match(/\{\{([^}]+)\}\}/g);
  if (!matches) return [];

  return matches.map(match => match.replace(/\{\{|\}\}/g, '').trim());
}

/**
 * Check if a string contains any variables or functions
 */
export function hasVariables(text: string): boolean {
  return /\{\{[^}]+\}\}/.test(text);
}

/**
 * Parse an expression to determine if it's a variable or function
 */
export function parseExpression(expression: string): ParsedExpression {
  const trimmed = expression.trim();
  
  // Check if it's a function call
  if (isFunction(trimmed)) {
    const parsed = parseFunction(trimmed);
    if (parsed) {
      return {
        fullMatch: `{{${expression}}}`,
        expression: trimmed,
        type: 'function',
        functionName: parsed.functionName,
        parameters: parsed.parameters,
      };
    }
  }
  
  // It's a simple variable
  return {
    fullMatch: `{{${expression}}}`,
    expression: trimmed,
    type: 'variable',
  };
}

/**
 * Extract all expressions with their parsed info
 */
export function extractExpressions(text: string): ParsedExpression[] {
  const matches = text.match(/\{\{([^}]+)\}\}/g);
  if (!matches) return [];

  return matches.map(match => {
    const expression = match.replace(/\{\{|\}\}/g, '');
    return parseExpression(expression);
  });
}

/**
 * Replace all variables in a string with their values from the environment
 * Variables without values are left as-is
 */
export function interpolate(text: string, environment: Environment | null): string {
  if (!text || !environment) return text;

  return text.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
    const variable = environment.variables.find(
      v => v.key === varName.trim() && v.enabled
    );
    return variable ? variable.value : match;
  });
}

/**
 * Interpolate all variables and functions in a string
 * Environment variables take precedence over functions
 */
export function interpolateAll(
  text: string,
  environment: Environment | null,
  context?: EvaluationContext
): string {
  if (!text) return text;

  return text.replace(/\{\{([^}]+)\}\}/g, (match, expression) => {
    const trimmed = expression.trim();
    
    // First, check if it's an environment variable
    if (environment) {
      const variable = environment.variables.find(
        v => v.key === trimmed && v.enabled
      );
      if (variable) {
        return variable.value;
      }
    }
    
    // Then, check if it's a function
    if (isFunction(trimmed)) {
      const parsed = parseFunction(trimmed);
      if (parsed) {
        return evaluateFunction(parsed.functionName, parsed.parameters, context);
      }
    }
    
    // Return original if not found
    return match;
  });
}

/**
 * Get all unresolved variables (variables that don't have values in the environment)
 * Functions are considered "resolved" if they exist
 */
export function getUnresolvedVariables(
  text: string,
  environment: Environment | null
): string[] {
  if (!text) return [];

  const expressions = extractVariables(text);
  
  return expressions.filter(expr => {
    // Check if it's an environment variable
    if (environment) {
      const variable = environment.variables.find(
        v => v.key === expr && v.enabled
      );
      if (variable) return false;
    }
    
    // Check if it's a valid function
    if (isFunction(expr)) {
      return false;
    }
    
    // It's an unresolved variable
    return true;
  });
}

/**
 * Highlight variables and functions in text
 * Returns an array of parts with type info for rendering
 */
export function highlightVariables(
  text: string,
  environment: Environment | null
): HighlightPart[] {
  if (!text) return [];

  const parts: HighlightPart[] = [];
  let lastIndex = 0;

  const regex = /\{\{([^}]+)\}\}/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before the variable/function
    if (match.index > lastIndex) {
      parts.push({
        text: text.slice(lastIndex, match.index),
        type: 'text',
      });
    }

    const expression = match[1].trim();
    
    // Check if it's an environment variable
    const isEnvVar = environment?.variables.find(
      v => v.key === expression && v.enabled
    );
    
    // Check if it's a function
    const isFn = isFunction(expression);
    
    if (isFn) {
      const parsed = parseFunction(expression);
      parts.push({
        text: match[0],
        type: 'function',
        functionName: parsed?.functionName,
      });
    } else if (isEnvVar) {
      parts.push({
        text: match[0],
        type: 'variable',
      });
    } else {
      parts.push({
        text: match[0],
        type: 'unresolved',
      });
    }

    lastIndex = regex.lastIndex;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push({
      text: text.slice(lastIndex),
      type: 'text',
    });
  }

  return parts;
}

/**
 * Check if an expression is a valid function call
 */
export function isFunctionExpression(expression: string): boolean {
  return isFunction(expression.trim());
}

/**
 * Get the base variable/function name from an expression
 * e.g., "random.range(min=0, max=100)" -> "random.range"
 */
export function getBaseName(expression: string): string {
  const trimmed = expression.trim();
  const parenIndex = trimmed.indexOf('(');
  return parenIndex > -1 ? trimmed.slice(0, parenIndex) : trimmed;
}

/**
 * Preview a function's output without modifying the original text
 */
export function previewFunction(
  functionName: string,
  parameters: Record<string, string> = {},
  context?: EvaluationContext
): string {
  return evaluateFunction(functionName, parameters, context);
}
