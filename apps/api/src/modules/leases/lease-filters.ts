import { Prisma } from '@prisma/client';

/**
 * Excludes leases whose unit has been SOLD.
 *
 * Selling a unit does not delete its lease — the tenant history stays visible and the
 * Unit Detail page already hides the Active Lease card for a SOLD unit. But the money
 * side kept treating those leases as live: rent invoices were generated daily, the rent
 * roll and the cash-flow forecast counted the rent, and the rent/lease crons kept
 * chasing it. Prime does not collect rent on a unit it has sold, under any reading of
 * the sale (whether the lease ended or transferred to the buyer), so every revenue and
 * dunning path filters on this.
 *
 * Deliberately expressed as `NOT` on the relation rather than a status list, so it
 * composes with the `OR` clauses those queries already use for project scoping and for
 * the unit-XOR-building polymorphism.
 *
 * Building-level leases (unitId null) are NOT excluded: `unit` is null, so the inner
 * condition cannot match and NOT lets the row through. Buildings have a phase, not a
 * sold status — a building-level lease is unaffected by this rule.
 *
 * This is a reporting/billing filter only. It never mutates the lease, so a unit whose
 * status is corrected back from SOLD immediately resumes billing.
 */
export const NOT_ON_SOLD_UNIT: Prisma.LeaseWhereInput = {
  NOT: { unit: { status: 'SOLD' } },
};

/** The same rule for queries rooted at a child of Lease (invoices, periods, obligations). */
export const LEASE_NOT_ON_SOLD_UNIT = { lease: NOT_ON_SOLD_UNIT } as const;
