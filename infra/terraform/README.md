# Prime Tracker — AWS Infrastructure (Terraform)

Reproducible IaC for the architecture in `docs/AWS_MIGRATION_PLAN.md`
(`aws-migration-prep` branch). One `terraform apply` provisions the whole stack
in **us-east-1**.

## What this provisions

| File | Resources |
|---|---|
| `network.tf` | VPC, 1 public + 2 private subnets, IGW, route table |
| `security.tf` | EC2 SG (80/443 public, 22 admin-only), RDS SG (5432 from EC2 only) |
| `iam.tf` | EC2 role + instance profile (SSM read, S3, SES, Session Manager) |
| `rds.tf` | PostgreSQL 15, db.t3.micro, 20 GB gp3, Single-AZ, encrypted, 7-day backups |
| `ec2.tf` + `user-data.sh.tftpl` | t3.micro Ubuntu 22.04 + Elastic IP; bootstraps Node 20, pnpm, PM2, Docker, Redis, Nginx, certbot |
| `s3.tf` | 3 buckets — `app` (SPA), `media` (public), `documents` (private, versioned) |
| `cloudfront.tf` | 2 distributions (SPA + media) via OAC; SPA 403/404 → index.html |
| `acm.tf` | Wildcard `*.<domain>` cert (DNS-validated, us-east-1) |
| `route53.tf` | Hosted zone + `app` / `media` / `api` records |
| `ses.tf` | Domain identity + DKIM + custom MAIL FROM |
| `ssm.tf` | Secret/config parameters under `/prime-tracker/*` (placeholder values) |
| `monitoring.tf` | SNS topic + CloudWatch billing alarm |

**Cost:** ~$0/mo year 1 (free tier) + ~$0.50/mo Route 53. ~$21–23/mo year 2+.

### Phasing — the `enable_dns` flag

`enable_dns` (default **false**) controls whether the DNS/CDN/email layer is
provisioned:

| | Resources | When |
|---|---|---|
| **Phase 1** (`enable_dns = false`) | Core: VPC, RDS, EC2+EIP, S3 buckets, SSM, monitoring (**42 resources**). API runs on the Elastic IP; add a single `api.<domain>` A-record at your current DNS host + certbot for TLS. App keeps `STORAGE_DRIVER=supabase` / `MAIL_DRIVER=smtp`. | Now |
| **Phase 2+** (`enable_dns = true`) | Adds Route 53 zone, ACM wildcard cert, CloudFront (SPA + media), SES (**64 total**). | After the domain's nameservers are delegated to this account's Route 53 zone |

> Do **not** set `enable_dns = true` before delegating the domain — ACM
> validation (and the CloudFront that depends on it) will hang during apply.

---

## Step 0 — One-time IAM bootstrap (you do this in the console)

Terraform needs credentials, and the very first IAM user must be created by
hand (chicken-and-egg). In the [AWS Console](https://console.aws.amazon.com/):

1. **IAM → Users → Create user** → name `terraform-prime`.
2. **Permissions** → *Attach policies directly* → `AdministratorAccess`
   (simplest for bootstrap; tighten later if desired).
3. Create the user → open it → **Security credentials → Create access key** →
   *Command Line Interface (CLI)* → copy the **Access key ID** and **Secret**.
4. On your machine, create `~/.aws/credentials` (do **not** paste keys into chat):
   ```ini
   [prime]
   aws_access_key_id     = AKIA...
   aws_secret_access_key = ...
   ```
   and `~/.aws/config`:
   ```ini
   [profile prime]
   region = us-east-1
   ```
5. Export it for this shell (and the AWS MCP picks it up too):
   ```bash
   export AWS_PROFILE=prime
   ```

Also enable billing alerts once: **Billing → Billing Preferences →
Receive Billing Alerts** (required for the CloudWatch billing alarm).

> The domain `theprimedeveloper.com` must be registered. If it's registered
> outside Route 53, after apply you'll point its NS records at the
> `route53_nameservers` output.

---

## Step 1 — Configure and plan

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: ssh_public_key, admin_cidr, db_password, alarm_email

terraform init
terraform plan -out=tf.plan
terraform apply tf.plan
```

ACM validation + CloudFront rollout make the first apply take ~15–25 min.

---

## Step 2 — Delegate DNS (only if domain is registered outside Route 53)

```bash
terraform output route53_nameservers
```
Set those 4 NS records at your registrar. Wait for propagation, then the ACM
cert validates automatically.

---

## Step 3 — Load secrets into SSM

Terraform created the parameters with a `REPLACE_ME` placeholder. Set real
values (kept out of Terraform state):

```bash
export AWS_REGION=us-east-1
export DATABASE_URL="$(terraform output -raw database_url_for_ssm)"
export ENCRYPTION_KEY="<the CURRENT prod 64-hex key — do NOT regenerate>"
export GOOGLE_CLIENT_ID="..."
export GOOGLE_CLIENT_SECRET="..."
./scripts/put-ssm-params.sh
```

`JWT_*` and `REDIS_PASSWORD` auto-generate if you don't supply them.
**`ENCRYPTION_KEY` must be the existing production key** or AES-encrypted loan
fields won't decrypt.

---

## Step 4 — Migrate the database

From the EC2 box (`aws ssm start-session --target <instance-id>`) or any host
that can reach RDS, with the repo checked out and `DATABASE_URL` exported:

```bash
cd apps/api
npx prisma migrate deploy     # applies all migrations
npx prisma migrate status     # expect "up to date"
pnpm run db:seed              # ONLY for a fresh DB (lookup/demo data)
```

For an existing-data cutover, dump from Supabase and restore into RDS instead
of seeding — see `docs/AWS_MIGRATION_PLAN.md` §3.1.

---

## Step 5 — Deploy app code + flip env flags

1. **API on EC2:** clone repo, `pnpm install`, `pnpm --filter @prime-tracker/api build`,
   then `pm2 start dist/main.js --name prime-api && pm2 save && pm2 startup`.
   The app reads secrets from SSM `/prime-tracker/*` via the instance role.
2. **TLS for api:** `sudo certbot --nginx -d api.<domain>`.
3. **SPA:** `pnpm --filter @prime-tracker/web build` then
   `aws s3 sync apps/web/dist s3://$(terraform output -raw app_bucket) --delete`
   and invalidate CloudFront (`app_cloudfront_distribution_id`).
4. **Cutover env** (see migration plan §"Cutover env flags"):
   ```
   STORAGE_DRIVER=s3   S3_BUCKET=<documents bucket>   AWS_REGION=us-east-1
   S3_PUBLIC_BASE_URL=<s3_public_base_url output>
   MAIL_DRIVER=ses     SMTP_FROM=<verified@domain>
   NODE_ENV=production
   ```
5. **SES:** request production access (exit sandbox) in the SES console.
6. **GitHub Actions:** add secrets `EC2_HOST`, `EC2_SSH_KEY`, `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `CF_DIST_ID`; set repo var
   `DEPLOY_ENABLED=true` to arm the deploy jobs.

---

## Teardown

```bash
terraform destroy
```
First flip `rds_deletion_protection = false` and apply, or RDS blocks deletion.
A final RDS snapshot (`prime-tracker-db-final`) is taken automatically.

## Notes / manual steps Terraform can't do
- **SES sandbox exit** — manual support request.
- **Receive Billing Alerts** toggle — one-time billing-console setting.
- **Google OAuth callback URL** — update to `https://api.<domain>/...` in Google Cloud.
- **Supabase object copy** — one-time `aws s3 sync` / migration of existing files.
