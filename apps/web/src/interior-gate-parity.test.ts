/**
 * The interior phase gates the UI shows must be the gates the API enforces.
 *
 * `apps/web` cannot import `@prime-tracker/shared` (the `deploy-web` CI job does not build
 * that package), so the gate rules are mirrored by hand on the web side. Hand-mirrored
 * rules drift, and this one already had: `InteriorDocumentsPanel` carried a third copy that
 * invented a DRAWING requirement the server never checked and hung the CITY_APPROVAL
 * document on HANDOVER when the server wants it to enter EXECUTION. The red "required"
 * dots pointed at the wrong paperwork in both directions, and nothing failed — the user
 * just uploaded the wrong document and stayed blocked.
 *
 * So: read the server's state machine as text and assert the web mirror agrees. A grep is
 * the cheapest thing that would have caught it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INTERIOR_PHASE_DOCS } from './components/DocumentGateChip';
import { INTERIOR_PHASES, SHELL_COMPLETE_PHASES } from './constants/interior';

const API_ROOT = join(__dirname, '..', '..', 'api', 'src', 'modules', 'interior');
const stateMachine = readFileSync(join(API_ROOT, 'interior-state-machine.ts'), 'utf8');
const service = readFileSync(join(API_ROOT, 'interior.service.ts'), 'utf8');

/** `PHASE_GATES` entries, as `{ PHASE: { requiredDocCategory?, requiresShellComplete } }`. */
function serverGates(): Record<string, { doc?: string; shell: boolean }> {
  const block = stateMachine.match(/const PHASE_GATES[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!block) throw new Error('PHASE_GATES not found — did the state machine move?');
  const out: Record<string, { doc?: string; shell: boolean }> = {};
  // The captured block ends at the final `},` with no trailing newline, so the last entry
  // needs an end-of-string alternative — without it HANDOVER parses as absent and every
  // assertion below passes for the wrong reason.
  for (const m of block[1].matchAll(/(\w+):\s*\{([\s\S]*?)\},?(?:\n|$)/g)) {
    const body = m[2];
    out[m[1]] = {
      doc: body.match(/requiredDocCategory:\s*'([A-Z_]+)'/)?.[1],
      shell: /requiresShellComplete:\s*true/.test(body),
    };
  }
  return out;
}

describe('interior phase gates: the web mirror matches the server', () => {
  const gates = serverGates();

  it('finds the server gates at all', () => {
    // If this fails the parse broke, and every assertion below is vacuously green.
    expect(Object.keys(gates).length).toBeGreaterThan(0);
    expect(gates.EXECUTION).toBeDefined();
    expect(gates.HANDOVER).toBeDefined();
  });

  it('requires exactly the documents the server requires, on the same phases', () => {
    const serverDocs: Record<string, string[]> = {};
    for (const [phase, g] of Object.entries(gates)) if (g.doc) serverDocs[phase] = [g.doc];
    expect(INTERIOR_PHASE_DOCS).toEqual(serverDocs);
  });

  it('never claims a document is required on a phase the server does not gate', () => {
    for (const phase of Object.keys(INTERIOR_PHASE_DOCS)) {
      expect(gates[phase]?.doc, `web requires a doc to enter ${phase}; the server does not`).toBeDefined();
    }
  });

  it('lists the phases in the server order', () => {
    const order = stateMachine
      .match(/INTERIOR_PHASE_ORDER[^=]*=\s*\[([\s\S]*?)\]/)![1]
      .match(/'([A-Z_]+)'/g)!
      .map((s) => s.replace(/'/g, ''));
    expect([...INTERIOR_PHASES]).toEqual(order);
  });

  it('agrees on which building phases count as shell-complete', () => {
    const serverPhases = service
      .match(/SHELL_COMPLETE_PHASES[^=]*=\s*\[([\s\S]*?)\]/)![1]
      .match(/'([A-Z_]+)'/g)!
      .map((s) => s.replace(/'/g, ''));
    expect([...SHELL_COMPLETE_PHASES]).toEqual(serverPhases);
  });
});
