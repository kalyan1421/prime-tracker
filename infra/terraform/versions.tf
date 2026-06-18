terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }

  # Remote state (recommended once more than one person touches this).
  # Create the bucket + lock table once, then uncomment and run
  # `terraform init -migrate-state`.
  #
  # backend "s3" {
  #   bucket         = "prime-tracker-tfstate-<ACCOUNT_ID>"
  #   key            = "prod/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "prime-tracker-tflock"
  #   encrypt        = true
  # }
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
