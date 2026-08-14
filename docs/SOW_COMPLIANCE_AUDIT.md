# SOW Compliance Audit — Prime Tracker

**SOW audited:** `Prime_Tracker_SOW.pdf` v4.0 (dated 2026-03-28, 19 pages)
**Codebase audited:** `prime-tracker-main` @ `main` (f610211 + uncommitted work), 2026-08-12
**Method:** every SOW deliverable (D1–D13) and feature module (§8) traced to code. Test suite executed with coverage.

---

## Verdict at a glance

| # | Deliverable | Status |
|---|---|---|
| D1 | Database Schema | ✅ Complete (exceeded) |
| D2 | NestJS REST API | ⚠️ Complete in substance, 3 standards gaps |
| D3 | React Frontend | ⚠️ Complete in substance, 3 gaps |
| D4 | Auth System | ⚠️ **Two acceptance criteria unmet** |
| D5 | QuickBooks Integration | ❌ **Partial — half the sync is a no-op** |
| D6 | Notification System | ⚠️ Exceeded on coverage, wrong mechanism |
| D7 | Budget Alert System | ⚠️ Partial |
| D8 | Rent Roll Snapshots | ❌ **Not built** |
| D9 | Comments Module | ✅ Complete (exceeded) |
| D10 | Audit Log | ⚠️ App-level only, DB-level gate missing |
| D11 | Test Suite | ❌ **28% coverage vs >80%; no integration tests; CI doesn't run tests** |
| D12 | Production Infra | ⚠️ Substituted (AWS instead of Docker/Nginx) |
| D13 | Documentation | ✅ Complete |

**Bottom line:** the product scope in §8 is delivered and heavily exceeded — the codebase has 36 API modules against the SOW's 9, and 12 substantial features that were never in the SOW at all. What is *not* delivered is a specific set of **infrastructure and engineering-standards commitments**: the BullMQ/Redis background layer, httpOnly cookies, server-enforced MFA, rent-roll snapshots, the QuickBooks sync's write path, and the test-coverage bar.

---

## D1 — Database Schema ✅

| SOW asked | Found |
|---|---|
| Prisma v5 schema, 15+ models | ~80 models, ~2,100 lines |
| All migrations run cleanly | 57 migrations, `migration_lock.toml` present |
| Seed creates 12-role test users | `prisma/seed-demo-users.ts` creates all 12 |
| No orphan constraints | Partial unique indexes used correctly for soft-delete |

Enum has 13 roles (`CLIENT` added for the buyer portal). Full asset hierarchy Organization → Project → Building → Unit as specified.

---

## D2 — NestJS REST API ⚠️

**Delivered:** 36 domain modules (SOW scoped 9). Global `ValidationPipe` with `whitelist: true, forbidNonWhitelisted: true`. `@RequirePermissions()` guards throughout. Swagger auto-generated from decorators.

**Gaps against §14.1 API Standards:**

1. **No `/api/v1` versioning prefix.** `main.ts:78` sets `app.setGlobalPrefix('api')`. SOW: *"API versioning prefix: /api/v1/ — breaking changes require a new version."* Every route is unversioned, so a breaking change has nowhere to go.
2. **No consistent `{ success, data, error, meta }` response envelope.** Controllers return raw objects/arrays. Four scattered `{ success: true }` returns exist; there is no interceptor enforcing the pattern.
3. **No global exception filter.** Zero `ExceptionFilter` implementations in `apps/api/src`. SOW §9.2 and §14.1 both require Prisma exceptions to be normalised through one — today a Prisma error surfaces as a raw Nest 500.
4. **Swagger is disabled in production** (`main.ts:91`). Defensible security-wise, but D2's acceptance criterion is "Swagger docs auto-generated" — confirm the client accepts staging-only docs.

---

## D3 — React Frontend ⚠️

**Delivered:** 31 pages, HeroUI + Tailwind v4, TanStack Query v5, Zustand, Recharts, React Router v6 with `ProtectedRoute` permission gating. Project detail has **13** tabs (SOW specified 11).

**Gaps:**

1. **No code splitting.** `grep -c "lazy(" src/App.tsx` → **0**. All 31 pages are statically imported at the top of `App.tsx`. SOW §5.2 and §14.2: *"Component-level code splitting via React Router v6 lazy() — only accessible modules bundled per role"*; D3 acceptance explicitly lists *"code splitting active."* A Viewer downloads the entire admin and finance bundle.
2. **No optimistic UI.** `grep -rn "onMutate" apps/web/src` → **0 files**. SOW §5.2 and §14.2: *"All forms use optimistic UI via TanStack Query mutations — success rendered before network confirmation."* Every form waits on the round trip.
3. **4 role dashboards, not 7.** Built: Founder, Finance, Construction, Sales. SOW §8.1 also specifies **AR/AP**, **Legal**, and **Viewer** dashboards. `App.tsx:61-70` routes `AR_AP` → Finance dashboard, `LEGAL` → `/projects`, `VIEWER` → the generic `DashboardPage`.

---

## D4 — Auth System ⚠️ (two acceptance criteria unmet)

**Delivered:** Google OAuth with `GOOGLE_ALLOWED_DOMAIN` enforcement (`auth.service.ts:136`), JWT 15m access / 7d refresh, TOTP MFA setup/enable/verify endpoints, `PermissionsGuard` with a full per-role permission matrix in `packages/shared/src/types/index.ts`, Viewer restricted to 6 view-only permissions (API-enforced), throttling on login/refresh/mfa-verify, `DEMO_MODE` production kill-switch in `main.ts:34`.

**Gaps:**

1. ❌ **No httpOnly cookies.** `grep -rn "httpOnly\|cookieParser" apps/api/src` → **zero matches**. Tokens are returned in the JSON body and persisted to `localStorage` by Zustand. The SOW specifies httpOnly cookies in five separate places (§2, §4.2, §4.3, §9.1, D4) and states the reason: *"(XSS protection)"*. This is the single largest deviation from the security architecture as written.
2. ❌ **MFA is not server-enforced on financial/admin routes.** `MfaGuard` and `@RequireMfa()` both exist and are correct — but `MfaGuard` is wired into exactly **one** controller: `custom-options.controller.ts:21`. Loans, draws, budgets, users/admin, and QuickBooks controllers have no MFA gate. D4 acceptance: *"MFA gate is server-enforced"*; §9.1: *"Enforced specifically for Finance, Super Admin, and Founder roles on sensitive financial/admin API routes."*
3. ⚠️ **Login rate limit is looser than specified.** `auth.controller.ts:32` → 10 requests / 60s. SOW §9.2: *"/auth/login (5 req/15min/IP)."*

---

## D5 — QuickBooks Integration ❌ (partial)

**Delivered:** OAuth connect/callback, AES-256-GCM encrypted token storage with refresh, `QBConnection` / `QBProjectMapping` / `QBSyncLog` models, manual sync endpoint, admin UI connect button, and the idempotency constraint (`Actual.qbTxnId @unique`, `schema.prisma:653`).

**Gaps:**

1. ❌ **`syncVendors()` and `syncPayments()` write nothing.** Both fetch from QB, log a count, and return it (`quickbooks.service.ts:242-249, 285-290`). Only `syncBills()` persists. Two thirds of the advertised sync surface is a stub.
2. ❌ **Not queued.** No BullMQ. `POST /quickbooks/sync` runs the entire sync inline on the HTTP request. SOW §7.1: *"Queue-based + daily."*
3. ❌ **No daily CRON sync** — manual trigger only.
4. ❌ **Idempotency is skip-only, not upsert.** `quickbooks.service.ts:261` does `if (existing) continue;`. SOW §4.5: *"new → INSERT, existing → UPDATE if changed."* Amended bills in QuickBooks never propagate.
5. ❌ **No retry/DLQ.** SOW §4.5: *"3 retry attempts (exponential backoff) → Dead Letter Queue → admin alert notification."* None exists.
6. ❌ **No QuickBooks-sync-failure notification.** It is 1 of the 8 triggers in §8.7; no such value in the `NotificationType` enum.
7. ❌ **`QBSyncLog` does not store payloads.** It records `syncType/status/recordsFound/recordsSynced/errors`. SOW §7.2 and D5: *"preserves full request/response for audit and debugging."*
8. 🐛 **Bug — unmapped bills abort the sync.** `quickbooks.service.ts:267` creates the `Actual` with `projectId: projectMapping?.projectId || 'UNMAPPED'`. `'UNMAPPED'` is not a real Project id, so the FK raises Prisma P2003 and the whole sync throws on the first bill that has no Class/Location mapping — which is the normal state before mappings are configured.

> The SOW also calls this sync "bidirectional" (§4.1, §7.1). Only the inbound direction is implemented. Worth confirming which direction the client actually needs before quoting the fix.

---

## D6 — Notification System ⚠️

**Delivered — and well past scope:** 27 `NotificationType` values against the SOW's 8 triggers, in-app bell + email (nodemailer SMTP *and* an AWS SES driver in `mailer.ts`), per-user per-type preferences, a `dedupeKey` column with a 24h window, and a **Socket.IO gateway** (`notifications.gateway.ts`) — real-time push, which the SOW listed as a *future roadmap* item (§17).

**Gaps:**

1. ❌ **No BullMQ.** `bullmq` and `@nestjs/bullmq` are in `package.json` but **never imported**. `app.module.ts` registers `ScheduleModule` only. All 7 background jobs are in-process `@Cron` decorators. SOW §7 describes the entire background layer as *"Redis-backed BullMQ."*
2. ❌ **No Redis.** `CacheService` is an in-memory `Map` — its own header comment says so (`cache.service.ts:8-17`). Consequences: dedup state and KPI cache are lost on restart, and the app cannot run more than one instance without duplicate alerts. The `redis:7-alpine` container in `infra/docker/docker-compose.yml` is started but nothing connects to it.
3. ❌ **QuickBooks sync failure trigger missing** (7 of 8 SOW triggers present).

---

## D7 — Budget Alert System ⚠️

`budgets/variance-alert.cron.ts` implements daily variance detection with a 24h dedup key and a clear-on-recovery path — the logic is sound and well documented.

**Gaps:**
- **Single 10% threshold**, hardcoded (`DEFAULT_THRESHOLD_PCT = 10`). D7 acceptance: *"threshold alerts at 10/20/30%"* and *"Alerts at correct thresholds."*
- **Dedup key lives in the in-memory cache**, not Redis (§4.6 specifies `budget_alert:{projectId}:{threshold_bucket}` with a Redis TTL). Restart the API and every alert re-fires.
- §4.6 specifies the check runs on *"any financial write"*; the implementation is a daily sweep.

---

## D8 — Rent Roll Snapshots ❌ NOT BUILT

The `RentRollSnapshot` model exists in `schema.prisma` — and has **zero references anywhere in `apps/api/src` or `apps/web/src`**. Nothing writes it, nothing reads it.

What exists instead is `LeasesService.getRentRoll()` (`leases.service.ts:119`), a live computation with an `asOf` parameter, exposed at `GET /api/leases/rent-roll`. It's good code and well tested — but it is not what D8 specifies.

Missing against D8 acceptance (*"Snapshots generated on schedule; historical records queryable; no data loss on retry"*):
- no scheduled worker
- no persisted historical snapshots
- no period-over-period comparison
- §16 lists rent-roll snapshots as the stated mitigation for the "deeply nested Prisma queries / performance degradation under load" risk — that mitigation is not in place.

---

## D9 — Comments Module ✅

Marketing/Sales/Financial categories, project + unit + task threads, RBAC-scoped, and **beyond scope**: `@mention` parsing (`comments/mentions.ts`) with a dedicated `COMMENT_MENTION` notification type that routes to the person rather than the department.

---

## D10 — Audit Log ⚠️

**Delivered:** `AuditEvent` model with actor / action / entity / oldValues / newValues / IP / userAgent, deliberately no `updatedAt`, `AuditInterceptor` applied to **29 of 36** controllers.

**Gap:** D10 acceptance is *"No UPDATE/DELETE possible on audit_logs table"* and §14.3 extends it to `actuals`: *"application user has no UPDATE or DELETE privilege on these tables."* There is **no `REVOKE`, trigger, or rule in any of the 57 migrations** — append-only is enforced by convention in the application layer only. Any code path (or anyone with the app's DB credentials) can rewrite audit history.

Also worth closing: the 7 controllers without the interceptor should be reviewed to confirm none of them perform financial writes.

---

## D11 — Test Suite ❌

Executed `npx jest --coverage`:

```
Test Suites: 24 passed, 24 total
Tests:       539 passed, 539 total
All files    | 28.02% stmts | 33.38% branch | 23.88% funcs | 28.95% lines
```

| D11 acceptance criterion | Actual |
|---|---|
| >80% coverage on **auth** | `auth.service.ts` — **50.45%** ❌ |
| >80% coverage on **encryption** | `encryption.service.ts` — **82.6%** ✅ |
| >80% coverage on **projects service** | `projects.service.ts` — **52.7%** ❌ |
| Overall (SOW go-live gate: >80%) | **28.02%** ❌ |
| Integration tests via **Supertest** | ❌ `supertest` is not a dependency; zero `.e2e-spec.ts` files exist (`test/jest-e2e.json` is an empty config shell) |
| **All tests pass in CI** | ❌ `.github/workflows/deploy.yml` runs `prisma validate` + builds API and web. It never runs `jest`. |

The 539 tests that do exist are high quality and cover the hard business logic (lease rent periods, cashflow engine, interior state machine, notification dedup). The gap is controllers, DTOs, and the whole HTTP layer — no request ever traverses a guard in a test.

---

## D12 — Production Infra ⚠️ (substituted)

| SOW specified | Delivered |
|---|---|
| Docker Compose (prod) | AWS: EC2 + RDS via Terraform (`infra/terraform/`, 17 `.tf` files) |
| Nginx | EC2 user-data / CloudFront |
| SSL via Let's Encrypt | ACM (`acm.tf`) |
| `pg_backup` sidecar, daily backups confirmed | RDS automated backups — **verify retention is actually enabled** |
| Health check endpoint | ✅ `GET /api/health` + `/api/health/ready` with DB probe |
| Deploys from `docker compose up` | GitHub Actions → SSH to EC2 + S3/CloudFront for web |

`infra/docker/docker-compose.yml` is **local dev only** (Postgres + Redis, no app services). This is a defensible upgrade over the SOW's spec, but it *is* a substitution — get it acknowledged in writing so D12 sign-off isn't contested. The two things to actually confirm: RDS backup retention, and that the Redis container being unused doesn't mislead anyone reading the compose file.

---

## D13 — Documentation ✅

`RUNBOOK.md` (280 lines: structure, quick start, migrations, seed, testing, QuickBooks sandbox setup), Swagger, plus a `docs/` tree well beyond scope — user manual, QA testing guide, feature inventory, client-discovery specs, and AWS migration runbooks.

---

## §8 Feature-module spot checks

| Module | Status | Notes |
|---|---|---|
| 8.1 Dashboards | ⚠️ 4 of 7 | Missing AR/AP, Legal, Viewer dashboards |
| 8.2 Projects (11 tabs) | ✅ **13 tabs** | Adds `budget` and `activity` |
| 8.3 Financial | ✅ | Budgets + revisions, commitments, contracts + change orders + **retainage**, loans AES-256-GCM, multi-step draw approvals, all 5 SOW reports present. ⚠️ `DrawStatus` has no `POSTED` — the lifecycle stops at `FUNDED` (SOW §8.3/§8.5 specify *Draft → Submitted → Approved → Funded → **Posted***) |
| 8.4 Sales & CRM | ⚠️ | Lead pipeline, activity timeline, campaign/UTM attribution, `convertToSale()` ✅. **`convertToLease()` does not exist** — §8.4 and §3.3 both promise auto-conversion to *"either a Sale record or a Lease record."* **Unit locking ✅** — genuinely well done: partial unique indexes `units_building_number_active_key` and `lease_unit_active_unique` plus `$transaction` + `updateMany` guards in `sales.service.ts:232` / `units.service.ts:190` |
| 8.5 Construction | ✅ exceeded | Milestones w/ DAG dependencies + photos, vendors, contracts/change orders, draws, document repo — **plus** daily logs with photos, the interior/fit-out module, and snagging |
| 8.6 Admin | ✅ | User mgmt, role matrix, QB config + sync logs, audit log, org config |
| 8.7 Notifications | ⚠️ | 7 of 8 triggers (QB sync failure missing); see D6 |

---

## Built but never in the SOW (scope credit)

Useful when negotiating the gaps above — this is unbilled scope already delivered:

Interior / fit-out module (7 phases, TI budget, package templates, handover) · Sale payment schedules · Daily construction logs with photos · Snagging / punch lists · Brokers + commission tracking · Cashflow engine + forecast · Unit merge / grouping · Document vault with versioning + client visibility · Investors, equity positions, capital calls, distributions · Custom options (runtime-configurable enums) · Unit status history / event ledger · Lease depth: rent periods, obligations, invoices, rent collection · Real-time WebSocket notifications (SOW §17 roadmap item) · Project health scoring · Exceptions feed · Multi-org support

---

## Recommended remediation order

**P0 — security commitments the SOW made explicitly**
1. Move JWTs to httpOnly cookies (D4, §9.1) — or get the localStorage approach accepted in writing.
2. Apply `MfaGuard` + `@RequireMfa()` to loans, draws, budgets, users, and quickbooks controllers (D4).
3. `REVOKE UPDATE, DELETE ON audit_events, actuals FROM <app_user>` as a migration (D10, §14.3).

**P1 — broken or absent functionality**
4. Fix the `'UNMAPPED'` FK bug, then implement the vendor and payment write paths (D5).
5. Build the rent-roll snapshot worker (D8) — also the §16 performance mitigation.
6. Add the QB sync failure notification type + trigger (D6/§8.7).
7. Add `convertToLease()` (§8.4).

**P2 — the standards bar**
8. Decide on BullMQ + Redis vs. formally amending the SOW to in-process cron + in-memory cache. Multi-instance deployment is blocked either way.
9. Run `jest` in CI; raise coverage on auth/projects; add Supertest integration tests for guarded routes (D11).
10. `lazy()` route splitting and `onMutate` optimistic mutations (D3/§14.2).
11. `/api/v1` prefix, response envelope, global Prisma exception filter (D2/§14.1).
12. 10/20/30% variance threshold buckets (D7).
13. `POSTED` draw status (§8.3).
14. Get the AWS-for-Docker infra substitution acknowledged; confirm RDS backup retention (D12).
