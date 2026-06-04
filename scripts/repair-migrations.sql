-- ============================================================
-- Prime Tracker — Migration Repair Script
-- Applies all June 2 migration DDL with IF NOT EXISTS guards.
-- Safe to run multiple times (idempotent).
-- ============================================================

-- ── Migration 20260602120000: Interior + Sale Payments ───────

-- Enums (skip if already exist)
DO $$ BEGIN
  CREATE TYPE "InteriorPhase" AS ENUM ('DESIGN','CLIENT_APPROVAL','CITY_APPROVAL','PROCUREMENT','EXECUTION','SNAGGING','HANDOVER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "InteriorStatus" AS ENUM ('NOT_STARTED','IN_PROGRESS','ON_HOLD','COMPLETED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "InteriorContractType" AS ENUM ('PER_SQFT','FIXED','COST_PLUS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SnagStatus" AS ENUM ('OPEN','IN_PROGRESS','RESOLVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SalePaymentStatus" AS ENUM ('SCHEDULED','DUE','PARTIALLY_PAID','PAID','OVERDUE','WAIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SalePaymentTrigger" AS ENUM ('ON_SIGNING','ON_MILESTONE','FIXED_DATE','ON_HANDOVER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- DocCategory enum extensions
DO $$ BEGIN
  ALTER TYPE "DocCategory" ADD VALUE 'CITY_APPROVAL';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "DocCategory" ADD VALUE 'HANDOVER_CERTIFICATE';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- NotificationType enum extensions
DO $$ BEGIN
  ALTER TYPE "NotificationType" ADD VALUE 'INTERIOR_PHASE_CHANGED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "NotificationType" ADD VALUE 'INTERIOR_HANDOVER_DUE';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "NotificationType" ADD VALUE 'SALE_PAYMENT_OVERDUE';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "SalePaymentTrigger" ADD VALUE 'ON_SNAG_CLEAR';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- documents.interiorProjectId
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "interiorProjectId" TEXT;

-- interior_projects table
CREATE TABLE IF NOT EXISTS "interior_projects" (
  "id"               TEXT NOT NULL,
  "unitId"           TEXT,
  "buildingId"       TEXT,
  "saleId"           TEXT,
  "leaseId"          TEXT,
  "name"             TEXT NOT NULL,
  "status"           "InteriorStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "phase"            "InteriorPhase"  NOT NULL DEFAULT 'DESIGN',
  "contractType"     "InteriorContractType" NOT NULL DEFAULT 'PER_SQFT',
  "contractValue"    DECIMAL(14,2),
  "ratePerSqft"      DECIMAL(10,2),
  "area"             DECIMAL(10,2),
  "pmUserId"         TEXT,
  "startDate"        TIMESTAMP(3),
  "endDate"          TIMESTAMP(3),
  "handoverAt"       TIMESTAMP(3),
  "clientApprovedAt" TIMESTAMP(3),
  "cityApprovedAt"   TIMESTAMP(3),
  "notes"            TEXT,
  "deletedAt"        TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "interior_projects_pkey" PRIMARY KEY ("id")
);

-- interior_scope_items table
CREATE TABLE IF NOT EXISTS "interior_scope_items" (
  "id"                TEXT NOT NULL,
  "interiorProjectId" TEXT NOT NULL,
  "description"       TEXT NOT NULL,
  "category"          TEXT,
  "qty"               DECIMAL(10,2) NOT NULL DEFAULT 1,
  "unit"              TEXT NOT NULL DEFAULT 'ea',
  "unitPrice"         DECIMAL(14,2) NOT NULL,
  "total"             DECIMAL(14,2) NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "interior_scope_items_pkey" PRIMARY KEY ("id")
);

-- interior_invoices table
CREATE TABLE IF NOT EXISTS "interior_invoices" (
  "id"                TEXT NOT NULL,
  "interiorProjectId" TEXT NOT NULL,
  "vendorId"          TEXT,
  "vendor"            TEXT,
  "amount"            DECIMAL(14,2) NOT NULL,
  "invoiceDate"       TIMESTAMP(3),
  "notes"             TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "interior_invoices_pkey" PRIMARY KEY ("id")
);

-- snag_items table
CREATE TABLE IF NOT EXISTS "snag_items" (
  "id"                TEXT NOT NULL,
  "interiorProjectId" TEXT NOT NULL,
  "description"       TEXT NOT NULL,
  "room"              TEXT,
  "assignee"          TEXT,
  "status"            "SnagStatus" NOT NULL DEFAULT 'OPEN',
  "resolvedAt"        TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "snag_items_pkey" PRIMARY KEY ("id")
);

-- sale_payments table
CREATE TABLE IF NOT EXISTS "sale_payments" (
  "id"               TEXT NOT NULL,
  "saleId"           TEXT NOT NULL,
  "milestoneId"      TEXT,
  "label"            TEXT NOT NULL,
  "amount"           DECIMAL(14,2),
  "paidAmount"       DECIMAL(14,2) NOT NULL DEFAULT 0,
  "trigger"          "SalePaymentTrigger" NOT NULL DEFAULT 'FIXED_DATE',
  "dueDate"          TIMESTAMP(3),
  "effectiveDueDate" TIMESTAMP(3),
  "paidAt"           TIMESTAMP(3),
  "status"           "SalePaymentStatus" NOT NULL DEFAULT 'SCHEDULED',
  "notes"            TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);

-- Indexes for interior tables
CREATE INDEX IF NOT EXISTS "interior_projects_unitId_idx"         ON "interior_projects"("unitId");
CREATE INDEX IF NOT EXISTS "interior_projects_buildingId_idx"     ON "interior_projects"("buildingId");
CREATE INDEX IF NOT EXISTS "interior_projects_saleId_idx"         ON "interior_projects"("saleId");
CREATE INDEX IF NOT EXISTS "interior_projects_status_phase_idx"   ON "interior_projects"("status","phase");
CREATE INDEX IF NOT EXISTS "interior_projects_deletedAt_idx"      ON "interior_projects"("deletedAt");
CREATE INDEX IF NOT EXISTS "interior_scope_items_interiorProjectId_idx" ON "interior_scope_items"("interiorProjectId");
CREATE INDEX IF NOT EXISTS "interior_invoices_interiorProjectId_idx"    ON "interior_invoices"("interiorProjectId");
CREATE INDEX IF NOT EXISTS "snag_items_interiorProjectId_idx"     ON "snag_items"("interiorProjectId");
CREATE INDEX IF NOT EXISTS "sale_payments_saleId_idx"             ON "sale_payments"("saleId");

-- FKs (all wrapped in DO blocks — safe if constraint already exists)
DO $$ BEGIN
  ALTER TABLE "documents" ADD CONSTRAINT "documents_interiorProjectId_fkey"
    FOREIGN KEY ("interiorProjectId") REFERENCES "interior_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "interior_projects" ADD CONSTRAINT "interior_projects_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "interior_projects" ADD CONSTRAINT "interior_projects_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "interior_scope_items" ADD CONSTRAINT "interior_scope_items_interiorProjectId_fkey"
    FOREIGN KEY ("interiorProjectId") REFERENCES "interior_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "interior_invoices" ADD CONSTRAINT "interior_invoices_interiorProjectId_fkey"
    FOREIGN KEY ("interiorProjectId") REFERENCES "interior_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "snag_items" ADD CONSTRAINT "snag_items_interiorProjectId_fkey"
    FOREIGN KEY ("interiorProjectId") REFERENCES "interior_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Migration 20260602130000: Sale Discount Approval ─────────

ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "discountApprovedById" TEXT;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "discountApprovedAt"   TIMESTAMP(3);
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "discountApprovalThresholdPct" DECIMAL(5,2) NOT NULL DEFAULT 5;
CREATE INDEX IF NOT EXISTS "sales_discountApprovedById_idx" ON "sales"("discountApprovedById");

-- ── Migration 20260602140000: Daily Logs ─────────────────────

CREATE TABLE IF NOT EXISTS "daily_logs" (
  "id"         TEXT NOT NULL,
  "projectId"  TEXT NOT NULL,
  "buildingId" TEXT,
  "authorId"   TEXT NOT NULL,
  "logDate"    DATE NOT NULL,
  "notes"      TEXT,
  "weather"    TEXT,
  "crewCount"  INTEGER,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "daily_log_photos" (
  "id"          TEXT NOT NULL,
  "dailyLogId"  TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "caption"     TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_log_photos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "daily_logs_projectId_logDate_idx"  ON "daily_logs"("projectId","logDate");
CREATE INDEX IF NOT EXISTS "daily_logs_buildingId_idx"         ON "daily_logs"("buildingId");
CREATE INDEX IF NOT EXISTS "daily_log_photos_dailyLogId_idx"   ON "daily_log_photos"("dailyLogId");

-- ── Migration 20260602150000: Brokers ────────────────────────

CREATE TABLE IF NOT EXISTS "brokers" (
  "id"             TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "company"        TEXT,
  "contact"        TEXT,
  "email"          TEXT,
  "licenseNo"      TEXT,
  "commissionRate" DECIMAL(5,2),
  "commissionFlat" DECIMAL(14,2),
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "notes"          TEXT,
  "deletedAt"      TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "brokers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "brokerId"             TEXT;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "brokerCommissionPct"  DECIMAL(5,2);
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "brokerCommissionAmt"  DECIMAL(14,2);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "brokerId"             TEXT;

CREATE INDEX IF NOT EXISTS "brokers_isActive_deletedAt_idx" ON "brokers"("isActive","deletedAt");
CREATE INDEX IF NOT EXISTS "sales_brokerId_idx"             ON "sales"("brokerId");
CREATE INDEX IF NOT EXISTS "leads_brokerId_idx"             ON "leads"("brokerId");

-- ── Migration 20260602160000: Unit Merge ─────────────────────

ALTER TABLE "units" ADD COLUMN IF NOT EXISTS "mergedIntoId" TEXT;
CREATE INDEX IF NOT EXISTS "units_mergedIntoId_idx" ON "units"("mergedIntoId");

-- ── Migration 20260602170000: Lead Funnel Stages ─────────────

DO $$ BEGIN
  ALTER TYPE "LeadStatus" ADD VALUE 'POTENTIAL';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "LeadStatus" ADD VALUE 'SITE_VISIT';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Migration 20260602180000: Lead Unit Interest ─────────────

CREATE TABLE IF NOT EXISTS "lead_unit_interests" (
  "id"        TEXT NOT NULL,
  "leadId"    TEXT NOT NULL,
  "unitId"    TEXT NOT NULL,
  "note"      TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_unit_interests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lead_unit_interests_leadId_unitId_key" ON "lead_unit_interests"("leadId","unitId");
CREATE INDEX        IF NOT EXISTS "lead_unit_interests_unitId_idx"         ON "lead_unit_interests"("unitId");

-- ── FKs for new columns (use DO blocks to skip if already exist) ──────────

DO $$ BEGIN
  ALTER TABLE "sales" ADD CONSTRAINT "sales_discountApprovedById_fkey"
    FOREIGN KEY ("discountApprovedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sales" ADD CONSTRAINT "sales_brokerId_fkey"
    FOREIGN KEY ("brokerId") REFERENCES "brokers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_brokerId_fkey"
    FOREIGN KEY ("brokerId") REFERENCES "brokers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "units" ADD CONSTRAINT "units_mergedIntoId_fkey"
    FOREIGN KEY ("mergedIntoId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "daily_log_photos" ADD CONSTRAINT "daily_log_photos_dailyLogId_fkey"
    FOREIGN KEY ("dailyLogId") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "lead_unit_interests" ADD CONSTRAINT "lead_unit_interests_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "lead_unit_interests" ADD CONSTRAINT "lead_unit_interests_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Done ─────────────────────────────────────────────────────
SELECT 'Migration repair complete' AS status;
