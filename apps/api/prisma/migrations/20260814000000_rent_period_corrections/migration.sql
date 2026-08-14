-- R22 — corrections with provenance.
--
-- Past rent periods stay immutable by default. A correction moves the period AND records
-- what it moved from, so the number a tenant was billed is never silently rewritten.

CREATE TABLE "lease_rent_period_corrections" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "previousRent" DECIMAL(12,2) NOT NULL,
    "correctedRent" DECIMAL(12,2) NOT NULL,
    "previousStartDate" TIMESTAMP(3),
    "correctedStartDate" TIMESTAMP(3),
    "previousEndDate" TIMESTAMP(3),
    "correctedEndDate" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "invoicesFlagged" INTEGER NOT NULL DEFAULT 0,
    "correctedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lease_rent_period_corrections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lease_rent_period_corrections_leaseId_createdAt_idx"
    ON "lease_rent_period_corrections"("leaseId", "createdAt");
CREATE INDEX "lease_rent_period_corrections_periodId_idx"
    ON "lease_rent_period_corrections"("periodId");

-- A correction with nothing in the reason is exactly the silent rewrite this table exists
-- to prevent, so the emptiness check lives in the database and not only in the DTO.
ALTER TABLE "lease_rent_period_corrections"
    ADD CONSTRAINT "rent_correction_reason_not_blank" CHECK (btrim("reason") <> '');

-- The correction must actually change something. A row asserting "1500 -> 1500" with no
-- date movement is noise in the one place that has to stay readable.
ALTER TABLE "lease_rent_period_corrections"
    ADD CONSTRAINT "rent_correction_changes_something" CHECK (
        "previousRent" <> "correctedRent"
        OR "previousStartDate" IS DISTINCT FROM "correctedStartDate"
        OR "previousEndDate" IS DISTINCT FROM "correctedEndDate"
    );

ALTER TABLE "lease_rent_period_corrections"
    ADD CONSTRAINT "lease_rent_period_corrections_periodId_fkey"
    FOREIGN KEY ("periodId") REFERENCES "lease_rent_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lease_rent_period_corrections"
    ADD CONSTRAINT "lease_rent_period_corrections_leaseId_fkey"
    FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT, not SET NULL: a correction whose author cannot be named is not provenance.
ALTER TABLE "lease_rent_period_corrections"
    ADD CONSTRAINT "lease_rent_period_corrections_correctedById_fkey"
    FOREIGN KEY ("correctedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An invoice billed from a period that was later corrected is out of step with its own
-- schedule. It is flagged, never auto-adjusted: the invoice records what was actually
-- billed, and re-issue vs credit vs leave-it is a Finance decision.
ALTER TABLE "lease_rent_invoices" ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "lease_rent_invoices" ADD COLUMN "reviewReason" TEXT;
CREATE INDEX "lease_rent_invoices_needsReview_idx"
    ON "lease_rent_invoices"("needsReview") WHERE "needsReview" = true;
