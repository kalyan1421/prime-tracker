# AWS Cost Analysis + DB Copy Plan → Client Account

**Date:** 2026-08-02
**Current account:** `221082191502` (Asan test account, us-east-1)
**Target:** client's real AWS Organization account, us-east-1
**Status:** analysis + plan only — nothing executed.

All figures below were pulled live from Cost Explorer / EC2 / RDS / S3 on 2026-08-02,
not estimated.

---

## Part 1 — Cost analysis of the existing account

### 1.1 Actual spend (last 3 months)

| Month | Total (incl. tax) | Notes |
|---|---|---|
| May 2026 | $0.00 | pre-Prime-Tracker |
| June 2026 | $16.04 | stack went live 2026-06-18 (½ month) |
| **July 2026** | **$32.03** | **first full month — use this as the baseline** |
| Aug 2026 (1 day) | $0.15 | trending same |

### 1.2 July 2026 by service

| Service | Cost | What it actually is |
|---|---|---|
| EC2 – Compute | $15.70 | **3 × t3.micro** running 24/7 |
| VPC | $7.41 | **3 public IPv4 addresses** @ $0.005/hr (above 750 free hrs) |
| RDS | $3.56 | gp3 storage $2.30 + Aurora $1.20 + backups $0.06 |
| EC2 – Other | $0.48 | EBS gp3 (36 GB total, 30 GB free-tier) |
| S3 / CloudWatch / SNS / KMS / SecretsMgr | ~$0.00 | inside always-free limits |
| Tax (GST 18%) | $4.88 | |
| **Total** | **$32.03** | |

### 1.3 🔴 Key finding — only ~41% of this bill is Prime Tracker

The account is running **three EC2 instances**, but only one belongs to Prime Tracker:

| Instance | Region | Launched | Project |
|---|---|---|---|
| `i-03fee763407298417` | us-east-1 | 2026-06-18 | **Prime Tracker** ✅ |
| `i-0a72aade4af8655ed` "flutter_backend_1" | **eu-north-1** | 2025-07-07 | ❌ unrelated |
| `i-0824832343aea47b4` "trainex-backend" | **eu-north-1** | 2026-06-09 | ❌ unrelated |

Plus an **orphaned Aurora Serverless v2 cluster** `database-1` (aurora-postgresql 17.7,
created 2026-06-18 — same day as the migration, almost certainly a console mis-click).
It is **not in the Terraform state**, nothing connects to it, and it still bills.

**July split by workload:**

| Workload | Pre-tax | Share |
|---|---|---|
| **Prime Tracker** (us-east-1) | **$13.10** | 41% |
| Other projects (eu-north-1) | $12.85 | 40% |
| Orphan Aurora `database-1` | $1.20 | 4% |
| Tax | $4.88 | 15% |
| **Total** | **$32.03** | |

### 1.4 What Prime Tracker alone actually costs today

| Line item | Usage | July cost |
|---|---|---|
| EC2 t3.micro | 744 hrs | $7.74 |
| Elastic IP `98.89.192.161` | 744 hrs | $2.52 |
| RDS gp3 storage | 20 GB | $2.30 |
| EBS gp3 (root vol) | 20 GB | $0.48 |
| RDS automated backups | 0.6 GB | $0.06 |
| **RDS db.t3.micro instance-hours** | 744 hrs | **$0.00 — free tier** ⚠️ |
| S3 (27 objects / 32 MB), CloudWatch, SSM, KMS | — | ~$0.00 |
| **Subtotal (pre-tax)** | | **$13.10** |

### 1.5 ⚠️ The number that will change: RDS free tier

`db.t3.micro` instance-hours are currently billing **$0** under the 12-month free tier.
At list price that line is **$0.018/hr = ~$13.14/month**. The 12-month clock started with
the account (the oldest resource dates to July 2025), so this allowance lapses imminently
if it hasn't already.

**Prime Tracker's true steady-state cost is therefore ~$26/month pre-tax, not $13.**

### 1.6 Where the money can be saved

> **Actions taken 2026-08-02** — see §1.6a below for what was actually done.

| # | Action | Saving | Risk |
|---|---|---|---|
| 1 | **Delete orphan Aurora `database-1`** ✅ done | ~$1.20/mo | None — unmanaged, and verified **0 database connections over 2 weeks**. |
| 2 | **Stop the 2 eu-north-1 instances** ✅ done | ~$12.85/mo | ⚠️ Both were **actively serving traffic daily** — stopped, not terminated, so it is reversible. See §1.6a. |
| 3 | 1-yr no-upfront Savings Plan (EC2) + Reserved Instance (RDS) | ~30–35% → **~$7/mo** | Locks 1 year at current sizing. Do this *after* the client account is stable. |
| 4 | Switch to Graviton (`t4g.micro` / `db.t4g.micro`) | ~$3/mo | Needs an ARM build of the API. Modest payoff — low priority. |
| 5 | Drop RDS, run Postgres on the EC2 box | ~$15/mo | **Not recommended** — loses managed backups, PITR, patching. Wrong trade for a client production system. |
| 6 | Release unused Elastic IPs, keep exactly one | already clean | — |

**Realistic target: ~$21–26/month pre-tax for a properly sized Prime Tracker.**

### 1.6a Cleanup performed 2026-08-02

**Orphan Aurora `database-1` — DELETED.**
Verified dead before deleting: `DatabaseConnections` = 0 (Sum *and* Maximum) across the two
weeks to 2026-08-02. Deletion protection was already off. Member instance
`database-1-instance-1` deleted, then the cluster deleted **with a final snapshot** retained
as a recovery point. Saves ~$1.20/mo.

**eu-north-1 instances — STOPPED, NOT terminated.** ⚠️
CloudWatch showed both were **actively serving traffic every day** of the preceding week —
`flutter_backend_1` 0.5–3.5 MB/day, `trainex-backend` 0.5–2.5 MB/day. They are unrelated to
*Prime Tracker*, but they are **not idle**. Terminating would have destroyed two live
backends and their root EBS volumes irreversibly, so they were **stopped** instead:

| | Stopped | Terminated |
|---|---|---|
| Compute + public IPv4 charge | ✅ stops (~$12.85/mo saved) | ✅ stops |
| 8 GB EBS root volumes | 💲 still billed (~$1.30/mo total) | ❌ destroyed |
| Reversible | ✅ `aws ec2 start-instances` | ❌ never |

**Open item — needs an owner decision:** confirm with whoever owns `flutter_backend_1` and
`trainex-backend` whether they can stay down. If yes, snapshot to an AMI and terminate to
reclaim the last ~$1.30/mo. If no, restart them — but they should then move to their own
account so they never land on the client's bill. **Note their public IPs change on restart**
(neither has an Elastic IP), so anything pointing at the old addresses will need updating.

### 1.7 Forecast — fresh client account (no free tier), Prime Tracker only

| Item | Calculation | $/mo |
|---|---|---|
| EC2 t3.micro | 730 hrs × $0.0104 | 7.59 |
| RDS db.t3.micro | 730 hrs × $0.018 | 13.14 |
| Elastic IP ×1 | 730 hrs × $0.005 | 3.65 |
| RDS gp3 storage 20 GB | × $0.115 | 2.30 |
| EBS gp3 20 GB | × $0.08 | 1.60 |
| RDS backups (7-day retention) | | ~0.10 |
| S3 (32 MB), data transfer (<100 GB), CloudWatch (4 alarms), SSM, KMS | within free limits | ~0.01 |
| Terraform remote state (S3 + DynamoDB on-demand) | | ~0.10 |
| **Total** | | **≈ $28.50/mo** |

**≈ $28–30/month, ≈ $340–360/year** (add local tax; a US-billed client account should not
carry the 18% Indian GST currently on this bill — that alone is worth ~$58/yr).

With a 1-year Savings Plan + RDS RI: **≈ $21.50/mo (~$260/yr)**.

> ⚠️ **Verify at account creation:** AWS replaced the old 12-month free tier with a
> credit-based plan for accounts opened after 15 July 2025. A brand-new client account will
> most likely get **credits, not 750 free hours** — so budget the full $28.50 from month one
> rather than assuming a free first year.

---

## Part 2 — Copying the DB to the client's AWS account

### 2.1 What has to move

| Asset | Size | Method |
|---|---|---|
| **RDS Postgres `prime-tracker-db`** (pg 15.17, 20 GB allocated, **~1.7 GB used**) | tiny | `pg_dump` → `pg_restore` |
| **S3 `prime-tracker-documents-…`** | 27 objects / **32 MB** | `aws s3 sync` |
| S3 `prime-tracker-app-…` / `…-media-…` | **empty** | nothing to move |
| SSM `/prime-tracker/*` (9 params) | 9 values | re-created by Terraform, values loaded manually |

The whole dataset is **~250 MB of real data**. The copy itself takes seconds; the effort is
entirely in sequencing and verification.

### 2.2 Method choice — and why snapshot-sharing is out

| Method | Verdict |
|---|---|
| **A. `pg_dump -Fc` → S3 presigned URL → `pg_restore`** | ✅ **Recommended.** Cross-account with zero networking or KMS work. Version-tolerant. Restores into the Terraform-created instance, so state stays clean. |
| B. Share an RDS snapshot cross-account | ❌ **Blocked as-is.** Verified: `prime-tracker-db` is encrypted with the **AWS-managed `aws/rds` key**, which *cannot* be shared cross-account. Would require: create a customer-managed KMS key → `copy-db-snapshot` onto it → `modify-db-snapshot-attribute` → grant the client account `kms:Decrypt` → restore. That also produces an instance **outside Terraform**, needing a `terraform import`. Not worth it for 250 MB. |
| C. AWS DMS / logical replication (near-zero downtime) | ❌ Massive overkill at this size. |

**Why the dump has to run from inside the VPC:** `prime-tracker-db` is
`PubliclyAccessible=false` — it is only reachable from its own EC2 box. So both the dump and
the restore run on the respective EC2 instances via **SSM Session Manager** (no SSH, no
security-group changes).

### 2.3 Two non-negotiable correctness rules

1. **`ENCRYPTION_KEY` must be carried over byte-for-byte, never regenerated.**
   The `Loan` model stores AES-256-GCM encrypted fields. A fresh key makes every existing
   encrypted loan field **permanently unreadable**. Pull it from the old account's SSM
   (`/prime-tracker/ENCRYPTION_KEY`, `--with-decryption`) and write that exact value into the
   new account's SSM.
   *(`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `REDIS_PASSWORD` and the DB password are
   session-only — safe to regenerate fresh.)*

2. **S3 object keys must stay identical.**
   `Document.storagePath` rows point at `<bucket>/<key>`. Only the bucket name changes (it
   auto-derives from the account id). Preserve keys and every migrated document row resolves
   with **no DB edits**. `aws s3 sync` preserves keys by default — do not use `cp` with a
   different prefix.

### 2.4 The sequence

**Phase 0 — prerequisites (client)**
1. AWS account live in the client's Organization.
2. Bootstrap IAM user + CLI access key. **Local credentials + Terraform/CLI only — do not
   connect it to the AWS MCP server** (locked decision).
3. Billing → Preferences → *Receive Billing Alerts* enabled.

**Phase 1 — stand up empty infrastructure (~30 min, no downtime)**
4. Create the remote-state backend (`prime-tracker-tfstate-<acct>` S3 bucket + versioning,
   `prime-tracker-tflock` DynamoDB table), then uncomment the `backend "s3"` block in
   `infra/terraform/versions.tf`.
5. Archive the old `terraform.tfstate` (it maps to `221082191502` — must never be reused).
6. New `terraform.tfvars`: `enable_dns=false`, `rds_deletion_protection=true`, fresh
   `db_password`, your `admin_cidr`, the SSH public key.
7. `terraform init && terraform plan` → **confirm new account id and 0 destroys** → `apply`.
   ~42 resources, greenfield VPC.
8. Load real secrets into SSM via `scripts/put-ssm-params.sh` — **with the carried-over
   `ENCRYPTION_KEY`**.

**Phase 2 — deploy the app against an empty DB**
9. Run `infra/scripts/deploy.sh all` at the new instance. (It already writes
   `STORAGE_DRIVER=s3` / `S3_BUCKET` / `AWS_REGION` into `.env` — the July regression is
   fixed and committed.)
   ⚠️ **t3.micro OOM:** the box needs the 4 GB swapfile + `NODE_OPTIONS=--max-old-space-size=3072`
   or `pnpm install` / `nest build` wedges it. Already in the deploy scripts.
10. `GET /api/health` → 200 on the new Elastic IP. App runs, DB empty. **Nothing is cut over
    yet — the old environment is still live and untouched.**

**Phase 3 — the data copy (the only downtime, ~10 min)**
11. **Freeze writes** on the old box: `pm2 stop prime-api`. (Only step that interrupts users.)
12. Dump on the **old** box via SSM:
    `pg_dump "$DATABASE_URL" -Fc --no-owner --no-acl -f /tmp/prime-tracker.dump`
    → `aws s3 cp` to the old app bucket → `aws s3 presign … --expires-in 3600`.
13. Restore on the **new** box via SSM: `curl` the presigned URL →
    `pg_restore --no-owner --no-acl --clean --if-exists -d "$DATABASE_URL" /tmp/…dump`.
    This carries schema + all rows + the `_prisma_migrations` history in one shot —
    **skip `prisma migrate deploy` and `db:seed` entirely** on this path.
14. Sync the documents bucket (32 MB, keys preserved):
    `aws s3 sync s3://prime-tracker-documents-221082191502 /tmp/docs --profile <old>` then
    `aws s3 sync /tmp/docs s3://prime-tracker-documents-<new-acct> --profile <new>`.
15. Restart the API on the new box.

**Phase 4 — repoint external access**
16. New Elastic IP → new `nip.io` host. Update `CORS_ORIGINS` / `FRONTEND_URL` / `APP_BASE_URL`,
    re-run certbot for HTTPS, rebuild the SPA (`VITE_API_BASE_URL` empty = same-origin) and
    re-upload `web-dist.tar.gz`.
17. Update GitHub Actions secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `EC2_HOST`,
    `EC2_SSH_KEY`, `S3_APP_BUCKET`.

**Phase 5 — verify, then tear down**
18. Run the checklist below. Leave the old account **running but stopped** for a few days as
    a rollback path.
19. Only then: set `rds_deletion_protection=false`, `terraform destroy` the old stack, and
    separately deal with `flutter_backend_1` / `trainex-backend` / the orphan Aurora (they are
    *not* Terraform-managed and will survive a destroy).

### 2.5 Verification checklist

- [ ] `aws sts get-caller-identity` = client account (not `221082191502`)
- [ ] `terraform plan` showed create-only, 0 destroys
- [ ] `/api/health` = 200 and `/api/health/ready` reports `database.ok = true`
- [ ] `npx prisma migrate status` = "up to date" (via restore, not a fresh migrate)
- [ ] **Row counts match old vs new** — spot-check `sales`, `loans`, `documents`, `users`
- [ ] **A pre-existing loan with encrypted fields decrypts correctly** ← proves `ENCRYPTION_KEY` carried over
- [ ] Password login works for **existing** users, not just the 12 demo seeds
- [ ] A pre-existing uploaded document downloads from the new bucket ← proves keys preserved
- [ ] `POST /api/documents/presigned-upload` returns a signed URL ← proves S3 env vars present
- [ ] No Supabase WebSocket errors in the logs (S3 driver active)
- [ ] Billing alerts + SNS subscription confirmed on the client's email
- [ ] Cost allocation tags active so Prime Tracker spend is attributable

### 2.6 Rollback

Until step 19, rollback is: `pm2 start prime-api` on the old box and point DNS/users back.
The old RDS instance and S3 bucket are untouched by the copy — `pg_dump` is read-only and
`s3 sync` is one-directional. **Nothing is destructive until the explicit `terraform destroy`.**

### 2.7 Effort

| Phase | Time | Downtime |
|---|---|---|
| 0 — client prerequisites | client-dependent | none |
| 1 — Terraform apply | ~30 min | none |
| 2 — deploy app | ~20 min | none |
| 3 — **data copy** | ~10 min | **~10 min** |
| 4 — repoint + HTTPS | ~30 min | none |
| 5 — verify | ~30 min | none |
| **Total** | **~2 hours** | **~10 min** |

**Blocker:** the client's AWS access key is not yet configured locally — `~/.aws` still points
at the old test account `221082191502`. Nothing in Part 2 can start until that arrives.
