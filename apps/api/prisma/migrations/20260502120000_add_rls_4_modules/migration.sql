-- =====================================================================
-- Local-dev compatibility: plain Postgres doesn't have Supabase's auth
-- schema. These stubs are no-ops on Supabase (objects already exist).
-- The API connects as superuser and bypasses RLS, so the stub uid()
-- returning a fixed UUID has no runtime effect.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text UNIQUE
    );
    CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $f$ SELECT '00000000-0000-0000-0000-000000000000'::uuid $f$;
  END IF;
END $$;
-- =====================================================================
-- Row-Level Security for the 4 production-priority modules
-- Tables (Prisma model → snake_case table):
--   Project    → projects
--   Building   → buildings
--   Unit       → units
--   BudgetLine → budget_lines
--   User       → users
-- =====================================================================
-- Postgres rule: the table owner (`postgres` role used by NestJS API
-- via the connection pooler) BYPASSES RLS automatically. So enabling
-- RLS here does NOT break the existing API. RLS only enforces against
-- direct queries from the Supabase JS client (`authenticated` role).
-- =====================================================================

-- ---------- Enable RLS ----------
ALTER TABLE public.projects     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buildings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_lines ENABLE ROW LEVEL SECURITY;

-- ---------- Helper: is the caller a known app user? ----------
CREATE OR REPLACE FUNCTION public.is_app_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN auth.users au ON au.email = u.email
    WHERE au.id = auth.uid()
      AND u."isActive" = true
  );
$$;

-- ---------- Helper: get caller's app role ----------
CREATE OR REPLACE FUNCTION public.app_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u."role"::text
  FROM public.users u
  JOIN auth.users au ON au.email = u.email
  WHERE au.id = auth.uid()
  LIMIT 1;
$$;

-- ---------- projects ----------
CREATE POLICY "projects_select_app_users"
  ON public.projects FOR SELECT TO authenticated
  USING (public.is_app_user());

CREATE POLICY "projects_write_pm_founder_admin"
  ON public.projects FOR ALL TO authenticated
  USING (public.app_user_role() IN ('SUPER_ADMIN','FOUNDER','PROJECT_MANAGER'))
  WITH CHECK (public.app_user_role() IN ('SUPER_ADMIN','FOUNDER','PROJECT_MANAGER'));

-- ---------- buildings ----------
CREATE POLICY "buildings_select_app_users"
  ON public.buildings FOR SELECT TO authenticated
  USING (public.is_app_user());

CREATE POLICY "buildings_write_pm_founder_admin"
  ON public.buildings FOR ALL TO authenticated
  USING (public.app_user_role() IN ('SUPER_ADMIN','FOUNDER','PROJECT_MANAGER'))
  WITH CHECK (public.app_user_role() IN ('SUPER_ADMIN','FOUNDER','PROJECT_MANAGER'));

-- ---------- units ----------
CREATE POLICY "units_select_app_users"
  ON public.units FOR SELECT TO authenticated
  USING (public.is_app_user());

CREATE POLICY "units_write_pm_founder_admin_sales"
  ON public.units FOR ALL TO authenticated
  USING (public.app_user_role() IN ('SUPER_ADMIN','FOUNDER','PROJECT_MANAGER','SALES'))
  WITH CHECK (public.app_user_role() IN ('SUPER_ADMIN','FOUNDER','PROJECT_MANAGER','SALES'));

-- ---------- budget_lines (financial — extra restrictive) ----------
CREATE POLICY "budget_lines_select_finance_roles"
  ON public.budget_lines FOR SELECT TO authenticated
  USING (
    public.app_user_role() IN (
      'SUPER_ADMIN','FOUNDER','EXECUTIVE','FINANCE','ACCOUNTING','PROJECT_MANAGER','VIEWER'
    )
  );

CREATE POLICY "budget_lines_write_finance_only"
  ON public.budget_lines FOR ALL TO authenticated
  USING (public.app_user_role() IN ('SUPER_ADMIN','FOUNDER','FINANCE','ACCOUNTING'))
  WITH CHECK (public.app_user_role() IN ('SUPER_ADMIN','FOUNDER','FINANCE','ACCOUNTING'));
