resource "aws_iam_role" "ec2" {
  name = "${local.name}-ec2-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# SSM Session Manager — keyless shell access to the box (no SSH needed).
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "ec2_app" {
  name = "${local.name}-ec2-app"
  role = aws_iam_role.ec2.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Sid      = "ReadSecrets"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
        Resource = "arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter/${var.project}/*"
      },
      {
        Sid       = "DecryptSecrets"
        Effect    = "Allow"
        Action    = ["kms:Decrypt"]
        Resource  = "*"
        Condition = { StringEquals = { "kms:ViaService" = "ssm.${var.aws_region}.amazonaws.com" } }
      },
      {
        Sid    = "MediaAndDocsBuckets"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
        Resource = [
          aws_s3_bucket.media.arn, "${aws_s3_bucket.media.arn}/*",
          aws_s3_bucket.documents.arn, "${aws_s3_bucket.documents.arn}/*",
        ]
      },
      {
        Sid      = "SendEmail"
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = "*"
      }
      ],
      # The public website's API runs on this host too (website.tf). It writes uploads
      # to, and reads originals for resizing from, the website bucket's media/ prefix —
      # and nothing else in that bucket, which holds the deployed site. ListBucket is
      # what turns a missing key into a 404 rather than an AccessDenied.
      [for arn in aws_s3_bucket.website[*].arn : {
        Sid      = "WebsiteMedia"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${arn}/media/*"
      }],
      [for arn in aws_s3_bucket.website[*].arn : {
        Sid       = "WebsiteMediaList"
        Effect    = "Allow"
        Action    = ["s3:ListBucket"]
        Resource  = arn
        Condition = { StringLike = { "s3:prefix" = ["media/*"] } }
      }],
    )
  })
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${local.name}-ec2-profile"
  role = aws_iam_role.ec2.name
}
