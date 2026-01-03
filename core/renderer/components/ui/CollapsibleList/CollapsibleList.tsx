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
  // Drop zone support
  droppable?: boolean;
  dropAcceptTypes?: string[];
  onDrop?: (data: unknown, type: string) => void;
  onDropOnHeader?: (data: unknown, type: string) => void; // Drop on header (for closed folders)
  dropTargetId?: string; // Identifier for this drop target
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
  droppable = false,
  dropAcceptTypes = [],
  onDrop,
  onDropOnHeader,
  dropTargetId,
}) => {
  // Use controlled value if provided, otherwise use internal state
  const isControlled = collapsed !== undefined;
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);
  const isCollapsed = isControlled ? collapsed : internalCollapsed;
  const [isDragOver, setIsDragOver] = useState(false);
  const [isHeaderDragOver, setIsHeaderDragOver] = useState(false);

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

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    if (!droppable) return;
    e.preventDefault();
    e.stopPropagation();
    
    try {
      // Check if we accept this type
      const rawData = e.dataTransfer.types.includes('application/json');
      if (rawData) {
        setIsDragOver(true);
        e.dataTransfer.dropEffect = 'move';
      }
    } catch {
      // Ignore errors during drag
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!droppable) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    console.log('[CollapsibleList] handleDrop called, droppable:', droppable);
    if (!droppable) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    
    try {
      const rawData = e.dataTransfer.getData('application/json');
      console.log('[CollapsibleList] rawData:', rawData);
      if (rawData) {
        const { type, data } = JSON.parse(rawData);
        console.log('[CollapsibleList] Parsed type:', type, 'dropAcceptTypes:', dropAcceptTypes);
        if (dropAcceptTypes.length === 0 || dropAcceptTypes.includes(type)) {
          console.log('[CollapsibleList] Calling onDrop with data');
          onDrop?.(data, type);
        } else {
          console.log('[CollapsibleList] Type not in dropAcceptTypes, skipping');
        }
      }
    } catch (err) {
      console.error('Drop error:', err);
    }
  };

  // Header-specific drop handlers (for dropping onto closed folders)
  const handleHeaderDragOver = (e: React.DragEvent) => {
    if (!droppable || !onDropOnHeader) return;
    e.preventDefault();
    e.stopPropagation();
    setIsHeaderDragOver(true);
    e.dataTransfer.dropEffect = 'move';
  };

  const handleHeaderDragLeave = (e: React.DragEvent) => {
    if (!droppable || !onDropOnHeader) return;
    e.preventDefault();
    e.stopPropagation();
    setIsHeaderDragOver(false);
  };

  const handleHeaderDrop = (e: React.DragEvent) => {
    if (!droppable || !onDropOnHeader) return;
    e.preventDefault();
    e.stopPropagation();
    setIsHeaderDragOver(false);
    
    try {
      const rawData = e.dataTransfer.getData('application/json');
      if (rawData) {
        const { type, data } = JSON.parse(rawData);
        if (dropAcceptTypes.length === 0 || dropAcceptTypes.includes(type)) {
          onDropOnHeader(data, type);
        }
      }
    } catch (err) {
      console.error('Header drop error:', err);
    }
  };

  return (
    <div 
      className={`collapsible-list ${isCollapsed ? 'collapsible-list--collapsed' : ''} ${isDragOver ? 'collapsible-list--drag-over' : ''} ${className}`}
      onDragOver={droppable ? handleDragOver : undefined}
      onDragLeave={droppable ? handleDragLeave : undefined}
      onDrop={droppable ? handleDrop : undefined}
    >
      <div
        className={`collapsible-list__header ${isHeaderDragOver ? 'collapsible-list__header--drag-over' : ''}`}
        onClick={isEditingTitle ? undefined : handleHeaderClick}
        onContextMenu={onContextMenu}
        onDragOver={droppable && onDropOnHeader ? handleHeaderDragOver : undefined}
        onDragLeave={droppable && onDropOnHeader ? handleHeaderDragLeave : undefined}
        onDrop={droppable && onDropOnHeader ? handleHeaderDrop : undefined}
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

export type DropPosition = 'before' | 'after' | 'inside';

export interface CollapsibleListItemProps {
  children: React.ReactNode;
  icon?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  className?: string;
  // Drag and drop support
  draggable?: boolean;
  dragData?: unknown;
  dragType?: string;
  onDragStart?: (e: React.DragEvent, data: unknown) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  // Drop target support
  droppable?: boolean;
  dropAcceptTypes?: string[];
  onDrop?: (data: unknown, type: string, position: DropPosition) => void;
  itemId?: string; // Unique identifier for this item
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
  dragData,
  dragType,
  onDragStart,
  onDragEnd,
  droppable = false,
  dropAcceptTypes = [],
  onDrop,
  itemId,
}) => {
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);
  const itemRef = React.useRef<HTMLDivElement>(null);

  const handleDragStart = (e: React.DragEvent) => {
    if (dragData && dragType) {
      const payload = JSON.stringify({ type: dragType, data: dragData });
      console.log('[CollapsibleListItem] handleDragStart, setting data:', payload);
      e.dataTransfer.setData('application/json', payload);
      e.dataTransfer.effectAllowed = 'move';
      // Add a class to the element being dragged
      (e.target as HTMLElement).classList.add('collapsible-list-item--dragging');
    }
    onDragStart?.(e, dragData);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.target as HTMLElement).classList.remove('collapsible-list-item--dragging');
    onDragEnd?.(e);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!droppable) return;
    e.preventDefault();
    e.stopPropagation();
    
    // Calculate drop position based on mouse position
    const rect = itemRef.current?.getBoundingClientRect();
    if (rect) {
      const midpoint = rect.top + rect.height / 2;
      const position: DropPosition = e.clientY < midpoint ? 'before' : 'after';
      setDropPosition(position);
    }
    
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!droppable) return;
    e.preventDefault();
    e.stopPropagation();
    setDropPosition(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    console.log('[CollapsibleListItem] handleDrop called, droppable:', droppable, 'itemId:', itemId);
    if (!droppable) return;
    e.preventDefault();
    e.stopPropagation();
    
    const currentPosition = dropPosition;
    console.log('[CollapsibleListItem] currentPosition:', currentPosition);
    setDropPosition(null);
    
    try {
      const rawData = e.dataTransfer.getData('application/json');
      console.log('[CollapsibleListItem] rawData:', rawData);
      if (rawData && currentPosition) {
        const { type, data } = JSON.parse(rawData);
        console.log('[CollapsibleListItem] Calling onDrop with position:', currentPosition);
        if (dropAcceptTypes.length === 0 || dropAcceptTypes.includes(type)) {
          onDrop?.(data, type, currentPosition);
        }
      } else {
        console.log('[CollapsibleListItem] Missing rawData or currentPosition');
      }
    } catch (err) {
      console.error('Drop error:', err);
    }
  };

  return (
    <div
      ref={itemRef}
      className={`collapsible-list-item ${active ? 'collapsible-list-item--active' : ''} ${dropPosition ? `collapsible-list-item--drop-${dropPosition}` : ''} ${className}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      draggable={draggable}
      onDragStart={draggable ? handleDragStart : undefined}
      onDragEnd={draggable ? handleDragEnd : undefined}
      onDragOver={droppable ? handleDragOver : undefined}
      onDragLeave={droppable ? handleDragLeave : undefined}
      onDrop={droppable ? handleDrop : undefined}
      data-item-id={itemId}
    >
      {dropPosition === 'before' && <div className="collapsible-list-item__drop-indicator collapsible-list-item__drop-indicator--before" />}
      {icon && <span className="collapsible-list-item__icon">{icon}</span>}
      <span className="collapsible-list-item__content">{children}</span>
      {dropPosition === 'after' && <div className="collapsible-list-item__drop-indicator collapsible-list-item__drop-indicator--after" />}
    </div>
  );
};

export default CollapsibleList;

