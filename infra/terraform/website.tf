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
  # AWS-managed CachingDisabled and AllViewerExceptHostHeader, for the API.
  cf_caching_disabled       = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  cf_all_viewer_except_host = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  # The website API runs on the tracker's EC2 host as a second process; nginx there
  # answers on the nip.io name it holds a certificate for, and maps /website-api/ to
  # that process. Same-origin from the browser's side: no CORS on AWS at all.
  website_api_origin = trimprefix(local.nip_io_app_origin, "https://")
}

# Resized images (/api/img/...) differ only by width and quality, and their paths are
# never reused, so they are cached on exactly those two parameters for up to a year.
resource "aws_cloudfront_cache_policy" "website_images" {
  count       = var.enable_website ? 1 : 0
  name        = "${local.name}-website-images"
  min_ttl     = 1
  default_ttl = 86400
  max_ttl     = 31536000
  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "whitelist"
      query_strings {
        items = ["width", "quality"]
      }
    }
  }
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

# The bucket holds uploads under media/ beside the deployed site, and the site deploy
# syncs with --delete. Versioning means a wrong delete or overwrite of a photograph can
# be undone; the lifecycle keeps that from growing for ever. Build output is replaced
# on every deploy, so its old versions are dropped quickly.
resource "aws_s3_bucket_versioning" "website" {
  count  = var.enable_website ? 1 : 0
  bucket = aws_s3_bucket.website[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "website" {
  count      = var.enable_website ? 1 : 0
  bucket     = aws_s3_bucket.website[0].id
  depends_on = [aws_s3_bucket_versioning.website]

  rule {
    id     = "media-old-versions"
    status = "Enabled"
    filter {
      prefix = "media/"
    }
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }

  rule {
    id     = "site-old-versions"
    status = "Enabled"
    filter {
      prefix = "assets/"
    }
    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }

  rule {
    id     = "expired-delete-markers"
    status = "Enabled"
    filter {}
    expiration {
      expired_object_delete_marker = true
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 2
    }
  }
}

# Sent by CloudFront on every request to the website API, and required by nginx
# (PrimeDevelopers-web scripts/aws/02-deploy-api.sh), so the API answers CloudFront
# and nothing else. Created by that repo's scripts/aws/01-database.sh; read here so
# the value lives in one place. It does land in state — keep the state in the S3
# backend (versions.tf), which is encrypted and private.
data "aws_ssm_parameter" "website_origin_secret" {
  count           = var.enable_website ? 1 : 0
  name            = "/${var.project}/website/ORIGIN_SECRET"
  with_decryption = true
}

# The SPA fallback firebase.json's "**" -> /index.html rewrite provided: a request for
# an app route (no file extension) gets the app shell; a file keeps its own path and,
# if missing, its real 403/404. Only the site's default behaviour runs this — /api/*
# never does, so API status codes reach the browser unchanged.
resource "aws_cloudfront_function" "website_spa" {
  count   = var.enable_website ? 1 : 0
  name    = "${local.name}-website-spa"
  runtime = "cloudfront-js-2.0"
  comment = "App routes to /index.html"
  publish = true
  code    = <<-JS
    function handler(event) {
      var request = event.request;
      var last = request.uri.split('/').pop();
      if (last.indexOf('.') === -1) {
        request.uri = '/index.html';
      }
      return request;
    }
  JS
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

  # /api/... -> https://<nip.io>/website-api/api/... -> nginx -> 127.0.0.1:3002.
  origin {
    domain_name = local.website_api_origin
    origin_id   = "website-api"
    origin_path = "/website-api"
    custom_header {
      name  = "X-Origin-Verify"
      value = data.aws_ssm_parameter.website_origin_secret[0].value
    }
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      # A resize of a 2 MB original on a t3.micro, or a cold API, can take seconds.
      origin_read_timeout = 60
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/api/img/*"
    target_origin_id           = "website-api"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = aws_cloudfront_cache_policy.website_images[0].id
    response_headers_policy_id = local.cf_security_headers
    compress                   = false # already WebP
  }

  # Everything else under /api: never cached here (admin responses are per-user, and
  # the public ones carry their own short Cache-Control for browsers), every method,
  # every header but Host — nginx needs its own name for SNI and server_name.
  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = "website-api"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = local.cf_caching_disabled
    origin_request_policy_id   = local.cf_all_viewer_except_host
    response_headers_policy_id = local.cf_security_headers
    compress                   = true
  }

  # Client-side routing (/properties/centro-plaza) is a viewer-request rewrite on the
  # site's own behaviour only — see aws_cloudfront_function.website_spa. It used to be
  # distribution-wide custom_error_response 403/404 → /index.html 200, which also
  # rewrote every API 403 and 404 into a 200 HTML page: a missing property, a refused
  # origin, a tracker push to an unknown project all "succeeded".
  default_cache_behavior {
    target_origin_id           = "website-s3"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = local.cf_caching_optimized
    response_headers_policy_id = local.cf_security_headers
    compress                   = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.website_spa[0].arn
    }
  }

  web_acl_id = aws_wafv2_web_acl.website[0].arn

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
