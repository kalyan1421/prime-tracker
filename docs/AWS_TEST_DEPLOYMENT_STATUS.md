# Prime Tracker — AWS Test Deployment: Status & Client Requirements

> **Prepared by:** Asan Innovators · **Date:** 2026-06-19 · **Stage:** 🧪 Testing / Development
>
> Prime Tracker is now running on **AWS** as a working test environment. This document records
> what has been done, how to access it, what remains, and the inputs we need from the client to
> later move the system into the **client's own AWS Organization** (which happens **after** testing
> is signed off — *not now*).

---

## 1. Summary — what's live

The full stack (web app + API + database + file storage) is deployed on AWS and reachable over
HTTPS, with seeded demo data and working role-based login.

| Layer | Status |
|---|---|
| Infrastructure (Terraform IaC, 42 resources) | ✅ Provisioned in `us-east-1` |
| API server (NestJS, EC2 t3.micro, Node 22, PM2 as `ubuntu`) | ✅ Running |
| Database (RDS PostgreSQL 15, encrypted, 7-day backups) | ✅ Live — all migrations applied |
| File storage | ✅ **AWS S3** (Supabase removed) |
| Frontend (React SPA) | ✅ Served via Nginx (same origin) |
| HTTPS / TLS | ✅ Valid cert (Let's Encrypt) |
| Email | ✅ **AWS SES** (test/sandbox mode) |
| Login (password) | ✅ Working |
| Secrets | ✅ DB URL in SSM Parameter Store; app reads via instance IAM role |
| Billing alarm | ✅ CloudWatch alarm → `kalyan91333@gmail.com` |

---

## 2. How to access & test

- **URL:** https://98-89-192-161.nip.io
  *(nip.io is a free DNS service mapping to the server's IP — used only for testing, since no
  domain is set up yet. A real domain comes later.)*
- **Login:** any demo role below, password **`Prime@123`**

| Email | Role |
|---|---|
| `founder@prime.dev` | Founder |
| `superadmin@prime.dev` | Super Admin |
| `finance@prime.dev` | Finance |
| `pm@prime.dev` | Project Manager |
| `sales@prime.dev` | Sales |
| `construction@prime.dev` | Construction |
| …+6 more (executive, accounting, ar_ap, marketing, legal, viewer) | password `Prime@123` |

The environment is loaded with **demo data** (184 sales, 98 milestones, 71 leases, 63 budget lines,
42 leads, etc.) so every screen has content to test.

---

## 3. What's been done

**Infrastructure (Terraform — reproducible):** VPC + subnets, security groups (DB reachable only
from the API host), RDS PostgreSQL 15, EC2 + Elastic IP, 3 S3 buckets, SSM Parameter Store,
CloudWatch billing alarm. Provisioned with one `terraform apply`; re-runnable in any AWS account.

**Application deploy:** repo cloned + built on the box (Node 22), all database migrations applied,
demo data seeded, served under PM2 (as the unprivileged `ubuntu` user) behind Nginx with HTTPS.

**Moved off Supabase:** file storage switched to **AWS S3** (via the server's IAM role — no keys
stored); the Supabase client is no longer used anywhere.

**Email on AWS SES** (test/sandbox): wired and ready; sends once the test address is verified.

**Hardening done so far:** secrets out of the codebase (DB URL in SSM), API runs as a non-root user,
HTTP auto-redirects to HTTPS, DB locked to the app host only, env-validation fails fast on missing
secrets, structured JSON logging for CloudWatch.

**Fixes made during cutover (now permanent in the code/IaC):** small-instance build tuning (swap),
a Supabase-specific database migration made portable, Node runtime upgraded to 22, and a database
schema-drift reconcile migration so a fresh deploy reproduces the schema exactly.

> **Note:** the Supabase database held **demo data only — no production data** — so there is no
> production-data migration to perform.

---

## 4. Current test architecture

Everything runs on **one EC2 instance** for the test stage (cost ≈ $0 on free tier):

```
Browser ──HTTPS──> Nginx (EC2)
                     ├── /          → React SPA (static)
                     └── /api/*      → NestJS API :3001 (PM2, user: ubuntu)
                                          ├── RDS PostgreSQL 15 (private)
                                          ├── Redis 7 (local)
                                          ├── S3 (file storage, via IAM role)
                                          └── SES (email, via IAM role)
```

For production we can split the frontend onto CloudFront/CDN and add a real domain — written in the
Terraform already and gated behind a flag, enabled when a domain is delegated.

---

## 5. Testing posture / current limitations

- **No custom domain** — on a temporary `nip.io` URL. Real domain = production step.
- **Google SSO is off** — login is via password for testing; Google sign-in is enabled later.
- **SES is in sandbox** — can only email verified addresses until production access is requested.
- **Single-AZ, single instance** — appropriate for testing; HA/scale is a production decision.

---

## 6. Remaining work

**During / to finish testing (current AWS account):**
- Finish SES verification (click the link sent to `kalyan91333@gmail.com`) to enable test emails.
- Remaining hardening: Redis password, move JWT/encryption secrets fully into SSM.
- Functional UAT by the client across roles.

**Production cutover — AFTER testing is signed off (moves to the client's AWS Org):**
- Re-apply the same Terraform in the **client's AWS Organization** (US region, new VPC).
- Real domain + DNS, Google OAuth, SES production access (exit sandbox).
- Production hardening (HA/backup policy per client requirements).

> ⚠️ **The shift to the client's AWS Organization is explicitly deferred until testing is complete.**

---

## 7. Client requirements — what we need to confirm

### ✅ Already decided
- **Target:** client's **AWS Organization** (US region) — **after testing**, not now.
- **IAM access:** client creates the IAM user **manually**; it will be configured locally (not via any auto-connect tooling).
- **Networking:** **new VPC** (greenfield), not the client's existing VPC.
- **Storage:** **AWS S3**; Supabase removed entirely.
- **Email:** **AWS SES**, testing/sandbox for now (no production domain yet).
- **Domain/DNS:** none for now.
- **Data:** demo data only — no production data to migrate.

### ❓ Open — to confirm before the production move
1. **AWS account:** which account in the Org should this live in (a dedicated account is recommended)? Region confirm = `us-east-1`?
2. **IAM:** any permission boundaries, tagging, or naming standards we must follow?
3. **Domain:** what production domain will be used, and who manages its DNS? (e.g. a subdomain of `primedevelopers.com`?)
4. **Google OAuth:** who owns the Google Cloud project / can provide the OAuth client ID + secret and add the production redirect URL?
5. **Email:** which domain/address sends production email, and who can do the SES domain verification + production-access request?
6. **Reliability:** Single-AZ (cheapest) vs Multi-AZ (high availability) for the database? Backup retention requirement?
7. **Access & ops:** who on the client side needs server/admin access? Any monitoring/alerting expectations?
8. **Compliance:** any data-handling, audit, or certification requirements (SOC2/ISO, etc.)?
9. **Integrations:** QuickBooks live credentials (when ready); Bill.com / BuilderTrend are future scope.
10. **Cost/budget:** billing owner and a monthly budget-alert threshold.

---

*Prepared by Asan Innovators. The infrastructure is defined as code (Terraform) and the deployment is
scripted, so moving to the client's AWS account is a re-apply with their inputs — not a rebuild.*
