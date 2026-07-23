-- Adds a manual display-order column to buildings so the Construction tab's
-- building cards can be drag-reordered per project (previously always sorted
-- alphabetically by name — see BuildingsService.findByProject).
ALTER TABLE "buildings" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "buildings_projectId_sortOrder_idx" ON "buildings"("projectId", "sortOrder");

-- Backfill sortOrder from the pre-migration alphabetical display order
-- (findByProject previously used orderBy: { name: 'asc' }), so existing
-- projects don't visually reshuffle the first time this loads post-migration.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "projectId" ORDER BY name ASC) - 1 AS rn
  FROM "buildings"
)
UPDATE "buildings" b
SET "sortOrder" = ranked.rn
FROM ranked
WHERE b.id = ranked.id;
