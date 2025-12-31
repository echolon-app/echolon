import React, { useState, useCallback, useMemo } from 'react';
import { SpecChange, SpecChangeType } from '@/types';
import { PlusIcon, MinusIcon, EditIcon, CheckIcon, ChevronDownIcon } from '@/components/ui/icons';
import { Button } from '../Button';
import './DiffViewer.css';

interface DiffViewerProps {
  changes: SpecChange[];
  onSelectionChange: (changes: SpecChange[]) => void;
  onApplySelected: () => void;
  onApplyAll: () => void;
  isApplying?: boolean;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  changes,
  onSelectionChange,
  onApplySelected,
  onApplyAll,
  isApplying = false,
}) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleSelection = useCallback((changeId: string) => {
    const updatedChanges = changes.map(c =>
      c.id === changeId ? { ...c, selected: !c.selected } : c
    );
    onSelectionChange(updatedChanges);
  }, [changes, onSelectionChange]);

  const selectAll = useCallback(() => {
    const updatedChanges = changes.map(c => ({ ...c, selected: true }));
    onSelectionChange(updatedChanges);
  }, [changes, onSelectionChange]);

  const deselectAll = useCallback(() => {
    const updatedChanges = changes.map(c => ({ ...c, selected: false }));
    onSelectionChange(updatedChanges);
  }, [changes, onSelectionChange]);

  const toggleExpanded = useCallback((changeId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(changeId)) {
        next.delete(changeId);
      } else {
        next.add(changeId);
      }
      return next;
    });
  }, []);

  const selectedCount = useMemo(
    () => changes.filter(c => c.selected).length,
    [changes]
  );

  const groupedChanges = useMemo(() => {
    const groups: Record<SpecChangeType, SpecChange[]> = {
      added: [],
      removed: [],
      modified: [],
    };
    
    for (const change of changes) {
      groups[change.type].push(change);
    }
    
    return groups;
  }, [changes]);

  const getChangeIcon = (type: SpecChangeType) => {
    switch (type) {
      case 'added':
        return <PlusIcon />;
      case 'removed':
        return <MinusIcon />;
      case 'modified':
        return <EditIcon />;
    }
  };

  const getChangeLabel = (type: SpecChangeType, count: number) => {
    const labels: Record<SpecChangeType, string> = {
      added: count === 1 ? 'New endpoint' : 'New endpoints',
      removed: count === 1 ? 'Removed endpoint' : 'Removed endpoints',
      modified: count === 1 ? 'Modified endpoint' : 'Modified endpoints',
    };
    return labels[type];
  };

  if (changes.length === 0) {
    return (
      <div className="diff-viewer diff-viewer--empty">
        <CheckIcon />
        <p>No changes detected</p>
        <span>Your local collection is in sync with the remote spec.</span>
      </div>
    );
  }

  return (
    <div className="diff-viewer">
      <div className="diff-viewer__header">
        <div className="diff-viewer__summary">
          <span className="diff-viewer__count">
            {changes.length} change{changes.length !== 1 ? 's' : ''} detected
          </span>
          <span className="diff-viewer__selected">
            {selectedCount} selected
          </span>
        </div>
        <div className="diff-viewer__header-actions">
          <button 
            className="diff-viewer__link-btn" 
            onClick={selectAll}
            disabled={selectedCount === changes.length}
          >
            Select all
          </button>
          <button 
            className="diff-viewer__link-btn" 
            onClick={deselectAll}
            disabled={selectedCount === 0}
          >
            Deselect all
          </button>
        </div>
      </div>

      <div className="diff-viewer__changes">
        {(['added', 'modified', 'removed'] as SpecChangeType[]).map(type => {
          const groupChanges = groupedChanges[type];
          if (groupChanges.length === 0) return null;

          return (
            <div key={type} className={`diff-viewer__group diff-viewer__group--${type}`}>
              <div className="diff-viewer__group-header">
                {getChangeIcon(type)}
                <span>{groupChanges.length} {getChangeLabel(type, groupChanges.length)}</span>
              </div>
              <div className="diff-viewer__group-items">
                {groupChanges.map(change => (
                  <div
                    key={change.id}
                    className={`diff-viewer__item ${change.selected ? 'selected' : ''}`}
                  >
                    <label className="diff-viewer__item-checkbox">
                      <input
                        type="checkbox"
                        checked={change.selected}
                        onChange={() => toggleSelection(change.id)}
                      />
                      <span className="diff-viewer__item-checkmark">
                        <CheckIcon />
                      </span>
                    </label>
                    <div 
                      className="diff-viewer__item-content"
                      onClick={() => toggleExpanded(change.id)}
                    >
                      <div className="diff-viewer__item-main">
                        <span className={`diff-viewer__item-method method--${change.method.toLowerCase()}`}>
                          {change.method}
                        </span>
                        <span className="diff-viewer__item-path">{change.path}</span>
                      </div>
                      <span className="diff-viewer__item-desc">{change.description}</span>
                    </div>
                    <button 
                      className={`diff-viewer__item-expand ${expandedIds.has(change.id) ? 'expanded' : ''}`}
                      onClick={() => toggleExpanded(change.id)}
                    >
                      <ChevronDownIcon />
                    </button>
                    {expandedIds.has(change.id) && (
                      <div className="diff-viewer__item-details">
                        {change.details && (
                          <div className="diff-viewer__detail diff-viewer__detail--summary">
                            <span className="diff-viewer__detail-label">Changes</span>
                            <pre className="diff-viewer__detail-text">{change.details}</pre>
                          </div>
                        )}
                        {change.oldValue !== undefined && (
                          <div className="diff-viewer__detail diff-viewer__detail--old">
                            <span className="diff-viewer__detail-label">Previous</span>
                            <pre>{JSON.stringify(change.oldValue, null, 2)}</pre>
                          </div>
                        )}
                        {change.newValue !== undefined && (
                          <div className="diff-viewer__detail diff-viewer__detail--new">
                            <span className="diff-viewer__detail-label">New</span>
                            <pre>{JSON.stringify(change.newValue, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="diff-viewer__footer">
        <Button
          variant="secondary"
          onClick={onApplySelected}
          disabled={selectedCount === 0 || isApplying}
          loading={isApplying}
        >
          Apply Selected ({selectedCount})
        </Button>
        <Button
          variant="primary"
          onClick={onApplyAll}
          disabled={changes.length === 0 || isApplying}
          loading={isApplying}
        >
          Apply All ({changes.length})
        </Button>
      </div>
    </div>
  );
};

export default DiffViewer;

