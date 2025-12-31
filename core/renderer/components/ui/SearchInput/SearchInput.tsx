import React, { forwardRef } from 'react';
import { Input, InputProps } from '../Input';
import { SearchIcon, CloseIcon as ClearIcon } from '@/components/ui/icons';
import './SearchInput.css';

export interface SearchInputProps extends Omit<InputProps, 'icon' | 'iconPosition'> {
  onClear?: () => void;
  showClear?: boolean;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(({
  onClear,
  showClear = true,
  value,
  className = '',
  ...props
}, ref) => {
  const hasValue = value && String(value).length > 0;

  return (
    <div className={`search-input ${className}`}>
      <Input
        ref={ref}
        value={value}
        icon={<SearchIcon />}
        iconPosition="left"
        placeholder="Search..."
        {...props}
      />
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

