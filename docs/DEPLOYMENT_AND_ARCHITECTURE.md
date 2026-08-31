# Prime Tracker — Deployment, AWS Architecture & Audit Design

Written 2026-08-27 against the **live** environment. Every figure here was measured from
the running account, not taken from the Terraform source — where the two disagree, this
document describes what is actually deployed.

---

## 1. Where production actually is

There are **two AWS accounts**, and only one is live. This trips people up, so it is first:

| | Account | EC2 | App bucket | Status |
|---|---|---|---|---|
| `default` workspace | 221082191502 | 98.89.192.161 | `prime-tracker-app-221082191502` | **Dark** — no response |
| `client` workspace | **056836825737** | **3.232.150.154** | `prime-tracker-app-056836825737` | **LIVE** |

Region **us-east-1**. The client-account migration is complete; the original stack is dead.
Local AWS profiles: `default` points at the *dark* account, `prime-client` at the live one.

Production URL: `https://3-232-150-154.nip.io` — a nip.io hostname derived from the Elastic
IP, with a Let's Encrypt certificate terminated on the box. There is no custom domain in
front of it yet, which makes the EIP load-bearing.

---

## 2. What runs where

```
                    Internet
                       │  :80 → 301 → :443
                       ▼
        ┌──────────────────────────────────┐
        │  EC2 t3.micro · us-east-1a       │
        │  Ubuntu 22.04 · EIP 3.232.150.154│
        │                                  │
        │  nginx ──┬── /            → /var/www/prime-web   (React SPA, static)
        │          ├── /api/        → 127.0.0.1:3001       (proxy)
        │          └── /socket.io/  → 127.0.0.1:3001
        │                                  │
        │  pm2 → "prime-api" (Node 22, NestJS) on :3001
        └───────────────┬──────────────────┘
                        │ 5432, private subnet, SG-to-SG only
                        ▼
        ┌──────────────────────────────────┐
        │  RDS PostgreSQL 15.17            │
        │  db.t3.micro · 20 GB · encrypted │
        │  30-day automated backups        │
        └──────────────────────────────────┘

        S3 · SSM Parameter Store · CloudWatch · SNS  (see below)
```

The SPA and the API are served from the **same origin**. That is deliberate: the client
resolves its base URL to a relative `/api`, nginx proxies it, and there is no CORS surface
to configure and no third-party cookie problem. `VITE_API_BASE_URL` is intentionally empty
in `apps/web/.env.production` — setting it to an absolute URL breaks this.

---

## 3. AWS services in use, and why

| Service | What it does here | Why this and not something else |
|---|---|---|
| **EC2** (t3.micro, 1×) | Runs nginx + the API under pm2 | One small box is the cheapest thing that serves an internal tool for a single company. No container orchestration to operate. |
| **Elastic IP** | Stable address for DNS and the TLS cert | Survives instance stop/start; the nip.io hostname is derived from it. |
| **RDS PostgreSQL 15.17** (db.t3.micro, 20 GB) | The single source of truth | Managed backups, patching and encryption without running a database. Prisma targets Postgres, and several features (RLS, JSONB audit payloads) depend on it. |
| **S3** (3 buckets) | `documents` and `media` hold uploads; `app` is provisioned but empty | Durable object storage outside the instance, so files survive a rebuild. Versioning is **on** for documents and media. |
| **SSM Parameter Store** | 9 parameters under `/prime-tracker/`, 8 of them `SecureString` | Secrets are read **by the instance role at deploy time** to write `apps/api/.env`. Nothing secret lives in the repo or in CI. Chosen over Secrets Manager because it is free at this scale and rotation is not yet needed. |
| **IAM instance role** | Grants `ssm:GetParameter*` on `/prime-tracker/*` only | The box fetches its own configuration. No AWS keys are handed to GitHub Actions for the API deploy. |
| **CloudWatch alarms** (2) | EC2 system-status → **auto-recover**; estimated charges > $60 → SNS | Auto-recover handles host failure without anyone watching. The billing alarm defines the intended cost envelope. |
| **SNS** (`prime-tracker-alarms`) | Alarm fan-out | |
| **VPC / subnets / security groups** | Network isolation | EC2 SG: 80 and 443 from `0.0.0.0/0`, **22 from a single IP** (`49.43.218.254/32`). RDS SG: 5432 **from the EC2 security group only** — no CIDR, so the database is unreachable from the internet. |
| **Let's Encrypt** (on-box, not ACM) | TLS for the nip.io hostname | ACM only attaches to ALB/CloudFront, neither of which exists yet. |

### Provisioned but NOT in use

These exist in Terraform or as empty resources. Knowing they are inert prevents a lot of
wasted debugging:

- **CloudFront** — two distributions are declared; **zero exist**. The `app` S3 bucket is
  empty. The SPA is served by nginx from the instance. A "deploy the web to S3" step
  therefore publishes into a void — this is why `deploy.yml` was rewritten (§4).
- **SES** — the domain identity is declared, but **no identity is verified in us-east-1**.
  Outbound email (notifications) will not send until one is.
- **Redis / ElastiCache** — none exists, and no `redis-server` runs on the box, so
  **BullMQ-backed background jobs are inert**. `REDIS_PASSWORD` sits in SSM with nothing
  to connect to.
- **ACM** — declared for the future domain/CloudFront path.

---

## 4. How deployment works

### CI (runs on every push and PR to `main`)

`install → prisma validate → prisma generate → migrate deploy against a throwaway
Postgres service → API unit tests → API integration tests → web tests → build API →
build web`. Roughly 2,400 API tests and 93 web tests. This proves the migrations apply to
a clean database and that both apps compile — it ships nothing.

### Deploy

Gated on `vars.DEPLOY_ENABLED == 'true'` with `environment: production`.
**Both are currently unset, so no push has ever deployed** — verified across the last 30+
runs on `main`: 28 skipped, 2 cancelled, 0 executed. Releases today are manual (§4.2).

**Rewritten 2026-09-01 to deploy over SSM. Setup runbook:
[`DEPLOY_SSM_SETUP.md`](DEPLOY_SSM_SETUP.md).**

The previous scp/ssh job **could never have worked**, and it is worth understanding why
before trusting any deploy job here. `security.tf` allowed port 22 from `var.admin_cidr` — a
single home IP — and GitHub's hosted runners get a different address every run. The copy
step would have hung until its 20-minute timeout. Nobody hit it because the job was always
skipped, so arming it would have turned a silently-skipped job into a silently-hanging one.

The runner now never connects to the box. It uploads the build to S3 and calls
`ssm:SendCommand`; the agent already on the instance pulls the artifact and releases it,
reaching outward rather than being reached. Credentials are GitHub OIDC — a short-lived
token per run, scoped in IAM to this repo's `main` branch — so no AWS key is stored.
Port 22 can then be closed entirely (`-var=enable_ssh=false`); Session Manager still gives
a shell without an inbound port.

Required afterwards: secrets `AWS_DEPLOY_ROLE`, `EC2_INSTANCE_ID`; variables `APP_BUCKET`,
`DEPLOY_ENABLED` (**set last**), optionally `AWS_REGION` and `SSM_DEPLOY_DOCUMENT`.
`EC2_HOST`, `EC2_SSH_KEY` and `GH_DEPLOY_TOKEN` are **no longer used**.

The job does:

1. **Build on the runner** — shared, API, web.
   The target cannot compile this application: on a t3.micro (914 MiB) `nest build` dies
   with a V8 heap OOM (SIGABRT, exit 134). Raising `--max-old-space-size` only trades the
   crash for swap-thrashing a host that is also serving live traffic.
2. Upload `dist.tgz` to `s3://<app-bucket>/releases/<sha>.tgz`, then `ssm send-command`
   the `prime-tracker-deploy` document — **and poll until it finishes**. `send-command`
   returns as soon as the command is *accepted*, so without the poll the job goes green on
   a deploy that has not run.
3. On the box, as `ubuntu` (SSM runs as root; a root-owned tree is what previously broke
   `git fetch`'s reflog write and made `prisma generate` fail `EPERM` on the *next*
   deploy): reset the checkout to `origin/main`, `CI=true pnpm install --frozen-lockfile`
   (without `CI=true`, pnpm 10 stops at an interactive build-scripts prompt),
   `prisma generate` (the client is platform-specific), download and unpack the artifact.
4. Write `apps/api/.env` from SSM Parameter Store via the instance role.
5. `prisma migrate deploy` against production.
6. `pm2 restart prime-api`.
7. Copy the SPA into `/var/www/prime-web` — **over the top, never `--delete`**. Vite
   fingerprints asset filenames so stale files are inert, and a half-finished delete would
   take the site down; overwriting `index.html` is the actual cutover.
8. Health-check `:3001/api/health` for 60s, failing the deploy if it does not come up —
   otherwise a process that restarts into a crash loop reports success.
9. Print the box's stdout/stderr **even when the job fails**; a red job with no log is a
   red job nobody can act on.

### 4.2 Manual deploy (what is used today)

Build locally, ship a tarball, migrate, restart, publish — the same steps as above:

```
ssh -i ~/.ssh/prime-tracker-ec2 ubuntu@3.232.150.154
```

**Always back up before migrating.** Prior backups live in `/home/ubuntu/backups/`:
`pre-deploy-<sha>.dump` (pg_dump `-Fc`), `api.env.bak`, `prime-web.bak`,
`nginx-prime-web.bak`.

Two host quirks: `psql`/`pg_dump` reject Prisma's URL — strip
`?schema=public&connection_limit=...` first; and RDS is **PG 15** while Ubuntu 22.04 ships
client 14, which refuses to dump. `postgresql-client-15` is installed from PGDG at
`/usr/lib/postgresql/15/bin/`.

### 4.3 Rollback

- **Web** — `sudo cp -a /home/ubuntu/backups/prime-web.bak/. /var/www/prime-web/`
- **API** — check out the previous commit, rebuild, `pm2 restart prime-api`
- **Database** — `pg_restore -d "$DATABASE_URL" --clean --if-exists <dump>` using the
  PG 15 binary. RDS also holds 30 days of automated backups for point-in-time recovery.

---

## 5. Audit architecture

Prime Tracker records **who changed what**, across every module, in one immutable table.

### The record

`AuditEvent` — `userId`, `action`, `entity`, `entityId`, `oldValues`, `newValues`,
`ipAddress`, `userAgent`, `metadata`, `createdAt`. Indexed on `userId`,
`(entity, entityId)` and `createdAt`.

Immutable **by construction**: there is no `updatedAt` column and no delete cascade, so an
audit row cannot be edited and is not removed when the thing it describes is deleted.

Writes come from an `AuditInterceptor` applied at the controller layer across the module
set, so instrumentation is not something each service has to remember. In production this
currently spans **33 entity types** — units, buildings, projects, sales, leads, leases,
budgets, loans, draws, contracts, investors, campaigns, interior, documents, tasks,
checklists, daily logs and more.

### Two read paths, deliberately different

This is the important design decision. The same table is exposed twice, with different
audiences and very different rules:

| | `GET /api/audit` | `GET /api/audit/activity` |
|---|---|---|
| Permission | `audit:view` — SUPER_ADMIN, FOUNDER, EXECUTIVE | `updateBoard:view` — effectively everyone |
| Returns | Whole rows, **including `oldValues`/`newValues`** | Actor, action, entity, timestamp, and a resolved name |
| Value payloads | Yes | **Never selected** |
| Audience | Compliance / investigation | The Activity Log tab in Updates |

The value payloads are why the first route is narrow: they contain real asking prices, loan
principals and lender names. The Activity Log earns its much wider audience by giving that
up, and by filtering:

- **`ACTIVITY_ENTITY_MAP`** maps every audited entity to the permission it answers to.
  Entities the viewer cannot read are excluded **in the `WHERE` clause** — the rows are
  never loaded, so the total count is honest rather than a count of things they cannot see.
- An entity **missing from the map is denied**, not shown. A new module's audit rows stay
  invisible until someone maps them — the failure that hides data rather than the one that
  leaks it.
- The query uses an **explicit `select`**, never `include`, so a column added to
  `AuditEvent` later cannot leak in by default.
- Sign-in/sign-out and MFA events are excluded as noise; they remain on the admin route.

Measured effect: a FOUNDER sees ~2,120 events across 10 areas; a CONSTRUCTION lead sees
~1,320 across 4. Inside the "Money" area specifically, a founder sees ten entity types
while construction sees only Draws and Vendors — the two it holds permissions for. The
filtering is at row level, not a label.

### Naming what changed

Rows read "updated **Unit A-101**", with "B-ALPHA · QA — Building Fixtures" beneath and a
link to the record. `entityId` is resolved in **one batched query per entity type per
page**, not N+1. Resolvers may read only fields the entity's own permission already covers;
a test asserts that no resolver selects a price, rent or amount. A record deleted since the
event falls back to the generic wording rather than showing a blank or a raw id.

### Supporting controls

- **RLS** on four modules at the database level (`add_rls_4_modules`).
- **AES-256-GCM** field encryption for sensitive loan columns, keyed from
  `ENCRYPTION_KEY` in SSM.
- A permission model of 80+ permissions across 13 roles, enforced by a guard on every
  route and swept by a test that fails if any route is unguarded or missing a permission.

---

## 6. Honest assessment: what is good, what is not

### Sound choices

- **Secrets never touch the repo or CI.** The instance role reads SSM itself. This is the
  single best decision in the setup.
- **The database is genuinely private** — SG-to-SG only, not publicly accessible,
  encrypted at rest, 30 days of automated backups.
- **SSH is restricted to one IP**, not open to the world.
- **Same-origin SPA + API** removes an entire class of CORS and cookie problems.
- **Document and media buckets have versioning on**, so an overwrite is recoverable.
- **CI is real** — it applies migrations to a clean database and runs ~2,500 tests on every
  push, which is why the code that ships is generally sound even though the deploy is manual.
- **The audit design is better than most** — immutability by construction, and a
  permission-filtered read path that can safely be shown to everyone.

### Gaps, roughly by risk

1. **Single point of failure.** One instance, one AZ, no load balancer, no auto-scaling
   group. Losing the instance is a full outage. The auto-recover alarm covers *host*
   failure only.
2. **RDS is not Multi-AZ.** A zone failure means restoring from backup — recovery is
   manual and measured in hours, not the seconds a standby would give.
3. **Nothing watches the application.** The only alarms are EC2 system-status and monthly
   billing. If pm2 dies or the API starts returning 500s, no alarm fires and no one is
   paged. **This is the cheapest gap to close and the most valuable.**
4. **The instance is under-specified.** 914 MiB cannot compile the app; it runs on 4 GB of
   swap. Fine at idle, no headroom under load.
5. **No log aggregation.** pm2 logs live on the instance and die with it. There is no
   CloudWatch Logs agent, so post-incident analysis depends on the box surviving.
6. **Email does not work.** No verified SES identity in us-east-1, so notifications cannot
   send regardless of what the app does.
7. **Background jobs are inert.** No Redis anywhere, so anything queued through BullMQ
   never runs.
8. **Auto-deploy is off**, so every release is a hand-run SSH session with no record of who
   shipped what, and the CI that just proved the build is not the thing that delivers it.
   The pipeline itself was rebuilt on 2026-09-01 (SSM, keyless, no port 22 — see
   [`DEPLOY_SSM_SETUP.md`](DEPLOY_SSM_SETUP.md)) and is ready to arm; the gap now is
   setting `DEPLOY_ENABLED`, not building the mechanism. Note the *old* mechanism was also
   broken on paper — hosted runners could never have reached port 22 through a
   single-home-IP security group — so "auto-deploy is off" was hiding a second problem.
9. **Terraform state is a local file** on one machine (the S3 backend is commented out).
   No locking, no shared access, and losing that laptop means losing the ability to manage
   the stack cleanly.
10. **`audit_events` grows without bound** on a 20 GB volume. Fine at ~2,100 rows; worth a
    retention or archival policy before it is not.
11. **No CDN and no WAF.** Every asset is served by nginx from one box in one region, and
    there is no edge rate-limiting in front of the login endpoint.
12. **The hostname is derived from the EIP.** Losing or changing that IP invalidates both
    the URL and the certificate.

### What to do first

| Priority | Change | Why |
|---|---|---|
| 1 | CloudWatch alarm on `/api/health` → the existing SNS topic | Closes gap 3 for near-zero cost and effort |
| 2 | Verify an SES identity | Notifications are built and cannot send |
| 3 | Move Terraform state to S3 + DynamoDB locking | Removes a single-laptop dependency |
| 4 | Enable `DEPLOY_ENABLED` and stop deploying by hand | The pipeline already works; use it |
| 5 | Ship logs to CloudWatch Logs | Makes incidents diagnosable after the fact |
| 6 | Real domain + ACM + CloudFront in front of the SPA | Removes the EIP dependency, adds a CDN and a WAF attachment point |
| 7 | Multi-AZ RDS, then ALB + ASG | The real availability fix, and the most expensive |

Items 1–5 are small and mostly free. Items 6–7 are the ones that change the cost profile —
the $60/month billing alarm is a good indication of the current envelope, and Multi-AZ
alone roughly doubles the database cost.
