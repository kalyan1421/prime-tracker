-- R6: generalize the R27 Founder-approval gate from lease-only to polymorphic lease/sale.
-- A backfilled Sale (R4) carries the same "typed in from records nothing can regenerate"
-- risk a backfilled Lease does. Existing rows all have leaseId set and saleId null, so the
-- new CHECK holds immediately — no backfill needed.

ALTER TABLE "historical_record_deletions" ALTER COLUMN "leaseId" DROP NOT NULL;
ALTER TABLE "historical_record_deletions" ADD COLUMN "saleId" TEXT;

ALTER TABLE "historical_record_deletions"
    ADD CONSTRAINT "historical_record_deletions_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "historical_record_deletions_saleId_status_idx"
    ON "historical_record_deletions"("saleId", "status");

ALTER TABLE "historical_record_deletions"
    ADD CONSTRAINT "historical_record_deletion_target_xor"
    CHECK (
      ("leaseId" IS NOT NULL AND "saleId" IS NULL)
      OR ("leaseId" IS NULL AND "saleId" IS NOT NULL)
    );
