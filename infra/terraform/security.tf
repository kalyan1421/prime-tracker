resource "aws_security_group" "ec2" {
  name        = "${local.name}-ec2-sg"
  description = "API host: HTTP/HTTPS public, SSH from admin only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  # Port 22 is optional, and should be off once SSM deploys are working.
  #
  # Session Manager already gives a shell on this box (the instance role carries
  # AmazonSSMManagedInstanceCore), and the deploy no longer connects inbound at all —
  # it puts the build in S3 and the agent fetches it. That leaves 22 open for nobody,
  # which is the definition of an unnecessary attack surface on the one port that
  # grants a shell.
  #
  # The rule it replaces was also quietly broken as a deploy path: admin_cidr is a
  # single home IP, so a hosted CI runner could never have reached it, and the address
  # stops working the moment the ISP reassigns it.
  #
  #   aws ssm start-session --target <instance-id> --region us-east-1
  dynamic "ingress" {
    for_each = var.enable_ssh ? [1] : []
    content {
      description = "SSH (admin only)"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [var.admin_cidr]
    }
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${local.name}-ec2-sg" }
}

resource "aws_security_group" "rds" {
  name        = "${local.name}-rds-sg"
  description = "Postgres reachable only from the API host"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres from EC2 SG only"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${local.name}-rds-sg" }
}
