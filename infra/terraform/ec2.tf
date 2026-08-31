resource "aws_key_pair" "main" {
  key_name   = "${local.name}-key"
  public_key = var.ssh_public_key
}

resource "aws_instance" "api" {
  # One API call away from destroying the only server, with no ASG to rebuild it.
  # Terraform can still replace the instance deliberately; this stops the accident.
  disable_api_termination = true

  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.ec2_instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  key_name               = aws_key_pair.main.key_name
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    domain = var.domain_name
  })

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
    encrypted   = true
  }

  # Neither of these may silently replace the only production server.
  #
  # `data.aws_ami.ubuntu` is `most_recent = true`, and Canonical publishes a new
  # 22.04 image every few weeks. So the AMI id drifts on its own, with no change to
  # this repository, and the next `terraform apply` — for any reason at all, adding
  # an IAM role, fixing a tag — plans `aws_instance.api` as delete/create. Measured
  # 2026-09-01: a plan whose only intended change was the deploy role also proposed
  # destroying the live instance (ami-06e78a71af43ef21a -> ami-040dc3b259ece28c6).
  #
  # `user_data` only takes effect on first boot, so a change here cannot reach a
  # running box anyway; keeping it in the diff buys nothing and costs a replacement.
  # The template HAS been edited since launch (the nginx proxy-buffer fix), and that
  # change was applied to the box by hand, as such changes must be.
  #
  # `disable_api_termination` above does not save you: Terraform would attempt the
  # termination, fail on it, and leave the apply half-finished.
  #
  # Replacing the instance stays possible — it just has to be deliberate:
  #   terraform apply -replace=aws_instance.api
  # Do that only with the runbook open: the EIP reattaches, but everything the box
  # carries outside this config (Let's Encrypt cert, nginx config, pm2 state, the
  # repo checkout, the Redis container) is rebuilt by user-data or not at all.
  lifecycle {
    ignore_changes = [ami, user_data]
  }

  tags = { Name = "${local.name}-api" }
}

resource "aws_eip" "api" {
  instance = aws_instance.api.id
  domain   = "vpc"
  tags     = { Name = "${local.name}-eip" }
}
