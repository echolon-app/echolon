import React, { forwardRef } from 'react';
import './Switch.css';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
}

export const Switch = forwardRef<HTMLDivElement, SwitchProps>(({
  checked,
  onChange,
  disabled = false,
  size = 'md',
  label,
  className = '',
}, ref) => {
  const handleClick = () => {
    if (!disabled) {
      onChange(!checked);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <div ref={ref} className={`switch-container ${className}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`switch switch--${size} ${checked ? 'switch--checked' : ''} ${disabled ? 'switch--disabled' : ''}`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <span className="switch__track" />
        <span className="switch__thumb" />
      </button>
      {label && (
        <span className="switch__label" onClick={handleClick}>
          {label}
        </span>
      )}
    </div>
  );
});

Switch.displayName = 'Switch';

export default Switch;

