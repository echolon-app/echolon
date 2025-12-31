import React, { forwardRef, useState, useCallback, useRef, useEffect, useMemo, useContext } from 'react';
import { createPortal } from 'react-dom';
import EnvironmentsContext from '@/contexts/EnvironmentsContext';
import { CollectionEnvironment } from '@/types';
import './Input.css';

// Callback type for navigating to a variable definition
export type NavigateToVariableCallback = (
  variableName: string,
  source: 'global' | 'collection',
  sourceId: string
) => void;

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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editableRef = useRef<HTMLDivElement>(null);
  
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
  
  // Get variable value with source information
  const getVariableValue = useCallback((varName: string): string | null => {
    if (!supportVariables) return null;
    
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
  
  // Determine which suggestions to show
  const filteredSuggestions = useMemo(() => {
    if (isTypingVariable && supportVariables) {
      const filter = variableFilter.toLowerCase();
      return variableNames.filter(name => 
        name.toLowerCase().includes(filter)
      ).slice(0, 10);
    }
    
    if (currentValueStr.length === 0) {
      return suggestions.slice(0, 10);
    }
    return suggestions.filter(s => 
      s.toLowerCase().includes(currentValueStr) && 
      s.toLowerCase() !== currentValueStr
    );
  }, [isTypingVariable, supportVariables, variableFilter, variableNames, currentValueStr, suggestions]);

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

  // Reset selection when filtered suggestions change
  useEffect(() => {
    setSelectedSuggestionIndex(-1);
  }, [filteredSuggestions.length]);

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

  // Render content with highlighted variables
  const renderHighlightedContent = useCallback((text: string): React.ReactNode[] => {
    const parts = text.split(/({{[^}]+}})/g);
    return parts.map((part, i) => {
      const match = part.match(/^{{([^}]+)}}$/);
      if (match) {
        const varName = match[1];
        const varValue = getVariableValue(varName);
        const isValid = varValue !== null;
        return (
          <span 
            key={i} 
            className={`input__variable ${!isValid ? 'input__variable--invalid' : ''}`}
            data-variable={varName}
          >
            {part}
          </span>
        );
      }
      return part;
    });
  }, [getVariableValue]);

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
        span.setAttribute('data-variable', part.props['data-variable']);
        span.textContent = part.props.children as string;
        editableRef.current?.appendChild(span);
      }
    });
    
    if (preserveCursor && isFocused) {
      setCursorPosition(editableRef.current, Math.min(cursorPos, text.length));
    }
  }, [getCursorPosition, setCursorPosition, renderHighlightedContent, isFocused]);

  // Sync contenteditable with value
  useEffect(() => {
    if (supportVariables && editableRef.current) {
      const plainText = getPlainText(editableRef.current);
      const newValue = String(currentValue || '');
      if (plainText !== newValue) {
        updateEditableDisplay(newValue, false);
      }
    }
  }, [currentValue, supportVariables, getPlainText, updateEditableDisplay]);

  // Track previous environment to detect actual environment changes (not just currentValue changes)
  const prevEnvironmentRef = useRef<typeof activeEnvironment>(null);
  
  // Re-render variable highlighting only when environment actually changes
  useEffect(() => {
    // Only re-render if the environment reference changed (not on every value change)
    if (supportVariables && editableRef.current && activeEnvironment && prevEnvironmentRef.current !== activeEnvironment) {
      prevEnvironmentRef.current = activeEnvironment;
      const newValue = String(currentValue || '');
      // Force re-render to update variable validation state
      updateEditableDisplay(newValue, false);
    }
  }, [activeEnvironment, supportVariables, currentValue, updateEditableDisplay]);

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
    
    const newValue = getPlainText(editableRef.current);
    const cursorPos = getCursorPosition(editableRef.current);
    
    // Update display with highlighting
    updateEditableDisplay(newValue);
    
    emitChange(newValue);
    
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
            width: rect.width,
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
            width: rect.width,
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
    if (showSuggestions && filteredSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => 
          prev < filteredSuggestions.length - 1 ? prev + 1 : 0
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => 
          prev > 0 ? prev - 1 : filteredSuggestions.length - 1
        );
      } else if (e.key === 'Enter' && selectedSuggestionIndex >= 0) {
        e.preventDefault();
        selectSuggestion(filteredSuggestions[selectedSuggestionIndex]);
        return;
      } else if (e.key === 'Escape') {
        setShowSuggestions(false);
      }
    }
    if (!supportVariables) {
      onKeyDown?.(e as React.KeyboardEvent<HTMLInputElement>);
    }
  }, [showSuggestions, filteredSuggestions, selectedSuggestionIndex, onKeyDown, supportVariables]);

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

  // Handle variable hover for tooltip
  const handleVariableMouseEnter = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const varName = target.getAttribute('data-variable');
    if (!varName) return;
    
    const varInfo = getVariableInfo(varName);
    const rect = target.getBoundingClientRect();
    setVariableTooltip({
      text: varInfo !== null ? varInfo.value : 'Variable not found',
      source: varInfo !== null ? varInfo.source : '',
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
  }, [getVariableInfo]);

  const handleVariableMouseLeave = useCallback(() => {
    setVariableTooltip(null);
  }, []);

  // Handle double-click on variable to navigate to its definition
  const handleVariableDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!onNavigateToVariable) return;
    
    const target = e.target as HTMLElement;
    const varName = target.getAttribute('data-variable');
    if (!varName) return;
    
    e.preventDefault();
    e.stopPropagation();
    
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
      ref.current = node;
    }
  }, [ref]);

  // Prevent Enter from creating new lines in contenteditable
  const handleEditableKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // If not selecting a suggestion, blur
      if (selectedSuggestionIndex < 0) {
        editableRef.current?.blur();
      }
    }
    handleKeyDown(e);
  }, [handleKeyDown, selectedSuggestionIndex]);

  return (
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
      
      {/* Autocomplete suggestions dropdown */}
      {showSuggestions && filteredSuggestions.length > 0 && createPortal(
        <div 
          ref={suggestionsRef} 
          className={`input__suggestions ${isTypingVariable ? 'input__suggestions--variables' : ''}`}
          style={{
            position: 'fixed',
            top: suggestionPosition.top,
            left: suggestionPosition.left,
            width: suggestionPosition.width,
          }}
        >
          {isTypingVariable && (
            <div className="input__suggestions-header">
              <span className="input__suggestions-icon">{'{ }'}</span>
              Environment Variables
            </div>
          )}
          {filteredSuggestions.slice(0, 10).map((suggestion, index) => (
            <div
              key={suggestion}
              className={`input__suggestion ${index === selectedSuggestionIndex ? 'input__suggestion--selected' : ''}`}
              onMouseDown={() => selectSuggestion(suggestion)}
              onMouseEnter={() => setSelectedSuggestionIndex(index)}
            >
              {isTypingVariable && <span className="input__suggestion-var-icon">$</span>}
              {suggestion}
              {isTypingVariable && activeEnvironment && (
                <span className="input__suggestion-value">
                  {getVariableValue(suggestion) || ''}
                </span>
              )}
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
  );
});

Input.displayName = 'Input';

export default Input;
