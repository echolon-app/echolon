import type { ReactNode } from 'react';

interface CalloutProps {
  type?: 'info' | 'warning' | 'error' | 'success' | 'tip';
  title?: string;
  children: ReactNode;
}

const icons = {
  info: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="16" x2="12" y2="12"></line>
      <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>
  ),
  warning: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
      <line x1="12" y1="9" x2="12" y2="13"></line>
      <line x1="12" y1="17" x2="12.01" y2="17"></line>
    </svg>
  ),
  error: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="15" y1="9" x2="9" y2="15"></line>
      <line x1="9" y1="9" x2="15" y2="15"></line>
    </svg>
  ),
  success: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
      <polyline points="22 4 12 14.01 9 11.01"></polyline>
    </svg>
  ),
  tip: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6"></path>
      <path d="M10 22h4"></path>
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"></path>
    </svg>
  ),
};

const titles = {
  info: 'Info',
  warning: 'Warning',
  error: 'Error',
  success: 'Success',
  tip: 'Tip',
};

export function Callout({ type = 'info', title, children }: CalloutProps) {
  return (
    <div className={`callout callout--${type}`}>
      <div className="callout__icon">{icons[type]}</div>
      <div className="callout__content">
        <div className="callout__title">{title || titles[type]}</div>
        <div className="callout__body">{children}</div>
      </div>
      <style>{`
        .callout {
          display: flex;
          gap: var(--spacing-3);
          padding: var(--spacing-4);
          margin: var(--spacing-4) 0;
          border-radius: var(--radius-lg);
          border: 1px solid var(--color-border);
          background: var(--color-bg-card);
        }
        
        .callout--info {
          border-color: var(--color-accent);
          background: rgba(6, 182, 212, 0.1);
        }
        .callout--info .callout__icon { color: var(--color-accent); }
        
        .callout--warning {
          border-color: var(--color-warning);
          background: rgba(245, 158, 11, 0.1);
        }
        .callout--warning .callout__icon { color: var(--color-warning); }
        
        .callout--error {
          border-color: var(--color-error);
          background: rgba(239, 68, 68, 0.1);
        }
        .callout--error .callout__icon { color: var(--color-error); }
        
        .callout--success {
          border-color: var(--color-success);
          background: rgba(34, 197, 94, 0.1);
        }
        .callout--success .callout__icon { color: var(--color-success); }
        
        .callout--tip {
          border-color: var(--color-primary);
          background: var(--color-primary-glow);
        }
        .callout--tip .callout__icon { color: var(--color-primary); }
        
        .callout__icon {
          flex-shrink: 0;
          margin-top: 2px;
        }
        
        .callout__content {
          flex: 1;
          min-width: 0;
        }
        
        .callout__title {
          font-weight: 600;
          font-size: var(--font-size-sm);
          color: var(--color-text);
          margin-bottom: var(--spacing-1);
        }
        
        .callout__body {
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
          line-height: var(--line-height-relaxed);
        }
      `}</style>
    </div>
  );
}

export default Callout;

