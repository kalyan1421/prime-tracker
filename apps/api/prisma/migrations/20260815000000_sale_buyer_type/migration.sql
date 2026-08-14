-- S4 / T1 — a third-party sale must not destroy the tenancy.
--
-- Today every sale close unconditionally ends the sitting tenancy, hard-coded to
-- TENANT_BOUGHT: capAtTermination DELETES the remaining rent periods and voidAfter voids
-- the future invoices, while the tenant is still in occupation and still owes rent. That
-- is unrecoverable, and it is driven by an assumption the user was never asked to confirm.
--
-- Rejected: a boolean "endsLease" on "sales". Six months on nobody remembers what `false`
-- meant. Model the BUYER'S RELATIONSHIP to the tenancy and derive the side-effect from it,
-- so the column reads as a fact about the deal rather than as an instruction to the code.
--
-- Purely additive, and the default is the old behaviour: every existing row becomes
-- SITTING_TENANT, which is exactly what the code assumed about it anyway.
CREATE TYPE "SaleBuyerType" AS ENUM ('SITTING_TENANT', 'THIRD_PARTY');

ALTER TABLE "sales"
  ADD COLUMN "buyerType" "SaleBuyerType" NOT NULL DEFAULT 'SITTING_TENANT';

-- Why no new value on any lease enum: Lease.terminationReason is a plain TEXT column
-- validated against TERMINATION_REASONS in leases.service.ts, so the eleventh reason
-- (LEASE_TRANSFERRED_WITH_SALE — the tenancy left Prime's book rather than ending) needs
-- no schema change. Recorded here so the absence is not read as an omission.
