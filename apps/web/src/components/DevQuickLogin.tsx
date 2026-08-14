/**
 * Dev Quick Login — one-click sign-in as any role, for local development only.
 *
 * ── Why this is safe to have in the codebase ────────────────────────────────
 *
 * Three independent gates, none of which relies on anyone remembering to delete
 * this file before a deploy:
 *
 *  1. THIS COMPONENT IS NOT IN THE PRODUCTION BUNDLE. The single call site is
 *     wrapped in `import.meta.env.DEV`, which Vite replaces with the literal
 *     `false` at build time. The branch is then dead code and the import is
 *     tree-shaken away, so `vite build` output contains none of this — verified
 *     by grepping dist/ for the marker string (see DEV_LOGIN.md).
 *
 *  2. THE BACKEND MUST OPT IN. The tokens minted here are `demo-<ROLE>`, which
 *     only JwtAuthGuard's DEMO_MODE branch accepts. With DEMO_MODE unset — as on
 *     any real deployment — they are rejected like any other malformed token.
 *
 *  3. THE API REFUSES TO BOOT IF BOTH ARE EVER TRUE. main.ts exits with a fatal
 *     error on NODE_ENV=production + DEMO_MODE=true, so the bypass cannot be
 *     switched on in production even deliberately.
 *
 * ── Why it does not handle passwords ────────────────────────────────────────
 *
 * The seeded demo accounts do have password hashes (`prisma/seed-demo-users.ts`),
 * but this panel deliberately does not use them. It mints the demo bearer token
 * directly, so no credential is typed, stored, or transmitted — there is nothing
 * here that could become a habit worth copying into a real login flow.
 */
import { useState } from 'react';
import { FiZap, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import api from '../lib/api';

/** Grep marker — DEV_LOGIN.md asserts this string is absent from production builds. */
const DEV_ONLY_MARKER = 'PRIME_DEV_QUICK_LOGIN';

/**
 * Must stay in sync with VALID_DEMO_ROLES in api/src/common/guards/jwt-auth.guard.ts
 * and the seeded ids in api/prisma/seed-demo-users.ts (`demo-user-<lowercased role>`).
 */
const DEV_ROLES: Array<{ role: string; label: string; hint: string }> = [
  { role: 'FOUNDER',         label: 'Founder',         hint: 'Everything — the widest role' },
  { role: 'SUPER_ADMIN',     label: 'Super Admin',     hint: 'Admin + user management' },
  { role: 'SALES',           label: 'Sales',           hint: 'Leads, sales, unit status only' },
  { role: 'FINANCE',         label: 'Finance',         hint: 'Budgets, loans, draws, rent' },
  { role: 'PROJECT_MANAGER', label: 'Project Manager', hint: 'Projects, milestones, tasks' },
  { role: 'CONSTRUCTION',    label: 'Construction',    hint: 'Site, daily logs, milestones' },
  { role: 'ACCOUNTING',      label: 'Accounting',      hint: 'AP/AR and reconciliation' },
  { role: 'AR_AP',           label: 'AR / AP',         hint: 'Invoices and collections' },
  { role: 'MARKETING',       label: 'Marketing',       hint: 'Campaigns and attribution' },
  { role: 'LEGAL',           label: 'Legal',           hint: 'Contracts and documents' },
  { role: 'EXECUTIVE',       label: 'Executive',       hint: 'Read-heavy leadership view' },
  { role: 'VIEWER',          label: 'Viewer',          hint: 'Read-only — good for RBAC checks' },
];

export function DevQuickLogin() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const signInAs = async (role: string) => {
    const slug = role.toLowerCase();
    const token = `demo-${role}`;
    setBusy(role);
    setError('');

    // Set the token first so the axios interceptor attaches it, then ask the SERVER
    // who that makes us. Deriving permissions on the client would mean maintaining a
    // second copy of the role→permission map that could silently drift from the
    // guard's — and a dev login that grants different permissions than the real one
    // is worse than no dev login, because RBAC bugs would hide behind it.
    setAuth(
      {
        id: `demo-user-${slug}`, email: `${slug}@prime.dev`,
        name: `Demo ${role.replace(/_/g, ' ')}`, role, roles: [role],
        permissions: [], mfaEnabled: false, mfaVerified: false,
      },
      token,
      token,
    );

    try {
      const { data } = await api.get('/auth/me');
      setAuth(
        {
          id: data.sub ?? `demo-user-${slug}`,
          email: data.email ?? `${slug}@prime.dev`,
          name: data.name ?? `Demo ${role.replace(/_/g, ' ')}`,
          role: data.role ?? role,
          roles: data.roles ?? [data.role ?? role],
          permissions: data.permissions ?? [],
          mfaEnabled: false,
          mfaVerified: true,
        },
        token,
        token,
      );
      navigate('/', { replace: true });
    } catch {
      useAuthStore.getState().logout();
      setError('Demo token rejected — is DEMO_MODE=true set on the API?');
    } finally {
      setBusy(null);
    }
  };

  const shown = expanded ? DEV_ROLES : DEV_ROLES.slice(0, 4);

  return (
    <div className="mt-6 pt-5 border-t border-dashed border-amber-300" data-testid={DEV_ONLY_MARKER}>
      <div className="flex items-center gap-2 mb-1">
        <FiZap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        <p className="text-xs font-bold uppercase tracking-wide text-amber-700">
          Dev Quick Login
        </p>
        <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
          Local only
        </span>
      </div>
      <p className="text-[11px] text-gray-500 mb-3">
        Signs in with a demo token — no password. Requires <code className="text-gray-600">DEMO_MODE=true</code>{' '}
        on the API. Never present in a production build.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2 mb-3">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {shown.map((r) => (
          <button
            key={r.role}
            type="button"
            onClick={() => signInAs(r.role)}
            disabled={!!busy}
            title={r.hint}
            className="text-left rounded-lg border border-gray-200 bg-white px-3 py-2 hover:border-amber-400 hover:bg-amber-50 transition-colors disabled:opacity-50"
          >
            <span className="block text-xs font-semibold text-gray-800">
              {busy === r.role ? 'Signing in…' : r.label}
            </span>
            <span className="block text-[10px] text-gray-400 truncate">{r.hint}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 w-full flex items-center justify-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 py-1"
      >
        {expanded ? <FiChevronUp className="w-3 h-3" /> : <FiChevronDown className="w-3 h-3" />}
        {expanded ? 'Show fewer roles' : `Show all ${DEV_ROLES.length} roles`}
      </button>
    </div>
  );
}
