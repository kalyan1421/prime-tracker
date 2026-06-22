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

## Step 5 — Arm GitHub Actions deploy

The workflow (`.github/workflows/deploy.yml`) handles everything automatically on
push to `main` once the secrets below are set. It clones the repo on first run,
writes SSM params to `apps/api/.env`, runs migrations, and starts/restarts PM2.

### Required GitHub secrets (Settings → Secrets → Actions)

| Secret | Value |
|---|---|
| `EC2_HOST` | `98.89.192.161` (the Elastic IP from `terraform output ec2_public_ip`) |
| `EC2_SSH_KEY` | Contents of `~/.ssh/prime-tracker-ec2` (private key) |
| `GH_DEPLOY_TOKEN` | GitHub PAT with `repo:read` scope — EC2 uses this to clone/pull |
| `AWS_ACCESS_KEY_ID` | terraform-prime IAM access key |
| `AWS_SECRET_ACCESS_KEY` | terraform-prime IAM secret key |
| `AWS_REGION` | `us-east-1` |
| `S3_APP_BUCKET` | `prime-tracker-app-221082191502` (from `terraform output app_bucket`) |
| `CF_DIST_ID` | *(leave unset in Phase 1 — add once `enable_dns=true` is applied)* |

### Required GitHub secrets — add these (Settings → Secrets → Actions)

| Secret | Value |
|---|---|
| `EC2_HOST` | `98.89.192.161` |
| `EC2_SSH_KEY` | contents of `~/.ssh/prime-tracker-ec2` (private key) |
| `GH_DEPLOY_TOKEN` | GitHub PAT with `Contents: read` scope |
| `AWS_ACCESS_KEY_ID` | terraform-prime IAM key |
| `AWS_SECRET_ACCESS_KEY` | terraform-prime IAM secret |
| `AWS_REGION` | `us-east-1` |
| `S3_APP_BUCKET` | `prime-tracker-app-221082191502` |
| `VITE_API_BASE_URL` | `https://api.theprimedeveloper.com` *(already set — verify value)* |

### Required GitHub repo variable (Settings → Variables → Actions)

| Variable | Value |
|---|---|
| `DEPLOY_ENABLED` | `true` |

### One-time manual steps after first successful deploy

1. **TLS for API:** SSH to EC2, then:
   ```bash
   sudo certbot --nginx -d api.theprimedeveloper.com
   ```
2. **PM2 on reboot:** run once after first deploy:
   ```bash
   pm2 startup    # prints a command — run it with sudo
   pm2 save
   ```
3. **SES:** request production access (exit sandbox) in the SES console.

### Phase 2 (when ready): enable DNS + CloudFront

```bash
# In terraform.tfvars add:  enable_dns = true
terraform apply
# Then set CF_DIST_ID secret to: terraform output app_cloudfront_distribution_id
```

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
