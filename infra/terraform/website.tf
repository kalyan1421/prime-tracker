# ---------- Public website (PrimeDevelopers-web) ----------
#
# The marketing site at theprimedeveloper.com, moving here from Firebase Hosting so
# the tracker and the website share one account, one certificate and one bill. Same
# shape as the tracker's own SPA in cloudfront.tf: a private bucket reached only
# through CloudFront OAC, with client-side routes falling back to index.html.
#
# Two switches, both required: enable_dns (the zone and wildcard cert exist) and
# enable_website (the apex is ready to leave Firebase). The bucket is created as soon
# as enable_website is on, so a build can be uploaded and checked on the CloudFront
# domain before DNS is switched.
#
# The website's API and database are not here: the API runs on the existing EC2 host
# behind nginx, and its database is `prime_website` on the existing RDS instance —
# see PrimeDevelopers-web/docs/tracker-sync-and-aws-plan.md, Phase 2.

variable "enable_website" {
  description = <<-EOT
    Create the public website's bucket, and — with enable_dns — its CloudFront
    distribution and the apex + www records. Turning this on with enable_dns moves
    theprimedeveloper.com off Firebase Hosting, so upload a build to the bucket and
    check it on the CloudFront domain first.
  EOT
  type        = bool
  default     = false
}

locals {
  website_bucket_name = "${var.project}-website-${local.account_id}"
  website_cdn         = var.enable_website && var.enable_dns
  # AWS-managed SecurityHeadersPolicy: HSTS, nosniff, frame-options, referrer-policy.
  cf_security_headers = "67f7725c-6f97-4210-82d7-5512b31e9d03"
}

resource "aws_s3_bucket" "website" {
  count  = var.enable_website ? 1 : 0
  bucket = local.website_bucket_name
}

resource "aws_s3_bucket_public_access_block" "website" {
  count                   = var.enable_website ? 1 : 0
  bucket                  = aws_s3_bucket.website[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "website" {
  count  = var.enable_website ? 1 : 0
  bucket = aws_s3_bucket.website[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_distribution" "website" {
  count               = local.website_cdn ? 1 : 0
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  aliases             = [var.domain_name, "www.${var.domain_name}"]
  comment             = "${local.name} public website"

  origin {
    domain_name              = aws_s3_bucket.website[0].bucket_regional_domain_name
    origin_id                = "website-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.s3[0].id
  }

  default_cache_behavior {
    target_origin_id           = "website-s3"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = local.cf_caching_optimized
    response_headers_policy_id = local.cf_security_headers
    compress                   = true
  }

  # Client-side routing (/properties/centro-plaza): S3 has no such key, so it answers
  # 403 through OAC. Serve the app shell and let the router take the path.
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # The wildcard cert in acm.tf names both the apex and *.domain, so it covers www.
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.main[0].certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

data "aws_iam_policy_document" "website_bucket" {
  count = local.website_cdn ? 1 : 0
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.website[0].arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.website[0].arn]
    }
  }
}

resource "aws_s3_bucket_policy" "website" {
  count  = local.website_cdn ? 1 : 0
  bucket = aws_s3_bucket.website[0].id
  policy = data.aws_iam_policy_document.website_bucket[0].json
}

# Apex and www, IPv4 and IPv6 — the distribution has IPv6 on, and an A record alone
# would leave IPv6-only clients resolving nothing.
resource "aws_route53_record" "website" {
  for_each = local.website_cdn ? {
    apex_a    = { name = var.domain_name, type = "A" }
    apex_aaaa = { name = var.domain_name, type = "AAAA" }
    www_a     = { name = "www.${var.domain_name}", type = "A" }
    www_aaaa  = { name = "www.${var.domain_name}", type = "AAAA" }
  } : {}
  zone_id = aws_route53_zone.main[0].zone_id
  name    = each.value.name
  type    = each.value.type
  alias {
    name                   = aws_cloudfront_distribution.website[0].domain_name
    zone_id                = aws_cloudfront_distribution.website[0].hosted_zone_id
    evaluate_target_health = false
  }
}

output "website_bucket" {
  description = "S3 bucket for the public website build (null until enable_website=true)."
  value       = one(aws_s3_bucket.website[*].bucket)
}

output "website_cloudfront_distribution_id" {
  description = "For the website's deploy workflow to invalidate after an upload."
  value       = one(aws_cloudfront_distribution.website[*].id)
}

output "website_cloudfront_domain" {
  description = "Check a build here before switching DNS."
  value       = one(aws_cloudfront_distribution.website[*].domain_name)
}
