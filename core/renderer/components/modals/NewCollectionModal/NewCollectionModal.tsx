import React, { useState, useEffect, useRef } from 'react';
import { Modal, Button, Input } from '@/components/ui';
import { useCollections, useApp } from '@/contexts';
import './NewCollectionModal.css';

export const NewCollectionModal: React.FC = () => {
  const { newCollectionModalOpen, closeNewCollectionModal } = useApp();
  const { addCollection } = useCollections();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (newCollectionModalOpen) {
      setName('');
      setDescription('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [newCollectionModalOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      addCollection(name.trim(), description.trim());
      closeNewCollectionModal();
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
      isOpen={newCollectionModalOpen}
      onClose={closeNewCollectionModal}
      title="New Collection"
      size="sm"
    >
      <form onSubmit={handleSubmit} className="new-collection-modal">
        <div className="new-collection-modal__field">
          <label htmlFor="collection-name">Name</label>
          <Input
            id="collection-name"
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Collection"
            onKeyDown={handleKeyDown}
            autoFocus
          />
        </div>

        <div className="new-collection-modal__field">
          <label htmlFor="collection-description">Description (optional)</label>
          <textarea
            id="collection-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A brief description of this collection"
            rows={3}
          />
        </div>

        <div className="new-collection-modal__actions">
          <Button variant="secondary" onClick={closeNewCollectionModal}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!name.trim()}>
            Create Collection
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default NewCollectionModal;

