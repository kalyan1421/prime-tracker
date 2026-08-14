import type { InteriorPhase, SnagStatus } from '@prisma/client';
import {
  INTERIOR_PHASE_ORDER,
  OPEN_SNAG_STATUSES,
  canTransition,
  getPhaseGate,
  isSnagOpen,
  isTerminalPhase,
  nextPhase,
  phaseIndex,
} from './interior-state-machine';

describe('interior-state-machine', () => {
  describe('phase order', () => {
    it('has the 7 phases in the client-confirmed order', () => {
      expect(INTERIOR_PHASE_ORDER).toEqual([
        'DESIGN',
        'CLIENT_APPROVAL',
        'CITY_APPROVAL',
        'PROCUREMENT',
        'EXECUTION',
        'SNAGGING',
        'HANDOVER',
      ]);
    });

    it('phaseIndex reflects ordering', () => {
      expect(phaseIndex('DESIGN')).toBe(0);
      expect(phaseIndex('HANDOVER')).toBe(6);
      expect(phaseIndex('EXECUTION')).toBeGreaterThan(phaseIndex('PROCUREMENT'));
    });
  });

  describe('nextPhase', () => {
    it('returns the immediate successor for each non-terminal phase', () => {
      expect(nextPhase('DESIGN')).toBe('CLIENT_APPROVAL');
      expect(nextPhase('CLIENT_APPROVAL')).toBe('CITY_APPROVAL');
      expect(nextPhase('CITY_APPROVAL')).toBe('PROCUREMENT');
      expect(nextPhase('PROCUREMENT')).toBe('EXECUTION');
      expect(nextPhase('EXECUTION')).toBe('SNAGGING');
      expect(nextPhase('SNAGGING')).toBe('HANDOVER');
    });

    it('returns null for the terminal phase', () => {
      expect(nextPhase('HANDOVER')).toBeNull();
    });
  });

  describe('canTransition (linear, forward-only by one)', () => {
    it('allows every legal single-step forward transition', () => {
      for (let i = 0; i < INTERIOR_PHASE_ORDER.length - 1; i++) {
        const from = INTERIOR_PHASE_ORDER[i];
        const to = INTERIOR_PHASE_ORDER[i + 1];
        expect(canTransition(from, to)).toBe(true);
      }
    });

    it('rejects skipping a phase', () => {
      expect(canTransition('DESIGN', 'CITY_APPROVAL')).toBe(false);
      expect(canTransition('CITY_APPROVAL', 'EXECUTION')).toBe(false);
    });

    it('rejects going backward', () => {
      expect(canTransition('EXECUTION', 'PROCUREMENT')).toBe(false);
      expect(canTransition('HANDOVER', 'SNAGGING')).toBe(false);
    });

    it('rejects staying in place', () => {
      expect(canTransition('DESIGN', 'DESIGN')).toBe(false);
    });

    it('rejects any transition out of the terminal phase', () => {
      const others = INTERIOR_PHASE_ORDER.filter((p) => p !== 'HANDOVER');
      for (const to of others) {
        expect(canTransition('HANDOVER', to)).toBe(false);
      }
    });
  });

  describe('soft parallel gate (requiresShellComplete)', () => {
    it('requires shell complete to enter PROCUREMENT and EXECUTION', () => {
      expect(getPhaseGate('PROCUREMENT').requiresShellComplete).toBe(true);
      expect(getPhaseGate('EXECUTION').requiresShellComplete).toBe(true);
    });

    it('does NOT gate the paperwork phases (they may overlap shell construction)', () => {
      const paperwork: InteriorPhase[] = ['DESIGN', 'CLIENT_APPROVAL', 'CITY_APPROVAL'];
      for (const phase of paperwork) {
        expect(getPhaseGate(phase).requiresShellComplete).toBe(false);
      }
    });

    it('does not require shell complete to enter SNAGGING or HANDOVER (already past execution)', () => {
      expect(getPhaseGate('SNAGGING').requiresShellComplete).toBe(false);
      expect(getPhaseGate('HANDOVER').requiresShellComplete).toBe(false);
    });
  });

  describe('document gates (requiredDocCategory)', () => {
    it('requires a CITY_APPROVAL document to enter EXECUTION', () => {
      expect(getPhaseGate('EXECUTION').requiredDocCategory).toBe('CITY_APPROVAL');
    });

    it('requires a HANDOVER_CERTIFICATE document to enter HANDOVER', () => {
      expect(getPhaseGate('HANDOVER').requiredDocCategory).toBe('HANDOVER_CERTIFICATE');
    });

    it('does not require a document for phases without a gate', () => {
      expect(getPhaseGate('DESIGN').requiredDocCategory).toBeUndefined();
      expect(getPhaseGate('PROCUREMENT').requiredDocCategory).toBeUndefined();
      expect(getPhaseGate('SNAGGING').requiredDocCategory).toBeUndefined();
    });
  });

  describe('snag gate (requiresSnagsClear)', () => {
    it('requires a clear punch list to enter HANDOVER', () => {
      expect(getPhaseGate('HANDOVER').requiresSnagsClear).toBe(true);
    });

    it('gates no other phase on snags — snags are raised DURING SNAGGING', () => {
      for (const p of INTERIOR_PHASE_ORDER.filter((x) => x !== 'HANDOVER')) {
        expect(getPhaseGate(p).requiresSnagsClear).toBeFalsy();
      }
    });
  });

  describe('what counts as an OPEN snag', () => {
    it('is OPEN and IN_PROGRESS — everything except RESOLVED', () => {
      expect(OPEN_SNAG_STATUSES).toEqual(['OPEN', 'IN_PROGRESS']);
    });

    it('isSnagOpen agrees, and RESOLVED is the only closed status', () => {
      const all: SnagStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];
      expect(all.filter(isSnagOpen)).toEqual(['OPEN', 'IN_PROGRESS']);
      expect(isSnagOpen('RESOLVED')).toBe(false);
    });
  });

  describe('isTerminalPhase', () => {
    it('only HANDOVER is terminal', () => {
      expect(isTerminalPhase('HANDOVER')).toBe(true);
      for (const p of INTERIOR_PHASE_ORDER.filter((x) => x !== 'HANDOVER')) {
        expect(isTerminalPhase(p)).toBe(false);
      }
    });
  });
});
