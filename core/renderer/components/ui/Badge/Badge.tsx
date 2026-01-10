import React, { useState } from 'react';
import { Modal } from '../Modal';
import { SparkleIcon, FlaskIcon } from '../icons';
import './Badge.css';

export type BadgeVariant = 'premium' | 'beta';

interface BadgeProps {
  variant: BadgeVariant;
  showModal?: boolean;
  modalTitle?: string;
  modalDescription?: string;
  className?: string;
}

const defaultModalContent: Record<BadgeVariant, { title: string; description: string }> = {
  premium: {
    title: 'Premium Feature',
    description: 'This feature is currently available during beta but will require a premium subscription in the future. Enjoy it while it lasts!',
  },
  beta: {
    title: 'Beta Feature',
    description: 'This feature is currently in beta. It may change or have some rough edges. We\'d love your feedback!',
  },
};

export const Badge: React.FC<BadgeProps> = ({
  variant,
  showModal = true,
  modalTitle,
  modalDescription,
  className = '',
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (showModal) {
      setIsModalOpen(true);
    }
  };

  const content = defaultModalContent[variant];
  const title = modalTitle || content.title;
  const description = modalDescription || content.description;

  const Icon = variant === 'premium' ? SparkleIcon : FlaskIcon;

  return (
    <>
      <button
        className={`badge badge--${variant} ${className}`}
        onClick={handleClick}
        type="button"
        aria-label={`${variant} feature`}
      >
        <Icon />
        <span>{variant === 'premium' ? 'Premium' : 'Beta'}</span>
      </button>

      {showModal && (
        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={title}
          size="sm"
        >
          <div className="badge-modal">
            <div className={`badge-modal__icon badge-modal__icon--${variant}`}>
              <Icon />
            </div>
            <p className="badge-modal__description">{description}</p>
            {variant === 'premium' && (
              <div className="badge-modal__note">
                <span className="badge-modal__sparkle">✨</span>
                <span>Free during beta period</span>
              </div>
            )}
            <button
              className="badge-modal__button"
              onClick={() => setIsModalOpen(false)}
            >
              Got it
            </button>
          </div>
        </Modal>
      )}
    </>
  );
};

// Convenience components
export const PremiumBadge: React.FC<Omit<BadgeProps, 'variant'>> = (props) => (
  <Badge variant="premium" {...props} />
);

export const BetaBadge: React.FC<Omit<BadgeProps, 'variant'>> = (props) => (
  <Badge variant="beta" {...props} />
);

export default Badge;

