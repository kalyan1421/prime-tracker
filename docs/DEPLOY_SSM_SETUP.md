# Keyless deploys over SSM — setup and runbook

Written 2026-09-01. Replaces the scp/ssh deploy job, which **could never have worked** —
see §1.

Two properties, both deliberate:

- **No port 22.** The runner never connects to the box. It puts the build in S3 and asks
  SSM to run a document; the agent already on the instance pulls the artifact and releases
  it. Traffic goes *outward* from the box, so there is no inbound path to leave open.
- **No stored AWS keys.** GitHub mints a short-lived OIDC token per run and AWS trades it
  for a session, scoped in IAM to this repository's `production` environment — which in
  turn only `main` may deploy to. There is no long-lived credential to leak, rotate, or
  find in a screenshot.

---

## 1. Why the old deploy could not have worked

`security.tf` allowed port 22 from `var.admin_cidr` — a **single** address
(`49.43.218.254/32`, a home IP). GitHub's hosted runners get a different, unpredictable IP
every run. So `appleboy/scp-action` would have opened a TCP connection to a security group
that drops it, and the job would have sat there until `command_timeout: 20m` expired.

This was never observed because `vars.DEPLOY_ENABLED` was never set: across 30+ pushes to
`main` the deploy job reported `skipped`, so the connection was never attempted. Setting
the secrets alone would have turned a silently-skipped job into a silently-hanging one.

The obvious fix — widen the SSH rule to GitHub's published ranges — means thousands of
addresses, re-published without notice, on the one port that grants a shell. SSM removes
the question instead of answering it.

---

## 2. What Terraform creates

All of it in `infra/terraform/github-deploy.tf`, behind `enable_github_deploy`.

| Resource | Purpose |
|---|---|
| `aws_iam_openid_connect_provider.github` | Trusts GitHub's OIDC issuer. **One per account** — import if it already exists (§6) |
| `aws_iam_role.github_deploy` | What the runner assumes. Trust policy pins `repo:<owner>/<repo>:environment:production` — **not** the ref form, see §9 |
| `aws_iam_role_policy.github_deploy` | `s3:PutObject` on `releases/*` only; `ssm:SendCommand` on **this document and this instance only**; read command results |
| `aws_ssm_document.deploy` | The release script itself |
| `aws_iam_role_policy.ec2_read_releases` | Lets the instance read the artifact it is told to fetch |
| `aws_s3_bucket_lifecycle_configuration.app_releases` | Expires build artifacts after 30 days |

**Why a document rather than `AWS-RunShellScript`:** the role can then be allowed to run
*this script* and nothing else. Granting `SendCommand` on `AWS-RunShellScript` is granting
"execute arbitrary commands as root on the instance", which is a much larger thing to hand
a CI system. The document's parameters are `allowedPattern`-anchored for the same reason —
they are interpolated into a command that runs as root.

The instance role **already** carried `AmazonSSMManagedInstanceCore` (`iam.tf`), so Session
Manager and RunCommand were available before any of this; nothing was using them.

---

## 3. Apply it

```bash
cd infra/terraform
terraform workspace select client
aws sso login --profile prime-client

terraform apply -var-file=client.tfvars -var=enable_github_deploy=true
```

Then read the three values you need:

```bash
terraform output github_deploy_role_arn   # → AWS_DEPLOY_ROLE
terraform output deploy_instance_id       # → EC2_INSTANCE_ID
terraform output deploy_document_name     # → SSM_DEPLOY_DOCUMENT
```

---

## 4. GitHub → Settings → Secrets and variables → Actions

**Environments** — create one named exactly `production` (Settings → Environments). The
job declares `environment: production`; without it the job errors.

Set its **deployment branch policy to `main` only**. This is not optional hardening: the
IAM trust policy keys on `environment:production`, so the branch restriction lives here and
nowhere else. Without it, a workflow on any branch could deploy to production.

Add a required reviewer here too if you want every production deploy to need a human click
— there is none by default, so a merge to `main` ships straight to the client's server.

**Secrets** (2):

| Name | Value |
|---|---|
| `AWS_DEPLOY_ROLE` | `arn:aws:iam::056836825737:role/prime-tracker-github-deploy` |
| `EC2_INSTANCE_ID` | `i-…` from `terraform output deploy_instance_id` |

**Variables** (up to 4 — set `DEPLOY_ENABLED` **last**):

| Name | Value | Required? |
|---|---|---|
| `APP_BUCKET` | `prime-tracker-app-056836825737` | yes |
| `AWS_REGION` | `us-east-1` | no — defaults to this |
| `SSM_DEPLOY_DOCUMENT` | `prime-tracker-deploy` | no — defaults to this |
| `DEPLOY_ENABLED` | `true` | yes, **and last** |

`DEPLOY_ENABLED=true` is the arming switch: the moment it is set, the next push to `main`
goes to production.

### No longer needed

`EC2_HOST`, `EC2_SSH_KEY` and `GH_DEPLOY_TOKEN` are all gone. The runner does not connect
to the host, so it needs neither its address nor a key; and the repository is public, so
the box's `git fetch` needs no token. **If this repo is ever made private, that last
assumption breaks** — the `git remote set-url` line in the document is what has to change.

---

## 5. Port 22 — closed 2026-09-01

**Already done.** The security group now allows only 80 and 443. Verified after the change:
port 22 unreachable, a root shell over SSM still works, `/api/health` still 200.

`enable_ssh` now defaults to `false`. To re-open temporarily:

```bash
terraform apply -var-file=client.tfvars \
  -var=enable_github_deploy=true -var=enable_ssh=true
```

Shell access without it — note this needs `session-manager-plugin` installed locally
(`brew install --cask session-manager-plugin`); `ssm send-command` works without it:

```bash
aws ssm start-session --target i-… --region us-east-1 --profile prime-client
```

Worth noting that `admin_cidr` was a liability rather than a safeguard: it is one fixed
home IP, so it stops working the moment the ISP reassigns it, and the fix under pressure is
always to widen it.

---

## 6. If the OIDC provider already exists

AWS permits one provider per URL per account. If `token.actions.githubusercontent.com` is
already registered, `apply` fails with `EntityAlreadyExists`. Import it instead:

```bash
terraform import -var-file=client.tfvars \
  'aws_iam_openid_connect_provider.github[0]' \
  arn:aws:iam::056836825737:oidc-provider/token.actions.githubusercontent.com
```

---

## 7. Verify before arming

**Verified live 2026-09-01** against account `056836825737`. Results at the time:

| Check | Result |
|---|---|
| SSM agent | `i-0412241c8f6d080a1` · **Online** · agent `3.3.4793.0` · Ubuntu |
| OIDC assume from Actions | works (after the `sub` fix — see §9) |
| Artifact upload | `s3://prime-tracker-app-056836825737/releases/<sha>.tgz` |
| SSM document run | `Success`, migrations + pm2 restart + health check |
| API after deploy | `/api/health` → 200 |
| New routes live | `stage-library` → 401 (exists); unknown route → 404 |
| Root shell via RunCommand | works |

The commands below are how those were obtained; re-run them after any infra change.

```bash
aws sso login --profile prime-client
export AWS_PROFILE=prime-client AWS_REGION=us-east-1

# 1. Is the instance registered with SSM? Expect PingStatus=Online.
#    If it is missing entirely, the agent is not running or has no egress.
aws ssm describe-instance-information \
  --query "InstanceInformationList[].{Id:InstanceId,Ping:PingStatus,Agent:AgentVersion}"

# 2. Does the document exist and run? Harmless read-only probe.
aws ssm send-command --document-name AWS-RunShellScript \
  --instance-ids i-… --parameters 'commands=["whoami","node -v","pnpm -v","pm2 -v","aws --version"]' \
  --query Command.CommandId --output text
aws ssm get-command-invocation --command-id <id> --instance-id i-… \
  --query StandardOutputContent --output text
```

Expect `root`, Node 22, pnpm 10, a pm2 version, and AWS CLI v2. The document runs as root
and drops to `ubuntu` for the build steps — a root-owned tree is what previously broke
git's reflog write and Prisma's engine cache (`EPERM` on utime) on the *next* deploy.

---

## 8. What the deploy does

1. **Runner** builds shared + API + web, tars the output, uploads to
   `s3://<app-bucket>/releases/<sha>.tgz`.
   The box cannot build: on a t3.micro (914 MiB) `nest build` dies with a V8 heap OOM
   (SIGABRT, exit 134). Raising `--max-old-space-size` only trades the crash for
   swap-thrashing a host that is also serving live traffic.
2. **Runner** calls `ssm send-command` with the artifact URL and the commit SHA, then
   **polls until the command finishes**. `send-command` returns as soon as the command is
   *accepted*, so without the poll the job would go green on a deploy that had not run.
3. **Box** resets its checkout to `origin/main`, installs runtime deps, `prisma generate`,
   downloads and unpacks the artifact, writes `apps/api/.env` from SSM Parameter Store,
   runs `prisma migrate deploy`, restarts pm2, publishes the SPA for nginx.
4. **Box** polls `/api/health` for 60s and **fails the deploy if the API does not come
   back** — otherwise a process that restarts straight into a crash loop reports success.
5. **Runner** prints the box's stdout and stderr even when the job fails. A red job with
   no log is a red job nobody can act on.

### Rollback

Artifacts are kept 30 days and keyed by commit, so a rollback is the same command with an
older SHA:

```bash
aws ssm send-command --document-name prime-tracker-deploy --instance-ids i-… \
  --parameters ArtifactUrl=s3://prime-tracker-app-056836825737/releases/<old-sha>.tgz,GitSha=<old-sha>
```

Note this does **not** roll back migrations — Prisma has no down-migrations here. A release
containing a destructive migration is not rollback-safe by this route.

---

## 9. Two things that failed on the way in

Both cost a real failed deploy, and both are the kind of thing that reads as obvious only
afterwards.

**The OIDC subject is environment-scoped, not ref-scoped.** The natural trust condition is
`repo:OWNER/REPO:ref:refs/heads/main`. It is wrong for any job that declares
`environment:` — GitHub then issues the subject as `repo:OWNER/REPO:environment:NAME`, and
the assume fails with `Not authorized to perform sts:AssumeRoleWithWebIdentity`, which names
neither claim. The branch restriction moves to the environment's deployment branch policy
(set to `main` only); the two are a pair, and removing that policy would let any branch
deploy.

**SSM runs the script with `/bin/sh`, not bash.** `aws:runShellScript` writes `_script.sh`
and executes it with dash on Ubuntu, so a top-level `set -euo pipefail` dies at line 1 with
`Illegal option -o pipefail` before anything runs. Keep the top level POSIX; the `sudo … bash`
heredoc is where bashisms belong. Note that checking the extracted script with `bash -n`
proves nothing here — bash accepts the bashism — and `sh -n` does not catch it either, since
`set` is a runtime builtin rather than syntax. Grep for it.

---

## 10. Known limits

- **Migrations are not transactional across the deploy.** `prisma migrate deploy` runs
  before the restart; a migration that succeeds followed by an app that fails health check
  leaves the database ahead of the running code.
- **Single instance, no draining.** pm2 restart is a brief hard cut. There is no ALB and no
  second instance, so a deploy is a few seconds of downtime.
- **The SPA is copied over the top, not `--delete`d.** Vite fingerprints asset filenames so
  stale files are inert, and a half-finished delete would take the site down. The trade is
  that `/var/www/prime-web` grows over time.
- **`git fetch` assumes a public repo.** See §4.
