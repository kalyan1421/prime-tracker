-- =============================================================
-- Custom Options: Convert selected enum columns to TEXT so
-- user-defined values (e.g. new phases/statuses) can be stored.
-- Default expressions and partial indexes that reference enum types
-- must be dropped first, then recreated as TEXT expressions.
-- =============================================================

-- 0. Drop partial index on leases that references LeaseStatus enum
--    (it will be recreated below as a plain TEXT comparison)
DROP INDEX IF EXISTS "lease_unit_active_unique";

-- 1a. Drop column defaults that reference enum types
ALTER TABLE "projects"   ALTER COLUMN "status"   DROP DEFAULT;
ALTER TABLE "projects"   ALTER COLUMN "phase"    DROP DEFAULT;
ALTER TABLE "buildings"  ALTER COLUMN "phase"    DROP DEFAULT;
ALTER TABLE "units"      ALTER COLUMN "status"   DROP DEFAULT;
ALTER TABLE "sales"      ALTER COLUMN "status"   DROP DEFAULT;
ALTER TABLE "leads"      ALTER COLUMN "status"   DROP DEFAULT;
ALTER TABLE "milestones" ALTER COLUMN "status"   DROP DEFAULT;
ALTER TABLE "milestones" ALTER COLUMN "phase"    DROP DEFAULT;
ALTER TABLE "tasks"      ALTER COLUMN "status"   DROP DEFAULT;
ALTER TABLE "tasks"      ALTER COLUMN "priority" DROP DEFAULT;
ALTER TABLE "leases"     ALTER COLUMN "status"   DROP DEFAULT;

-- 1b. Convert columns to TEXT (data preserved — enum values cast cleanly)
ALTER TABLE "projects"   ALTER COLUMN "status"   TYPE TEXT USING "status"::TEXT;
ALTER TABLE "projects"   ALTER COLUMN "phase"    TYPE TEXT USING "phase"::TEXT;
ALTER TABLE "buildings"  ALTER COLUMN "phase"    TYPE TEXT USING "phase"::TEXT;
ALTER TABLE "units"      ALTER COLUMN "status"   TYPE TEXT USING "status"::TEXT;
ALTER TABLE "sales"      ALTER COLUMN "status"   TYPE TEXT USING "status"::TEXT;
ALTER TABLE "leads"      ALTER COLUMN "status"   TYPE TEXT USING "status"::TEXT;
ALTER TABLE "milestones" ALTER COLUMN "status"   TYPE TEXT USING "status"::TEXT;
ALTER TABLE "milestones" ALTER COLUMN "phase"    TYPE TEXT USING "phase"::TEXT;
ALTER TABLE "tasks"      ALTER COLUMN "status"   TYPE TEXT USING "status"::TEXT;
ALTER TABLE "tasks"      ALTER COLUMN "priority" TYPE TEXT USING "priority"::TEXT;
ALTER TABLE "leases"     ALTER COLUMN "status"   TYPE TEXT USING "status"::TEXT;

-- 1c. Restore defaults as plain string literals
ALTER TABLE "projects"   ALTER COLUMN "status"   SET DEFAULT 'ACTIVE';
ALTER TABLE "projects"   ALTER COLUMN "phase"    SET DEFAULT 'PRE_DEVELOPMENT';
ALTER TABLE "buildings"  ALTER COLUMN "phase"    SET DEFAULT 'PRE_DEVELOPMENT';
ALTER TABLE "units"      ALTER COLUMN "status"   SET DEFAULT 'AVAILABLE';
ALTER TABLE "sales"      ALTER COLUMN "status"   SET DEFAULT 'PROSPECT';
ALTER TABLE "leads"      ALTER COLUMN "status"   SET DEFAULT 'NEW';
ALTER TABLE "milestones" ALTER COLUMN "status"   SET DEFAULT 'NOT_STARTED';
ALTER TABLE "tasks"      ALTER COLUMN "status"   SET DEFAULT 'TODO';
ALTER TABLE "tasks"      ALTER COLUMN "priority" SET DEFAULT 'MEDIUM';
ALTER TABLE "leases"     ALTER COLUMN "status"   SET DEFAULT 'DRAFT';

-- 2. Drop freed PostgreSQL enum types
DROP TYPE IF EXISTS "ProjectStatus";
DROP TYPE IF EXISTS "ProjectPhase";
DROP TYPE IF EXISTS "UnitStatus";
DROP TYPE IF EXISTS "SaleStatus";
DROP TYPE IF EXISTS "LeadStatus";
DROP TYPE IF EXISTS "MilestoneStatus";
DROP TYPE IF EXISTS "TaskStatus";
DROP TYPE IF EXISTS "TaskPriority";
DROP TYPE IF EXISTS "LeaseStatus";

-- 3. Recreate the partial unique index using plain TEXT comparisons
CREATE UNIQUE INDEX "lease_unit_active_unique"
  ON "leases" ("unitId")
  WHERE "unitId" IS NOT NULL
    AND status NOT IN ('EXPIRED', 'TERMINATED');

-- 4. CustomOption table — stores user-defined additions per category
CREATE TABLE "custom_options" (
  "id"          TEXT         NOT NULL,
  "category"    TEXT         NOT NULL,
  "value"       TEXT         NOT NULL,
  "label"       TEXT         NOT NULL,
  "color"       TEXT,
  "sortOrder"   INTEGER      NOT NULL DEFAULT 0,
  "isSystem"    BOOLEAN      NOT NULL DEFAULT false,
  "isActive"    BOOLEAN      NOT NULL DEFAULT true,
  "createdById" TEXT         NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "custom_options_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "custom_options_category_value_key" UNIQUE ("category", "value")
);

CREATE INDEX "custom_options_category_idx" ON "custom_options"("category", "isActive");
