import type { DocCategory } from '@prisma/client';

/**
 * Document gates for the sales pipeline (S6 + D1).
 *
 * Client decisions 2026-08-14:
 *   - moving a sale to LOI Signed requires the LOI itself to be attached first;
 *   - moving to Under Contract, or to Closed, likewise requires the paperwork for that
 *     stage to already be on the sale.
 *
 * ── THIS FILE IS THE CANONICAL MAP ────────────────────────────────────────────────────
 * `apps/web/src/components/DocumentGateChip.tsx` carries a DISPLAY MIRROR of
 * SALE_STAGE_DOCS (same keys, same categories, as plain strings) so the pipeline board can
 * show the red/amber/green chip without a round-trip. It is a mirror, not the authority:
 * amend THIS map, then update that one to match. They are deliberately not shared through
 * @prime-tracker/shared — apps/web does not depend on that package and the deploy-web CI
 * job does not build it, so a cross-import would break the production deploy.
 * ──────────────────────────────────────────────────────────────────────────────────────
 *
 * Amending the requirements is a CONFIGURATION change: edit SALE_STAGE_DOCS below (an
 * empty array, or a deleted key, disables the gate for that stage) and mirror it in the
 * frontend file. No other code needs to change.
 */

/**
 * The forward pipeline, in order. CANCELLED is deliberately ABSENT: it is an exit, not a
 * rung, and cancelling a deal because the paperwork never arrived is precisely the moment
 * the paperwork is missing. Anything not on this list is ungated as a target.
 */
export const SALE_STAGE_ORDER: string[] = [
  'PROSPECT',
  'LOI_SIGNED',
  'UNDER_CONTRACT',
  'CLOSED',
];

/**
 * Stage → the document categories that must be attached to the sale before it may be
 * ENTERED.
 *
 * Every row is CLIENT-CONFIRMED (2026-08-14). LOI and Booking Agreement were confirmed
 * directly; the three-document CLOSED row — which had been an unconfirmed assumption
 * inherited from the frontend chip — was put to Prime explicitly and confirmed as written.
 * Sales genuinely cannot close a deal until all three are on file, and that is intended.
 *
 * To change any requirement: edit this map and mirror it in
 * `apps/web/src/components/DocumentGateChip.tsx`. That is the whole edit — the gate reads
 * from here, so nothing else needs touching.
 */
export const SALE_STAGE_DOCS: Record<string, DocCategory[]> = {
  LOI_SIGNED: ['LOI'],
  UNDER_CONTRACT: ['BOOKING_AGREEMENT'],
  CLOSED: ['DEED', 'NOC', 'POSSESSION_CERTIFICATE'], // client-confirmed 2026-08-14
};

/** Human-readable labels, so a refusal reads like English rather than like an enum. */
export const DOC_CATEGORY_LABEL: Record<string, string> = {
  LOI: 'LOI',
  BOOKING_AGREEMENT: 'Booking Agreement',
  DEED: 'Deed',
  NOC: 'NOC',
  POSSESSION_CERTIFICATE: 'Possession Certificate',
};

export const SALE_STAGE_LABEL: Record<string, string> = {
  PROSPECT: 'Prospect',
  LOI_SIGNED: 'LOI Signed',
  UNDER_CONTRACT: 'Under Contract',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

export function saleStageLabel(status: string): string {
  return SALE_STAGE_LABEL[status] ?? status;
}

export function docCategoryLabel(category: string): string {
  return DOC_CATEGORY_LABEL[category] ?? category;
}

/** Position in the forward pipeline; -1 for anything off it (CANCELLED, legacy values). */
export function saleStageIndex(status: string): number {
  return SALE_STAGE_ORDER.indexOf(status);
}

/**
 * The categories this particular transition must satisfy — CUMULATIVE OVER THE STAGES IT
 * CROSSES, not over the sale's whole history.
 *
 * Two things follow from that, both deliberate:
 *
 *  1. PROSPECT → CLOSED collects LOI_SIGNED's and UNDER_CONTRACT's documents as well as
 *     CLOSED's. A gate that can be walked around by skipping a stage is not a gate, and a
 *     deal that reached closing really did have an LOI and a booking agreement. For anyone
 *     moving one stage at a time this is a no-op — it only bites the skipper.
 *  2. The stage a sale is ALREADY IN is never re-charged. LOI_SIGNED → UNDER_CONTRACT asks
 *     for the Booking Agreement, never the LOI, because the sale is already past that rung.
 *     Otherwise every sale sitting in a stage from before this gate existed would be
 *     retroactively trapped there.
 *
 * Returns [] — i.e. ungated — for: no status change, backwards moves, CANCELLED and any
 * other off-pipeline target, and any target with no configured requirement.
 *
 * A sale coming from an off-pipeline status (CANCELLED, or a legacy value) has index -1,
 * so reviving it crosses every rung up to its target and owes all of their documents.
 */
export function requiredDocsForTransition(from: string, to: string): DocCategory[] {
  const toIdx = saleStageIndex(to);
  if (toIdx < 0) return []; // CANCELLED / unknown target — never gated
  const fromIdx = saleStageIndex(from);
  if (toIdx <= fromIdx) return []; // same stage, or moving backwards

  const required: DocCategory[] = [];
  for (let i = fromIdx + 1; i <= toIdx; i++) {
    for (const category of SALE_STAGE_DOCS[SALE_STAGE_ORDER[i]] ?? []) {
      if (!required.includes(category)) required.push(category);
    }
  }
  return required;
}

/** True when the transition crosses more than one rung (used to explain the extra docs). */
export function transitionSkipsStages(from: string, to: string): boolean {
  const toIdx = saleStageIndex(to);
  if (toIdx < 0) return false;
  return toIdx - saleStageIndex(from) > 1;
}
