import React from 'react';
import { Modal, Button } from '@/components/ui';
import { useApp, useCollections, useWorkspace } from '@/contexts';
import './MoveCollectionModal.css';

export const MoveCollectionModal: React.FC = () => {
  const { moveCollectionModalOpen, moveCollectionTarget, closeMoveCollectionModal } = useApp();
  const { moveCollection } = useCollections();
  const { workspaces, activeWorkspaceId } = useWorkspace();

  const handleMove = (targetWorkspaceId: string) => {
    if (moveCollectionTarget && targetWorkspaceId !== moveCollectionTarget.workspaceId) {
      moveCollection(moveCollectionTarget.id, targetWorkspaceId);
      closeMoveCollectionModal();
    }
  };

  if (!moveCollectionTarget) {
    return null;
  }

  return (
    <Modal
      isOpen={moveCollectionModalOpen}
      onClose={closeMoveCollectionModal}
      title="Move Collection"
      size="sm"
    >
      <div className="move-collection-modal">
        <p className="move-collection-modal__description">
          Move <strong>{moveCollectionTarget.name}</strong> to another workspace:
        </p>

        <div className="move-collection-modal__workspace-list">
          {workspaces.map((workspace) => {
            const isCurrent = workspace.id === moveCollectionTarget.workspaceId;
            const isActive = workspace.id === activeWorkspaceId;
            
            return (
              <button
                key={workspace.id}
                className={`move-collection-modal__workspace-item ${isCurrent ? 'move-collection-modal__workspace-item--disabled' : ''}`}
                onClick={() => !isCurrent && handleMove(workspace.id)}
                disabled={isCurrent}
              >
                <div 
                  className="move-collection-modal__workspace-color"
                  style={{ backgroundColor: workspace.color || 'var(--color-primary)' }}
                />
                <div className="move-collection-modal__workspace-info">
                  <span className="move-collection-modal__workspace-name">
                    {workspace.name}
                    {isActive && <span className="move-collection-modal__workspace-badge">Active</span>}
                  </span>
                  {workspace.description && (
                    <span className="move-collection-modal__workspace-description">
                      {workspace.description}
                    </span>
                  )}
                </div>
                {isCurrent && (
                  <span className="move-collection-modal__current-label">Current</span>
                )}
                {!isCurrent && (
                  <svg 
                    className="move-collection-modal__arrow"
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>

        <div className="move-collection-modal__actions">
          <Button variant="secondary" onClick={closeMoveCollectionModal}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default MoveCollectionModal;

