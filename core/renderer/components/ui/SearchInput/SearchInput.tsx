import React, { forwardRef } from 'react';
import { Input, InputProps } from '../Input';
import { SearchIcon, CloseIcon as ClearIcon } from '@/components/ui/icons';
import './SearchInput.css';

export interface SearchInputProps extends Omit<InputProps, 'icon' | 'iconPosition'> {
  onClear?: () => void;
  showClear?: boolean;
  suffix?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(({
  onClear,
  showClear = true,
  suffix,
  value,
  className = '',
  ...props
}, ref) => {
  const hasValue = value && String(value).length > 0;

  return (
    <div className={`search-input ${suffix ? 'search-input--has-suffix' : ''} ${className}`}>
      <Input
        ref={ref}
        value={value}
        icon={<SearchIcon />}
        iconPosition="left"
        placeholder="Search..."
        {...props}
      />
      {suffix && (
        <span className="search-input__suffix">{suffix}</span>
      )}
      {showClear && hasValue && (
        <button
          type="button"
          className="search-input__clear"
          onClick={onClear}
          aria-label="Clear search"
        >
          <ClearIcon />
        </button>
      )}
    </div>
  );
});

SearchInput.displayName = 'SearchInput';

export default SearchInput;

