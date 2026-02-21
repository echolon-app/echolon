import React, { useState, useEffect } from 'react';
import { Modal, CustomSelect } from '@/components/ui';
import { SizeBreakdown } from '@/types';
import './ResponseSizeModal.css';

const ROW_ORDER = ['Uncompressed', 'Actual', 'gzip', 'brotli', 'zstd'] as const;
type RowId = (typeof ROW_ORDER)[number];
const COMPRESSIBLE_METHODS = ['gzip', 'brotli', 'zstd'] as const;
type MethodId = (typeof COMPRESSIBLE_METHODS)[number];
type ContentEncoding = 'Uncompressed' | MethodId;

const LEVEL_RANGES: Record<MethodId, { min: number; max: number }> = {
  gzip: { min: 1, max: 9 },
  brotli: { min: 1, max: 11 },
  zstd: { min: 1, max: 22 },
};

function getContentEncoding(headers: Array<{ key: string; value: string }>): ContentEncoding {
  const ce = headers.find((h) => h.key.toLowerCase() === 'content-encoding')?.value?.toLowerCase() ?? '';
  if (ce === 'gzip' || ce === 'x-gzip') return 'gzip';
  if (ce === 'br') return 'brotli';
  if (ce === 'zstd') return 'zstd';
  return 'Uncompressed';
}

const numFmt: Intl.NumberFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});
const numFmtInt: Intl.NumberFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

function formatKb(bytes: number): string {
  const kb = bytes / 1024;
  return kb < 0.01 && bytes > 0 ? '<0.01' : numFmt.format(kb);
}

const RATE_UNITS = [
  { id: 'sec', label: '/sec' },
  { id: 'min', label: '/min' },
  { id: 'hour', label: '/hour' },
  { id: 'day', label: '/day' },
  { id: 'week', label: '/week' },
  { id: 'month', label: '/month' },
] as const;
type RateUnitId = (typeof RATE_UNITS)[number]['id'];

const DURATION_UNITS = [
  { id: 'sec', label: 'second' },
  { id: 'min', label: 'minute' },
  { id: 'hour', label: 'hour' },
  { id: 'day', label: 'day' },
  { id: 'week', label: 'week' },
  { id: 'month', label: 'month' },
] as const;
type DurationUnitId = (typeof DURATION_UNITS)[number]['id'];

const SECS_PER_UNIT: Record<string, number> = {
  sec: 1,
  min: 60,
  hour: 3600,
  day: 86400,
  week: 604800,
  month: 2592000,
};

function formatBandwidth(bytesPerUnit: number, unit: RateUnitId): string {
  const suffix = '/' + unit;
  if (bytesPerUnit >= 1024 * 1024 * 1024) return `${numFmt.format(bytesPerUnit / 1024 / 1024 / 1024)} GB${suffix}`;
  if (bytesPerUnit >= 1024 * 1024) return `${numFmt.format(bytesPerUnit / 1024 / 1024)} MB${suffix}`;
  if (bytesPerUnit >= 1024) return `${numFmt.format(bytesPerUnit / 1024)} KB${suffix}`;
  return `${numFmtInt.format(bytesPerUnit)} B${suffix}`;
}

function formatTotal(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${numFmt.format(bytes / 1024 / 1024 / 1024)} GB`;
  if (bytes >= 1024 * 1024) return `${numFmt.format(bytes / 1024 / 1024)} MB`;
  if (bytes >= 1024) return `${numFmt.format(bytes / 1024)} KB`;
  return `${numFmtInt.format(bytes)} B`;
}

export interface ResponseSizeModalProps {
  isOpen: boolean;
  onClose: () => void;
  sizeBreakdown: SizeBreakdown;
  headers: Array<{ key: string; value: string }>;
  body: string;
}

export const ResponseSizeModal: React.FC<ResponseSizeModalProps> = ({
  isOpen,
  onClose,
  sizeBreakdown,
  headers,
  body,
}) => {
  const usedMethod = getContentEncoding(headers);
  const uncompressedBody = sizeBreakdown.uncompressed ?? sizeBreakdown.body ?? 0;
  const actualCompressedBody = sizeBreakdown.body;

  const [levels, setLevels] = useState({ gzip: 9, brotli: 9, zstd: 11 });
  const [computed, setComputed] = useState<{ gzip: number | null; brotli: number | null; zstd: number | null } | null>(null);
  const [computedTimes, setComputedTimes] = useState<{ gzip: number | null; brotli: number | null; zstd: number | null } | null>(null);
  const [calculatorRequests, setCalculatorRequests] = useState(10);
  const [calculatorUnit, setCalculatorUnit] = useState<RateUnitId>('sec');
  const [calculatorDuration, setCalculatorDuration] = useState(1);
  const [calculatorDurationUnit, setCalculatorDurationUnit] = useState<DurationUnitId>('hour');
  const canCompute = Boolean(body && !body.startsWith('[Binary content:') && window.electronAPI?.computeCompressionSizes);

  type CompressionResult = { gzip?: number; brotli?: number; zstd?: number; gzipMs?: number; brotliMs?: number; zstdMs?: number };

  // Recompute only one method (uses level from arg, so no stale closure).
  const recomputeSingle = (key: 'gzip' | 'brotli' | 'zstd', level: number) => {
    const promise = window.electronAPI?.computeCompressionSizes?.({ body, methods: [key], levels: { [key]: level } });
    if (!promise) return;
    promise
      .then((result: CompressionResult) => {
        setComputed((prev) => ({
          gzip: result.gzip !== undefined ? result.gzip : (prev?.gzip ?? null),
          brotli: result.brotli !== undefined ? result.brotli : (prev?.brotli ?? null),
          zstd: result.zstd !== undefined ? result.zstd : (prev?.zstd ?? null),
        }));
        setComputedTimes((prev) => ({
          gzip: result.gzipMs !== undefined ? result.gzipMs : (prev?.gzip ?? null),
          brotli: result.brotliMs !== undefined ? result.brotliMs : (prev?.brotli ?? null),
          zstd: result.zstdMs !== undefined ? result.zstdMs : (prev?.zstd ?? null),
        }));
      })
      .catch(() => {});
  };

  // Initial load: compute all 3 once after modal open (500ms delay).
  useEffect(() => {
    if (!isOpen || !canCompute) {
      if (!isOpen) {
        setComputed(null);
        setComputedTimes(null);
      }
      return;
    }
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      if (cancelled) return;
      const promise = window.electronAPI?.computeCompressionSizes?.({ body, levels });
      if (promise) {
        promise
          .then((result: CompressionResult) => {
            if (!cancelled) {
              setComputed({
                gzip: result.gzip ?? null,
                brotli: result.brotli ?? null,
                zstd: result.zstd ?? null,
              });
              setComputedTimes({
                gzip: result.gzipMs ?? null,
                brotli: result.brotliMs ?? null,
                zstd: result.zstdMs ?? null,
              });
            }
          })
          .catch(() => {
            if (!cancelled) {
              setComputed(null);
              setComputedTimes(null);
            }
          });
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [isOpen, canCompute, body]);


  const getSize = (row: RowId): number | null => {
    
    if (row === 'Uncompressed') return uncompressedBody;
    if (row === 'Actual') return actualCompressedBody;
    if (row === 'gzip') return computed?.gzip || null;
    if (row === 'brotli') return computed?.brotli || null;
    if (row === 'zstd') return computed?.zstd || null;
    return null;
  };

  const getTimeMs = (row: RowId): number | null => {
    if (row === 'gzip' || row === 'brotli' || row === 'zstd') return computedTimes?.[row] ?? null;
    return null;
  };

  const isLoading = canCompute && computed === null;
  const showLoader = (row: RowId) =>
    COMPRESSIBLE_METHODS.includes(row as MethodId) && getSize(row) == null && isLoading;

  const setLevel = (key: 'gzip' | 'brotli' | 'zstd', value: number) => {
    const range = LEVEL_RANGES[key];
    const clamped = Math.min(range.max, Math.max(range.min, value));
    setLevels((prev) => ({ ...prev, [key]: clamped }));
  };

  // On blur: sync level from input (avoids stale closure) and recalc only this method.
  const handleLevelBlur = (key: 'gzip' | 'brotli' | 'zstd', e: React.FocusEvent<HTMLInputElement>) => {
    const raw = parseInt((e.target as HTMLInputElement).value, 10);
    const range = LEVEL_RANGES[key];
    const clamped = Math.min(range.max, Math.max(range.min, Number.isNaN(raw) ? range.min : raw));
    setLevels((prev) => ({ ...prev, [key]: clamped }));
    recomputeSingle(key, clamped);
  };

  // Savings calculator: total data over duration = size * total requests in period
  const requestsPerUnit = Math.max(0, calculatorRequests);
  const durationValue = Math.max(0, calculatorDuration);
  const secsPerRateUnit = SECS_PER_UNIT[calculatorUnit] ?? 1;
  const secsPerDurationUnit = SECS_PER_UNIT[calculatorDurationUnit] ?? 3600;
  const totalRequestsInPeriod = requestsPerUnit * durationValue * (secsPerDurationUnit / secsPerRateUnit);
  const getTotalData = (row: RowId): number | null => {
    const size = getSize(row);
    return size != null ? size * totalRequestsInPeriod : null;
  };
  const maxTotalData = ROW_ORDER.reduce((max, row) => {
    const b = getTotalData(row);
    return b != null && b > max ? b : max;
  }, 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Response size breakdown" size="md" className="response-size-modal__modal">
      <div className="response-size-modal">
        <p className="response-size-modal__intro">
          Body size by encoding (KB). Bar width = size relative to uncompressed (100%).
        </p>
        <div className="response-size-modal__chart">
          {ROW_ORDER.map((row) => {
            const size = getSize(row);
            const isUsed = row === 'Actual' ? usedMethod !== 'Uncompressed' : usedMethod === row;
            const barWidthPercent =
              row === 'Uncompressed'
                ? 100
                : uncompressedBody > 0 && size != null && size > 0
                  ? Math.min(100, Math.max((size / uncompressedBody) * 100, 2))
                  : 0;
            const savings =
              row === 'Uncompressed' ? 0 : size != null && uncompressedBody > 0
                ? Math.round((1 - size / uncompressedBody) * 100)
                : null;
            const loading = showLoader(row);
            const hasLevelInput = COMPRESSIBLE_METHODS.includes(row as MethodId);

            return (
              <div
                key={row}
                className={`response-size-modal__row ${row === 'Actual' ? 'response-size-modal__row--used' : ''}`}
              >
                <div className="response-size-modal__legend">
                  <div className="response-size-modal__legend-top">
                    <span className="response-size-modal__method">
                      {row === 'Actual' ? `Currently used (${usedMethod})` : row}
                    </span>
                    {hasLevelInput && (() => {
                      const method = row as MethodId;
                      return (
                        <>
                          <input
                            type="number"
                            min={LEVEL_RANGES[method].min}
                            max={LEVEL_RANGES[method].max}
                            value={levels[method]}
                            onChange={(e) => setLevel(method, parseInt(e.target.value, 10) || LEVEL_RANGES[method].min)}
                            onBlur={(e) => handleLevelBlur(method, e)}
                            className="response-size-modal__level-input"
                            title={`${method}: ${LEVEL_RANGES[method].min}–${LEVEL_RANGES[method].max}`}
                          />
                          <span className="response-size-modal__level-hint">({LEVEL_RANGES[method].min}–{LEVEL_RANGES[method].max})</span>
                        </>
                      );
                    })()}
                  </div>
                  <span className="response-size-modal__savings">
                    {row === 'Uncompressed' ? '0%' : savings != null ? `${savings}% smaller` : loading ? '…' : '—'}
                    {getTimeMs(row) != null && (
                      <span className="response-size-modal__time"> · {getTimeMs(row)!.toFixed(2)} ms</span>
                    )}
                  </span>
                </div>
                <div className="response-size-modal__bar-wrap">
                  {loading ? (
                    <div className="response-size-modal__bar response-size-modal__bar--loader" aria-busy="true" title="Calculating…" />
                  ) : size != null || row === 'Uncompressed' ? (
                    <div
                      className={`response-size-modal__bar ${row === 'Uncompressed' ? 'response-size-modal__bar--full' : ''}`}
                      style={{
                        width: row === 'Uncompressed' ? '100%' : `${barWidthPercent}%`,
                      }}
                      title={size != null ? `${formatKb(size)} KB` : undefined}
                    />
                  ) : null}
                </div>
                <div className="response-size-modal__value">
                  {loading ? (
                    <span className="response-size-modal__loading">Calculating…</span>
                  ) : size != null ? (
                    `${formatKb(size)} KB`
                  ) : (
                    '—'
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <section className="response-size-modal__calculator">
          <h3 className="response-size-modal__calculator-title">Savings Calculator</h3>
          <p className="response-size-modal__calculator-intro">
            Total download over the selected duration at the given request rate.
          </p>
          <div className="response-size-modal__calculator-form">
            <label className="response-size-modal__calculator-label">
              <span className="response-size-modal__calculator-label-text">Requests</span>
              <input
                type="number"
                min={0}
                step={1}
                value={calculatorRequests}
                onChange={(e) => setCalculatorRequests(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="response-size-modal__calculator-input"
              />
            </label>
            <label className="response-size-modal__calculator-label">
              <span className="response-size-modal__calculator-label-text">Unit</span>
              <CustomSelect
                options={RATE_UNITS.map(({ id, label }) => ({ value: id, label }))}
                value={calculatorUnit}
                onChange={(v: string) => setCalculatorUnit(v as RateUnitId)}
                aria-label="Request rate unit"
              />
            </label>
            <div className="response-size-modal__calculator-duration">
              <label className="response-size-modal__calculator-label">
                <span className="response-size-modal__calculator-label-text">Duration</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={calculatorDuration}
                  onChange={(e) => setCalculatorDuration(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="response-size-modal__calculator-input"
                />
              </label>
              <CustomSelect
                options={DURATION_UNITS.map(({ id, label }) => ({ value: id, label }))}
                value={calculatorDurationUnit}
                onChange={(v: string) => setCalculatorDurationUnit(v as DurationUnitId)}
                aria-label="Duration unit"
              />
            </div>
          </div>
          <div className="response-size-modal__chart response-size-modal__calculator-chart">
            {ROW_ORDER.map((row) => {
              const totalData = getTotalData(row);
              const barWidthPercent =
                maxTotalData > 0 && totalData != null && totalData > 0
                  ? Math.min(100, Math.max((totalData / maxTotalData) * 100, 2))
                  : 0;
              const isUsed = row === 'Actual' ? usedMethod !== 'Uncompressed' : usedMethod === row;

              return (
                <div
                  key={row}
                  className={`response-size-modal__row ${isUsed ? 'response-size-modal__row--used' : ''}`}
                >
                  <div className="response-size-modal__legend">
                    <span className="response-size-modal__method">
                      {row === 'Actual' ? `Currently used (${usedMethod})` : row}
                    </span>
                  </div>
                  <div className="response-size-modal__bar-wrap response-size-modal__bar-wrap--value-inside">
                    {totalData != null ? (
                      <div
                        className={`response-size-modal__bar ${row === 'Uncompressed' ? 'response-size-modal__bar--full' : ''}`}
                        style={{ width: `${row === 'Uncompressed' ? 100 : barWidthPercent}%` }}
                        title={formatTotal(totalData)}
                      />
                    ) : null}
                    <div className="response-size-modal__value response-size-modal__value--inside">
                      {totalData != null ? formatTotal(totalData) : '—'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </Modal>
  );
};

export default ResponseSizeModal;
