-- T1 — Tenancy transition foundation.
--
-- A unit moving "from one lease to another" is four different events that are
-- indistinguishable in the schema today:
--
--   turnover    lease ends, unrelated tenant follows          occupancy breaks
--   renewal     lease ends, SAME tenant re-papers             occupancy continuous
--   relocation  lease ends, SAME tenant, DIFFERENT unit       occupancy continuous
--   assignment  lease SURVIVES, tenant party changes          occupancy continuous
--
-- The first three end a lease and start another, so they share termination metadata
-- plus an optional successor link. The fourth does not end anything — the contract
-- and its whole ledger continue — so it gets its own table.
--
-- Hand-written rather than `prisma migrate dev`-generated: step 3 rebuilds an
-- exclusion constraint over an expression, and steps 2 and 6 are CHECK constraints.
-- Prisma can express none of those.

-- ---------------------------------------------------------------------------
-- 1. Termination metadata + succession link on leases
--
-- terminationDate is the date occupancy ACTUALLY ended. leaseEnd is left alone: it
-- stays the CONTRACTED expiry, because effective-rent straight-lining and
-- brokerCommissionBasis = TOTAL_TERM_RENT are both computed from the signed term.
-- Truncating leaseEnd on an early exit would silently restate a commission that may
-- already have been paid out. The gap between the two IS the early-termination
-- exposure and is worth being able to report on.
-- ---------------------------------------------------------------------------

ALTER TABLE "leases"
    ADD COLUMN "terminationDate"   TIMESTAMP(3),
    ADD COLUMN "terminationReason" TEXT,
    ADD COLUMN "terminationNote"   TEXT,
    ADD COLUMN "successorLeaseId"  TEXT;

-- Nullable unique: Postgres does not treat NULLs as equal, so any number of leases
-- may have no successor while no two can claim the same one.
CREATE UNIQUE INDEX "leases_successorLeaseId_key" ON "leases"("successorLeaseId");

ALTER TABLE "leases"
    ADD CONSTRAINT "leases_successorLeaseId_fkey"
    FOREIGN KEY ("successorLeaseId") REFERENCES "leases"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Reporting reads this to find early exits; the constraint rebuild below reads it per row.
CREATE INDEX "leases_terminationDate_idx" ON "leases"("terminationDate");

-- ---------------------------------------------------------------------------
-- 2. terminationDate cannot precede the start of the lease
--
-- No UPPER bound on purpose. Occupancy PAST leaseEnd (holdover) is real, common, and
-- must be recordable — bounding this at leaseEnd would force holdover to be entered
-- as a lie.
-- ---------------------------------------------------------------------------

ALTER TABLE "leases"
    ADD CONSTRAINT "lease_termination_after_start"
    CHECK ("terminationDate" IS NULL OR "terminationDate" >= "leaseStart");

-- ---------------------------------------------------------------------------
-- 3. Rebuild lease_unit_no_overlap over the OCCUPIED range
--
-- This is the blocking defect this migration exists to fix.
--
-- The constraint added in 20260812000000 ranges over daterange(leaseStart, leaseEnd).
-- A lease terminated early still carries its contracted leaseEnd, so the successor
-- lease collides with a tenancy that ended months ago and is REFUSED — precisely the
-- failure mode that `lease_unit_active_unique` was replaced to fix, reintroduced
-- through a different door.
--
-- The occupied range ends at COALESCE(terminationDate, leaseEnd): the unit is free
-- from the move-out date, even though the contract still says what it said.
--
-- '[)' bounds are preserved — inclusive start, exclusive end — so same-day turnover
-- stays legal: A ending 2025-06-30 and B starting 2025-06-30 do not collide.
--
-- Safe to rebuild in place: terminationDate is NULL on every existing row, so
-- COALESCE(terminationDate, leaseEnd) = leaseEnd and the new constraint is exactly
-- the old one over current data. It cannot reject anything the old one accepted.
-- ---------------------------------------------------------------------------

ALTER TABLE "leases" DROP CONSTRAINT "lease_unit_no_overlap";

ALTER TABLE "leases"
    ADD CONSTRAINT "lease_unit_no_overlap"
    EXCLUDE USING gist (
        "unitId" WITH =,
        daterange("leaseStart"::date, COALESCE("terminationDate", "leaseEnd")::date, '[)') WITH &&
    )
    WHERE ("unitId" IS NOT NULL AND "deletedAt" IS NULL);

-- ---------------------------------------------------------------------------
-- 4. Tenant assignment / novation
--
-- The lease document survives; only the party changes. Nothing else in this table's
-- vicinity moves: rent periods, invoices and obligations all continue against the
-- same leaseId, which is the entire point.
--
-- from* columns are a denormalised snapshot on purpose. The lease row only ever holds
-- the CURRENT tenant, so without a copy taken at assignment time the outgoing party's
-- name is simply gone — and "who was the tenant in March 2024" becomes unanswerable
-- for a ledger that was billed to them.
-- ---------------------------------------------------------------------------

CREATE TABLE "lease_tenant_assignments" (
    "id"                  TEXT NOT NULL,
    "leaseId"             TEXT NOT NULL,
    "effectiveDate"       TIMESTAMP(3) NOT NULL,
    "fromTenantName"      TEXT NOT NULL,
    "fromTenantLegalName" TEXT,
    "toTenantName"        TEXT NOT NULL,
    "toTenantLegalName"   TEXT,
    "toTenantContact"     TEXT,
    "toTenantEmail"       TEXT,
    "toTenantPhone"       TEXT,
    "reason"              TEXT,
    "note"                TEXT,
    "documentId"          TEXT,
    "recordedById"        TEXT,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lease_tenant_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lease_tenant_assignments_leaseId_effectiveDate_idx"
    ON "lease_tenant_assignments"("leaseId", "effectiveDate");

ALTER TABLE "lease_tenant_assignments"
    ADD CONSTRAINT "lease_tenant_assignments_leaseId_fkey"
    FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lease_tenant_assignments"
    ADD CONSTRAINT "lease_tenant_assignments_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SET NULL, not CASCADE: deleting the user who recorded an assignment must not delete
-- the record that the tenant changed. Same rule as unit_status_events.recordedById.
ALTER TABLE "lease_tenant_assignments"
    ADD CONSTRAINT "lease_tenant_assignments_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. Invoice VOID
--
-- VOID is a new status alongside DUE | PARTIAL | PAID | FREE | WAIVED, and is
-- deliberately NOT folded into WAIVED.
--
--   WAIVED = money that WAS owed and was forgiven. A concession. Finance's decision,
--            and it belongs in concession reporting.
--   VOID   = the tenancy had already ended; the month was never owed at all.
--
-- Collapsing them would put phantom concessions in the numbers, which is worse than
-- an extra status value.
--
-- Nothing is deleted. Generation is idempotent on (leaseId, periodMonth), so a
-- hard-deleted invoice would simply be regenerated by the next run; voiding is both
-- honest and the only thing that actually sticks.
-- ---------------------------------------------------------------------------

ALTER TABLE "lease_rent_invoices"
    ADD COLUMN "voidReason" TEXT,
    ADD COLUMN "voidedAt"   TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- 6. A VOID invoice must say when it was voided
--
-- Guards the "set status and forget the metadata" path. Without this, a VOID row with
-- no voidedAt is indistinguishable from one voided at an unknown time, and the AR
-- reports have no date to exclude it from.
-- ---------------------------------------------------------------------------

ALTER TABLE "lease_rent_invoices"
    ADD CONSTRAINT "invoice_void_requires_voided_at"
    CHECK ("status" <> 'VOID' OR "voidedAt" IS NOT NULL);
