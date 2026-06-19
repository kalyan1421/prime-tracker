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
