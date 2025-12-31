import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon, CheckIcon, XIcon, PlusIcon } from '@/components/ui/icons';
import './AutoComplete.css';

export interface AutoCompleteOption<T = string> {
  value: T;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  color?: string;
  disabled?: boolean;
}

export interface AutoCompleteProps<T = string> {
  options: AutoCompleteOption<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  allowClear?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  renderOption?: (option: AutoCompleteOption<T>) => React.ReactNode;
  renderValue?: (option: AutoCompleteOption<T>) => React.ReactNode;
  filterOption?: (option: AutoCompleteOption<T>, searchQuery: string) => boolean;
  onCreate?: (value: string) => void;
  createLabel?: string;
  onCreateClick?: () => void;
  createButtonLabel?: string;
}

export function AutoComplete<T = string>({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyMessage = 'No options found',
  allowClear = false,
  disabled = false,
  size = 'md',
  className = '',
  renderOption,
  renderValue,
  filterOption,
  onCreate,
  createLabel = 'Create',
  onCreateClick,
  createButtonLabel = 'Create new',
}: AutoCompleteProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedOption = useMemo(() => 
    options.find(opt => opt.value === value),
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    
    const query = searchQuery.toLowerCase();
    if (filterOption) {
      return options.filter(opt => filterOption(opt, query));
    }
    
    return options.filter(opt => 
      opt.label.toLowerCase().includes(query) ||
      opt.description?.toLowerCase().includes(query)
    );
  }, [options, searchQuery, filterOption]);

  const canCreate = onCreate && searchQuery.trim() && 
    !filteredOptions.some(opt => opt.label.toLowerCase() === searchQuery.toLowerCase());

  // Update dropdown position
  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  }, []);

  // Handle open/close
  useEffect(() => {
    if (isOpen) {
      updatePosition();
      setSearchQuery('');
      setHighlightedIndex(0);
      
      // Focus search input after a short delay
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 10);
    }
  }, [isOpen, updatePosition]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && 
        !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => 
          Math.min(prev + 1, filteredOptions.length - 1 + (canCreate ? 1 : 0))
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (canCreate && highlightedIndex === filteredOptions.length) {
          onCreate?.(searchQuery.trim());
          setIsOpen(false);
        } else if (filteredOptions[highlightedIndex] && !filteredOptions[highlightedIndex].disabled) {
          onChange(filteredOptions[highlightedIndex].value);
          setIsOpen(false);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
        break;
      case 'Tab':
        setIsOpen(false);
        break;
    }
  }, [isOpen, filteredOptions, highlightedIndex, canCreate, searchQuery, onChange, onCreate]);

  const handleSelect = (option: AutoCompleteOption<T>) => {
    if (option.disabled) return;
    onChange(option.value);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
  };

  const handleCreate = () => {
    onCreate?.(searchQuery.trim());
    setIsOpen(false);
  };

  // Check if any option has color or icon to determine if we need spacers
  const hasAnyIndicator = useMemo(() => 
    options.some(opt => opt.color || opt.icon),
    [options]
  );

  const defaultRenderOption = (option: AutoCompleteOption<T>) => (
    <>
      {option.color && (
        <span 
          className="autocomplete__option-color" 
          style={{ backgroundColor: option.color }} 
        />
      )}
      {option.icon && <span className="autocomplete__option-icon">{option.icon}</span>}
      {/* Add spacer if this option has no indicator but others do */}
      {!option.color && !option.icon && hasAnyIndicator && (
        <span className="autocomplete__option-spacer" />
      )}
      <span className="autocomplete__option-label">{option.label}</span>
      {option.description && (
        <span className="autocomplete__option-desc">{option.description}</span>
      )}
    </>
  );

  const defaultRenderValue = (option: AutoCompleteOption<T>) => (
    <>
      {option.color && (
        <span 
          className="autocomplete__value-color" 
          style={{ backgroundColor: option.color }} 
        />
      )}
      {option.icon && <span className="autocomplete__value-icon">{option.icon}</span>}
      <span className="autocomplete__value-label">{option.label}</span>
    </>
  );

  return (
    <div className={`autocomplete autocomplete--${size} ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`autocomplete__trigger ${isOpen ? 'autocomplete__trigger--open' : ''} ${disabled ? 'autocomplete__trigger--disabled' : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {selectedOption ? (
          <span className="autocomplete__value">
            {renderValue ? renderValue(selectedOption) : defaultRenderValue(selectedOption)}
          </span>
        ) : (
          <span className="autocomplete__placeholder">{placeholder}</span>
        )}
        <span className="autocomplete__actions">
          {allowClear && selectedOption && !disabled && (
            <span className="autocomplete__clear" onClick={handleClear}>
              <XIcon />
            </span>
          )}
          <span className={`autocomplete__chevron ${isOpen ? 'autocomplete__chevron--open' : ''}`}>
            <ChevronDownIcon />
          </span>
        </span>
      </button>

      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          className="autocomplete__dropdown"
          style={{
            position: 'fixed',
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            width: dropdownPosition.width,
            minWidth: 200,
          }}
          onKeyDown={handleKeyDown}
        >
          <div className="autocomplete__search">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setHighlightedIndex(0);
              }}
              placeholder={searchPlaceholder}
              className="autocomplete__search-input"
            />
          </div>

          <div className="autocomplete__options" role="listbox">
            {filteredOptions.length === 0 && !canCreate ? (
              <div className="autocomplete__empty">{emptyMessage}</div>
            ) : (
              <>
                {filteredOptions.map((option, index) => (
                  <div
                    key={String(option.value)}
                    role="option"
                    aria-selected={option.value === value}
                    className={`autocomplete__option ${
                      option.value === value ? 'autocomplete__option--selected' : ''
                    } ${
                      index === highlightedIndex ? 'autocomplete__option--highlighted' : ''
                    } ${
                      option.disabled ? 'autocomplete__option--disabled' : ''
                    }`}
                    onClick={() => handleSelect(option)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                  >
                    {renderOption ? renderOption(option) : defaultRenderOption(option)}
                    {option.value === value && (
                      <span className="autocomplete__option-check">
                        <CheckIcon />
                      </span>
                    )}
                  </div>
                ))}
                {canCreate && (
                  <div
                    className={`autocomplete__option autocomplete__option--create ${
                      highlightedIndex === filteredOptions.length ? 'autocomplete__option--highlighted' : ''
                    }`}
                    onClick={handleCreate}
                    onMouseEnter={() => setHighlightedIndex(filteredOptions.length)}
                  >
                    <span className="autocomplete__create-label">{createLabel}:</span>
                    <span className="autocomplete__create-value">"{searchQuery}"</span>
                  </div>
                )}
              </>
            )}
          </div>
          
          {onCreateClick && (
            <>
              <div className="autocomplete__divider" />
              <button
                type="button"
                className="autocomplete__create-btn"
                onClick={() => {
                  onCreateClick();
                  setIsOpen(false);
                }}
              >
                <PlusIcon />
                <span>{createButtonLabel}</span>
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

export default AutoComplete;
