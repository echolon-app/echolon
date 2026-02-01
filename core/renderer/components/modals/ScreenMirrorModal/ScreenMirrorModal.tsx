import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Modal, Button } from '@/components/ui';
import { PhoneIcon, StopIcon, AlertIcon, CheckCircleIcon } from '@/components/ui/icons';
import { useApp } from '@/contexts';
import { isElectron } from '@/utils';
import './ScreenMirrorModal.css';

type ConnectionStatus = 'idle' | 'starting' | 'pairing' | 'connected' | 'error';

export const ScreenMirrorModal: React.FC = () => {
  const { screenMirrorModalOpen, closeScreenMirrorModal } = useApp();
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isServerRunning, setIsServerRunning] = useState(false);

  // Start AirPlay server when modal opens
  useEffect(() => {
    if (screenMirrorModalOpen && isElectron()) {
      startServer();
    } else if (!screenMirrorModalOpen) {
      stopServer();
    }
  }, [screenMirrorModalOpen]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isElectron()) {
        stopServer();
      }
    };
  }, []);

  const startServer = useCallback(async () => {
    if (!isElectron() || !window.electronAPI) {
      setError('Screen mirroring is only available in Electron');
      setStatus('error');
      return;
    }

    try {
      setStatus('starting');
      setError(null);
      
      const result = await window.electronAPI?.airplayStartServer();
      
      if (result.success) {
        setIsServerRunning(true);
        setStatus('pairing');
        if (result.pairingCode) {
          setPairingCode(result.pairingCode);
        }
      } else {
        setError(result.error || 'Failed to start AirPlay server');
        setStatus('error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  }, []);

  const stopServer = useCallback(async () => {
    if (!isElectron() || !window.electronAPI) {
      return;
    }

    try {
      await window.electronAPI?.airplayStopServer();
      setIsServerRunning(false);
      setStatus('idle');
      setPairingCode(null);
      setError(null);
    } catch (err) {
      console.error('Failed to stop AirPlay server:', err);
    }
  }, []);

  // Listen for status updates from main process
  useEffect(() => {
    if (!isElectron() || !window.electronAPI) return;

    // Set up IPC listener
    const unsubscribe = window.electronAPI.onAirPlayStatusUpdate((data) => {
      const { status: newStatus, pairingCode: code, error: err } = data;
      setStatus(newStatus as ConnectionStatus);
      if (code) setPairingCode(code);
      if (err) setError(err);
      if (newStatus === 'connected') {
        setPairingCode(null);
      }
    });

    // Also listen for custom events (dispatched by preload)
    const handleStatusUpdate = (event: CustomEvent<{ status: ConnectionStatus; pairingCode?: string; error?: string }>) => {
      const { status: newStatus, pairingCode: code, error: err } = event.detail;
      setStatus(newStatus);
      if (code) setPairingCode(code);
      if (err) setError(err);
      if (newStatus === 'connected') {
        setPairingCode(null);
      }
    };

    window.addEventListener('airplay:status-update', handleStatusUpdate as EventListener);
    
    return () => {
      unsubscribe();
      window.removeEventListener('airplay:status-update', handleStatusUpdate as EventListener);
    };
  }, []);

  // Handle video frames (if implemented)
  useEffect(() => {
    if (!isElectron() || !window.electronAPI || !videoRef.current) return;

    const handleVideoFrame = (event: CustomEvent<{ data: string }>) => {
      // Handle video frame data
      // This would need to be implemented based on how video frames are sent
      console.log('Video frame received');
    };

    window.addEventListener('airplay:video-frame', handleVideoFrame as EventListener);
    return () => {
      window.removeEventListener('airplay:video-frame', handleVideoFrame as EventListener);
    };
  }, []);

  const handleClose = useCallback(() => {
    stopServer();
    closeScreenMirrorModal();
  }, [stopServer, closeScreenMirrorModal]);

  if (!screenMirrorModalOpen) return null;

  return (
    <Modal
      isOpen={screenMirrorModalOpen}
      onClose={handleClose}
      title="Screen Mirroring"
      size="lg"
      className="screen-mirror-modal"
    >
      <div className="screen-mirror-modal__content">
        {!isElectron() && (
          <div className="screen-mirror-modal__error">
            <AlertIcon />
            <p>Screen mirroring is only available in the desktop app.</p>
          </div>
        )}

        {isElectron() && (
          <>
            {/* Status Display */}
            <div className="screen-mirror-modal__status">
              {status === 'idle' && (
                <div className="screen-mirror-modal__status-item">
                  <PhoneIcon />
                  <span>Ready to receive connections</span>
                </div>
              )}
              {status === 'starting' && (
                <div className="screen-mirror-modal__status-item">
                  <div className="screen-mirror-modal__spinner" />
                  <span>Starting AirPlay server...</span>
                </div>
              )}
              {status === 'pairing' && (
                <div className="screen-mirror-modal__status-item">
                  <PhoneIcon />
                  <div className="screen-mirror-modal__pairing">
                    <p>Waiting for device connection...</p>
                    {pairingCode && (
                      <div className="screen-mirror-modal__pairing-code">
                        <span className="screen-mirror-modal__pairing-label">Pairing Code:</span>
                        <span className="screen-mirror-modal__pairing-value">{pairingCode}</span>
                      </div>
                    )}
                    <p className="screen-mirror-modal__instructions">
                      On your iPhone/iPad, open Control Center and tap Screen Mirroring, then select "Echolon" from the list.
                    </p>
                  </div>
                </div>
              )}
              {status === 'connected' && (
                <div className="screen-mirror-modal__status-item screen-mirror-modal__status-item--success">
                  <CheckCircleIcon />
                  <span>Device connected</span>
                </div>
              )}
              {status === 'error' && (
                <div className="screen-mirror-modal__status-item screen-mirror-modal__status-item--error">
                  <AlertIcon />
                  <div className="screen-mirror-modal__error-content">
                    <span>Error: {error || 'Unknown error'}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Video Display */}
            <div className="screen-mirror-modal__video-container">
              <video
                ref={videoRef}
                className="screen-mirror-modal__video"
                autoPlay
                playsInline
                muted
              />
              {status !== 'connected' && (
                <div className="screen-mirror-modal__video-placeholder">
                  <PhoneIcon />
                  <p>Waiting for connection...</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="screen-mirror-modal__actions">
              {isServerRunning && (
                <Button
                  variant="danger"
                  onClick={handleClose}
                  leadingIcon={<StopIcon />}
                >
                  Stop Mirroring
                </Button>
              )}
              {!isServerRunning && status === 'error' && (
                <Button
                  variant="primary"
                  onClick={startServer}
                >
                  Retry
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default ScreenMirrorModal;
