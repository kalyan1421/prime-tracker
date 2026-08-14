-- A construction item can span several buildings, and can be held by several people.
--
-- Both were scalars, which meant the second building and the second person were simply
-- unsayable: the client's board routinely tags a crew, and one contractor doing the same
-- job across B1 and B2 is one item, not two.
--
-- Same shape as task_units, which already solved this for units. The scalar columns stay
-- as a mirror of the single-value case so existing rows, existing filters and the board's
-- group-by keep working untouched.

CREATE TABLE "task_buildings" (
    "taskId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,

    CONSTRAINT "task_buildings_pkey" PRIMARY KEY ("taskId", "buildingId")
);
CREATE INDEX "task_buildings_buildingId_idx" ON "task_buildings"("buildingId");

ALTER TABLE "task_buildings" ADD CONSTRAINT "task_buildings_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_buildings" ADD CONSTRAINT "task_buildings_buildingId_fkey"
    FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "task_assignments" (
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Nullable and set once: re-saving an item must not re-notify everybody already on
    -- it. Only somebody newly added hears about it.
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "task_assignments_pkey" PRIMARY KEY ("taskId", "userId")
);
CREATE INDEX "task_assignments_userId_idx" ON "task_assignments"("userId");

ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from the scalars, so nothing that exists today loses its building or its
-- owner the moment the UI starts reading the join tables. notifiedAt is stamped for
-- these: they were assigned before this migration and must not all fire a notification.
INSERT INTO "task_buildings" ("taskId", "buildingId")
SELECT id, "buildingId" FROM "tasks" WHERE "buildingId" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "task_assignments" ("taskId", "userId", "assignedAt", "notifiedAt")
SELECT id, "assignedTo", "createdAt", "createdAt" FROM "tasks" WHERE "assignedTo" IS NOT NULL
ON CONFLICT DO NOTHING;
