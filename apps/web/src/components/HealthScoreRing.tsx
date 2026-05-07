import React from 'react';
import { Tooltip } from '@heroui/react';
import { SEVERITY, scoreSeverity, type Severity } from './severity';

/**
 * Apple Watch-style activity ring showing a 0–100 health score.
 * Used on Project cards (small) and Project header (large).
 *
 * Why a ring instead of a number? The ring conveys severity at a glance
 * across a list of 7+ projects — the founder's brain pattern-matches the
 * fill amount and color before reading any digits.
 */
export interface HealthScoreRingProps {
  score: number;          // 0–100
  size?: 'sm' | 'md' | 'lg';
  /** Optional breakdown for tooltip — shown on hover */
  breakdown?: { label: string; value: string }[];
  /** Override severity (e.g. show 'stale' for archived projects). */
  severityOverride?: Severity;
}

const SIZE: Record<NonNullable<HealthScoreRingProps['size']>, { dim: number; stroke: number; fontSize: string }> = {
  sm: { dim: 36, stroke: 4, fontSize: 'text-[10px]' },
  md: { dim: 56, stroke: 6, fontSize: 'text-xs' },
  lg: { dim: 96, stroke: 8, fontSize: 'text-base' },
};

const SEV_TO_STROKE: Record<Severity, string> = {
  healthy: 'stroke-green-500',
  watch: 'stroke-amber-500',
  critical: 'stroke-red-500',
  stale: 'stroke-gray-400',
};

export function HealthScoreRing({ score, size = 'md', breakdown, severityOverride }: HealthScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const sev = severityOverride ?? scoreSeverity(clamped);
  const { dim, stroke, fontSize } = SIZE[size];
  const radius = (dim - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  const ring = (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: dim, height: dim }}
      role="img"
      aria-label={`Health score ${clamped} out of 100, ${SEVERITY[sev].label}`}
    >
      <svg width={dim} height={dim} className="-rotate-90">
        {/* Track */}
        <circle
          cx={dim / 2}
          cy={dim / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          className="stroke-gray-200"
        />
        {/* Progress */}
        <circle
          cx={dim / 2}
          cy={dim / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`${SEV_TO_STROKE[sev]} transition-[stroke-dashoffset] duration-500`}
        />
      </svg>
      <span className={`absolute font-semibold ${fontSize} ${SEVERITY[sev].text}`}>
        {clamped}
      </span>
    </div>
  );

  if (!breakdown?.length) return ring;

  return (
    <Tooltip
      content={
        <div className="text-xs">
          <p className="font-semibold mb-1">{SEVERITY[sev].label} · {clamped}/100</p>
          {breakdown.map((b) => (
            <p key={b.label} className="text-gray-600">
              <span className="text-gray-400">{b.label}:</span> {b.value}
            </p>
          ))}
        </div>
      }
    >
      <span>{ring}</span>
    </Tooltip>
  );
}
