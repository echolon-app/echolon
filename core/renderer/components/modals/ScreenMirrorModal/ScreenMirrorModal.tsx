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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isServerRunning, setIsServerRunning] = useState(false);
  
  // Video decoding state
  const videoDecoderRef = useRef<VideoDecoder | null>(null);
  const videoConfigRef = useRef<VideoDecoderConfig | null>(null);
  const isH265Ref = useRef<boolean>(false);
  const spsPpsRef = useRef<Uint8Array | null>(null);
  
  // Audio playback state
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isAudioInitializedRef = useRef<boolean>(false);

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
      
      const result = await (window.electronAPI as any)?.airplayStartServer();
      
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
      await (window.electronAPI as any)?.airplayStopServer();
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
    const unsubscribe = (window.electronAPI as any).onAirPlayStatusUpdate((data: any) => {
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

  // Initialize video decoder
  useEffect(() => {
    if (!isElectron() || !canvasRef.current) return;

    const initVideoDecoder = async () => {
      try {
        // Check WebCodecs API support
        if (!('VideoDecoder' in window)) {
          console.error('[RENDERER] WebCodecs API not supported');
          return;
        }

        const canvas = canvasRef.current!;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          console.error('[RENDERER] Failed to get canvas context');
          return;
        }

        // Create video decoder
        const decoder = new VideoDecoder({
          output: (frame: VideoFrame) => {
            console.log(`[RENDERER] Video frame decoded: ${frame.displayWidth}x${frame.displayHeight}, timestamp=${frame.timestamp}`);
            
            // Update canvas size if needed
            if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
              canvas.width = frame.displayWidth;
              canvas.height = frame.displayHeight;
              console.log(`[RENDERER] Canvas resized to ${canvas.width}x${canvas.height}`);
            }
            
            // Render frame to canvas
            try {
              ctx.drawImage(frame, 0, 0, frame.displayWidth, frame.displayHeight);
              console.log(`[RENDERER] Frame rendered to canvas`);
            } catch (err) {
              console.error('[RENDERER] Failed to draw frame:', err);
            }
            
            frame.close();
          },
          error: (error: Error) => {
            console.error('[RENDERER] Video decoder error:', error);
          },
        });

        videoDecoderRef.current = decoder;
        console.log('[RENDERER] Video decoder initialized');
      } catch (err) {
        console.error('[RENDERER] Failed to initialize video decoder:', err);
      }
    };

    initVideoDecoder();

    return () => {
      if (videoDecoderRef.current && videoDecoderRef.current.state !== 'closed') {
        videoDecoderRef.current.close();
      }
    };
  }, []);

  // Handle video codec changes
  useEffect(() => {
    if (!isElectron() || !window.electronAPI) return;

    const handleVideoCodec = (event: CustomEvent<{ isH265: boolean; spsPps: string }>) => {
      const { isH265, spsPps } = event.detail;
      isH265Ref.current = isH265;
      
      // Decode base64 SPS/PPS
      const spsPpsBuffer = Uint8Array.from(atob(spsPps), c => c.charCodeAt(0));
      spsPpsRef.current = spsPpsBuffer;

      // Configure decoder
      if (videoDecoderRef.current && videoDecoderRef.current.state === 'configured') {
        videoDecoderRef.current.reset();
      }

      if (videoDecoderRef.current && videoDecoderRef.current.state === 'unconfigured') {
        try {
          const codec = isH265 ? 'hev1.1.6.L93.B0' : 'avc1.42E01E'; // H.265 or H.264
          
          // Extract SPS and PPS from buffer
          // SPS/PPS are separated by start codes (0x00000001)
          const sps: Uint8Array[] = [];
          const pps: Uint8Array[] = [];
          let offset = 0;
          
          while (offset < spsPpsBuffer.length) {
            if (offset + 4 <= spsPpsBuffer.length &&
                spsPpsBuffer[offset] === 0x00 &&
                spsPpsBuffer[offset + 1] === 0x00 &&
                spsPpsBuffer[offset + 2] === 0x00 &&
                spsPpsBuffer[offset + 3] === 0x01) {
              offset += 4;
              const start = offset;
              
              // Find next start code
              while (offset < spsPpsBuffer.length) {
                if (offset + 4 <= spsPpsBuffer.length &&
                    spsPpsBuffer[offset] === 0x00 &&
                    spsPpsBuffer[offset + 1] === 0x00 &&
                    spsPpsBuffer[offset + 2] === 0x00 &&
                    spsPpsBuffer[offset + 3] === 0x01) {
                  break;
                }
                offset++;
              }
              
              const nalUnit = spsPpsBuffer.slice(start, offset);
              const nalType = nalUnit[0] & (isH265 ? 0x7e : 0x1f);
              
              if (isH265) {
                // H.265: NAL type 33 = VPS, 34 = SPS, 35 = PPS
                if (nalType === 34) sps.push(nalUnit);
                else if (nalType === 35) pps.push(nalUnit);
              } else {
                // H.264: NAL type 7 = SPS, 8 = PPS
                if (nalType === 7) sps.push(nalUnit);
                else if (nalType === 8) pps.push(nalUnit);
              }
            } else {
              offset++;
            }
          }

          if (sps.length > 0 && pps.length > 0) {
            // Parse SPS to get dimensions (simplified - full SPS parsing is complex)
            let width = 1920;
            let height = 1080;
            
            if (!isH265) {
              // H.264 SPS parsing (simplified)
              // SPS contains width/height info, but parsing is complex
              // For now, use default dimensions - will be updated when we receive actual frames
            } else {
              // H.265 SPS parsing (simplified)
              // Similar to H.264, complex parsing required
            }

            const config: VideoDecoderConfig = {
              codec: codec,
              codedWidth: width,
              codedHeight: height,
              description: new Uint8Array([...sps[0], ...pps[0]]),
            };

            videoDecoderRef.current.configure(config);
            videoConfigRef.current = config;
            
            // Update canvas size
            if (canvasRef.current) {
              canvasRef.current.width = width;
              canvasRef.current.height = height;
            }
            
            console.log(`[RENDERER] Video decoder configured: ${isH265 ? 'H.265' : 'H.264'} (${width}x${height})`);
            console.log(`[RENDERER] SPS/PPS length: ${sps.length} SPS, ${pps.length} PPS`);
          }
        } catch (err) {
          console.error('Failed to configure video decoder:', err);
        }
      }
    };

    const unsubscribe = (window.electronAPI as any)?.onAirPlayVideoCodec?.(handleVideoCodec);
    window.addEventListener('airplay:video-codec', handleVideoCodec as EventListener);

    return () => {
      unsubscribe?.();
      window.removeEventListener('airplay:video-codec', handleVideoCodec as EventListener);
    };
  }, []);

  // Handle video frames
  useEffect(() => {
    if (!isElectron() || !window.electronAPI) return;

    const handleVideoFrame = (event: Event) => {
      const customEvent = event as CustomEvent<{ isH265: boolean; nalCount: number; data: string; ntpTimeLocal: string; ntpTimeRemote: string }>;
      
      if (!customEvent.detail) {
        console.error('[RENDERER] Video frame event missing detail');
        return;
      }
      
      const { isH265, nalCount, data: base64Data } = customEvent.detail;
      
      console.log(`[RENDERER] Video frame received: ${nalCount} NAL units, isH265=${isH265}, dataLength=${base64Data.length}`);
      
      try {
        // Decode base64 to Uint8Array
        const videoData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
        console.log(`[RENDERER] Decoded video data: ${videoData.length} bytes`);
        
        // Check decoder state
        if (!videoDecoderRef.current) {
          console.error('[RENDERER] Video decoder not initialized');
          return;
        }
        
        if (videoDecoderRef.current.state !== 'configured') {
          console.warn(`[RENDERER] Video decoder not configured (state: ${videoDecoderRef.current.state}), skipping frame`);
          return;
        }
        
        // Determine chunk type from NAL units (check first NAL unit)
        let chunkType: 'key' | 'delta' = 'delta';
        if (videoData.length >= 5) {
          // Check NAL unit type (after start code 0x00000001)
          const nalType = videoData[4] & (isH265 ? 0x7e : 0x1f);
          // H.264: type 5 = IDR, H.265: type 19-21 = IDR
          if (isH265) {
            chunkType = (nalType >= 19 && nalType <= 21) ? 'key' : 'delta';
          } else {
            chunkType = (nalType === 5) ? 'key' : 'delta';
          }
        }
        
        console.log(`[RENDERER] Decoding video chunk: type=${chunkType}, size=${videoData.length}`);
        
        const chunk = new EncodedVideoChunk({
          type: chunkType,
          timestamp: Date.now() * 1000, // microseconds
          data: videoData,
        });
        
        videoDecoderRef.current.decode(chunk);
        console.log(`[RENDERER] Video chunk decoded successfully`);
      } catch (err) {
        console.error('[RENDERER] Failed to decode video frame:', err);
      }
    };

    const unsubscribe = (window.electronAPI as any)?.onAirPlayVideoFrame?.(handleVideoFrame);
    window.addEventListener('airplay:video-frame', handleVideoFrame as EventListener);
    
    console.log('[RENDERER] Video frame listener registered');

    return () => {
      unsubscribe?.();
      window.removeEventListener('airplay:video-frame', handleVideoFrame as EventListener);
    };
  }, []);

  // Initialize audio context
  useEffect(() => {
    if (!isElectron()) return;

    const initAudio = async () => {
      try {
        const audioContext = new AudioContext({ sampleRate: 44100 });
        audioContextRef.current = audioContext;
        isAudioInitializedRef.current = true;
      } catch (err) {
        console.error('Failed to initialize audio context:', err);
      }
    };

    initAudio();

    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Handle audio frames
  useEffect(() => {
    if (!isElectron() || !window.electronAPI || !audioContextRef.current) return;

    const handleAudioFrame = async (event: CustomEvent<{ data: string; ct: number; syncStatus: number; ntpTimeLocal: string; ntpTimeRemote: string; rtpTime: number; seqnum: number }>) => {
      const { data: base64Data, ct } = event.detail;
      
      try {
        // Decode base64 to ArrayBuffer
        const audioData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0)).buffer;
        
        // TODO: Decode AAC-ELD or ALAC based on ct value
        // For now, we'll queue the audio data
        // ct values: 0x8c-0x8e = AAC-ELD, 0x80-0x82 = ALAC
        audioQueueRef.current.push(audioData);
        
        // Process audio queue
        if (audioQueueRef.current.length > 0 && isAudioInitializedRef.current) {
          // TODO: Implement actual audio decoding
          // This requires a library like aac.js or alac.js, or using Web Audio API with MediaSource
          console.log('Audio frame received (decoding not yet implemented)', { ct });
        }
      } catch (err) {
        console.error('Failed to process audio frame:', err);
      }
    };

    const unsubscribe = (window.electronAPI as any)?.onAirPlayAudioFrame?.(handleAudioFrame);
    window.addEventListener('airplay:audio-frame', handleAudioFrame as unknown as EventListener);

    return () => {
      unsubscribe?.();
      window.removeEventListener('airplay:audio-frame', handleAudioFrame as unknown as EventListener);
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
              <canvas
                ref={canvasRef}
                className="screen-mirror-modal__video"
                style={{ display: status === 'connected' ? 'block' : 'none', width: '100%', height: 'auto' }}
              />
              <video
                ref={videoRef}
                className="screen-mirror-modal__video"
                autoPlay
                playsInline
                muted
                style={{ display: 'none' }}
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
