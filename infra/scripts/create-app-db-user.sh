#!/usr/bin/env bash
# One-time: give the tracker API its own database login, so it stops running as the
# RDS master user.
#
#   AWS_PROFILE=prime-client infra/scripts/create-app-db-user.sh
#   AWS_PROFILE=prime-client infra/scripts/deploy.sh api     # picks up the new .env
#
# Before: DATABASE_URL was the master login, which owns both databases on the
# instance (the tracker's and the website's) and can drop anything. A bug in the API
# could do whatever the master can. After:
#   DATABASE_URL          prime_tracker_app — read and write data, no schema changes,
#                         no access to the website's database
#   MIGRATE_DATABASE_URL  the master login, used only by `prisma migrate deploy`
#                         (write-api-env.sh writes it as DIRECT_URL)
#
# Order: this, then a tracker deploy. The two new parameters (APP_DB_PASSWORD,
# MIGRATE_DATABASE_URL) are created here, not by Terraform. To undo before the deploy:
# put the master URL back into DATABASE_URL. Safe to re-run — every step checks first,
# and once DATABASE_URL is switched a re-run re-applies the grants and re-checks the
# login without changing any parameter.
set -euo pipefail

ACCOUNT="056836825737"
REGION="us-east-1"
INSTANCE="i-0412241c8f6d080a1"
PREFIX="/prime-tracker"

actual="$(aws sts get-caller-identity --query Account --output text)"
[ "$actual" = "$ACCOUNT" ] || { echo "Credentials are for $actual, not $ACCOUNT. Use AWS_PROFILE=prime-client." >&2; exit 1; }

get() { aws ssm get-parameter --name "$PREFIX/$1" --with-decryption --region "$REGION" --query Parameter.Value --output text 2>/dev/null || true; }
put() { aws ssm put-parameter --name "$PREFIX/$1" --type SecureString --overwrite --region "$REGION" --value "$2" >/dev/null; }

CURRENT="$(get DATABASE_URL)"
MIGRATE="$(get MIGRATE_DATABASE_URL)"
SWITCHED=no
if [[ "$CURRENT" == *prime_tracker_app* ]]; then
  SWITCHED=yes
  echo "DATABASE_URL already uses prime_tracker_app — re-checking the login only."
fi
[ -n "$CURRENT" ] && [ "$CURRENT" != REPLACE_ME ] || { echo "DATABASE_URL is not set in SSM." >&2; exit 1; }

# The password goes through SSM, never through a command line or the SSM command
# history: the box reads it from there.
PASSWORD="$(get APP_DB_PASSWORD)"
if [ -z "$PASSWORD" ] || [ "$PASSWORD" = REPLACE_ME ]; then
  # A new password now would lock out the API, which already logs in with the old one.
  [ "$SWITCHED" = no ] || { echo "APP_DB_PASSWORD is missing, but DATABASE_URL already uses prime_tracker_app." >&2; exit 1; }
  PASSWORD="$(openssl rand -hex 24)"
  put APP_DB_PASSWORD "$PASSWORD"
fi

# The remote script is staged in a file, not built inside "$(…)": macOS's bash 3.2
# mis-parses quotes in a heredoc that sits inside a command substitution.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cat > "$STAGE/remote.sh" <<'REMOTE'
#!/bin/bash
set -euo pipefail
MASTER=$(aws ssm get-parameter --name /prime-tracker/DATABASE_URL --with-decryption --region us-east-1 --query Parameter.Value --output text)
# On a re-run DATABASE_URL is already the app login; the master is MIGRATE_DATABASE_URL.
case "$MASTER" in *prime_tracker_app*)
  MASTER=$(aws ssm get-parameter --name /prime-tracker/MIGRATE_DATABASE_URL --with-decryption --region us-east-1 --query Parameter.Value --output text) ;;
esac
MASTER="${MASTER%%\?*}?sslmode=require"
APP_PW=$(aws ssm get-parameter --name /prime-tracker/APP_DB_PASSWORD --with-decryption --region us-east-1 --query Parameter.Value --output text)
OWNER=$(echo "$MASTER" | sed -E 's#^[a-z]+://([^:]+):.*#\1#')
DB=$(echo "$MASTER" | sed -E 's#^[a-z]+://[^/]+/([^?]+).*#\1#')
printf '%s\n' \
  "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'prime_tracker_app') then create role prime_tracker_app login; end if; end \$\$;" \
  "alter role prime_tracker_app login password :'pw';" \
  "grant connect on database $DB to prime_tracker_app;" \
  "revoke connect on database prime_website from prime_tracker_app;" \
  "grant usage on schema public to prime_tracker_app;" \
  "grant select, insert, update, delete on all tables in schema public to prime_tracker_app;" \
  "grant usage, select, update on all sequences in schema public to prime_tracker_app;" \
  "alter default privileges for role $OWNER in schema public grant select, insert, update, delete on tables to prime_tracker_app;" \
  "alter default privileges for role $OWNER in schema public grant usage, select, update on sequences to prime_tracker_app;" |
  psql "$MASTER" -X -q -v ON_ERROR_STOP=1 -v pw="$APP_PW"
HOST=$(echo "$MASTER" | sed -E 's#^[a-z]+://[^@]+@([^:/?]+).*#\1#')
APP="postgresql://prime_tracker_app:${APP_PW}@${HOST}:5432/${DB}?sslmode=require"
# Every table under row-level security must look the same to the login as to the
# owner. One it reads fewer rows of has no policy for it, and the API would show empty
# lists rather than fail — which is what the first run of this script found.
TABLES=$(psql "$MASTER" -XAtc "select relname from pg_class where relrowsecurity and relnamespace = 'public'::regnamespace union select 'projects' order by 1")
SHORT=0
for t in $TABLES; do
  want=$(psql "$MASTER" -XAtc "select count(*) from public.\"$t\"")
  got=$(psql "$APP" -XAtc "select count(*) from public.\"$t\"")
  echo "prime_tracker_app reads $got of $want rows in $t"
  [ "$got" = "$want" ] || SHORT=1
done
[ "$SHORT" = 0 ] || { echo "Row-level security hides rows from prime_tracker_app: each table above needs a policy for it." >&2; exit 1; }
REMOTE
# AWS-RunShellScript runs its lines with /bin/sh — dash on Ubuntu, which rejects
# `set -o pipefail` — so the script is written to a file there and run with bash.
python3 -c '
import json, sys
body = open(sys.argv[1]).read().splitlines()
cmds = ["cat > /tmp/create-app-db-user.sh <<'"'"'EOS'"'"'"] + body + ["EOS",
        "bash /tmp/create-app-db-user.sh; rc=$?; rm -f /tmp/create-app-db-user.sh; exit $rc"]
print(json.dumps({"commands": cmds}))' "$STAGE/remote.sh" > "$STAGE/params.json"
CMD=$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
  --comment "tracker: create prime_tracker_app login" --parameters "file://$STAGE/params.json" \
  --query Command.CommandId --output text)
aws ssm wait command-executed --region "$REGION" --command-id "$CMD" --instance-id "$INSTANCE" 2>/dev/null || true
aws ssm get-command-invocation --region "$REGION" --command-id "$CMD" --instance-id "$INSTANCE" \
  --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
status=$(aws ssm get-command-invocation --region "$REGION" --command-id "$CMD" --instance-id "$INSTANCE" --query Status --output text)
[ "$status" = Success ] || { echo "Creating or checking the login failed — SSM parameters left unchanged." >&2; exit 1; }
if [ "$SWITCHED" = yes ]; then
  echo "Grants re-applied and the login re-checked; no parameters changed."
  exit 0
fi

# Only now, with the login proven, swap the parameters. The app URL is the master URL
# with the user and password replaced, keeping host, database and query string.
APP_URL="$(python3 -c '
import sys, urllib.parse as u
url, pw = sys.argv[1], sys.argv[2]
p = u.urlsplit(url)
host = p.netloc.split("@", 1)[1]
print(u.urlunsplit((p.scheme, f"prime_tracker_app:{pw}@{host}", p.path, p.query, p.fragment)))' "$CURRENT" "$PASSWORD")"
[ -z "$MIGRATE" ] || [ "$MIGRATE" = REPLACE_ME ] && put MIGRATE_DATABASE_URL "$CURRENT"
put DATABASE_URL "$APP_URL"
echo "DATABASE_URL now uses prime_tracker_app; MIGRATE_DATABASE_URL keeps the master login."
echo "Deploy the tracker API to switch it over: AWS_PROFILE=prime-client infra/scripts/deploy.sh api"
