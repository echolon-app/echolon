import React, { forwardRef } from 'react';
import './SimpleInput.css';

export interface SimpleInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  error?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  onIconClick?: () => void;
}

// Used if now support for variables is needed
export const SimpleInput = forwardRef<HTMLInputElement, SimpleInputProps>(({
  size = 'md',
  error = false,
  icon,
  iconPosition = 'left',
  onIconClick,
  className = '',
  ...props
}, ref) => {
  return (
    <div 
      className={`simple-input-wrapper simple-input-wrapper--${size} ${error ? 'simple-input-wrapper--error' : ''} ${icon ? `simple-input-wrapper--icon-${iconPosition}` : ''} ${className}`}
    >
      {icon && iconPosition === 'left' && (
        <span 
          className="simple-input__icon simple-input__icon--left"
          onClick={onIconClick}
          role={onIconClick ? 'button' : undefined}
        >
          {icon}
        </span>
      )}
      
      <input
        ref={ref}
        className="simple-input"
        {...props}
      />
      
      {icon && iconPosition === 'right' && (
        <span 
          className="simple-input__icon simple-input__icon--right"
          onClick={onIconClick}
          role={onIconClick ? 'button' : undefined}
        >
          {icon}
        </span>
      )}
    </div>
  );
});

SimpleInput.displayName = 'SimpleInput';

export default SimpleInput;

