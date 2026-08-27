-- Resolve long-standing drift between schema.prisma and the database.
--
-- BACKGROUND. `prisma migrate diff` had been reporting nine differences, and three of them
-- were dangerous to apply blindly: it wanted to DROP the defaults on users.roles,
-- project_members.roles and custom_options.updatedAt. Anyone who generated a migration the
-- automatic way would have shipped those without noticing, and an INSERT that omits
-- users.roles would then fail on a NOT NULL column with no default.
--
-- Going through them one at a time, seven were the SCHEMA being wrong about a database that
-- was right — those were fixed by declaring them in schema.prisma, no DDL needed:
--   · leases_brokerId_idx        — Sale and Lead declare theirs; Lease never did, though the
--                                  index exists and the broker report reads leases by broker.
--   · daily_logs source/parentId/stageId indexes — created by hand-written migrations today
--                                  and not declared. Author's own drift, same day.
--   · users.roles, project_members.roles, custom_options.updatedAt defaults — the database
--                                  is correct; dropping them was the booby trap above.
--
-- Only these two are real DDL the database is missing.

-- Declared in schema.prisma and genuinely absent. The partial unique index
-- units_building_number_active_key covers uniqueness on lower(unitNumber) for live rows
-- only; this plain one serves ordinary "units in this building, by number" lookups.
CREATE INDEX IF NOT EXISTS "units_buildingId_unitNumber_idx" ON "units"("buildingId", "unitNumber");

-- Same columns, name Prisma does not expect. A pure rename — no data or plan change.
ALTER INDEX IF EXISTS "custom_options_category_idx" RENAME TO "custom_options_category_isActive_idx";
