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

# Versioning is the only thing standing between a bad delete and permanent loss, and
# `media` holds user uploads exactly like `documents` does. It was versioned and media
# was not, which is a distinction nothing justifies.
resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Housekeeping for the staging prefixes only — never the tracker's documents, whose
# version history is the DocumentVersion feature.
#
# migration/ holds the website's data exports (PrimeDevelopers-web scripts/aws), which
# carried admin password hashes and enquiries. The scripts delete them on the way
# out, but on a versioned bucket a plain delete only hides an object: the 24 Oct 2026
# audit found the "deleted" exports still there as old versions. Anything under
# migration/ now goes within a day whatever happens to the script.
resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket     = aws_s3_bucket.documents.id
  depends_on = [aws_s3_bucket_versioning.documents]

  rule {
    id     = "migration-exports"
    status = "Enabled"
    filter {
      prefix = "migration/"
    }
    expiration {
      days = 1
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }

  rule {
    id     = "deploy-artifacts-old-versions"
    status = "Enabled"
    filter {
      prefix = "deploy/"
    }
    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }

  rule {
    id     = "deploys-artifacts-old-versions"
    status = "Enabled"
    filter {
      prefix = "deploys/"
    }
    noncurrent_version_expiration {
      noncurrent_days = 7
    }
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
    allowed_origins = each.key == "documents" ? [
      "https://app.${var.domain_name}", local.nip_io_app_origin,
      "http://localhost:5173", "http://localhost:3001",
      ] : [
      "https://app.${var.domain_name}", local.nip_io_app_origin,
    ]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}
