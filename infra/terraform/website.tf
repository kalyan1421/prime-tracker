# ---------- Public website (PrimeDevelopers-web) ----------
#
# The marketing site, moving here from Firebase Hosting so the tracker and the website
# share one account and one bill. Same shape as the tracker's own SPA in cloudfront.tf:
# a private bucket reached only through CloudFront OAC, with client-side routes falling
# back to index.html.
#
# Two stages, two switches:
#   enable_website = true   bucket + CloudFront on its own *.cloudfront.net address.
#                           Nothing about theprimedeveloper.com changes — that is the
#                           preview the client reviews while the 2023 site stays live.
#   + enable_dns   = true   adds the apex and www aliases on the wildcard cert and the
#                           Route 53 records, which takes the old site down. The
#                           domain's zone is NOT in this account today (checked 23 Oct
#                           2026); enable_dns creates a new one, and nothing changes for
#                           visitors until the registrar's nameservers point at it.
#
# Cache-Control is set per object at upload (see the website repo's
# docs/tracker-sync-and-aws-plan.md), mirroring firebase.json: HTML revalidates every
# navigation with a 10-minute edge copy; hashed assets, draco and fonts are immutable.
#
# The website's API and database are not here: the API moves to the existing EC2 host
# behind nginx, and its database becomes `prime_website` on the existing RDS instance.

variable "enable_website" {
  description = <<-EOT
    Create the public website's bucket and CloudFront distribution on its own
    *.cloudfront.net address. Does not touch theprimedeveloper.com unless enable_dns
    is also true — see the header of website.tf.
  EOT
  type        = bool
  default     = false
}

locals {
  website_bucket_name = "${var.project}-website-${local.account_id}"
  # Only with the zone and the wildcard cert can the distribution answer on the domain.
  website_on_domain = var.enable_website && var.enable_dns
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

# Its own OAC rather than cloudfront.tf's: that one exists only with enable_dns, and
# the preview has to work before the domain does.
resource "aws_cloudfront_origin_access_control" "website" {
  count                             = var.enable_website ? 1 : 0
  name                              = "${local.name}-website-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "website" {
  count               = var.enable_website ? 1 : 0
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  aliases             = local.website_on_domain ? [var.domain_name, "www.${var.domain_name}"] : []
  comment             = "${local.name} public website"

  origin {
    domain_name              = aws_s3_bucket.website[0].bucket_regional_domain_name
    origin_id                = "website-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.website[0].id
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
  # 403 through OAC. Serve the app shell and let the router take the path — the same
  # thing firebase.json's "**" -> /index.html rewrite did.
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

  # On the domain: the wildcard cert in acm.tf, which names the apex and *.domain and
  # so covers www. Before that: CloudFront's own certificate for *.cloudfront.net,
  # which AWS only offers with the TLSv1 floor.
  viewer_certificate {
    cloudfront_default_certificate = !local.website_on_domain
    acm_certificate_arn            = local.website_on_domain ? one(aws_acm_certificate_validation.main[*].certificate_arn) : null
    ssl_support_method             = local.website_on_domain ? "sni-only" : null
    minimum_protocol_version       = local.website_on_domain ? "TLSv1.2_2021" : "TLSv1"
  }
}

data "aws_iam_policy_document" "website_bucket" {
  count = var.enable_website ? 1 : 0
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
  count  = var.enable_website ? 1 : 0
  bucket = aws_s3_bucket.website[0].id
  policy = data.aws_iam_policy_document.website_bucket[0].json
}

# Apex and www, IPv4 and IPv6 — the distribution has IPv6 on, and an A record alone
# would leave IPv6-only clients resolving nothing.
resource "aws_route53_record" "website" {
  for_each = local.website_on_domain ? {
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
  description = "For the website's deploy to invalidate after an upload."
  value       = one(aws_cloudfront_distribution.website[*].id)
}

output "website_cloudfront_domain" {
  description = "The preview address. Add https://<this> to the website API's CORS_ORIGINS."
  value       = one(aws_cloudfront_distribution.website[*].domain_name)
}
