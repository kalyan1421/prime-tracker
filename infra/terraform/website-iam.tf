# ---------- The website API's own AWS identity ----------
#
# The website API runs on this EC2 host beside the tracker. The instance role it would
# otherwise inherit can read every /prime-tracker/* secret, including the RDS master
# connection string (iam.tf) — so a flaw in the website could reach the tracker's data.
# The 24 Oct 2026 audit flagged exactly that.
#
# This role can do what the website needs and nothing else: read and write the website
# bucket's media/ prefix. On the box, root assumes it every 20 minutes and hands the
# short-lived credentials to the `prime-website` user, which is cut off from the
# metadata service (PrimeDevelopers-web scripts/aws/02-deploy-api.sh). The deploy
# script finds the role through the SSM parameter below.
#
# Proper separation — a task role per service — comes with the move to ECS
# (docs/aws-production-plan.md, Phase 2). This is the strongest version available on
# a shared host until then.

resource "aws_iam_role" "website_app" {
  count = var.enable_website ? 1 : 0
  name  = "${local.name}-website-app"
  # Only the EC2 instance role may assume it — not the GitHub deploy role, not users.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = aws_iam_role.ec2.arn }
      Action    = "sts:AssumeRole"
    }]
  })
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "website_app" {
  count = var.enable_website ? 1 : 0
  name  = "${local.name}-website-media"
  role  = aws_iam_role.website_app[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "WebsiteMedia"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.website[0].arn}/media/*"
      },
      {
        # Turns a missing key into a 404 instead of AccessDenied.
        Sid       = "WebsiteMediaList"
        Effect    = "Allow"
        Action    = ["s3:ListBucket"]
        Resource  = aws_s3_bucket.website[0].arn
        Condition = { StringLike = { "s3:prefix" = ["media/*"] } }
      },
      {
        # Brochure and enquiry email (MAIL_FROM). Limited to the one sender.
        Sid      = "SendWebsiteMail"
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = "*"
        Condition = {
          StringEquals = { "ses:FromAddress" = "brochures@${var.domain_name}" }
        }
      },
    ]
  })
}

# Lets root on the host assume the role above. Nothing else on the instance role
# changes — the tracker keeps exactly the permissions it had.
resource "aws_iam_role_policy" "ec2_assume_website_app" {
  count = var.enable_website ? 1 : 0
  name  = "${local.name}-assume-website-app"
  role  = aws_iam_role.ec2.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "sts:AssumeRole"
      Resource = aws_iam_role.website_app[0].arn
    }]
  })
}

resource "aws_ssm_parameter" "website_app_role_arn" {
  count = var.enable_website ? 1 : 0
  name  = "/${var.project}/website/APP_ROLE_ARN"
  type  = "String"
  value = aws_iam_role.website_app[0].arn
}
