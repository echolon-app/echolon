import React, { useState, useCallback, useRef } from 'react';
import { KeyValuePair, CollectionEnvironment } from '@/types';
import { CheckIcon, TrashIcon, PlusIcon, MockingIcon as InheritedIcon } from '@/components/ui/icons';
import { Input, NavigateToVariableCallback } from '../Input';
import { Button } from '../Button';
import './EditableTable.css';

export interface EditableTableProps {
  data: KeyValuePair[];
  onChange: (data: KeyValuePair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  descriptionPlaceholder?: string;
  showDescription?: boolean;
  showCheckbox?: boolean;
  readOnly?: boolean;
  /** Disable editing the key column (for path variables) */
  disableKeyEdit?: boolean;
  /** Style rows as path parameters (amber/orange) */
  isPathParams?: boolean;
  bulkEdit?: boolean;
  onBulkEdit?: () => void;
  keySuggestions?: string[];
  valueSuggestions?: string[];
  /** Collection environment for variable resolution */
  collectionEnvironment?: CollectionEnvironment | null;
  /** Callback when user double-clicks a variable to navigate to its definition */
  onNavigateToVariable?: NavigateToVariableCallback;
}

export const EditableTable: React.FC<EditableTableProps> = ({
  data,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  descriptionPlaceholder = 'Description',
  showDescription = true,
  showCheckbox = true,
  readOnly = false,
  disableKeyEdit = false,
  isPathParams = false,
  keySuggestions = [],
  valueSuggestions = [],
  collectionEnvironment,
  onNavigateToVariable,
}) => {
  const [focusedRow, setFocusedRow] = useState<string | null>(null);

  const handleUpdate = useCallback((id: string, field: keyof KeyValuePair, value: string | boolean) => {
    const newData = data.map(item =>
      item.id === id ? { ...item, [field]: value } : item
    );
    onChange(newData);
  }, [data, onChange]);

  const handleDelete = useCallback((id: string) => {
    onChange(data.filter(item => item.id !== id));
  }, [data, onChange]);

  const handleToggle = useCallback((id: string) => {
    const item = data.find(i => i.id === id);
    if (item) {
      handleUpdate(id, 'enabled', !item.enabled);
    }
  }, [data, handleUpdate]);

  const handleAddRow = useCallback(() => {
    const newItem: KeyValuePair = {
      id: crypto.randomUUID(),
      key: '',
      value: '',
      description: '',
      enabled: true,
    };
    onChange([...data, newItem]);
    // Focus the new row after it's added
    setTimeout(() => setFocusedRow(newItem.id), 0);
  }, [data, onChange]);

  const handleKeyDown = (e: React.KeyboardEvent, rowIndex: number) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Add new row when pressing Enter on the last row
      if (rowIndex === data.length - 1) {
        handleAddRow();
      }
    }
  };

  return (
    <div className="editable-table">
      <div className="editable-table__header">
        {showCheckbox && <div className="editable-table__cell editable-table__cell--checkbox" />}
        <div className="editable-table__cell editable-table__cell--key">{keyPlaceholder}</div>
        <div className="editable-table__cell editable-table__cell--value">{valuePlaceholder}</div>
        {showDescription && (
          <div className="editable-table__cell editable-table__cell--description">{descriptionPlaceholder}</div>
        )}
        <div className="editable-table__cell editable-table__cell--actions" />
      </div>
      <div className="editable-table__body">
        {data.map((item, index) => (
          <div
            key={item.id}
            className={`editable-table__row ${focusedRow === item.id ? 'editable-table__row--focused' : ''} ${!item.enabled ? 'editable-table__row--disabled' : ''} ${item.inheritedFrom ? 'editable-table__row--inherited' : ''} ${item.isSystem ? 'editable-table__row--system' : ''} ${isPathParams ? 'editable-table__row--path-param' : ''}`}
          >
            {showCheckbox && (
              <div className="editable-table__cell editable-table__cell--checkbox">
                <button
                  type="button"
                  className={`editable-table__checkbox ${item.enabled ? 'editable-table__checkbox--checked' : ''}`}
                  onClick={() => handleToggle(item.id)}
                  disabled={readOnly}
                  title={item.isSystem ? 'Toggle this system header' : undefined}
                >
                  {item.enabled && <CheckIcon />}
                </button>
              </div>
            )}
            <div className="editable-table__cell editable-table__cell--key">
              {item.inheritedFrom && (
                <span className="editable-table__inherited-badge" title={`${item.isSystem ? 'System header' : 'Inherited from'} ${item.inheritedFrom}`}>
                  <InheritedIcon />
                </span>
              )}
              {disableKeyEdit ? (
                <span className="editable-table__key-label" title={`:${item.key}`}>:{item.key}</span>
              ) : (
              <Input
                size="sm"
                placeholder={keyPlaceholder}
                value={item.key}
                onChange={(e) => handleUpdate(item.id, 'key', e.target.value)}
                onFocus={() => setFocusedRow(item.id)}
                onBlur={() => setFocusedRow(null)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                disabled={readOnly || item.isSystem}
                supportVariables
                suggestions={keySuggestions}
                collectionEnvironment={collectionEnvironment}
                onNavigateToVariable={onNavigateToVariable}
              />
              )}
            </div>
            <div className="editable-table__cell editable-table__cell--value">
              <Input
                size="sm"
                placeholder={valuePlaceholder}
                value={item.value}
                onChange={(e) => handleUpdate(item.id, 'value', e.target.value)}
                onFocus={() => setFocusedRow(item.id)}
                onBlur={() => setFocusedRow(null)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                disabled={readOnly || item.isSystem}
                supportVariables
                suggestions={valueSuggestions}
                collectionEnvironment={collectionEnvironment}
                onNavigateToVariable={onNavigateToVariable}
              />
            </div>
            {showDescription && (
              <div className="editable-table__cell editable-table__cell--description">
                <Input
                  size="sm"
                  placeholder={descriptionPlaceholder}
                  value={item.description || ''}
                  onChange={(e) => handleUpdate(item.id, 'description', e.target.value)}
                  onFocus={() => setFocusedRow(item.id)}
                  onBlur={() => setFocusedRow(null)}
                  disabled={readOnly || item.isSystem}
                />
              </div>
            )}
            <div className="editable-table__cell editable-table__cell--actions">
              {!readOnly && !item.isSystem && (
                <button
                  type="button"
                  className="editable-table__delete"
                  onClick={() => handleDelete(item.id)}
                  aria-label="Delete row"
                >
                  <TrashIcon />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {!readOnly && (
        <div className="editable-table__footer">
          <Button variant="ghost" size="sm" onClick={handleAddRow} icon={<PlusIcon />}>
            Add Row
          </Button>
        </div>
      )}
    </div>
  );
};

export default EditableTable;
