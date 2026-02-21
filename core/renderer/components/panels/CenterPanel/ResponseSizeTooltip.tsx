import React from 'react';
import { DownloadIcon, UploadIcon } from '@/components/ui/icons';
import { SizeBreakdown } from '@/types';
import './ResponseSizeTooltip.css';

function getCompressionLabel(headers: Array<{ key: string; value: string }>): string {
  const ce = headers.find((h) => h.key.toLowerCase() === 'content-encoding')?.value?.toLowerCase() ?? '';
  if (ce === 'gzip' || ce === 'x-gzip') return 'gzip';
  if (ce === 'br') return 'brotli';
  if (ce === 'zstd') return 'zstd';
  return 'None';
}

interface ResponseSizeTooltipProps {
  responseSize: SizeBreakdown;
  requestSize?: SizeBreakdown;
  headers: Array<{ key: string; value: string }>;
}

export const ResponseSizeTooltip: React.FC<ResponseSizeTooltipProps> = ({ 
  responseSize, 
  requestSize,
  headers,
}) => {
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const compressionUsed = getCompressionLabel(headers);

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
            <span className="response-size-tooltip__label">Compression</span>
            <span className="response-size-tooltip__value">{compressionUsed}</span>
          </div>
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

