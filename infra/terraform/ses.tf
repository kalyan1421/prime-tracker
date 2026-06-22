# Gated on enable_dns (needs the Route 53 zone for verification/DKIM records).
# In Phase 1 the app keeps sending via SMTP (MAIL_DRIVER=smtp).
resource "aws_ses_domain_identity" "main" {
  count  = var.enable_dns ? 1 : 0
  domain = var.domain_name
}

resource "aws_ses_domain_dkim" "main" {
  count  = var.enable_dns ? 1 : 0
  domain = aws_ses_domain_identity.main[0].domain
}

# DKIM CNAMEs (signs outbound mail).
resource "aws_route53_record" "ses_dkim" {
  count   = var.enable_dns ? 3 : 0
  zone_id = aws_route53_zone.main[0].zone_id
  name    = "${aws_ses_domain_dkim.main[0].dkim_tokens[count.index]}._domainkey.${var.domain_name}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.main[0].dkim_tokens[count.index]}.dkim.amazonses.com"]
}

# Domain verification TXT.
resource "aws_route53_record" "ses_verification" {
  count   = var.enable_dns ? 1 : 0
  zone_id = aws_route53_zone.main[0].zone_id
  name    = "_amazonses.${var.domain_name}"
  type    = "TXT"
  ttl     = 600
  records = [aws_ses_domain_identity.main[0].verification_token]
}

# Custom MAIL FROM (improves deliverability / SPF alignment).
resource "aws_ses_domain_mail_from" "main" {
  count            = var.enable_dns ? 1 : 0
  domain           = aws_ses_domain_identity.main[0].domain
  mail_from_domain = "mail.${var.domain_name}"
}
resource "aws_route53_record" "ses_mail_from_mx" {
  count   = var.enable_dns ? 1 : 0
  zone_id = aws_route53_zone.main[0].zone_id
  name    = aws_ses_domain_mail_from.main[0].mail_from_domain
  type    = "MX"
  ttl     = 600
  records = ["10 feedback-smtp.${var.aws_region}.amazonses.com"]
}
resource "aws_route53_record" "ses_mail_from_txt" {
  count   = var.enable_dns ? 1 : 0
  zone_id = aws_route53_zone.main[0].zone_id
  name    = aws_ses_domain_mail_from.main[0].mail_from_domain
  type    = "TXT"
  ttl     = 600
  records = ["v=spf1 include:amazonses.com ~all"]
}

# NOTE: New SES accounts start in the sandbox (can only send to verified
# addresses). Request production access in the SES console after apply — that
# step is manual and cannot be automated via Terraform.
