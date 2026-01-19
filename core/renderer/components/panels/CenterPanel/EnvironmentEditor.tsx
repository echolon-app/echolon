import React, { useCallback, useMemo } from 'react';
import { EditableTable, Input, Switch, Tooltip, ColorEmojiPicker } from '@/components/ui';
import { GlobeIcon } from '@/components/ui/icons';
import { useEnvironments, useRequest, useApp } from '@/contexts';
import { KeyValuePair } from '@/types';
import './EnvironmentEditor.css';

interface EnvironmentEditorProps {
  environmentId: string;
}

export const EnvironmentEditor: React.FC<EnvironmentEditorProps> = ({ environmentId }) => {
  const { environments, updateEnvironment, toggleEnvironmentActive } = useEnvironments();
  const { updateTab, activeTabId, renameTab } = useRequest();
  const { settings } = useApp();
  
  const environment = environments.find(e => e.id === environmentId);

  // All hooks must be called before any early returns
  const handleNameChange = useCallback((newName: string) => {
    updateEnvironment(environmentId, { name: newName });
    
    // Update the tab title
    if (activeTabId) {
      renameTab(activeTabId, newName);
    }
  }, [environmentId, updateEnvironment, activeTabId, renameTab]);

  const handleVariablesChange = useCallback((variables: KeyValuePair[]) => {
    updateEnvironment(environmentId, { variables });
    
    // Mark tab as dirty (only if auto-save is disabled)
    if (activeTabId && !settings.autoSave) {
      updateTab(activeTabId, { isDirty: true });
    }
  }, [environmentId, updateEnvironment, updateTab, activeTabId, settings.autoSave]);

  const handleToggleActive = useCallback(() => {
    toggleEnvironmentActive(environmentId);
  }, [toggleEnvironmentActive, environmentId]);

  const handleColorEmojiChange = useCallback((updates: { color?: string; emoji?: string }) => {
    updateEnvironment(environmentId, updates);
  }, [environmentId, updateEnvironment]);

  // Ensure there's at least one empty row - use stable ID to prevent cursor jumping
  const variablesWithEmpty = useMemo(() => {
    if (!environment) return [{ id: `empty-${environmentId}`, key: '', value: '', enabled: true }];
    return environment.variables.length === 0
      ? [{ id: `empty-${environmentId}`, key: '', value: '', enabled: true }]
      : environment.variables;
  }, [environment?.variables, environmentId]);

  // Early return AFTER all hooks
  if (!environment) {
    return (
      <div className="environment-editor environment-editor--not-found">
        <div className="environment-editor__empty">
          <GlobeIcon />
          <h3>Environment Not Found</h3>
          <p>This environment may have been deleted.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="environment-editor">
      <div className="environment-editor__header">
        <div className="environment-editor__title">
          <ColorEmojiPicker
            color={environment.color}
            emoji={environment.emoji}
            onChange={handleColorEmojiChange}
            size="lg"
          />
          <Input
            value={environment.name}
            onChange={(e) => handleNameChange(e.target.value)}
            className="environment-editor__name-input"
            size="lg"
          />
        </div>
        <div className="environment-editor__actions">
          <Tooltip content={environment.isActive ? 'Hide from dropdown' : 'Show in dropdown'} position="left">
            <Switch
              checked={environment.isActive}
              onChange={handleToggleActive}
              size="md"
            />
          </Tooltip>
        </div>
      </div>
      
      <div className="environment-editor__description">
        <p>
          Define variables that can be used in your requests. Use <code>{'{{variableName}}'}</code> syntax 
          to reference these variables in URLs, headers, and body content.
        </p>
      </div>

      <div className="environment-editor__variables">
        <h3>Variables</h3>
        <EditableTable
          data={variablesWithEmpty}
          onChange={handleVariablesChange}
          keyPlaceholder="Variable name"
          valuePlaceholder="Value"
          descriptionPlaceholder="Description (optional)"
          showDescription={true}
          showSecureToggle={true}
        />
      </div>
    </div>
  );
};

export default EnvironmentEditor;

