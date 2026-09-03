export const INTERIOR_PHASES = [
  'DESIGN', 'CLIENT_APPROVAL', 'CITY_APPROVAL', 'PROCUREMENT', 'EXECUTION', 'SNAGGING', 'HANDOVER',
] as const;

export type InteriorPhase = typeof INTERIOR_PHASES[number];

/**
 * Building phases that count as "shell complete" for the fit-out gate — mirrors
 * SHELL_COMPLETE_PHASES in `apps/api/src/modules/interior/interior.service.ts`, which is
 * what actually enforces it. Duplicated rather than imported for the same reason as the
 * document gates: `apps/web` has no dependency on `@prime-tracker/shared` and the
 * `deploy-web` CI job does not build that package. Change both together.
 */
export const SHELL_COMPLETE_PHASES = ['LEASE_UP', 'STABILIZED', 'SOLD_REFI'] as const;

/** Phase of the building a fit-out is anchored to, whether that anchor is direct or via a unit. */
export function anchorBuildingPhase(p: {
  building?: { phase?: string } | null;
  unit?: { building?: { phase?: string } | null } | null;
}): string | undefined {
  return p.building?.phase ?? p.unit?.building?.phase;
}

export function isShellComplete(p: Parameters<typeof anchorBuildingPhase>[0]): boolean {
  const phase = anchorBuildingPhase(p);
  return !!phase && (SHELL_COMPLETE_PHASES as readonly string[]).includes(phase);
}
