import type { DocCategory, InteriorPhase, SnagStatus } from '@prisma/client';

/**
 * Interior / Fit-Out lifecycle as a single source of truth.
 *
 *   DESIGN → CLIENT_APPROVAL → CITY_APPROVAL ┊ PROCUREMENT → EXECUTION → SNAGGING → HANDOVER
 *                                            ┊
 *   ── phases left of ┊ may overlap the tail of shell construction.
 *   ── phases right of ┊ (PROCUREMENT, EXECUTION) require the unit's shell to be complete
 *      (the "no parallel work" soft gate — INTERIOR_MODULE_DESIGN §0.2).
 *
 * Document gates (INTERIOR_MODULE_DESIGN §0.3):
 *   - entering EXECUTION requires a CITY_APPROVAL document on the interior project.
 *   - entering HANDOVER requires a HANDOVER_CERTIFICATE document.
 *
 * Snag gate (client decision 2026-08-14, "handover blocked while any punch-list item
 * is still open"):
 *   - entering HANDOVER requires every snag closed. Unlike the document gates this one
 *     is overridable with a recorded reason — see InteriorService.advancePhase.
 *
 * Transitions are linear and forward-only by one step. Cancellation/hold are status
 * changes (InteriorStatus), not phase moves, and are handled by the service.
 */
export const INTERIOR_PHASE_ORDER: InteriorPhase[] = [
  'DESIGN',
  'CLIENT_APPROVAL',
  'CITY_APPROVAL',
  'PROCUREMENT',
  'EXECUTION',
  'SNAGGING',
  'HANDOVER',
];

export interface PhaseGate {
  /** Target phase requires the anchor unit/building shell phase to be complete. */
  requiresShellComplete: boolean;
  /** Document category that must be on file before entering this phase (if any). */
  requiredDocCategory?: DocCategory;
  /**
   * Target phase requires every punch-list (snag) item to be closed.
   * Overridable by an explicit force + recorded reason (the document gates are not).
   */
  requiresSnagsClear?: boolean;
}

/** Gate requirements keyed by the phase being entered. */
const PHASE_GATES: Partial<Record<InteriorPhase, PhaseGate>> = {
  PROCUREMENT: { requiresShellComplete: true },
  EXECUTION: { requiresShellComplete: true, requiredDocCategory: 'CITY_APPROVAL' },
  HANDOVER: {
    requiresShellComplete: false,
    requiredDocCategory: 'HANDOVER_CERTIFICATE',
    requiresSnagsClear: true,
  },
};

/**
 * Snag statuses that count as STILL OPEN for the handover gate — i.e. everything
 * except RESOLVED. IN_PROGRESS is deliberately included: work started is not work
 * finished, and a snag someone is mid-way through fixing is precisely the kind of
 * defect the client wants caught before the unit changes hands.
 */
export const OPEN_SNAG_STATUSES: SnagStatus[] = ['OPEN', 'IN_PROGRESS'];

export function isSnagOpen(status: SnagStatus): boolean {
  return OPEN_SNAG_STATUSES.includes(status);
}

export function phaseIndex(phase: InteriorPhase): number {
  return INTERIOR_PHASE_ORDER.indexOf(phase);
}

/** The phase immediately after `phase`, or null if `phase` is terminal (HANDOVER). */
export function nextPhase(phase: InteriorPhase): InteriorPhase | null {
  const i = phaseIndex(phase);
  if (i < 0 || i >= INTERIOR_PHASE_ORDER.length - 1) return null;
  return INTERIOR_PHASE_ORDER[i + 1];
}

/**
 * A transition is legal only when `to` is the immediate next phase after `from`.
 * (Linear, forward-only. No skipping, no going backward.)
 */
export function canTransition(from: InteriorPhase, to: InteriorPhase): boolean {
  return nextPhase(from) === to;
}

/** Gate requirements for entering `to`. Returns a no-op gate when none apply. */
export function getPhaseGate(to: InteriorPhase): PhaseGate {
  return PHASE_GATES[to] ?? { requiresShellComplete: false };
}

export function isTerminalPhase(phase: InteriorPhase): boolean {
  return phase === 'HANDOVER';
}
