# AWS Account Shift — Test Account → Client Production Account

Move the full Prime Tracker AWS stack from the current **test account `221082191502`**
(Asan, throwaway) into the **client's real AWS Organization account** in `us-east-1`.

Because everything is IaC (`infra/terraform/`) + SSM deploy scripts, this is mostly
mechanical: new creds → fresh remote state → new `terraform.tfvars` → `apply` (empty
DB) → **pg_dump/restore the real data across** → copy S3 documents → redeploy →
repoint external access → destroy the old account.

> **UPDATE 2026-07-23:** the account has been in active use for testing since
> go-live (loan creation, document uploads, etc.) — it is **no longer demo-only
> data**. Confirmed via AWS: RDS is `db.t3.micro`/Postgres 15.17, tiny (dump/restore
> is fast); `prime-tracker-documents-221082191502` has 20 objects / ~11 MB. This
> replaces the old "reseed, nothing to preserve" plan below with a real
> **pg_dump → pg_restore** step (Section 6A) so nothing created during testing is
> lost, and reuses **the current `ENCRYPTION_KEY` unchanged** (see Section 5) —
> `infra/terraform/README.md` and `put-ssm-params.sh` already enforce this for a
> reason: AES-256-GCM loan fields encrypted under the old key become permanently
> unreadable if the key is regenerated instead of carried over.

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
| Data | **Real** (testing since go-live) → **pg_dump/pg_restore**, no reseed |
| Secrets on migration | `ENCRYPTION_KEY` **carried over unchanged**; JWT_*/REDIS_PASSWORD/DB password may be fresh |

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
export ENCRYPTION_KEY="<the CURRENT prod key — pull from old SSM, do NOT regenerate>"
#   aws ssm get-parameter --name /prime-tracker/ENCRYPTION_KEY --with-decryption \
#     --profile <old> --query Parameter.Value --output text
./scripts/put-ssm-params.sh        # JWT_* + REDIS_PASSWORD may auto-generate fresh (sessions only, no data impact)
```
Set S3 storage so Supabase never instantiates:
`STORAGE_DRIVER=s3`, `S3_BUCKET=prime-tracker-documents-<CLIENT_ACCT_ID>`, `AWS_REGION=us-east-1`.

### 6A. Migrate the real data (pg_dump → pg_restore) — do this instead of migrate+seed
RDS is `publicly_accessible=false` (only reachable from its own EC2 box), so the dump
has to run from inside each account's network via SSM. The DB is small (t3.micro,
handful of MB of real rows) so this takes seconds.

```bash
# --- on the OLD box (SSM session, old profile) ---
aws ssm start-session --target <old-instance-id>
pg_dump "$DATABASE_URL" -Fc --no-owner --no-acl -f /tmp/prime-tracker.dump
aws s3 cp /tmp/prime-tracker.dump s3://prime-tracker-app-221082191502/migration/prime-tracker.dump
exit
# generate a presigned URL (works cross-account, no bucket-policy edits needed)
aws s3 presign s3://prime-tracker-app-221082191502/migration/prime-tracker.dump --expires-in 3600

# --- on the NEW box (SSM session, new profile) ---
aws ssm start-session --target <new-instance-id>
curl -o /tmp/prime-tracker.dump "<presigned URL from above>"
pg_restore --no-owner --no-acl --clean --if-exists -d "$DATABASE_URL" /tmp/prime-tracker.dump
```
This brings over schema + `_prisma_migrations` history + every real row in one shot —
**skip `prisma migrate deploy` and `db:seed` entirely** for this path (they're for a
fresh/empty DB). Just confirm afterward:
```bash
cd apps/api && npx prisma migrate status   # should read "up to date"
```

### 6B. Copy the S3 documents (~20 objects / ~11 MB — trivial)
```bash
aws s3 sync s3://prime-tracker-documents-221082191502 /tmp/docs-migration --profile <old>
aws s3 sync /tmp/docs-migration s3://prime-tracker-documents-<CLIENT_ACCT_ID>   --profile <new>
```
Object **keys** must stay identical — `Document.storagePath` rows just point at
`S3_BUCKET`/key, so as long as keys match, the migrated rows resolve correctly
against the new bucket with no DB changes needed.

### 6-fallback. If real-data preservation is ever waived (fresh reseed instead)
```bash
npx prisma migrate deploy          # all migrations, empty DB
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
- [ ] `prisma migrate status` = up to date (via pg_restore, not fresh migrate+seed)
- [ ] Row counts match old vs new DB (spot-check `sales`, `loans`, `documents` counts)
- [ ] A pre-existing loan record decrypts correctly (proves `ENCRYPTION_KEY` carried over right)
- [ ] Password login works with existing users (not just the original 12 demo seeds)
- [ ] A pre-existing uploaded document opens/downloads correctly from the new bucket
- [ ] S3 driver active (no Supabase WebSocket in logs)
- [ ] Billing SNS + SES verify emails confirmed (kalyan91333@gmail.com)
- [ ] Old account `terraform destroy` clean (only after the above all pass)
