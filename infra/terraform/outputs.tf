output "route53_nameservers" {
  description = "Set these NS records at your registrar to delegate DNS to Route 53 (null until enable_dns=true)."
  value       = one(aws_route53_zone.main[*].name_servers)
}

output "ec2_public_ip" {
  description = "Elastic IP of the API host. Point api.<domain> here (already done in Route 53)."
  value       = aws_eip.api.public_ip
}

output "rds_endpoint" {
  description = "RDS hostname for DATABASE_URL."
  value       = aws_db_instance.main.address
}

output "app_bucket" {
  description = "S3 bucket for the SPA build (CI syncs apps/web/dist here)."
  value       = aws_s3_bucket.app.bucket
}

output "media_bucket" {
  value = aws_s3_bucket.media.bucket
}

output "documents_bucket" {
  value = aws_s3_bucket.documents.bucket
}

output "app_cloudfront_distribution_id" {
  description = "Set as CF_DIST_ID in GitHub Actions for cache invalidation (null until enable_dns=true)."
  value       = one(aws_cloudfront_distribution.app[*].id)
}

output "app_cloudfront_domain" {
  value = one(aws_cloudfront_distribution.app[*].domain_name)
}

output "media_cloudfront_domain" {
  value = one(aws_cloudfront_distribution.media[*].domain_name)
}

output "s3_public_base_url" {
  description = "Set as S3_PUBLIC_BASE_URL in the API env."
  value       = "https://media.${var.domain_name}"
}

output "database_url_for_ssm" {
  description = "Put into SSM /prime-tracker/DATABASE_URL (SecureString) — see README."
  sensitive   = true
  value       = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${var.db_name}?schema=public&connection_limit=5&pool_timeout=10"
}

output "alarm_topic_arn" {
  description = <<-EOT
    SNS topic every alarm publishes to. Check that it actually has a CONFIRMED
    subscriber — an unconfirmed one is indistinguishable from no monitoring:
      aws sns list-subscriptions-by-topic --topic-arn <this> \
        --query 'Subscriptions[].[Protocol,Endpoint,SubscriptionArn]' --output table
  EOT
  value       = aws_sns_topic.alarms.arn
}

output "monitoring_dashboard_url" {
  description = "One page showing the API health check, host, and database."
  value       = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards/dashboard/${aws_cloudwatch_dashboard.main.dashboard_name}"
}

output "api_health_check_id" {
  description = "Route 53 health check watching /api/health/ready (null when enable_endpoint_monitor = false)."
  value       = one(aws_route53_health_check.api[*].id)
}
