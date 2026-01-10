import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Modal, Button, Input } from '@/components/ui';
import { RefreshIcon } from '@/components/ui/icons';
import {
  getFunction,
  evaluateFunction,
  buildFunctionCall,
  categoryLabels,
  DynamicFunction,
  FunctionParameter,
} from '@/services/DynamicFunctions';
import './FunctionConfigModal.css';

export interface FunctionConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  functionName: string | null;
  onInsert: (functionCall: string) => void;
  /** Called when user wants to delete the variable from input */
  onDelete?: () => void;
  /** Initial parameter values (for editing existing functions) */
  initialParams?: Record<string, string>;
  /** Whether this is editing an existing function (shows delete button) */
  isEditing?: boolean;
}

export const FunctionConfigModal: React.FC<FunctionConfigModalProps> = ({
  isOpen,
  onClose,
  functionName,
  onInsert,
  onDelete,
  initialParams,
  isEditing = false,
}) => {
  const [params, setParams] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string>('');
  
  // Use ref to track if we've initialized for this function to avoid infinite loops
  const initializedForRef = useRef<string | null>(null);

  const func = useMemo(() => {
    if (!functionName) return null;
    return getFunction(functionName);
  }, [functionName]);

  // Initialize params when function changes or modal opens
  useEffect(() => {
    if (!func || !isOpen) {
      return;
    }
    
    // Only initialize once per function open
    if (initializedForRef.current === functionName) {
      return;
    }
    initializedForRef.current = functionName;

    const defaultParams: Record<string, string> = {};
    func.parameters.forEach(param => {
      if (initialParams?.[param.name] !== undefined) {
        defaultParams[param.name] = String(initialParams[param.name]);
      } else if (param.default !== undefined) {
        defaultParams[param.name] = String(param.default);
      } else {
        defaultParams[param.name] = '';
      }
    });
    setParams(defaultParams);
  }, [func, isOpen, functionName, initialParams]);
  
  // Reset initialization tracking when modal closes
  useEffect(() => {
    if (!isOpen) {
      initializedForRef.current = null;
    }
  }, [isOpen]);

  // Generate preview
  const generatePreview = useCallback(() => {
    if (!func || !functionName) return;
    try {
      const result = evaluateFunction(functionName, params);
      setPreview(result);
    } catch (error) {
      setPreview('Error generating preview');
    }
  }, [func, functionName, params]);

  // Generate preview when params change
  useEffect(() => {
    if (isOpen && func) {
      generatePreview();
    }
  }, [isOpen, func, generatePreview]);

  const handleParamChange = (paramName: string, value: string) => {
    setParams(prev => ({ ...prev, [paramName]: value }));
  };

  const handleSave = () => {
    if (!functionName) return;
    const call = buildFunctionCall(functionName, params);
    onInsert(`{{${call}}}`);
    onClose();
  };

  const handleDelete = () => {
    onDelete?.();
    onClose();
  };

  const handleRefreshPreview = () => {
    generatePreview();
  };

  if (!func) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title=""
      size="md"
      className="function-config-modal"
    >
      <div className="function-config-modal__content">
        {/* Header */}
        <div className="function-config-modal__header">
          <code className="function-config-modal__function-name">{func.name}(...)</code>
          <span className="function-config-modal__category">
            {categoryLabels[func.category]}
          </span>
        </div>
        
        <p className="function-config-modal__description">{func.description}</p>

        {/* Parameters */}
        {func.parameters.length > 0 && (
          <div className="function-config-modal__params">
            {func.parameters.map(param => (
              <ParameterInput
                key={param.name}
                param={param}
                value={params[param.name] || ''}
                onChange={(value) => handleParamChange(param.name, value)}
              />
            ))}
          </div>
        )}

        {/* Preview Section */}
        <div className="function-config-modal__preview-section">
          <div className="function-config-modal__preview-header">
            <span className="function-config-modal__preview-label">Rendered Preview</span>
            <button
              type="button"
              className="function-config-modal__refresh-btn"
              onClick={handleRefreshPreview}
              title="Regenerate preview"
            >
              <RefreshIcon />
            </button>
          </div>
          <div className="function-config-modal__preview">
            <code>{preview}</code>
          </div>
        </div>

        {/* Actions */}
        <div className="function-config-modal__actions">
          {isEditing && onDelete && (
            <Button variant="ghost" onClick={handleDelete} className="function-config-modal__delete-btn">
              Delete
            </Button>
          )}
          <Button variant="primary" onClick={handleSave} className="function-config-modal__save-btn">
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
};

// Parameter input component
interface ParameterInputProps {
  param: FunctionParameter;
  value: string;
  onChange: (value: string) => void;
}

const ParameterInput: React.FC<ParameterInputProps> = ({ param, value, onChange }) => {
  return (
    <div className="function-config-modal__param">
      <div className="function-config-modal__param-header">
        <label className="function-config-modal__param-label">
          {param.name}
          {param.required && <span className="function-config-modal__required">*</span>}
        </label>
      </div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={param.placeholder || `Enter ${param.name}`}
        type={param.type === 'number' ? 'number' : 'text'}
        size="md"
      />
    </div>
  );
};

export default FunctionConfigModal;

