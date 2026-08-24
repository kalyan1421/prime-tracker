-- R7: broker commission paid in installments, not one lump sum.
--
-- Lease.brokerCommissionAmt / Sale.brokerCommissionAmt stay the TOTAL contracted
-- commission. This table records how much of it has actually moved, and when — a genuine
-- gap in the live model (not just historical import) surfaced by Prime's own rent-roll
-- spreadsheet, which routinely shows a "1st Commission paid" and a separate "2nd
-- Commission" per lease.

-- CreateTable
CREATE TABLE "commission_installments" (
    "id" TEXT NOT NULL,
    "leaseId" TEXT,
    "saleId" TEXT,
    "brokerId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_installments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "commission_installments" ADD CONSTRAINT "commission_installments_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_installments" ADD CONSTRAINT "commission_installments_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_installments" ADD CONSTRAINT "commission_installments_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "brokers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "commission_installments_leaseId_idx" ON "commission_installments"("leaseId");
CREATE INDEX "commission_installments_saleId_idx" ON "commission_installments"("saleId");
CREATE INDEX "commission_installments_brokerId_paidAt_idx" ON "commission_installments"("brokerId", "paidAt");

-- Exactly one of (leaseId, saleId) — brand new table, so unlike Sale's unit/building split
-- there is no pre-existing data the DB needs to tolerate both-null for.
ALTER TABLE "commission_installments"
    ADD CONSTRAINT "commission_installment_target_xor" CHECK (
        ("leaseId" IS NOT NULL AND "saleId" IS NULL) OR ("leaseId" IS NULL AND "saleId" IS NOT NULL)
    );

-- Backfill: every existing single-payment commission becomes installment #1, so nothing
-- already stamped or already paid is lost when the report switches to summing this table.
INSERT INTO "commission_installments" ("id", "leaseId", "brokerId", "sequence", "amount", "paidAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", "brokerId", 1, "brokerCommissionAmt", "brokerCommissionPaidAt", now(), now()
FROM "leases"
WHERE "brokerId" IS NOT NULL AND "brokerCommissionAmt" IS NOT NULL;

INSERT INTO "commission_installments" ("id", "saleId", "brokerId", "sequence", "amount", "paidAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", "brokerId", 1, "brokerCommissionAmt", "brokerCommissionPaidAt", now(), now()
FROM "sales"
WHERE "brokerId" IS NOT NULL AND "brokerCommissionAmt" IS NOT NULL;
