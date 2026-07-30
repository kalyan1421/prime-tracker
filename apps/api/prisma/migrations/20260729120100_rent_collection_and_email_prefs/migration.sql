-- L2b rent collection ledger + L3 email-vs-in-app preference split.
--
-- All additive and nullable/defaulted: existing rows are untouched, no backfill.

-- Per-lease rent due day (client answer: leases genuinely differ — 1st, 5th, 10th).
-- Null means the 1st.
ALTER TABLE "leases" ADD COLUMN "rentDueDay" INTEGER;

-- Nullable on purpose: null = "use this notification type's tier default"
-- (action-needed types email, FYI types are in-app only). An explicit true/false is
-- a deliberate per-user override. A NOT NULL default would have silently opted every
-- existing user into or out of email.
ALTER TABLE "notification_preferences" ADD COLUMN "emailEnabled" BOOLEAN;

CREATE TABLE "lease_rent_invoices" (
    "id" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "periodId" TEXT,
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amountDue" DECIMAL(12,2) NOT NULL,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isProrated" BOOLEAN NOT NULL DEFAULT false,
    "billedDays" INTEGER,
    "monthDays" INTEGER,
    "paidAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DUE',
    "method" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lease_rent_invoices_pkey" PRIMARY KEY ("id")
);

-- Makes generation idempotent so the monthly cron can re-run safely.
CREATE UNIQUE INDEX "lease_rent_invoices_leaseId_periodMonth_key" ON "lease_rent_invoices"("leaseId", "periodMonth");
CREATE INDEX "lease_rent_invoices_leaseId_periodMonth_idx" ON "lease_rent_invoices"("leaseId", "periodMonth");
CREATE INDEX "lease_rent_invoices_status_dueDate_idx" ON "lease_rent_invoices"("status", "dueDate");

ALTER TABLE "lease_rent_invoices" ADD CONSTRAINT "lease_rent_invoices_leaseId_fkey"
    FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lease_rent_invoices" ADD CONSTRAINT "lease_rent_invoices_periodId_fkey"
    FOREIGN KEY ("periodId") REFERENCES "lease_rent_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lease_rent_invoices" ADD CONSTRAINT "lease_rent_invoices_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
