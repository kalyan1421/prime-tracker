variable "aws_region" {
  description = "Primary region for EC2/RDS/S3/SES. Keep EC2 + RDS co-located."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Name prefix applied to every resource."
  type        = string
  default     = "prime-tracker"
}

variable "domain_name" {
  description = "Root domain managed in Route 53 (e.g. theprimedeveloper.com)."
  type        = string
  default     = "theprimedeveloper.com"
}

variable "ssh_public_key" {
  description = "Public key for EC2 SSH access (contents of ~/.ssh/id_ed25519.pub)."
  type        = string
}

variable "admin_cidr" {
  description = "CIDR allowed to SSH to EC2, your IP as x.x.x.x/32. Avoid 0.0.0.0/0."
  type        = string
}

variable "db_name" {
  description = "Initial database name."
  type        = string
  default     = "prime_tracker"
}

variable "db_username" {
  description = "RDS master username."
  type        = string
  default     = "prime"
}

variable "db_password" {
  description = "RDS master password (>= 16 chars). State holds this — keep state secure."
  type        = string
  sensitive   = true
}

variable "db_instance_class" {
  description = "RDS instance class (free tier: db.t3.micro)."
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "RDS storage in GB (free tier: 20)."
  type        = number
  default     = 20
}

variable "ec2_instance_type" {
  description = "API host instance type (free tier: t3.micro)."
  type        = string
  default     = "t3.micro"
}

variable "alarm_email" {
  description = "Email for the CloudWatch billing alarm. Confirm the SNS subscription after apply."
  type        = string
}

variable "billing_threshold_usd" {
  description = "Monthly estimated-charges threshold that triggers the billing alarm."
  type        = number
  default     = 30
}

variable "rds_deletion_protection" {
  description = "Block accidental RDS deletion. Set false only when intentionally tearing down."
  type        = bool
  default     = true
}

variable "enable_dns" {
  description = <<-EOT
    Phase toggle. false (Phase 1): provision only the core — VPC, RDS, EC2, S3
    buckets, SSM, monitoring; the API runs on the EC2 Elastic IP. true (Phase 2+):
    additionally create the Route 53 zone, ACM wildcard cert, CloudFront
    distributions, and SES. Only set true AFTER the domain's nameservers are
    delegated to this account's Route 53 zone, or ACM validation will hang.
  EOT
  type        = bool
  default     = false
}

# ── Keyless GitHub Actions deploys over SSM (github-deploy.tf) ────────────────

variable "enable_github_deploy" {
  description = <<-EOT
    Create the GitHub OIDC provider, the deploy role and the SSM deploy document.
    Off by default: it grants a CI system the right to run a script as root on the
    instance, which should be a deliberate act rather than something that appears
    because someone ran apply.
  EOT
  type        = bool
  default     = false
}

variable "github_repository" {
  description = "owner/repo allowed to assume the deploy role. Only its main branch can."
  type        = string
  default     = "kalyan1421/prime-tracker"
}

variable "enable_ssh" {
  description = <<-EOT
    Keep port 22 open to var.admin_cidr.

    Default is now FALSE: closed in the live account on 2026-09-01, once SSM deploys
    were working end to end. Shell access is Session Manager, which needs no inbound
    port; verified after closing that a root shell still works and the app still serves.

    admin_cidr was a liability rather than a safeguard — one fixed home IP, unreachable
    the moment the ISP reassigns it, and the fix under pressure is always to widen it.

    Re-open only as a deliberate, temporary act:
      terraform apply -var-file=client.tfvars -var=enable_ssh=true
  EOT
  type        = bool
  default     = false
}

variable "app_origin" {
  description = <<-EOT
    Public origin the SPA is served from — written into the API's FRONTEND_URL,
    CORS_ORIGINS and APP_BASE_URL at deploy time. Today the nip.io host derived from
    the Elastic IP; a real domain once DNS is enabled.
  EOT
  type        = string
  default     = "https://app.theprimedeveloper.com"
}

# ── Monitoring (monitoring.tf) ───────────────────────────────────────────────

variable "alarm_sms_number" {
  description = <<-EOT
    Optional E.164 phone number (e.g. "+919876543210") subscribed to the alarm topic
    by SMS, so an outage reaches someone who is not at a laptop. Empty = email only.

    New AWS accounts are in the SNS SMS sandbox: until the number is verified under
    SNS > Text messaging > Sandbox destination phone numbers (or production SMS
    access is granted), the subscription exists and delivers nothing.
  EOT
  type        = string
  default     = ""
}

variable "enable_endpoint_monitor" {
  description = <<-EOT
    Create the Route 53 health check that calls /api/health/ready over HTTPS from
    outside AWS's own network, and the alarm on it. This is the only check that sees
    what a user sees — DNS, Elastic IP, nginx, TLS, Node and Postgres in one request.

    On by default. It is the one piece of monitoring here that is not free: roughly
    $2.50/month (an AWS-endpoint check at $0.50, plus $1 each for HTTPS and string
    matching). Turning it off leaves the host and database alarms, which can explain
    an outage but cannot detect one.
  EOT
  type        = bool
  default     = true
}

variable "enable_host_metrics" {
  description = <<-EOT
    Install and configure the CloudWatch agent on the API host via SSM Association,
    and alarm on root-volume usage and memory. EC2 publishes neither natively — the
    hypervisor cannot see inside the guest — and on a 20 GB / 914 MiB box both are
    likely causes of an outage.

    On by default. Costs roughly $1/month in custom metrics, and the associations
    install software on the running production instance (a standard AWS package,
    applied over SSM, restarting nothing the API depends on).
  EOT
  type        = bool
  default     = true
}
