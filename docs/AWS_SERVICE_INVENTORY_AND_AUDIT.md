# Prime Tracker — AWS Service Inventory & Audit

**Date:** 2026-08-02 · **Account:** `221082191502` · **Region:** `us-east-1`
**Purpose:** every AWS service Prime Tracker uses, what each one actually does for the app,
its audit status, and what it takes to shift it to the client account.

Verified live against the account (29 tagged resources + Terraform source), not from memory.

---

## Part A — Service inventory

**11 AWS services in use.** Everything is Terraform-managed under `infra/terraform/`
(52 resource blocks) except where noted.

---

### 1. Amazon EC2 — the application server

**What it is:** virtual machines. One `t3.micro` (2 vCPU burstable, 1 GB RAM), Ubuntu, Node 22.

**What it does for Prime Tracker:** this single box runs *everything* on the compute side —
the NestJS API under PM2 (`prime-api`, port 3001), Nginx as reverse proxy + TLS terminator +
static host for the React SPA out of `/var/www/prime-web`, and **Redis in a Docker container**
for BullMQ job queues.

| Sub-resource | Purpose |
|---|---|
| Instance `i-03fee763407298417` | the server itself |
| EBS gp3 volume, 20 GB | its disk — OS, app code, Nginx config, Let's Encrypt certs |
| Elastic IP `98.89.192.161` | the fixed public address; `98-89-192-161.nip.io` resolves to it |
| Key pair | SSH key (largely unused — deploys go via SSM instead) |
| Security group `prime-tracker-ec2-sg` | firewall: 80/443 open to the world, 22 locked to one admin IP |

**Cost:** $7.74/mo compute + $0.48 disk + $2.52 Elastic IP = **$10.74/mo** (82% of the bill)

---

### 2. Amazon VPC — the private network

**What it is:** an isolated virtual network. Everything else lives inside it.

**What it does for Prime Tracker:** provides the network boundary that keeps the database
unreachable from the internet. Greenfield build — 1 VPC, **3 subnets** (1 public for EC2,
2 private across two AZs for RDS — RDS requires two AZs even in single-AZ mode), an internet
gateway, and a route table.

**Audit note:** there is deliberately **no NAT gateway**. That's the right call — a NAT
gateway costs ~$32/mo, more than the entire current bill. The private subnets don't need
outbound internet.

**Cost:** $0 for the network itself. The **public IPv4 address charge ($0.005/hr) is billed
under VPC**, which is why "VPC" showed $7.41 in July across three addresses.

---

### 3. Amazon RDS (PostgreSQL) — the database

**What it is:** managed PostgreSQL. AWS handles patching, backups, and failure recovery.

**What it does for Prime Tracker:** **the system of record.** Every project, building, unit,
sale, lease, loan, lead, milestone, budget line, document row, task, and comment. All ~30
Prisma migrations are applied here.

| Setting | Value | Verdict |
|---|---|---|
| Instance | `db.t3.micro`, Postgres 15.17 | fine for current load |
| Storage | 20 GB gp3, **~1.7 GB used** | 91% headroom |
| Encryption at rest | ✅ on, AWS-managed `aws/rds` key | ⚠️ blocks cross-account snapshot sharing |
| Publicly accessible | ❌ no — reachable only from the EC2 security group | ✅ correct |
| Automated backups | ✅ 7-day retention | ✅ |
| Point-in-time recovery | ✅ working (latest restorable 17:29 today) | ✅ |
| Deletion protection | ✅ on | ✅ |
| Auto minor version upgrade | ✅ on | ✅ |
| **Multi-AZ** | ❌ **off** | ⚠️ no automatic failover — see Audit A-2 |

**Cost:** $2.30 storage + $0.06 backups. **Instance hours are $0 today under the expiring free
tier — budget $13.14/mo.**

---

### 4. Amazon S3 — file storage

**What it is:** object storage.

**What it does for Prime Tracker:** backs `StorageService` with `STORAGE_DRIVER=s3` (this
replaced Supabase). Every document uploaded through the app — draw request lien waivers,
inspection reports, contracts, permits, brochures — lands here, with `Document.storagePath`
in Postgres pointing at the key. Uploads use presigned PUT URLs so files never transit the API.

| Bucket | Contents | Status |
|---|---|---|
| `prime-tracker-documents-…` | **27 objects / 32 MB** — real client documents **+ deploy artifacts** | ⚠️ see Audit A-1 |
| `prime-tracker-app-…` | **empty** | provisioned, never used |
| `prime-tracker-media-…` | **empty** | provisioned, never used |

All three: public access fully blocked ✅, server-side encryption on ✅, versioning on documents ✅.

**Cost:** ~$0.01/mo. Storage is not where the money goes.

---

### 5. AWS Systems Manager (SSM) — secrets + remote control

**What it is:** three distinct capabilities, all used here.

**What it does for Prime Tracker:**

- **Parameter Store** — the secrets source of truth. **9 parameters** under `/prime-tracker/*`.
  Seven are `SecureString` (KMS-encrypted): `DATABASE_URL`, `ENCRYPTION_KEY`, both JWT secrets,
  `REDIS_PASSWORD`, `GOOGLE_CLIENT_SECRET`, `QB_CLIENT_SECRET`. The box pulls these at deploy
  time to build its `.env`. **`ENCRYPTION_KEY` is the critical one** — it decrypts the
  AES-256-GCM Loan fields.
- **Session Manager** — shell access to the box **without SSH or open port 22**. This is how
  the dump/restore in the migration runs.
- **Run Command** — how `infra/scripts/deploy.sh` ships code. No SSH keys in CI.

**Cost:** $0 (standard parameters are free).

---

### 6. AWS IAM — permissions

**What it does for Prime Tracker:** the EC2 instance profile `prime-tracker-ec2-profile`
grants the box exactly four things — and I read the live policy to confirm it's genuinely
least-privilege:

| Permission | Scope | Verdict |
|---|---|---|
| Read SSM parameters | only `/prime-tracker/*` | ✅ scoped |
| `kms:Decrypt` | only via `ssm.us-east-1.amazonaws.com` | ✅ conditioned |
| S3 read/write/delete | only the media + documents buckets | ✅ scoped |
| `ses:SendEmail` | only the two verified identities | ✅ scoped |

**Notably absent: no `ssm:PutParameter`.** The box can *read* secrets but never *write* them —
a compromised instance can't rewrite its own config. That's a deliberate, correct choice.

**Cost:** $0.

---

### 7. AWS KMS — encryption keys

**What it does for Prime Tracker:** encrypts RDS storage at rest and the SSM `SecureString`
parameters. Uses **AWS-managed keys only** (`aws/rds`, `aws/ssm`).

> ⚠️ This is *not* the same as the app's own `ENCRYPTION_KEY`. KMS protects the disk and the
> parameter store; `ENCRYPTION_KEY` is application-level AES-256-GCM on Loan fields, held in
> SSM. Two independent layers — don't conflate them during the migration.

**Cost:** $0 (AWS-managed keys are free; only ~73 API requests/mo).

---

### 8. Amazon CloudWatch — monitoring

**What it does for Prime Tracker:** collects EC2/RDS metrics and runs the alarm
`prime-tracker-monthly-billing`, which fires if the monthly estimate crosses the threshold.

**Audit note:** **billing is the only Prime Tracker alarm.** Nothing watches instance health,
CPU, disk fill, RDS connections, or whether the API is actually responding. See Audit A-3.

**Cost:** $0 (4 alarms; 10 free).

---

### 9. Amazon SNS — alert delivery

**What it does for Prime Tracker:** topic `prime-tracker-alarms` delivers the billing alarm by
email. **One confirmed subscription: `kalyan91333@gmail.com`.**

**Audit note:** that's a personal Asan address. In the client account, alerts must go to a
client-owned address or distribution list. See Audit A-5.

**Cost:** $0.

---

### 10. Amazon SES — transactional email

**What it does for Prime Tracker:** `MAIL_DRIVER=ses` powers the notification emails —
milestone overdue, lease expiring 30/7 days, loan maturity 60 days, draw approved/funded,
budget variance, lead assigned. The daily 8AM CT cron in `scheduled-notifications.service.ts`
is the main sender.

**Audit note:** **SES is in sandbox** with only two verified *email addresses*
(`kalyan91333@gmail.com`, `akprojects1431@gmail.com`) — no verified domain. In sandbox, SES
**can only send to verified addresses**, so notification email to real Prime Developers staff
does not work today. See Audit A-4.

**Cost:** $0.

---

### 11. AWS Billing / Cost Explorer

**What it does:** the cost data underpinning this analysis. Free tier tracking, the billing
alarm metric, and per-service breakdowns.

---

### Provisioned in code but NOT active

Gated behind `enable_dns = false` — the Terraform exists and validates, but nothing is deployed:

| Service | Why it's off | Live check |
|---|---|---|
| **Route 53** | no domain delegated | 0 hosted zones ✅ |
| **ACM** | needs a domain to validate | 0 certificates ✅ |
| **CloudFront** | needs ACM | 0 distributions ✅ |
| SES domain identity + DKIM | needs Route 53 | only email identities ✅ |

HTTPS today comes from **Let's Encrypt via certbot on the box**, against a `nip.io` hostname —
a test-grade arrangement, not what a client production system should ship with.

### Deliberately NOT used

**ElastiCache** (Redis runs in Docker on the EC2 box), **ALB/NLB**, **ECS/EKS/Fargate**,
**Lambda**, **Secrets Manager** (SSM Parameter Store used instead — free vs $0.40/secret/mo),
**DMS**, **NAT Gateway**. For a single-box app at this scale, all of these would be cost or
complexity without payoff. The one that deserves reconsideration is Redis — see Audit A-6.

---

## Part B — Audit findings

Ordered by what would actually hurt.

### 🔴 A-1. Client documents and deploy artifacts share one bucket

`deploy.sh` sets `DEPLOY_BUCKET=prime-tracker-documents-…` (line 16), then writes
`S3_BUCKET=${DEPLOY_BUCKET}` into the app's `.env` (line 117). So `api-dist.tar.gz` and
`web-dist.tar.gz` land in `deploy/` **inside the same bucket that holds client contracts,
lien waivers, and permits** — while `prime-tracker-app-…` sits empty, which is exactly the
bucket meant for build artifacts.

**Why it matters:** conflated blast radius and lifecycle. A retention policy or bulk cleanup
aimed at build artifacts can reach real client documents. It also muddies any future
"who accessed client documents" audit, since deploy traffic is mixed into the same access logs.
Note the IAM policy doesn't even grant the app bucket — it was provisioned and forgotten.

**Fix:** point `DEPLOY_BUCKET` at `prime-tracker-app-…`, add that bucket to the instance role,
redeploy. Do this **before** the migration so the client account starts clean. Tracked as AKS-238.

### 🔴 A-2. Single point of failure — everything on one box, single AZ

One `t3.micro` runs API + web + Nginx + Redis. RDS is single-AZ. There is no load balancer, no
auto-scaling group, no health-based replacement.

**If that instance is lost, Prime Tracker is entirely down** until someone manually rebuilds.
Recovery means `terraform apply` + rerun deploy scripts + re-obtain the certbot cert — realistically
1–2 hours, and only if whoever's on call knows the runbook.

Compounding it: the box's own state — Nginx config, Let's Encrypt certs, Redis data — is **not
in Terraform** (AKS-237, IaC drift). A fresh `apply` produces an *unhardened* box, not the one
running now.

**Fix options, cheapest first:** (a) accept it and document the RTO — defensible for an internal
tool; (b) scheduled AMI snapshots (~$1/mo) to cut rebuild to minutes; (c) close the IaC drift so
`terraform apply` yields the hardened box; (d) Multi-AZ RDS (+$13/mo) if DB durability is the
real concern. **Recommend (b) + (c).** This is a decision for the client, not a silent default —
they should be told the current RTO before they inherit it.

### 🟠 A-3. No operational alarms — only billing

Nothing alerts on instance status-check failure, CPU exhaustion (a `t3.micro` **will** exhaust
CPU credits under load), disk filling, RDS connection saturation, or API health. **Today, the
first person to know the app is down is a user.**

**Fix:** 4–5 CloudWatch alarms on the existing SNS topic — EC2 `StatusCheckFailed`,
`CPUCreditBalance` low, EBS/RDS free space low, RDS `DatabaseConnections` high. Still free (10
alarms included), ~30 minutes of Terraform.

### 🟠 A-4. SES sandbox — notification email doesn't reach real users

Only two verified Gmail addresses. SES sandbox refuses everything else, so every
lease-expiring / draw-approved / milestone-overdue email to actual Prime Developers staff is
**silently undeliverable**.

**Fix:** requires a real domain — verify the domain identity, add DKIM, then request production
access (AWS review, usually ~24h). Blocked on the same domain decision as HTTPS. **Flag this to
the client explicitly: a headline feature is inert until it's resolved.**

### 🟠 A-5. Alerts and billing route to a personal Asan address

Billing alarm → `kalyan91333@gmail.com`; SES identities are personal Gmail. Once the client owns
the account, **they will not see their own billing alerts or cost anomalies.**

**Fix:** at migration, set `alarm_email` to a client-owned address and confirm the SNS
subscription from their side.

### 🟡 A-6. Redis is unmanaged Docker on the app box

BullMQ queues live in a Docker Redis container with no persistence guarantee, no managed
backup, and no alarm. A box reboot drops in-flight jobs.

**Assessment:** acceptable *if* queued work is regenerable (notification sends, digests) — losing
one cycle is recoverable. **Not** acceptable if anything financial or user-visible is queued
there. Worth confirming what actually flows through BullMQ before deciding. ElastiCache starts
around $12/mo — a real jump against a $28/mo baseline, so only justify it on evidence.

### 🟡 A-7. Terraform state is laptop-local

`infra/terraform/terraform.tfstate` sits on one machine (correctly gitignored). Lose the laptop
and you lose the ability to manage the infrastructure declaratively — you'd be importing 42
resources by hand.

**Fix:** already in the migration plan — S3 backend + DynamoDB lock in the client account.
**Do this at step 1, not later.**

### 🟢 A-8. Two empty buckets

`app` and `media` are provisioned and unused (media has IAM grants it doesn't need). Harmless
cost-wise; the `app` bucket becomes useful once A-1 is fixed. Decide on `media` — use or drop.

### ✅ What's genuinely solid

Don't lose sight of this — the security fundamentals are good:

- RDS not publicly accessible, reachable only from the EC2 security group
- SSH restricted to a single `/32`; deploys go over SSM with no SSH key in CI
- IAM instance role is least-privilege and **cannot write its own secrets**
- Secrets in SSM `SecureString`, KMS-encrypted, never in git
- All S3 buckets: public access blocked, encrypted, documents versioned
- RDS encrypted, 7-day backups, PITR verified working, deletion protection on
- Whole stack is IaC — which is exactly why the account shift is a 2-hour job

---

## Part C — Shift matrix

What each service costs you in effort to move.

| Service | Effort | Notes |
|---|---|---|
| VPC + subnets + IGW + routes + SGs | ✅ Automatic | `terraform apply`, greenfield |
| EC2 + EBS + key pair | ✅ Automatic | new instance id |
| Elastic IP | ⚠️ **New address** | → new `nip.io` host; update `CORS_ORIGINS`, `FRONTEND_URL`, `APP_BASE_URL`, GitHub `EC2_HOST`, re-run certbot |
| RDS instance | ✅ Automatic (empty) | **data is a separate step** — `pg_dump`/`pg_restore` |
| **RDS data** | ❌ **Manual** | ~1.7 GB, via SSM. Snapshot-sharing is blocked by the AWS-managed KMS key |
| S3 buckets | ✅ Automatic | names auto-derive from account id |
| **S3 objects** | ❌ **Manual** | `aws s3 sync`, 27 objects / 32 MB — **keys must match exactly** |
| SSM parameters | ⚠️ **Half manual** | TF creates `REPLACE_ME`; you load real values. **`ENCRYPTION_KEY` must be carried over byte-for-byte** |
| IAM role + policies | ✅ Automatic | ARNs re-derive |
| KMS | ✅ Automatic | AWS-managed keys exist by default |
| CloudWatch + SNS | ⚠️ Config change | set `alarm_email` to a **client-owned** address; they confirm the subscription |
| SES | ❌ Manual | re-verify identities in the new account; sandbox status does **not** carry over |
| Terraform state | ❌ **Manual, do first** | S3 backend + DynamoDB lock in the client account |
| Route 53 / ACM / CloudFront | ⏸️ Deferred | stays `enable_dns=false` until a domain exists |

### Do these *before* the shift

1. **Fix A-1** (deploy artifacts → app bucket) so the client account starts clean.
2. **Decide the domain question.** It gates HTTPS (A-4 SES *and* real TLS). Migrating on
   `nip.io` is fine for continuity, but it should be a conscious choice, not a default.
3. **Get a client-owned email** for billing alerts and SES.

### Do these *right after*

4. Add the operational alarms (A-3) — cheapest real risk reduction available, and free.
5. Enable AMI snapshots (A-2b) and close the IaC drift (A-2c).
6. Turn on cost allocation tags so Prime Tracker spend is attributable from day one.

---

## Decisions (locked 2026-08-02)

| # | Question | Decision | Consequence |
|---|---|---|---|
| 1 | Domain | ❌ **No domain for now** | `enable_dns=false` stays. Route 53 / ACM / CloudFront stay off. HTTPS remains certbot + Let's Encrypt on `nip.io`. **⚠️ SES stays in sandbox → notification email still does not reach real staff.** See A-4a below. |
| 2 | Availability / RTO | ✅ **4–5 hours downtime acceptable** | The current 1–2 hour manual rebuild is **already inside tolerance**. A-2 needs no spend: **skip Multi-AZ (saves $13.14/mo), skip scheduled AMIs.** Closing the IaC drift stays worthwhile but drops to low priority. |

Still open: **(3)** who receives billing/operational alerts on the client side, and
**(4)** what actually runs through BullMQ (A-6).

### A-2 revised — no action needed

With a 4–5 hour tolerance, the single-box, single-AZ design is **an accepted risk, not a
defect**. The documented recovery path (`terraform apply` + deploy scripts + certbot, ~1–2 h)
fits comfortably. Recommendation downgraded from "fix" to "document the RTO and move on."
This alone keeps ~$13/mo off the client's bill.

### A-4a — getting notification email working *without* a domain

Deferring the domain does **not** have to mean permanently broken email. SES production access
requires *a* verified identity — and that can be a **plain email address**, not necessarily a
domain:

1. Verify a real company address (e.g. `notifications@primedevelopers.com`) as an SES **email
   identity** — someone with access to that mailbox clicks the confirmation link.
2. Request **SES production access** (AWS reviews the use case, typically ~24h).
3. Once granted, Prime Tracker can send to **any** recipient, not just verified ones.

**Trade-off to accept knowingly:** without domain verification there is **no DKIM and no custom
MAIL FROM**, so deliverability is measurably worse — notification mail is more likely to land in
spam. That's usually tolerable for an internal tool where staff can whitelist the sender, and it
is far better than the current state, where those emails go nowhere at all.

**This is the cheapest way to un-break a shipped feature while the domain stays deferred.**
