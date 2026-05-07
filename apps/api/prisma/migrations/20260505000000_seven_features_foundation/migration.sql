-- =============================================================
-- Slice 1 Foundation — Schema for 7 features (Project, Building, Unit,
-- Budget, Sales, Milestones, Draw Requests).
-- Apply with: pnpm --filter @prime-tracker/api exec prisma migrate deploy
-- =============================================================

-- ─────────── ENUMS ───────────
CREATE TYPE "BudgetChangeReason" AS ENUM (
  'SCOPE_ADD','COST_INCREASE','REALLOCATION','ESTIMATE_REFINED','CHANGE_ORDER','OTHER'
);
CREATE TYPE "LostReason" AS ENUM (
  'PRICE_TOO_HIGH','FINANCING_FELL_THROUGH','CHOSE_COMPETITOR','TIMING_OFF','NO_RESPONSE','OTHER'
);
CREATE TYPE "DrawApprovalStep" AS ENUM (
  'INTERNAL_FOUNDER','INTERNAL_FINANCE','LENDER_SUBMITTED','LENDER_FUNDED'
);
CREATE TYPE "DrawApprovalAction" AS ENUM (
  'APPROVED','REJECTED','RETURNED_FOR_INFO'
);
CREATE TYPE "DrawDocType" AS ENUM (
  'LIEN_WAIVER','INSPECTION_REPORT','SWORN_STATEMENT','VENDOR_INVOICE','CHANGE_ORDER','OTHER'
);

-- DrawStatus already exists; add CANCELLED if missing
ALTER TYPE "DrawStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- ─────────── BUILDING — independent phase ───────────
ALTER TABLE "buildings"
  ADD COLUMN "phase" "ProjectPhase" NOT NULL DEFAULT 'PRE_DEVELOPMENT',
  ADD COLUMN "coverPhotoPath" TEXT;
CREATE INDEX "buildings_phase_idx" ON "buildings" ("phase");

-- ─────────── UNIT — time-on-market ───────────
ALTER TABLE "units" ADD COLUMN "availableSince" TIMESTAMP(3);
-- backfill: for units currently AVAILABLE, treat updatedAt as the start
UPDATE "units" SET "availableSince" = "updatedAt" WHERE "status" = 'AVAILABLE';
CREATE INDEX "units_status_availableSince_idx" ON "units" ("status", "availableSince");

-- ─────────── BUDGET LINE — soft-delete + revisions ───────────
ALTER TABLE "budget_lines" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "budget_lines_deletedAt_idx" ON "budget_lines" ("deletedAt");

CREATE TABLE "budget_revisions" (
  "id" TEXT NOT NULL,
  "budgetLineId" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "changeReason" "BudgetChangeReason" NOT NULL,
  "createdById" TEXT NOT NULL,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "budget_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "budget_revisions_budgetLineId_fkey" FOREIGN KEY ("budgetLineId")
    REFERENCES "budget_lines"("id") ON DELETE CASCADE,
  CONSTRAINT "budget_revisions_createdById_fkey" FOREIGN KEY ("createdById")
    REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "budget_revisions_approvedById_fkey" FOREIGN KEY ("approvedById")
    REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "budget_revisions_budgetLineId_revisionNumber_key"
  ON "budget_revisions" ("budgetLineId", "revisionNumber");
CREATE INDEX "budget_revisions_budgetLineId_idx" ON "budget_revisions" ("budgetLineId");

-- Backfill: every existing budget line gets revision #1 = baseline.
-- We need a system user ID; pick the first SUPER_ADMIN/FOUNDER if available, else first user.
-- This DOES NOT run if no users exist; in that case migrate after seeding.
DO $$
DECLARE
  sys_user_id TEXT;
BEGIN
  SELECT id INTO sys_user_id FROM users
    WHERE role IN ('SUPER_ADMIN','FOUNDER') AND "isActive" = true
    ORDER BY "createdAt" ASC LIMIT 1;
  IF sys_user_id IS NULL THEN
    SELECT id INTO sys_user_id FROM users ORDER BY "createdAt" ASC LIMIT 1;
  END IF;

  IF sys_user_id IS NOT NULL THEN
    INSERT INTO "budget_revisions" ("id", "budgetLineId", "revisionNumber", "amount", "reason", "changeReason", "createdById", "createdAt")
    SELECT
      'cl' || substr(md5(random()::text || id), 1, 22),
      id, 1, "baselineAmt", 'Baseline budget (auto-imported)', 'OTHER', sys_user_id, "createdAt"
    FROM "budget_lines";

    -- For lines that have a revisedAmt different from baseline, also create revision #2
    INSERT INTO "budget_revisions" ("id", "budgetLineId", "revisionNumber", "amount", "reason", "changeReason", "createdById", "createdAt")
    SELECT
      'cl' || substr(md5(random()::text || id || '_2'), 1, 22),
      id, 2, "revisedAmt", 'Imported revision (pre-revision-tracking)', 'ESTIMATE_REFINED', sys_user_id, "updatedAt"
    FROM "budget_lines"
    WHERE "revisedAmt" IS NOT NULL AND "revisedAmt" != "baselineAmt";
  END IF;
END $$;

-- ─────────── SALES — pipeline upgrade ───────────
ALTER TABLE "sales"
  ADD COLUMN "lastActivityAt" TIMESTAMP(3),
  ADD COLUMN "expectedCloseDate" TIMESTAMP(3),
  ADD COLUMN "lostReason" "LostReason",
  ADD COLUMN "lostReasonNote" TEXT;
-- Backfill lastActivityAt = updatedAt so cron doesn't immediately flag everything as drought
UPDATE "sales" SET "lastActivityAt" = "updatedAt";
CREATE INDEX "sales_status_lastActivityAt_idx" ON "sales" ("status", "lastActivityAt");

-- ─────────── MILESTONES — dependencies + draw link + photos ───────────
ALTER TABLE "milestones"
  ADD COLUMN "dependsOnId" TEXT,
  ADD COLUMN "linkedDrawScheduleId" TEXT;
ALTER TABLE "milestones"
  ADD CONSTRAINT "milestones_dependsOnId_fkey" FOREIGN KEY ("dependsOnId")
    REFERENCES "milestones"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "milestones_linkedDrawScheduleId_fkey" FOREIGN KEY ("linkedDrawScheduleId")
    REFERENCES "draw_schedules"("id") ON DELETE SET NULL;
CREATE INDEX "milestones_dependsOnId_idx" ON "milestones" ("dependsOnId");
CREATE INDEX "milestones_linkedDrawScheduleId_idx" ON "milestones" ("linkedDrawScheduleId");

CREATE TABLE "milestone_photos" (
  "id" TEXT NOT NULL,
  "milestoneId" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "caption" TEXT,
  "uploadedById" TEXT NOT NULL,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "milestone_photos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "milestone_photos_milestoneId_fkey" FOREIGN KEY ("milestoneId")
    REFERENCES "milestones"("id") ON DELETE CASCADE,
  CONSTRAINT "milestone_photos_uploadedById_fkey" FOREIGN KEY ("uploadedById")
    REFERENCES "users"("id") ON DELETE RESTRICT
);
CREATE INDEX "milestone_photos_milestoneId_idx" ON "milestone_photos" ("milestoneId");

-- ─────────── DRAW REQUESTS — workflow + documents ───────────
ALTER TABLE "draw_requests"
  ADD COLUMN "expectedFundingDate" TIMESTAMP(3),
  ADD COLUMN "submittedToLenderAt" TIMESTAMP(3);
CREATE INDEX "draw_requests_status_expectedFundingDate_idx"
  ON "draw_requests" ("status", "expectedFundingDate");

CREATE TABLE "draw_approvals" (
  "id" TEXT NOT NULL,
  "drawRequestId" TEXT NOT NULL,
  "step" "DrawApprovalStep" NOT NULL,
  "action" "DrawApprovalAction" NOT NULL,
  "actorId" TEXT NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "draw_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "draw_approvals_drawRequestId_fkey" FOREIGN KEY ("drawRequestId")
    REFERENCES "draw_requests"("id") ON DELETE CASCADE,
  CONSTRAINT "draw_approvals_actorId_fkey" FOREIGN KEY ("actorId")
    REFERENCES "users"("id") ON DELETE RESTRICT
);
CREATE INDEX "draw_approvals_drawRequestId_step_idx"
  ON "draw_approvals" ("drawRequestId", "step");

CREATE TABLE "draw_documents" (
  "id" TEXT NOT NULL,
  "drawRequestId" TEXT NOT NULL,
  "documentType" "DrawDocType" NOT NULL,
  "storagePath" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "draw_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "draw_documents_drawRequestId_fkey" FOREIGN KEY ("drawRequestId")
    REFERENCES "draw_requests"("id") ON DELETE CASCADE,
  CONSTRAINT "draw_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById")
    REFERENCES "users"("id") ON DELETE RESTRICT
);
CREATE INDEX "draw_documents_drawRequestId_documentType_idx"
  ON "draw_documents" ("drawRequestId", "documentType");

-- ─────────── ORG SETTINGS — configurable thresholds ───────────
CREATE TABLE "org_settings" (
  "orgId" TEXT NOT NULL,
  "saleStageProbabilities" JSONB NOT NULL
    DEFAULT '{"PROSPECT":0.10,"LOI_SIGNED":0.35,"UNDER_CONTRACT":0.75,"CLOSED":1.0,"CANCELLED":0.0}',
  "unitStaleDaysThreshold" INTEGER NOT NULL DEFAULT 90,
  "budgetVarianceAlertPct" DECIMAL(5,2) NOT NULL DEFAULT 10,
  "saleStageAgeAlertDays" INTEGER NOT NULL DEFAULT 30,
  "saleActivityDroughtDays" INTEGER NOT NULL DEFAULT 14,
  "drawFundingExpectedDays" INTEGER NOT NULL DEFAULT 14,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "org_settings_pkey" PRIMARY KEY ("orgId"),
  CONSTRAINT "org_settings_orgId_fkey" FOREIGN KEY ("orgId")
    REFERENCES "organizations"("id") ON DELETE CASCADE
);

-- Backfill OrgSettings rows for every existing org
INSERT INTO "org_settings" ("orgId", "updatedAt")
SELECT id, CURRENT_TIMESTAMP FROM "organizations"
ON CONFLICT DO NOTHING;
