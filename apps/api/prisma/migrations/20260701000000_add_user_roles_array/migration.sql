-- AddColumn: roles (array of UserRole enum) on users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "roles" "UserRole"[] NOT NULL DEFAULT '{}';

-- Backfill: set roles = [role] for every existing user
UPDATE "users" SET "roles" = ARRAY["role"];

-- Belt-and-suspenders: every user must have at least one role
ALTER TABLE "users" ADD CONSTRAINT "users_roles_nonempty" CHECK (array_length("roles", 1) > 0);
