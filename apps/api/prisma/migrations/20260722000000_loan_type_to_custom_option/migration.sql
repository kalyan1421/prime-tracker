-- Convert LoanType from a fixed Postgres enum to free text, backed by the
-- CustomOption system (category="loan_type") — same pattern already used for
-- budget/project/unit/sale/lead categories and status. Uses ALTER COLUMN ... TYPE
-- ... USING to preserve existing data (a naive DROP+ADD would silently wipe every
-- loan's type). The index on loans(deletedAt) is unaffected; no index touches loanType.

ALTER TABLE "loans" ALTER COLUMN "loanType" TYPE TEXT USING "loanType"::TEXT;

-- Enum type is now unreferenced by any column — safe to drop.
DROP TYPE "LoanType";
