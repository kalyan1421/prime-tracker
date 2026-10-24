# ─────────────────────────────────────────────────────────────────────────────
# Keyless deploys from GitHub Actions, over SSM. No port 22, no stored AWS keys.
# ─────────────────────────────────────────────────────────────────────────────
#
# The problem this solves: the deploy job used scp + ssh to reach the box, and
# security.tf allows port 22 from ONE address (var.admin_cidr). GitHub's hosted runners
# get a different IP every run, so the job could never have connected — it would have
# hung at the copy step and timed out, whatever secrets were set. Widening the SSH rule
# to GitHub's published ranges would mean thousands of addresses, re-published without
# notice, on the one port that grants a shell.
#
# So the runner never connects to the box at all. It puts the build in S3 and asks SSM
# to run a command; the agent already on the instance pulls the artifact and runs it,
# reaching out to AWS rather than being reached. Port 22 closes entirely (see
# security.tf) and there is no inbound path to leave open by mistake.
#
# Credentials are OIDC, not access keys: GitHub mints a short-lived token per run and
# AWS trades it for a session, scoped by the `sub` condition below to THIS repository.
# A leaked key cannot be replayed because there is no key.

# ── Trust GitHub's OIDC issuer ────────────────────────────────────────────────
# One per account. If your account already has this provider (another repo, another
# stack), import it instead of creating a second one — AWS permits only one provider
# per URL:
#   terraform import aws_iam_openid_connect_provider.github \
#     arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com
resource "aws_iam_openid_connect_provider" "github" {
  count = var.enable_github_deploy ? 1 : 0

  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]

  # AWS stopped verifying this list for its own OIDC endpoints in 2023, but the
  # argument is still required. This is GitHub's intermediate root.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

# ── The role the runner assumes ───────────────────────────────────────────────
resource "aws_iam_role" "github_deploy" {
  count = var.enable_github_deploy ? 1 : 0

  name = "${local.name}-github-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github[0].arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        # Scoped to one repo and one ENVIRONMENT.
        #
        # Not `ref:refs/heads/main`, which is the obvious guess and does not work: the
        # moment a job declares `environment:`, GitHub changes the OIDC subject claim
        # from `repo:OWNER/REPO:ref:refs/heads/BRANCH` to
        # `repo:OWNER/REPO:environment:NAME`. A ref-based condition therefore never
        # matches and the assume fails with the singularly unhelpful "Not authorized to
        # perform sts:AssumeRoleWithWebIdentity". Measured, not guessed — this cost a
        # failed deploy run.
        #
        # The branch restriction is not lost, it moves: the `production` environment
        # carries a deployment branch policy allowing only `main`, so only main-branch
        # runs can obtain this subject at all. That is enforced by GitHub before the
        # token is minted, and it is what makes this condition sufficient. If that
        # policy is ever removed, any branch could deploy — the two are a pair.
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:environment:production"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  count = var.enable_github_deploy ? 1 : 0

  name = "${local.name}-github-deploy"
  role = aws_iam_role.github_deploy[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Write the build artifact, and only under the releases prefix. The rest of the
        # app bucket serves the SPA; a deploy has no business touching it.
        Sid      = "PutBuildArtifact"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.app.arn}/releases/*"
      },
      {
        # Run the deploy document, on this instance only. Constraining BOTH the document
        # and the instance matters: SendCommand with AWS-RunShellScript on "*" is a
        # remote shell on every box in the account.
        Sid    = "RunDeployDocument"
        Effect = "Allow"
        Action = ["ssm:SendCommand"]
        Resource = [
          aws_ssm_document.deploy[0].arn,
          "arn:aws:ec2:${var.aws_region}:${local.account_id}:instance/${aws_instance.api.id}",
        ]
      },
      {
        # Read back the result so the workflow can fail when the deploy fails. Without
        # this the job reports success the moment the command is accepted.
        Sid    = "ReadCommandResult"
        Effect = "Allow"
        Action = [
          "ssm:GetCommandInvocation",
          "ssm:ListCommandInvocations",
          "ssm:ListCommands",
        ]
        Resource = "*"
      },
    ]
  })
}

# ── The deploy itself, as an SSM document ─────────────────────────────────────
# A document rather than an inline AWS-RunShellScript, deliberately. The role above can
# then be allowed to run THIS script and nothing else; with RunShellScript the same
# permission is "execute arbitrary commands as root on the instance", which is a much
# larger thing to hand a CI system.
#
# The body is the same sequence the ssh-based job ran, with one change: the artifact
# arrives from S3 instead of scp.
resource "aws_ssm_document" "deploy" {
  count = var.enable_github_deploy ? 1 : 0

  name            = "${local.name}-deploy"
  document_type   = "Command"
  document_format = "YAML"

  content = yamlencode({
    schemaVersion = "2.2"
    description   = "Pull the built artifact from S3 and release it on this instance."
    parameters = {
      ArtifactUrl = {
        type        = "String"
        description = "s3:// URL of the dist tarball built by the runner."
        # Anchored, and no shell metacharacters: this value is interpolated into a
        # command that runs as root. Without the pattern, a caller who can SendCommand
        # could smuggle `; curl evil | sh` through a parameter.
        allowedPattern = "^s3://[a-z0-9.\\-]+/releases/[A-Za-z0-9._\\-/]+\\.tgz$"
      }
      GitSha = {
        type        = "String"
        description = "Commit being released — the box checks out exactly this commit."
        # Full SHA only: it is what the box checks out (a short SHA cannot be fetched).
        allowedPattern = "^[0-9a-f]{40}$"
      }
    }
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "release"
      inputs = {
        timeoutSeconds = "1800"
        runCommand = [
          # `set -eu`, NOT `-euo pipefail`: SSM's aws:runShellScript writes the steps to
          # _script.sh and runs it with /bin/sh, which on Ubuntu is dash. `pipefail` is a
          # bashism and dash exits 2 with "Illegal option -o pipefail" before a single
          # line of the deploy runs. Measured — it failed the first real deploy.
          #
          # The real work happens inside the `sudo … bash` heredoc below, which IS bash
          # and does set pipefail. Keep everything at THIS level POSIX, and check it with
          # `sh -n`, not `bash -n` — bash validates the bashism happily.
          "set -eu",
          "exec 2>&1",
          # node/pnpm/pm2 come from NodeSource + `npm i -g` and live in /usr/bin; the
          # AWS CLI v2 installs to /usr/local/bin. Both are already in sudo's
          # secure_path, but SSM's own environment is minimal — state it rather than
          # inherit whatever the agent happens to pass.
          "export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
          "echo \"Releasing {{ GitSha }} from {{ ArtifactUrl }}\"",

          "# Everything below runs as the ubuntu user. SSM runs commands as root, and a",
          "# root-owned tree is what previously broke git's reflog write and prisma's",
          "# engine cache (EPERM on utime) on the NEXT deploy.",
          "sudo -u ubuntu -H bash -euo pipefail <<'DEPLOY'",
          "set -euo pipefail",
          "export PATH=/usr/local/bin:/usr/bin:/bin",
          "export HOME=/home/ubuntu",
          "REPO_DIR=/home/ubuntu/prime-tracker",
          "cd \"$REPO_DIR\"",

          "# 1. Bring the checkout to the released commit. No GitHub token: the repo is",
          "#    public, the built artifact carries the application, and the checkout only",
          "#    supplies package manifests and migrations. The remote is reset explicitly",
          "#    because an earlier manual deploy left a token embedded in the URL, and a",
          "#    token that later expires breaks fetch with a 403 nobody expects.",
          "#    (If this repo is ever made private, this line is what has to change.)",
          "git remote set-url origin https://github.com/${var.github_repository}.git",
          "#    Exactly the released commit, not whatever main is by now: the checkout",
          "#    supplies the migrations and package manifests, and they must match the",
          "#    artifact built from {{ GitSha }}.",
          "git fetch --depth=1 origin {{ GitSha }}",
          "git reset --hard FETCH_HEAD",

          "# 2. Runtime deps. CI=true stops pnpm 10 at its interactive build-scripts prompt.",
          "CI=true pnpm install --frozen-lockfile",
          "pnpm --filter @prime-tracker/api exec prisma generate",

          "# 3. Unpack the build made on the runner — this box cannot compile the app",
          "#    (t3.micro, 914 MiB: nest build dies with a V8 heap OOM).",
          "aws s3 cp \"{{ ArtifactUrl }}\" /tmp/dist.tgz --region ${var.aws_region}",
          "tar xzf /tmp/dist.tgz -C \"$REPO_DIR\"",
          "rm -f /tmp/dist.tgz",

          "# 4. .env from SSM — built by the same script the manual deploy uses, so the two",
          "#    can no longer drift apart (infra/scripts/write-api-env.sh says what they",
          "#    used to disagree on). It fails the deploy if a required secret is unreadable.",
          "APP_URL='${var.app_origin}' S3_BUCKET='${aws_s3_bucket.documents.bucket}' AWS_REGION='${var.aws_region}' PROJECT='${var.project}' SMTP_FROM='${var.api_mail_from}' bash infra/scripts/write-api-env.sh apps/api/.env",

          "# 5. Migrations, then restart.",
          "DATABASE_URL=$(grep -m1 '^DATABASE_URL=' apps/api/.env | sed -E \"s/^[^=]*=//; s/^'//; s/'$//\") pnpm --filter @prime-tracker/api exec prisma migrate deploy",

          "if pm2 describe prime-api >/dev/null 2>&1; then pm2 restart prime-api --update-env; else pm2 start apps/api/dist/main.js --name prime-api --cwd \"$REPO_DIR/apps/api\"; fi",
          "pm2 save",
          "DEPLOY",

          "# 6. Publish the SPA nginx serves, from outside the repo tree.",
          "#    Copied over the top rather than --delete'd: Vite fingerprints asset",
          "#    filenames, so stale files are inert, and a half-finished delete would",
          "#    take the site down. Overwriting index.html is what cuts over.",
          "cp -a /home/ubuntu/prime-tracker/apps/web/dist/. /var/www/prime-web/",
          "chown -R www-data:www-data /var/www/prime-web",

          "# 7. Prove it came back, and fail the deploy if it did not. Without this the",
          "#    job goes green on a process that restarted straight into a crash loop.",
          "for i in $(seq 1 20); do if curl -fsS --max-time 3 http://127.0.0.1:3001/api/health >/dev/null; then echo 'health OK'; exit 0; fi; sleep 3; done",
          "echo 'API did not become healthy within 60s'; pm2 logs prime-api --lines 50 --nostream || true; exit 1",
        ]
      }
    }]
  })
}

# ── Let the instance read the artifact it is told to fetch ────────────────────
resource "aws_iam_role_policy" "ec2_read_releases" {
  count = var.enable_github_deploy ? 1 : 0

  name = "${local.name}-ec2-read-releases"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject"]
      Resource = "${aws_s3_bucket.app.arn}/releases/*"
    }]
  })
}

# Build artifacts are not history. Keeping them costs money and widens what a bucket
# compromise exposes; 30 days is enough to roll back by hand.
resource "aws_s3_bucket_lifecycle_configuration" "app_releases" {
  count = var.enable_github_deploy ? 1 : 0

  bucket = aws_s3_bucket.app.id

  rule {
    id     = "expire-release-artifacts"
    status = "Enabled"
    filter { prefix = "releases/" }
    expiration { days = 30 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}

output "github_deploy_role_arn" {
  description = "Set as the AWS_DEPLOY_ROLE secret in GitHub."
  value       = var.enable_github_deploy ? aws_iam_role.github_deploy[0].arn : null
}

output "deploy_document_name" {
  description = "Set as the SSM_DEPLOY_DOCUMENT variable in GitHub."
  value       = var.enable_github_deploy ? aws_ssm_document.deploy[0].name : null
}

output "deploy_instance_id" {
  description = "Set as the EC2_INSTANCE_ID secret in GitHub."
  value       = aws_instance.api.id
}
