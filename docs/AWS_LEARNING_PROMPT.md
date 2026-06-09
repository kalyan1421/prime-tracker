# AWS Learning Master Prompt — Prime Developers Stack

> Paste the block below into a fresh Claude session (or any AI) to get a complete,
> project-specific AWS education. Everything is grounded in YOUR actual infrastructure.

---

## ✂️ COPY FROM HERE ↓

---

I'm a developer learning AWS from scratch. I'm building a real estate platform called
**Prime Tracker** for **Prime Developers**. The platform has two apps:

1. **Internal app** — a NestJS API + React SPA used by ~30 employees
2. **Public website** — a Next.js marketing site at theprimedeveloper.com

Both apps will run entirely on AWS. Here is the exact AWS architecture I need to
understand and operate:

```
theprimedeveloper.com  (Route 53 DNS)
          │
          ├──► AWS Amplify Hosting         ← Next.js public website (SSR/SSG)
          │
          ├──► CloudFront + S3             ← React internal app (SPA)
          │
          └──► EC2 t2.micro (Nginx)        ← NestJS API :3001
                    │
                    ├──► Redis (Docker sidecar)   ← BullMQ job queues
                    │
                    ├──► RDS PostgreSQL           ← main database
                    │
                    ├──► S3 (2 buckets)           ← media + documents
                    │
                    └──► SES                      ← email notifications

Supporting services:
  - ACM           → free SSL certificates for all subdomains
  - SSM Parameter Store → encrypted secrets (DB password, JWT keys, AES key)
  - Route 53      → DNS management for theprimedeveloper.com
  - GitHub Actions → CI/CD auto-deploy pipeline
```

Please teach me this entire stack from the ground up using the following structure.
For every service, use my actual project as the example — not generic examples.

---

## TEACHING STRUCTURE I WANT

For EACH AWS service listed below, explain it in this exact format:

### [Service Name]
**What it is in one sentence** (use a real-world analogy — like "EC2 is a computer
you rent by the hour in Amazon's data centre")

**Why MY project uses it** (specific to Prime Tracker / theprimedeveloper.com)

**How it works — step by step** (explain the flow in numbered steps, as if I'm
watching it happen in slow motion)

**How it connects to the other services** (which other AWS services does it talk to,
and how)

**The 3 things that will confuse beginners** (common mistakes, gotchas, things that
look simple but aren't)

**Hands-on mini task** (one specific thing I can do RIGHT NOW in the AWS console to
see it working — under 10 minutes, free tier)

**One AWS docs page I must read** (direct link)

---

## THE SERVICES — TEACH EACH ONE

Teach me these AWS services in this exact order (the order matters — each one
builds on the last):

### GROUP 1 — Foundation (do these first)
1. **AWS Account & IAM** — users, roles, permissions, the root account trap
2. **AWS Regions & Availability Zones** — why I chose us-east-1 and what it means
3. **VPC (Virtual Private Cloud)** — the private network my services live inside
4. **Security Groups** — the firewall rules (especially: only EC2 can reach RDS)

### GROUP 2 — Compute & Networking
5. **EC2 (Elastic Compute Cloud)** — the server running my NestJS API
6. **Elastic IP** — giving EC2 a permanent public IP address
7. **Nginx on EC2** — reverse proxy: how it routes traffic from port 80/443 → 3001
8. **PM2** — keeping the NestJS process alive after crashes and reboots
9. **ACM (Certificate Manager)** — free SSL/HTTPS certificates
10. **Route 53** — DNS: how theprimedeveloper.com resolves to my servers

### GROUP 3 — Database & Cache
11. **RDS (Relational Database Service)** — managed PostgreSQL for my 35-model schema
12. **RDS Security Groups** — why RDS has no public IP and can only be reached from EC2
13. **RDS Automated Backups** — daily snapshots, point-in-time recovery
14. **Redis on EC2 (Docker)** — why I run Redis as a Docker container instead of ElastiCache

### GROUP 4 — Storage
15. **S3 (Simple Storage Service)** — two buckets: public media vs private documents
16. **S3 Bucket Policies** — making project photos public but contracts private
17. **S3 Presigned URLs** — how team members securely download private documents
18. **CloudFront** — CDN that serves my React SPA globally from the nearest edge location
19. **CloudFront + S3 Origin Access Control (OAC)** — S3 private bucket served only through CloudFront

### GROUP 5 — Application Hosting
20. **AWS Amplify Hosting** — how Next.js SSR/SSG runs on Amplify (not the same as S3 static)
21. **Amplify Build Settings (amplify.yml)** — configuring the Next.js build pipeline
22. **ISR (Incremental Static Regeneration) on Amplify** — how project pages auto-refresh when published

### GROUP 6 — Secrets & Config
23. **SSM Parameter Store** — storing encrypted secrets instead of .env files
24. **IAM Roles for EC2** — how EC2 reads SSM parameters without hardcoded credentials
25. **AWS Secrets Manager vs SSM** — when to use each (and why I chose SSM for free tier)

### GROUP 7 — Email & Notifications
26. **SES (Simple Email Service)** — sending lead notification emails from NestJS
27. **SES Domain Verification** — proving I own theprimedeveloper.com to AWS
28. **SES Sandbox vs Production** — why emails only go to verified addresses at first

### GROUP 8 — CI/CD
29. **GitHub Actions** — automated deploy pipeline triggered on every git push to main
30. **IAM User for GitHub Actions** — least-privilege access key for S3 deploy + CloudFront invalidation
31. **SSH Deploy to EC2** — how GitHub Actions SSHs into EC2 and runs the deploy script
32. **CloudFront Cache Invalidation** — forcing CDN to serve new frontend files after deploy

---

## AFTER TEACHING ALL SERVICES

Once you've explained all 32 topics above, give me:

### The Mental Model — How All 32 Services Connect
Draw me a flow diagram (text/ASCII is fine) that shows:
- What happens when a visitor opens theprimedeveloper.com/projects
- What happens when a team member logs into app.theprimedeveloper.com
- What happens when a developer pushes code to GitHub main branch
- What happens when a visitor submits an enquiry form (lead capture flow)

Each flow should name every AWS service touched, in order.

### The 10 AWS Billing Gotchas
List the 10 most common ways developers accidentally run up unexpected AWS bills,
specifically for MY stack. For each one: what causes it, how much it can cost,
and exactly how to prevent it.

### Free Tier Expiry Checklist
My AWS free tier lasts 12 months. 30 days before it expires, what exact steps
should I take to avoid a bill spike? Give me a numbered checklist of actions
in the AWS console.

### The AWS Console Bookmark List
Give me the 10 AWS console pages I will visit most often for this project
(with the direct URLs to each service in us-east-1).

---

## MY BACKGROUND (so you can calibrate)

- I know JavaScript/TypeScript well
- I understand how NestJS and React work
- I have used Docker locally (docker-compose up)
- I have never used AWS before — this is my first time
- I learn best with real examples, not abstract concepts
- I want to understand WHY each thing works, not just HOW to click buttons

---

## IMPORTANT RULES FOR YOUR RESPONSE

- Always use MY project (Prime Tracker / theprimedeveloper.com) as the example
- Never say "imagine you have a web app" — I DO have one, use it
- Use analogies for every new concept (EC2 = a rented computer, S3 = a cloud
  hard drive with a web address, etc.)
- If something costs money outside free tier, say the exact dollar amount
- If I need to do something in a specific order, say "do this BEFORE that"
- Flag anything that is irreversible or could cause data loss with ⚠️

---

## ✂️ COPY TO HERE ↑

---

## How to Use This Prompt

1. Copy everything between the ✂️ markers above
2. Paste into a fresh Claude conversation (or ChatGPT / Gemini)
3. Work through one GROUP at a time — don't try all 32 in one session
4. After each GROUP, do the hands-on mini tasks in the AWS console
5. Come back with questions on anything that's unclear

## Suggested Learning Order (by day)

| Day | Groups | Focus |
|-----|--------|-------|
| Day 1 | 1 | AWS account setup, IAM, VPC, Security Groups — the boring-but-critical foundations |
| Day 2 | 2 | Launch EC2, SSH in, install Node + Nginx + PM2, point the API domain |
| Day 3 | 3 | Create RDS, connect from EC2, run Prisma migrate deploy |
| Day 4 | 4 | Create S3 buckets, test upload/download, set up CloudFront for the React app |
| Day 5 | 5 | Connect GitHub to Amplify, deploy the Next.js site, test ISR |
| Day 6 | 6 | Move all secrets to SSM, update EC2 startup to fetch from SSM |
| Day 7 | 7 | Verify SES domain, test lead email end-to-end, move out of SES sandbox |
| Day 8 | 8 | Set up GitHub Actions CI/CD for all three deploy targets |

## Free Resources Referenced in the Prompt

| Resource | Link |
|---|---|
| AWS Free Tier details | https://aws.amazon.com/free/ |
| AWS Well-Architected Framework | https://aws.amazon.com/architecture/well-architected/ |
| EC2 Getting Started | https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EC2_GetStarted.html |
| RDS PostgreSQL Guide | https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_GettingStarted.CreatingConnecting.PostgreSQL.html |
| S3 User Guide | https://docs.aws.amazon.com/AmazonS3/latest/userguide/GetStartedWithS3.html |
| CloudFront Getting Started | https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/GettingStarted.html |
| Amplify Hosting Docs | https://docs.aws.amazon.com/amplify/latest/userguide/getting-started.html |
| SES Getting Started | https://docs.aws.amazon.com/ses/latest/dg/setting-up.html |
| SSM Parameter Store | https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html |
| Route 53 Getting Started | https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/getting-started.html |
| IAM Getting Started | https://docs.aws.amazon.com/IAM/latest/UserGuide/getting-started.html |
| GitHub Actions + AWS | https://github.com/aws-actions/configure-aws-credentials |

## Quick Terminology Cheat Sheet

| AWS Term | Plain English |
|---|---|
| EC2 | A computer you rent by the hour in Amazon's data centre |
| RDS | A managed database — Amazon handles backups, patches, restarts |
| S3 | A cloud hard drive where every file has its own web address |
| CloudFront | A global CDN — serves your files from the nearest city to the user |
| Amplify | Managed hosting for modern web frameworks (Next.js, React, etc.) |
| SES | Amazon's bulk email sending service |
| SSM Parameter Store | A secure vault for passwords and API keys |
| IAM | The access control system — who can do what in your AWS account |
| VPC | Your private network inside AWS — like your own office LAN |
| Security Group | A firewall rule attached to a specific server or database |
| ACM | Free SSL certificate manager — issues and auto-renews HTTPS certs |
| Route 53 | Amazon's DNS service — maps domain names to IP addresses |
| Elastic IP | A permanent public IP address for your EC2 instance |
| Availability Zone | A physically separate data centre within a region |
| Region | A geographic area (us-east-1 = Northern Virginia) |
| Free Tier | 12 months of limited free usage when you create a new AWS account |
