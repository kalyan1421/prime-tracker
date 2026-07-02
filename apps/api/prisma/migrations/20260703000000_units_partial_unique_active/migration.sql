-- The plain unique constraint on (buildingId, unitNumber) also applies to soft-deleted
-- rows (deletedAt IS NOT NULL), e.g. units archived by the "combine units" flow. That
-- permanently blocks reuse of the number and makes the row invisible in list views at
-- the same time (findByBuilding/findByProject filter deletedAt: null) — a unit number
-- can look "gone" yet still 409 on re-create. Replace it with a partial unique index
-- that only applies to live (non-deleted) units, same pattern as lease_unit_active_unique.
DROP INDEX "units_buildingId_unitNumber_key";

CREATE UNIQUE INDEX "units_building_number_active_key"
  ON "units"("buildingId", "unitNumber")
  WHERE "deletedAt" IS NULL;
