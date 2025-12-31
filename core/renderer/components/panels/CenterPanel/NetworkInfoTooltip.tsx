import React from 'react';
import { GlobeIcon } from '@/components/ui/icons';
import { NetworkInfo } from '@/types';
import './NetworkInfoTooltip.css';

interface NetworkInfoTooltipProps {
  networkInfo: NetworkInfo;
}

export const NetworkInfoTooltip: React.FC<NetworkInfoTooltipProps> = ({ networkInfo }) => {
  const hasConnectionInfo = networkInfo.httpVersion || networkInfo.localAddress || networkInfo.remoteAddress;
  const hasTlsInfo = networkInfo.tlsProtocol || networkInfo.cipherName;
  const hasCertInfo = networkInfo.certificateCN || networkInfo.issuerCN || networkInfo.validUntil;

  return (
    <div className="network-info-tooltip">
      {/* Connection Section */}
      {hasConnectionInfo && (
        <div className="network-info-tooltip__section">
          <div className="network-info-tooltip__header">
            <GlobeIcon />
            <span className="network-info-tooltip__title">Network</span>
          </div>
          
          <div className="network-info-tooltip__rows">
            {networkInfo.httpVersion && (
              <div className="network-info-tooltip__row">
                <span className="network-info-tooltip__label">HTTP Version</span>
                <span className="network-info-tooltip__value">{networkInfo.httpVersion}</span>
              </div>
            )}
            {networkInfo.localAddress && (
              <div className="network-info-tooltip__row">
                <span className="network-info-tooltip__label">Local Address</span>
                <span className="network-info-tooltip__value">{networkInfo.localAddress}</span>
              </div>
            )}
            {networkInfo.remoteAddress && (
              <div className="network-info-tooltip__row">
                <span className="network-info-tooltip__label">Remote Address</span>
                <span className="network-info-tooltip__value">{networkInfo.remoteAddress}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TLS Section */}
      {hasTlsInfo && (
        <div className="network-info-tooltip__section">
          <div className="network-info-tooltip__rows">
            {networkInfo.tlsProtocol && (
              <div className="network-info-tooltip__row">
                <span className="network-info-tooltip__label">TLS Protocol</span>
                <span className="network-info-tooltip__value">{networkInfo.tlsProtocol}</span>
              </div>
            )}
            {networkInfo.cipherName && (
              <div className="network-info-tooltip__row">
                <span className="network-info-tooltip__label">Cipher Name</span>
                <span className="network-info-tooltip__value network-info-tooltip__value--wrap">
                  {networkInfo.cipherName}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Certificate Section */}
      {hasCertInfo && (
        <div className="network-info-tooltip__section">
          <div className="network-info-tooltip__rows">
            {networkInfo.certificateCN && (
              <div className="network-info-tooltip__row">
                <span className="network-info-tooltip__label">Certificate CN</span>
                <span className="network-info-tooltip__value">{networkInfo.certificateCN}</span>
              </div>
            )}
            {networkInfo.issuerCN && (
              <div className="network-info-tooltip__row">
                <span className="network-info-tooltip__label">Issuer CN</span>
                <span className="network-info-tooltip__value">{networkInfo.issuerCN}</span>
              </div>
            )}
            {networkInfo.validUntil && (
              <div className="network-info-tooltip__row">
                <span className="network-info-tooltip__label">Valid Until</span>
                <span className="network-info-tooltip__value">{networkInfo.validUntil}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NetworkInfoTooltip;

