resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db-subnets"
  subnet_ids = aws_subnet.private[*].id
  tags       = { Name = "${local.name}-db-subnets" }
}

# Explicit rather than default.postgres15, so settings are in code. rds.force_ssl is
# already 1 in the default group; it is stated here so nobody switches it off by
# swapping groups. Slow statements (over a second) are logged and shipped to
# CloudWatch below. Attaching a new group takes effect at the next reboot — the
# maintenance-window change that resizes the instance.
resource "aws_db_parameter_group" "main" {
  name   = "${local.name}-pg15"
  family = "postgres15"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Enhanced Monitoring: OS-level metrics (per-process memory, swap, load) every 15s,
# which is what the memory alarm of 23 Oct 2026 needed and RDS's own metrics lacked.
resource "aws_iam_role" "rds_monitoring" {
  name = "${local.name}-rds-monitoring"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "monitoring.rds.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# Created ahead of the instance so retention is ours, not "never expire".
resource "aws_cloudwatch_log_group" "rds_postgresql" {
  name              = "/aws/rds/instance/${local.name}-db/postgresql"
  retention_in_days = 30
}

resource "aws_db_instance" "main" {
  identifier     = "${local.name}-db"
  engine         = "postgres"
  engine_version = "15"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  parameter_group_name   = aws_db_parameter_group.main.name

  # A standby in a second AZ: an AZ or host failure, and most maintenance, becomes a
  # ~60s failover instead of an outage for both products. Converting is online; the
  # first conversion runs in the maintenance window with the resize (see below).
  multi_az = var.db_multi_az

  # 30, not 7. The likeliest disaster here is not a dead AZ, it is bad data nobody
  # notices for a fortnight — and 7 days of history cannot recover from that. Storage
  # for snapshots of a 20 GB instance costs cents.
  backup_retention_period = 30
  backup_window           = "07:00-08:00"
  maintenance_window      = "Mon:08:00-Mon:09:00"
  copy_tags_to_snapshot   = true

  performance_insights_enabled          = true
  performance_insights_retention_period = 7
  monitoring_interval                   = 15
  monitoring_role_arn                   = aws_iam_role.rds_monitoring.arn
  enabled_cloudwatch_logs_exports       = ["postgresql"]

  deletion_protection       = var.rds_deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-db-final"

  # Changes wait for the Monday 08:00–09:00 UTC window unless rds_apply_immediately is
  # set for one deliberate apply. It used to be `true`, which meant any apply that
  # touched the instance — a class change, a password typo from the wrong tfvars —
  # restarted the database shared by both products on the spot.
  apply_immediately = var.rds_apply_immediately

  depends_on = [aws_cloudwatch_log_group.rds_postgresql]

  lifecycle {
    # The only copy of the tracker's and the website's data. deletion_protection stops
    # the API call; this stops Terraform from ever planning it.
    prevent_destroy = true
  }

  tags = { Name = "${local.name}-db" }
}
