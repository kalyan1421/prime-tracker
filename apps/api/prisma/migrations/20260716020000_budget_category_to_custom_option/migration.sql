-- Convert BudgetCategory from a fixed Postgres enum to free text, backed by the
-- CustomOption system (category="budget_category") — same pattern already used for
-- project/unit/sale/lead status and phase. Uses ALTER COLUMN ... TYPE ... USING to
-- preserve existing data (a naive DROP+ADD would silently wipe every category value).
-- Existing indexes on these columns (budget_lines_projectId_category_idx,
-- actuals_projectId_category_idx) are rebuilt in place by Postgres — no need to recreate.

ALTER TABLE "budget_lines" ALTER COLUMN "category" TYPE TEXT USING "category"::TEXT;
ALTER TABLE "commitments" ALTER COLUMN "category" TYPE TEXT USING "category"::TEXT;
ALTER TABLE "actuals" ALTER COLUMN "category" TYPE TEXT USING "category"::TEXT;

-- Enum type is now unreferenced by any column — safe to drop.
DROP TYPE "BudgetCategory";
