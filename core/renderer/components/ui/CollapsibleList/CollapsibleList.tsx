import React, { useState, useEffect } from 'react';
import { ChevronRightIcon as ChevronIcon } from '@/components/ui/icons';
import './CollapsibleList.css';

export type DropPosition = 'before' | 'after' | 'inside';

export interface CollapsibleListProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  badgeTooltip?: string;
  children: React.ReactNode;
  defaultCollapsed?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  actions?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent) => void;
  onTitleClick?: () => void;
  onTitleDoubleClick?: () => void;
  isEditingTitle?: boolean;
  editingTitleValue?: string;
  onEditingTitleChange?: (value: string) => void;
  onEditingTitleComplete?: () => void;
  onEditingTitleCancel?: () => void;
  className?: string;
  // Drag support
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  // Drop indicator state (controlled by parent)
  dropIndicator?: 'before' | 'after' | 'inside' | null;
  // Unique identifier
  listId?: string;
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
  draggable = false,
  onDragStart,
  onDragEnd,
  dropIndicator,
  listId,
}) => {
  const isControlled = collapsed !== undefined;
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);
  const isCollapsed = isControlled ? collapsed : internalCollapsed;

  useEffect(() => {
    if (!isControlled && defaultCollapsed !== undefined) {
      setInternalCollapsed(defaultCollapsed);
    }
  }, [defaultCollapsed, isControlled]);

  const handleHeaderClick = () => {
    const newCollapsed = !isCollapsed;
    if (isControlled) {
      onCollapsedChange?.(newCollapsed);
    } else {
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

  const getClassName = () => {
    const classes = ['collapsible-list'];
    if (isCollapsed) classes.push('collapsible-list--collapsed');
    if (dropIndicator === 'inside') classes.push('collapsible-list--drop-inside');
    if (className) classes.push(className);
    return classes.join(' ');
  };

  // Disable dragging when editing title to allow text selection
  const isDraggable = draggable && !isEditingTitle;

  return (
    <div 
      className={getClassName()}
      draggable={isDraggable}
      onDragStart={isDraggable ? onDragStart : undefined}
      onDragEnd={isDraggable ? onDragEnd : undefined}
      data-list-id={listId}
    >
      {dropIndicator === 'before' && <div className="collapsible-list__drop-line collapsible-list__drop-line--before" />}
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
            title={title}
          >
            {title}
          </span>
        )}
           {badge && (
          <span className="collapsible-list__badge" title={badgeTooltip}>
            {badge}
          </span>
        )}
        {subtitle && (
          <span className="collapsible-list__subtitle">
            {subtitle}
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
      {dropIndicator === 'after' && <div className="collapsible-list__drop-line collapsible-list__drop-line--after" />}
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
  // Drag support
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  // Drop support
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  // Drop indicator state (controlled by parent)
  dropIndicator?: 'before' | 'after' | 'inside' | null;
  // Unique identifier
  itemId?: string;
}

export const CollapsibleListItem: React.FC<CollapsibleListItemProps> = ({
  children,
  icon,
  active = false,
  onClick,
  onContextMenu,
  onDoubleClick,
  className = '',
  draggable = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  dropIndicator,
  itemId,
}) => {
  const getClassName = () => {
    const classes = ['collapsible-list-item'];
    if (active) classes.push('collapsible-list-item--active');
    if (dropIndicator === 'inside') classes.push('collapsible-list-item--drop-inside');
    if (className) classes.push(className);
    return classes.join(' ');
  };

  return (
    <div
      className={getClassName()}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-item-id={itemId}
    >
      {dropIndicator === 'before' && <div className="collapsible-list-item__drop-line collapsible-list-item__drop-line--before" />}
      {icon && <span className="collapsible-list-item__icon">{icon}</span>}
      <span className="collapsible-list-item__content">{children}</span>
      {dropIndicator === 'after' && <div className="collapsible-list-item__drop-line collapsible-list-item__drop-line--after" />}
    </div>
  );
};

export default CollapsibleList;
