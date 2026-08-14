-- =====================================================================
-- Supabase role stub — makes the migration chain buildable on plain Postgres.
--
-- `20260502120000_add_rls_4_modules` (the very next migration) grants and creates
-- policies `TO authenticated`, a role Supabase provides. Its header claims to stub
-- out the Supabase-only objects for local dev, and it does create the `auth` SCHEMA
-- and `auth.uid()` — but it never creates the ROLE. So on any database that is not
-- Supabase, it dies with:
--
--     ERROR: role "authenticated" does not exist  (SQLSTATE 42704)
--
-- That went unnoticed because every environment that mattered already had the role
-- created BY HAND: the local dev database has it, and so does the EC2 box's RDS
-- instance (added during the 2026-06-18 bring-up). The chain has therefore never
-- actually applied cleanly to an empty database, and nobody found out until CI
-- started running `prisma migrate deploy` against a throwaway Postgres.
--
-- This matters well beyond CI: provisioning a FRESH database from migrations is
-- exactly what the AWS account shift does on a new RDS instance. Without this, that
-- provisioning step fails partway through and leaves a half-migrated database.
--
-- Deliberately timestamped to sort BEFORE the RLS migration so a fresh database gets
-- the role first. On databases where those migrations are already applied this simply
-- runs as one more pending migration and is a no-op, because the role is already there.
--
-- NOLOGIN mirrors Supabase, where `authenticated` is a group role assumed via JWT and
-- never logged into directly. The API connects as the owner and bypasses RLS entirely,
-- so this role has no runtime effect here — it exists only so the GRANT and CREATE
-- POLICY statements have a valid grantee.
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;
