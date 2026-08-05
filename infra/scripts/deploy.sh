#!/usr/bin/env bash
# SSM-based deploy — no SSH or security-group changes needed.
# Builds locally, uploads dist to S3, EC2 executes via SSM send-command.
#
# Usage:
#   ./infra/scripts/deploy.sh           # deploy API + web
#   ./infra/scripts/deploy.sh api       # API only
#   ./infra/scripts/deploy.sh web       # web only
#
# Override defaults via env vars:
#   APP_URL=https://yourdomain.com EC2_INSTANCE=i-xxx ./infra/scripts/deploy.sh

set -euo pipefail

EC2_INSTANCE="${EC2_INSTANCE:-i-03fee763407298417}"
DEPLOY_BUCKET="${DEPLOY_BUCKET:-prime-tracker-documents-221082191502}"
AWS_REGION="${AWS_REGION:-us-east-1}"
APP_URL="${APP_URL:-https://98-89-192-161.nip.io}"
GIT_BRANCH="${GIT_BRANCH:-main}"
# The .env below is rewritten from scratch on every deploy, so anything set by hand on the
# box is silently lost. Mail settings live here for the same reason STORAGE_DRIVER/S3_BUCKET
# do: without MAIL_DRIVER=ses the mailer falls back to smtp, finds no SMTP_HOST, and disables
# email entirely (in-app notifications only) — a silent regression, not a startup failure.
# SMTP_FROM must be an SES-verified identity or every send is rejected.
MAIL_DRIVER="${MAIL_DRIVER:-ses}"
SMTP_FROM="${SMTP_FROM:-Prime Tracker <kalyan91333@gmail.com>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# ── SSM helper ─────────────────────────────────────────────────────────────────
# Uploads a shell script to S3, runs it on EC2 via SSM, streams output.
ssm_script() {
  local comment="$1"
  local script_body="$2"
  local key="deploy/run-$$-${RANDOM}.sh"

  printf '%s\n' "$script_body" \
    | aws s3 cp - "s3://$DEPLOY_BUCKET/$key" --region "$AWS_REGION" --quiet

  local cmd_id
  cmd_id=$(aws ssm send-command \
    --region "$AWS_REGION" \
    --instance-ids "$EC2_INSTANCE" \
    --document-name "AWS-RunShellScript" \
    --comment "$comment" \
    --parameters "commands=[\"aws s3 cp s3://$DEPLOY_BUCKET/$key /tmp/deploy-step.sh --region $AWS_REGION --quiet && bash /tmp/deploy-step.sh\"]" \
    --query "Command.CommandId" \
    --output text)

  until aws ssm get-command-invocation \
    --region "$AWS_REGION" --command-id "$cmd_id" \
    --instance-id "$EC2_INSTANCE" --query "Status" --output text 2>/dev/null \
    | grep -qE "^(Success|Failed|TimedOut|Cancelled)$"; do
    sleep 6
  done

  local status out err
  out=$(aws ssm get-command-invocation --region "$AWS_REGION" \
    --command-id "$cmd_id" --instance-id "$EC2_INSTANCE" \
    --query "StandardOutputContent" --output text 2>/dev/null || true)
  err=$(aws ssm get-command-invocation --region "$AWS_REGION" \
    --command-id "$cmd_id" --instance-id "$EC2_INSTANCE" \
    --query "StandardErrorContent" --output text 2>/dev/null || true)
  status=$(aws ssm get-command-invocation --region "$AWS_REGION" \
    --command-id "$cmd_id" --instance-id "$EC2_INSTANCE" \
    --query "Status" --output text)

  [ -n "$out" ] && echo "$out"
  [ -n "$err" ] && echo "$err" >&2

  aws s3 rm "s3://$DEPLOY_BUCKET/$key" --region "$AWS_REGION" --quiet 2>/dev/null || true

  if [ "$status" != "Success" ]; then
    echo "   ERROR: SSM step failed (status=$status)" >&2
    exit 1
  fi
}

# ── API deploy ─────────────────────────────────────────────────────────────────
deploy_api() {
  echo ""
  echo "▶  API → EC2 $EC2_INSTANCE (via SSM)"

  echo "   [1/4] Building API locally..."
  cd "$ROOT"
  NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @prime-tracker/api run build

  echo "   [2/4] Uploading API dist to S3..."
  tar -czf /tmp/api-dist.tar.gz -C "$ROOT/apps/api" dist/
  aws s3 cp /tmp/api-dist.tar.gz "s3://$DEPLOY_BUCKET/deploy/api-dist.tar.gz" \
    --region "$AWS_REGION" --quiet
  echo "   $(du -sh /tmp/api-dist.tar.gz | cut -f1) uploaded"

  echo "   [3/4] Git pull + extract dist + install + migrate + restart PM2..."
  # Write to a temp file (heredoc at statement level avoids bash 3.2 single-quote
  # parsing bug inside $(...) command substitution).
  local _tmpscript="/tmp/prime-deploy-api-$$.sh"
  cat > "$_tmpscript" << ENDSCRIPT
#!/bin/bash
export HOME=/home/ubuntu
export NVM_DIR=/home/ubuntu/.nvm
source "\$NVM_DIR/nvm.sh" 2>/dev/null || source /root/.nvm/nvm.sh 2>/dev/null || true
export PATH=\$PATH:/home/ubuntu/.local/share/pnpm:/usr/local/bin

set -eo pipefail
cd /home/ubuntu/prime-tracker

git config --global --add safe.directory /home/ubuntu/prime-tracker 2>/dev/null || true
git fetch origin ${GIT_BRANCH}
git reset --hard origin/${GIT_BRANCH}
echo "=== Pulled: \$(git log --oneline -1) ==="

pnpm install --frozen-lockfile 2>&1 | tail -5

aws s3 cp s3://${DEPLOY_BUCKET}/deploy/api-dist.tar.gz /tmp/api-dist.tar.gz --region ${AWS_REGION}
tar -xzf /tmp/api-dist.tar.gz -C apps/api/
echo "=== Dist extracted ==="

for P in DATABASE_URL ENCRYPTION_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET \
          JWT_ACCESS_SECRET JWT_REFRESH_SECRET QB_CLIENT_ID QB_CLIENT_SECRET REDIS_PASSWORD; do
  V=\$(aws ssm get-parameter --name /prime-tracker/\$P --with-decryption \
        --region ${AWS_REGION} --query Parameter.Value --output text 2>/dev/null || echo "")
  echo "\$P=\$V"
done > apps/api/.env
printf "NODE_ENV=production\nAPI_PORT=3001\nFRONTEND_URL=${APP_URL}\nCORS_ORIGINS=${APP_URL}\nAPP_BASE_URL=${APP_URL}\nGOOGLE_ALLOWED_DOMAIN=primedevelopers.com\nJWT_ACCESS_EXPIRY=15m\nJWT_REFRESH_EXPIRY=7d\nSTORAGE_DRIVER=s3\nS3_BUCKET=${DEPLOY_BUCKET}\nAWS_REGION=${AWS_REGION}\nMAIL_DRIVER=${MAIL_DRIVER}\nSMTP_FROM=${SMTP_FROM}\n" >> apps/api/.env
printf "DIRECT_URL=%s\n" "\$(grep -m1 '^DATABASE_URL=' apps/api/.env | cut -d= -f2-)" >> apps/api/.env
chmod 600 apps/api/.env
echo "=== .env written ==="

export DATABASE_URL=\$(grep -m1 '^DATABASE_URL=' apps/api/.env | cut -d= -f2-)
pnpm --filter @prime-tracker/api exec prisma migrate deploy 2>&1 | tail -8

# pnpm's build-script approval gate silently blocks Prisma's postinstall hook on this box,
# so \`pnpm install\` above does NOT regenerate the client — it's easy to end up running
# migrations against the DB while PM2 keeps serving a stale client that doesn't know about
# the new columns/fields (500s on every query touching them). Regenerate explicitly.
pnpm --filter @prime-tracker/api exec prisma generate 2>&1 | tail -8

sudo -u ubuntu pm2 restart prime-api --update-env 2>&1 || pm2 restart prime-api --update-env 2>&1

# Nest boots in well over 6s on a t3.micro once the module graph and Prisma client
# are loaded, so a single fixed sleep reports a false failure on a perfectly healthy
# deploy — and, worse, aborts the run before the web step. Poll instead: up to 12 x 5s.
for i in \$(seq 1 12); do
  if curl -sf http://localhost:3001/api/health; then
    echo && echo "=== API_OK (healthy after \$(( i * 5 ))s) ===" && exit 0
  fi
  sleep 5
done
echo "=== API_FAILED ==="
pm2 logs prime-api --lines 20 --nostream
exit 1
ENDSCRIPT

  ssm_script "prime-deploy-api" "$(cat "$_tmpscript")"
  rm -f "$_tmpscript"

  echo "   [4/4] API deploy complete ✓"
}

# ── Web deploy ─────────────────────────────────────────────────────────────────
deploy_web() {
  echo ""
  echo "▶  Web → EC2 $EC2_INSTANCE (via SSM)"

  echo "   [1/3] Building web locally..."
  cd "$ROOT"
  VITE_API_BASE_URL="" pnpm --filter @prime-tracker/web run build

  echo "   [2/3] Uploading web dist to S3..."
  tar -czf /tmp/web-dist.tar.gz -C "$ROOT/apps/web" dist/
  aws s3 cp /tmp/web-dist.tar.gz "s3://$DEPLOY_BUCKET/deploy/web-dist.tar.gz" \
    --region "$AWS_REGION" --quiet
  echo "   $(du -sh /tmp/web-dist.tar.gz | cut -f1) uploaded"

  echo "   [3/3] Deploying web on EC2..."
  local _tmpscript="/tmp/prime-deploy-web-$$.sh"
  cat > "$_tmpscript" << ENDSCRIPT
#!/bin/bash
export HOME=/root
set -e

aws s3 cp s3://${DEPLOY_BUCKET}/deploy/web-dist.tar.gz /tmp/web-dist.tar.gz --region ${AWS_REGION}
sudo mkdir -p /var/www/prime-web
sudo tar -xzf /tmp/web-dist.tar.gz --strip-components=1 -C /var/www/prime-web 2>&1 | grep -v LIBARCHIVE || true
sudo chown -R ubuntu:ubuntu /var/www/prime-web
sudo nginx -s reload
echo "=== Web deployed ==="
curl -sf -o /dev/null -w "%{http_code}" ${APP_URL}/ | grep -q 200 && echo "WEB_OK" || echo "WEB: check manually"
ENDSCRIPT

  ssm_script "prime-deploy-web" "$(cat "$_tmpscript")"
  rm -f "$_tmpscript"

  echo "   Web deploy complete ✓"
}

# ── Entry point ────────────────────────────────────────────────────────────────
TARGET="${1:-all}"
START=$(date +%s)

case "$TARGET" in
  api) deploy_api ;;
  web) deploy_web ;;
  all) deploy_api; deploy_web ;;
  *)
    echo "Usage: $0 [api|web|all]"
    echo "  api  — build API locally, upload dist to S3, deploy via SSM"
    echo "  web  — build web locally, upload dist to S3, deploy via SSM"
    echo "  all  — both (default)"
    exit 1 ;;
esac

echo ""
echo "Deployed in $(( $(date +%s) - START ))s."
