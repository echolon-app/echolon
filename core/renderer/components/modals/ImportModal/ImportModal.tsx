import React, { useState, useCallback, useRef, useMemo } from 'react';
import { Modal, Button, Input } from '@/components/ui';
import { 
  LinkIcon, FileIcon, CheckIcon, TerminalIcon, UploadIcon, SparkleIcon, EditIcon 
} from '@/components/ui/icons';
import { useApp, useCollections, useEnvironments, useRequest } from '@/contexts';
import { specImporter, SpecImportOptions, ServerInfo } from '@/services';
import { SpecFormat } from '@/types';
import { parseCurlCommand, detectInputType, CURL_EXAMPLES, URL_EXAMPLES, InputType } from '@/utils/curlParser';
import './ImportModal.css';

interface SpecPreview {
  format: SpecFormat;
  name: string;
  version?: string;
  description?: string;
  baseUrl?: string;
  servers?: ServerInfo[];
}

interface ParsedResult {
  type: 'curl' | 'url' | 'file';
  name: string;
  description?: string;
  preview?: SpecPreview;
  format?: SpecFormat;
}

export const ImportModal: React.FC = () => {
  const { importModalOpen, closeImportModal, logToConsole } = useApp();
  const { importCollection, addCollection } = useCollections();
  const { importEnvironment } = useEnvironments();
  const { addTab } = useRequest();
  
  const [smartInput, setSmartInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [parsedResult, setParsedResult] = useState<ParsedResult | null>(null);
  const [fetchedContent, setFetchedContent] = useState<string | null>(null);
  
  // Base URL configuration
  const [baseUrlVarName, setBaseUrlVarName] = useState('baseUrl');
  const [baseUrlValue, setBaseUrlValue] = useState('');
  const [showBaseUrlConfig, setShowBaseUrlConfig] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const detectedType = useMemo(() => {
    if (!smartInput.trim()) return null;
    return detectInputType(smartInput);
  }, [smartInput]);

  const resetState = useCallback(() => {
    setSmartInput('');
    setFile(null);
    setError(null);
    setParsedResult(null);
    setFetchedContent(null);
    setIsProcessing(false);
    setIsDragging(false);
    setBaseUrlVarName('baseUrl');
    setBaseUrlValue('');
    setShowBaseUrlConfig(false);
  }, []);

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setSmartInput('');
    setError(null);
    setParsedResult(null);
    
    try {
      const content = await selectedFile.text();
      const info = specImporter.getSpecInfo(content);
      if (info) {
        setParsedResult({
          type: 'file',
          name: info.name,
          description: info.description,
          preview: info,
          format: info.format
        });
        if (info.baseUrl) {
          setBaseUrlValue(info.baseUrl);
        }
      } else {
        setError('Unable to detect file format. Supported: OpenAPI, Postman, Insomnia');
      }
    } catch {
      setError('Failed to read file');
    }
  };

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
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleSmartInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setSmartInput(e.target.value);
    setError(null);
    setParsedResult(null);
    setFile(null);
  };

  const handleProcessInput = async () => {
    const input = smartInput.trim();
    if (!input) return;
    
    const type = detectInputType(input);
    setIsProcessing(true);
    setError(null);
    
    try {
      if (type === 'curl') {
        // Parse curl command
        const result = parseCurlCommand(input);
        if (!result) {
          throw new Error('Failed to parse curl command');
        }
        setParsedResult({
          type: 'curl',
          name: result.request.name,
          description: `${result.request.method} ${result.request.url}`
        });
        setFetchedContent(JSON.stringify(result.request));
      } else if (type === 'url') {
        // Fetch URL and detect spec
        let url = input;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = 'https://' + url;
        }
        
        if (!specImporter.isValidUrl(url)) {
          throw new Error('Please enter a valid HTTP or HTTPS URL');
        }
        
        const response = await window.electronAPI?.fetchUrlContent(url);
        if (!response?.success || !response.content) {
          throw new Error(response?.error || 'Failed to fetch URL');
      }

        const info = specImporter.getSpecInfo(response.content);
      if (!info) {
          throw new Error('The URL does not contain a valid API specification (OpenAPI, Postman, Insomnia)');
      }

        setParsedResult({
          type: 'url',
          name: info.name,
          description: info.description,
          preview: info,
          format: info.format
        });
        setFetchedContent(response.content);
      
      if (info.baseUrl) {
        setBaseUrlValue(info.baseUrl);
      }
      
      logToConsole('info', `Detected ${info.format} spec: ${info.name}`);
      } else {
        throw new Error('Unable to detect input type. Paste a curl command or an API spec URL.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to process input';
      setError(message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImport = async () => {
    if (!parsedResult) return;

    setIsProcessing(true);
    setError(null);

    try {
      if (parsedResult.type === 'curl') {
        // Import curl as a single request
        const result = parseCurlCommand(smartInput);
        if (!result) {
          throw new Error('Failed to parse curl command');
        }
        
        // Add as a new tab (unsaved request)
        addTab({
          id: result.request.id,
          type: 'request',
          title: result.request.name,
          request: result.request,
          isDirty: true
        });
        
        logToConsole('success', `Created request from curl: ${result.request.name}`);
        handleClose();
        return;
      }
      
      // For URL and file imports, create a collection
      const options: SpecImportOptions = {
        baseUrlVariableName: baseUrlVarName || 'baseUrl',
        baseUrlValue: baseUrlValue || parsedResult.preview?.baseUrl || '',
        createEnvironments: true,
      };
      
      let collection;
      let environments;
      
      if (parsedResult.type === 'url') {
        const url = smartInput.trim().startsWith('http') 
          ? smartInput.trim() 
          : 'https://' + smartInput.trim();
        const result = await specImporter.importFromUrl(url, options);
        collection = result.collection;
        environments = result.environments;
      } else if (parsedResult.type === 'file' && file) {
        const result = await specImporter.parseFile(file, options);
        const specSource = specImporter.createFileSpecSource(result.rawSpec, result.format);
        result.collection.specSource = specSource;
        result.collection.importedAt = Date.now();
        collection = result.collection;
        environments = result.environments;
      }
      
      if (collection) {
        importCollection(collection);
        logToConsole('success', `Imported collection: ${collection.name}`);
      
        // Import environments
        if (environments && environments.length > 0) {
        let importedCount = 0;
        let skippedCount = 0;
        
          for (const env of environments) {
            const imported = importEnvironment(env, true);
          if (imported) {
            importedCount++;
          } else {
            skippedCount++;
          }
        }
        
        if (importedCount > 0) {
          logToConsole('info', `Created ${importedCount} environment(s) from servers`);
        }
        if (skippedCount > 0) {
          logToConsole('info', `Skipped ${skippedCount} environment(s) (already exist)`);
          }
        }
      }
      
      handleClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import';
      setError(message);
      logToConsole('error', `Import failed: ${message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    resetState();
    closeImportModal();
  };

  const handleExampleClick = (value: string) => {
    setSmartInput(value);
    setFile(null);
    setParsedResult(null);
    setError(null);
  };

  const formatLabel: Record<SpecFormat, string> = {
    openapi: 'OpenAPI',
    postman: 'Postman',
    insomnia: 'Insomnia',
  };

  const canImport = parsedResult !== null;

  return (
    <Modal
      isOpen={importModalOpen}
      onClose={handleClose}
      title="Import"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleImport}
            disabled={!canImport}
            loading={isProcessing && canImport}
          >
            {parsedResult?.type === 'curl' ? 'Create Request' : 'Import Collection'}
          </Button>
        </>
      }
    >
      <div className="import-modal">
        {/* Smart Input Section */}
        <div className="import-modal__smart-section">
          <div className="import-modal__smart-header">
            <SparkleIcon />
            <span>Smart Import</span>
        </div>
          <p className="import-modal__smart-description">
            Paste a curl command or API specification URL
          </p>
          
          <div className="import-modal__smart-input-wrapper">
            <textarea
              className="import-modal__smart-input"
              value={smartInput}
              onChange={handleSmartInputChange}
              placeholder={`curl -X POST https://api.example.com/users -H "Authorization: Bearer token" -d '{"name": "John"}'

or

https://api.example.com/openapi.json`}
              rows={4}
              disabled={isProcessing}
            />
            
            {smartInput.trim() && !parsedResult && (
              <div className="import-modal__smart-input-actions">
                {detectedType && (
                  <span className={`import-modal__detected-type import-modal__detected-type--${detectedType}`}>
                    {detectedType === 'curl' && <><TerminalIcon /> curl command</>}
                    {detectedType === 'url' && <><LinkIcon /> URL</>}
                    {detectedType === 'unknown' && 'Unknown format'}
                  </span>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleProcessInput}
                  loading={isProcessing}
                  disabled={detectedType === 'unknown'}
                >
                  {detectedType === 'curl' ? 'Parse' : 'Fetch'}
                </Button>
              </div>
            )}
          </div>
          
          {/* Parsed Result Preview */}
          {parsedResult && (parsedResult.type === 'curl' || parsedResult.type === 'url') && (
            <div className={`import-modal__preview import-modal__preview--${parsedResult.type}`}>
                  <div className="import-modal__preview-icon">
                {parsedResult.type === 'curl' ? <TerminalIcon /> : <LinkIcon />}
                  </div>
                  <div className="import-modal__preview-info">
                <span className="import-modal__preview-name">{parsedResult.name}</span>
                      <span className="import-modal__preview-meta">
                  {parsedResult.format && (
                    <span className={`import-modal__preview-format import-modal__preview-format--${parsedResult.format}`}>
                      {formatLabel[parsedResult.format]}
                    </span>
                  )}
                  {parsedResult.type === 'curl' && (
                    <span className="import-modal__preview-format import-modal__preview-format--curl">
                      cURL
                    </span>
                  )}
                  {parsedResult.preview?.version && `v${parsedResult.preview.version}`}
                        </span>
                {parsedResult.description && (
                  <span className="import-modal__preview-desc">
                    {parsedResult.description.slice(0, 100)}
                    {parsedResult.description.length > 100 ? '...' : ''}
                      </span>
                    )}
                  </div>
                  <div className="import-modal__preview-check">
                    <CheckIcon />
                  </div>
                </div>
          )}

          {/* Base URL Config for URL imports */}
          {parsedResult && parsedResult.type === 'url' && parsedResult.preview && (
                  <div className="import-modal__base-url-config">
                    <div className="import-modal__base-url-header">
                      <span className="import-modal__base-url-title">Base URL Variable</span>
                      <button 
                        className="import-modal__base-url-toggle"
                        onClick={() => setShowBaseUrlConfig(!showBaseUrlConfig)}
                      >
                        <EditIcon />
                        {showBaseUrlConfig ? 'Hide' : 'Configure'}
                      </button>
                    </div>
                    
                    <div className="import-modal__base-url-preview">
                      <code>{`{{${baseUrlVarName}}}`}</code>
                      <span className="import-modal__base-url-arrow">→</span>
                      <code className="import-modal__base-url-value">{baseUrlValue || 'Not set'}</code>
                    </div>

                    {showBaseUrlConfig && (
                      <div className="import-modal__base-url-fields">
                        <div className="import-modal__base-url-field">
                          <label>Variable Name</label>
                          <Input
                            value={baseUrlVarName}
                            onChange={(e) => setBaseUrlVarName(e.target.value)}
                            placeholder="baseUrl"
                          />
                        </div>
                        <div className="import-modal__base-url-field">
                          <label>Value</label>
                          <Input
                            value={baseUrlValue}
                            onChange={(e) => setBaseUrlValue(e.target.value)}
                            placeholder="https://api.example.com"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
        </div>
        
        {/* Divider */}
        <div className="import-modal__divider">
          <span>or</span>
            </div>

        {/* File Upload Section */}
        <div 
          className={`import-modal__dropzone ${isDragging ? 'import-modal__dropzone--dragging' : ''} ${file ? 'import-modal__dropzone--has-file' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !file && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.yaml,.yml"
            onChange={handleFileInputChange}
            style={{ display: 'none' }}
          />
          
          {file && parsedResult?.type === 'file' ? (
            <div className="import-modal__dropzone-preview">
                <div className="import-modal__preview-icon">
                <FileIcon />
                </div>
                <div className="import-modal__preview-info">
                <span className="import-modal__preview-name">{file.name}</span>
                  <span className="import-modal__preview-meta">
                  {parsedResult.format && (
                    <span className={`import-modal__preview-format import-modal__preview-format--${parsedResult.format}`}>
                      {formatLabel[parsedResult.format]}
                    </span>
                  )}
                  {parsedResult.name}
                  {parsedResult.preview?.version && ` • v${parsedResult.preview.version}`}
                </span>
                </div>
                <div className="import-modal__preview-check">
                  <CheckIcon />
                </div>
              <button 
                className="import-modal__dropzone-clear"
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                  setParsedResult(null);
                }}
              >
                ×
              </button>
            </div>
          ) : (
            <div className="import-modal__dropzone-content">
              <div className="import-modal__dropzone-icon">
                <UploadIcon />
              </div>
              <span className="import-modal__dropzone-label">
                {isDragging ? 'Drop your file here' : 'Drag & drop a file or click to browse'}
              </span>
              <span className="import-modal__dropzone-hint">
                Supports OpenAPI and Postman format
              </span>
              </div>
            )}
        </div>

        {/* Base URL Config for file imports */}
        {parsedResult && parsedResult.type === 'file' && parsedResult.preview && (
              <div className="import-modal__base-url-config">
                <div className="import-modal__base-url-header">
                  <span className="import-modal__base-url-title">Base URL Variable</span>
                  <button 
                    className="import-modal__base-url-toggle"
                    onClick={() => setShowBaseUrlConfig(!showBaseUrlConfig)}
                  >
                    <EditIcon />
                    {showBaseUrlConfig ? 'Hide' : 'Configure'}
                  </button>
                </div>
                
                <div className="import-modal__base-url-preview">
                  <code>{`{{${baseUrlVarName}}}`}</code>
                  <span className="import-modal__base-url-arrow">→</span>
                  <code className="import-modal__base-url-value">{baseUrlValue || 'Not set'}</code>
                </div>

                {showBaseUrlConfig && (
                  <div className="import-modal__base-url-fields">
                    <div className="import-modal__base-url-field">
                      <label>Variable Name</label>
                      <Input
                        value={baseUrlVarName}
                        onChange={(e) => setBaseUrlVarName(e.target.value)}
                        placeholder="baseUrl"
                      />
                    </div>
                    <div className="import-modal__base-url-field">
                      <label>Value</label>
                      <Input
                        value={baseUrlValue}
                        onChange={(e) => setBaseUrlValue(e.target.value)}
                        placeholder="https://api.example.com"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

        {/* Error */}
        {error && (
          <div className="import-modal__error">
            <span>⚠️</span>
            {error}
          </div>
        )}
        
        {/* Examples Section */}
        {!parsedResult && !file && (
          <div className="import-modal__examples">
            <div className="import-modal__examples-header">
              <span>Examples</span>
            </div>
            <div className="import-modal__examples-grid">
              <div className="import-modal__examples-column">
                <span className="import-modal__examples-title">
                  <TerminalIcon /> cURL Commands
                </span>
                {CURL_EXAMPLES.map((example, i) => (
                  <button
                    key={i}
                    className="import-modal__example-item"
                    onClick={() => handleExampleClick(example.command)}
                  >
                    {example.label}
                  </button>
                ))}
              </div>
              <div className="import-modal__examples-column">
                <span className="import-modal__examples-title">
                  <LinkIcon /> API Specs
                </span>
                {URL_EXAMPLES.map((example, i) => (
                  <button
                    key={i}
                    className="import-modal__example-item"
                    onClick={() => handleExampleClick(example.url)}
                  >
                    {example.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ImportModal;
