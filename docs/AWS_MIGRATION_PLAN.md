# Prime Tracker — AWS Migration Plan (Authoritative)

> **Date:** 2026-06-12 · **Prepared by:** Asan Innovators for Prime Developers
> **Status:** 🟡 Planning — ready to execute
> **Supersedes:** `Prime_Developers_AWS_Migration_Plan.docx` (Jun 9), Notion "Phase 2 — AWS Migration + Public Website Integration Plan" (Jun 9), and `docs/AWS_MIGRATION_AND_WEBSITE_INTEGRATION.md`.
>
> This is the **single source of truth**. Unlike the source docs, every claim below was re-verified
> against the live codebase on 2026-06-12 (`git` clean, `main`). Where the source docs were stale,
> the correction is called out in §1.

---

## 1. Reality Check — Source Docs vs Actual Codebase (2026-06-12)

The migration plan in the docx/Notion was written against a June 9 snapshot. The code has since advanced.
**Several "to-do" items are already done.** Plan from *this* table, not the older numbers.

| Claim in source docs | Actual state today | Impact on plan |
|---|---|---|
| 19 migrations | **29 migrations** (latest `20260608000000_add_project_approved_budget`) | Counts only; no action |
| 32 NestJS modules | **40 modules** registered in `app.module.ts` | Counts only |
| 35 Prisma models | **62 models**, schema 1,961 lines | Counts only |
| Pending migration `20260608000000` "has local uncommitted edits (M)" | ✅ **Resolved** — committed, `git status` clean | **Drop this P0** |
| CORS "needs comma-split fix" | ✅ **Already done** — `main.ts:30` `config.get('CORS_ORIGINS', frontendUrl).split(',')` | **Drop this P1** |
| Swagger "set `SWAGGER_ENABLED=false` in prod" | ✅ **Already dev-gated** — `main.ts:52` guards Swagger behind non-prod | Verify env only |
| Add `slug`, `location` to Project | ✅ **Already exist** — `schema.prisma:153-154` | Remove from migration |
| `connection_limit` missing on DATABASE_URL | ✅ Present (`=10`, Supabase pooler) | Lower to `5` for RDS t3.micro |
| Current DB "local Docker / Supabase" | Prod runs on **Supabase pooler, ap-south-1 (Mumbai)** | Region decision — see §3.0 |

### Pre-migration hardening — ✅ DONE (2026-06-12)
These in-repo code issues were fixed before starting the AWS work. Verified: API builds clean; encryption round-trip + backward-compat + rotation tested; env-validation tested.
- ✅ **CI/CD** — `.github/workflows/deploy.yml` added: a `ci` job (build API + web, `prisma validate`) runs on every push/PR now; `deploy-api`/`deploy-web` jobs are dormant behind repo var `DEPLOY_ENABLED=true` until AWS exists.
- ✅ **Boot env validation** — `common/config/env.validation.ts` wired into `ConfigModule` (`app.module.ts`); missing/malformed `DATABASE_URL`/`JWT_ACCESS_SECRET`/`ENCRYPTION_KEY`/`GOOGLE_*` now fail fast at startup.
- ✅ **Encryption key rotation** — `EncryptionService` now writes versioned ciphertext (`<keyId>:…`), decrypts legacy unversioned rows, and supports `ENCRYPTION_KEY_RETIRED` for zero-downtime rotation.
- ✅ **Lead-intake throttle** — `@Throttle({ medium: { limit: 5, ttl: 60_000 } })` on `LeadsController.create` (the path the public site reuses).
- ✅ **QuickBooks feature flag** — `QB_ENABLED` (default off) guards all Intuit calls so unverified creds can't 401 into Contracts/Actuals; surfaced in `/quickbooks/status`.
- ✅ **Structured JSON logging** — `JsonLogger` emits one JSON line per log in production (CloudWatch-queryable); pretty logs in dev.
- ✅ **Frontend error boundary** — already wired (`ProtectedRoute` → `<ErrorBoundary>`).

### Migration code prep — ✅ DONE (2026-06-12, dual-driver, non-breaking)
The provider swaps are written behind env flags; the current Supabase/SMTP path stays the default, so nothing breaks before cutover. Verified: API builds; driver selection tested (default→supabase/smtp, flag→s3/ses).
- ✅ **Storage S3 driver** — `STORAGE_DRIVER=supabase|s3`. `StorageService` keeps path-building and delegates to `SupabaseStorageDriver` / `S3StorageDriver` (`@aws-sdk/client-s3` + presigner). At cutover: copy objects, set `STORAGE_DRIVER=s3` + `S3_BUCKET`/`AWS_REGION`/`S3_PUBLIC_BASE_URL`.
- ✅ **Email SES driver** — `MAIL_DRIVER=smtp|ses`. `createMailer()` returns `SmtpMailer` (nodemailer) or `SesMailer` (`@aws-sdk/client-ses`). At cutover: verify SES domain, set `MAIL_DRIVER=ses` + `AWS_REGION`.
- ✅ `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/client-ses` added.
- ⚠️ One follow-up at S3 cutover: the **frontend presigned-upload flow** uses Supabase's `token`; for S3 the browser does a plain `PUT` to `uploadUrl` (token is `''`). Adjust the web upload helper when flipping to S3.

### Still-valid gaps (Phase 2 — net-new, after migration)
- ❌ No `PublicModule` (`/api/public/*`) — Phase 2 (§5.2).
- ❌ `Project` missing public-website fields and `WebsiteSettings`/`Testimonial` models — Phase 2 (§5.1).

---

## 2. Target Architecture

```
                        ┌──────────────────── AWS Account (1 region) ─────────────────────┐
                        │                                                                  │
 theprimedeveloper.com  │   ┌──────────────────┐        ┌──────────────────────────────┐  │
 (public marketing)  ───┼─► │  AWS Amplify     │        │  EC2 t3.micro (Ubuntu 22.04) │  │
                        │   │  Next.js SSR/ISR │        │  ├─ NestJS API  :3001 (PM2)   │  │
 app.theprimedeveloper  │   └────────┬─────────┘        │  ├─ Redis 7     :6379 (Docker)│  │
 .com (internal SPA) ───┼─► CloudFront│──► S3 (app)     │  └─ Nginx reverse proxy + TLS │  │
                        │   └──────────────────┘        └───────────────┬──────────────┘  │
 api.theprimedeveloper  │                                               │ private subnet  │
 .com (NestJS) ─────────┼──────────────────────────────► EC2 Elastic IP│                 │
                        │   ┌──────────────────┐        ┌───────────────▼──────────────┐  │
                        │   │ S3 media (public)│        │  RDS PostgreSQL 15           │  │
                        │   │ S3 docs (private)│        │  db.t3.micro · 20GB · 1-AZ   │  │
                        │   └──────────────────┘        └──────────────────────────────┘  │
                        │   SES (email) · SSM Parameter Store (secrets) · ACM (TLS)        │
                        │   Route 53 (DNS) · CloudWatch (logs + billing alarm)             │
                        └──────────────────────────────────────────────────────────────────┘
```

### Subdomain routing
| Subdomain | AWS service | Serves | Phase |
|---|---|---|---|
| `theprimedeveloper.com` | Amplify Hosting | Public Next.js site (SSR/ISR) | Phase 2 |
| `app.theprimedeveloper.com` | CloudFront → S3 | React SPA (Prime Tracker, 30 staff, RBAC) | **Migrate now** |
| `api.theprimedeveloper.com` | Nginx → EC2 | NestJS API (`/api/*` internal + `/api/public/*`) | **Migrate now** |

### Service mapping
| Concern | Today | Target (AWS) | Year-1 cost |
|---|---|---|---|
| API host | Render / Supabase region | EC2 t3.micro + PM2 + Nginx | Free (750 hrs/mo) |
| Database | Supabase pooler (ap-south-1) | RDS PostgreSQL 15 db.t3.micro, 1-AZ, 20 GB | Free (750 hrs/mo) |
| Job queue / cache | Render Redis (25 MB cap) | Redis 7 Docker sidecar on EC2 | Free (same box) |
| Internal SPA | Firebase / Render Static | S3 + CloudFront | Free (1 TB/mo) |
| Public website | Not built | AWS Amplify Hosting | Free (15 GB/mo) |
| File storage | Supabase Storage | S3 ×2 (`-media` public, `-documents` private) | Free (5 GB) |
| Email | Nodemailer SMTP | SES (from EC2) | Free (62k/mo) |
| Secrets | `.env` | SSM Parameter Store (SecureString) | Free |
| TLS | Let's Encrypt | ACM wildcard `*.theprimedeveloper.com` | Free |
| CI/CD | Manual | GitHub Actions | Free (2k min/mo) |
| DNS | — | Route 53 hosted zone | $0.50/mo |

---

## 3. Migration Steps (grouped, with verified commands)

### 3.0 Region — ✅ DECIDED: `us-east-1` (N. Virginia)
Chosen 2026-06-12. All AWS resources (EC2, RDS, S3, SES, ACM, Route 53 zone records) go in `us-east-1`.
Note: prod DB currently lives in **ap-south-1 (Mumbai)** on Supabase, so the database content makes a
one-time Mumbai→us-east-1 hop during migration (§3.1). EC2 and RDS stay co-located in `us-east-1` —
do not split them across regions.

### 3.1 RDS PostgreSQL (replaces Supabase pooler)
- `db.t3.micro`, PostgreSQL 15, 20 GB GP3, **Single-AZ**, automated daily snapshots (7-day retention, free).
- Security group: inbound `5432` **only** from the EC2 security group — never `0.0.0.0/0`.
- Connection string (lower the pool for a micro box, ~25 conn max):
  `...&schema=public&connection_limit=5&pool_timeout=10`
- Apply schema — **no model changes needed**, all 29 migrations apply clean:
  ```bash
  npx prisma migrate deploy        # applies all 29 migrations
  pnpm run db:seed                 # one-time, demo/lookup data only
  npx prisma migrate status        # confirm "Database schema is up to date"
  ```

### 3.2 EC2 t3.micro (NestJS API + Redis sidecar + Nginx)
- Ubuntu 22.04 LTS, Elastic IP, Node 20, pnpm 10, PM2, Docker.
- Redis (password-protected, loopback-bound):
  ```bash
  docker run -d --name redis --restart unless-stopped \
    -p 127.0.0.1:6379:6379 redis:7-alpine \
    redis-server --requirepass "$REDIS_PASSWORD" --appendonly yes
  ```
- API process: `pm2 start apps/api/dist/main.js --name prime-api && pm2 save && pm2 startup`
- Nginx: reverse-proxy `api.theprimedeveloper.com` → `127.0.0.1:3001`, TLS via ACM (or certbot if not behind CloudFront).
- Set `REDIS_URL=redis://:<pw>@localhost:6379`.

### 3.3 S3 + CloudFront (internal React SPA)
- Bucket `prime-tracker-app` (private) + CloudFront w/ Origin Access Control.
- SPA routing: CloudFront custom error **403 → `/index.html`** (200).
- `PriceClass_100`. Domain `app.theprimedeveloper.com` via ACM + Route 53 alias.

### 3.4 S3 media buckets (replaces Supabase Storage) — ✅ code done, config at cutover
- `prime-tracker-media` — public-read, served via CloudFront (project photos, galleries, covers).
- `prime-tracker-documents` — private, **presigned URLs (15 min)**, versioning on.
- Code: ✅ done — `StorageService` + `S3StorageDriver` (`@aws-sdk/client-s3` + presigner). Activate with
  `STORAGE_DRIVER=s3`, `S3_BUCKET=…`, `AWS_REGION=…`, optional `S3_PUBLIC_BASE_URL=…` (CloudFront).
- Remaining at cutover: one-time copy of existing Supabase objects → S3, flip the env, adjust the
  web presigned-upload helper (S3 = plain `PUT`, no token).

### 3.5 SES (replaces Nodemailer SMTP) — ✅ code done, config at cutover
- Verify domain `theprimedeveloper.com` in SES; request production access (exit sandbox).
- Code: ✅ done — `createMailer()` + `SesMailer` (`@aws-sdk/client-ses` `SendEmailCommand`); the 12
  notification types and HTML template are unchanged. Activate with `MAIL_DRIVER=ses`, `AWS_REGION=…`,
  `SMTP_FROM=…` (used as the SES `Source`; must be a verified identity).

### 3.6 SSM Parameter Store (secrets)
- Move from `.env`: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`,
  `GOOGLE_CLIENT_SECRET`, `QB_CLIENT_SECRET`, `REDIS_PASSWORD` as `SecureString`.
- EC2 instance role gets `ssm:GetParameter`/`GetParametersByPath` scoped to `/prime-tracker/*`. No keys in the repo.

### 3.7 Route 53 + ACM
- One hosted zone. ACM wildcard `*.theprimedeveloper.com` (auto-renew).
- Records: apex → Amplify, `app` → CloudFront, `api` → EC2 Elastic IP.

---

## 4. CI/CD — GitHub Actions (`.github/workflows/deploy.yml`)

Currently fully manual. Add on push to `main`:

```yaml
name: Deploy
on: { push: { branches: [main] } }
jobs:
  deploy-api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 10 }
      - run: pnpm install && pnpm --filter api run build
      - name: Deploy to EC2
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ubuntu
          key: ${{ secrets.EC2_SSH_KEY }}
          script: |
            cd /home/ubuntu/prime-tracker
            git pull origin main
            pnpm install
            pnpm --filter api run build
            npx prisma migrate deploy
            pm2 restart prime-api
  deploy-web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 10 }
      - run: pnpm install && pnpm --filter web run build
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}
      - run: aws s3 sync apps/web/dist/ s3://prime-tracker-app/ --delete
      - run: aws cloudfront create-invalidation --distribution-id ${{ secrets.CF_DIST_ID }} --paths "/*"
```

Secrets to add: `EC2_HOST`, `EC2_SSH_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `CF_DIST_ID`.

---

## 5. Phase 2 — Public Website Enablement (API side)

The Next.js public site (`theprimedeveloper.com`) is a **separate repo**; this section is only the
Prime Tracker API work that unblocks it.

### 5.1 Schema migration `20260612000000_add_public_website_fields`
`Project` already has `slug` (unique) and `location` — **do not re-add them.** Add only:
```prisma
// Project model — public website fields
isPublished     Boolean   @default(false)
heroImageUrl    String?
amenities       String[]  @default([])
metaDescription String?
possessionDate  DateTime?
launchDate      DateTime?
brochureGated   Boolean   @default(false)
websiteViews    Int       @default(0)
```
```sql
ALTER TABLE "Project"
  ADD COLUMN "isPublished"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "heroImageUrl"    TEXT,
  ADD COLUMN "amenities"       TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "metaDescription" TEXT,
  ADD COLUMN "possessionDate"  TIMESTAMP(3),
  ADD COLUMN "launchDate"      TIMESTAMP(3),
  ADD COLUMN "brochureGated"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "websiteViews"    INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "Project_isPublished_idx" ON "Project"("isPublished");
```
Plus new models `WebsiteSettings` (WhatsApp #, contact, social links) and `Testimonial`.
The `Lead` model is already website-ready (`source = WEBSITE` enum exists) — verify UTM fields, add if missing.

### 5.2 New `PublicModule` (`apps/api/src/modules/public/`) — **no auth guard**
| Method | Endpoint | Auth | Rate limit | Returns |
|---|---|---|---|---|
| GET | `/api/public/projects` | none | 30/min | Published projects (filters: type/location/status) |
| GET | `/api/public/projects/:slug` | none | 30/min | Detail: project + buildings + unit stats + public docs |
| GET | `/api/public/stats` | none | 10/min | `{ totalProjects, totalUnits, portfolioValueM }`, Redis-cached 60s |
| POST | `/api/public/leads` | none | **5/min/IP** | Create `Lead` (WEBSITE) → SES to admin + prospect → LeadActivity |
| GET | `/api/public/projects/:id/brochure` | none/session | 10/min | Presigned S3 URL; gated if `brochureGated` |
| POST | `/api/public/revalidate` | shared secret | 10/min | ISR webhook on publish |
| GET | `/api/public/testimonials` | none | 10/min | Visible testimonials |

**Hardening required before going public:** add `@Throttle(5, 60)` to `POST /api/public/leads`
(the existing `LeadsController` has none) + reCAPTCHA v3 + honeypot.

**What stays internal-only:** budgets, commitments, actuals, contracts, loans, draws, investors,
cashflow, daily logs, interior, tasks, comments, milestone dependencies, QuickBooks, audit log.

---

## 6. Security / Hardening Backlog (from code review)

| Pri | Item | Where | Status |
|---|---|---|---|
| 🔴 | Env-var validation at boot — missing secrets fail fast | `common/config/env.validation.ts`, `app.module.ts` | ✅ Done |
| 🔴 | Encryption key **versioning** + rotation path for loan AES fields | `common/encryption/encryption.service.ts` | ✅ Done (move key to SSM at cutover) |
| 🟠 | `@Throttle` on lead intake before public exposure | `leads.controller.ts` | ✅ Done |
| 🟠 | Guard QuickBooks behind `QB_ENABLED` flag until verified against live creds | `quickbooks.service.ts` | ✅ Done |
| 🟡 | Structured JSON logging for CloudWatch queryability | `common/logging/json.logger.ts`, `main.ts` | ✅ Done (dependency-free, prod-only) |
| 🟡 | Route-level `<ErrorBoundary>` | `apps/web` (`ProtectedRoute`) | ✅ Already present |
| ✅ | CORS multi-origin split | `main.ts:30` | ✅ Already present |
| ✅ | Swagger dev-only | `main.ts:53` | ✅ Already present |

---

## 7. Cost

**Year 1 (free tier):** EC2 + RDS + S3 + CloudFront + Amplify + SES + ACM + SSM + GitHub Actions all $0;
only **Route 53 ≈ $6/year**.

**Year 2+ (post free tier, 1-yr No-Upfront reserved):**
EC2 t3.micro ~$5 · RDS db.t3.micro ~$12 · RDS storage ~$1.15 · S3+CloudFront ~$2–3 · Amplify ~$0.50 ·
SES ~$0.05 · Route 53 ~$0.50 → **~$21–23/month**.

> **Month-11 action:** buy EC2 + RDS 1-yr reserved (No Upfront) before free tier expires; set a
> CloudWatch billing alarm at $30/mo.

---

## 8. Execution Order

> **Pre-migration hardening (CI/CD, env validation, key rotation, throttle, QB flag, JSON logging): ✅ complete — see §1.** The list below is the AWS migration itself.

| # | Task | Effort | Blocks |
|---|---|---|---|
| 1 | 🔴 Pick AWS region (§3.0) | 15 min | Everything |
| 2 | ✅ ~~GitHub Actions CI/CD~~ — done; set repo var `DEPLOY_ENABLED=true` once infra exists | — | — |
| 3 | 🔴 AWS setup: RDS + EC2 + S3 + SES + Route 53 + ACM | ~1 day | Everything |
| 4 | 🔴 `prisma migrate deploy` to RDS (29 migrations) | 30 min | Cutover |
| 5 | ✅ ~~Storage→S3 code~~ done — at cutover: copy objects, set `STORAGE_DRIVER=s3`, tweak web upload helper | 1 hr | Media/docs |
| 6 | ✅ ~~SMTP→SES code~~ done — at cutover: verify SES domain, set `MAIL_DRIVER=ses` | 1 hr | Email |
| 7 | 🟠 Move secrets to SSM (env validation ✅ already added) | 2 hrs | Safe boots |
| 8 | 🟠 DNS cutover + smoke test, then decommission Supabase/Render | 2 hrs | Go-live |
| 9 | 🟡 Migration `20260612000000_add_public_website_fields` + models | 2 hrs | Website data |
| 10 | 🟡 Build `PublicModule` + `@Throttle` on leads | 1 day | Website reads |
| 11 | 🟡 Next.js public site (separate repo, SOW scope) | 8–10 wks | — |
| 12 | 🟢 Pino logging · key versioning · reCAPTCHA · ISR webhook | — | Hardening |

### Pre-cutover checklist
- [ ] `npx prisma migrate status` clean against RDS
- [ ] RDS SG: only EC2 SG can reach 5432
- [ ] `DATABASE_URL` has `connection_limit=5&pool_timeout=10`
- [ ] Redis launched with `--requirepass`; `REDIS_URL` set
- [ ] `CORS_ORIGINS` includes `https://theprimedeveloper.com` (split logic already present)
- [ ] Set `STORAGE_DRIVER=s3` + `S3_BUCKET`/`AWS_REGION`/`S3_PUBLIC_BASE_URL`; copy Supabase objects across
- [ ] Set `MAIL_DRIVER=ses` + `AWS_REGION`; `SMTP_FROM` is a verified SES identity
- [ ] All secrets in SSM, none in repo `.env` (boot env-validation will fail fast if any required one is missing)
- [ ] SES domain verified + out of sandbox
- [ ] `QB_ENABLED` left `false` until QB verified against live creds
- [ ] Google OAuth callback URL updated to prod domain
- [ ] `NODE_ENV=production` (enables JSON logging + disables Swagger)
- [ ] PM2 restart-on-crash + log rotation; daily RDS snapshots on
- [ ] CloudWatch billing alarm set; set repo var `DEPLOY_ENABLED=true` to arm CI/CD deploys

---

*Prepared by Asan Innovators. Counts and code references verified against the Prime Tracker repo at
commit on `main`, 2026-06-12.*
