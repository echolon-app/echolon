/**
 * Demo Debug Panel
 * 
 * Hidden developer panel for switching between demo modes.
 * Activated with Ctrl+Shift+D (Cmd+Shift+D on Mac).
 * 
 * Only appears when in demo mode or when explicitly triggered.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useWebModeOptional, DemoMode } from '@/contexts/WebModeContext';
import './DemoDebugPanel.css';

// Camera icon
const CameraIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
    <circle cx="12" cy="13" r="4"/>
  </svg>
);

// Record icon (circle)
const RecordIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="6"/>
  </svg>
);

// Stop icon (square)
const StopIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="6" y="6" width="12" height="12" rx="1"/>
  </svg>
);

// Wrench/Tool icon for debug
const DebugIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>
);

// X icon for close
const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

// Extend Window interface for RestrictionTarget API
declare global {
  interface Window {
    RestrictionTarget?: {
      fromElement(element: Element): Promise<unknown>;
    };
  }
  
  interface MediaStreamTrack {
    restrictTo?(restrictionTarget: unknown): Promise<void>;
  }
}

const SCREENSHOT_SIZES = [
  { value: 1, label: '1x' },
  { value: 0.5, label: '0.5x' },
  { value: 0.4, label: '0.4x' },
  { value: 0.2, label: '0.2x' },
  { value: 0.1, label: '0.1x' },
] as const;

// Demo mode definitions with descriptions
const DEMO_MODES: Array<{ id: DemoMode; name: string; description: string }> = [
  { id: null, name: 'None', description: 'Normal app mode' },
  { id: 'request-editor', name: 'Request Editor', description: 'Advanced request editing features' },
  { id: 'variables', name: 'Variables', description: 'Variable support and scopes' },
  { id: 'git', name: 'Git Integration', description: 'Git sync and collaboration' },
  { id: 'publishing', name: 'Publishing', description: 'API public sharing workflow' },
  { id: 'mocking', name: 'Mocking', description: 'Mock server demo' },
  { id: 'landing-hero', name: 'Landing Hero', description: 'Landing page hero section demo' },
];

export const DemoDebugPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [screenshotSize, setScreenshotSize] = useState(1);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const webMode = useWebModeOptional();
  
  const currentDemoMode = webMode?.demoMode || null;
  const setDemoMode = webMode?.setDemoMode;
  
  // Video recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number>();
  const streamRef = useRef<MediaStream | null>(null);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Handle keyboard shortcut (Ctrl/Cmd + Shift + D)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modKey = isMac ? e.metaKey : e.ctrlKey;
      
      if (modKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
      
      // Close on Escape
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);
  
  // Apply element restriction to a video track (only capture document.body)
  const applyElementRestriction = useCallback(async (track: MediaStreamTrack): Promise<boolean> => {
    try {
      // Check if RestrictionTarget API is available
      if (!window.RestrictionTarget || !track.restrictTo) {
        console.log('[DemoDebugPanel] RestrictionTarget API not available');
        return false;
      }
      
      // Create restriction target from document.body
      const restrictionTarget = await window.RestrictionTarget.fromElement(document.body);
      await track.restrictTo(restrictionTarget);
      console.log('[DemoDebugPanel] Applied element restriction to document.body');
      return true;
    } catch (err) {
      console.warn('[DemoDebugPanel] Failed to apply element restriction:', err);
      return false;
    }
  }, []);
  
  // Take screenshot using Electron API
  const captureScreenshot = useCallback(async () => {
    if (!window.electronAPI?.capturePage) {
      console.warn('[DemoDebugPanel] Screenshot not available (not in Electron)');
      return;
    }
    
    // Close the panel first so it's not in the screenshot
    setIsOpen(false);
    
    // Small delay to let the panel close
    await new Promise(resolve => setTimeout(resolve, 100));
    
    try {
      const result = await window.electronAPI.capturePage();
      
      if (!result.success || !result.data) {
        console.error('[DemoDebugPanel] Screenshot failed:', result.error);
        return;
      }
      
      // Convert base64 PNG to Image, then to WebP
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = `data:image/png;base64,${result.data}`;
      });
      
      // Create canvas and draw image at specified size
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * screenshotSize);
      canvas.height = Math.round(img.height * screenshotSize);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.error('[DemoDebugPanel] Failed to get canvas context');
        return;
      }
      
      // Use imageSmoothingEnabled for better quality when scaling down
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = screenshotSize < 1 ? 'high' : 'low';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // Convert to WebP blob
      canvas.toBlob((blob) => {
        if (!blob) {
          console.error('[DemoDebugPanel] Failed to convert to WebP');
          return;
        }
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `echolon-${currentDemoMode || 'app'}-${Date.now()}.webp`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 'image/webp', 0.9); // 90% quality
    } catch (err) {
      console.error('[DemoDebugPanel] Screenshot failed:', err);
    }
  }, [currentDemoMode, screenshotSize]);
  
  // Start video recording
  const startRecording = useCallback(async () => {
    try {
      // Close the panel first
      setIsOpen(false);
      
      // Request screen capture
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          // @ts-ignore - preferCurrentTab is Chrome-specific
          preferCurrentTab: true,
          displaySurface: 'browser',
        },
        audio: false,
      });
      
      // Get video track and try to apply element restriction
      const videoTrack = stream.getVideoTracks()[0];
      await applyElementRestriction(videoTrack);
      
      streamRef.current = stream;
      
      // Create MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        // Create download link
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `echolon-${currentDemoMode || 'app'}-${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Cleanup
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        
        setIsRecording(false);
        setRecordingTime(0);
      };
      
      // Start recording in 1-second chunks
      mediaRecorder.start(1000);
      setIsRecording(true);
      setRecordingTime(0);
      
      // Start timer
      timerRef.current = window.setInterval(() => {
        setRecordingTime(t => t + 1);
      }, 1000);
      
      // Auto-stop if user closes the capture dialog or stops sharing
      stream.getVideoTracks()[0].onended = () => {
        console.log('[DemoDebugPanel] Stream ended, stopping recording...');
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = undefined;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      };
      
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        // User cancelled, do nothing
      } else {
        console.error('[DemoDebugPanel] Recording failed:', err);
      }
      setIsRecording(false);
    }
  }, [applyElementRestriction, currentDemoMode]);
  
  // Stop video recording
  const stopRecording = useCallback(() => {
    console.log('[DemoDebugPanel] Stopping recording...');
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);
  
  // Format recording time
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);
  
  const handleModeSelect = useCallback((mode: DemoMode) => {
    if (setDemoMode) {
      setDemoMode(mode);
    }
  }, [setDemoMode]);
  
  if (!isOpen) {
    return null;
  }
  
  return (
    <>
      <div 
        className="demo-debug-panel__backdrop" 
        onClick={() => setIsOpen(false)}
      />
      <div className="demo-debug-panel">
        <div className="demo-debug-panel__header">
          <div className="demo-debug-panel__title">
            <span className="demo-debug-panel__title-icon">
              <DebugIcon />
            </span>
            Demo Debug Panel
          </div>
          <button 
            className="demo-debug-panel__close"
            onClick={() => setIsOpen(false)}
            title="Close (Esc)"
          >
            <CloseIcon />
          </button>
        </div>
        
        <div className="demo-debug-panel__section">
          <div className="demo-debug-panel__label">Current Mode</div>
          <div className="demo-debug-panel__current">
            {currentDemoMode || 'none'}
          </div>
        </div>
        
        <div className="demo-debug-panel__section">
          <div className="demo-debug-panel__label">Switch Demo Mode</div>
          <div className="demo-debug-panel__modes">
            {DEMO_MODES.map((mode) => (
              <button
                key={mode.id || 'null'}
                className={`demo-debug-panel__mode-btn ${
                  currentDemoMode === mode.id ? 'demo-debug-panel__mode-btn--active' : ''
                }`}
                onClick={() => handleModeSelect(mode.id)}
              >
                <div>
                  <div className="demo-debug-panel__mode-name">{mode.name}</div>
                  <div className="demo-debug-panel__mode-desc">{mode.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
        
        <div className="demo-debug-panel__section">
          <div className="demo-debug-panel__label">Screenshot Size</div>
          <div className="demo-debug-panel__size-selector">
            {SCREENSHOT_SIZES.map((size) => (
              <button
                key={size.value}
                className={`demo-debug-panel__size-btn ${
                  screenshotSize === size.value ? 'demo-debug-panel__size-btn--active' : ''
                }`}
                onClick={() => setScreenshotSize(size.value)}
              >
                {size.label}
              </button>
            ))}
          </div>
        </div>
        
        <div className="demo-debug-panel__actions">
          <button 
            className="demo-debug-panel__action-btn"
            onClick={captureScreenshot}
            title="Take screenshot without dialog"
          >
            <CameraIcon />
            Screenshot
          </button>
          {!isRecording ? (
            <button 
              className="demo-debug-panel__action-btn demo-debug-panel__action-btn--record"
              onClick={startRecording}
              title="Start video recording"
            >
              <RecordIcon />
              Record
            </button>
          ) : (
            <button 
              className="demo-debug-panel__action-btn demo-debug-panel__action-btn--stop"
              onClick={stopRecording}
              title="Stop video recording"
            >
              <StopIcon />
              Stop {formatTime(recordingTime)}
            </button>
          )}
        </div>
        
        <div className="demo-debug-panel__shortcut">
          Press <kbd>⌘</kbd>+<kbd>⇧</kbd>+<kbd>D</kbd> to toggle
        </div>
      </div>
    </>
  );
};

export default DemoDebugPanel;
