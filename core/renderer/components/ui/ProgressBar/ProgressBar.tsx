import React from 'react';
import './ProgressBar.css';

export interface ProgressBarProps {
  value: number;
  max?: number;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'success' | 'warning' | 'error';
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  showLabel = false,
  size = 'md',
  variant = 'primary',
  className = '',
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  
  return (
    <div className={`progress-bar progress-bar--${size} progress-bar--${variant} ${className}`}>
      <div className="progress-bar__track">
        <div 
          className="progress-bar__fill"
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showLabel && (
        <span className="progress-bar__label">{Math.round(percentage)}%</span>
      )}
    </div>
  );
};

export default ProgressBar;

