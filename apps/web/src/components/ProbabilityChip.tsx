import React from 'react';
import { Chip, Tooltip } from '@heroui/react';

/**
 * Pipeline stage probability chip.
 *
 *   PROSPECT       → 10%   gray
 *   LOI_SIGNED     → 35%   amber
 *   UNDER_CONTRACT → 75%   blue
 *   CLOSED         → 100%  green
 *   CANCELLED      → 0%    red (lost)
 *
 * Used on pipeline cards and the forecast header. The probability is the
 * default — actual values come from OrgSettings.saleStageProbabilities.
 */

const STAGE_PROBABILITIES: Record<string, number> = {
  PROSPECT: 0.10,
  LOI_SIGNED: 0.35,
  UNDER_CONTRACT: 0.75,
  CLOSED: 1.0,
  CANCELLED: 0.0,
};

const STAGE_STYLES: Record<string, string> = {
  PROSPECT: 'bg-gray-200 text-gray-700',
  LOI_SIGNED: 'bg-amber-100 text-amber-700',
  UNDER_CONTRACT: 'bg-blue-100 text-blue-700',
  CLOSED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

export interface ProbabilityChipProps {
  stage: string;
  /** Override default probability (per-org config). */
  probability?: number;
  /** When provided, shows the weighted dollar amount in tooltip. */
  salePrice?: number;
  size?: 'sm' | 'md';
}

export function ProbabilityChip({ stage, probability, salePrice, size = 'sm' }: ProbabilityChipProps) {
  const p = probability ?? STAGE_PROBABILITIES[stage] ?? 0;
  const pct = Math.round(p * 100);
  const className = STAGE_STYLES[stage] ?? 'bg-gray-100 text-gray-700';
  const weightedValue = salePrice != null ? salePrice * p : null;

  const chip = (
    <Chip size={size} variant="flat" className={className}>
      {pct}%
    </Chip>
  );

  if (weightedValue == null) return chip;
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  return (
    <Tooltip content={`Weighted: ${fmt(weightedValue)} (${pct}% of ${fmt(salePrice!)})`}>
      <span>{chip}</span>
    </Tooltip>
  );
}
