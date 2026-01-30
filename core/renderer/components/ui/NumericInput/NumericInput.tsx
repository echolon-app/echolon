import React, { forwardRef, useState, useEffect, useRef } from 'react';
import { SimpleInput, SimpleInputProps } from '../SimpleInput/SimpleInput';

export interface NumericInputProps extends Omit<SimpleInputProps, 'type' | 'value' | 'onChange'> {
  value: number | undefined;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  defaultValue?: number;
}

/**
 * Check if running on Windows
 */
const isWindows = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform || '';
  const userAgent = navigator.userAgent || '';
  return platform.toUpperCase().indexOf('WIN') >= 0 || userAgent.toUpperCase().indexOf('WIN') >= 0;
};

/**
 * A numeric input wrapper that uses type="text" to avoid Electron crashes on Windows.
 * type"number" is crashing the app on Windows production builds.
 * Automatically validates and clamps values to min/max range.
 * Supports arrow keys for increment/decrement on Linux and Mac (not Windows).
 */
export const NumericInput = forwardRef<HTMLInputElement, NumericInputProps>(({
  value,
  onChange,
  min,
  max,
  defaultValue = 0,
  ...props
}, ref) => {
  const [localValue, setLocalValue] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);
  const isWindowsPlatform = isWindows();

  // Sync local value with prop value
  useEffect(() => {
    const stringValue = value?.toString() ?? defaultValue.toString();
    setLocalValue(stringValue);
  }, [value, defaultValue]);

  // Combine refs
  useEffect(() => {
    if (typeof ref === 'function') {
      ref(inputRef.current);
    } else if (ref) {
      ref.current = inputRef.current;
    }
  }, [ref]);

  const validateAndSetValue = (inputValue: string) => {
    // Allow empty input while editing
    if (inputValue === '') {
      setLocalValue('');
      return;
    }

    // Remove non-numeric characters
    const cleaned = inputValue.replace(/[^0-9]/g, '');
    
    if (cleaned === '') {
      setLocalValue('');
      return;
    }

    let num = parseInt(cleaned, 10);
    
    // Use defaultValue only if the parsed number is NaN
    if (isNaN(num)) {
      num = defaultValue;
    }
    
    // Clamp to min/max
    if (min !== undefined) num = Math.max(min, num);
    if (max !== undefined) num = Math.min(max, num);
    
    setLocalValue(num.toString());
    onChange(num);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    // Allow free typing - just update local state
    // Validation will happen on blur
    setLocalValue(inputValue);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    // On blur, ensure we have a valid value
    if (e.target.value === '' || e.target.value.trim() === '') {
      const finalValue = value ?? defaultValue;
      setLocalValue(finalValue.toString());
      onChange(finalValue);
    } else {
      validateAndSetValue(e.target.value);
    }
    
    // Call original onBlur if provided
    if (props.onBlur) {
      props.onBlur(e);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Only enable arrow keys on Linux and Mac (not Windows)
    if (!isWindowsPlatform && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      
      const currentValue = value ?? defaultValue;
      let newValue = currentValue;
      
      if (e.key === 'ArrowUp') {
        newValue = currentValue + 1;
      } else if (e.key === 'ArrowDown') {
        newValue = currentValue - 1;
      }
      
      // Clamp to min/max
      if (min !== undefined) newValue = Math.max(min, newValue);
      if (max !== undefined) newValue = Math.min(max, newValue);
      
      onChange(newValue);
      setLocalValue(newValue.toString());
    }
    
    // Call original onKeyDown if provided
    if (props.onKeyDown) {
      props.onKeyDown(e);
    }
  };

  return (
    <SimpleInput
      ref={inputRef}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={localValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
});

NumericInput.displayName = 'NumericInput';

export default NumericInput;
