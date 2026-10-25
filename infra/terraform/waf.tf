# ---------- Web application firewall for the public website ----------
#
# In front of the website's CloudFront distribution (website.tf), so it sees the
# visitor's real address and acts before anything reaches the shared EC2 host. Found
# missing by the 24 Oct 2026 audit: the API's own per-IP limits counted on one
# process's memory and could be dodged by reaching the origin directly.
#
# CloudFront web ACLs must live in us-east-1, hence the provider alias.
#
# Two rules from the common set are switched to COUNT, not removed:
#   SizeRestrictions_BODY   blocks bodies over 8 KB — every CMS save of a property
#                           (40+ KB of floor-plan JSON) and every upload.
#   CrossSiteScripting_BODY fires on news articles, whose Markdown legitimately
#                           contains angle brackets and links.
# Both stay visible in the WAF metrics, so a real attack still shows up.

variable "waf_rate_limits" {
  description = "Requests per 5 minutes per IP before WAF blocks: login, lead/brochure submissions, and everything."
  type = object({
    login = number
    leads = number
    all   = number
  })
  default = {
    login = 100
    leads = 100
    all   = 3000
  }
}

resource "aws_wafv2_web_acl" "website" {
  count    = var.enable_website ? 1 : 0
  provider = aws.us_east_1
  name     = "${local.name}-website"
  scope    = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "aws-common"
    priority = 10
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
        rule_action_override {
          name = "CrossSiteScripting_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-website-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 20
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-website-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-ip-reputation"
    priority = 30
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-website-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  # Password guessing against the CMS login.
  rule {
    name     = "rate-login"
    priority = 40
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.waf_rate_limits.login
        aggregate_key_type = "IP"
        scope_down_statement {
          byte_match_statement {
            field_to_match {
              uri_path {}
            }
            positional_constraint = "STARTS_WITH"
            search_string         = "/api/auth/"
            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-website-rate-login"
      sampled_requests_enabled   = true
    }
  }

  # Enquiry and brochure spam — the brochure endpoint sends mail from the company's
  # address.
  rule {
    name     = "rate-leads"
    priority = 50
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.waf_rate_limits.leads
        aggregate_key_type = "IP"
        scope_down_statement {
          byte_match_statement {
            field_to_match {
              uri_path {}
            }
            positional_constraint = "STARTS_WITH"
            search_string         = "/api/leads"
            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-website-rate-leads"
      sampled_requests_enabled   = true
    }
  }

  # Everything else from one address — scraping, or a resizer flood of cache misses.
  rule {
    name     = "rate-all"
    priority = 60
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.waf_rate_limits.all
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-website-rate-all"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-website"
    sampled_requests_enabled   = true
  }
}
