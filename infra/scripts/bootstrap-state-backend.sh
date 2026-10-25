#!/usr/bin/env bash
# One-time: create the S3 bucket and DynamoDB table that hold Terraform's state for
# the production account, then move the local state into them.
#
#   AWS_PROFILE=prime-client infra/scripts/bootstrap-state-backend.sh
#
# Safe to re-run: every step checks first. The bucket is private, versioned (a bad
# apply's state can be rolled back) and encrypted, and refuses non-TLS access; the
# table is on-demand with point-in-time recovery. Neither is managed by the Terraform
# whose state they hold — a configuration cannot safely manage its own backend.
set -euo pipefail

ACCOUNT="056836825737"
REGION="us-east-1"
BUCKET="prime-tracker-tfstate-${ACCOUNT}"
TABLE="prime-tracker-tflock"
DIR="$(cd "$(dirname "$0")/../terraform" && pwd)"

actual="$(aws sts get-caller-identity --query Account --output text)"
[ "$actual" = "$ACCOUNT" ] || { echo "Credentials are for $actual, not $ACCOUNT. Use AWS_PROFILE=prime-client." >&2; exit 1; }

if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
  echo "created bucket $BUCKET"
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "$(cat <<JSON
{"Version":"2012-10-17","Statement":[{"Sid":"TLSOnly","Effect":"Deny","Principal":"*","Action":"s3:*",
"Resource":["arn:aws:s3:::${BUCKET}","arn:aws:s3:::${BUCKET}/*"],
"Condition":{"Bool":{"aws:SecureTransport":"false"}}}]}
JSON
)"
echo "bucket $BUCKET: private, versioned, encrypted, TLS only"

if ! aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1; then
  aws dynamodb create-table --table-name "$TABLE" --region "$REGION" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH --billing-mode PAY_PER_REQUEST >/dev/null
  aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"
  echo "created table $TABLE"
fi
aws dynamodb update-continuous-backups --table-name "$TABLE" --region "$REGION" \
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true >/dev/null
echo "table $TABLE: on-demand, point-in-time recovery"

cd "$DIR"
terraform init -backend-config=backend-client.hcl -migrate-state
echo
echo "State is in s3://$BUCKET. Once 'terraform plan -var-file=client.tfvars' shows no"
echo "unexpected changes, delete the local copies:"
echo "  rm -i $DIR/terraform.tfstate* $DIR/terraform.tfstate.d/client/terraform.tfstate*"
