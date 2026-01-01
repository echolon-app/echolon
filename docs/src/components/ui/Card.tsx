import type { ReactNode } from 'react';

interface CardProps {
  title: string;
  description?: string;
  href?: string;
  icon?: ReactNode;
  children?: ReactNode;
}

export function Card({ title, description, href, icon, children }: CardProps) {
  const content = (
    <>
      {icon && <div className="card__icon">{icon}</div>}
      <div className="card__content">
        <h3 className="card__title">{title}</h3>
        {description && <p className="card__description">{description}</p>}
        {children}
      </div>
      {href && (
        <svg className="card__arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      )}
      <style>{`
        .card {
          display: flex;
          align-items: flex-start;
          gap: var(--spacing-4);
          padding: var(--spacing-5);
          background: var(--color-bg-card);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          transition: all var(--transition-fast);
        }
        
        a.card {
          text-decoration: none;
        }
        
        a.card:hover {
          border-color: var(--color-primary);
          background: var(--color-bg-card-hover);
        }
        
        a.card:hover .card__arrow {
          transform: translateX(4px);
          color: var(--color-primary);
        }
        
        .card__icon {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          color: var(--color-primary);
          background: var(--color-primary-glow);
          border-radius: var(--radius-md);
        }
        
        .card__content {
          flex: 1;
          min-width: 0;
        }
        
        .card__title {
          font-size: var(--font-size-base);
          font-weight: 600;
          color: var(--color-text);
          margin-bottom: var(--spacing-1);
        }
        
        .card__description {
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
          line-height: var(--line-height-relaxed);
          margin: 0;
        }
        
        .card__arrow {
          flex-shrink: 0;
          color: var(--color-text-muted);
          transition: all var(--transition-fast);
          align-self: center;
        }
      `}</style>
    </>
  );
  
  if (href) {
    return <a href={href} className="card">{content}</a>;
  }
  
  return <div className="card">{content}</div>;
}

export default Card;

