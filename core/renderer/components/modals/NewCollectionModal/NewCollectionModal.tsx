import React, { useState, useEffect, useRef } from 'react';
import { Modal, Button, Input } from '@/components/ui';
import { GlobeIcon, SocketIcon, GraphQLIcon } from '@/components/ui/icons';
import { useCollections, useApp, useRequest } from '@/contexts';
import { CollectionType } from '@/types';
import './NewCollectionModal.css';

type ModalStep = 'select-type' | 'create-collection';

interface TypeOption {
  id: CollectionType | 'websocket-connection';
  icon: React.ReactNode;
  title: string;
  description: string;
  comingSoon?: boolean;
  action: 'collection' | 'connection';
}

const typeOptions: TypeOption[] = [
  {
    id: 'REST',
    icon: <GlobeIcon />,
    title: 'REST (HTTP)',
    description: 'Create REST API collections with requests, folders, and environments',
    action: 'collection',
  },
  {
    id: 'websocket-connection',
    icon: <SocketIcon />,
    title: 'WebSocket',
    description: 'Real-time bidirectional communication with WebSocket servers',
    action: 'connection',
  },
  {
    id: 'GraphQL',
    icon: <GraphQLIcon />,
    title: 'GraphQL',
    description: 'Query and mutate data with GraphQL APIs',
    comingSoon: true,
    action: 'collection',
  },
];

export const NewCollectionModal: React.FC = () => {
  const { newCollectionModalOpen, closeNewCollectionModal } = useApp();
  const { addCollection } = useCollections();
  const { addWebSocketTab } = useRequest();
  const [step, setStep] = useState<ModalStep>('select-type');
  const [selectedType, setSelectedType] = useState<CollectionType>('REST');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (newCollectionModalOpen) {
      setStep('select-type');
      setSelectedType('REST');
      setName('');
      setDescription('');
    }
  }, [newCollectionModalOpen]);

  useEffect(() => {
    if (step === 'create-collection') {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [step]);

  const handleTypeSelect = (option: TypeOption) => {
    if (option.comingSoon) return;
    
    if (option.action === 'connection' && option.id === 'websocket-connection') {
      // Create a new WebSocket connection tab directly
      addWebSocketTab();
      closeNewCollectionModal();
      return;
    }
    
    // For collections, go to the next step
    setSelectedType(option.id as CollectionType);
    setStep('create-collection');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      addCollection(name.trim(), description.trim(), selectedType);
      closeNewCollectionModal();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleBack = () => {
    setStep('select-type');
  };

  return (
    <Modal
      isOpen={newCollectionModalOpen}
      onClose={closeNewCollectionModal}
      title={step === 'select-type' ? 'New' : `New ${selectedType} Collection`}
      size="sm"
    >
      {step === 'select-type' ? (
        <div className="new-collection-modal new-collection-modal--type-select">
          <div className="new-collection-modal__types">
            {typeOptions.map((option) => (
              <button
                key={option.id}
                className={`new-collection-modal__type-option ${option.comingSoon ? 'new-collection-modal__type-option--disabled' : ''}`}
                onClick={() => handleTypeSelect(option)}
                disabled={option.comingSoon}
              >
                <div className="new-collection-modal__type-icon">
                  {option.icon}
                </div>
                <div className="new-collection-modal__type-info">
                  <div className="new-collection-modal__type-header">
                    <span className="new-collection-modal__type-title">{option.title}</span>
                    {option.comingSoon && (
                      <span className="new-collection-modal__coming-soon">Coming soon</span>
                    )}
                  </div>
                  <span className="new-collection-modal__type-description">{option.description}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
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
            <Button variant="secondary" onClick={handleBack}>
              Back
            </Button>
            <Button variant="primary" type="submit" disabled={!name.trim()}>
              Create Collection
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};

export default NewCollectionModal;
