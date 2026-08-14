-- R27 — Founder approval before a backfilled tenancy can be deleted.
--
-- Client decision 2026-08-12 (Q2, option b): Sales may create and edit historical
-- records; only a Founder may delete one. `unit:history:backfill` and
-- `unit:history:delete` were added when the backfill shipped, but nothing consumed the
-- second — this is what gives it teeth.
--
-- Why deletion needs a gate when creation does not: a backfilled tenancy carries a
-- complete rent ledger that a person typed in from records the system never witnessed.
-- Deleting it destroys data that cannot be regenerated. A live lease is different — its
-- schedule can always be rebuilt from its own terms.

-- Distinguishes "entered by hand after the fact" from "recorded as it happened".
-- Default false: every existing lease was recorded live.
ALTER TABLE "leases" ADD COLUMN "isHistorical" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "historical_record_deletions" (
    "id"            TEXT NOT NULL,
    "leaseId"       TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'PENDING',
    -- Mandatory, not nullable. Same rule as BudgetRevision: a destructive act with no
    -- stated reason is not auditable, and this one is irreversible.
    "reason"        TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById"   TEXT,
    "decidedAt"     TIMESTAMP(3),
    "decisionNote"  TEXT,

    CONSTRAINT "historical_record_deletions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "historical_record_deletions_leaseId_status_idx"
    ON "historical_record_deletions"("leaseId", "status");
CREATE INDEX "historical_record_deletions_status_requestedAt_idx"
    ON "historical_record_deletions"("status", "requestedAt");

ALTER TABLE "historical_record_deletions"
    ADD CONSTRAINT "historical_record_deletions_leaseId_fkey"
    FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT on the requester: a deletion request with no requester is an anonymous demand
-- to destroy data. Deactivate the user rather than deleting them.
ALTER TABLE "historical_record_deletions"
    ADD CONSTRAINT "historical_record_deletions_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SET NULL on the decider: losing who approved it is bad, but not a reason to block
-- removing a departed user.
ALTER TABLE "historical_record_deletions"
    ADD CONSTRAINT "historical_record_deletions_decidedById_fkey"
    FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A decision must record who made it and when — the same shape as
-- invoice_void_requires_voided_at. A row that says APPROVED with no approver is
-- indistinguishable from one approved by nobody.
ALTER TABLE "historical_record_deletions"
    ADD CONSTRAINT "historical_deletion_decision_has_decider"
    CHECK (
      "status" = 'PENDING'
      OR ("decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL)
    );
