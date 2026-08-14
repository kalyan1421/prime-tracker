-- Phase 2.1 — Construction updates board.
--
-- The client's Monday board has seven columns. SIX of them are already columns on
-- `tasks`: unitId, buildingId, projectId, title, status, priority, assignedTo, plus
-- TaskComment for the 💬 count. `custom_options` already stores label + colour +
-- sortOrder per category, so "Working on it" in amber is configuration, not schema.
--
-- So this migration is not a new module. It closes the four gaps that are real:
--
--   1. one item covering SEVERAL units ("UNITS 402,403,404")  -> task_units
--   2. day-wise updates with photos                            -> task_updates
--   3. site work and admin to-dos sharing one list             -> tasks.kind
--   4. daily logs that cannot be about a unit                  -> daily_logs.unitId
--
-- plus TASK_ASSIGNED, because assigning work currently notifies nobody.

-- ---------------------------------------------------------------------------
-- 1. tasks.kind — keep one table, split the views
--
-- Defaulting every existing row to 'TASK' is the safe direction: they were all
-- created as ordinary work items, and mislabelling them CONSTRUCTION would drop them
-- into a board they were never meant for.
-- ---------------------------------------------------------------------------

ALTER TABLE "tasks" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'TASK';

CREATE INDEX "tasks_kind_projectId_idx" ON "tasks"("kind", "projectId");

-- ---------------------------------------------------------------------------
-- 2. task_units — the many-to-many that tasks.unitId cannot express
--
-- `tasks.unitId` is KEPT, not dropped. Existing queries and the current UI read it,
-- and removing it in the same migration that adds the join table would turn a schema
-- change into a rewrite. It becomes a mirror, maintained by the service for
-- single-unit items only.
--
-- Emphatically NOT UnitsService.combine(): that MERGES units into a new summed-area
-- unit and archives the sources. These units stay separate and keep their own leases,
-- sales and rent history — only the work item is shared.
-- ---------------------------------------------------------------------------

CREATE TABLE "task_units" (
    "taskId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,

    CONSTRAINT "task_units_pkey" PRIMARY KEY ("taskId", "unitId")
);

CREATE INDEX "task_units_unitId_idx" ON "task_units"("unitId");

ALTER TABLE "task_units"
    ADD CONSTRAINT "task_units_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_units"
    ADD CONSTRAINT "task_units_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every task that already names a unit gets its join row, so `units` is the
-- complete picture from the first read and no code has to fall back to unitId.
INSERT INTO "task_units" ("taskId", "unitId")
SELECT t."id", t."unitId"
FROM "tasks" t
WHERE t."unitId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. task_updates — the "Updates" column, day by day
--
-- updateDate is separate from createdAt for the same reason daily_logs.logDate is:
-- site updates get written up in the evening or the next morning, and dating them by
-- when they were typed quietly shifts the whole record by a day.
-- ---------------------------------------------------------------------------

CREATE TABLE "task_updates" (
    "id"         TEXT NOT NULL,
    "taskId"     TEXT NOT NULL,
    "updateDate" TIMESTAMP(3) NOT NULL,
    "authorId"   TEXT NOT NULL,
    "content"    TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_updates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_updates_taskId_updateDate_idx" ON "task_updates"("taskId", "updateDate");

ALTER TABLE "task_updates"
    ADD CONSTRAINT "task_updates_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT, not SET NULL: an update with no author is not a progress report, it is an
-- anonymous claim. Deactivate the user instead of deleting them.
ALTER TABLE "task_updates"
    ADD CONSTRAINT "task_updates_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "task_update_photos" (
    "id"           TEXT NOT NULL,
    "taskUpdateId" TEXT NOT NULL,
    "storagePath"  TEXT NOT NULL,
    "caption"      TEXT,
    "uploadedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_update_photos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_update_photos_taskUpdateId_idx" ON "task_update_photos"("taskUpdateId");

ALTER TABLE "task_update_photos"
    ADD CONSTRAINT "task_update_photos_taskUpdateId_fkey"
    FOREIGN KEY ("taskUpdateId") REFERENCES "task_updates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. daily_logs.unitId
--
-- Nullable on purpose. A site-wide log — weather, crew count, a concrete pour — is
-- genuinely not about one unit, and forcing one would make the field a lie.
-- ---------------------------------------------------------------------------

ALTER TABLE "daily_logs" ADD COLUMN "unitId" TEXT;

CREATE INDEX "daily_logs_unitId_logDate_idx" ON "daily_logs"("unitId", "logDate");

ALTER TABLE "daily_logs"
    ADD CONSTRAINT "daily_logs_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. TASK_ASSIGNED
--
-- Must be added here AND in schema.prisma. A value present in the DB but missing from
-- the enum is invisible to Object.values(NotificationType), which means it never
-- appears in getPreferences() and nobody can mute it — the note on
-- 20260729120000_add_notification_types_l3 records that lesson.
-- ---------------------------------------------------------------------------

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TASK_ASSIGNED';
