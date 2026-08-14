-- R23 — leasing commission.
--
-- Broker attribution and commission already existed on Sale and Lead but not on Lease,
-- so there was nowhere to record who brought a tenant or what they were paid. The
-- client reported this as "not able to edit commission"; the field genuinely did not
-- exist.
--
-- Field names and semantics mirror `sales` deliberately, so the broker report can sum
-- the two sides without a translation layer.
--
-- `brokerCommissionBasis` has no counterpart on Sale. A sale has one obvious base (the
-- price); a lease does not — first month's rent, a percentage of total term rent, and a
-- flat fee are all normal, and Prime has not yet confirmed which they use (open
-- question Q12). Recording it per lease means that answer is data entry rather than a
-- migration, and an unanswered basis simply leaves the amount uncomputed instead of
-- silently stamping a guess.
--
-- All columns nullable, no backfill: every existing lease predates broker attribution
-- and there is nothing truthful to populate.

ALTER TABLE "leases" ADD COLUMN "brokerId"               TEXT;
ALTER TABLE "leases" ADD COLUMN "brokerCommissionPct"    DECIMAL(5,2);
ALTER TABLE "leases" ADD COLUMN "brokerCommissionAmt"    DECIMAL(14,2);
ALTER TABLE "leases" ADD COLUMN "brokerCommissionBasis"  TEXT;
ALTER TABLE "leases" ADD COLUMN "brokerCommissionPaidAt" TIMESTAMP(3);

-- SetNull, matching sales.brokerId: removing a broker from the master list must not
-- delete the lease, and the commission figures already stamped on it stay meaningful.
ALTER TABLE "leases"
  ADD CONSTRAINT "leases_brokerId_fkey"
  FOREIGN KEY ("brokerId") REFERENCES "brokers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "leases_brokerId_idx" ON "leases"("brokerId");

-- Only the three known bases. A typo here would produce a lease whose commission can
-- never be computed, with nothing to indicate why.
ALTER TABLE "leases"
  ADD CONSTRAINT "lease_broker_commission_basis_valid"
  CHECK ("brokerCommissionBasis" IS NULL
         OR "brokerCommissionBasis" IN ('FIRST_MONTH_RENT', 'TOTAL_TERM_RENT', 'FLAT'));
