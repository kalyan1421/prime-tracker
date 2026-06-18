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
