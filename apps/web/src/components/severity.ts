import { IconType } from 'react-icons';
import { FiCheckCircle, FiAlertCircle, FiAlertTriangle, FiClock } from 'react-icons/fi';

/**
 * Cross-feature severity tokens. Used by Project Health, Variance Bars,
 * Time-on-Market, Stale Sales, Overdue Draws — every place where we
 * want the Founder's brain to pattern-match across features.
 *
 * Rule: if it's red on a budget line and red on a milestone, those should
 * mean roughly the same thing — "this needs attention now".
 */
export type Severity = 'healthy' | 'watch' | 'critical' | 'stale';

interface SeverityStyle {
  /** Tailwind class for backgrounds (cards, chips, bars). */
  bg: string;
  /** Text + foreground icon color. */
  text: string;
  /** Border for outlined variants. */
  border: string;
  /** Solid bar fill (charts, progress). */
  fill: string;
  /** Default icon for use when no domain-specific icon fits. */
  icon: IconType;
  /** Plain-English label for screen readers and badges. */
  label: string;
}

export const SEVERITY: Record<Severity, SeverityStyle> = {
  healthy:  {
    bg: 'bg-green-50',
    text: 'text-green-700',
    border: 'border-green-200',
    fill: 'bg-green-500',
    icon: FiCheckCircle,
    label: 'Healthy',
  },
  watch:    {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    fill: 'bg-amber-500',
    icon: FiAlertCircle,
    label: 'Watch',
  },
  critical: {
    bg: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-200',
    fill: 'bg-red-500',
    icon: FiAlertTriangle,
    label: 'Critical',
  },
  stale:    {
    bg: 'bg-gray-100',
    text: 'text-gray-600',
    border: 'border-gray-300',
    fill: 'bg-gray-400',
    icon: FiClock,
    label: 'Stale',
  },
};

/** Map a 0–100 score to a severity. Single source of truth for thresholds. */
export function scoreSeverity(score: number): Severity {
  if (score >= 75) return 'healthy';
  if (score >= 50) return 'watch';
  return 'critical';
}

/** Map elapsed days vs threshold to severity. */
export function ageSeverity(days: number, watchAt: number, criticalAt: number): Severity {
  if (days >= criticalAt) return 'critical';
  if (days >= watchAt) return 'watch';
  return 'healthy';
}
