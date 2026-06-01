-- Broker / referral tracking (Phase 4) — additive only.

-- CreateTable
CREATE TABLE "brokers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "commissionRate" DECIMAL(5,2),
    "commissionFlat" DECIMAL(14,2),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "brokers_pkey" PRIMARY KEY ("id")
);

-- AlterTable: sale broker attribution + commission
ALTER TABLE "sales" ADD COLUMN "brokerId" TEXT;
ALTER TABLE "sales" ADD COLUMN "brokerCommissionPct" DECIMAL(5,2);
ALTER TABLE "sales" ADD COLUMN "brokerCommissionAmt" DECIMAL(14,2);

-- AlterTable: lead broker attribution
ALTER TABLE "leads" ADD COLUMN "brokerId" TEXT;

-- CreateIndex
CREATE INDEX "brokers_isActive_deletedAt_idx" ON "brokers"("isActive", "deletedAt");
CREATE INDEX "sales_brokerId_idx" ON "sales"("brokerId");
CREATE INDEX "leads_brokerId_idx" ON "leads"("brokerId");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "brokers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "brokers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
