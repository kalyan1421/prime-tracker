# Monitoring and alerting

**Written 2026-09-01**, closing the top item on the infrastructure audit's open list:
*nothing watched the application — only EC2 system-status and billing had alarms, so a
dead API paged no one.*

Everything here lives in [`infra/terraform/monitoring.tf`](../infra/terraform/monitoring.tf).

---

## What was actually wrong

There were two alarms. `prime-tracker-auto-recover` watched the AWS **hypervisor** and
rebuilt the box on hardware failure — but its only action was the recovery, so it told
nobody. `prime-tracker-monthly-billing` watched the bill. Between them they covered
"the physical host died" and "we spent too much".

Not covered: the Node process crashing, pm2 restarting into a crash loop, nginx down,
the TLS certificate expiring, the database refusing connections, the root volume
filling, the box running out of RAM. In other words, **every ordinary outage**. The
first report would have been a person saying the site was down.

There was also a defect that would have defeated a monitor even after one was added:
`GET /api/health/ready` answered **HTTP 200** with a body of `{"status":"degraded"}`
when Postgres was unreachable. Any uptime check keyed on the status code — which is all
of them — would have called a total outage healthy. It now answers **503**, which is
what its own docstring had always claimed, and
[`health.controller.spec.ts`](../apps/api/src/common/health/health.controller.spec.ts)
holds it there.

---

## The four layers

| Layer | Alarm | Fires when | Detects or explains? |
|---|---|---|---|
| **1. Endpoint** | `prime-tracker-api-DOWN` | `/api/health/ready` stops answering `"status":"ok"` over HTTPS | **Detects.** The only one that sees what a user sees. |
| **2. Host** | `auto-recover` | AWS host fault (auto-recovers, and now notifies) | Explains |
| | `instance-status-failed` | Guest OS unhealthy — panic, full disk, dead network stack | Explains |
| | `cpu-credits-low` | t3.micro burst credits nearly gone | Predicts |
| **3. Database** | `rds-storage-low` | < 2 GB free | Predicts a hard stop |
| | `rds-memory-low` | < 128 MB freeable | Predicts |
| | `rds-cpu-high` | > 85% for 15 min | Predicts |
| | `rds-connections-high` | > 40 open (the app pool is capped at 5) | Detects a leak |
| **4. Box internals** | `host-disk-high` | Root volume > 85% of 20 GB | Predicts the most likely death |
| | `host-memory-high` | > 90% of 914 MiB | Predicts an OOM kill |

Layer 1 is the one that matters. The rest tell you *why* after it fires, or warn you
before it does.

### Why layer 1 is an HTTPS string match, not an HTTP ping

Two traps, both of which produce a monitor that stays green through the outage it
exists to catch:

1. **Port 80 answers `301`, and Route 53 counts 3xx as healthy.** A plain HTTP check
   passes on nginx's redirect alone, with the API dead behind it.
2. **The body has to be read.** Even with the 503 fix, asserting `"status":"ok"` in the
   body is the check that survives a future handler that degrades instead of failing.

Route 53 does not validate the certificate chain, so the nip.io host's cert being issued
for another name is not a problem here. Checks come from several AWS regions, so one
region's network trouble cannot page anyone by itself.

**Timing.** 30s interval × 3 consecutive failures for the check to flip, then 2 × 60s
for the alarm: roughly **three minutes** from dead to paged. Deliberately not tighter —
a deploy restarts pm2, and a restart that finishes inside the 90s failure threshold must
not wake anyone.

### Why the CloudWatch agent (layer 4)

EC2 publishes no disk or memory metric; the hypervisor cannot see inside the guest. On a
box with a **20 GB root volume** (pm2 logs, apt cache, git checkout, Docker) and
**914 MiB of RAM** (little enough that `nest build` had to be moved onto the CI runner),
those are the two most likely causes of an outage — and layers 1–3 would only report the
aftermath.

The agent is installed and configured by **SSM Association**, not user-data: user-data
runs once at first boot and this instance predates the file. Associations re-apply on a
schedule, so an agent someone stops comes back on its own.

---

## An alarm that reaches nobody is not monitoring

This is the part that silently fails. `terraform apply` reports success whether or not
anyone is subscribed — the audit found the topic with **zero** subscribers while both
alarms pointed at it.

After any apply, check by hand:

```bash
aws sns list-subscriptions-by-topic --profile prime-client \
  --topic-arn "$(terraform output -raw alarm_topic_arn)" \
  --query 'Subscriptions[].[Protocol,Endpoint,SubscriptionArn]' --output table
```

A `SubscriptionArn` of the literal string **`PendingConfirmation`** means that channel
delivers nothing. Click the link in the confirmation email.

**Email is a mailbox, not a pager.** Set `alarm_sms_number` in `client.tfvars` (E.164,
e.g. `"+919876543210"`) to add SMS. Note that new AWS accounts sit in the **SNS SMS
sandbox**, where messages only reach numbers verified under *SNS → Text messaging →
Sandbox destination phone numbers* — an unverified number is as silent as an unconfirmed
email.

---

## Prove it works

Monitoring is only real once you have seen it fire. Force the alarm:

```bash
aws cloudwatch set-alarm-state --profile prime-client --region us-east-1 \
  --alarm-name prime-tracker-api-DOWN --state-value ALARM \
  --state-reason "drill $(date -u +%FT%TZ)"
```

The notification should arrive within a minute. CloudWatch re-evaluates against real
data on the next period and returns the alarm to OK on its own; no cleanup needed.

Do this after the first apply, and after any change to who is subscribed.

---

## When an alarm fires

**`prime-tracker-api-DOWN`** — the alarm description carries these steps too, because a
runbook nobody can find during an outage is not a runbook.

```bash
aws ssm start-session --profile prime-client --target <instance-id>   # no SSH, no open port
sudo -u ubuntu pm2 list                                              # is prime-api online?
sudo -u ubuntu pm2 logs prime-api --lines 100 --nostream             # why did it stop?
curl -fsS http://127.0.0.1:3001/api/health/ready                     # app, bypassing nginx
sudo nginx -t && sudo systemctl status nginx                         # proxy layer
df -h / && free -m                                                   # the two usual causes
```

Working outward: if `curl` on localhost succeeds but the public check fails, the fault is
nginx, TLS or the security group — not the app.

**`host-disk-high`** — usually `~/.pm2/logs`, `/var/log/nginx`, the apt cache, or old
Docker images. `sudo du -xh / | sort -rh | head -20` finds it.

**`rds-connections-high`** — not traffic. `DATABASE_URL` pins `connection_limit=5`, so
40+ open connections means a leak or orphaned processes.

**`cpu-credits-low`** — the API will get *slow* while every other check still reports it
up. This is the "the site is really slow today" report that otherwise never gets
diagnosed.

---

## Cost

Around **$3.50/month**: the Route 53 health check is ~$2.50 (AWS-endpoint check at
$0.50, plus $1 each for HTTPS and string matching) and the agent's custom metrics ~$1.
Everything else uses metrics AWS already publishes; the first ten alarms and the first
three dashboards are free.

Both paid pieces have a toggle — `enable_endpoint_monitor` and `enable_host_metrics`,
both defaulting **on**. Turning the first off leaves a system that can explain an outage
but not notice one.

---

## Apply

```bash
cd infra/terraform
AWS_PROFILE=prime-client terraform plan -var-file=client.tfvars
AWS_PROFILE=prime-client terraform apply -var-file=client.tfvars
```

Applied 2026-09-01: **15 added, 1 changed, 0 destroyed.** A repeat apply should propose nothing. Anything proposing a *destroy* — most
of all `aws_instance.api` — should stop the apply. See the audit notes in
[`RELEASE_2026-09-01.md`](RELEASE_2026-09-01.md).

> **Trap found while adding this, unrelated to monitoring.** `client.tfvars` did not set
> `enable_github_deploy`, but the deploy pipeline had been applied with `-var` on the
> command line. A plain `apply -var-file=client.tfvars` therefore planned to **destroy
> all six deploy resources** — the OIDC provider, the deploy role and its policies, the
> SSM deploy document and the release-bucket lifecycle rule — silently disarming
> deploys. The variable is now declared in the file. Toggles passed on the command line
> and never written down are landmines: the next apply removes what they built.

---

## Not built, and why

- **Log-based alarms** (nginx 5xx rate, exceptions in the pm2 log). The agent could ship
  those to CloudWatch Logs with a metric filter. Worth doing next — it turns "the API is
  down" into "the API is throwing this". Deliberately not bundled here: it adds ingestion
  cost per GB and a retention decision, and the question on the table was detection.
- **Synthetics canary** — a real browser walking a login. Catches SPA and OAuth breakage
  that a health endpoint cannot, at roughly $10/month. Reconsider once there is a real
  domain and CloudFront in front of the app.
- **Uptime SLO / paging rotation.** There is one person on call, and it is you.
