#!/usr/bin/env bash
# One-time fix for the LIVE box (2026-10-17): nginx compressed only text/html, so the app's
# 2.9 MB script and 0.3 MB stylesheet went to every phone uncompressed. Same file that
# user-data.sh.tftpl now writes on a fresh box.
#
# Safe to run more than once. Writes a separate conf.d file (certbot's rewrite of the site
# file never touches it), then reloads ONLY if `nginx -t` passes — on a bad config the file
# is removed again and the running server is left exactly as it was.
#
# Run it on the box through SSM, from a machine logged in to the client account:
#   aws sso login --profile prime-client
#   aws ssm send-command --profile prime-client --region us-east-1 \
#     --instance-ids i-0412241c8f6d080a1 --document-name AWS-RunShellScript \
#     --parameters commands="$(jq -Rs . < infra/scripts/nginx-compression.sh | jq -c '[.]')" \
#     --comment "nginx compression"
set -eu
CONF=/etc/nginx/conf.d/prime-compression.conf
cat >"$CONF" <<'NGINX'
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_min_length 1024;
gzip_types text/css application/javascript text/javascript application/json application/manifest+json image/svg+xml text/plain;
NGINX
if nginx -t; then
  systemctl reload nginx
  echo "compression enabled"
else
  rm -f "$CONF"
  echo "nginx -t failed; change removed, nothing reloaded" >&2
  exit 1
fi
