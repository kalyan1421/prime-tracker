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
    # Moved from the plain list 2026-09-01 to match what is actually deployed.
    # GOOGLE_CLIENT_ID was created as, or later promoted to, a SecureString in the live
    # account; this file still called it String, so every plan proposed DOWNGRADING it
    # (SecureString -> String). Terraform quietly undoing someone's hardening is worse
    # than the hardening never having happened, because nobody is watching for it in a
    # plan whose stated purpose is something else entirely.
    #
    # `ignore_changes` covers `value`, not `type`, so this could not have been caught
    # there. A client id is only semi-secret — it travels in the browser OAuth flow —
    # but matching reality costs nothing and a downgrade buys nothing.
    "GOOGLE_CLIENT_ID",
  ]
  ssm_plain_params = [
    # Genuinely String in the live account, and left that way.
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

# GOOGLE_CLIENT_ID moved from the plain list to the secure one (see above).
#
# Without this block Terraform reads that as "destroy one resource, create another" —
# and since `value` is only ignored AFTER creation, the new parameter would be created
# holding the literal "REPLACE_ME". That silently breaks Google sign-in, which is a far
# worse outcome than the SecureString/String mismatch being corrected. The moved block
# says it is the same object, so the change becomes an in-place type update and the real
# value is left alone.
moved {
  from = aws_ssm_parameter.plain["GOOGLE_CLIENT_ID"]
  to   = aws_ssm_parameter.secure["GOOGLE_CLIENT_ID"]
}
