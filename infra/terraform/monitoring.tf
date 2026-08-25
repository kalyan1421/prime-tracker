resource "aws_sns_topic" "alarms" {
  name = "${local.name}-alarms"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

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
  alarm_actions       = [aws_sns_topic.alarms.arn]
  dimensions = {
    Currency = "USD"
  }
}

# Recover the instance when the UNDERLYING HOST fails. There is one box and no ASG, so
# without this a hardware fault is an outage that lasts until a human notices. The
# `ec2:recover` action rebuilds it on healthy hardware with the same instance id, same
# EIP and same volumes — nothing to reconfigure afterwards.
resource "aws_cloudwatch_metric_alarm" "instance_auto_recover" {
  alarm_name          = "${local.name}-auto-recover"
  alarm_description   = "Recover the instance on system status-check failure"
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_System"
  dimensions          = { InstanceId = aws_instance.api.id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = ["arn:aws:automate:${var.aws_region}:ec2:recover"]
}
