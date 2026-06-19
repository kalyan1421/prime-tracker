# Secret + config parameters the API reads at boot. Terraform creates the
# parameter *structure* with a placeholder value; the real values are set
# out-of-band (see scripts/put-ssm-params.sh or the README) so secrets never
# land in Terraform state. `ignore_changes` keeps Terraform from clobbering
# the real value on later applies.
locals {
  ssm_secure_params = [
    "DATABASE_URL",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "ENCRYPTION_KEY",
    "GOOGLE_CLIENT_SECRET",
    "REDIS_PASSWORD",
    "QB_CLIENT_SECRET",
  ]
  ssm_plain_params = [
    "GOOGLE_CLIENT_ID",
    "QB_CLIENT_ID",
  ]
}

resource "aws_ssm_parameter" "secure" {
  for_each = toset(local.ssm_secure_params)
  name     = "/${var.project}/${each.value}"
  type     = "SecureString"
  value    = "REPLACE_ME"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "plain" {
  for_each = toset(local.ssm_plain_params)
  name     = "/${var.project}/${each.value}"
  type     = "String"
  value    = "REPLACE_ME"

  lifecycle {
    ignore_changes = [value]
  }
}
