#!/usr/bin/env bash
# Local deploy — no GitHub Actions needed.
# Builds locally, pushes API to EC2 over SSH, pushes web to S3.
#
# Usage:
#   ./infra/scripts/deploy.sh           # deploy API + web
#   ./infra/scripts/deploy.sh api       # API only
#   ./infra/scripts/deploy.sh web       # web only
#
# Prerequisites:
#   - SSH key at ~/.ssh/prime-tracker-ec2  (or set SSH_KEY env var)
#   - AWS CLI configured: aws configure --profile prime
#   - pnpm installed locally

set -euo pipefail

# ── Config (override via env vars if needed) ───────────────────────────────────
EC2_HOST="${EC2_HOST:-98.89.192.161}"
EC2_USER="${EC2_USER:-ubuntu}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/prime-tracker-ec2}"
REMOTE_DIR="/home/ubuntu/prime-tracker"
NGINX_WEB_ROOT="${NGINX_WEB_ROOT:-/var/www/prime-web}"
S3_BUCKET="${S3_BUCKET:-prime-tracker-app-221082191502}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_PROFILE="${AWS_PROFILE:-prime}"
# Empty = same-origin relative /api (API and web served from same Nginx host).
# Set to https://your-api-domain for separate API hosting.
VITE_API_BASE_URL="${VITE_API_BASE_URL:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"

check_ssh_key() {
  if [ ! -f "$SSH_KEY" ]; then
    echo "ERROR: SSH key not found at $SSH_KEY"
    echo "  Set SSH_KEY=/path/to/private-key or place it at ~/.ssh/prime-tracker-ec2"
    exit 1
  fi
}

# ── API deploy ─────────────────────────────────────────────────────────────────
deploy_api() {
  check_ssh_key
  echo ""
  echo "▶  API → EC2 $EC2_HOST"

  # 1. Build locally
  echo "   [1/4] Building API..."
  cd "$ROOT"
  pnpm --filter @prime-tracker/api run build

  # 2. Sync source (no node_modules, no .env, no web, no infra secrets)
  echo "   [2/4] Syncing source to EC2..."
  $SSH "$EC2_USER@$EC2_HOST" "mkdir -p $REMOTE_DIR"
  rsync -az \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.env*' \
    --exclude '.git' \
    --exclude 'apps/web' \
    --exclude 'infra/terraform/terraform.tfstate*' \
    --exclude 'infra/terraform/.terraform' \
    --exclude 'infra/terraform/terraform.tfvars' \
    -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
    "$ROOT/" \
    "$EC2_USER@$EC2_HOST:$REMOTE_DIR/"

  # Sync the built dist separately (--delete keeps it clean)
  rsync -az --delete \
    -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
    "$ROOT/apps/api/dist/" \
    "$EC2_USER@$EC2_HOST:$REMOTE_DIR/apps/api/dist/"

  # 3. On EC2: install deps + write .env from SSM + migrate + restart PM2
  echo "   [3/4] Installing deps, migrating, restarting PM2..."
  $SSH "$EC2_USER@$EC2_HOST" bash <<'REMOTE'
set -euo pipefail
cd /home/ubuntu/prime-tracker

# Install production dependencies (uses pnpm store cache — fast after first run)
pnpm install --frozen-lockfile

# Write apps/api/.env from SSM (instance IAM role has ssm:GetParameter*)
for P in DATABASE_URL ENCRYPTION_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET \
          JWT_ACCESS_SECRET JWT_REFRESH_SECRET QB_CLIENT_ID QB_CLIENT_SECRET REDIS_PASSWORD; do
  V=$(aws ssm get-parameter --name /prime-tracker/$P --with-decryption \
        --region us-east-1 --query Parameter.Value --output text 2>/dev/null || echo '')
  echo "$P=$V"
done > apps/api/.env
printf 'NODE_ENV=production\nAPI_PORT=3001\nFRONTEND_URL=https://app.theprimedeveloper.com\nCORS_ORIGINS=https://app.theprimedeveloper.com\nAPP_BASE_URL=https://app.theprimedeveloper.com\nGOOGLE_ALLOWED_DOMAIN=primedevelopers.com\nGOOGLE_CALLBACK_URL=https://app.theprimedeveloper.com/api/auth/google/callback\nJWT_ACCESS_EXPIRY=15m\nJWT_REFRESH_EXPIRY=7d\n' >> apps/api/.env
printf 'DIRECT_URL=%s\n' "$(grep -m1 '^DATABASE_URL=' apps/api/.env | cut -d= -f2-)" >> apps/api/.env
chmod 600 apps/api/.env

# Run pending migrations
export DATABASE_URL
DATABASE_URL=$(grep -m1 '^DATABASE_URL=' apps/api/.env | cut -d= -f2-)
pnpm --filter @prime-tracker/api exec prisma migrate deploy

# Start (first time) or restart (subsequent)
if pm2 describe prime-api >/dev/null 2>&1; then
  pm2 restart prime-api --update-env
else
  pm2 start apps/api/dist/main.js \
    --name prime-api \
    --cwd /home/ubuntu/prime-tracker/apps/api \
    --log /home/ubuntu/prime-api.log \
    --time
  pm2 save
fi

# Health check — fail deploy if API doesn't come up within 30 s
for i in $(seq 1 6); do
  sleep 5
  if curl -sf http://localhost:3001/api/health >/dev/null 2>&1; then
    echo "API healthy ✓"
    break
  fi
  [ "$i" -eq 6 ] && { echo "ERROR: API did not become healthy in 30 s"; pm2 logs prime-api --lines 30; exit 1; }
done

echo ""
pm2 list
REMOTE

  echo "   [4/4] API deploy complete ✓"
}

# ── Web deploy ─────────────────────────────────────────────────────────────────
deploy_web() {
  check_ssh_key
  echo ""
  echo "▶  Web → EC2 $NGINX_WEB_ROOT"

  # Build locally (empty VITE_API_BASE_URL = relative /api, same-origin via Nginx)
  echo "   [1/3] Building web (VITE_API_BASE_URL='$VITE_API_BASE_URL')..."
  cd "$ROOT"
  VITE_API_BASE_URL="$VITE_API_BASE_URL" pnpm --filter @prime-tracker/web run build

  # Rsync dist directly to EC2 Nginx web root
  echo "   [2/3] Syncing dist to EC2 $NGINX_WEB_ROOT..."
  $SSH "$EC2_USER@$EC2_HOST" "sudo mkdir -p $NGINX_WEB_ROOT && sudo chown -R ubuntu:ubuntu $NGINX_WEB_ROOT"
  rsync -az --delete \
    -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
    "$ROOT/apps/web/dist/" \
    "$EC2_USER@$EC2_HOST:$NGINX_WEB_ROOT/"

  # Reload Nginx (no downtime)
  echo "   [3/3] Reloading Nginx..."
  $SSH "$EC2_USER@$EC2_HOST" "sudo nginx -s reload"

  echo "   Web deploy complete ✓"

  # Also sync to S3 for future CloudFront (Phase 2) — optional
  if [ -n "${S3_BUCKET:-}" ] && aws sts get-caller-identity --profile "$AWS_PROFILE" >/dev/null 2>&1; then
    echo "   Syncing to S3 s3://$S3_BUCKET (Phase 2 backup)..."
    AWS_PROFILE="$AWS_PROFILE" aws s3 sync \
      "$ROOT/apps/web/dist/" \
      "s3://$S3_BUCKET/" \
      --delete \
      --region "$AWS_REGION" \
      --quiet
    if [ -n "${CF_DIST_ID:-}" ]; then
      AWS_PROFILE="$AWS_PROFILE" aws cloudfront create-invalidation \
        --distribution-id "$CF_DIST_ID" --paths "/*" --region us-east-1 >/dev/null
      echo "   CloudFront invalidated ✓"
    fi
  fi
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
    echo "  api  — build + rsync API to EC2, migrate, restart PM2"
    echo "  web  — build web locally, rsync to EC2 Nginx root + optional S3 backup"
    echo "  all  — both (default)"
    exit 1
    ;;
esac

echo ""
echo "Deployed in $(( $(date +%s) - START ))s."
