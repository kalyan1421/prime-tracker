locals {
  name = var.project

  tags = {
    Project     = var.project
    Environment = "production"
    ManagedBy   = "terraform"
  }

  # Two AZs — RDS requires a subnet group spanning >= 2 AZs even for Single-AZ.
  azs        = slice(data.aws_availability_zones.available.names, 0, 2)
  account_id = data.aws_caller_identity.current.account_id

  # S3 bucket names are globally unique → suffix with the account id.
  app_bucket_name   = "${var.project}-app-${local.account_id}"
  media_bucket_name = "${var.project}-media-${local.account_id}"
  docs_bucket_name  = "${var.project}-documents-${local.account_id}"
}
