import React from 'react';
import { ClockIcon } from '@/components/ui/icons';
import { ResponseTiming } from '@/types';
import './ResponseTimeTooltip.css';

interface ResponseTimeTooltipProps {
  timing: ResponseTiming;
}

interface TimingRow {
  label: string;
  value: number;
  color: string;
  dashed?: boolean;
}

export const ResponseTimeTooltip: React.FC<ResponseTimeTooltipProps> = ({ timing }) => {
  const formatTime = (ms: number): string => {
    if (ms < 0.01) return '0 ms';
    if (ms < 1) return `${ms.toFixed(2)} ms`;
    if (ms < 1000) return `${ms.toFixed(2)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  };

  const rows: TimingRow[] = [
    { label: 'Prepare', value: timing.prepare, color: '#9ca3af' },
    { label: 'Socket Initialization', value: timing.socketInit, color: '#f59e0b' },
    { label: 'DNS Lookup', value: timing.dnsLookup, color: '#f59e0b' },
    { label: 'TCP Handshake', value: timing.tcpHandshake, color: '#3b82f6' },
    { label: 'SSL Handshake', value: timing.sslHandshake, color: '#3b82f6' },
    { label: 'Waiting (TTFB)', value: timing.ttfb, color: '#fca5a5', dashed: true },
    { label: 'Download', value: timing.download, color: '#22c55e' },
    { label: 'Process', value: timing.process, color: '#9ca3af' },
  ];

  // Calculate cumulative offsets for waterfall
  let cumulative = 0;
  const rowsWithOffset = rows.map(row => {
    const offset = cumulative;
    cumulative += row.value;
    return { ...row, offset };
  });

  const total = timing.total;
  const maxWidth = 180; // Width available for bars

  return (
    <div className="response-time-tooltip">
      <div className="response-time-tooltip__header">
        <ClockIcon />
        <span className="response-time-tooltip__title">Response Time</span>
        <span className="response-time-tooltip__total">{formatTime(total)}</span>
      </div>
      
      <div className="response-time-tooltip__rows">
        {rowsWithOffset.map((row, index) => {
          const barWidth = total > 0 ? (row.value / total) * maxWidth : 0;
          const barOffset = total > 0 ? (row.offset / total) * maxWidth : 0;
          
          return (
            <div key={index} className="response-time-tooltip__row">
              <span className="response-time-tooltip__label">{row.label}</span>
              <div className="response-time-tooltip__bar-container">
                <div 
                  className={`response-time-tooltip__bar ${row.dashed ? 'response-time-tooltip__bar--dashed' : ''}`}
                  style={{ 
                    left: barOffset,
                    width: Math.max(barWidth, row.value > 0 ? 3 : 0),
                    backgroundColor: row.dashed ? 'transparent' : row.color,
                    borderColor: row.color,
                  }}
                />
              </div>
              <span className="response-time-tooltip__value">{formatTime(row.value)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ResponseTimeTooltip;

