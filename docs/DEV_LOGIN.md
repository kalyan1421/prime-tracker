# Dev Quick Login — what it is, and why it cannot reach AWS

**Added 2026-08-12.** One-click sign-in as any of the 12 roles, on the local login page.

> **You do not need to delete anything before deploying.** The original ask was "remove it
> before deploying to AWS". That was built differently on purpose: a step someone has to
> remember is the exact failure mode that ships auth bypasses. Instead there are three
> independent gates, and **all three must fail simultaneously** for this to be reachable in
> production. Two of them are enforced by the build and the runtime, not by a person.

---

## Using it

1. `DEMO_MODE=true` in `apps/api/.env` (already set locally)
2. `pnpm run dev`
3. Open the login page → **Dev Quick Login** panel below the form → click a role

No password is typed, stored, or transmitted. It mints a `demo-<ROLE>` bearer token, which
`JwtAuthGuard` accepts only when `DEMO_MODE=true`, then calls `GET /auth/me` so the **server**
decides what permissions that role actually has.

Seed the demo users if they are missing:

```bash
pnpm --filter api exec ts-node prisma/seed-demo-users.ts
```

Signing in as **Viewer** or **Sales** is the fastest way to check an RBAC change — those roles
are the most restricted and where permission regressions surface first.

---

## The three gates

### 1. Not in the production bundle (build-time)

The call site in `LoginPage.tsx` is `{import.meta.env.DEV && <DevQuickLogin />}`. Vite replaces
`import.meta.env.DEV` with the literal `false` in `vite build`, the branch becomes dead code, and
the import is tree-shaken away.

Verify against a real build — every count must be `0`:

```bash
cd apps/web && rm -rf dist && npx vite build && for m in PRIME_DEV_QUICK_LOGIN "Dev Quick Login" DevQuickLogin demo-FOUNDER; do echo "$m -> $(grep -ro "$m" dist/ | wc -l)"; done
```

Last run (2026-08-12): all four `0`.

### 2. The API must opt in (deploy-time)

The `demo-<ROLE>` token is only accepted inside the `DEMO_MODE === 'true'` branch of
[jwt-auth.guard.ts](../apps/api/src/common/guards/jwt-auth.guard.ts). With the variable unset —
the default, and how AWS should be configured — those tokens are rejected like any other garbage
credential. **Do not set `DEMO_MODE` in the AWS task definition, SSM parameters, or `.env`.**

### 3. The API refuses to boot if 1 and 2 are both bypassed (runtime)

[main.ts](../apps/api/src/main.ts) exits with a fatal error on `NODE_ENV=production` +
`DEMO_MODE=true`. It crashes rather than warning, because a warning fails open and this has to
fail closed.

Verified 2026-08-12 — exit code `1`, with the reason printed as the first thing in the log:

```
FATAL: DEMO_MODE=true with NODE_ENV=production.
DEMO_MODE disables authentication — any request sending
  Authorization: Bearer demo-SUPER_ADMIN
would be granted full administrative access without a password.
```

---

## Pre-deploy checklist

- [ ] `DEMO_MODE` is **absent** from the production environment (not `false` — absent)
- [ ] `NODE_ENV=production` is set, so gate 3 is armed
- [ ] Frontend deployed from `vite build` output, never a dev server
- [ ] Bundle scan from gate 1 returns all zeros
- [ ] Smoke test after deploy — this must return **401**:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer demo-SUPER_ADMIN" https://<api-host>/api/auth/me
```

A `200` there means the bypass is live and the deployment must be rolled back immediately.

---

## Pre-existing note

`DEMO_MODE` and the guard bypass were **already in the codebase** before this change; only the
login-page panel, the boot guard, and this document are new. If `DEMO_MODE` was ever set on a
deployed environment before 2026-08-12, that environment was accepting unauthenticated
`Bearer demo-SUPER_ADMIN` requests and should be checked. Gate 3 now makes that state
unbootable.
