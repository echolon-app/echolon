import React, { useState, useEffect } from 'react';
import { ChevronRightIcon as ChevronIcon } from '@/components/ui/icons';
import './CollapsibleList.css';

export interface CollapsibleListProps {
  title: string;
  subtitle?: string; // Secondary text shown after title (e.g., collection type)
  icon?: React.ReactNode;
  badge?: React.ReactNode; // Small icon/indicator shown after the title
  badgeTooltip?: string; // Tooltip text for the badge
  children: React.ReactNode;
  defaultCollapsed?: boolean;
  collapsed?: boolean; // Controlled collapsed state
  onCollapsedChange?: (collapsed: boolean) => void; // Callback when collapse state changes
  actions?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent) => void;
  onTitleClick?: () => void;
  onTitleDoubleClick?: () => void; // For inline editing
  isEditingTitle?: boolean; // Whether title is being edited
  editingTitleValue?: string; // Current editing value
  onEditingTitleChange?: (value: string) => void;
  onEditingTitleComplete?: () => void;
  onEditingTitleCancel?: () => void;
  className?: string;
}

export const CollapsibleList: React.FC<CollapsibleListProps> = ({
  title,
  subtitle,
  icon,
  badge,
  badgeTooltip,
  children,
  defaultCollapsed = false,
  collapsed,
  onCollapsedChange,
  actions,
  onContextMenu,
  onTitleClick,
  onTitleDoubleClick,
  isEditingTitle = false,
  editingTitleValue = '',
  onEditingTitleChange,
  onEditingTitleComplete,
  onEditingTitleCancel,
  className = '',
}) => {
  // Use controlled value if provided, otherwise use internal state
  const isControlled = collapsed !== undefined;
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);
  const isCollapsed = isControlled ? collapsed : internalCollapsed;

  // Sync internal state with defaultCollapsed prop changes (for external control)
  useEffect(() => {
    if (!isControlled && defaultCollapsed !== undefined) {
      setInternalCollapsed(defaultCollapsed);
    }
  }, [defaultCollapsed, isControlled]);

  const handleHeaderClick = (e: React.MouseEvent) => {
    // Toggle collapse state
    const newCollapsed = !isCollapsed;
    
    if (isControlled) {
      // For controlled mode, just call the callback
      onCollapsedChange?.(newCollapsed);
    } else {
      // For uncontrolled mode, update internal state
      setInternalCollapsed(newCollapsed);
      onCollapsedChange?.(newCollapsed);
    }
  };

  const handleTitleClick = (e: React.MouseEvent) => {
    if (onTitleClick && !isEditingTitle) {
      e.stopPropagation();
      onTitleClick();
    }
  };

  const handleTitleDoubleClick = (e: React.MouseEvent) => {
    if (onTitleDoubleClick) {
      e.stopPropagation();
      onTitleDoubleClick();
    }
  };

  const handleEditingKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onEditingTitleComplete?.();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onEditingTitleCancel?.();
    }
  };

  return (
    <div className={`collapsible-list ${isCollapsed ? 'collapsible-list--collapsed' : ''} ${className}`}>
      <div
        className="collapsible-list__header"
        onClick={isEditingTitle ? undefined : handleHeaderClick}
        onContextMenu={onContextMenu}
      >
        <span className="collapsible-list__chevron">
          <ChevronIcon />
        </span>
        {icon && <span className="collapsible-list__icon">{icon}</span>}
        {isEditingTitle ? (
          <input
            type="text"
            className="collapsible-list__title-input"
            value={editingTitleValue}
            onChange={(e) => onEditingTitleChange?.(e.target.value)}
            onBlur={onEditingTitleComplete}
            onKeyDown={handleEditingKeyDown}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <span 
            className={`collapsible-list__title ${onTitleClick ? 'collapsible-list__title--clickable' : ''}`}
            onClick={handleTitleClick}
            onDoubleClick={handleTitleDoubleClick}
          >
            {title}
          </span>
        )}
        {subtitle && (
          <span className="collapsible-list__subtitle">
            {subtitle}
          </span>
        )}
        {badge && (
          <span className="collapsible-list__badge" title={badgeTooltip}>
            {badge}
          </span>
        )}
        {actions && (
          <div className="collapsible-list__actions" onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        )}
      </div>
      {!isCollapsed && (
        <div className="collapsible-list__content">
          {children}
        </div>
      )}
    </div>
  );
};

export interface CollapsibleListItemProps {
  children: React.ReactNode;
  icon?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  className?: string;
}

export const CollapsibleListItem: React.FC<CollapsibleListItemProps> = ({
  children,
  icon,
  active = false,
  onClick,
  onContextMenu,
  onDoubleClick,
  className = '',
}) => {
  return (
    <div
      className={`collapsible-list-item ${active ? 'collapsible-list-item--active' : ''} ${className}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
    >
      {icon && <span className="collapsible-list-item__icon">{icon}</span>}
      <span className="collapsible-list-item__content">{children}</span>
    </div>
  );
};

export default CollapsibleList;

