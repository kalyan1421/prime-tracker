#!/usr/bin/env bash
# Set the real secret values in SSM Parameter Store after `terraform apply`.
# Terraform created these parameters with a "REPLACE_ME" placeholder; this
# script overwrites them with real values so they never touch Terraform state.
#
# Usage:
#   1. Fill the values below (or export them as env vars first).
#   2. ./put-ssm-params.sh
#
# DATABASE_URL: copy from `terraform output -raw database_url_for_ssm`.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PREFIX="/prime-tracker"

put() { # name value [type]
  local name="$1" value="$2" type="${3:-SecureString}"
  aws ssm put-parameter --region "$REGION" \
    --name "${PREFIX}/${name}" --type "$type" --value "$value" --overwrite >/dev/null
  echo "set ${PREFIX}/${name}"
}

# --- Required secrets ---
put DATABASE_URL          "${DATABASE_URL:?run: terraform output -raw database_url_for_ssm}"
put JWT_ACCESS_SECRET     "${JWT_ACCESS_SECRET:-$(openssl rand -hex 32)}"
put JWT_REFRESH_SECRET    "${JWT_REFRESH_SECRET:-$(openssl rand -hex 32)}"
put ENCRYPTION_KEY        "${ENCRYPTION_KEY:?64 hex chars — reuse the CURRENT prod key, do NOT regenerate}"
put GOOGLE_CLIENT_SECRET  "${GOOGLE_CLIENT_SECRET:?from Google Cloud console}"
put REDIS_PASSWORD        "${REDIS_PASSWORD:-$(openssl rand -hex 24)}"

# --- Plain (non-secret) config ---
put GOOGLE_CLIENT_ID      "${GOOGLE_CLIENT_ID:?from Google Cloud console}" String

# --- Optional (QuickBooks, leave until verified) ---
[ -n "${QB_CLIENT_ID:-}" ]     && put QB_CLIENT_ID     "$QB_CLIENT_ID" String
[ -n "${QB_CLIENT_SECRET:-}" ] && put QB_CLIENT_SECRET "$QB_CLIENT_SECRET"

echo "Done. Verify:  aws ssm get-parameters-by-path --path ${PREFIX} --region ${REGION} --query 'Parameters[].Name'"
