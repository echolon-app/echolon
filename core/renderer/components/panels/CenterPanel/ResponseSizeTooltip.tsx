import React from 'react';
import { DownloadIcon, UploadIcon } from '@/components/ui/icons';
import { SizeBreakdown } from '@/types';
import './ResponseSizeTooltip.css';

interface ResponseSizeTooltipProps {
  responseSize: SizeBreakdown;
  requestSize?: SizeBreakdown;
}

export const ResponseSizeTooltip: React.FC<ResponseSizeTooltipProps> = ({ 
  responseSize, 
  requestSize 
}) => {
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  return (
    <div className="response-size-tooltip">
      {/* Response Size Section */}
      <div className="response-size-tooltip__section">
        <div className="response-size-tooltip__header response-size-tooltip__header--response">
          <DownloadIcon />
          <span className="response-size-tooltip__title">Response Size</span>
          <span className="response-size-tooltip__total">{formatSize(responseSize.total)}</span>
        </div>
        
        <div className="response-size-tooltip__rows">
          <div className="response-size-tooltip__row">
            <span className="response-size-tooltip__label">Headers</span>
            <span className="response-size-tooltip__value">{formatSize(responseSize.headers)}</span>
          </div>
          <div className="response-size-tooltip__row">
            <span className="response-size-tooltip__label">Body</span>
            <span className="response-size-tooltip__value">{formatSize(responseSize.body)}</span>
          </div>
          {responseSize.uncompressed !== undefined && responseSize.uncompressed !== responseSize.body && (
            <div className="response-size-tooltip__row">
              <span className="response-size-tooltip__label">Uncompressed</span>
              <span className="response-size-tooltip__value">{formatSize(responseSize.uncompressed)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Request Size Section */}
      {requestSize && (
        <div className="response-size-tooltip__section">
          <div className="response-size-tooltip__header response-size-tooltip__header--request">
            <UploadIcon />
            <span className="response-size-tooltip__title">Request Size</span>
            <span className="response-size-tooltip__total">{formatSize(requestSize.total)}</span>
          </div>
          
          <div className="response-size-tooltip__rows">
            <div className="response-size-tooltip__row">
              <span className="response-size-tooltip__label">Headers</span>
              <span className="response-size-tooltip__value">{formatSize(requestSize.headers)}</span>
            </div>
            <div className="response-size-tooltip__row">
              <span className="response-size-tooltip__label">Body</span>
              <span className="response-size-tooltip__value">{formatSize(requestSize.body)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResponseSizeTooltip;

