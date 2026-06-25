export const INTERIOR_PHASES = [
  'DESIGN', 'CLIENT_APPROVAL', 'CITY_APPROVAL', 'PROCUREMENT', 'EXECUTION', 'SNAGGING', 'HANDOVER',
] as const;

export type InteriorPhase = typeof INTERIOR_PHASES[number];
