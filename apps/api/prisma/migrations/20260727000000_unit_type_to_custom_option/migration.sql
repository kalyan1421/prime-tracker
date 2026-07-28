-- Convert UnitType from a fixed Postgres enum to free text, backed by the
-- CustomOption system (category="unit_type") — same pattern already used for
-- budget/loan/project/unit/sale/lead categories and status. Uses ALTER COLUMN
-- ... TYPE ... USING to preserve existing data (a naive DROP+ADD would silently
-- wipe every unit's type).

ALTER TABLE "units" ALTER COLUMN "unitType" TYPE TEXT USING "unitType"::TEXT;

-- Enum type is now unreferenced by any column — safe to drop.
DROP TYPE "UnitType";
