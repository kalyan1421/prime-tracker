-- ---------------------------------------------------------------------------
-- 1. Building-level leases were never covered by an overlap constraint
--
-- `lease_unit_no_overlap` (20260813000000) is scoped `WHERE unitId IS NOT NULL`,
-- so a lease attached to a BUILDING fell outside it entirely. Verified 2026-08-25:
-- two tenants could be given the same building over identical dates and nothing
-- refused it, and the rent roll then reported both — 12,900/mo of "income" for a
-- single 1,000 sqft building.
--
-- Same shape as the unit constraint, over the same occupied range
-- COALESCE(terminationDate, leaseEnd) with '[)' bounds so same-day turnover stays
-- legal. Verified against live data before adding: 0 existing rows conflict.
-- ---------------------------------------------------------------------------

ALTER TABLE "leases"
    ADD CONSTRAINT "lease_building_no_overlap"
    EXCLUDE USING gist (
        "buildingId" WITH =,
        daterange("leaseStart"::date, COALESCE("terminationDate", "leaseEnd")::date, '[)') WITH &&
    )
    WHERE ("buildingId" IS NOT NULL AND "deletedAt" IS NULL);

-- ---------------------------------------------------------------------------
-- 2. Unit numbers differing only by case were two different units
--
-- `units_building_number_active_key` is a plain btree on ("buildingId", "unitNumber"),
-- and Postgres compares text case-sensitively — so "E2" and "e2" coexisted happily in
-- one building, two records for one physical space. That is reachable from the rent
-- history import: resolveUnit failed to match the sheet's "e2" against the existing
-- "E2", reported the unit as missing, and the preview then offered to create it.
--
-- Folding case in the index closes the last door; resolveUnit now matches
-- case-insensitively so the situation is not reached in the first place.
-- Verified against live data before adding: 0 buildings hold a case-variant pair.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS "units_building_number_active_key";

CREATE UNIQUE INDEX "units_building_number_active_key"
    ON "units" ("buildingId", lower("unitNumber"))
    WHERE ("deletedAt" IS NULL);
