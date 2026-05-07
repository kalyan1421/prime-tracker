import React from 'react';
import { Chip } from '@heroui/react';

/**
 * Phase chip — used on both Project cards (project phase) and Building cards
 * (building-level phase). Same visual; same labels; same color mapping.
 *
 * Project.phase becomes a derived value (max of buildings.phase) — see
 * ProjectPhaseService — but the visual treatment is identical to a building's
 * own phase chip, on purpose.
 */

export type ProjectPhase =
  | 'PRE_DEVELOPMENT'
  | 'PERMITTING'
  | 'CONSTRUCTION'
  | 'LEASE_UP'
  | 'STABILIZED'
  | 'SOLD_REFI';

const PHASE_STYLE: Record<ProjectPhase, { label: string; className: string }> = {
  PRE_DEVELOPMENT: { label: 'Pre-Development', className: 'bg-purple-100 text-purple-700' },
  PERMITTING:      { label: 'Permitting',      className: 'bg-orange-100 text-orange-700' },
  CONSTRUCTION:    { label: 'Construction',    className: 'bg-blue-100 text-blue-700' },
  LEASE_UP:        { label: 'Lease-Up',        className: 'bg-teal-100 text-teal-700' },
  STABILIZED:      { label: 'Stabilized',      className: 'bg-green-100 text-green-700' },
  SOLD_REFI:       { label: 'Sold / Refi',     className: 'bg-cyan-100 text-cyan-700' },
};

/** Numeric ordering of phases — used to compute max(buildings.phase) → project phase. */
export const PHASE_ORDER: Record<ProjectPhase, number> = {
  PRE_DEVELOPMENT: 0,
  PERMITTING: 1,
  CONSTRUCTION: 2,
  LEASE_UP: 3,
  STABILIZED: 4,
  SOLD_REFI: 5,
};

export function PhaseChip({ phase, size = 'sm' }: { phase: ProjectPhase | string; size?: 'sm' | 'md' }) {
  const s = PHASE_STYLE[phase as ProjectPhase] ?? { label: phase, className: 'bg-gray-100 text-gray-700' };
  return (
    <Chip size={size} variant="flat" className={s.className}>
      {s.label}
    </Chip>
  );
}

/** Compute the max phase across an array (used by Project.phase derivation). */
export function maxPhase(phases: (ProjectPhase | string)[]): ProjectPhase {
  if (!phases.length) return 'PRE_DEVELOPMENT';
  let max: ProjectPhase = 'PRE_DEVELOPMENT';
  for (const p of phases) {
    if ((PHASE_ORDER[p as ProjectPhase] ?? -1) > PHASE_ORDER[max]) max = p as ProjectPhase;
  }
  return max;
}
