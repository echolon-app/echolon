import React, { forwardRef, useState, useCallback, useRef, useEffect, useMemo, useContext } from 'react';
import { createPortal } from 'react-dom';
import EnvironmentsContext from '@/contexts/EnvironmentsContext';
import { CollectionEnvironment } from '@/types';
import {
  getFunctionSuggestions,
  getFunction,
  evaluateFunction,
  categoryLabels,
  FunctionCategory,
  FunctionSuggestion,
  isFunction,
  parseFunction,
} from '@/services/DynamicFunctions';
import { FunctionConfigModal } from '@/components/modals/FunctionConfigModal';
import './Input.css';

// Callback type for navigating to a variable definition
export type NavigateToVariableCallback = (
  variableName: string,
  source: 'global' | 'collection',
  sourceId: string
) => void;

// Types for unified suggestions
interface UnifiedSuggestion {
  id: string;
  name: string;
  displayName: string;
  type: 'variable' | 'function';
  category: string;
  categoryLabel: string;
  description?: string;
  value?: string;
  hasParameters?: boolean;
  signature?: string;
}

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  error?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  onIconClick?: () => void;
  supportVariables?: boolean;
  suggestions?: string[];
  /** Collection environment for variable resolution (overrides global) */
  collectionEnvironment?: CollectionEnvironment | null;
  /** Path parameters for URL path variable resolution (e.g., :id) */
  pathParams?: Array<{ key: string; value: string }>;
  /** Callback when user double-clicks a variable to navigate to its definition */
  onNavigateToVariable?: NavigateToVariableCallback;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
  size = 'md',
  error = false,
  icon,
  iconPosition = 'left',
  onIconClick,
  supportVariables = false,
  suggestions = [],
  collectionEnvironment,
  pathParams = [],
  onNavigateToVariable,
  className = '',
  value,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  placeholder,
  disabled,
  ...props
}, ref) => {
  const [localValue, setLocalValue] = useState(value || '');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [suggestionPosition, setSuggestionPosition] = useState({ top: 0, left: 0, width: 0 });
  const [variableTooltip, setVariableTooltip] = useState<{ text: string; source: string; x: number; y: number } | null>(null);
  const [isTypingVariable, setIsTypingVariable] = useState(false);
  const [variableFilter, setVariableFilter] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [functionModalOpen, setFunctionModalOpen] = useState(false);
  const [selectedFunction, setSelectedFunction] = useState<string | null>(null);
  const [isEditingFunction, setIsEditingFunction] = useState(false);
  const [editingFunctionExpression, setEditingFunctionExpression] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const editableRef = useRef<HTMLDivElement>(null);
  // Track when we're handling user input to prevent useEffect from interfering
  const isHandlingInputRef = useRef(false);
  
  // Only access environment context if supportVariables is enabled
  const envContext = useContext(EnvironmentsContext);
  const activeEnvironment = supportVariables ? envContext?.activeEnvironment : null;
  const getVariableWithSource = supportVariables ? envContext?.getVariableWithSource : null;
  const getMergedVariables = supportVariables ? envContext?.getMergedVariables : null;
  
  // Get merged variable names (collection vars override global)
  const variableNames = useMemo(() => {
    if (!supportVariables) return [];
    
    if (getMergedVariables) {
      return getMergedVariables(collectionEnvironment || null)
        .filter(v => v.enabled && v.key)
        .map(v => v.key);
    }
    
    // Fallback to just active environment
    if (!activeEnvironment) return [];
    return activeEnvironment.variables
      .filter(v => v.enabled && v.key)
      .map(v => v.key);
  }, [supportVariables, getMergedVariables, collectionEnvironment, activeEnvironment]);
  
  // Get environment color for variable highlighting
  // Priority: collection environment (highest in dropdown) > global environment > primary color
  const collectionEnvColor = collectionEnvironment?.color;
  const globalEnvColor = activeEnvironment?.color;
  
  const envColor = useMemo(() => {
    // First check collection environment color (has highest priority in dropdown)
    if (collectionEnvColor) {
      return collectionEnvColor;
    }
    // Then check global environment color
    if (globalEnvColor) {
      return globalEnvColor;
    }
    // Fall back to null (CSS will use primary color)
    return null;
  }, [collectionEnvColor, globalEnvColor]);
  
  // Get variable value with source information
  const getVariableValue = useCallback((varName: string): string | null => {
    if (!supportVariables) return null;
    
    // First check if it's a function
    if (isFunction(varName)) {
      const parsed = parseFunction(varName);
      if (parsed) {
        return evaluateFunction(parsed.functionName, parsed.parameters);
      }
    }
    
    if (getVariableWithSource) {
      const resolved = getVariableWithSource(varName, collectionEnvironment || null);
      return resolved ? resolved.value : null;
    }
    
    // Fallback to just active environment
    if (!activeEnvironment) return null;
    const variable = activeEnvironment.variables.find(v => v.key === varName && v.enabled);
    return variable ? variable.value : null;
  }, [supportVariables, getVariableWithSource, collectionEnvironment, activeEnvironment]);

  // Get variable with full source info for tooltip
  const getVariableInfo = useCallback((varName: string): { value: string; source: string } | null => {
    if (!supportVariables) return null;
    
    // Check if it's a function
    if (isFunction(varName)) {
      const parsed = parseFunction(varName);
      if (parsed) {
        const func = getFunction(parsed.functionName);
        const preview = evaluateFunction(parsed.functionName, parsed.parameters);
        return {
          value: preview,
          source: `Function: ${categoryLabels[func?.category || 'random']}`,
        };
      }
    }
    
    if (getVariableWithSource) {
      const resolved = getVariableWithSource(varName, collectionEnvironment || null);
      if (resolved) {
        return {
          value: resolved.value,
          source: resolved.source === 'collection' 
            ? `Collection: ${resolved.sourceName}` 
            : `Global: ${resolved.sourceName}`,
        };
      }
    }
    
    // Fallback to just active environment
    if (!activeEnvironment) return null;
    const variable = activeEnvironment.variables.find(v => v.key === varName && v.enabled);
    if (variable) {
      return {
        value: variable.value,
        source: `Global: ${activeEnvironment.name}`,
      };
    }
    
    return null;
  }, [supportVariables, getVariableWithSource, collectionEnvironment, activeEnvironment]);

  // Get variable source details for navigation (returns source type and ID)
  const getVariableSourceDetails = useCallback((varName: string): { 
    source: 'global' | 'collection'; 
    sourceId: string;
  } | null => {
    if (!supportVariables) return null;
    
    if (getVariableWithSource) {
      const resolved = getVariableWithSource(varName, collectionEnvironment || null);
      if (resolved) {
        if (resolved.source === 'collection' && collectionEnvironment) {
          return { source: 'collection', sourceId: collectionEnvironment.id };
        }
        // For global, sourceId is the environment ID
        if (resolved.source === 'global' && activeEnvironment) {
          return { source: 'global', sourceId: activeEnvironment.id };
        }
      }
    }
    
    // Fallback to just active environment
    if (!activeEnvironment) return null;
    const variable = activeEnvironment.variables.find(v => v.key === varName && v.enabled);
    if (variable) {
      return { source: 'global', sourceId: activeEnvironment.id };
    }
    
    return null;
  }, [supportVariables, getVariableWithSource, collectionEnvironment, activeEnvironment]);

  const currentValue = value !== undefined ? value : localValue;
  const currentValueStr = String(currentValue).toLowerCase();
  
  // Get all function suggestions
  const functionSuggestions = useMemo<FunctionSuggestion[]>(() => {
    if (!supportVariables) return [];
    return getFunctionSuggestions();
  }, [supportVariables]);
  
  // Build unified suggestions (env vars + functions)
  const unifiedSuggestions = useMemo<UnifiedSuggestion[]>(() => {
    if (!supportVariables) return [];
    
    const filter = variableFilter.toLowerCase();
    const result: UnifiedSuggestion[] = [];
    
    // Add environment variables first
    variableNames
      .filter(name => name.toLowerCase().includes(filter))
      .forEach(name => {
        const varValue = getVariableValue(name);
        result.push({
          id: `var-${name}`,
          name,
          displayName: name,
          type: 'variable',
          category: 'environment',
          categoryLabel: 'Environment',
          value: varValue || '',
        });
      });
    
    // Add functions
    functionSuggestions
      .filter(fn => fn.name.toLowerCase().includes(filter) || fn.description.toLowerCase().includes(filter))
      .forEach(fn => {
        result.push({
          id: `fn-${fn.name}`,
          name: fn.name,
          displayName: fn.displayName,
          type: 'function',
          category: fn.category,
          categoryLabel: fn.categoryLabel,
          description: fn.description,
          hasParameters: fn.hasParameters,
          signature: fn.signature,
        });
      });
    
    return result.slice(0, 20);
  }, [supportVariables, variableFilter, variableNames, functionSuggestions, getVariableValue]);
  
  // Group suggestions by category for display
  const groupedSuggestions = useMemo(() => {
    const groups: { [key: string]: UnifiedSuggestion[] } = {};
    
    unifiedSuggestions.forEach(suggestion => {
      const key = suggestion.categoryLabel;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(suggestion);
    });
    
    return groups;
  }, [unifiedSuggestions]);
  
  // Flat list for keyboard navigation
  const flatSuggestions = useMemo(() => {
    return unifiedSuggestions;
  }, [unifiedSuggestions]);
  
  // Determine which suggestions to show (for non-variable mode)
  const filteredSuggestions = useMemo(() => {
    if (isTypingVariable && supportVariables) {
      // Use unified suggestions in variable mode
      return [];
    }
    
    if (currentValueStr.length === 0) {
      return suggestions.slice(0, 10);
    }
    return suggestions.filter(s => 
      s.toLowerCase().includes(currentValueStr) && 
      s.toLowerCase() !== currentValueStr
    );
  }, [isTypingVariable, supportVariables, currentValueStr, suggestions]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset selection when suggestions change
  useEffect(() => {
    setSelectedSuggestionIndex(-1);
  }, [flatSuggestions.length, filteredSuggestions.length]);

  // Get plain text from contenteditable
  const getPlainText = useCallback((element: HTMLElement): string => {
    return element.textContent || '';
  }, []);

  // Get cursor position in contenteditable
  const getCursorPosition = useCallback((element: HTMLElement): number => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return 0;
    
    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    return preCaretRange.toString().length;
  }, []);

  // Set cursor position in contenteditable
  const setCursorPosition = useCallback((element: HTMLElement, position: number) => {
    const selection = window.getSelection();
    if (!selection) return;
    
    const range = document.createRange();
    let currentPos = 0;
    let found = false;
    
    const walkNodes = (node: Node): boolean => {
      if (node.nodeType === Node.TEXT_NODE) {
        const textLength = node.textContent?.length || 0;
        if (currentPos + textLength >= position) {
          range.setStart(node, position - currentPos);
          range.setEnd(node, position - currentPos);
          found = true;
          return true;
        }
        currentPos += textLength;
      } else {
        for (const child of Array.from(node.childNodes)) {
          if (walkNodes(child)) return true;
        }
      }
      return false;
    };
    
    walkNodes(element);
    
    if (!found) {
      // If position is beyond content, put cursor at end
      range.selectNodeContents(element);
      range.collapse(false);
    }
    
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  // Get path parameter value
  const getPathParamValue = useCallback((paramName: string): string | null => {
    const param = pathParams.find(p => p.key === paramName);
    return param ? param.value : null;
  }, [pathParams]);

  // Check if expression is a valid function or variable
  const isValidExpression = useCallback((expr: string): boolean => {
    // Check if it's a function
    if (isFunction(expr)) return true;
    
    // Check if it's an environment variable
    if (getVariableValue(expr) !== null) return true;
    
    return false;
  }, [getVariableValue]);

  // Render content with highlighted variables and path params
  const renderHighlightedContent = useCallback((text: string): React.ReactNode[] => {
    const result: React.ReactNode[] = [];
    // Combined regex: env variables {{...}}, path params :name, or path params {name} (single braces)
    // The (?<!\{) and (?!\}) ensure we don't match {{var}} as {var}
    const regex = /({{[^}]+}}|:([a-zA-Z_][a-zA-Z0-9_]*)|(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\}))/g;
    let lastIndex = 0;
    let match;
    let keyIndex = 0;
    
    while ((match = regex.exec(text)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        result.push(text.slice(lastIndex, match.index));
      }
      
      const fullMatch = match[0];
      
      // Check for {{variable}} pattern
      if (fullMatch.startsWith('{{')) {
        const varName = fullMatch.slice(2, -2); // Remove {{ and }}
        const isFunc = isFunction(varName);
        const varValue = getVariableValue(varName);
        const isValid = varValue !== null || isFunc;
        
        // Apply environment color explicitly when valid
        // Convert hex color to rgba for background with 20% opacity
        let varStyle: React.CSSProperties | undefined;
        if (isValid && !isFunc && envColor) {
          // Parse hex color and create rgba
          const hex = envColor.replace('#', '');
          const r = parseInt(hex.substring(0, 2), 16);
          const g = parseInt(hex.substring(2, 4), 16);
          const b = parseInt(hex.substring(4, 6), 16);
          varStyle = {
            backgroundColor: `rgba(${r}, ${g}, ${b}, 0.2)`,
            color: envColor,
          };
        }
        
        result.push(
          <span 
            key={`env-${keyIndex++}`} 
            className={`input__variable ${!isValid ? 'input__variable--invalid' : ''} ${isFunc ? 'input__variable--function' : ''}`}
            data-variable={varName}
            data-is-function={isFunc ? 'true' : undefined}
            style={varStyle}
          >
          {fullMatch}
          </span>
        );
      }
      // Check for :pathParam pattern (Express-style)
      else if (fullMatch.startsWith(':')) {
        // Only highlight if pathParams are defined, otherwise just add as plain text
        if (pathParams.length > 0) {
          const paramName = fullMatch.slice(1); // Remove :
          const paramValue = getPathParamValue(paramName);
          const hasValue = paramValue !== null && paramValue !== '';
          result.push(
            <span 
              key={`path-${keyIndex++}`} 
              className={`input__path-param ${!hasValue ? 'input__path-param--empty' : ''}`}
              data-path-param={paramName}
            >
              {fullMatch}
            </span>
          );
        } else {
          // No pathParams defined, add as plain text to avoid losing the content
          result.push(fullMatch);
        }
      }
      // Check for {pathParam} pattern (OpenAPI-style, single braces)
      else if (fullMatch.startsWith('{') && fullMatch.endsWith('}')) {
        // Only highlight if pathParams are defined, otherwise just add as plain text
        if (pathParams.length > 0) {
          const paramName = fullMatch.slice(1, -1); // Remove { and }
          const paramValue = getPathParamValue(paramName);
          const hasValue = paramValue !== null && paramValue !== '';
          result.push(
            <span 
              key={`path-${keyIndex++}`} 
              className={`input__path-param ${!hasValue ? 'input__path-param--empty' : ''}`}
              data-path-param={paramName}
            >
              {fullMatch}
            </span>
          );
        } else {
          // No pathParams defined, add as plain text to avoid losing the content
          result.push(fullMatch);
        }
      }
      
      lastIndex = regex.lastIndex;
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
      result.push(text.slice(lastIndex));
    }
    
    return result;
  }, [getVariableValue, pathParams, getPathParamValue, envColor]);

  // Update contenteditable display
  const updateEditableDisplay = useCallback((text: string, preserveCursor: boolean = true) => {
    if (!editableRef.current) return;
    
    const cursorPos = preserveCursor ? getCursorPosition(editableRef.current) : 0;
    
    // Clear and rebuild content
    editableRef.current.innerHTML = '';
    const parts = renderHighlightedContent(text);
    
    parts.forEach(part => {
      if (typeof part === 'string') {
        editableRef.current?.appendChild(document.createTextNode(part));
      } else if (React.isValidElement(part)) {
        const span = document.createElement('span');
        span.className = part.props.className;
        // Handle both environment variables and path params
        if (part.props['data-variable']) {
          span.setAttribute('data-variable', part.props['data-variable']);
        }
        if (part.props['data-is-function']) {
          span.setAttribute('data-is-function', part.props['data-is-function']);
        }
        if (part.props['style']) {
          for (const key in part.props['style']) {
            span.style[key as any] = part.props['style'][key];
          }
        }
        if (part.props['data-path-param']) {
          span.setAttribute('data-path-param', part.props['data-path-param']);
        }
        span.textContent = part.props.children as string;
        editableRef.current?.appendChild(span);
      }
    });
    
    // Only check preserveCursor parameter, not isFocused state (to avoid stale closure issues)
    if (preserveCursor) {
      setCursorPosition(editableRef.current, Math.min(cursorPos, text.length));
    }
  }, [getCursorPosition, setCursorPosition, renderHighlightedContent]);

  // Sync contenteditable with value
  useEffect(() => {
    // Skip if we're currently handling user input - handleEditableInput already updated the display
    if (isHandlingInputRef.current) return;
    
    if (supportVariables && editableRef.current) {
      const plainText = getPlainText(editableRef.current);
      const newValue = String(currentValue || '');
      if (plainText !== newValue) {
        // Preserve cursor position if the input is focused (user is actively typing)
        updateEditableDisplay(newValue, isFocused);
      }
    }
  }, [currentValue, supportVariables, getPlainText, updateEditableDisplay, isFocused]);

  // Track previous environment to detect actual environment changes (not just currentValue changes)
  const prevEnvironmentRef = useRef<typeof activeEnvironment>(null);
  const prevEnvColorRef = useRef<string | null>(null);
  
  // Re-render variable highlighting only when environment actually changes
  useEffect(() => {
    // Skip if we're currently handling user input
    if (isHandlingInputRef.current) return;
    
    // Only re-render if the environment reference changed (not on every value change)
    if (supportVariables && editableRef.current && activeEnvironment && prevEnvironmentRef.current !== activeEnvironment) {
      prevEnvironmentRef.current = activeEnvironment;
      const newValue = String(currentValue || '');
      // Force re-render to update variable validation state, preserve cursor if focused
      updateEditableDisplay(newValue, isFocused);
    }
  }, [activeEnvironment, supportVariables, currentValue, updateEditableDisplay, isFocused]);
  
  // Re-render when environment color changes (collection or global)
  useEffect(() => {
    // Skip if we're currently handling user input
    if (isHandlingInputRef.current) return;
    
    if (supportVariables && editableRef.current && envColor !== prevEnvColorRef.current) {
      prevEnvColorRef.current = envColor;
      const newValue = String(currentValue || '');
      // Force re-render to update variable colors, preserve cursor if focused
      updateEditableDisplay(newValue, isFocused);
    }
  }, [envColor, supportVariables, currentValue, updateEditableDisplay, isFocused]);

  const emitChange = useCallback((newValue: string) => {
    setLocalValue(newValue);
    const syntheticEvent = {
      target: { value: newValue },
      currentTarget: { value: newValue },
    } as React.ChangeEvent<HTMLInputElement>;
    onChange?.(syntheticEvent);
  }, [onChange]);

  // Handle contenteditable input
  const handleEditableInput = useCallback(() => {
    if (!editableRef.current) return;
    
    // Mark that we're handling input - prevents useEffect from interfering
    isHandlingInputRef.current = true;
    
    const newValue = getPlainText(editableRef.current);
    const cursorPos = getCursorPosition(editableRef.current);
    
    // Update display with highlighting
    updateEditableDisplay(newValue);
    
    emitChange(newValue);
    
    // Clear the flag after React has processed the state update
    requestAnimationFrame(() => {
      isHandlingInputRef.current = false;
    });
    
    // Check if user is typing a variable
    if (supportVariables) {
      const textBeforeCursor = newValue.slice(0, cursorPos);
      const lastOpenBraces = textBeforeCursor.lastIndexOf('{{');
      const lastCloseBraces = textBeforeCursor.lastIndexOf('}}');
      
      if (lastOpenBraces > lastCloseBraces && lastOpenBraces !== -1) {
        const varText = textBeforeCursor.slice(lastOpenBraces + 2);
        setIsTypingVariable(true);
        setVariableFilter(varText);
        
        if (wrapperRef.current) {
          const rect = wrapperRef.current.getBoundingClientRect();
          setSuggestionPosition({
            top: rect.bottom + 4,
            left: rect.left,
            width: Math.max(rect.width, 320),
          });
          setShowSuggestions(true);
        }
        return;
      }
    }
    
    setIsTypingVariable(false);
    setVariableFilter('');
    
    if (suggestions.length > 0 && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setSuggestionPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
      setShowSuggestions(true);
    }
  }, [getPlainText, getCursorPosition, updateEditableDisplay, emitChange, supportVariables, suggestions.length]);

  // Standard input change handler
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart || 0;
    setLocalValue(newValue);
    onChange?.(e);
    
    if (supportVariables) {
      const textBeforeCursor = newValue.slice(0, cursorPos);
      const lastOpenBraces = textBeforeCursor.lastIndexOf('{{');
      const lastCloseBraces = textBeforeCursor.lastIndexOf('}}');
      
      if (lastOpenBraces > lastCloseBraces && lastOpenBraces !== -1) {
        const varText = textBeforeCursor.slice(lastOpenBraces + 2);
        setIsTypingVariable(true);
        setVariableFilter(varText);
        
        if (wrapperRef.current) {
          const rect = wrapperRef.current.getBoundingClientRect();
          setSuggestionPosition({
            top: rect.bottom + 4,
            left: rect.left,
            width: Math.max(rect.width, 320),
          });
          setShowSuggestions(true);
        }
        return;
      }
    }
    
    setIsTypingVariable(false);
    setVariableFilter('');
    
    if (suggestions.length > 0 && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setSuggestionPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
      setShowSuggestions(true);
    }
  }, [onChange, suggestions.length, supportVariables]);

  const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement | HTMLDivElement>) => {
    setIsFocused(true);
    if (suggestions.length > 0 && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setSuggestionPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
      setShowSuggestions(true);
    }
    if (!supportVariables) {
      onFocus?.(e as React.FocusEvent<HTMLInputElement>);
    }
  }, [onFocus, suggestions.length, supportVariables]);

  const handleBlur = useCallback((e: React.FocusEvent<HTMLInputElement | HTMLDivElement>) => {
    setIsFocused(false);
    setTimeout(() => {
      setShowSuggestions(false);
    }, 150);
    if (!supportVariables) {
      onBlur?.(e as React.FocusEvent<HTMLInputElement>);
    }
  }, [onBlur, supportVariables]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement | HTMLDivElement>) => {
    const totalSuggestions = isTypingVariable ? flatSuggestions.length : filteredSuggestions.length;
    
    if (showSuggestions && totalSuggestions > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => 
          prev < totalSuggestions - 1 ? prev + 1 : 0
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => 
          prev > 0 ? prev - 1 : totalSuggestions - 1
        );
      } else if (e.key === 'Enter' && selectedSuggestionIndex >= 0) {
        e.preventDefault();
        if (isTypingVariable) {
          const selected = flatSuggestions[selectedSuggestionIndex];
          if (selected) {
            // Will be handled by handleSelectSuggestion after it's defined
            if (selected.type === 'function' && selected.hasParameters) {
              setSelectedFunction(selected.name);
              setIsEditingFunction(false);
              setEditingFunctionExpression(null);
              setFunctionModalOpen(true);
              setShowSuggestions(false);
            } else {
              const insertValue = selected.type === 'function' ? `${selected.name}()` : selected.name;
              // Inline the selection logic to avoid circular dependency
              const currentStr = String(currentValue);
              let cursorPos: number;
              if (supportVariables && editableRef.current) {
                cursorPos = getCursorPosition(editableRef.current);
              } else {
                cursorPos = inputRef.current?.selectionStart || currentStr.length;
              }
              
              const textBeforeCursor = currentStr.slice(0, cursorPos);
              const textAfterCursor = currentStr.slice(cursorPos);
              
              const lastOpenBraces = textBeforeCursor.lastIndexOf('{{');
              const beforeVariable = currentStr.slice(0, lastOpenBraces + 2);
              
              const hasClosing = textAfterCursor.startsWith('}}');
              const newValue = beforeVariable + insertValue + (hasClosing ? '' : '}}') + textAfterCursor;
              
              setIsTypingVariable(false);
              setVariableFilter('');
              emitChange(newValue);
              setShowSuggestions(false);
              
              if (supportVariables && editableRef.current) {
                updateEditableDisplay(newValue, false);
                editableRef.current.focus();
                setCursorPosition(editableRef.current, newValue.length);
              } else {
                inputRef.current?.focus();
              }
            }
          }
        } else {
          // Non-variable mode - just use the suggestion as is
          const newValue = filteredSuggestions[selectedSuggestionIndex];
          emitChange(newValue);
          setShowSuggestions(false);
          inputRef.current?.focus();
        }
        return;
      } else if (e.key === 'Escape') {
        setShowSuggestions(false);
      }
    }
    if (!supportVariables) {
      onKeyDown?.(e as React.KeyboardEvent<HTMLInputElement>);
    }
  }, [showSuggestions, flatSuggestions, filteredSuggestions, selectedSuggestionIndex, onKeyDown, supportVariables, isTypingVariable, currentValue, getCursorPosition, emitChange, updateEditableDisplay, setCursorPosition]);

  const selectSuggestion = useCallback((suggestion: string) => {
    let newValue: string;
    const currentStr = String(currentValue);
    
    if (isTypingVariable) {
      let cursorPos: number;
      if (supportVariables && editableRef.current) {
        cursorPos = getCursorPosition(editableRef.current);
      } else {
        cursorPos = inputRef.current?.selectionStart || currentStr.length;
      }
      
      const textBeforeCursor = currentStr.slice(0, cursorPos);
      const textAfterCursor = currentStr.slice(cursorPos);
      
      const lastOpenBraces = textBeforeCursor.lastIndexOf('{{');
      const beforeVariable = currentStr.slice(0, lastOpenBraces + 2);
      
      const hasClosing = textAfterCursor.startsWith('}}');
      newValue = beforeVariable + suggestion + (hasClosing ? '' : '}}') + textAfterCursor;
      
      setIsTypingVariable(false);
      setVariableFilter('');
    } else {
      newValue = suggestion;
    }
    
    emitChange(newValue);
    setShowSuggestions(false);
    
    // Update contenteditable if using it
    if (supportVariables && editableRef.current) {
      updateEditableDisplay(newValue, false);
      editableRef.current.focus();
      setCursorPosition(editableRef.current, newValue.length);
    } else {
      inputRef.current?.focus();
    }
  }, [currentValue, isTypingVariable, supportVariables, getCursorPosition, emitChange, updateEditableDisplay, setCursorPosition]);

  // Handle selecting a unified suggestion
  const handleSelectSuggestion = useCallback((suggestion: UnifiedSuggestion) => {
    if (suggestion.type === 'function' && suggestion.hasParameters) {
      // Open modal for function configuration
      setSelectedFunction(suggestion.name);
      setIsEditingFunction(false);
      setEditingFunctionExpression(null);
      setFunctionModalOpen(true);
      setShowSuggestions(false);
    } else {
      // Insert directly - for functions without params, add () to the name
      const insertValue = suggestion.type === 'function' ? `${suggestion.name}()` : suggestion.name;
      selectSuggestion(insertValue);
    }
  }, [selectSuggestion]);

  // Track if we were typing a variable when modal opened (to handle blur timeout issue)
  const wasTypingVariableRef = useRef(false);
  
  // Update ref when typing variable state changes or modal opens
  useEffect(() => {
    if (functionModalOpen && isTypingVariable) {
      wasTypingVariableRef.current = true;
    } else if (!functionModalOpen) {
      wasTypingVariableRef.current = false;
    }
  }, [functionModalOpen, isTypingVariable]);

  // Handle function modal insert
  const handleFunctionInsert = useCallback((functionCall: string) => {
    // The functionCall already includes {{ and }}
    const currentStr = String(currentValue);
    
    // Find where the {{ started - look for unclosed {{
    const lastOpenBraces = currentStr.lastIndexOf('{{');
    const lastCloseBraces = currentStr.lastIndexOf('}}');
    const hasUnclosedBraces = lastOpenBraces !== -1 && lastOpenBraces > lastCloseBraces;
    
    let newValue: string;
    if (hasUnclosedBraces || wasTypingVariableRef.current) {
      // Replace from {{ to end (or to }}) with the function call
      const beforeVariable = currentStr.slice(0, lastOpenBraces);
      // Check if there's a closing }} after the {{
      const afterOpen = currentStr.slice(lastOpenBraces);
      const closingIndex = afterOpen.indexOf('}}');
      const afterClosing = closingIndex !== -1 ? afterOpen.slice(closingIndex + 2) : '';
      newValue = beforeVariable + functionCall + afterClosing;
    } else {
      // No unclosed braces, just append at end
      newValue = currentStr + functionCall;
    }
    
    setIsTypingVariable(false);
    setVariableFilter('');
    wasTypingVariableRef.current = false;
    emitChange(newValue);
    
    // Update contenteditable if using it
    if (supportVariables && editableRef.current) {
      updateEditableDisplay(newValue, false);
      editableRef.current.focus();
      setCursorPosition(editableRef.current, newValue.length);
    } else {
      inputRef.current?.focus();
    }
  }, [currentValue, supportVariables, emitChange, updateEditableDisplay, setCursorPosition]);

  // Handle variable hover for tooltip
  const handleVariableMouseEnter = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    
    // Check for environment variable
    const varName = target.getAttribute('data-variable');
    if (varName) {
      const varInfo = getVariableInfo(varName);
      const rect = target.getBoundingClientRect();
      setVariableTooltip({
        text: varInfo !== null ? varInfo.value : 'Variable not found',
        source: varInfo !== null ? varInfo.source : '',
        x: rect.left + rect.width / 2,
        y: rect.top - 8,
      });
      return;
    }
    
    // Check for path parameter
    const pathParam = target.getAttribute('data-path-param');
    if (pathParam) {
      const paramValue = getPathParamValue(pathParam);
      const rect = target.getBoundingClientRect();
      setVariableTooltip({
        text: paramValue || '(empty)',
        source: 'Path Variable',
        x: rect.left + rect.width / 2,
        y: rect.top - 8,
      });
    }
  }, [getVariableInfo, getPathParamValue]);

  const handleVariableMouseLeave = useCallback(() => {
    setVariableTooltip(null);
  }, []);

  // Handle click on variable to open function modal (single click for functions)
  const handleVariableClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const varName = target.getAttribute('data-variable');
    if (!varName) return;
    
    // Check if it's a function
    const isFn = target.getAttribute('data-is-function') === 'true';
    if (isFn) {
      e.preventDefault();
      e.stopPropagation();
      
      const parsed = parseFunction(varName);
      if (parsed) {
        setSelectedFunction(parsed.functionName);
        setIsEditingFunction(true);
        setEditingFunctionExpression(varName);
        setFunctionModalOpen(true);
      }
    }
  }, []);

  // Handle double-click on variable to navigate to definition
  const handleVariableDoubleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const varName = target.getAttribute('data-variable');
    if (!varName) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    // Check if it's a function - already handled by single click
    const isFn = target.getAttribute('data-is-function') === 'true';
    if (isFn) return;
    
    // Navigate to variable definition
    if (!onNavigateToVariable) return;
    
    const sourceDetails = getVariableSourceDetails(varName);
    if (sourceDetails) {
      onNavigateToVariable(varName, sourceDetails.source, sourceDetails.sourceId);
    }
  }, [onNavigateToVariable, getVariableSourceDetails]);

  // Combine refs for standard input
  const setRefs = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref) {
      (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
    }
  }, [ref]);

  // Handle backspace to delete entire variable/function
  const handleBackspaceForVariable = useCallback((): boolean => {
    if (!editableRef.current) return false;
    
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    
    const range = selection.getRangeAt(0);
    
    // Only handle if cursor is collapsed (no selection)
    if (!range.collapsed) return false;
    
    const cursorPos = getCursorPosition(editableRef.current);
    const text = getPlainText(editableRef.current);
    
    // Look for }} immediately before cursor
    if (cursorPos >= 2 && text.slice(cursorPos - 2, cursorPos) === '}}') {
      // Find the matching {{
      const beforeCursor = text.slice(0, cursorPos);
      const lastOpen = beforeCursor.lastIndexOf('{{');
      if (lastOpen !== -1) {
        // Delete the entire {{...}}
        const newValue = text.slice(0, lastOpen) + text.slice(cursorPos);
        emitChange(newValue);
        updateEditableDisplay(newValue, false);
        setCursorPosition(editableRef.current, lastOpen);
        return true;
      }
    }
    
    return false;
  }, [getCursorPosition, getPlainText, emitChange, updateEditableDisplay, setCursorPosition]);

  // Prevent Enter from creating new lines in contenteditable
  const handleEditableKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // If not selecting a suggestion, blur
      if (selectedSuggestionIndex < 0) {
        editableRef.current?.blur();
      }
    }
    
    // Handle backspace to delete entire variable
    if (e.key === 'Backspace') {
      const handled = handleBackspaceForVariable();
      if (handled) {
        e.preventDefault();
        return;
      }
    }
    
    handleKeyDown(e);
  }, [handleKeyDown, selectedSuggestionIndex, handleBackspaceForVariable]);

  // Render category-grouped suggestions
  const renderGroupedSuggestions = () => {
    const groups = Object.entries(groupedSuggestions);
    let globalIndex = 0;
    
    return groups.map(([category, items]) => (
      <div key={category} className="input__suggestions-group">
        <div className="input__suggestions-group-header">
          {category === 'Environment' ? (
            <span className="input__suggestions-icon">{'{ }'}</span>
          ) : (
            <span className="input__suggestions-icon">ƒ</span>
          )}
          {category}
        </div>
        {items.map((suggestion) => {
          const itemIndex = globalIndex++;
          return (
            <div
              key={suggestion.id}
              className={`input__suggestion ${itemIndex === selectedSuggestionIndex ? 'input__suggestion--selected' : ''} ${suggestion.type === 'function' ? 'input__suggestion--function' : ''}`}
              onMouseDown={() => handleSelectSuggestion(suggestion)}
              onMouseEnter={() => setSelectedSuggestionIndex(itemIndex)}
            >
              <div className="input__suggestion-main">
                {suggestion.type === 'variable' && <span className="input__suggestion-var-icon">$</span>}
                {suggestion.type === 'function' && <span className="input__suggestion-fn-icon">ƒ</span>}
                <span className="input__suggestion-name">{suggestion.displayName}</span>
                {suggestion.type === 'variable' && suggestion.value && (
                  <span className="input__suggestion-value">{suggestion.value}</span>
                )}
              </div>
              {suggestion.description && (
                <div className="input__suggestion-description">{suggestion.description}</div>
              )}
            </div>
          );
        })}
      </div>
    ));
  };

  return (
    <>
      <div 
        ref={wrapperRef}
        className={`input-wrapper input-wrapper--${size} ${error ? 'input-wrapper--error' : ''} ${icon ? `input-wrapper--icon-${iconPosition}` : ''} ${supportVariables ? 'input-wrapper--editable' : ''} ${className}`}
      >
        {icon && iconPosition === 'left' && (
          <span 
            className="input__icon input__icon--left"
            onClick={onIconClick}
            role={onIconClick ? 'button' : undefined}
          >
            {icon}
          </span>
        )}
        
        {supportVariables ? (
          <div
            ref={editableRef}
            className="input input--editable"
            contentEditable={!disabled}
            onInput={handleEditableInput}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleEditableKeyDown}
            onMouseOver={handleVariableMouseEnter}
            onMouseOut={handleVariableMouseLeave}
            onClick={handleVariableClick}
            onDoubleClick={handleVariableDoubleClick}
            data-placeholder={placeholder}
            suppressContentEditableWarning
          />
        ) : (
          <input
            ref={setRefs}
            className="input"
            value={currentValue}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            {...props}
          />
        )}
        
        {icon && iconPosition === 'right' && (
          <span 
            className="input__icon input__icon--right"
            onClick={onIconClick}
            role={onIconClick ? 'button' : undefined}
          >
            {icon}
          </span>
        )}
        
        {/* Autocomplete suggestions dropdown - Variable/Function mode */}
        {showSuggestions && isTypingVariable && flatSuggestions.length > 0 && createPortal(
          <div 
            ref={suggestionsRef} 
            className="input__suggestions input__suggestions--variables"
            style={{
              position: 'fixed',
              top: suggestionPosition.top,
              left: suggestionPosition.left,
              width: suggestionPosition.width,
              minWidth: 320,
            }}
          >
            {renderGroupedSuggestions()}
          </div>,
          document.body
        )}
        
        {/* Autocomplete suggestions dropdown - Standard mode */}
        {showSuggestions && !isTypingVariable && filteredSuggestions.length > 0 && createPortal(
          <div 
            ref={suggestionsRef} 
            className="input__suggestions"
            style={{
              position: 'fixed',
              top: suggestionPosition.top,
              left: suggestionPosition.left,
              width: suggestionPosition.width,
            }}
          >
            {filteredSuggestions.slice(0, 10).map((suggestion, index) => (
              <div
                key={suggestion}
                className={`input__suggestion ${index === selectedSuggestionIndex ? 'input__suggestion--selected' : ''}`}
                onMouseDown={() => selectSuggestion(suggestion)}
                onMouseEnter={() => setSelectedSuggestionIndex(index)}
              >
                {suggestion}
              </div>
            ))}
          </div>,
          document.body
        )}
        
        {/* Variable tooltip */}
        {variableTooltip && createPortal(
          <div 
            className="input__variable-tooltip"
            style={{
              position: 'fixed',
              left: variableTooltip.x,
              top: variableTooltip.y,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <span className="input__variable-tooltip-value">{variableTooltip.text}</span>
            {variableTooltip.source && (
              <span className="input__variable-tooltip-source">{variableTooltip.source}</span>
            )}
          </div>,
          document.body
        )}
      </div>
      
      {/* Function Configuration Modal */}
      <FunctionConfigModal
        isOpen={functionModalOpen}
        onClose={() => {
          setFunctionModalOpen(false);
          setIsEditingFunction(false);
          setEditingFunctionExpression(null);
        }}
        functionName={selectedFunction}
        onInsert={handleFunctionInsert}
        onDelete={isEditingFunction && editingFunctionExpression ? () => {
          // Remove the function from the input value
          const currentStr = String(currentValue);
          const fullExpression = `{{${editingFunctionExpression}}}`;
          const newValue = currentStr.replace(fullExpression, '');
          emitChange(newValue);
          if (supportVariables && editableRef.current) {
            updateEditableDisplay(newValue, false);
          }
        } : undefined}
        isEditing={isEditingFunction}
      />
    </>
  );
});

Input.displayName = 'Input';

export default Input;
