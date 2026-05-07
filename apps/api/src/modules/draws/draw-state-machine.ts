import type { DrawStatus } from '@prisma/client';

/**
 * Draw Request lifecycle as a single source of truth.
 *
 *   DRAFT  ──submit──▶  SUBMITTED  ──approveInternal──▶  APPROVED
 *     ▲                     │                              │
 *     │                     │                              ├─ markFunded ──▶  FUNDED  (terminal)
 *     │                     │                              │
 *     │                  reject                         reject (rare; shouldn't happen post-approve)
 *     │                     ▼                              ▼
 *     │                  REJECTED ──revise──▶ DRAFT      REJECTED
 *     │
 *     └── cancel from any non-terminal state ──▶  CANCELLED  (terminal)
 *
 * Required documents are gated on transitions into APPROVED to ensure the
 * lender package is complete before we say it's approved.
 */
export type DrawAction =
  | 'submit'
  | 'approveInternal'
  | 'reject'
  | 'returnForInfo'
  | 'markFunded'
  | 'cancel'
  | 'revise';

interface Transition {
  to: DrawStatus;
  /** Human description for audit logs and error messages. */
  description: string;
  /** Required document types for this transition. Empty = none enforced. */
  requiredDocs?: string[];
}

export const DRAW_TRANSITIONS: Record<DrawStatus, Partial<Record<DrawAction, Transition>>> = {
  DRAFT: {
    submit: {
      to: 'SUBMITTED',
      description: 'Submitted for internal approval',
      requiredDocs: ['SWORN_STATEMENT', 'VENDOR_INVOICE'],
    },
    cancel: { to: 'CANCELLED', description: 'Cancelled while in draft' },
  },
  SUBMITTED: {
    approveInternal: {
      to: 'APPROVED',
      description: 'Internal approval — ready for lender submission',
      requiredDocs: ['LIEN_WAIVER', 'INSPECTION_REPORT', 'SWORN_STATEMENT', 'VENDOR_INVOICE'],
    },
    reject: { to: 'REJECTED', description: 'Rejected during review' },
    returnForInfo: { to: 'DRAFT', description: 'Returned for more info' },
    cancel: { to: 'CANCELLED', description: 'Cancelled before approval' },
  },
  APPROVED: {
    markFunded: { to: 'FUNDED', description: 'Lender wired funds' },
    reject: { to: 'REJECTED', description: 'Lender rejected after submission' },
    cancel: { to: 'CANCELLED', description: 'Cancelled before funding' },
  },
  FUNDED: {
    // Terminal — no transitions
  },
  REJECTED: {
    revise: { to: 'DRAFT', description: 'Revising for resubmission' },
  },
  CANCELLED: {
    // Terminal
  },
};

export function getTransition(from: DrawStatus, action: DrawAction): Transition | null {
  return DRAW_TRANSITIONS[from]?.[action] ?? null;
}

export function canTransition(from: DrawStatus, action: DrawAction): boolean {
  return getTransition(from, action) != null;
}
