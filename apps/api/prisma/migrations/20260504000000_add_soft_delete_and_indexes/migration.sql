-- Soft-delete columns + composite indexes for hot query paths.
-- Run with: pnpm --filter @prime-tracker/api db:migrate

-- ============================================================
-- Soft-delete columns
-- ============================================================
ALTER TABLE "projects"  ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "buildings" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "units"     ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "loans"     ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "leases"    ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "sales"     ADD COLUMN "deletedAt" TIMESTAMP(3);

-- ============================================================
-- Indexes — exclude soft-deleted rows from hot queries
-- ============================================================
CREATE INDEX "projects_status_phase_idx"   ON "projects"  ("status", "phase");
CREATE INDEX "projects_deletedAt_idx"      ON "projects"  ("deletedAt");
CREATE INDEX "buildings_deletedAt_idx"     ON "buildings" ("deletedAt");
CREATE INDEX "units_status_deletedAt_idx"  ON "units"     ("status", "deletedAt");
CREATE INDEX "units_deletedAt_idx"         ON "units"     ("deletedAt");
CREATE INDEX "loans_deletedAt_idx"         ON "loans"     ("deletedAt");
CREATE INDEX "loans_maturityDate_idx"      ON "loans"     ("maturityDate");
CREATE INDEX "leases_status_leaseEnd_idx"  ON "leases"    ("status", "leaseEnd");
CREATE INDEX "leases_deletedAt_idx"        ON "leases"    ("deletedAt");
CREATE INDEX "sales_status_deletedAt_idx"  ON "sales"     ("status", "deletedAt");
CREATE INDEX "sales_deletedAt_idx"         ON "sales"     ("deletedAt");
