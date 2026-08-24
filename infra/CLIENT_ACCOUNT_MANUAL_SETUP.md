# Prime Tracker — Manual AWS Setup (Client Account)

Console/CLI runbook to stand up the same stack that's already running in the
testing account (`221082191502`), by hand, in the client's AWS account
(`056836825737`) — **no Terraform, no shared credentials with Claude.**
You drive this end to end using your own SSO login (`AWSReservedSSO_AdministratorAccess`).

Everything here mirrors `infra/terraform/*.tf` exactly — same CIDRs, same
security group rules, same IAM policy shape, same EC2 bootstrap steps — so
the two environments stay equivalent. Where a step is just "click this",
it's marked 🖱️. Where it's a command you run in a terminal *after*
`aws sso login`, it's marked ⌨️.

**Region: `us-east-1` throughout.**

---

## 0. Get your own CLI access (no IAM user needed)

You're SSO-only, which is the *right* setup — don't create a static IAM
user just for yourself either. Get short-lived CLI credentials instead:

```bash
aws configure sso
# SSO start URL: (from your Identity Center portal)
# SSO region: us-east-1
# Role: AWSReservedSSO_AdministratorAccess_...
# CLI profile name: prime-client
```

Then before any ⌨️ command below:
```bash
aws sso login --profile prime-client
export AWS_PROFILE=prime-client
```
Credentials auto-refresh via browser SSO prompt when they expire (~1–12h
depending on your org's session policy). Nothing here is ever stored as a
long-lived key.

---

## 1. VPC & Networking

🖱️ **VPC Console → Create VPC** (or "VPC and more" wizard — steps below are for the plain wizard, matching Terraform exactly):

1. **Create VPC** — IPv4 CIDR `10.0.0.0/16`, name `prime-tracker-vpc`. Enable DNS hostnames + DNS resolution (default is fine).
2. **Create Internet Gateway** — name `prime-tracker-igw` → attach it to the VPC.
3. **Create subnets** (all in the new VPC):
   - `prime-tracker-public-a` — CIDR `10.0.1.0/24`, AZ = first AZ in the region (e.g. `us-east-1a`). Enable **auto-assign public IPv4**.
   - `prime-tracker-private-0` — CIDR `10.0.10.0/24`, AZ = `us-east-1a`.
   - `prime-tracker-private-1` — CIDR `10.0.11.0/24`, AZ = a **different** AZ (e.g. `us-east-1b`). RDS requires ≥2 AZs in its subnet group even for Single-AZ.
4. **Route tables** — create `prime-tracker-public-rt`, add route `0.0.0.0/0 → Internet Gateway`, associate it with `prime-tracker-public-a` only. Leave the two private subnets on the VPC's default (no-internet) route table — RDS needs no outbound internet, which is why there's no NAT gateway (saves ~$32/mo).

---

## 2. Security Groups

🖱️ **EC2 Console → Security Groups → Create security group**, twice:

**`prime-tracker-ec2-sg`** (VPC = the one above)
| Type | Port | Source |
|---|---|---|
| HTTP | 80 | `0.0.0.0/0` |
| HTTPS | 443 | `0.0.0.0/0` |
| SSH | 22 | **your current IP**, as `x.x.x.x/32` — never `0.0.0.0/0` |

Outbound: leave the default "allow all".

**`prime-tracker-rds-sg`** (same VPC)
| Type | Port | Source |
|---|---|---|
| PostgreSQL | 5432 | the **security group ID** of `prime-tracker-ec2-sg` (not a CIDR — pick "Custom" and start typing the SG name) |

---

## 3. IAM role for the EC2 instance

This is a **service role the app instance assumes** — not human/automation
access, so it doesn't conflict with "no new IAM user for Claude."

🖱️ **IAM → Roles → Create role**
1. Trusted entity: **AWS service → EC2**.
2. Attach policy: **`AmazonSSMManagedInstanceCore`** (AWS managed — gives keyless shell access via Session Manager, no SSH needed later if you don't want it).
3. Name it `prime-tracker-ec2-role` → create.
4. Open the role → **Add permissions → Create inline policy** → JSON tab → paste (fill in the two bucket ARNs after you create them in step 5):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadSecrets",
      "Effect": "Allow",
      "Action": ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"],
      "Resource": "arn:aws:ssm:us-east-1:056836825737:parameter/prime-tracker/*"
    },
    {
      "Sid": "DecryptSecrets",
      "Effect": "Allow",
      "Action": ["kms:Decrypt"],
      "Resource": "*",
      "Condition": { "StringEquals": { "kms:ViaService": "ssm.us-east-1.amazonaws.com" } }
    },
    {
      "Sid": "MediaAndDocsBuckets",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::prime-tracker-media-056836825737",
        "arn:aws:s3:::prime-tracker-media-056836825737/*",
        "arn:aws:s3:::prime-tracker-documents-056836825737",
        "arn:aws:s3:::prime-tracker-documents-056836825737/*"
      ]
    },
    {
      "Sid": "SendEmail",
      "Effect": "Allow",
      "Action": ["ses:SendEmail", "ses:SendRawEmail"],
      "Resource": "*"
    }
  ]
}
```
Name it `prime-tracker-ec2-app`, save.

5. **IAM → Instance profiles** are created automatically when you launch an EC2 with this role attached via the console — nothing extra to do.

---

## 4. RDS (PostgreSQL)

🖱️ **RDS Console → Subnet groups → Create DB subnet group**
- Name `prime-tracker-db-subnets`, VPC = yours, add both **private** subnets (`private-0`, `private-1`).

🖱️ **RDS Console → Databases → Create database**
- Engine: **PostgreSQL**, version **15.x** (match testing exactly).
- Templates: **Free tier** (or Dev/Test).
- DB instance identifier: `prime-tracker-db`.
- Master username: `prime`. Master password: generate a strong 20+ char password — **save it somewhere durable, you'll need it once for SSM and never again if you lose it you must reset it**.
- Instance class: `db.t3.micro`.
- Storage: gp3, **20 GiB**, enable storage autoscaling up to 100 GiB.
- Connectivity: your VPC, the `prime-tracker-db-subnets` group, **Public access = No**, VPC security group = `prime-tracker-rds-sg` only (remove "default").
- Additional configuration: Initial database name `prime_tracker`. Backup retention **7 days**. Enable storage encryption (default AWS-managed key is fine). **Enable deletion protection.**
- Create. Takes ~5–10 min.

Once available, copy the **endpoint hostname** shown on the DB's page (looks like `prime-tracker-db.xxxxx.us-east-1.rds.amazonaws.com`) — you'll need it for `DATABASE_URL` in step 7.

---

## 5. S3 buckets

🖱️ **S3 Console → Create bucket**, three times, all with **Block all public access = ON** and **default encryption = SSE-S3 (AES256)**:

1. `prime-tracker-app-056836825737` — the built React SPA. (Bucket names are globally unique — account-id suffix avoids collisions.)
2. `prime-tracker-media-056836825737` — public project photos (served via CloudFront in Phase 2, not directly public at the bucket level).
3. `prime-tracker-documents-056836825737` — private files, app issues 15-min presigned URLs. **Enable versioning** on this one specifically (Properties tab after creation).

On **`media`** and **`documents`** buckets → **Permissions tab → CORS** → paste:
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedOrigins": [
      "https://app.theprimedeveloper.com",
      "http://localhost:5173",
      "http://localhost:3001"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```
(Drop the two `localhost` origins from `documents`' rule if you want to match Terraform's exact split — harmless to leave them on both.)

Leave the bucket policies empty for now — Phase 2 (CloudFront) adds an OAC-scoped policy to `app` and `media` later; skip that until you're ready for DNS cutover.

---

## 6. EC2 instance

🖱️ **EC2 Console → Key Pairs → Create key pair**
- Name `prime-tracker-ec2`, type ED25519, format `.pem`. **Download it — shown once.** Save as `~/.ssh/prime-tracker-ec2` locally, `chmod 400` it.

🖱️ **EC2 Console → Launch instance**
- Name: `prime-tracker-api`.
- AMI: **Ubuntu Server 22.04 LTS** (amd64).
- Instance type: `t3.micro`.
- Key pair: `prime-tracker-ec2` (from above).
- Network: your VPC, subnet = `prime-tracker-public-a`, **auto-assign public IP = Enable**, security group = `prime-tracker-ec2-sg` (existing, not "create new").
- Storage: 20 GiB, gp3, **encrypted**.
- Advanced details → **IAM instance profile** = `prime-tracker-ec2-role`.
- Advanced details → **User data** — paste this (it's `infra/terraform/user-data.sh.tftpl` with `${domain}` filled in as `theprimedeveloper.com`):

```bash
#!/usr/bin/env bash
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git nginx ca-certificates gnupg

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
npm install -g pnpm@10 pm2

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
usermod -aG docker ubuntu

docker run -d --name redis --restart unless-stopped \
  -p 127.0.0.1:6379:6379 \
  redis:7-alpine redis-server --appendonly yes

snap install --classic certbot || apt-get install -y certbot python3-certbot-nginx
ln -sf /snap/bin/certbot /usr/bin/certbot || true

cat >/etc/nginx/sites-available/prime-api <<'NGINX'
server {
    listen 80;
    server_name api.theprimedeveloper.com;
    client_max_body_size 25m;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/prime-api /etc/nginx/sites-enabled/prime-api
rm -f /etc/nginx/sites-enabled/default
systemctl enable nginx
systemctl restart nginx

echo "Bootstrap complete."
```
- Launch. Wait ~2 min for boot + bootstrap (watch progress: **Session Manager** or SSH in, then `tail -f /var/log/cloud-init-output.log` until you see "Bootstrap complete.").

🖱️ **EC2 Console → Elastic IPs → Allocate** → then **Associate** it with the new instance. Note this IP — it's your `api.theprimedeveloper.com` target and the `EC2_HOST` for CI later.

---

## 7. SSM Parameter Store (secrets)

⌨️ Run locally (with `AWS_PROFILE=prime-client` exported per step 0):

```bash
REGION=us-east-1
PREFIX=/prime-tracker

put() { aws ssm put-parameter --region "$REGION" --name "${PREFIX}/$1" --type "${3:-SecureString}" --value "$2" --overwrite; }

put DATABASE_URL "postgresql://prime:<the RDS password from step 4>@<RDS endpoint from step 4>:5432/prime_tracker?schema=public"
put JWT_ACCESS_SECRET  "$(openssl rand -hex 32)"
put JWT_REFRESH_SECRET "$(openssl rand -hex 32)"
# CRITICAL: reuse the EXISTING production ENCRYPTION_KEY (encrypted loan fields
# in the migrated database were encrypted with it — a new key can't decrypt them).
put ENCRYPTION_KEY "<the CURRENT prod 64-hex key>"
put GOOGLE_CLIENT_ID     "<from Google Cloud console>" String
put GOOGLE_CLIENT_SECRET "<from Google Cloud console>"
put REDIS_PASSWORD "$(openssl rand -hex 24)"
# Optional — only if QuickBooks is live:
put QB_CLIENT_ID     "<value>" String
put QB_CLIENT_SECRET "<value>"

aws ssm get-parameters-by-path --path "$PREFIX" --region "$REGION" --query 'Parameters[].Name'
```

---

## 8. Deploy the API onto EC2

⌨️ SSH in (`ssh -i ~/.ssh/prime-tracker-ec2 ubuntu@<Elastic IP>`) or use **EC2 Console → Connect → Session Manager** (no SSH needed since the instance role has `AmazonSSMManagedInstanceCore`):

```bash
cd /home/ubuntu
git clone https://github.com/kalyan1421/prime-tracker.git
cd prime-tracker
pnpm install --frozen-lockfile
pnpm --filter @prime-tracker/api run build

# Pull the .env together from SSM (instance role already permits this):
for P in DATABASE_URL ENCRYPTION_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET \
         JWT_ACCESS_SECRET JWT_REFRESH_SECRET QB_CLIENT_ID QB_CLIENT_SECRET REDIS_PASSWORD; do
  V=$(aws ssm get-parameter --name /prime-tracker/$P --with-decryption --region us-east-1 --query Parameter.Value --output text 2>/dev/null || echo '')
  echo "$P=$V"
done > apps/api/.env
printf 'NODE_ENV=production\nAPI_PORT=3001\nFRONTEND_URL=https://app.theprimedeveloper.com\nCORS_ORIGINS=https://app.theprimedeveloper.com\nAPP_BASE_URL=https://app.theprimedeveloper.com\nGOOGLE_ALLOWED_DOMAIN=primedevelopers.com\nJWT_ACCESS_EXPIRY=15m\nJWT_REFRESH_EXPIRY=7d\n' >> apps/api/.env
printf 'DIRECT_URL=%s\n' "$(grep -m1 '^DATABASE_URL=' apps/api/.env | cut -d= -f2-)" >> apps/api/.env
chmod 600 apps/api/.env

# Migrate + start
export DATABASE_URL=$(grep -m1 '^DATABASE_URL=' apps/api/.env | cut -d= -f2-)
pnpm --filter @prime-tracker/api exec prisma migrate deploy
pnpm --filter @prime-tracker/api exec prisma migrate status   # expect "up to date"

pm2 start apps/api/dist/main.js --name prime-api --cwd /home/ubuntu/prime-tracker/apps/api --log /home/ubuntu/prime-api.log --time
pm2 save
pm2 startup   # prints a sudo command — run exactly what it prints, once

curl -sf http://localhost:3001/api/health && echo "API healthy ✓"
```

**TLS for the API** (do this once `api.theprimedeveloper.com` DNS actually resolves to the Elastic IP — see step 10):
```bash
sudo certbot --nginx -d api.theprimedeveloper.com
```

**For future redeploys**, either repeat the git-pull-through-pm2-restart part of this block by hand, or — better — set up `.github/workflows/deploy.yml`'s automated path (see step 11).

---

## 9. Build & deploy the web app to S3

⌨️ From your own machine (not EC2):

```bash
cd apps/web
VITE_API_BASE_URL=https://api.theprimedeveloper.com pnpm run build
aws s3 sync dist/ s3://prime-tracker-app-056836825737/ --delete --profile prime-client
```

Until CloudFront exists (Phase 2), there's no public URL for this bucket yet
— it's just staged and ready. If you want to *see* it working before doing
DNS/CloudFront, temporarily enable static website hosting on the bucket and
allow public read, then turn both back off before going further (Phase 2's
CloudFront + OAC replaces that entirely and is the intended long-term path).

---

## 10. Phase 2 — DNS, TLS, CloudFront, SES (do this when ready to go live)

Only start this once you're ready for `theprimedeveloper.com`'s nameservers
to actually point at this account — it's the moment traffic can move.

1. **Route 53 → Hosted zones → Create hosted zone** for `theprimedeveloper.com`. Note the 4 NS records shown.
2. At your domain **registrar**, replace the existing NS records with those 4. Wait for propagation (can take hours).
3. **ACM (us-east-1) → Request certificate** — public cert, domain `theprimedeveloper.com` + SAN `*.theprimedeveloper.com`, DNS validation. Once requested, ACM shows CNAME records to add — **Route 53 → your zone → click "Create record in Route 53"** next to each (auto-fills). Wait for status = Issued (~5–30 min after DNS propagates).
4. **CloudFront → Create distribution**, twice:
   - **App distribution**: origin = `prime-tracker-app-056836825737` S3 bucket (choose "Origin access control settings" → create new OAC → it'll prompt you to update the bucket policy automatically). Alternate domain name `app.theprimedeveloper.com`. Custom SSL cert = the one from step 3. Default root object `index.html`. **Error pages**: add custom error responses for 403 → `/index.html` (response code 200) and 404 → `/index.html` (response code 200) — this is what makes client-side routing work.
   - **Media distribution**: origin = `prime-tracker-media-056836825737`, same OAC pattern, alternate domain `media.theprimedeveloper.com`, same cert.
5. **Route 53 → your zone → Create record**:
   - `app.theprimedeveloper.com` → A → Alias → CloudFront app distribution.
   - `media.theprimedeveloper.com` → A → Alias → CloudFront media distribution.
   - `api.theprimedeveloper.com` → A → the EC2 Elastic IP (not aliased — this one bypasses CloudFront, goes straight to Nginx on the box).
6. Re-run the certbot command from step 8 now that `api.` actually resolves.
7. **SES**: **SES Console → Verified identities → Create identity** → domain `theprimedeveloper.com` → it gives you DKIM CNAME records → add them in Route 53 (same "create record" flow as ACM). New SES accounts start in the **sandbox** (can only email verified addresses) — **SES Console → Account dashboard → Request production access** to lift that; it's a manual support request, budget a day or two for approval.

---

## 11. Monitoring & billing alarm (optional, cheap insurance)

🖱️ **Billing Console → Billing preferences → enable "Receive Billing Alerts"** (one-time, required before the alarm below can fire).

🖱️ **SNS → Topics → Create topic** (Standard) → name `prime-tracker-alarms` → **Create subscription** → protocol Email → your address → confirm via the email you get.

🖱️ **CloudWatch (switch region to us-east-1 — billing metrics only publish there) → Alarms → Create alarm** → metric `AWS/Billing → EstimatedCharges` (Currency=USD) → threshold e.g. `> $30` → action = the SNS topic above.

---

## 12. Migrate the database (existing data → this RDS)

From wherever you can reach both the source (testing RDS / Supabase) and this new RDS:

```bash
pg_dump "postgresql://<source-user>:<source-pass>@<source-host>:5432/<source-db>" \
  --no-owner --no-acl -Fc -f prime_tracker.dump

pg_restore --no-owner --no-acl \
  -d "postgresql://prime:<password>@<new RDS endpoint>:5432/prime_tracker" \
  prime_tracker.dump
```
Run this **before** step 8's `prisma migrate deploy` if restoring into a
truly empty DB (restore first, migrate applies anything newer than the
dump); run it after if you seeded/migrated an empty DB first and are instead
merging — but doing both is unusual, pick one path deliberately rather than
running both. `ENCRYPTION_KEY` in step 7 **must** be the source environment's
key or encrypted loan fields silently fail to decrypt after restore.

---

## 13. Post-checklist

- [ ] Google Cloud Console → OAuth client → add authorized redirect URI `https://api.theprimedeveloper.com/api/auth/google/callback`
- [ ] `pm2 startup` command actually run with `sudo` (step 8) — otherwise the API doesn't survive a reboot
- [ ] SES production access approved (step 10.7), or leave `MAIL_DRIVER=smtp` in `.env` until it is
- [ ] RDS final-snapshot / deletion-protection confirmed **on** (step 4)
- [ ] Old testing-account resources — decide keep vs. tear down once this is verified working; don't delete testing until the client account is confirmed healthy end-to-end

## Wiring up automated redeploys later (optional)

Once this is stable, `.github/workflows/deploy.yml` already knows how to do
steps 8–9 automatically on every push to `main` — see
`infra/terraform/README.md` §"Step 5 — Arm GitHub Actions deploy" for the
exact secrets it needs (`EC2_HOST`, `EC2_SSH_KEY`, `GH_DEPLOY_TOKEN`,
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, `S3_APP_BUCKET`,
`DEPLOY_ENABLED=true`). That's a separate decision from this manual setup —
nothing here requires it.
