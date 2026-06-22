# Gated on enable_dns. In Phase 1, add a single api.<domain> A-record pointing
# at the EC2 Elastic IP at your *current* DNS host instead.
resource "aws_route53_zone" "main" {
  count = var.enable_dns ? 1 : 0
  name  = var.domain_name
}

# app.<domain> -> CloudFront SPA
resource "aws_route53_record" "app" {
  count   = var.enable_dns ? 1 : 0
  zone_id = aws_route53_zone.main[0].zone_id
  name    = "app.${var.domain_name}"
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.app[0].domain_name
    zone_id                = aws_cloudfront_distribution.app[0].hosted_zone_id
    evaluate_target_health = false
  }
}

# media.<domain> -> CloudFront media
resource "aws_route53_record" "media" {
  count   = var.enable_dns ? 1 : 0
  zone_id = aws_route53_zone.main[0].zone_id
  name    = "media.${var.domain_name}"
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.media[0].domain_name
    zone_id                = aws_cloudfront_distribution.media[0].hosted_zone_id
    evaluate_target_health = false
  }
}

# api.<domain> -> EC2 Elastic IP
resource "aws_route53_record" "api" {
  count   = var.enable_dns ? 1 : 0
  zone_id = aws_route53_zone.main[0].zone_id
  name    = "api.${var.domain_name}"
  type    = "A"
  ttl     = 300
  records = [aws_eip.api.public_ip]
}

# NOTE: apex (theprimedeveloper.com) -> Amplify is added in Phase 2 when the
# public Next.js site exists. Left out intentionally for now.
