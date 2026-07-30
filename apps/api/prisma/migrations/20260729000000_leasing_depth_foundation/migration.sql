-- Leasing depth foundation (L0 + L1 + L2 schema).
--
-- L0: building LLC label, tenant email/phone. (The DRAW_FUNDING_OVERDUE enum value
--     ships in its own migration — ALTER TYPE ADD VALUE must not share a transaction.)
-- L1: lease_rent_periods — one timeline serving as escalation schedule, rent history
--     and free-rent abatement (see schema.prisma comments for the rules).
-- L2: lease_obligations / lease_obligation_payments — shared by security deposit
--     (tenant -> Prime) and TI allowance (Prime -> tenant, fixed amount, phased).
--
-- All additive: every column is nullable or defaulted, so existing rows are untouched
-- and no backfill is required.

-- ---- L0 ----

ALTER TABLE "buildings" ADD COLUMN "llcName" TEXT;

ALTER TABLE "leases" ADD COLUMN "tenantEmail" TEXT;
ALTER TABLE "leases" ADD COLUMN "tenantPhone" TEXT;
ALTER TABLE "leases" ADD COLUMN "freeRentMonths" INTEGER;
ALTER TABLE "leases" ADD COLUMN "freeRentStartDate" TIMESTAMP(3);

-- ---- L1: rent timeline ----

CREATE TABLE "lease_rent_periods" (
    "id" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "baseRent" DECIMAL(12,2) NOT NULL,
    "nnnAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "monthlyRent" DECIMAL(12,2) NOT NULL,
    "isFreeRent" BOOLEAN NOT NULL DEFAULT false,
    "escalationPct" DECIMAL(5,2),
    "source" TEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lease_rent_periods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lease_rent_periods_leaseId_sequence_key" ON "lease_rent_periods"("leaseId", "sequence");
CREATE INDEX "lease_rent_periods_leaseId_startDate_idx" ON "lease_rent_periods"("leaseId", "startDate");

ALTER TABLE "lease_rent_periods" ADD CONSTRAINT "lease_rent_periods_leaseId_fkey"
    FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lease_rent_periods" ADD CONSTRAINT "lease_rent_periods_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---- L2: deposit + TI ledger ----

CREATE TABLE "lease_obligations" (
    "id" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lease_obligations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lease_obligations_leaseId_kind_idx" ON "lease_obligations"("leaseId", "kind");
CREATE INDEX "lease_obligations_status_dueDate_idx" ON "lease_obligations"("status", "dueDate");

ALTER TABLE "lease_obligations" ADD CONSTRAINT "lease_obligations_leaseId_fkey"
    FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "lease_obligation_payments" (
    "id" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "documentId" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lease_obligation_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lease_obligation_payments_obligationId_idx" ON "lease_obligation_payments"("obligationId");

ALTER TABLE "lease_obligation_payments" ADD CONSTRAINT "lease_obligation_payments_obligationId_fkey"
    FOREIGN KEY ("obligationId") REFERENCES "lease_obligations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lease_obligation_payments" ADD CONSTRAINT "lease_obligation_payments_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
