import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useToast } from './ToastContext';
import { isElectron } from '@/utils';
import { APP_VERSION } from '@/utils/environment';

// Update info from electron-updater
export interface UpdateInfo {
  version: string;
  releaseNotes: string | null;
  releaseDate: string;
  releaseName?: string;
}

// Download progress info
export interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

type UpdateStatus = 
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

interface UpdateContextValue {
  // Current app version
  currentVersion: string;
  
  // Update state
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  downloadProgress: DownloadProgress | null;
  error: string | null;
  
  // Modal state
  isModalOpen: boolean;
  modalMode: 'update' | 'changelog';
  
  // Actions
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => void;
  installOnNextRestart: () => Promise<void>;
  openModal: (mode?: 'update' | 'changelog') => void;
  closeModal: () => void;
  dismissUpdate: () => void;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

export const UpdateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { addToast } = useToast();
  const isElectronApp = isElectron();
  
  // State
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'update' | 'changelog'>('update');
  
  // Track if current check was manually triggered (should open modal directly)
  const isManualCheckRef = useRef(false);

  const onUpdateAvailable = (data: { version: string; releaseNotes: string | null; releaseDate: string; releaseName?: string }) => {
    console.log('[UpdateContext] Update available:', data.version);
    setStatus('available');
    setUpdateInfo({
      version: data.version,
      releaseNotes: data.releaseNotes,
      releaseDate: data.releaseDate,
      releaseName: data.releaseName,
    });
    setError(null);
    
    // If manual check, open modal directly; otherwise show toast
    if (isManualCheckRef.current) {
      isManualCheckRef.current = false;
      setModalMode('update');
      setIsModalOpen(true);
    } else {
      // Show toast notification for background/auto checks
      addToast({
        type: 'info',
        message: `Update v${data.version} available`,
        description: 'Click to download',
        duration: 10000,
        onClick: () => {
          setModalMode('update');
          setIsModalOpen(true);
        },
        actionLabel: 'View update',
      });
    }
  }
  
  // Subscribe to update events from main process
  useEffect(() => {
    if (!isElectronApp || !window.electronAPI) return;
    
    const unsubscribers: (() => void)[] = [];
    // Update available
    unsubscribers.push(
      window.electronAPI.onUpdateAvailable((data) => {
        onUpdateAvailable(data);
      })
    );
    
    // No update available
    unsubscribers.push(
      window.electronAPI.onUpdateNotAvailable((data) => {
        console.log('[UpdateContext] No update available, current version:', data?.currentVersion || APP_VERSION);
        isManualCheckRef.current = false;
        setStatus('not-available');
        setError(null);
        
        addToast({
          type: 'success',
          message: 'You\'re up to date!',
          description: `Version ${APP_VERSION} is the latest`,
          duration: 4000,
        });
      })
    );
    
    // Update downloaded
    unsubscribers.push(
      window.electronAPI.onUpdateDownloaded((data) => {
        console.log('[UpdateContext] Update downloaded:', data.version);
        setStatus('downloaded');
        setUpdateInfo({
          version: data.version,
          releaseNotes: data.releaseNotes,
          releaseDate: data.releaseDate,
          releaseName: data.releaseName,
        });
        setDownloadProgress(null);
        
        // Show toast
        addToast({
          type: 'success',
          message: 'Update ready to install',
          description: `Version ${data.version} has been downloaded`,
          duration: 8000,
          onClick: () => {
            setModalMode('update');
            setIsModalOpen(true);
          },
          actionLabel: 'Restart now',
        });
      })
    );
    
    // Download progress
    unsubscribers.push(
      window.electronAPI.onDownloadProgress((data) => {
        setDownloadProgress({
          percent: data.percent,
          transferred: data.transferred,
          total: data.total,
          bytesPerSecond: data.bytesPerSecond,
        });
      })
    );
    
    // Update error
    unsubscribers.push(
      window.electronAPI.onUpdateError((data) => {
        console.error('[UpdateContext] Update error:', data.message);
        isManualCheckRef.current = false;
        setStatus('error');
        setError(data.message);
        setDownloadProgress(null);
        
        addToast({
          type: 'error',
          message: 'Update failed',
          description: data.message,
        });
      })
    );
    
    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [isElectronApp, addToast]);

  /*useEffect(() => {
    console.log('[UpdateContext] Update context mounted');
    setTimeout(() => {
      onUpdateAvailable({
        version: '1.0.2',
        releaseNotes: 'Initial release',
        releaseDate: new Date().toISOString(),
        releaseName: '1.0.2',
      });
    }, 5000);
 
  }, []);/**/
  
  // Check for updates
  const checkForUpdates = useCallback(async () => {
    if (!isElectronApp || !window.electronAPI) {
      console.log('[UpdateContext] Not in Electron environment');
      return;
    }
    
    console.log('[UpdateContext] Starting update check...');
    isManualCheckRef.current = true; // Mark as manual check to open modal directly
    setStatus('checking');
    setError(null);
    
    // Set a timeout to reset status if no response received
    const timeoutId = setTimeout(() => {
      setStatus((currentStatus) => {
        if (currentStatus === 'checking') {
          console.log('[UpdateContext] Update check timed out');
          isManualCheckRef.current = false;
          setError('Update check timed out. Please try again.');
          addToast({
            type: 'error',
            message: 'Update check timed out',
            description: 'Please try again later',
          });
          return 'error';
        }
        return currentStatus;
      });
    }, 30000); // 30 second timeout
    
    try {
      const result = await window.electronAPI.checkForUpdates();
      console.log('[UpdateContext] Check result:', result);
      
      // Clear timeout since we got a response
      clearTimeout(timeoutId);
      
      // Give event listeners a moment to fire first
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // If no event fired, handle the result directly with toast
      if (result && !result.updateAvailable) {
        setStatus((currentStatus) => {
          // Only show fallback toast if still in 'checking' state (event didn't fire)
          if (currentStatus === 'checking') {
            isManualCheckRef.current = false;
            addToast({
              type: 'success',
              message: 'You\'re up to date!',
              description: `Version ${APP_VERSION} is the latest`,
              duration: 4000,
            });
            return 'not-available';
          }
          return currentStatus;
        });
      }
    } catch (err) {
      clearTimeout(timeoutId);
      isManualCheckRef.current = false;
      console.error('[UpdateContext] Update check error:', err);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to check for updates');
    }
  }, [isElectronApp, addToast]);
  
  // Listen for menu bar "Check for Updates" command
  useEffect(() => {
    if (!isElectronApp || !window.electronAPI?.onCheckForUpdates) return;
    
    const unsubscribe = window.electronAPI.onCheckForUpdates(() => {
      console.log('[UpdateContext] Menu check for updates triggered');
      addToast({
        type: 'info',
        message: 'Checking for updates...',
        duration: 3000,
      });
      checkForUpdates();
    });
    
    return unsubscribe;
  }, [isElectronApp, checkForUpdates, addToast]);
  
  // Download update
  const downloadUpdate = useCallback(async () => {
    if (!isElectronApp || !window.electronAPI) return;
    
    setStatus('downloading');
    setDownloadProgress({ percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 });
    setError(null);
    
    try {
      await window.electronAPI.downloadUpdate();
      // Status will be updated by event listeners
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to download update');
      setDownloadProgress(null);
    }
  }, [isElectronApp]);
  
  // Install update (quit and install)
  const installUpdate = useCallback(() => {
    if (!isElectronApp || !window.electronAPI) return;
    window.electronAPI.installUpdate();
  }, [isElectronApp]);
  
  // Mark update to install on next restart
  const installOnNextRestart = useCallback(async () => {
    if (!isElectronApp || !window.electronAPI) return;
    
    try {
      await window.electronAPI.quitAndInstallLater();
      addToast({
        type: 'info',
        message: 'Update scheduled',
        description: 'The update will be installed when you restart the app',
      });
      setIsModalOpen(false);
    } catch (err) {
      console.error('Failed to schedule update:', err);
    }
  }, [isElectronApp, addToast]);
  
  // Modal controls
  const openModal = useCallback((mode: 'update' | 'changelog' = 'update') => {
    setModalMode(mode);
    setIsModalOpen(true);
  }, []);
  
  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);
  
  // Dismiss update notification (doesn't hide it forever, just resets to idle)
  const dismissUpdate = useCallback(() => {
    if (status === 'available') {
      // Keep updateInfo so user can access it later, but reset status
      setStatus('idle');
    }
  }, [status]);
  
  return (
    <UpdateContext.Provider
      value={{
        currentVersion: APP_VERSION,
        status,
        updateInfo,
        downloadProgress,
        error,
        isModalOpen,
        modalMode,
        checkForUpdates,
        downloadUpdate,
        installUpdate,
        installOnNextRestart,
        openModal,
        closeModal,
        dismissUpdate,
      }}
    >
      {children}
    </UpdateContext.Provider>
  );
};

export const useUpdate = () => {
  const context = useContext(UpdateContext);
  if (!context) {
    throw new Error('useUpdate must be used within UpdateProvider');
  }
  return context;
};

// Optional hook for components that may be outside the provider
export const useUpdateOptional = () => {
  return useContext(UpdateContext);
};

export default UpdateContext;

