# Everything here is gated on enable_dns (Phase 2+). In Phase 1 the S3 buckets
# exist but are not fronted by CloudFront and have no public bucket policy.
resource "aws_cloudfront_origin_access_control" "s3" {
  count                             = var.enable_dns ? 1 : 0
  name                              = "${local.name}-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# AWS-managed CachingOptimized policy.
locals {
  cf_caching_optimized = "658327ea-f89d-4fab-a63d-7e88639e58f6"
}

# ---------- Internal React SPA ----------
resource "aws_cloudfront_distribution" "app" {
  count               = var.enable_dns ? 1 : 0
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  aliases             = ["app.${var.domain_name}"]
  comment             = "${local.name} internal SPA"

  origin {
    domain_name              = aws_s3_bucket.app.bucket_regional_domain_name
    origin_id                = "app-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.s3[0].id
  }

  default_cache_behavior {
    target_origin_id       = "app-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = local.cf_caching_optimized
    compress               = true
  }

  # SPA client-side routing: missing keys return index.html, not S3's 403/404.
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

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.main[0].certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# ---------- Public media (project photos, galleries) ----------
resource "aws_cloudfront_distribution" "media" {
  count           = var.enable_dns ? 1 : 0
  enabled         = true
  is_ipv6_enabled = true
  price_class     = "PriceClass_100"
  aliases         = ["media.${var.domain_name}"]
  comment         = "${local.name} public media"

  origin {
    domain_name              = aws_s3_bucket.media.bucket_regional_domain_name
    origin_id                = "media-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.s3[0].id
  }

  default_cache_behavior {
    target_origin_id       = "media-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = local.cf_caching_optimized
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.main[0].certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# ---------- Bucket policies: allow only these distributions via OAC ----------
data "aws_iam_policy_document" "app_bucket" {
  count = var.enable_dns ? 1 : 0
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.app.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.app[0].arn]
    }
  }
}
resource "aws_s3_bucket_policy" "app" {
  count  = var.enable_dns ? 1 : 0
  bucket = aws_s3_bucket.app.id
  policy = data.aws_iam_policy_document.app_bucket[0].json
}

data "aws_iam_policy_document" "media_bucket" {
  count = var.enable_dns ? 1 : 0
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.media.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.media[0].arn]
    }
  }
}
resource "aws_s3_bucket_policy" "media" {
  count  = var.enable_dns ? 1 : 0
  bucket = aws_s3_bucket.media.id
  policy = data.aws_iam_policy_document.media_bucket[0].json
}
