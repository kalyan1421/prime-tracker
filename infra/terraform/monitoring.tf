# ─────────────────────────────────────────────────────────────────────────────
# Alerting and monitoring
#
# The audit of 2026-09-01 found that nothing watched the *application*. The only
# two alarms were EC2 system-status (which recovered the box but told nobody) and
# estimated billing. A crashed API, a full disk, an exhausted database or a broken
# certificate produced no signal at all — the first report was a person saying
# "the site is down".
#
# Four layers, cheapest and most direct first:
#
#   1. Does the app answer from the public internet?  (Route 53 health check)
#   2. Is the host alive and not throttled?           (EC2 metrics, free)
#   3. Is the database about to stop?                 (RDS metrics, free)
#   4. Is the box about to fill up or run out of RAM? (CloudWatch agent)
#
# Every alarm points at ONE topic. Whether an alarm reaches a human is a property
# of that topic's SUBSCRIPTIONS, not of the alarms — an unconfirmed subscription
# is the same as no monitoring at all. See the note on the topic below.
# ─────────────────────────────────────────────────────────────────────────────

locals {
  alarm_actions = [aws_sns_topic.alarms.arn]

  # The public origin the browser actually uses today (Phase 1, no DNS): the nip.io
  # name derived from the Elastic IP. Derived, so it cannot drift from the box that
  # is serving. Once enable_dns is true this should become app.${var.domain_name}.
  monitored_host = "${replace(aws_eip.api.public_ip, ".", "-")}.nip.io"

  # Readiness, not liveness. /api/health returns 200 whenever the Node process is
  # up — including when it cannot reach the database, which is a total outage that
  # a liveness probe reports as healthy. /api/health/ready runs `SELECT 1`.
  health_check_path = "/api/health/ready"
}

# ── Where alarms go ──────────────────────────────────────────────────────────

resource "aws_sns_topic" "alarms" {
  name = "${local.name}-alarms"
}

# An email subscription is created by Terraform in state `PendingConfirmation` and
# delivers NOTHING until the confirmation link in the email is clicked. Terraform
# cannot click it and cannot detect that it is unclicked — `terraform apply` reports
# success either way. Verify by hand after the first apply:
#
#   aws sns list-subscriptions-by-topic --topic-arn <arn> \
#     --query 'Subscriptions[].[Protocol,Endpoint,SubscriptionArn]' --output table
#
# A SubscriptionArn of the literal string "PendingConfirmation" means nobody is
# being notified.
resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# Email is a mailbox, not a pager: it is read when someone next opens their laptop.
# For the outage-class alarms below that is the difference between a ten-minute
# outage and an overnight one, so an SMS destination is offered.
#
# Caveat that will bite you: new AWS accounts are in the SNS SMS *sandbox*, where
# messages only reach phone numbers verified in the console
# (SNS > Text messaging > Sandbox destination phone numbers). Add the number there,
# or request production SMS access, or this subscription is as silent as an
# unconfirmed email.
resource "aws_sns_topic_subscription" "sms" {
  count     = var.alarm_sms_number == "" ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "sms"
  endpoint  = var.alarm_sms_number
}

# ── Layer 1: does the application answer from outside? ───────────────────────
#
# This is the alarm the audit was actually missing. It is the only check here that
# exercises what a user exercises: DNS → Elastic IP → nginx → TLS → Node → Postgres.
# Everything below it explains an outage; this one detects it.
#
# Checked from health checkers in several AWS regions, so a single region's network
# problem cannot page anyone on its own.
#
# HTTPS_STR_MATCH, not HTTP, for two independent reasons:
#   - Port 80 answers 301 to HTTPS, and Route 53 counts 3xx as HEALTHY. An HTTP
#     check would therefore pass on nginx's redirect alone, with the API dead
#     behind it — a monitor that is green during the outage it exists to catch.
#   - String matching asserts the *body* says `"status":"ok"`, so a readiness
#     response that degrades rather than fails still trips the alarm.
# Route 53 does not validate the certificate chain, so the nip.io host's cert being
# issued for another name does not matter here.
resource "aws_route53_health_check" "api" {
  count = var.enable_endpoint_monitor ? 1 : 0

  type              = "HTTPS_STR_MATCH"
  ip_address        = aws_eip.api.public_ip
  port              = 443
  fqdn              = local.monitored_host # sent as SNI + Host header
  resource_path     = local.health_check_path
  search_string     = "\"status\":\"ok\""
  request_interval  = 30 # 10s is a paid "fast interval" feature; 30s is standard
  failure_threshold = 3  # ~90s of consecutive failures before the check flips

  tags = { Name = "${local.name}-api-endpoint" }
}

# Route 53 publishes HealthCheckStatus only into us-east-1, whatever var.aws_region says.
resource "aws_cloudwatch_metric_alarm" "api_endpoint_down" {
  count    = var.enable_endpoint_monitor ? 1 : 0
  provider = aws.us_east_1

  alarm_name        = "${local.name}-api-DOWN"
  alarm_description = "The API is not answering ${local.health_check_path} over HTTPS from the public internet. Check pm2 (`pm2 list`), nginx, and RDS — in that order. Shell in with: aws ssm start-session --target ${aws_instance.api.id}"

  namespace   = "AWS/Route53"
  metric_name = "HealthCheckStatus"
  dimensions  = { HealthCheckId = aws_route53_health_check.api[0].id }

  statistic           = "Minimum"
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  period              = 60
  evaluation_periods  = 2

  # ~3 minutes from "the API stopped answering" to "the phone buzzes". Deliberately
  # not tighter: a deploy restarts pm2, and a restart that completes inside the
  # health check's own 90s failure threshold must not page anyone.

  # No data from the health checkers is not good news.
  treat_missing_data = "breaching"

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions # "it came back" is half the information
}

# ── Layer 2: the host ────────────────────────────────────────────────────────

# Recover the instance when the UNDERLYING HOST fails. There is one box and no ASG, so
# without this a hardware fault is an outage that lasts until a human notices. The
# `ec2:recover` action rebuilds it on healthy hardware with the same instance id, same
# EIP and same volumes — nothing to reconfigure afterwards.
#
# It notified nobody until now. A silent recovery is still a reboot: pm2 resurrects the
# API, but anyone mid-request lost it, and a recovery that keeps happening is a fault
# report nobody was reading.
resource "aws_cloudwatch_metric_alarm" "instance_auto_recover" {
  alarm_name          = "${local.name}-auto-recover"
  alarm_description   = "EC2 system status check failed — AWS host fault. The instance is being recovered automatically onto healthy hardware (same id, same EIP, same volumes); the API restarts under pm2. No action needed unless it repeats."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_System"
  dimensions          = { InstanceId = aws_instance.api.id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = concat(["arn:aws:automate:${var.aws_region}:ec2:recover"], local.alarm_actions)
  ok_actions          = local.alarm_actions
}

# The system check above is about AWS's hardware; THIS one is about the guest — a
# kernel panic, a full root volume, an exhausted network stack. `ec2:recover` does not
# help (the hardware is fine) and nothing else will act on it, so it must reach a human.
resource "aws_cloudwatch_metric_alarm" "instance_status_failed" {
  alarm_name          = "${local.name}-instance-status-failed"
  alarm_description   = "EC2 instance status check failed — the guest OS is unhealthy (panic, full disk, network stack). Auto-recovery does NOT apply. Try a reboot: aws ec2 reboot-instances --instance-ids ${aws_instance.api.id}"
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_Instance"
  dimensions          = { InstanceId = aws_instance.api.id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"

  # A stopped instance publishes nothing. A production box that is not running is an
  # outage whether it stopped by fault or by hand, so absence is treated as failure.
  treat_missing_data = "breaching"

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
}

# t3.micro is burstable. When CPU credits run out the instance is throttled to its
# 10% baseline and the API becomes unusably slow while every check above still reports
# it up — the failure mode that gets described as "the site is really slow today" and
# never gets diagnosed. This is a warning, not a page: it predicts the problem.
resource "aws_cloudwatch_metric_alarm" "cpu_credits_low" {
  alarm_name          = "${local.name}-cpu-credits-low"
  alarm_description   = "EC2 CPU credit balance is low. The instance is close to being throttled to its baseline and the API will get slow while still answering. Find the busy process, or move off a burstable instance type."
  namespace           = "AWS/EC2"
  metric_name         = "CPUCreditBalance"
  dimensions          = { InstanceId = aws_instance.api.id }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 20
  comparison_operator = "LessThanThreshold"

  # Non-burstable instance types do not publish this metric at all — absence must not
  # page anyone if the box is ever resized.
  treat_missing_data = "missing"

  alarm_actions = local.alarm_actions
}

# ── Layer 3: the database ────────────────────────────────────────────────────
#
# The API cannot outlive its database. These are free (RDS publishes them already)
# and each one is a distinct way the platform stops working.

# Storage exhaustion stops writes dead. `max_allocated_storage = 100` means RDS will
# usually autoscale first — but autoscaling has a cooldown of several hours and can
# fail, so this stays a real alarm rather than an assumption.
resource "aws_cloudwatch_metric_alarm" "rds_storage_low" {
  alarm_name          = "${local.name}-rds-storage-low"
  alarm_description   = "RDS free storage is under 2 GB. Storage autoscaling (up to 100 GB) should act first; if it has not, writes will start failing. Check for runaway audit_events or an unvacuumed table."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 2147483648 # 2 GiB
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "rds_memory_low" {
  alarm_name          = "${local.name}-rds-memory-low"
  alarm_description   = "RDS freeable memory is under 128 MB on a 1 GB db.t3.micro. Postgres will start swapping and then killing backends."
  namespace           = "AWS/RDS"
  metric_name         = "FreeableMemory"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 134217728 # 128 MiB
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  alarm_name          = "${local.name}-rds-cpu-high"
  alarm_description   = "RDS CPU above 85% for 15 minutes. Usually one unindexed query on a growing table."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = local.alarm_actions
}

# DATABASE_URL pins `connection_limit=5`, so steady state is single digits. Forty open
# connections is not load, it is a leak — and db.t3.micro runs out somewhere near a
# hundred, at which point every request fails at once.
resource "aws_cloudwatch_metric_alarm" "rds_connections_high" {
  alarm_name          = "${local.name}-rds-connections-high"
  alarm_description   = "RDS has over 40 open connections; the API pool is capped at 5 per process. Suspect a connection leak or orphaned processes, not traffic."
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 40
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = local.alarm_actions
}

# ── Layer 4: disk and memory on the box ──────────────────────────────────────
#
# EC2 publishes no disk-usage or memory metric — the hypervisor cannot see inside the
# guest. They have to be pushed from the box by the CloudWatch agent. Both are worth
# the trouble here: the root volume is 20 GB with pm2 logs, an apt cache, a git
# checkout and Docker on it, and the box has 914 MiB of RAM (little enough that
# `nest build` was moved off it onto the CI runner). A full disk or an OOM kill is the
# most likely way this instance dies, and layers 1–3 would only report the aftermath.
#
# The agent is installed and configured by SSM Association, not by user-data:
# user-data runs once at first boot and this box has been running since long before
# this file existed. Associations re-apply on a schedule, so an agent someone stops
# comes back on its own.

resource "aws_iam_role_policy_attachment" "cw_agent" {
  count      = var.enable_host_metrics ? 1 : 0
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

# Read by the agent on the box using the instance role, which already carries
# ssm:GetParameter on /${var.project}/* (iam.tf).
resource "aws_ssm_parameter" "cw_agent_config" {
  count = var.enable_host_metrics ? 1 : 0
  name  = "/${var.project}/cloudwatch-agent-config"
  type  = "String"
  tier  = "Standard"

  value = jsonencode({
    agent = {
      metrics_collection_interval = 300
      run_as_user                 = "cwagent"
    }
    metrics = {
      namespace = "PrimeTracker/Host"
      append_dimensions = {
        InstanceId = "$${aws:InstanceId}"
      }
      # Publish against InstanceId alone as well as the full dimension set, so an
      # alarm does not have to name the device or filesystem type — those change
      # when the volume is replaced, and an alarm on a dimension that no longer
      # exists is an alarm that silently never fires again.
      aggregation_dimensions = [["InstanceId"]]
      metrics_collected = {
        disk = {
          resources                   = ["/"]
          measurement                 = ["used_percent"]
          metrics_collection_interval = 300
        }
        mem = {
          measurement                 = ["mem_used_percent"]
          metrics_collection_interval = 300
        }
      }
    }
  })
}

resource "aws_ssm_association" "cw_agent_install" {
  count            = var.enable_host_metrics ? 1 : 0
  association_name = "${local.name}-cw-agent-install"
  name             = "AWS-ConfigureAWSPackage"

  targets {
    key    = "InstanceIds"
    values = [aws_instance.api.id]
  }

  parameters = {
    action = "Install"
    name   = "AmazonCloudWatchAgent"
  }

  # Re-runs keep the agent present and current. Nothing the API depends on restarts.
  schedule_expression = "rate(7 days)"
}

resource "aws_ssm_association" "cw_agent_configure" {
  count            = var.enable_host_metrics ? 1 : 0
  association_name = "${local.name}-cw-agent-configure"
  name             = "AmazonCloudWatch-ManageAgent"

  targets {
    key    = "InstanceIds"
    values = [aws_instance.api.id]
  }

  parameters = {
    action                        = "configure"
    mode                          = "ec2"
    optionalConfigurationSource   = "ssm"
    optionalConfigurationLocation = aws_ssm_parameter.cw_agent_config[0].name
    optionalRestart               = "yes"
  }

  schedule_expression = "rate(1 day)" # singular: the SSM API rejects "rate(1 days)"

  depends_on = [aws_ssm_association.cw_agent_install]
}

resource "aws_cloudwatch_metric_alarm" "host_disk_high" {
  count               = var.enable_host_metrics ? 1 : 0
  alarm_name          = "${local.name}-host-disk-high"
  alarm_description   = "Root volume over 85% full on the API host (20 GB total). Usual culprits: pm2 logs in ~/.pm2/logs, /var/log/nginx, the apt cache, old Docker images. A full disk takes the API down and blocks the next deploy."
  namespace           = "PrimeTracker/Host"
  metric_name         = "disk_used_percent"
  dimensions          = { InstanceId = aws_instance.api.id }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"

  # Missing data here means the agent stopped, which is a monitoring failure rather
  # than a disk failure — do not page for it, and do not report it as healthy either.
  treat_missing_data = "missing"

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "host_memory_high" {
  count               = var.enable_host_metrics ? 1 : 0
  alarm_name          = "${local.name}-host-memory-high"
  alarm_description   = "Memory over 90% on the API host (914 MiB). The OOM killer takes the Node process; pm2 restarts it and the outage looks like a mystery crash loop."
  namespace           = "PrimeTracker/Host"
  metric_name         = "mem_used_percent"
  dimensions          = { InstanceId = aws_instance.api.id }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 90
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = local.alarm_actions
}

# ── Cost ─────────────────────────────────────────────────────────────────────

# Billing metrics are published only in us-east-1.
# Requires "Receive Billing Alerts" enabled once in Billing > Billing Preferences.
resource "aws_cloudwatch_metric_alarm" "billing" {
  provider            = aws.us_east_1
  alarm_name          = "${local.name}-monthly-billing"
  alarm_description   = "Estimated monthly charges exceeded threshold"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  period              = 21600
  statistic           = "Maximum"
  threshold           = var.billing_threshold_usd
  alarm_actions       = local.alarm_actions
  dimensions = {
    Currency = "USD"
  }
}

# ── One place to look ────────────────────────────────────────────────────────
#
# An alarm tells you something broke; this is where you look next. First three
# dashboards per account are free.
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${local.name}-production"

  dashboard_body = jsonencode({
    widgets = concat(
      var.enable_endpoint_monitor ? [{
        type = "metric", x = 0, y = 0, width = 8, height = 6
        properties = {
          title   = "API reachable (1 = healthy)"
          region  = "us-east-1"
          view    = "timeSeries"
          stat    = "Minimum"
          period  = 60
          yAxis   = { left = { min = 0, max = 1 } }
          metrics = [["AWS/Route53", "HealthCheckStatus", "HealthCheckId", aws_route53_health_check.api[0].id]]
        }
      }] : [],
      [
        {
          type = "metric", x = 8, y = 0, width = 8, height = 6
          properties = {
            title  = "API host — CPU and credits"
            region = var.aws_region
            view   = "timeSeries"
            period = 300
            metrics = [
              ["AWS/EC2", "CPUUtilization", "InstanceId", aws_instance.api.id],
              [".", "CPUCreditBalance", ".", "."],
            ]
          }
        },
        {
          type = "metric", x = 16, y = 0, width = 8, height = 6
          properties = {
            title  = "Database — CPU and connections"
            region = var.aws_region
            view   = "timeSeries"
            period = 300
            metrics = [
              ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", aws_db_instance.main.identifier],
              [".", "DatabaseConnections", ".", "."],
            ]
          }
        },
        {
          type = "metric", x = 0, y = 6, width = 8, height = 6
          properties = {
            title  = "Database — free storage and memory (bytes)"
            region = var.aws_region
            view   = "timeSeries"
            period = 300
            metrics = [
              ["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", aws_db_instance.main.identifier],
              [".", "FreeableMemory", ".", "."],
            ]
          }
        },
      ],
      var.enable_host_metrics ? [{
        type = "metric", x = 8, y = 6, width = 8, height = 6
        properties = {
          title  = "API host — disk and memory used %"
          region = var.aws_region
          view   = "timeSeries"
          period = 300
          yAxis  = { left = { min = 0, max = 100 } }
          metrics = [
            ["PrimeTracker/Host", "disk_used_percent", "InstanceId", aws_instance.api.id],
            [".", "mem_used_percent", ".", "."],
          ]
        }
      }] : []
    )
  })
}
