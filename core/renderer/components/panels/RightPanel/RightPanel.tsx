import React, { useState, useMemo } from 'react';
import { Button, TabBar, CopyIcon, CheckIcon } from '@/components/ui';
import { useRequest, useEnvironments, useCollections, useApp } from '@/contexts';
import { Collection } from '@/types';
import { generateCurl } from '@/utils/codeGenerators';
import { APP_VERSION } from '@/utils/environment';
import { v4 as uuidv4 } from 'uuid';
import './RightPanel.css';

type RightPanelTab = 'curl' | 'code' | 'info';

const tabs = [
  { id: 'curl', title: 'cURL' },
  { id: 'code', title: 'Code' },
  { id: 'info', title: 'Info' },
];

export const RightPanel: React.FC = () => {
  const { activeTab } = useRequest();
  const { activeEnvironment } = useEnvironments();
  const { collections } = useCollections();
  const { settings } = useApp();
  const [activeRightTab, setActiveRightTab] = useState<RightPanelTab>('curl');
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
    
    if (!shouldAddUserAgent) {
      // Filter out the override marker from headers before generating code
      return {
        ...request,
        headers: request.headers.filter(h => !h.id?.startsWith('__user_agent_override__')),
      };
    }
    
    // Add User-Agent header to the request for code generation
    return {
      ...request,
      headers: [
        { id: uuidv4(), key: 'User-Agent', value: `Echolon/${APP_VERSION}`, enabled: true },
        ...request.headers.filter(h => !h.id?.startsWith('__user_agent_override__')),
      ],
    };
  }, [request, settings.sendUserAgent, requestCollection?.headers]);

  const curlCommand = useMemo(() => {
    if (!effectiveRequest) return '';
    return generateCurl(effectiveRequest, activeEnvironment, requestCollection);
  }, [effectiveRequest, activeEnvironment, requestCollection]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(curlCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!request) {
    return (
      <div className="right-panel">
        <div className="right-panel__empty">
          <p>Select a request to see details</p>
        </div>
      </div>
    );
  }

  return (
    <div className="right-panel">
      <div className="right-panel__header">
        <div className="right-panel__tabs">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`right-panel__tab ${activeRightTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveRightTab(tab.id as RightPanelTab)}
            >
              {tab.title}
            </button>
          ))}
        </div>
      </div>

      <div className="right-panel__content">
        {activeRightTab === 'curl' && (
          <div className="right-panel__curl">
            <div className="right-panel__curl-header">
              <span>cURL Command</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                icon={copied ? <CheckIcon /> : <CopyIcon />}
              >
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            <pre className="right-panel__curl-code">{curlCommand}</pre>
          </div>
        )}

        {activeRightTab === 'code' && (
          <div className="right-panel__code">
            <p className="right-panel__placeholder">Code generation coming soon...</p>
            <p className="right-panel__placeholder-hint">
              Generate code snippets for various languages (JavaScript, Python, etc.)
            </p>
          </div>
        )}

        {activeRightTab === 'info' && (
          <div className="right-panel__info">
            <div className="right-panel__info-section">
              <h4>Request Details</h4>
              <dl>
                <dt>Name</dt>
                <dd>{request.name}</dd>
                <dt>Method</dt>
                <dd>{request.method}</dd>
                <dt>URL</dt>
                <dd className="right-panel__info-url">{request.url || 'Not set'}</dd>
                <dt>Headers</dt>
                <dd>{request.headers.filter(h => h.enabled && h.key).length} active</dd>
                <dt>Query Params</dt>
                <dd>{request.queryParams.filter(p => p.enabled && p.key).length} active</dd>
                <dt>Auth Type</dt>
                <dd>{request.auth.type}</dd>
                <dt>Body Type</dt>
                <dd>{request.body.type}</dd>
              </dl>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RightPanel;

