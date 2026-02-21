import React from 'react';
import './CustomSelect.css';

export interface CustomSelectOption {
  value: string;
  label: string;
}

export interface CustomSelectProps {
  options: CustomSelectOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  options,
  value,
  onChange,
  className = '',
  disabled = false,
  'aria-label': ariaLabel,
}) => {
  return (
    <div
      className={`custom-select ${disabled ? 'custom-select--disabled' : ''} ${className}`}
      role="listbox"
      aria-label={ariaLabel}
      aria-disabled={disabled}
    >
      {options.map((opt, index) => {
        const isSelected = opt.value === value;
        const isFirst = index === 0;
        const isLast = index === options.length - 1;
        return (
          <button
            key={opt.value}
            type="button"
            role="option"
            aria-selected={isSelected}
            disabled={disabled}
            className={`custom-select__option ${isSelected ? 'custom-select__option--selected' : ''} ${isFirst ? 'custom-select__option--first' : ''} ${isLast ? 'custom-select__option--last' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

export default CustomSelect;
