import React, { forwardRef } from 'react';
import { SimpleInput, SimpleInputProps } from '../SimpleInput/SimpleInput';

export interface NumericInputProps extends Omit<SimpleInputProps, 'type' | 'value' | 'onChange'> {
  value: number | undefined;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  defaultValue?: number;
}

/**
 * A numeric input wrapper that uses type="text" to avoid Electron crashes on Windows.
 * type"number" is crashing the app on Windows production builds.
 * Automatically validates and clamps values to min/max range.
 */
export const NumericInput = forwardRef<HTMLInputElement, NumericInputProps>(({
  value,
  onChange,
  min,
  max,
  defaultValue = 0,
  ...props
}, ref) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleaned = e.target.value.replace(/[^0-9]/g, '');
    let num = parseInt(cleaned) || defaultValue;
    if (min !== undefined) num = Math.max(min, num);
    if (max !== undefined) num = Math.min(max, num);
    onChange(num);
  };

  return (
    <SimpleInput
      ref={ref}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={value?.toString() ?? defaultValue.toString()}
      onChange={handleChange}
      {...props}
    />
  );
});

NumericInput.displayName = 'NumericInput';

export default NumericInput;
