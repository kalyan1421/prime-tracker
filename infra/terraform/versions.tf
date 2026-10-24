terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }

  # Remote state: an encrypted, versioned, private S3 bucket with a DynamoDB lock.
  #
  # The state holds every production secret (the RDS password and every SSM value
  # Terraform has refreshed), and until 24 Oct 2026 it lived only in files on one
  # laptop — lose the laptop, lose the ability to manage production; let someone read
  # it, and they have every key. The settings are in backend-client.hcl; create the
  # bucket and table once with infra/scripts/bootstrap-state-backend.sh, then:
  #
  #   terraform init -backend-config=backend-client.hcl -migrate-state
  #
  # which copies the local state (both workspaces) up and points this directory at it.
  backend "s3" {}
}

# Every plan stops unless the credentials are for the account this workspace manages.
# On the operator's machine the default AWS credentials belong to an old test
# account; a plan against the `client` state with those would see none of the real
# resources and propose creating all of them again.
resource "terraform_data" "account_guard" {
  input = local.account_id
  lifecycle {
    precondition {
      condition     = local.account_id == var.expected_account_id
      error_message = "These credentials are for AWS account ${local.account_id}, not ${var.expected_account_id}. Use: AWS_PROFILE=prime-client"
    }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = local.tags
  }
}

# CloudFront, the ACM cert it uses, and CloudWatch billing metrics MUST live in
# us-east-1 regardless of var.aws_region. This alias pins those resources there.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = local.tags
  }
}
