import type { ReactNode } from 'react';

interface StepProps {
  number: number;
  title: string;
  children: ReactNode;
}

export function Step({ number, title, children }: StepProps) {
  return (
    <div className="step">
      <div className="step__number">{number}</div>
      <div className="step__content">
        <h4 className="step__title">{title}</h4>
        <div className="step__body">{children}</div>
      </div>
      <style>{`
        .step {
          display: flex;
          gap: var(--spacing-4);
          position: relative;
        }
        
        .step:not(:last-child)::after {
          content: '';
          position: absolute;
          left: 15px;
          top: 36px;
          bottom: -8px;
          width: 2px;
          background: var(--color-border);
        }
        
        .step__number {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          font-size: var(--font-size-sm);
          font-weight: 600;
          color: var(--color-primary);
          background: var(--color-primary-glow);
          border: 2px solid var(--color-primary);
          border-radius: var(--radius-full);
        }
        
        .step__content {
          flex: 1;
          padding-bottom: var(--spacing-6);
        }
        
        .step__title {
          font-size: var(--font-size-base);
          font-weight: 600;
          color: var(--color-text);
          margin-bottom: var(--spacing-2);
        }
        
        .step__body {
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
          line-height: var(--line-height-relaxed);
        }
      `}</style>
    </div>
  );
}

interface StepsProps {
  children: ReactNode;
}

export function Steps({ children }: StepsProps) {
  return (
    <div className="steps">
      {children}
      <style>{`
        .steps {
          margin: var(--spacing-6) 0;
        }
      `}</style>
    </div>
  );
}

export default Steps;

