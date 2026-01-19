import React, { useState, useMemo, useEffect } from 'react';
import { Button, Dropdown, CodeEditor, CopyIcon, CheckIcon, CloseIcon } from '@/components/ui';
import { useRequest, useEnvironments, useTheme, useApp, useCollections } from '@/contexts';
import { CODE_FORMATS } from '@/utils/codeGenerators';
import { Collection } from '@/types';
import { APP_VERSION } from '@/utils/environment';
import { v4 as uuidv4 } from 'uuid';
import './CodePanel.css';

// Dynamically load ace modes on demand - each becomes a separate chunk
// Common modes (json, text, javascript, html, xml, css, python) are statically loaded in CodeEditor
const aceModeLoaders: Record<string, () => Promise<unknown>> = {
  sh: () => import('ace-builds/src-noconflict/mode-sh'),
  golang: () => import('ace-builds/src-noconflict/mode-golang'),
  java: () => import('ace-builds/src-noconflict/mode-java'),
  kotlin: () => import('ace-builds/src-noconflict/mode-kotlin'),
  csharp: () => import('ace-builds/src-noconflict/mode-csharp'),
  php: () => import('ace-builds/src-noconflict/mode-php'),
  ruby: () => import('ace-builds/src-noconflict/mode-ruby'),
  rust: () => import('ace-builds/src-noconflict/mode-rust'),
  swift: () => import('ace-builds/src-noconflict/mode-swift'),
  dart: () => import('ace-builds/src-noconflict/mode-dart'),
  c_cpp: () => import('ace-builds/src-noconflict/mode-c_cpp'),
  r: () => import('ace-builds/src-noconflict/mode-r'),
  objectivec: () => import('ace-builds/src-noconflict/mode-objectivec'),
  ocaml: () => import('ace-builds/src-noconflict/mode-ocaml'),
};

const loadedModes = new Set<string>();

async function loadAceMode(mode: string): Promise<void> {
  if (loadedModes.has(mode) || !aceModeLoaders[mode]) return;
  await aceModeLoaders[mode]();
  loadedModes.add(mode);
}

export const CodePanel: React.FC = () => {
  const { resolvedTheme } = useTheme();
  const { activeTab } = useRequest();
  const { activeEnvironment } = useEnvironments();
  const { collections } = useCollections();
  const { hideCodePanel, settings } = useApp();
  const [formatId, setFormatId] = useState('curl');
  const [copied, setCopied] = useState(false);

  const request = activeTab?.request;
  
  // Get the collection for the current request (if any)
  const requestCollection: Collection | null = request?.collectionId 
    ? collections.find(c => c.id === request.collectionId) || null
    : null;

  // Create a modified request that includes the User-Agent header if active
  const effectiveRequest = useMemo(() => {
    if (!request) return null;
    
    // Check if User-Agent is disabled for this specific request
    const userAgentOverride = request.headers.find(
      h => h.id?.startsWith('__user_agent_override__') && !h.enabled
    );
    
    // Check if user already has a User-Agent header defined
    const hasUserDefinedUserAgent = request.headers.some(
      h => h.key.toLowerCase() === 'user-agent' && !h.id?.startsWith('__user_agent_override__')
    );
    
    // Also check collection headers
    const hasCollectionUserAgent = requestCollection?.headers?.some(
      h => h.enabled && h.key.toLowerCase() === 'user-agent'
    );
    
    // Add User-Agent if: setting is enabled AND no override AND no user-defined header
    const shouldAddUserAgent = (settings.sendUserAgent ?? true) && 
                               !userAgentOverride && 
                               !hasUserDefinedUserAgent &&
                               !hasCollectionUserAgent;
    
    // Helper to filter out all override markers from headers
    const filterOverrideMarkers = (headers: typeof request.headers) => 
      headers.filter(h => !h.id?.startsWith('__user_agent_override__') && !h.id?.startsWith('__inherited_header_override__'));
    
    if (!shouldAddUserAgent) {
      // Filter out the override markers from headers before generating code
      return {
        ...request,
        headers: filterOverrideMarkers(request.headers),
      };
    }
    
    // Add User-Agent header to the request for code generation
    return {
      ...request,
      headers: [
        { id: uuidv4(), key: 'User-Agent', value: `Echolon/${APP_VERSION}`, enabled: true },
        ...filterOverrideMarkers(request.headers),
      ],
    };
  }, [request, settings.sendUserAgent, requestCollection?.headers]);

  const selectedFormat = useMemo(() => {
    return CODE_FORMATS.find(f => f.id === formatId) || CODE_FORMATS[0];
  }, [formatId]);

  // Dynamically load ace mode when format changes
  useEffect(() => {
    loadAceMode(selectedFormat.aceMode);
  }, [selectedFormat.aceMode]);

  const code = useMemo(() => {
    if (!effectiveRequest) return '';
    return selectedFormat.generator(effectiveRequest, activeEnvironment, requestCollection);
  }, [effectiveRequest, activeEnvironment, requestCollection, selectedFormat]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const formatOptions = useMemo(() => {
    return CODE_FORMATS.map(format => ({
      value: format.id,
      label: format.name,
    }));
  }, []);

  if (!request) {
    return (
      <div className="code-panel">
        <div className="code-panel__header">
          <h3>Code</h3>
          <Button variant="ghost" size="sm" onClick={hideCodePanel}>
            <CloseIcon />
          </Button>
        </div>
        <div className="code-panel__empty">
          <p>Select a request to view code</p>
        </div>
      </div>
    );
  }

  return (
    <div className="code-panel">
      <div className="code-panel__header">
        <h3>Code</h3>
        <Button variant="ghost" size="sm" onClick={hideCodePanel}>
          <CloseIcon />
        </Button>
      </div>

      <div className="code-panel__format-selector">
        <Dropdown
          options={formatOptions}
          value={formatId}
          onChange={setFormatId}
          size="sm"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className={`code-panel__copy-btn ${copied ? 'copied' : ''}`}
          title={copied ? 'Copied!' : 'Copy to clipboard'}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>

      <div className="code-panel__editor">
        <CodeEditor
          mode={selectedFormat.aceMode}
          value={code}
          readOnly
          width="100%"
          height="100%"
        />
      </div>
    </div>
  );
};

export default CodePanel;
