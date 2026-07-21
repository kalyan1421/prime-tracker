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

  # Phase 1 (enable_dns=false) serves the app over the EC2 Elastic IP via nip.io
  # rather than a real domain — derive that origin from the EIP itself so it can
  # never drift from the box actually serving traffic. Needed for S3 CORS (browser
  # presigned-PUT uploads) since the app.${domain_name} origin below isn't live yet.
  nip_io_app_origin = "https://${replace(aws_eip.api.public_ip, ".", "-")}.nip.io"
}
