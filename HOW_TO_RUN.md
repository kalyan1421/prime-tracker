# How to Run Prime Tracker

Monorepo: NestJS API (`apps/api`) + React/Vite web (`apps/web`).
Package manager: **pnpm**. Node **>=20**.

---

## Prerequisites
- Node.js >= 20, pnpm >= 8
- Docker (for Postgres + Redis)
- `apps/api/.env` and `apps/web/.env` present (already configured locally)

---

## Quick Start (full stack)

> Note: run each command on its own line. In zsh, a trailing `# comment` is
> NOT stripped by default — it gets passed to the script as an argument and
> breaks it. So don't paste the `# ...` notes below into your terminal.

```bash
pnpm run docker:up      # 1. start Postgres + Redis
pnpm install            # 2. install dependencies (first time only)
pnpm run db:seed        # 3. seed demo data + users (only if DB is empty)
pnpm run dev            # 4. run API + Web together
```

### About migrations
Do **not** run `pnpm run db:migrate` (`prisma migrate dev`) for normal local
runs. It spins up a throwaway *shadow database* to validate migrations from
scratch, and the Supabase RLS migration (`20260502120000_add_rls_4_modules`)
references `auth.users` / `auth.uid()` which don't exist on plain local
Postgres — so it fails on the shadow DB even though your real DB is fine.

- Check status:  `cd apps/api && npx prisma migrate status`
- Apply pending migrations without a shadow DB:  `cd apps/api && npx prisma migrate deploy`
- Only use `migrate dev` when authoring a brand-new migration.

| Service | URL |
|---|---|
| API | http://localhost:3001 |
| Swagger docs | http://localhost:3001/api/docs |
| Web app | http://localhost:5173 (proxies `/api` → 3001) |

---

## Run backend only

```bash
pnpm --filter @prime-tracker/api dev      # NestJS, watch mode → http://localhost:3001
```

## Run frontend only

```bash
pnpm --filter @prime-tracker/web dev      # Vite → http://localhost:5173
```

---

## Useful commands

| Command | What it does |
|---|---|
| `pnpm run docker:up` | Start Postgres + Redis containers |
| `pnpm run docker:down` | Stop containers |
| `pnpm run db:migrate` | `prisma migrate dev` |
| `pnpm run db:seed` | Seed data + demo users + financials |
| `pnpm run db:studio` | Open Prisma Studio (DB GUI) |
| `pnpm run build` | Build all packages |
| `pnpm run lint` | Lint all packages |
| `pnpm run test` | Run tests |

---

## Troubleshooting

- **DB connection refused** → run `pnpm run docker:up` first and wait for healthchecks.
- **Prisma client out of date** → `cd apps/api && pnpm prisma generate`.
- **Port already in use** → API on 3001, Web on 5173, Postgres on 5432, Redis on 6379.
