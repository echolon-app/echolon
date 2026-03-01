import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronRightIcon as ChevronIcon } from '@/components/ui/icons';
import './CollapsibleList.css';

export type DropPosition = 'before' | 'after' | 'inside';

export interface CollapsibleListProps {
  title: string | React.ReactNode;
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
  const listRootRef = useRef<HTMLDivElement>(null);
  const [dragDisabledForGesture, setDragDisabledForGesture] = useState(false);
  const mousedownOnEditableRef = useRef(false);

  useEffect(() => {
    if (!isControlled && defaultCollapsed !== undefined) {
      setInternalCollapsed(defaultCollapsed);
    }
  }, [defaultCollapsed, isControlled]);

  const handleListMouseDownCapture = useCallback((e: React.MouseEvent) => {
    const onEditable = isEditableElement(e.target) || isInsideEditable(e.target, listRootRef.current);
    mousedownOnEditableRef.current = onEditable;
    if (onEditable && listRootRef.current && draggable && !isEditingTitle) {
      listRootRef.current.draggable = false;
      setDragDisabledForGesture(true);
    }
  }, [draggable, isEditingTitle]);

  const handleListMouseUpCapture = useCallback(() => {
    mousedownOnEditableRef.current = false;
    setDragDisabledForGesture(false);
    if (listRootRef.current) {
      listRootRef.current.draggable = draggable && !isEditingTitle;
    }
  }, [draggable, isEditingTitle]);

  const handleListDragStart = useCallback(
    (e: React.DragEvent) => {
      const root = listRootRef.current;
      const activeIsEditable = root && isEditableElement(document.activeElement) && root.contains(document.activeElement);
      if (mousedownOnEditableRef.current || activeIsEditable) {
        e.preventDefault();
        e.dataTransfer.effectAllowed = 'none';
        return;
      }
      onDragStart?.(e);
    },
    [onDragStart]
  );

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

  // Disable dragging when editing title or when pointer is on an input (allows text selection)
  const isDraggable = draggable && !isEditingTitle && !dragDisabledForGesture;

  return (
    <div
      ref={listRootRef}
      className={getClassName()}
      draggable={isDraggable}
      onMouseDownCapture={handleListMouseDownCapture}
      onMouseUpCapture={handleListMouseUpCapture}
      onDragStart={draggable && !isEditingTitle ? handleListDragStart : undefined}
      onDragEnd={draggable && !isEditingTitle ? onDragEnd : undefined}
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
            title={typeof title === 'string' ? title : undefined}
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

function isEditableElement(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return true;
  if (el.isContentEditable) return true;
  return false;
}

function isInsideEditable(target: EventTarget | null, root: HTMLElement | null): boolean {
  if (!target || !(target instanceof Node) || !root) return false;
  const editable = root.querySelector('input, textarea, [contenteditable="true"]');
  return editable ? editable.contains(target) || isEditableElement(target) : isEditableElement(target);
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
