import React, { useState, useRef, useCallback } from 'react';
import { UploadIcon, FileIcon } from '@/components/ui/icons';
import './DragDropUpload.css';

export interface DragDropUploadProps {
  onFileSelect: (file: File) => void;
  accept?: string;
  maxSize?: number;
  label?: string;
  description?: string;
  className?: string;
}

export const DragDropUpload: React.FC<DragDropUploadProps> = ({
  onFileSelect,
  accept = '.json,.yaml,.yml',
  maxSize = 10 * 1024 * 1024, // 10MB
  label = 'Drop file here or click to upload',
  description = 'Supports JSON, YAML files',
  className = '',
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string | null => {
    if (maxSize && file.size > maxSize) {
      return `File too large. Maximum size is ${Math.round(maxSize / 1024 / 1024)}MB`;
    }

    if (accept) {
      const acceptedTypes = accept.split(',').map(t => t.trim().toLowerCase());
      const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
      const fileMimeType = file.type.toLowerCase();

      const isAccepted = acceptedTypes.some(type => {
        if (type.startsWith('.')) {
          return fileExtension === type;
        }
        return fileMimeType === type;
      });

      if (!isAccepted) {
        return `Invalid file type. Accepted: ${accept}`;
      }
    }

    return null;
  };

  const handleFile = useCallback((file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setSelectedFile(file);
    onFileSelect(file);
  }, [accept, maxSize, onFileSelect]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div
      className={`drag-drop-upload ${isDragging ? 'drag-drop-upload--dragging' : ''} ${error ? 'drag-drop-upload--error' : ''} ${selectedFile ? 'drag-drop-upload--has-file' : ''} ${className}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        className="drag-drop-upload__input"
      />

      {selectedFile ? (
        <div className="drag-drop-upload__file">
          <FileIcon />
          <div className="drag-drop-upload__file-info">
            <span className="drag-drop-upload__file-name">{selectedFile.name}</span>
            <span className="drag-drop-upload__file-size">{formatFileSize(selectedFile.size)}</span>
          </div>
        </div>
      ) : (
        <>
          <div className="drag-drop-upload__icon">
            <UploadIcon />
          </div>
          <p className="drag-drop-upload__label">{label}</p>
          <p className="drag-drop-upload__description">{description}</p>
        </>
      )}

      {error && <p className="drag-drop-upload__error">{error}</p>}
    </div>
  );
};

export default DragDropUpload;

