/**
 * DocumentGateChip — Inline indicator showing document gate status for a
 * sales stage or interior phase.
 *
 * Usage:
 *   <DocumentGateChip docs={saleDocuments} required={SALE_STAGE_DOCS['UNDER_CONTRACT']} />
 *
 * Shows:
 *   ✓ All docs         → green, no blocker
 *   ⚠ 1 of 2 docs      → amber, missing listed
 *   ✗ 0 of 2 required  → red, blocks advancement
 */

import { Tooltip } from '@heroui/react';
import { FiCheckCircle, FiAlertTriangle, FiXCircle } from 'react-icons/fi';

// ─── doc requirement maps ─────────────────────────────────────────────────────

/** Sales stage → required DocCategory values */
export const SALE_STAGE_DOCS: Record<string, string[]> = {
  LOI_SIGNED:      ['LOI'],
  UNDER_CONTRACT:  ['BOOKING_AGREEMENT'],
  CLOSED:          ['DEED', 'NOC', 'POSSESSION_CERTIFICATE'],
};

/** Interior phase → required DocCategory values before advancing to next phase */
export const INTERIOR_PHASE_DOCS: Record<string, string[]> = {
  CLIENT_APPROVAL: ['DRAWING'],
  CITY_APPROVAL:   ['CITY_APPROVAL'],
  HANDOVER:        ['HANDOVER_CERTIFICATE'],
};

/** Human-readable category labels */
const CAT_LABEL: Record<string, string> = {
  LOI:                     'LOI',
  BOOKING_AGREEMENT:       'Booking Agreement',
  DEED:                    'Deed',
  NOC:                     'NOC',
  POSSESSION_CERTIFICATE:  'Possession Certificate',
  DRAWING:                 'Design Drawing',
  CITY_APPROVAL:           'City Approval',
  HANDOVER_CERTIFICATE:    'Handover Certificate',
};

// ─── component ────────────────────────────────────────────────────────────────

interface DocumentGateChipProps {
  /** Documents already uploaded — array of objects with a `category` field */
  docs: Array<{ category: string }>;
  /** Required category strings for this gate */
  required: string[];
  /** Optional: show nothing if no requirements */
  hideWhenNone?: boolean;
  /** Compact mode — icon only, no text */
  compact?: boolean;
}

export function DocumentGateChip({
  docs,
  required,
  hideWhenNone = true,
  compact = false,
}: DocumentGateChipProps) {
  if (!required.length && hideWhenNone) return null;
  if (!required.length) return null;

  const uploadedCats = new Set(docs.map((d) => d.category));
  const uploaded     = required.filter((r) => uploadedCats.has(r));
  const missing      = required.filter((r) => !uploadedCats.has(r));
  const allDone      = missing.length === 0;
  const noneDone     = uploaded.length === 0;

  const tooltipContent = allDone
    ? 'All required documents uploaded'
    : `Missing: ${missing.map((m) => CAT_LABEL[m] ?? m).join(', ')}`;

  const icon = allDone
    ? <FiCheckCircle size={11} className="text-green-600" />
    : noneDone
    ? <FiXCircle size={11} className="text-red-500" />
    : <FiAlertTriangle size={11} className="text-amber-500" />;

  const colors = allDone
    ? 'bg-green-50 text-green-700 border-green-100'
    : noneDone
    ? 'bg-red-50 text-red-600 border-red-100'
    : 'bg-amber-50 text-amber-700 border-amber-100';

  if (compact) {
    return (
      <Tooltip content={tooltipContent}>
        <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full border ${colors}`}>
          {icon}
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip content={tooltipContent}>
      <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border cursor-default ${colors}`}>
        {icon}
        {allDone
          ? 'Docs ✓'
          : `${uploaded.length}/${required.length} docs`}
      </span>
    </Tooltip>
  );
}

/**
 * DocumentGateBanner — Full-width version used above a form or action button.
 * Shown when a stage/phase cannot advance because documents are missing.
 */
export function DocumentGateBanner({
  docs,
  required,
  stageName,
}: {
  docs: Array<{ category: string }>;
  required: string[];
  stageName: string;
}) {
  if (!required.length) return null;

  const uploadedCats = new Set(docs.map((d) => d.category));
  const missing      = required.filter((r) => !uploadedCats.has(r));

  if (!missing.length) return null;

  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5 flex items-start gap-2">
      <FiAlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={14} />
      <div className="text-xs">
        <p className="font-semibold text-amber-800">
          Required documents missing for {stageName}
        </p>
        <p className="text-amber-600 mt-0.5">
          Upload: {missing.map((m) => CAT_LABEL[m] ?? m).join(', ')}
        </p>
      </div>
    </div>
  );
}
