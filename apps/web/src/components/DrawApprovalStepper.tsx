import React from 'react';
import { Avatar, Chip, Tooltip } from '@heroui/react';
import { FiCheck, FiX, FiClock, FiCornerUpLeft } from 'react-icons/fi';

/**
 * Vertical stepper showing the approval chain of a draw request.
 *
 *  ●  Internal Founder approval         Mallik · 2 days ago
 *  │  "Approved with minor scope notes"
 *  ●  Internal Finance review           Sarah · 1 day ago
 *  │  "Looks good, forwarded to lender"
 *  ●  Submitted to lender               Sarah · 1 day ago
 *  │
 *  ○  Lender funded                     Pending
 *
 * Each step has: actor avatar + name, action (approved/rejected/returned),
 * timestamp, optional comment. Filled circle = step happened, hollow = pending.
 */

export interface DrawApprovalStep {
  id: string;
  step: 'INTERNAL_FOUNDER' | 'INTERNAL_FINANCE' | 'LENDER_SUBMITTED' | 'LENDER_FUNDED';
  action: 'APPROVED' | 'REJECTED' | 'RETURNED_FOR_INFO';
  actor?: { id: string; name: string; email?: string };
  comment?: string | null;
  createdAt: string;
}

const STEP_LABELS: Record<DrawApprovalStep['step'], string> = {
  INTERNAL_FOUNDER: 'Internal — Founder approval',
  INTERNAL_FINANCE: 'Internal — Finance review',
  LENDER_SUBMITTED: 'Submitted to lender',
  LENDER_FUNDED: 'Lender funded',
};

const STEP_ORDER: DrawApprovalStep['step'][] = [
  'INTERNAL_FOUNDER',
  'INTERNAL_FINANCE',
  'LENDER_SUBMITTED',
  'LENDER_FUNDED',
];

const ACTION_STYLES: Record<DrawApprovalStep['action'], { className: string; Icon: typeof FiCheck; label: string }> = {
  APPROVED:          { className: 'bg-green-100 text-green-700 border-green-300', Icon: FiCheck,         label: 'Approved' },
  REJECTED:          { className: 'bg-red-100 text-red-700 border-red-300',       Icon: FiX,             label: 'Rejected' },
  RETURNED_FOR_INFO: { className: 'bg-amber-100 text-amber-700 border-amber-300', Icon: FiCornerUpLeft,  label: 'Returned' },
};

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return day === 1 ? 'yesterday' : `${day}d ago`;
}

export function DrawApprovalStepper({
  approvals,
  className = '',
}: {
  approvals: DrawApprovalStep[];
  className?: string;
}) {
  // Map for fast lookup of the latest approval per step
  const latestByStep = new Map<DrawApprovalStep['step'], DrawApprovalStep>();
  for (const a of approvals) {
    const existing = latestByStep.get(a.step);
    if (!existing || new Date(a.createdAt) > new Date(existing.createdAt)) {
      latestByStep.set(a.step, a);
    }
  }

  return (
    <ol className={`space-y-0 ${className}`} aria-label="Draw approval chain">
      {STEP_ORDER.map((step, i) => {
        const evt = latestByStep.get(step);
        const isComplete = !!evt;
        const isLast = i === STEP_ORDER.length - 1;
        const action = evt?.action ?? 'APPROVED';
        const style = ACTION_STYLES[action];
        const Icon = style.Icon;

        return (
          <li key={step} className="flex gap-3 relative">
            {/* Marker + connector line */}
            <div className="flex flex-col items-center shrink-0">
              <div
                className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs ${
                  isComplete
                    ? style.className
                    : 'bg-white border-gray-300 text-gray-300'
                }`}
                aria-hidden
              >
                {isComplete ? <Icon size={14} /> : <FiClock size={12} />}
              </div>
              {!isLast && (
                <div className={`flex-1 w-px ${isComplete ? 'bg-gray-300' : 'bg-gray-200 border-l border-dashed border-gray-300'}`} style={{ minHeight: 28 }} />
              )}
            </div>

            {/* Body */}
            <div className="flex-1 min-w-0 pb-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-sm font-medium ${isComplete ? 'text-gray-800' : 'text-gray-500'}`}>
                  {STEP_LABELS[step]}
                </span>
                {isComplete && action !== 'APPROVED' && (
                  <Chip size="sm" variant="flat" className={style.className}>{style.label}</Chip>
                )}
              </div>

              {evt ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {evt.actor && (
                    <Tooltip content={evt.actor.email || ''}>
                      <span className="flex items-center gap-1.5 text-xs text-gray-600">
                        <Avatar size="sm" name={evt.actor.name} className="w-5 h-5 text-[11px]" />
                        <span>{evt.actor.name}</span>
                      </span>
                    </Tooltip>
                  )}
                  <span className="text-xs text-gray-500">· {fmtRelative(evt.createdAt)}</span>
                </div>
              ) : (
                <p className="text-xs text-gray-500 mt-1">Pending</p>
              )}

              {evt?.comment && (
                <p className="mt-1.5 text-xs text-gray-600 bg-gray-50 rounded px-2 py-1 border border-gray-100 whitespace-pre-wrap">
                  {evt.comment}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
