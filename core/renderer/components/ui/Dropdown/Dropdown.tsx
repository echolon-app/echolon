import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDownIcon as ChevronIcon } from '@/components/ui/icons';
import './Dropdown.css';

export interface DropdownOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  color?: string;
}

export interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  renderOption?: (option: DropdownOption) => React.ReactNode;
  renderSelected?: (option: DropdownOption | undefined) => React.ReactNode;
  allowCustom?: boolean;
  customPlaceholder?: string;
  customColor?: string;
}

export const Dropdown: React.FC<DropdownProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  size = 'md',
  className = '',
  renderOption,
  renderSelected,
  allowCustom = false,
  customPlaceholder = 'Custom...',
  customColor,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [customValue, setCustomValue] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);
  
  const selectedOption = options.find(opt => opt.value === value);
  const isCustomValue = allowCustom && !selectedOption && value;

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setIsOpen(false);
      setIsCustomMode(false);
      setCustomValue('');
    }
  }, []);

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [handleClickOutside]);

  useEffect(() => {
    if (isCustomMode && customInputRef.current) {
      customInputRef.current.focus();
    }
  }, [isCustomMode]);

  const handleSelect = (option: DropdownOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setIsOpen(false);
    setIsCustomMode(false);
    setCustomValue('');
  };

  const handleCustomClick = () => {
    setIsCustomMode(true);
  };

  const handleCustomSubmit = () => {
    if (customValue.trim()) {
      onChange(customValue.trim().toUpperCase());
      setIsOpen(false);
      setIsCustomMode(false);
      setCustomValue('');
    }
  };

  const handleCustomKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCustomSubmit();
    } else if (e.key === 'Escape') {
      setIsCustomMode(false);
      setCustomValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsOpen(!isOpen);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`dropdown dropdown--${size} ${isOpen ? 'dropdown--open' : ''} ${disabled ? 'dropdown--disabled' : ''} ${className}`}
    >
      <button
        type="button"
        className="dropdown__trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span 
          className="dropdown__value" 
          style={selectedOption?.color ? { color: selectedOption.color } : (isCustomValue && customColor ? { color: customColor } : undefined)}
        >
          {renderSelected 
            ? renderSelected(selectedOption)
            : selectedOption 
              ? (
                <>
                  {selectedOption.icon && <span className="dropdown__icon">{selectedOption.icon}</span>}
                  {selectedOption.label}
                </>
              )
              : isCustomValue
                ? value
                : placeholder
          }
        </span>
        <span className="dropdown__chevron">
          <ChevronIcon />
        </span>
      </button>

      {isOpen && (
        <ul className="dropdown__menu" role="listbox">
          {options.map(option => (
            <li
              key={option.value}
              className={`dropdown__option ${option.value === value ? 'dropdown__option--selected' : ''} ${option.disabled ? 'dropdown__option--disabled' : ''}`}
              onClick={() => handleSelect(option)}
              role="option"
              aria-selected={option.value === value}
              style={option.color ? { color: option.color } : undefined}
            >
              {renderOption 
                ? renderOption(option)
                : (
                  <>
                    {option.icon && <span className="dropdown__option-icon">{option.icon}</span>}
                    {option.label}
                  </>
                )
              }
            </li>
          ))}
          {allowCustom && (
            <>
              <li className="dropdown__divider" />
              {isCustomMode ? (
                <li className="dropdown__custom-input">
                  <input
                    ref={customInputRef}
                    type="text"
                    value={customValue}
                    onChange={(e) => setCustomValue(e.target.value)}
                    onKeyDown={handleCustomKeyDown}
                    placeholder="Enter method..."
                    className="dropdown__custom-field"
                  />
                  <button 
                    className="dropdown__custom-submit"
                    onClick={handleCustomSubmit}
                    disabled={!customValue.trim()}
                  >
                    Add
                  </button>
                </li>
              ) : (
                <li
                  className={`dropdown__option dropdown__option--custom ${isCustomValue ? 'dropdown__option--selected' : ''}`}
                  onClick={handleCustomClick}
                  style={customColor ? { color: customColor } : undefined}
                >
                  {customPlaceholder}
                </li>
              )}
            </>
          )}
        </ul>
      )}
    </div>
  );
};

export default Dropdown;
