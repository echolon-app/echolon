import React, { useState, useEffect, useRef } from 'react';
import { Modal, Button, Input } from '@/components/ui';
import { useEnvironments, useApp, useRequest } from '@/contexts';
import './NewEnvironmentModal.css';

export const NewEnvironmentModal: React.FC = () => {
  const { newEnvironmentModalOpen, closeNewEnvironmentModal } = useApp();
  const { addEnvironment } = useEnvironments();
  const { addEnvironmentTab } = useRequest();
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (newEnvironmentModalOpen) {
      setName('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [newEnvironmentModalOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      const newEnvironment = addEnvironment(name.trim());
      addEnvironmentTab(newEnvironment);
      closeNewEnvironmentModal();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <Modal
      isOpen={newEnvironmentModalOpen}
      onClose={closeNewEnvironmentModal}
      title="New Environment"
      size="sm"
    >
      <form onSubmit={handleSubmit} className="new-environment-modal">
        <div className="new-environment-modal__field">
          <label htmlFor="environment-name">Name</label>
          <Input
            id="environment-name"
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Production, Staging, Local..."
            onKeyDown={handleKeyDown}
            autoFocus
          />
        </div>

        <p className="new-environment-modal__hint">
          Environments let you define variables that can be used in your requests. 
          Use {'{{variableName}}'} syntax to reference them.
        </p>

        <div className="new-environment-modal__actions">
          <Button variant="secondary" onClick={closeNewEnvironmentModal}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!name.trim()}>
            Create Environment
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default NewEnvironmentModal;

