/**
 * Demo Recorder Component
 * 
 * Provides screenshot and recording functionality using native browser
 * media capture APIs (getDisplayMedia) with RestrictionTarget to only
 * capture the document.body element.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';

// Camera/Screenshot icon
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

interface DemoRecorderControlsProps {
  className?: string;
}

export const DemoRecorderControls: React.FC<DemoRecorderControlsProps> = ({ className }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [status, setStatus] = useState<string>('');
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

  // Clear status after delay
  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  // Apply element restriction to a video track (only capture document.body)
  const applyElementRestriction = useCallback(async (track: MediaStreamTrack): Promise<boolean> => {
    try {
      // Check if RestrictionTarget API is available
      if (!window.RestrictionTarget || !track.restrictTo) {
        console.log('[DemoRecorder] RestrictionTarget API not available');
        return false;
      }
      
      // Create restriction target from document.body
      const restrictionTarget = await window.RestrictionTarget.fromElement(document.body);
      await track.restrictTo(restrictionTarget);
      console.log('[DemoRecorder] Applied element restriction to document.body');
      return true;
    } catch (err) {
      console.warn('[DemoRecorder] Failed to apply element restriction:', err);
      return false;
    }
  }, []);

  // Capture screenshot using native getDisplayMedia
  const captureScreenshot = useCallback(async () => {
    try {
      setStatus('Select tab...');
      
      // Request screen capture with preferCurrentTab hint
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
      
      setStatus('Capturing...');
      
      // Create video element to capture frame
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => {
          video.play();
          resolve();
        };
      });
      
      // Wait for video to render
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Create canvas and draw video frame
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0);
      
      // Stop the stream
      stream.getTracks().forEach(track => track.stop());
      
      // Convert to blob and download
      canvas.toBlob((blob) => {
        if (!blob) {
          setStatus('Failed');
          return;
        }
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `echolon-screenshot-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        setStatus('Saved!');
      }, 'image/png');
      
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setStatus('');
      } else {
        console.error('[DemoRecorder] Screenshot failed:', err);
        setStatus('Failed');
      }
    }
  }, [applyElementRestriction]);

  // Start video recording using native getDisplayMedia
  const startRecording = useCallback(async () => {
    try {
      setStatus('Select tab...');
      
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
        a.download = `echolon-recording-${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Cleanup
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        
        setStatus('Saved!');
        setIsRecording(false);
        setRecordingTime(0);
      };
      
      // Start recording in 1-second chunks
      mediaRecorder.start(1000);
      setIsRecording(true);
      setRecordingTime(0);
      setStatus('');
      
      // Start timer
      timerRef.current = window.setInterval(() => {
        setRecordingTime(t => t + 1);
      }, 1000);
      
      // Auto-stop if user closes the capture dialog or stops sharing
      stream.getVideoTracks()[0].onended = () => {
        console.log('[DemoRecorder] Stream ended, stopping recording...');
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
        setStatus('');
      } else {
        console.error('[DemoRecorder] Recording failed:', err);
        setStatus('Failed');
      }
    }
  }, [applyElementRestriction]);

  // Stop video recording
  const stopRecording = useCallback(() => {
    console.log('[DemoRecorder] Stopping recording...');
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    
    // Also stop the stream tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
  }, []);

  // Format time as MM:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`demo-recorder-controls ${className || ''}`}>
      <button
        className="demo-recorder-btn"
        onClick={captureScreenshot}
        title="Take Screenshot"
        disabled={isRecording}
      >
        <CameraIcon />
      </button>
      
      {!isRecording ? (
        <button
          className="demo-recorder-btn"
          onClick={startRecording}
          title="Start Recording"
        >
          <RecordIcon />
        </button>
      ) : (
        <button
          className="demo-recorder-btn demo-recorder-btn--recording"
          onClick={stopRecording}
          title="Stop Recording"
        >
          <StopIcon />
          <span className="demo-recorder-time">{formatTime(recordingTime)}</span>
        </button>
      )}
      
      {status && (
        <span className="demo-recorder-status">{status}</span>
      )}
    </div>
  );
};

export default DemoRecorderControls;
