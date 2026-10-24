#!/usr/bin/env bash
# Writes the tracker API's .env on the EC2 host. The ONE place it is built.
#
#   APP_URL=https://… S3_BUCKET=… bash infra/scripts/write-api-env.sh apps/api/.env
#
# Called by both deploy paths — the manual infra/scripts/deploy.sh and the CI SSM
# document in infra/terraform/github-deploy.tf. Until 24 Oct 2026 each built its own
# file, and they had drifted: the CI version had no GOOGLE_CALLBACK_URL (Google SSO
# off), no STORAGE_DRIVER/S3_BUCKET (uploads to local disk), no MAIL_DRIVER/SMTP_FROM
# (email off), no WEBSITE_SYNC_*, and only one of the two staff email domains.
#
# A required secret that cannot be read fails the deploy instead of being written as
# an empty value — which is what `2>/dev/null || echo ''` used to do, restarting the
# API on a config it could not run with.
#
# Inputs (environment):
#   APP_URL                origin the SPA is served from (required)
#   S3_BUCKET              bucket for uploads (required)
#   AWS_REGION             default us-east-1
#   PROJECT                SSM path prefix, default prime-tracker
#   MAIL_DRIVER            default ses
#   SMTP_FROM              SES-verified sender (required when MAIL_DRIVER=ses)
#   GOOGLE_ALLOWED_DOMAIN  default "theprimedeveloper.com,primedevelopers.com"
set -euo pipefail

OUT="${1:?usage: write-api-env.sh <path to .env>}"
: "${APP_URL:?APP_URL is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
AWS_REGION="${AWS_REGION:-us-east-1}"
PROJECT="${PROJECT:-prime-tracker}"
MAIL_DRIVER="${MAIL_DRIVER:-ses}"
GOOGLE_ALLOWED_DOMAIN="${GOOGLE_ALLOWED_DOMAIN:-theprimedeveloper.com,primedevelopers.com}"
if [ "$MAIL_DRIVER" = ses ]; then : "${SMTP_FROM:?SMTP_FROM is required with MAIL_DRIVER=ses}"; fi

REQUIRED=(DATABASE_URL ENCRYPTION_KEY JWT_ACCESS_SECRET JWT_REFRESH_SECRET)
OPTIONAL=(GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET QB_CLIENT_ID QB_CLIENT_SECRET REDIS_PASSWORD
  WEBSITE_SYNC_URL WEBSITE_SYNC_SECRET MIGRATE_DATABASE_URL)

# Prints the value, or nothing when the parameter does not exist. Any other failure
# (no permission, no network) is an error, never an empty value.
read_param() {
  local out
  if out=$(aws ssm get-parameter --name "/$PROJECT/$1" --with-decryption --region "$AWS_REGION" \
    --query Parameter.Value --output text 2>&1); then
    printf '%s' "$out"
  elif grep -q ParameterNotFound <<<"$out"; then
    return 0
  else
    echo "write-api-env: cannot read /$PROJECT/$1: $out" >&2
    return 1
  fi
}

# Single quotes: DATABASE_URL carries '&', which unquoted makes `set -a; . ./.env`
# background the assignment; a '$' in a secret must never expand. dotenv strips them.
# dotenv has no way to escape a quote inside a single-quoted value, so a secret that
# contains one is refused rather than written in a form that parses differently.
q() {
  case "$1" in *"'"*) echo "write-api-env: a value contains a single quote; regenerate that secret" >&2; return 1 ;; esac
  printf "'%s'" "$1"
}

TMP="$(mktemp "$(dirname "$OUT")/.env.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
chmod 600 "$TMP"
{
  for P in "${REQUIRED[@]}"; do
    V="$(read_param "$P")"
    if [ -z "$V" ] || [ "$V" = REPLACE_ME ]; then
      echo "write-api-env: required parameter /$PROJECT/$P is missing or a placeholder" >&2
      exit 1
    fi
    echo "$P=$(q "$V")"
  done
  for P in "${OPTIONAL[@]}"; do
    V="$(read_param "$P")"
    [ "$V" = REPLACE_ME ] && V=""
    [ -n "$V" ] && echo "$P=$(q "$V")"
  done

  # Migrations run as the database owner when MIGRATE_DATABASE_URL is set, so the app
  # itself can connect as a login without DDL rights (infra/scripts/create-app-db-user.sh).
  MIGRATE="$(read_param MIGRATE_DATABASE_URL)"
  [ "$MIGRATE" = REPLACE_ME ] && MIGRATE=""
  echo "DIRECT_URL=$(q "${MIGRATE:-$(read_param DATABASE_URL)}")"

  cat <<ENV
NODE_ENV=production
API_PORT=3001
FRONTEND_URL=$APP_URL
CORS_ORIGINS=$APP_URL
APP_BASE_URL=$APP_URL
GOOGLE_ALLOWED_DOMAIN=$GOOGLE_ALLOWED_DOMAIN
GOOGLE_CALLBACK_URL=$APP_URL/api/auth/google/callback
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
STORAGE_DRIVER=s3
S3_BUCKET=$S3_BUCKET
AWS_REGION=$AWS_REGION
MAIL_DRIVER=$MAIL_DRIVER
SMTP_FROM=$(q "${SMTP_FROM:-}")
ENV
} >"$TMP"

mv -f "$TMP" "$OUT"
trap - EXIT
chmod 600 "$OUT"
# The file is written by root over SSM; pm2 runs as ubuntu and must be able to read it.
if [ "$(id -u)" = 0 ]; then chown ubuntu:ubuntu "$OUT"; fi
echo "write-api-env: $OUT written ($(grep -c '=' "$OUT") settings)"
