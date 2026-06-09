# Prime Developers — AWS Migration + Public Website Integration Plan

> **Date:** 2026-06-09  
> **Scope:** Codebase audit · AWS free-tier migration · Public website (SOW) integration  
> **Apps in scope:** `prime-tracker` (internal) + `theprimedeveloper.com` (public Next.js site)

---

## Table of Contents

1. [Codebase Audit — Code Review Findings](#1-codebase-audit)
2. [What Exists vs What Still Needs Building](#2-current-state-inventory)
3. [AWS Migration Plan — Max Free Tier](#3-aws-migration-plan)
4. [Public Website Architecture (SOW)](#4-public-website-architecture)
5. [Connecting Both Apps — Integration Design](#5-integration-design)
6. [Prime Tracker Features That Power the Public Website](#6-feature-mapping)
7. [Schema Changes Required](#7-schema-changes)
8. [New Public API Endpoints to Build](#8-public-api-endpoints)
9. [Deployment Checklist](#9-deployment-checklist)
10. [Estimated Monthly AWS Cost](#10-cost-estimate)

---

## 1. Codebase Audit

### 1.1 Critical Issues 🔴

| # | File / Area | Issue | Fix |
|---|---|---|---|
| 1 | `.github/workflows/` | **No CI/CD pipeline configured** — empty directory, all deploys are manual | Add GitHub Actions (see §9) |
| 2 | `apps/api/prisma/migrations/20260608000000_*` | Migration file has **local uncommitted edits** (shown in `git status`). Deploying without applying will leave schema out of sync | Run `npx prisma migrate deploy` before any deploy |
| 3 | `apps/api/.env` | **AES-256-GCM encryption key** (`ENCRYPTION_KEY`) has no rotation mechanism — if exposed, all loan sensitive fields are permanently compromised | Add key versioning; store in AWS Secrets Manager |
| 4 | `apps/api/src/` | **No startup env validation** — missing required vars silently become `undefined` and crash at runtime, not boot time | Add `Joi` schema validation in `ConfigModule.forRoot()` |

### 1.2 High Priority Issues 🟠

| # | Area | Issue | Fix |
|---|---|---|---|
| 5 | Render Redis | Free tier is **25MB** — BullMQ notification jobs will silently fail once queue fills | Move Redis to EC2 sidecar or Upstash free tier (10k cmds/day) |
| 6 | `apps/api/src/app.module.ts` | **ThrottlerModule** applies globally but rate limits are generous (1000/15min) — form submission endpoints (leads, contact) need tighter per-IP limits | Add `@Throttle(5, 60)` on `LeadsController.create()` and public endpoints |
| 7 | `apps/api/src/modules/` | **QuickBooks OAuth** is in production code but untested against live credentials — can throw 401s that break `ContractsModule` | Guard behind feature flag `QB_ENABLED=false` until verified |
| 8 | CORS config | `CORS_ORIGINS` is a single env string — adding the public website origin requires string parsing, not proper array splitting | Split on comma: `origins: process.env.CORS_ORIGINS?.split(',')` |

### 1.3 Medium Issues 🟡

| # | Area | Issue | Fix |
|---|---|---|---|
| 9 | Prisma | No `connection_limit` in `DATABASE_URL` — Prisma default pool (10) will exhaust RDS free tier (max ~25 connections) | Add `?connection_limit=5&pool_timeout=10` to DATABASE_URL |
| 10 | Documents module | Supabase storage used for file uploads with no fallback — if Supabase is down, all uploads fail silently | Migrate to S3 (see §3) — single storage provider |
| 11 | Logging | `console.log` in production — no structured JSON logs, making CloudWatch queries impossible | Add Pino logger (`nestjs-pino`) with JSON output |
| 12 | `apps/web/src/` | No error boundary at route level — API errors in one tab crash the whole layout | Wrap each tab content in `<ErrorBoundary>` |

### 1.4 What Looks Good ✅

- JWT refresh + rotation correctly implemented with `RefreshToken` table
- TOTP MFA enforced for FINANCE/FOUNDER roles via `MfaBanner`
- `AuditInterceptor` on every API route — immutable log
- `Helmet` + `express-rate-limit` on API
- Soft deletes on `Project` and `Unit` (`deletedAt`)
- BullMQ for async notification processing (correct pattern)
- Prisma cycle-check on `Milestone.dependsOnId` (DAG)
- `isClientVisible` flag on `Document` — ready for buyer portal

---

## 2. Current State Inventory

### What Is Built (Prime Tracker Internal App)

| Module | Status | Notes |
|---|---|---|
| Auth (JWT + Google OAuth + MFA) | ✅ Built | Works |
| Projects CRUD | ✅ Built | Missing `isPublished`, `slug` for public website |
| Buildings + Units | ✅ Built | Full hierarchy |
| Budget Lines + Revisions | ✅ Built | Append-only history |
| Milestones + Dependencies | ✅ Built | DAG with photos |
| Loans + Draw Requests | ✅ Built | Multi-step approvals |
| Sales Pipeline | ✅ Built | Status auto-flips unit |
| Leads + Activities | ✅ Built | `WEBSITE` source enum already exists |
| Campaigns + Attribution | ✅ Built | UTM tracking |
| Leases + Rent Roll | ✅ Built | |
| Documents + Versioning | ✅ Built | `isClientVisible` flag exists |
| Investors + Capital Calls | ✅ Built | |
| Tasks + Comments | ✅ Built | |
| Cashflow Forecast | ✅ Built | Phase C complete |
| Interior / Fit-Out | ✅ Built | New module |
| Daily Construction Logs | ✅ Built | New module |
| Brokers + Commissions | ✅ Built | New module |
| Approved Budget Control Total | ✅ Built | Migration pending apply |
| KPI Snapshots | ✅ Built | Powers homepage stats |
| Reports (portfolio/sales/revenue) | ✅ Built | |
| QuickBooks Sync | ⚠️ Code exists | Untested against live creds |
| **Public API namespace** | ❌ Not built | Needed for website |
| **Project `isPublished` / `slug`** | ❌ Not built | Needed for website |
| **Amenities field on Project** | ❌ Not built | Needed for website detail page |
| **WhatsApp notification channel** | ❌ Not built | SOW requirement |
| **Lead export CSV** | ❌ Not built | SOW admin panel requirement |

### What the SOW Public Website Needs (New Build)

| Page / Feature | Status | Data Source |
|---|---|---|
| Homepage hero + stats bar | ❌ New build | `KpiSnapshot` API |
| Projects filterable grid | ❌ New build | `Project` (published) |
| Project detail page + gallery | ❌ New build | `Project` + `Document` |
| About Us page | ❌ New build | Static content |
| Contact page + form | ❌ New build | `Lead` model |
| Admin CMS (projects/media/leads) | ❌ New build | Internal API — DIFFERENT from Prime Tracker admin |
| WhatsApp floating widget | ❌ New build | Config in Settings |
| Lead export CSV | ❌ New build | `Lead` model |
| Brochure download (gated/open) | ❌ New build | `Document` model |

---

## 3. AWS Migration Plan

### 3.1 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        AWS Account                           │
│                                                             │
│  ┌─────────────────┐    ┌──────────────────────────────┐   │
│  │  Public Website  │    │   Prime Tracker Internal App  │   │
│  │  (Next.js SSR)  │    │   (NestJS API + React SPA)   │   │
│  │                 │    │                              │   │
│  │  AWS Amplify    │    │  EC2 t2.micro (free tier)    │   │
│  │  Hosting        │◄───┤  ├── NestJS API :3001        │   │
│  │  (free tier)    │    │  ├── Redis :6379 (Docker)    │   │
│  └────────┬────────┘    │  └── Nginx reverse proxy     │   │
│           │             └──────────────┬───────────────┘   │
│           │                            │                    │
│           ▼                            ▼                    │
│  ┌─────────────────┐    ┌──────────────────────────────┐   │
│  │   CloudFront    │    │   RDS PostgreSQL              │   │
│  │   (CDN / SSL)   │    │   db.t3.micro (free tier)    │   │
│  └────────┬────────┘    │   prime_tracker DB           │   │
│           │             └──────────────────────────────┘   │
│           ▼                                                  │
│  ┌─────────────────┐    ┌──────────────────────────────┐   │
│  │   S3 Bucket     │    │   S3 Bucket                  │   │
│  │   (static       │    │   (documents / media /       │   │
│  │    assets)      │    │    brochures / photos)       │   │
│  └─────────────────┘    └──────────────────────────────┘   │
│                                                             │
│  ┌─────────────────┐    ┌──────────────────────────────┐   │
│  │   SES            │    │   Secrets Manager            │   │
│  │   (email)        │    │   (AES key, JWT secret,      │   │
│  │   free from EC2  │    │    DB password, QB creds)    │   │
│  └─────────────────┘    └──────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │   Route 53: theprimedeveloper.com                   │   │
│  │   ACM: Free SSL certificate                         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Service-by-Service Migration

#### 3.2.1 Database — AWS RDS PostgreSQL

| Item | Detail |
|---|---|
| **AWS Service** | RDS PostgreSQL 15 |
| **Free Tier** | `db.t3.micro` · 20GB SSD · 750hrs/month (12 months) |
| **After free tier** | ~$15/month |
| **Region** | `us-east-1` (cheapest) |
| **Migration from** | Local Docker / Supabase pooler |

**Steps:**
```bash
# 1. Create RDS instance (single-AZ, no Multi-AZ — saves cost)
# AWS Console → RDS → Create Database
# Engine: PostgreSQL 15
# Template: Free tier
# DB instance: db.t3.micro
# Storage: 20GB gp2
# Public access: No (access via EC2 only)
# VPC security group: allow 5432 from EC2 security group only

# 2. Update DATABASE_URL in Secrets Manager
DATABASE_URL="postgresql://prime:PASSWORD@rds-endpoint:5432/prime_tracker?connection_limit=5&pool_timeout=10"

# 3. Run migrations from EC2
npx prisma migrate deploy

# 4. Run seeds (one-time)
pnpm run db:seed
```

**Important:** Add `?connection_limit=5` — RDS t3.micro allows ~25 connections; Prisma default pool is 10 per instance, 2 instances = 20, leaves no headroom.

---

#### 3.2.2 API Server — AWS EC2

| Item | Detail |
|---|---|
| **AWS Service** | EC2 `t2.micro` |
| **Free Tier** | 750hrs/month · 1 vCPU · 1GB RAM · 12 months |
| **After free tier** | ~$8.50/month (`t3.micro` reserved = ~$5/month) |
| **OS** | Ubuntu 22.04 LTS |
| **Runs** | NestJS API + Redis (Docker) + Nginx |

**EC2 Setup:**
```bash
# On EC2 instance (Ubuntu 22.04)
# Install Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
npm install -g pnpm@10

# Install Docker (for Redis sidecar)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu

# Install PM2 for process management
npm install -g pm2

# Start Redis via Docker
docker run -d --name redis -p 6379:6379 --restart always redis:7-alpine

# Install Nginx
sudo apt install nginx -y

# Clone repo and build
git clone https://github.com/YOUR_ORG/prime-tracker.git
cd prime-tracker
pnpm install
pnpm run build

# Start with PM2
pm2 start apps/api/dist/main.js --name prime-api
pm2 save
pm2 startup
```

**Nginx config** (`/etc/nginx/sites-available/prime-api`):
```nginx
server {
    listen 80;
    server_name api.theprimedeveloper.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# SSL via ACM + ALB (recommended) or Let's Encrypt (free)
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d api.theprimedeveloper.com
```

---

#### 3.2.3 Redis — EC2 Docker Sidecar (Free)

| Item | Detail |
|---|---|
| **Approach** | Redis 7 Alpine in Docker on same EC2 instance |
| **Cost** | Free (included in EC2 instance) |
| **Alternative** | Upstash Redis free tier (10k commands/day) — use for staging |

```bash
docker run -d \
  --name redis \
  -p 127.0.0.1:6379:6379 \
  --restart always \
  -v redis_data:/data \
  redis:7-alpine \
  redis-server --save 60 1 --loglevel warning
```

Update `REDIS_URL=redis://localhost:6379` in env.

---

#### 3.2.4 React Frontend (Internal App) — S3 + CloudFront

| Item | Detail |
|---|---|
| **AWS Service** | S3 (static hosting) + CloudFront |
| **Free Tier** | S3: 5GB + 20k GET + 2k PUT · CloudFront: 1TB transfer + 10M requests |
| **After free tier** | ~$1-3/month |
| **URL** | `app.theprimedeveloper.com` |

```bash
# Build
pnpm run build  # outputs apps/web/dist/

# Create S3 bucket
# AWS Console → S3 → Create bucket
# Name: prime-tracker-app
# Block all public access: YES (CloudFront only)
# Enable static website hosting: NO (use CloudFront OAC instead)

# Deploy via GitHub Actions (see §9)
aws s3 sync apps/web/dist/ s3://prime-tracker-app/ --delete

# CloudFront distribution settings:
# Origin: S3 bucket (with Origin Access Control)
# Default root object: index.html
# Error pages: 403 → /index.html (SPA routing)
# SSL: ACM certificate for app.theprimedeveloper.com
# Price class: PriceClass_100 (US/Europe only — cheapest)
```

---

#### 3.2.5 Public Website (Next.js) — AWS Amplify Hosting

| Item | Detail |
|---|---|
| **AWS Service** | AWS Amplify Hosting |
| **Free Tier** | 5GB storage · 15GB serving/month · 1000 build minutes/month |
| **After free tier** | ~$0.01/GB served (very cheap) |
| **Why Amplify over EC2** | SSR/SSG support built-in; auto HTTPS; instant cache invalidation; zero ops |
| **URL** | `theprimedeveloper.com` |

```bash
# Connect GitHub repo in AWS Amplify Console
# Branch: main → auto-deploy
# Build settings (amplify.yml):
```

```yaml
# amplify.yml (in website repo root)
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: .next
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
      - .next/cache/**/*
```

**Why NOT EC2 for Next.js:** SSR on a t2.micro with 1GB RAM alongside Redis will cause OOM kills. Amplify handles SSR in managed Lambda — zero cold-start cost on free tier.

---

#### 3.2.6 File Storage — AWS S3

| Item | Detail |
|---|---|
| **Replaces** | Supabase Storage |
| **Buckets** | `prime-tracker-documents` (private) + `prime-tracker-media` (public read) |
| **Free Tier** | 5GB storage total |
| **After free tier** | ~$0.023/GB/month |

```bash
# private bucket for documents (presigned URL access)
# Bucket: prime-tracker-documents
# Block all public access: YES
# Versioning: enabled (for DocumentVersion model)

# public bucket for project photos/brochures visible on website  
# Bucket: prime-tracker-media
# Block all public access: NO
# Bucket policy: Allow s3:GetObject for *

# Update documents.service.ts:
# Replace supabase.storage.from(...).upload() 
# with @aws-sdk/client-s3 + PutObjectCommand + GetSignedUrlCommand
```

**Update env:**
```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
S3_DOCUMENTS_BUCKET=prime-tracker-documents
S3_MEDIA_BUCKET=prime-tracker-media
```

---

#### 3.2.7 Email — AWS SES

| Item | Detail |
|---|---|
| **Replaces** | Nodemailer + SMTP |
| **Free Tier** | 62,000 emails/month when sent from EC2 |
| **After free tier** | $0.10 per 1,000 emails |
| **Setup** | Verify `noreply@theprimedeveloper.com` domain in SES |

```bash
# In apps/api — replace nodemailer SMTP transport
npm install @aws-sdk/client-ses
```

```typescript
// notifications.service.ts — SES transport
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({ region: 'us-east-1' });
await ses.send(new SendEmailCommand({
  Source: 'PrimeTracker <noreply@theprimedeveloper.com>',
  Destination: { ToAddresses: [to] },
  Message: {
    Subject: { Data: subject },
    Body: { Html: { Data: html } },
  },
}));
```

---

#### 3.2.8 Secrets — AWS Secrets Manager

| Item | Detail |
|---|---|
| **Store** | AES encryption key · JWT secrets · DB password · QB OAuth · Google OAuth |
| **Free Tier** | 30-day trial; $0.40/secret/month after |
| **Cost** | ~$3/month for 7-8 secrets |
| **Alternative (free)** | AWS Systems Manager Parameter Store (SSM) — free for standard parameters |

**Recommendation: Use SSM Parameter Store (free):**
```bash
# Store secrets
aws ssm put-parameter --name /prime-tracker/prod/DATABASE_URL \
  --value "postgresql://..." --type SecureString
aws ssm put-parameter --name /prime-tracker/prod/JWT_SECRET \
  --value "..." --type SecureString
aws ssm put-parameter --name /prime-tracker/prod/ENCRYPTION_KEY \
  --value "..." --type SecureString

# Fetch in EC2 startup script
export DATABASE_URL=$(aws ssm get-parameter --name /prime-tracker/prod/DATABASE_URL \
  --with-decryption --query Parameter.Value --output text)
```

---

#### 3.2.9 DNS + SSL — Route 53 + ACM

| Item | Detail |
|---|---|
| **Route 53** | $0.50/hosted zone/month = ~$6/year |
| **ACM (SSL)** | Free — unlimited certificates |
| **Records needed** | `theprimedeveloper.com` → Amplify · `app.theprimedeveloper.com` → CloudFront · `api.theprimedeveloper.com` → EC2 ALB |

---

## 4. Public Website Architecture

> Built as a **separate repo** `prime-website` — Next.js 14, Tailwind CSS v3, connects to Prime Tracker API.

### 4.1 Page Structure (from SOW)

```
theprimedeveloper.com/
├── /                        Homepage — hero, stats, projects carousel, testimonials
├── /projects                Filterable grid — Location / Type / Status
├── /projects/[slug]         Project detail — gallery, specs, map, brochure, CTAs
├── /about                   Company story, team, milestones
├── /contact                 Contact form, map, WhatsApp
├── /privacy                 Legal
└── /admin/*                 Admin CMS (auth-protected)
    ├── /admin/dashboard     KPIs: leads today, projects, visitor stats
    ├── /admin/projects      Create/edit/publish projects
    ├── /admin/media         Upload images, PDFs per project
    ├── /admin/leads         View/filter/export leads
    └── /admin/settings      Contact info, WhatsApp number, SMTP
```

### 4.2 Tech Stack (from SOW)

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 14 (App Router) | SSG for projects, ISR for stats |
| Styling | Tailwind CSS v3 | Match existing Prime Tracker dark-gold brand |
| CMS Auth | JWT + bcrypt | Separate from internal app auth |
| Database | **Shared** with Prime Tracker | Same RDS instance, separate schema tables |
| ORM | Prisma (shared schema file) | Add `@@schema("public_website")` namespace |
| API | Prime Tracker `/api/public/*` | New public namespace (see §8) |
| Media | AWS S3 `prime-tracker-media` bucket | Public-read CDN via CloudFront |
| Email | AWS SES | Lead notifications to admin |
| Maps | Google Maps Embed API | Project location |

### 4.3 Rendering Strategy

| Page | Strategy | Reason |
|---|---|---|
| Homepage | ISR (60s revalidate) | Stats update frequently |
| `/projects` | ISR (300s revalidate) | Project list changes infrequently |
| `/projects/[slug]` | ISR (300s revalidate) + fallback:true | SEO critical; update on publish |
| `/about`, `/contact`, `/privacy` | SSG | Static content |
| `/admin/*` | Client-side only | Auth-protected, no SEO needed |

---

## 5. Integration Design

### 5.1 How the Two Apps Connect

```
Public Website (Next.js)            Prime Tracker (NestJS API)
theprimedeveloper.com               api.theprimedeveloper.com
        │                                       │
        │  GET /api/public/projects             │
        ├──────────────────────────────────────►│
        │  ← [{id, slug, name, status, ...}]    │
        │                                       │
        │  GET /api/public/projects/:slug        │
        ├──────────────────────────────────────►│
        │  ← {project, buildings, docs, ...}    │
        │                                       │
        │  GET /api/public/stats                │
        ├──────────────────────────────────────►│
        │  ← {totalProjects, totalUnits, ...}   │
        │                                       │
        │  POST /api/public/leads               │
        ├──────────────────────────────────────►│
        │  body: {name, phone, email,            │
        │         projectId, source:'WEBSITE'}   │
        │  ← {id, ...} + email notification     │
        │                                       │
        │  GET /api/public/projects/:id/docs    │
        ├──────────────────────────────────────►│
        │  ← brochures/floorplans (public docs) │
```

### 5.2 Authentication Boundary

| Endpoint type | Auth required | Notes |
|---|---|---|
| `GET /api/public/*` | ❌ None (public) | Read-only; published content only |
| `POST /api/public/leads` | ❌ None (public) | Rate-limited: 5 req/min/IP + reCAPTCHA |
| `GET /api/*` (internal) | ✅ JWT | No change to existing app |
| `POST /admin/*` (website admin CMS) | ✅ Admin JWT | Separate simple auth from Prime Tracker RBAC |

### 5.3 Lead Flow (End-to-End)

```
Visitor fills enquiry form on /projects/[slug]
        │
        ▼
POST /api/public/leads
  { name, phone, email, projectId, source: 'WEBSITE', 
    utm_source, utm_medium, utm_campaign }
        │
        ▼
Prime Tracker LeadsService.create()
  → Inserts Lead row (status: NEW, source: WEBSITE)
  → Sends email via SES to admin
  → Sends acknowledgment email to prospect
  → Creates LeadActivity (type: NOTE, "Lead submitted via website")
        │
        ▼
Lead appears in Prime Tracker /leads page
  → Sales team picks it up
  → Full activity timeline: CALL, EMAIL, SITE_VISIT etc.
  → Can convert to Sale
        │
        ▼
Also appears in /admin/leads on PUBLIC WEBSITE admin
  → Export to CSV
  → Status: New → Contacted → Qualified → Lost
```

### 5.4 Project Publish Flow

```
Internal user in Prime Tracker
        │
        ▼
ProjectDetailPage → Overview Tab
  → Toggle "Published on Website" (isPublished: true)
  → Fill: slug, heroImageUrl, amenities[], metaDescription
  → Upload brochure → Document (category: BROCHURE, isClientVisible: true)
        │
        ▼
Next.js website revalidates /projects and /projects/[slug]
  (ISR: On-demand revalidation via webhook OR 5-min TTL)
        │
        ▼
Project appears on theprimedeveloper.com/projects
```

---

## 6. Feature Mapping

### What Prime Tracker Data Powers on the Public Website

| Public Website Feature | Prime Tracker Data Source | Notes |
|---|---|---|
| **Homepage — Stats Bar** | `KpiSnapshot` (latest) or live aggregate | totalProjects, totalUnits, portfolioValue, yearsExperience |
| **Homepage — Top Projects carousel** | `Project` ordered by `Lead.count` last 30d | "Dynamically ranked by enquiry volume" |
| **Projects Grid** | `Project` where `isPublished=true` | + building count, unit count |
| **Project status badge** | `Project.status` mapped: ACTIVE→Available, COMPLETED→Sold | |
| **Project type filter** | `Project.type` (RESIDENTIAL/COMMERCIAL/MIXED_USE) | Exact match to SOW filters |
| **Location filter** | `Project.location` (new field, see §7) | Currently stored in address fields |
| **Project detail — Gallery** | `Document` where `category=PHOTO` and `isClientVisible=true` | S3 public bucket |
| **Project detail — Floor plans** | `Document` where `category=DRAWING` and `isClientVisible=true` | |
| **Project detail — Brochures** | `Document` where `category=BROCHURE` and `isClientVisible=true` | Gated/open config in project |
| **Project detail — Unit count** | `Unit.count` grouped by `status` | Available X / Total Y |
| **Project detail — Total sqft** | `Building.totalSqft` sum | |
| **Lead capture form** | Creates `Lead` row (source=WEBSITE) | Full CRM in Prime Tracker |
| **Brochure download gate** | Creates `Lead` row (source=WEBSITE) before returning S3 URL | |
| **Admin leads dashboard** | `Lead` filtered by source=WEBSITE | Or all leads; export CSV |
| **Admin project manager** | `Project` CRUD + `isPublished` toggle | |
| **Media library** | `Document` upload → S3 → attach to project | |

### What the Website Admin Panel Does NOT Need from Prime Tracker

These stay internal-only — not exposed on public website:

- Budget lines, commitments, actuals, contracts
- Loans and draw requests
- Investor relations
- Daily construction logs
- Interior fit-out tracking
- Cashflow forecasts
- Tasks and team comments
- Milestone dependencies
- QuickBooks sync

---

## 7. Schema Changes Required

### 7.1 Add to `Project` model

```prisma
// In apps/api/prisma/schema.prisma — add to Project model

model Project {
  // ... existing fields ...

  // PUBLIC WEBSITE FIELDS
  isPublished      Boolean   @default(false)
  slug             String?   @unique
  location         String?   // "Austin, TX" — for filter
  heroImageUrl     String?   // S3 URL
  amenities        String[]  @default([])
  metaDescription  String?
  possessionDate   DateTime?
  launchDate       DateTime?
  brochureGated    Boolean   @default(false)  // require lead form before brochure download
  websiteViews     Int       @default(0)      // increment on /projects/[slug] visit
}
```

**Migration:**
```sql
-- apps/api/prisma/migrations/20260609000000_add_public_website_fields/migration.sql
ALTER TABLE "Project" 
  ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "slug" TEXT UNIQUE,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "heroImageUrl" TEXT,
  ADD COLUMN "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "metaDescription" TEXT,
  ADD COLUMN "possessionDate" TIMESTAMP(3),
  ADD COLUMN "launchDate" TIMESTAMP(3),
  ADD COLUMN "brochureGated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "websiteViews" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Project_isPublished_idx" ON "Project"("isPublished");
CREATE INDEX "Project_slug_idx" ON "Project"("slug");
```

### 7.2 Add `WebsiteSettings` model (new)

```prisma
model WebsiteSettings {
  id               String   @id @default(cuid())
  whatsappNumber   String   @default("")
  whatsappMessage  String   @default("Hi, I'm interested in a property.")
  contactEmail     String   @default("")
  contactPhone     String   @default("")
  officeAddress    String   @default("")
  instagramUrl     String   @default("")
  facebookUrl      String   @default("")
  linkedinUrl      String   @default("")
  smtpHost         String   @default("")
  smtpPort         Int      @default(587)
  smtpUser         String   @default("")
  smtpPass         String   @default("")  // encrypt this
  updatedAt        DateTime @updatedAt
}
```

### 7.3 Add `Testimonial` model (new)

```prisma
model Testimonial {
  id         String   @id @default(cuid())
  authorName String
  authorRole String?
  content    String
  projectId  String?
  project    Project? @relation(fields: [projectId], references: [id])
  isVisible  Boolean  @default(true)
  sortOrder  Int      @default(0)
  createdAt  DateTime @default(now())
}
```

### 7.4 Lead model — already ready

The existing `Lead` model already has:
- `source: LeadSource` — `WEBSITE` value exists in enum ✅
- `name`, `phone`, `email`, `projectId`, `status` ✅
- `utm_source`, `utm_medium`, `utm_campaign` (check schema — if not present, add)

---

## 8. Public API Endpoints to Build

Create `apps/api/src/modules/public/` — new NestJS module with **no auth guard**.

### 8.1 Controller: `public.controller.ts`

```typescript
// GET /api/public/projects
// Returns: published projects with building/unit counts
// Query params: type, location, status, page, limit

// GET /api/public/projects/:slug
// Returns: full project detail — project, buildings, unit stats, public documents

// GET /api/public/stats
// Returns: { totalProjects, totalUnits, portfolioValueM, yearsExperience }
// Cached 60s (Redis)

// POST /api/public/leads
// Body: { name, phone, email, projectId?, source: 'WEBSITE', message?, utm_* }
// Rate limited: 5/minute/IP
// Validates: name required, phone/email at least one, honeypot field check
// Side effects: email to admin, acknowledgment to prospect

// GET /api/public/projects/:id/brochure
// Returns: presigned S3 URL for brochure
// If project.brochureGated=true: requires lead form first (checks session token)

// POST /api/public/revalidate (webhook)
// Called by Prime Tracker when isPublished changes → triggers Next.js ISR revalidation
// Body: { projectId, secret: REVALIDATION_SECRET }
```

### 8.2 Rate Limiting for Public Endpoints

```typescript
// In public.module.ts — override global throttler
@Controller('public')
@Throttle({ default: { limit: 30, ttl: 60000 } })  // 30 req/min general
export class PublicController {

  @Post('leads')
  @Throttle({ default: { limit: 5, ttl: 60000 } })  // 5 req/min for lead submission
  async submitLead(@Body() dto: CreatePublicLeadDto) { ... }
}
```

### 8.3 CORS Update

```typescript
// main.ts — add public website origin
app.enableCors({
  origin: process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:5173'],
  credentials: true,
});
```

---

## 9. Deployment Checklist

### 9.1 GitHub Actions CI/CD

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy-api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 10 }
      - run: pnpm install
      - run: pnpm run build
      - name: Deploy to EC2
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ubuntu
          key: ${{ secrets.EC2_SSH_KEY }}
          script: |
            cd /home/ubuntu/prime-tracker
            git pull origin main
            pnpm install
            pnpm run build
            npx prisma migrate deploy
            pm2 restart prime-api

  deploy-web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 10 }
      - run: pnpm install && pnpm run build
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      - run: aws s3 sync apps/web/dist/ s3://prime-tracker-app/ --delete
      - run: aws cloudfront create-invalidation --distribution-id ${{ secrets.CF_DIST_ID }} --paths "/*"
```

### 9.2 Pre-Deploy Checklist

```
□ Run: npx prisma migrate status — confirm no pending migrations
□ Apply pending migration: 20260608000000_add_project_approved_budget
□ Apply new migration: 20260609000000_add_public_website_fields
□ Set CORS_ORIGINS to include https://theprimedeveloper.com
□ Set REDIS_URL to localhost:6379 (EC2 Docker sidecar)
□ Move Supabase storage references to S3 in documents.service.ts
□ Replace nodemailer SMTP with AWS SES transport
□ Store all secrets in SSM Parameter Store (not .env in repo)
□ Verify rate limiting on POST /api/public/leads
□ Test Google OAuth callback URL updated to prod domain
□ Enable SES domain verification for theprimedeveloper.com
□ Confirm RDS security group: only EC2 SG can reach port 5432
□ Test presigned URL expiry on documents (15min recommended)
□ Set up automated RDS snapshots (daily, 7-day retention — free)
□ Configure PM2 to restart on crash + send alerts
```

---

## 10. Cost Estimate

### Year 1 (Free Tier Active — 12 months)

| Service | Free Tier | Estimated Usage | Cost |
|---|---|---|---|
| EC2 t2.micro | 750 hrs/month FREE | 730 hrs/month | $0 |
| RDS db.t3.micro | 750 hrs/month FREE | 730 hrs/month | $0 |
| RDS Storage | 20GB FREE | ~5GB | $0 |
| S3 Storage | 5GB FREE | ~2GB | $0 |
| CloudFront | 1TB FREE | <<1TB | $0 |
| Amplify Hosting | 5GB/15GB FREE | <<limits | $0 |
| SES (from EC2) | 62k emails FREE | <<62k | $0 |
| ACM (SSL) | Always FREE | All domains | $0 |
| Route 53 | $0.50/zone/month | 1 zone | **$6/year** |
| SSM Parameter Store | FREE (standard) | ~10 params | $0 |
| **TOTAL YEAR 1** | | | **~$6/year** |

### Year 2+ (Post Free Tier)

| Service | Pricing | Estimated | Monthly Cost |
|---|---|---|---|
| EC2 t3.micro (reserved 1yr) | ~$5/month | 1 instance | $5 |
| RDS db.t3.micro (reserved 1yr) | ~$12/month | 1 instance | $12 |
| RDS Storage | $0.115/GB | 10GB | $1.15 |
| S3 + CloudFront | ~$0.023/GB + transfer | 10GB | $2-3 |
| Amplify Hosting | $0.01/GB served | 5GB/month | $0.50 |
| SES | $0.10/1000 emails | 500 emails | $0.05 |
| Route 53 | $0.50/zone | 1 zone | $0.50 |
| **TOTAL YEAR 2+** | | | **~$21-23/month** |

> **Comparison:** Render paid tier is ~$21/month for API alone (no database included). AWS gives you more control at the same price post-free-tier, and you have 12 months free to validate traffic patterns.

---

## 11. Summary — Build Priority Order

| Priority | Task | Effort | Blocks |
|---|---|---|---|
| P0 | Apply pending migration `20260608000000` | 5min | Prod deploy |
| P0 | Add GitHub Actions CI/CD | 2hrs | All deploys |
| P0 | AWS account setup + RDS + EC2 + S3 | 4hrs | Everything |
| P1 | Add `isPublished`, `slug`, `location`, `amenities` to Project | 2hrs | Public website |
| P1 | Build `PublicModule` in NestJS (`/api/public/*`) | 1 day | Website data |
| P1 | Migrate Supabase storage → S3 | 3hrs | Media on website |
| P1 | Replace SMTP with SES | 2hrs | Lead emails |
| P2 | Build Next.js public website (SOW scope) | 8-10 weeks | — |
| P2 | Add lead export CSV in admin panel | 4hrs | SOW D5 |
| P2 | Add reCAPTCHA v3 on public lead forms | 2hrs | Spam protection |
| P3 | On-demand ISR revalidation webhook | 3hrs | Real-time publishes |
| P3 | Fix CORS to split on comma | 30min | Multi-origin |
| P3 | Add Pino structured logging | 2hrs | CloudWatch queries |
| P3 | Add env validation via Joi in ConfigModule | 2hrs | Safer boots |
