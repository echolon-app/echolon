import { Environment } from '@/types';

/**
 * Extract all variable names from a string
 * Returns array of variable names without the {{ }} wrapper
 */
export function extractVariables(text: string): string[] {
  const matches = text.match(/\{\{([^}]+)\}\}/g);
  if (!matches) return [];

  return matches.map(match => match.replace(/\{\{|\}\}/g, '').trim());
}

/**
 * Check if a string contains any variables
 */
export function hasVariables(text: string): boolean {
  return /\{\{[^}]+\}\}/.test(text);
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
 * Get all unresolved variables (variables that don't have values in the environment)
 */
export function getUnresolvedVariables(
  text: string,
  environment: Environment | null
): string[] {
  if (!text) return [];

  const variables = extractVariables(text);
  if (!environment) return variables;

  return variables.filter(varName => {
    const variable = environment.variables.find(
      v => v.key === varName && v.enabled
    );
    return !variable;
  });
}

/**
 * Highlight variables in text by wrapping them in spans
 * Returns an array of parts with type info for rendering
 */
export function highlightVariables(
  text: string,
  environment: Environment | null
): Array<{ text: string; type: 'text' | 'variable' | 'unresolved' }> {
  if (!text) return [];

  const parts: Array<{ text: string; type: 'text' | 'variable' | 'unresolved' }> = [];
  let lastIndex = 0;

  const regex = /\{\{([^}]+)\}\}/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before the variable
    if (match.index > lastIndex) {
      parts.push({
        text: text.slice(lastIndex, match.index),
        type: 'text',
      });
    }

    // Check if variable is resolved
    const varName = match[1].trim();
    const isResolved = environment?.variables.find(
      v => v.key === varName && v.enabled
    );

    parts.push({
      text: match[0],
      type: isResolved ? 'variable' : 'unresolved',
    });

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

