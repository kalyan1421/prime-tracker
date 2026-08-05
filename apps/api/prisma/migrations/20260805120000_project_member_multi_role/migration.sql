-- A user can hold several roles on the same project (Finance AND Legal, say).
-- Mirrors the User.role / User.roles[] pattern: `role` stays as the primary and is
-- kept equal to roles[0], so existing reads and displays are unaffected.
ALTER TABLE "project_members" ADD COLUMN "roles" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: every existing membership becomes a single-role array.
UPDATE "project_members" SET "roles" = ARRAY["role"] WHERE "roles" IS NULL OR cardinality("roles") = 0;
