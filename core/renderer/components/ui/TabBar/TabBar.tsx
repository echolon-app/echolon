import React, { useState, useRef, useEffect } from 'react';
import { CloseIcon, PlusIcon } from '@/components/ui/icons';
import './TabBar.css';

export interface TabItem {
  id: string;
  title: string;
  icon?: React.ReactNode;
  isDirty?: boolean;
  closable?: boolean;
}

export interface TabBarProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  onTabClose?: (tabId: string) => void;
  onTabReorder?: (tabs: TabItem[]) => void;
  onTabRename?: (tabId: string, newTitle: string) => void;
  onNewTab?: () => void;
  showAddButton?: boolean;
  className?: string;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTab,
  onTabChange,
  onTabClose,
  onTabReorder,
  onTabRename,
  onNewTab,
  showAddButton = false,
  className = '',
}) => {
  const [draggedTab, setDraggedTab] = useState<string | null>(null);
  const [dragOverTab, setDragOverTab] = useState<string | null>(null);
  const [editingTab, setEditingTab] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const tabsRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const handleDragStart = (e: React.DragEvent, tabId: string) => {
    if (editingTab) return;
    setDraggedTab(tabId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tabId);
  };

  const handleDragOver = (e: React.DragEvent, tabId: string) => {
    e.preventDefault();
    if (draggedTab && draggedTab !== tabId) {
      setDragOverTab(tabId);
    }
  };

  const handleDragLeave = () => {
    setDragOverTab(null);
  };

  const handleDrop = (e: React.DragEvent, targetTabId: string) => {
    e.preventDefault();
    if (!draggedTab || draggedTab === targetTabId || !onTabReorder) return;

    const newTabs = [...tabs];
    const draggedIndex = newTabs.findIndex(t => t.id === draggedTab);
    const targetIndex = newTabs.findIndex(t => t.id === targetTabId);

    if (draggedIndex !== -1 && targetIndex !== -1) {
      const [removed] = newTabs.splice(draggedIndex, 1);
      newTabs.splice(targetIndex, 0, removed);
      onTabReorder(newTabs);
    }

    setDraggedTab(null);
    setDragOverTab(null);
  };

  const handleDragEnd = () => {
    setDraggedTab(null);
    setDragOverTab(null);
  };

  const handleTabClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    onTabClose?.(tabId);
  };

  const handleCloseAllTabs = () => {
    if (tabs.length === 0 || !onTabClose) return;
    if (window.confirm('Close all tabs?')) {
      tabs.forEach(tab => {
        if (tab.closable !== false) {
          onTabClose(tab.id);
        }
      });
    }
  };

  // Handle middle-click to close
  const handleMouseDown = (e: React.MouseEvent, tabId: string) => {
    if (e.button === 1 && onTabClose) {
      e.preventDefault();
      onTabClose(tabId);
    }
  };

  // Handle double-click to edit
  const handleDoubleClick = (e: React.MouseEvent, tab: TabItem) => {
    e.preventDefault();
    e.stopPropagation();
    if (onTabRename) {
      setEditingTab(tab.id);
      setEditValue(tab.title);
    }
  };

  // Handle edit input changes
  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value);
  };

  // Handle edit submit
  const handleEditSubmit = () => {
    if (editingTab && editValue.trim() && onTabRename) {
      onTabRename(editingTab, editValue.trim());
    }
    setEditingTab(null);
    setEditValue('');
  };

  // Handle edit cancel
  const handleEditCancel = () => {
    setEditingTab(null);
    setEditValue('');
  };

  // Handle edit key events
  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleEditSubmit();
    } else if (e.key === 'Escape') {
      handleEditCancel();
    }
  };

  // Focus input when editing starts
  useEffect(() => {
    if (editingTab && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTab]);

  // Scroll active tab into view
  useEffect(() => {
    const activeElement = tabsRef.current?.querySelector('.tab--active');
    activeElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeTab]);

  return (
    <div className={`tab-bar ${className}`}>
      <div className="tab-bar__tabs" ref={tabsRef}>
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeTab ? 'tab--active' : ''} ${tab.id === draggedTab ? 'tab--dragging' : ''} ${tab.id === dragOverTab ? 'tab--drag-over' : ''} ${tab.id === editingTab ? 'tab--editing' : ''}`}
            onClick={() => !editingTab && onTabChange(tab.id)}
            onMouseDown={(e) => handleMouseDown(e, tab.id)}
            onDoubleClick={(e) => handleDoubleClick(e, tab)}
            draggable={!!onTabReorder && !editingTab}
            onDragStart={(e) => handleDragStart(e, tab.id)}
            onDragOver={(e) => handleDragOver(e, tab.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, tab.id)}
            onDragEnd={handleDragEnd}
          >
            {tab.icon && <span className="tab__icon">{tab.icon}</span>}
            {editingTab === tab.id ? (
              <input
                ref={editInputRef}
                className="tab__edit-input"
                value={editValue}
                onChange={handleEditChange}
                onBlur={handleEditSubmit}
                onKeyDown={handleEditKeyDown}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="tab__title">{tab.title}</span>
            )}
            {tab.isDirty && <span className="tab__dirty" />}
            {(tab.closable !== false) && onTabClose && !editingTab && (
              <button
                className="tab__close"
                onClick={(e) => handleTabClose(e, tab.id)}
                aria-label="Close tab"
              >
                <CloseIcon />
              </button>
            )}
          </div>
        ))}
      </div>
      {tabs.length > 0 && onTabClose && (
        <button
          title="Close all tabs"
          className="tab-bar__close-all"
          onClick={handleCloseAllTabs}
          aria-label="Close all tabs"
        >
          <CloseIcon />
        </button>
      )}
      {showAddButton && onNewTab && (
        <button title="New tab" className="tab-bar__add" onClick={onNewTab} aria-label="New tab">
          <PlusIcon />
        </button>
      )}
    </div>
  );
};

export default TabBar;
