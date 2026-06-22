# ---------- Buckets ----------
# app       : React SPA, private, served via CloudFront (OAC)
# media      : public project photos/galleries, served via CloudFront (OAC)
# documents : private files, app issues presigned URLs (15 min), versioned
resource "aws_s3_bucket" "app" {
  bucket = local.app_bucket_name
}
resource "aws_s3_bucket" "media" {
  bucket = local.media_bucket_name
}
resource "aws_s3_bucket" "documents" {
  bucket = local.docs_bucket_name
}

# All three buckets stay private at the bucket level. App + media are reached
# only through CloudFront OAC (see cloudfront.tf); documents only via presigned URLs.
resource "aws_s3_bucket_public_access_block" "all" {
  for_each = {
    app       = aws_s3_bucket.app.id
    media     = aws_s3_bucket.media.id
    documents = aws_s3_bucket.documents.id
  }
  bucket                  = each.value
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "all" {
  for_each = {
    app       = aws_s3_bucket.app.id
    media     = aws_s3_bucket.media.id
    documents = aws_s3_bucket.documents.id
  }
  bucket = each.value
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Browser uploads (presigned PUT) and reads need CORS on media + documents.
resource "aws_s3_bucket_cors_configuration" "uploads" {
  for_each = {
    media     = aws_s3_bucket.media.id
    documents = aws_s3_bucket.documents.id
  }
  bucket = each.value
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = ["https://app.${var.domain_name}"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}
