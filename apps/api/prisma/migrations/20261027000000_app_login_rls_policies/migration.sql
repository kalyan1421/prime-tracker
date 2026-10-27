-- Row-level security policies for the API's own database login.
--
-- The API connects as prime_tracker_app (infra/scripts/create-app-db-user.sh) instead of
-- the tables' owner, and being the owner was the only reason RLS never applied to it.
-- The policies from 20260502120000_add_rls_4_modules are written for Supabase's
-- `authenticated` role, which the API never uses, so under them prime_tracker_app reads
-- no rows at all: every project list comes back empty rather than failing. The API does
-- its own access control (project scoping, permissions), so it gets every row, exactly
-- as it did as the owner.
--
-- The role is created here when missing — without a login; create-app-db-user.sh gives
-- it one — so these policies exist on every database, CI's and a fresh one included, and
-- the login can never arrive at a table under RLS that has no policy for it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prime_tracker_app') THEN
    CREATE ROLE prime_tracker_app NOLOGIN;
  END IF;
END $$;

CREATE POLICY "projects_api_login"     ON public.projects     FOR ALL TO prime_tracker_app USING (true) WITH CHECK (true);
CREATE POLICY "buildings_api_login"    ON public.buildings    FOR ALL TO prime_tracker_app USING (true) WITH CHECK (true);
CREATE POLICY "units_api_login"        ON public.units        FOR ALL TO prime_tracker_app USING (true) WITH CHECK (true);
CREATE POLICY "budget_lines_api_login" ON public.budget_lines FOR ALL TO prime_tracker_app USING (true) WITH CHECK (true);
