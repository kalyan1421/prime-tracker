import React from 'react';
import { Tooltip } from '@heroui/react';
import { ageSeverity, SEVERITY } from './severity';

/**
 * Inline bar showing how long a unit has been AVAILABLE.
 * The bar fills (and reddens) as the unit sits longer.
 *
 *   0-30 days   → green / quiet
 *   30-60 days  → green-amber, ~50% fill
 *   60-90 days  → amber, ~75% fill
 *   90+ days    → red, full fill — flagged for price review
 *
 * Pass `availableSince` from the unit record. Returns null when unit isn't
 * AVAILABLE (the field will be null and the bar shouldn't show).
 */
export interface TimeOnMarketBarProps {
  availableSince?: string | Date | null;
  watchAt?: number;     // days, default 60
  criticalAt?: number;  // days, default 90
  className?: string;
}

export function TimeOnMarketBar({
  availableSince,
  watchAt = 60,
  criticalAt = 90,
  className = '',
}: TimeOnMarketBarProps) {
  if (!availableSince) return null;
  const since = new Date(availableSince);
  const days = Math.max(0, Math.floor((Date.now() - since.getTime()) / (24 * 60 * 60 * 1000)));
  const sev = ageSeverity(days, watchAt, criticalAt);
  // Bar fill saturates at criticalAt × 1.5 so the bar maxes out around 135 days
  const pct = Math.min(100, (days / (criticalAt * 1.5)) * 100);

  return (
    <Tooltip content={`Available ${days} day${days === 1 ? '' : 's'} (since ${since.toLocaleDateString()})`}>
      <div className={`inline-flex items-center gap-1.5 ${className}`}>
        <div className="w-12 h-1.5 rounded-full bg-gray-200 overflow-hidden">
          <div className={`${SEVERITY[sev].fill} h-full transition-[width]`} style={{ width: `${pct}%` }} />
        </div>
        <span className={`text-[11px] font-medium ${SEVERITY[sev].text}`}>
          {days}d
        </span>
      </div>
    </Tooltip>
  );
}
