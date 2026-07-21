# AWS Account Shift — Test Account → Client Production Account

Move the full Prime Tracker AWS stack from the current **test account `221082191502`**
(Asan, throwaway) into the **client's real AWS Organization account** in `us-east-1`.

Because everything is IaC (`infra/terraform/`) + SSM deploy scripts, and the Supabase
DB held **demo data only** (no real-data migration), this is mechanical: new creds →
fresh remote state → new `terraform.tfvars` → `apply` → load secrets → migrate+seed →
redeploy → repoint external access → destroy the old account.

**The application code does not change.** Only config *values* change, and most
auto-derive from the account (S3 bucket names use `aws_caller_identity` — see
`infra/terraform/locals.tf`).

---

## Decisions (locked)

| Topic | Decision |
|---|---|
| Target account | Client's real AWS Org account (long-lived) |
| Region | `us-east-1` (EC2 + RDS co-located) |
| Domain / DNS | None yet → `enable_dns = false`, stay on nip.io / Elastic IP |
| Storage | **S3** (`STORAGE_DRIVER=s3`) — Supabase fully cut; S3 driver already on `main` |
| Mail | SES **sandbox** only (verify one test recipient); no prod domain identity |
| Data | Demo data only → **seed**, no pg_dump/restore |
| Terraform state | **Remote** (S3 + DynamoDB) in the client account — not laptop-local |
| RDS deletion protection | **ON** (real account) |
| IAM user | Client creates manually; **do NOT connect to the AWS MCP** |

## What auto-derives vs. what is manual

| Value | New account |
|---|---|
| S3 bucket names, account id, AZ names, AMI ids | ✅ Auto (`data.aws_caller_identity` / data lookups) |
| VPC, subnets, SGs, IAM roles, RDS, EC2 | ✅ Auto (greenfield build) |
| RDS endpoint, EC2 instance id, **Elastic IP** | ⚠️ New values → propagate to nip.io host, GitHub secrets, `VITE_API_BASE_URL` |
| SSM secrets (`/prime-tracker/*`) | ❌ Manual — TF creates `REPLACE_ME`, you load real values |
| `~/.aws/credentials`, `terraform.tfvars`, remote-state backend | ❌ Manual |

---

## Prerequisites (client)

1. AWS account provisioned in the client's Organization.
2. Bootstrap IAM user (e.g. `terraform-prime`) with `AdministratorAccess` + a CLI access
   key. **Do not connect it to the AWS MCP** — local creds + Terraform/CLI only.
3. Billing → Preferences → **Receive Billing Alerts** enabled (one-time; required for the
   CloudWatch billing alarm).

---

## Runbook

### 0. Point local creds at the new account
```bash
# ~/.aws/credentials
[prime-client]
aws_access_key_id     = AKIA...(client account)
aws_secret_access_key = ...
export AWS_PROFILE=prime-client
aws sts get-caller-identity        # MUST show the client account id, not 221082191502
```

### 1. Create the remote-state backend (once, client account)
```bash
aws s3api create-bucket --bucket prime-tracker-tfstate-<CLIENT_ACCT_ID> --region us-east-1
aws s3api put-bucket-versioning --bucket prime-tracker-tfstate-<CLIENT_ACCT_ID> \
  --versioning-configuration Status=Enabled
aws dynamodb create-table --table-name prime-tracker-tflock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST --region us-east-1
```
Then uncomment the `backend "s3"` block in `infra/terraform/versions.tf` and set the
bucket to `prime-tracker-tfstate-<CLIENT_ACCT_ID>`.

### 2. Fresh state — do NOT reuse the old account's state
```bash
cd infra/terraform
mv terraform.tfstate         terraform.tfstate.OLD-221082191502
mv terraform.tfstate.backup  terraform.tfstate.backup.OLD
```

### 3. New `terraform.tfvars`
```hcl
aws_region  = "us-east-1"
enable_dns  = false
ssh_public_key          = "ssh-ed25519 AAAA..."      # ~/.ssh/prime-tracker-ec2.pub (reuse or regen)
admin_cidr              = "<your-ip>/32"              # curl -s https://checkip.amazonaws.com
db_password             = "<openssl rand -base64 24>"
alarm_email             = "kalyan91333@gmail.com"
rds_deletion_protection = true
```

### 4. Apply (Phase 1 ≈ 42 resources)
```bash
terraform init                     # initializes the S3 backend
terraform plan -out=tf.plan        # confirm NEW account + 0 resources to destroy
terraform apply tf.plan
```

### 5. Load real secrets into SSM
```bash
export AWS_REGION=us-east-1
export DATABASE_URL="$(terraform output -raw database_url_for_ssm)"
export ENCRYPTION_KEY="<fresh 64-hex — demo DB, nothing to preserve>"
./scripts/put-ssm-params.sh        # JWT_* + REDIS_PASSWORD auto-generate
```
Set S3 storage so Supabase never instantiates:
`STORAGE_DRIVER=s3`, `S3_BUCKET=prime-tracker-documents-<CLIENT_ACCT_ID>`, `AWS_REGION=us-east-1`.

### 6. DB migrate + seed (fresh RDS)
```bash
aws ssm start-session --target <new-instance-id>
cd apps/api
npx prisma migrate deploy          # all 30 migrations
npx prisma migrate status          # "up to date"
pnpm run db:seed                   # 12 @prime.dev demo users / Prime@123
```

### 7. Deploy the app
Rerun the SSM deploy scripts against the new instance id.
⚠️ **t3.micro OOM gotcha:** box needs the 4 GB swapfile + `NODE_OPTIONS=--max-old-space-size=3072`
(already in `deploy1.sh`) or `pnpm install`/`nest build` wedges the box.

### 8. External access (new Elastic IP → new nip.io host)
- `http://<new-eip-dashes>.nip.io/api/health` → 200
- certbot for HTTPS (self-healing `prime-certbot-retry.service` handles the LE cert)
- Rebuild SPA with `VITE_API_BASE_URL=` empty (same-origin) → upload `web-dist.tar.gz`
  to the new documents bucket → box serves via Nginx.

### 9. Update GitHub Actions deploy secrets (all account-specific)
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `EC2_HOST` (new EIP), `EC2_SSH_KEY`,
`S3_APP_BUCKET` (new acctid suffix); repo var `DEPLOY_ENABLED=true`.

### 10. Tear down the old test account (after new account verified end-to-end)
```bash
# with the OLD profile + archived state
export AWS_PROFILE=<old>
terraform destroy                  # first set rds_deletion_protection=false and apply
```

---

## Deferred (not now)

- Route 53 / ACM / CloudFront (`enable_dns=true`) — needs a delegated domain.
- SES production access — stays sandbox; verify one recipient.
- Google OAuth prod — password login covers it.

## Verification checklist

- [ ] `aws sts get-caller-identity` = client account
- [ ] `terraform plan` shows create-only, 0 destroy
- [ ] `GET /api/health` = 200, `/api/health/ready` DB `ok:true`
- [ ] `prisma migrate status` = up to date; seed = 16 users
- [ ] Password login works (`founder@prime.dev` / `Prime@123`)
- [ ] S3 driver active (no Supabase WebSocket in logs)
- [ ] Billing SNS + SES verify emails confirmed (kalyan91333@gmail.com)
- [ ] Old account `terraform destroy` clean
