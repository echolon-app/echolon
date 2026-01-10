import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui';
import { InfoIcon, CloseIcon, FolderIcon } from '@/components/ui/icons';
import './StorageBanner.css';

const BANNER_DISMISSED_KEY = 'echolon_storage_banner_dismissed';

interface StorageBannerProps {
  onEnableStorage: () => void;
  isStorageEnabled: boolean;
  isWebMode: boolean;
  readonly?: boolean;
}

export const StorageBanner: React.FC<StorageBannerProps> = ({
  onEnableStorage,
  isStorageEnabled,
  isWebMode,
  readonly = false,
}) => {
  const [isDismissed, setIsDismissed] = useState(() => {
    return localStorage.getItem(BANNER_DISMISSED_KEY) === 'true';
  });
  const [isExiting, setIsExiting] = useState(false);

  // Reset dismissed state if storage was cleared
  useEffect(() => {
    const checkDismissed = () => {
      const dismissed = localStorage.getItem(BANNER_DISMISSED_KEY) === 'true';
      if (!dismissed && isDismissed) {
        setIsDismissed(false);
      }
    };

    // Check on storage events (in case user clears localStorage)
    window.addEventListener('storage', checkDismissed);
    return () => window.removeEventListener('storage', checkDismissed);
  }, [isDismissed]);

  // Don't show banner if:
  // - Not in web mode
  // - Storage is already enabled
  // - Banner was dismissed
  // - Readonly mode (embedded viewer)
  if (!isWebMode || isStorageEnabled || isDismissed || readonly) {
    return null;
  }

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => {
      localStorage.setItem(BANNER_DISMISSED_KEY, 'true');
      setIsDismissed(true);
    }, 200);
  };

  const handleEnableStorage = () => {
    onEnableStorage();
  };

  return (
    <div className={`storage-banner ${isExiting ? 'storage-banner--exiting' : ''}`}>
      <div className="storage-banner__content">
        <span className="storage-banner__icon">
          <InfoIcon />
        </span>
        <span className="storage-banner__message">
          Your data is only stored in browser memory and will be lost when you close the tab.
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleEnableStorage}
          icon={<FolderIcon />}
          className="storage-banner__action"
        >
          Enable Local Storage
        </Button>
      </div>
      <button
        className="storage-banner__close"
        onClick={handleDismiss}
        aria-label="Dismiss banner"
      >
        <CloseIcon />
      </button>
    </div>
  );
};

export default StorageBanner;

