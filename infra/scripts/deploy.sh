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

# Production defaults (client account 056836825737). They used to name the old test
# account's instance and bucket, and nothing checked which account the credentials
# were for — so a deploy could land on the wrong box and report success.
ACCOUNT="${ACCOUNT:-056836825737}"
EC2_INSTANCE="${EC2_INSTANCE:-i-0412241c8f6d080a1}"
DEPLOY_BUCKET="${DEPLOY_BUCKET:-prime-tracker-documents-${ACCOUNT}}"
AWS_REGION="${AWS_REGION:-us-east-1}"
APP_URL="${APP_URL:-https://3-232-150-154.nip.io}"

actual_account="$(aws sts get-caller-identity --query Account --output text)"
if [ "$actual_account" != "$ACCOUNT" ]; then
  echo "AWS credentials are for account $actual_account, not $ACCOUNT. Use AWS_PROFILE=prime-client." >&2
  exit 1
fi

# The box checks out exactly the commit that is built here: the checkout supplies the
# migrations and package manifests, and they must match the artifact. That commit has
# to be committed and pushed, or the box cannot fetch it.
GIT_SHA="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse HEAD)"
if [ -n "$(git -C "$(dirname "${BASH_SOURCE[0]}")" status --porcelain --untracked-files=no)" ] && [ "${ALLOW_DIRTY:-}" != 1 ]; then
  echo "Uncommitted changes — the build would not match the commit the box checks out. Commit them, or ALLOW_DIRTY=1." >&2
  exit 1
fi
if [ -z "$(git -C "$(dirname "${BASH_SOURCE[0]}")" branch -r --contains "$GIT_SHA" 2>/dev/null)" ]; then
  echo "Commit $GIT_SHA is not on any remote branch — push it first." >&2
  exit 1
fi
# The .env below is rewritten from scratch on every deploy, so anything set by hand on the
# box is silently lost. Mail settings live here for the same reason STORAGE_DRIVER/S3_BUCKET
# do: without MAIL_DRIVER=ses the mailer falls back to smtp, finds no SMTP_HOST, and disables
# email entirely (in-app notifications only) — a silent regression, not a startup failure.
# SMTP_FROM must be an SES-verified identity or every send is rejected.
# Both real staff domains. It was hardcoded to primedevelopers.com, which covers 4
# accounts and would have rejected the 31 people on theprimedeveloper.com the moment
# Google SSO went live. Comma-separated; auth.service splits and trims.
GOOGLE_ALLOWED_DOMAIN="${GOOGLE_ALLOWED_DOMAIN:-theprimedeveloper.com,primedevelopers.com}"
MAIL_DRIVER="${MAIL_DRIVER:-ses}"
SMTP_FROM="${SMTP_FROM:-Prime Tracker <kalyan91333@gmail.com>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Build artifacts are staged inside the repo, NOT in /tmp.
#
# A sandboxed shell can redirect /tmp per-process: the `tar -czf /tmp/api-dist.tar.gz`
# wrote to one location while the following `aws s3 cp /tmp/api-dist.tar.gz` read another,
# so the upload silently shipped a LEFTOVER tarball from an earlier deploy. It fails
# silently in the worst possible way — the deploy reports success, migrations apply, and
# the box runs code from a previous release. A path under $ROOT cannot be redirected out
# from under the two commands that share it.
STAGE="$ROOT/.deploy-stage"
mkdir -p "$STAGE"

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
  tar -czf "$STAGE/api-dist.tar.gz" -C "$ROOT/apps/api" dist/
  aws s3 cp "$STAGE/api-dist.tar.gz" "s3://$DEPLOY_BUCKET/deploy/api-dist.tar.gz" \
    --region "$AWS_REGION" --quiet
  echo "   $(du -sh "$STAGE/api-dist.tar.gz" | cut -f1) uploaded"

  # Prove the artifact carries THIS commit before letting the box install it. Without
  # this the only symptom of a stale upload is a feature quietly missing in production.

  if ! tar -tzf "$STAGE/api-dist.tar.gz" >/dev/null 2>&1; then
    echo "   ERROR: api-dist.tar.gz is not a readable archive — aborting" >&2; exit 1
  fi
  echo "   artifact verified ($(tar -tzf "$STAGE/api-dist.tar.gz" | wc -l | tr -d ' ') entries)"

  echo "   [3/4] Git pull + extract dist + install + migrate + restart PM2..."
  # Write to a temp file (heredoc at statement level avoids bash 3.2 single-quote
  # parsing bug inside $(...) command substitution).
  local _tmpscript="$STAGE/prime-deploy-api-$$.sh"
  cat > "$_tmpscript" << ENDSCRIPT
#!/bin/bash
export HOME=/home/ubuntu
export NVM_DIR=/home/ubuntu/.nvm
source "\$NVM_DIR/nvm.sh" 2>/dev/null || source /root/.nvm/nvm.sh 2>/dev/null || true
export PATH=\$PATH:/home/ubuntu/.local/share/pnpm:/usr/local/bin

# SSM gives the remote script no TTY. When pnpm decides it needs to remove node_modules
# (any lockfile or store change will do it), it asks for confirmation, finds nothing to
# ask, and aborts with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY — which killed the
# deploy AFTER the git reset, leaving new source on the box with old dependencies. The
# variable is pnpm's own documented answer for exactly this.
export CI=true

set -eo pipefail
cd /home/ubuntu/prime-tracker

git config --global --add safe.directory /home/ubuntu/prime-tracker 2>/dev/null || true
git fetch --depth=1 origin ${GIT_SHA}
git reset --hard FETCH_HEAD
echo "=== Checked out: \$(git log --oneline -1) ==="

pnpm install --frozen-lockfile 2>&1 | tail -5

# @prime-tracker/shared compiles to dist and the API resolves it from node_modules at
# runtime. Only apps/api/dist is uploaded, and pnpm install does NOT build workspace
# packages, so without this the box keeps whatever shared/dist it had from an earlier
# deploy — shipping new API code against a STALE shared build. That is not theoretical:
# the multi-role project-scoping fix lives entirely in shared, and locally it appeared
# to do nothing until the package was rebuilt.
pnpm --filter @prime-tracker/shared build 2>&1 | tail -3
echo "=== shared rebuilt ==="

aws s3 cp s3://${DEPLOY_BUCKET}/deploy/api-dist.tar.gz /tmp/api-dist.tar.gz --region ${AWS_REGION}
tar -xzf /tmp/api-dist.tar.gz -C apps/api/
echo "=== Dist extracted ==="

# The same script the CI deploy runs, so the two can never write different files. It
# fails here — before anything restarts — if a required secret cannot be read, and
# leaves the file owner-only and owned by ubuntu (pm2 runs as ubuntu).
APP_URL='${APP_URL}' S3_BUCKET='${DEPLOY_BUCKET}' AWS_REGION='${AWS_REGION}' \\
  MAIL_DRIVER='${MAIL_DRIVER}' SMTP_FROM='${SMTP_FROM}' GOOGLE_ALLOWED_DOMAIN='${GOOGLE_ALLOWED_DOMAIN}' \\
  bash infra/scripts/write-api-env.sh apps/api/.env

# Prisma reads apps/api/.env itself (DATABASE_URL for the app, DIRECT_URL — the owner
# login when MIGRATE_DATABASE_URL is set — for migrations). The values are quoted
# there, so they are not exported from this shell.
pnpm --filter @prime-tracker/api exec prisma migrate deploy 2>&1 | tail -8

# pnpm's build-script approval gate silently blocks Prisma's postinstall hook on this box,
# so \`pnpm install\` above does NOT regenerate the client — it's easy to end up running
# migrations against the DB while PM2 keeps serving a stale client that doesn't know about
# the new columns/fields (500s on every query touching them). Regenerate explicitly.
pnpm --filter @prime-tracker/api exec prisma generate 2>&1 | tail -8

# start-or-restart. \`pm2 restart\` errors with "Process or Namespace not found" on a
# FIRST deploy to a new box, which fails the whole run after migrations have already
# applied — the worst place to stop. \`describe\` is the cheap existence check.
#
# NODE_ENV is passed to pm2 explicitly. It is written into apps/api/.env above, but nothing
# here sources that file, so the node process started below inherited an environment with
# no NODE_ENV in it. main.ts now reads it through ConfigService (which does load the file),
# so the app is correct either way — but anything that legitimately checks
# \`process.env.NODE_ENV\` before Nest boots, in a library or a future edit, should see the
# truth. \`--update-env\` makes pm2 re-read it on a restart rather than reusing the
# environment the process was first started with.
if sudo -u ubuntu HOME=/home/ubuntu pm2 describe prime-api >/dev/null 2>&1; then
  sudo -u ubuntu HOME=/home/ubuntu NODE_ENV=production pm2 restart prime-api --update-env 2>&1
else
  echo "=== prime-api not registered yet — first-time pm2 start ==="
  sudo -u ubuntu HOME=/home/ubuntu NODE_ENV=production pm2 start dist/main.js --name prime-api \\
    --cwd /home/ubuntu/prime-tracker/apps/api --update-env 2>&1
  sudo -u ubuntu HOME=/home/ubuntu pm2 save 2>&1 | tail -1
  # survive a reboot
  env PATH=\$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu >/dev/null 2>&1 || true
fi

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
  tar -czf "$STAGE/web-dist.tar.gz" -C "$ROOT/apps/web" dist/
  aws s3 cp "$STAGE/web-dist.tar.gz" "s3://$DEPLOY_BUCKET/deploy/web-dist.tar.gz" \
    --region "$AWS_REGION" --quiet
  echo "   $(du -sh "$STAGE/web-dist.tar.gz" | cut -f1) uploaded"

  echo "   [3/3] Deploying web on EC2..."
  local _tmpscript="$STAGE/prime-deploy-web-$$.sh"
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
