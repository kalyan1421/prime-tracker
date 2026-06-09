# AWS Infrastructure Video — Script & Production Prompt
# Prime Developers · theprimedeveloper.com

> **Two things in this file:**
> 1. A **complete ready-to-record video script** (12 scenes, ~12 minutes)
> 2. A **prompt to generate custom video variations** using AI tools

---

## PART A — READY-TO-USE VIDEO SCRIPT
### "Prime Developers — AWS Infrastructure Explained"
**Runtime:** ~12 minutes · **Style:** Professional walkthrough with diagrams

---

### 🎬 SCENE 1 — HOOK (0:00–0:30)

**[VISUAL: Prime Developers logo fades in on dark navy background. Gold accent line animates underneath.]**

**NARRATOR:**
"You're looking at a $183 million real estate portfolio — 7 active projects,
409 units, 30 team members across Texas. This is Prime Developers.

Behind every project update, every lead captured from the website, every
construction milestone — there's an infrastructure running on Amazon Web
Services that costs less than a cup of coffee per day.

In the next 12 minutes, I'll walk you through exactly how it's built,
why every piece is there, and how it all works together."

---

### 🎬 SCENE 2 — THE TWO APPS (0:30–1:30)

**[VISUAL: Split screen animates in. Left side: browser showing app.theprimedeveloper.com — internal dashboard. Right side: browser showing theprimedeveloper.com — public marketing site.]**

**NARRATOR:**
"Prime Developers runs two separate applications.

On the left — the internal platform. Called Prime Tracker. This is the tool
your 30-person team uses every day. Project managers track milestones,
finance tracks budgets and loans, sales tracks leads and deals, founders
get the executive overview. 14 different roles. 40 permissions. All
behind Google Workspace login.

On the right — the public website. theprimedeveloper.com. This is what
buyers, investors, and tenants see. Project galleries, enquiry forms,
brochure downloads. This is your lead generation engine.

Both apps run on AWS. Both share the same database. They talk to each
other through a secure API. Let's zoom into how."

**[VISUAL: Arrow animates connecting both browsers to a central server icon labelled 'AWS']**

---

### 🎬 SCENE 3 — THE FOUNDATION: EC2 (1:30–3:00)

**[VISUAL: AWS console screenshot of EC2 dashboard fades in. Highlight box appears around "t2.micro" instance. Green "running" badge pulses.]**

**NARRATOR:**
"Everything starts here. EC2 — Elastic Compute Cloud.

Think of EC2 as renting a computer from Amazon. Not a physical computer
you can touch, but a real computer running in Amazon's data centre in
Virginia — available 24 hours a day, 7 days a week, accessible from
anywhere in the world.

Our instance is a t2.micro. 1 virtual CPU. 1 gigabyte of RAM. For the
first 12 months on a new AWS account, Amazon gives you 750 hours per
month of this completely free.

On this single server, three things run simultaneously."

**[VISUAL: Diagram of EC2 box. Three sub-boxes animate in one by one:]**

**NARRATOR:**
"First — Nginx. Think of Nginx as a traffic director at the front door.
When a request comes in for api.theprimedeveloper.com, Nginx receives it
and forwards it to the right service inside the server.

Second — the NestJS API. This is the brain. 32 modules handling
everything from authentication to budget calculations to document uploads.
It listens on port 3001.

Third — Redis. A fast in-memory store that manages background jobs.
When a lead is submitted on the website, Redis queues the email
notification so the API doesn't have to wait. BullMQ processes these
jobs asynchronously."

**[VISUAL: Animate a request coming in → Nginx receives it → forwards to NestJS → NestJS talks to Redis]**

---

### 🎬 SCENE 4 — THE DATABASE: RDS (3:00–4:15)

**[VISUAL: Diagram showing EC2 box with an arrow pointing to a separate RDS cylinder icon. VPC boundary visible around both.]**

**NARRATOR:**
"Now the most important piece — the database.

RDS stands for Relational Database Service. Amazon manages the server,
the operating system, the backups, the patches. You only manage your data.

We're running PostgreSQL 15. This is the same database engine that runs
locally in development — the migration from local to cloud is seamless.

Notice something important in this diagram. The RDS instance has no
public IP address. There is no way to connect to it from the internet.
The only thing that can reach it is our EC2 server — enforced by a
Security Group firewall rule."

**[VISUAL: Red X appears over any arrow trying to reach RDS from outside. Green checkmark on EC2-to-RDS arrow.]**

**NARRATOR:**
"This matters because our database holds sensitive data. Loan amounts.
Investor equity positions. Personal details. AES-256 encrypted fields.
If an attacker compromises a different server somewhere, they still
cannot reach our database.

The database holds 35 models, 19 migrations, 1961 lines of schema.
Everything from projects and units to cashflow forecasts and audit logs.

Free tier: db.t3.micro, 20 gigabytes SSD — free for the first 12 months.
Every night, Amazon automatically takes a snapshot backup. Point-in-time
recovery up to 7 days back. If something goes wrong, we can restore to
within 5 minutes of any moment in the past week."

---

### 🎬 SCENE 5 — FILE STORAGE: S3 (4:15–5:15)

**[VISUAL: S3 bucket icon animates. Two buckets split apart — one labelled "prime-tracker-media" (green, public), one labelled "prime-tracker-documents" (red lock, private).]**

**NARRATOR:**
"S3 — Simple Storage Service. Think of S3 as a cloud hard drive where
every single file has its own unique web address.

We use two separate buckets — and the separation is intentional.

The media bucket is public. Project photographs, gallery images, cover
photos, brochures that visitors download. These need to be fast and
accessible to anyone in the world. No login required.

The documents bucket is private. Contracts. Loan agreements. Investor
documents. Construction permits. To access any file in this bucket,
you need a presigned URL — a temporary, expiring link generated by the
API. It's valid for 15 minutes, then it dies. Even if someone copies
that link and shares it, it stops working automatically."

**[VISUAL: Animate a presigned URL being generated. Timer countdown from 15:00 → 0:00. Red X appears.]**

**NARRATOR:**
"Both buckets sit behind CloudFront — Amazon's global content delivery
network. When a buyer in Houston views a project gallery, the photos
are served from the nearest AWS edge location. Not from Virginia.
This is why images load in milliseconds regardless of where you are."

---

### 🎬 SCENE 6 — THE PUBLIC WEBSITE: AMPLIFY (5:15–6:15)

**[VISUAL: Split screen. Left: GitHub repository. Arrow pointing right to: AWS Amplify console. Arrow pointing right to: Browser showing theprimedeveloper.com/projects.]**

**NARRATOR:**
"The public website — theprimedeveloper.com — runs on AWS Amplify Hosting.

Here's why we chose Amplify over running it on EC2. The public website
is built with Next.js — a framework that does something clever called
Server-Side Rendering and Static Generation. Pages are pre-built at
deploy time for speed. But some pages update dynamically.

When a project manager in Prime Tracker flips a project to 'Published',
the website needs to show that project within minutes — without a full
redeploy. Next.js calls this Incremental Static Regeneration.
Amplify handles all of this automatically.

The deploy flow is simple. A developer pushes code to GitHub. GitHub
Actions detects the push. Amplify pulls the latest code, runs the
build, and the new version is live in under 3 minutes.

Free tier: 5 gigabytes storage, 15 gigabytes of traffic per month,
1000 build minutes. For a marketing website at this scale, that's
effectively unlimited."

---

### 🎬 SCENE 7 — SECRETS & SECURITY: SSM (6:15–7:00)

**[VISUAL: Animated comparison. Left side: .env file with visible text "JWT_SECRET=abc123" — red warning icon. Right side: AWS SSM console showing encrypted parameter — green shield icon.]**

**NARRATOR:**
"Here's a security pattern most developers learn the hard way.

Never store passwords, API keys, or secrets in a file on the server.
If that file is accidentally committed to Git, or if someone gains
access to the server, every secret is exposed instantly.

Instead, we use AWS Systems Manager Parameter Store. Think of it as a
locked safe inside AWS. Every secret — the database password, the JWT
signing key, the AES encryption key for loan data, the Google OAuth
credentials — is stored here, encrypted with AWS KMS.

When our EC2 server starts up, it fetches these values directly from
AWS. The server itself never stores them on disk. The values live only
in memory while the application runs.

And here's the elegant part. The EC2 instance has an IAM Role attached.
That role says: this server is allowed to read parameters from SSM.
No username, no password, no access key stored anywhere. AWS handles
the authentication between its own services automatically."

---

### 🎬 SCENE 8 — EMAIL: SES (7:00–7:40)

**[VISUAL: Flow diagram. Website form → POST /api/public/leads → NestJS → SES → Two email icons: one to admin, one to prospect.]**

**NARRATOR:**
"When a buyer fills in the enquiry form on theprimedeveloper.com,
two emails fire automatically.

One goes to the Prime Developers admin team: a notification with the
lead's name, phone number, email, and which project they enquired about.

One goes to the buyer: an acknowledgment confirming their enquiry was
received and that someone will be in touch.

Both are sent via AWS SES — Simple Email Service. When sending from
an EC2 instance, Amazon gives you 62,000 emails per month completely
free. At the volume of a real estate marketing website, that's a cost
of effectively zero.

Before any emails can be sent, we verify ownership of the domain
theprimedeveloper.com with AWS. This prevents spam and ensures emails
land in inboxes, not junk folders."

---

### 🎬 SCENE 9 — DNS & SSL: ROUTE 53 + ACM (7:40–8:30)

**[VISUAL: Browser address bar showing https://theprimedeveloper.com. Padlock icon highlighted. Then diagram shows: Domain → Route 53 → splits to three endpoints.]**

**NARRATOR:**
"Three subdomains. Three services. One domain.

Route 53 is Amazon's DNS service. DNS is the phone book of the internet —
it translates a human-readable domain name into the IP address of
the actual server.

theprimedeveloper.com points to AWS Amplify — the public website.
app.theprimedeveloper.com points to CloudFront — the internal React app.
api.theprimedeveloper.com points to the EC2 server — the NestJS API.

Every single one of these runs on HTTPS. The padlock you see in the
browser is provided by AWS Certificate Manager — ACM. Amazon issues
SSL certificates for free. Unlimited certificates. They auto-renew
before expiry. There is nothing to configure, nothing to pay, nothing
to manually renew."

**[VISUAL: Certificate renewal timeline animating — green checkmark auto-renewing 30 days before expiry]**

---

### 🎬 SCENE 10 — CI/CD: GITHUB ACTIONS (8:30–9:30)

**[VISUAL: Three-column animation. Column 1: developer typing code. Column 2: GitHub Actions workflow running. Column 3: three checkmarks appearing — API deployed, Frontend deployed, Website deployed.]**

**NARRATOR:**
"Before AWS, deploying a change meant: SSH into the server, manually
pull the latest code, rebuild, restart the process, hope nothing broke.
One missed step and the site is down.

With GitHub Actions, this entire process is automated. Here's what
happens the moment a developer pushes code to the main branch on GitHub.

GitHub detects the push and triggers the workflow file.

For the API: GitHub SSHs into the EC2 server, pulls the latest code,
runs the build, runs database migrations, and restarts the NestJS
process with PM2. Zero manual steps.

For the internal React app: GitHub builds the frontend, syncs the
output files to the S3 bucket, then tells CloudFront to invalidate
its cache so users immediately get the new version.

For the public website: Amplify detects the push automatically and
handles the entire build and deploy on its own.

Total time from git push to everything live: under 4 minutes.
Cost of GitHub Actions for this usage: zero."

---

### 🎬 SCENE 11 — THE FULL FLOW: TWO SCENARIOS (9:30–11:00)

**[VISUAL: Animated flow diagram — full AWS architecture visible. Flow lines highlight in sequence for each scenario.]**

**NARRATOR:**
"Let me show you the full picture with two real scenarios.

Scenario One: A buyer visits theprimedeveloper.com/projects/riverview-towers.

Their request hits Route 53 — DNS resolves to Amplify. Amplify serves
the pre-built Next.js page from its cache. The page needs project data.
It calls api.theprimedeveloper.com — Route 53 resolves to EC2.
Nginx on EC2 receives the request, forwards it to NestJS on port 3001.
NestJS queries RDS PostgreSQL — returns the project details.
Project photos are served from S3 via CloudFront — from the nearest
edge location to the buyer. The complete page renders in under 200
milliseconds."

**[VISUAL: Flow highlights: Browser → Route 53 → Amplify → API call → EC2 → NestJS → RDS → response back → S3/CloudFront for images]**

**NARRATOR:**
"The buyer clicks Enquire Now and submits the form.

The form posts to api.theprimedeveloper.com/api/public/leads.
NestJS creates a Lead record in RDS PostgreSQL.
NestJS pushes an email job to Redis via BullMQ.
BullMQ picks up the job and calls SES.
SES sends two emails: one to the admin team, one to the buyer.
The entire lead is now in Prime Tracker, visible to the sales team."

**[VISUAL: Flow highlights: Form → EC2 → RDS write → Redis queue → BullMQ → SES → two email icons]**

---

### 🎬 SCENE 12 — COST SUMMARY & CLOSE (11:00–12:00)

**[VISUAL: Clean cost table slides in. Two columns: Year 1 vs Year 2+]**

**NARRATOR:**
"And finally — what does all of this cost?

In year one, with AWS free tier active, the entire infrastructure for
both applications — the internal platform and the public website —
costs approximately six dollars for the entire year. That's the Route 53
DNS fee. Everything else is free.

After free tier expires — twelve months after account creation — the
cost moves to approximately twenty-two dollars per month. Two managed
servers, a managed database, unlimited file storage, global CDN,
automated emails, free SSL, automated CI/CD.

For context: a comparable setup on Render with a managed Redis and
separate database starts at forty to fifty dollars per month — with
less control and no free tier for Year One.

This is what it means to build on AWS. Control, reliability, and cost
efficiency — starting from essentially zero."

**[VISUAL: Prime Developers logo animates back in. Gold accent line. Text fades in:]**
**"Prime Tracker · AWS Infrastructure · Built by Asan Innovators"**

**[FADE TO BLACK]**

---
---

## PART B — AI VIDEO GENERATION PROMPT

> Paste this into **Synthesia**, **HeyGen**, **Visla**, **InVideo**, or
> any AI video tool to auto-generate the video from the script above.
> Also works as a prompt for Claude/ChatGPT to generate a custom version.

---

### ✂️ COPY FROM HERE ↓

---

Create a professional explainer video for **Prime Developers**, a Texas-based
real estate company, explaining their complete AWS cloud infrastructure.

**Video brief:**
- **Title:** Prime Developers — AWS Infrastructure Explained
- **Length:** 10–12 minutes
- **Tone:** Professional, confident, clear. Like a senior engineer explaining
  to a smart business owner — not too technical, not too simple.
- **Audience:** The Prime Developers founder and leadership team, plus the
  development team. They understand real estate but are learning cloud tech.
- **Visual style:** Dark navy background (#0F1B2D), gold accent colour (#C9A84C),
  clean white text. Premium feel matching the brand.

**The two applications to cover:**
1. **Prime Tracker** — internal platform at app.theprimedeveloper.com
   - React 18 SPA + NestJS API + PostgreSQL + Redis
   - 30 employees, 14 roles, 35 database models
   - Auth: Google Workspace SSO + JWT + TOTP MFA
2. **Public Website** — theprimedeveloper.com
   - Next.js 14 SSR/SSG marketing site
   - Lead capture → feeds into Prime Tracker's Lead module
   - Projects published from Prime Tracker appear here automatically

**The AWS services to explain — one scene per service:**

SCENE 1: Hook — Prime Developers portfolio ($183M, 7 projects, 409 units)
SCENE 2: Two apps overview (internal vs public, how they connect)
SCENE 3: EC2 t2.micro — the server (Nginx + NestJS :3001 + Redis Docker)
SCENE 4: RDS PostgreSQL — database, private VPC, no public IP, daily backups
SCENE 5: S3 — two buckets (public media via CloudFront + private docs via presigned URLs)
SCENE 6: AWS Amplify — Next.js hosting, ISR, GitHub auto-deploy
SCENE 7: SSM Parameter Store — encrypted secrets, IAM role, no .env files
SCENE 8: SES — lead email notification + prospect acknowledgment, 62k/mo free
SCENE 9: Route 53 + ACM — DNS (3 subdomains) + free auto-renewing SSL
SCENE 10: GitHub Actions — CI/CD: git push → API deployed + S3 sync + Amplify rebuilt
SCENE 11: Two end-to-end flows (buyer views project + buyer submits enquiry)
SCENE 12: Cost table (Year 1: ~$6/year free tier → Year 2+: ~$22/month)

**For each service scene, include:**
- A clean animated diagram showing that service and how it connects
- A real-world analogy overlay text (e.g. "EC2 = a rented computer in Amazon's data centre")
- The free tier allowance displayed as a graphic
- An arrow showing where requests come FROM and where they go TO

**Diagram style for each service:**
Use boxes and arrows. Box labels in white text. Arrows animated left-to-right
or top-to-bottom. Active path highlighted in gold (#C9A84C). Inactive services
dimmed. Each new connection animates in as the narrator mentions it.

**Full architecture diagram to animate in Scene 11:**
```
theprimedeveloper.com  ──►  Route 53
                               │
              ┌────────────────┤────────────────┐
              │                │                │
              ▼                ▼                ▼
          Amplify          CloudFront         EC2
         (Next.js)          (React)          (Nginx)
              │                │                │
              └────────────────┴──────► NestJS :3001
                                              │
                              ┌───────────────┼───────────┐
                              ▼               ▼           ▼
                             RDS            Redis        SES
                          PostgreSQL      BullMQ       (Email)
                              │
                              └──────────────► S3
                                          (media + docs)
```

**Narration tone instructions:**
- Speak in second person: "your team", "your database", "your buyers"
- Use analogies before technical terms every time
- Always say what something costs (or that it is free)
- When mentioning security, briefly say what it protects against
- End each service section with: what happens if this service goes down

**Slide/screen design for each scene:**
- Background: dark navy #0F1B2D
- Primary text: white #FFFFFF, 36pt, sans-serif
- Accent/highlight: gold #C9A84C
- Code/technical terms: monospace font, gold colour
- Diagrams: flat design, no 3D, no gradients except subtle navy-to-black
- Transitions: fade or slide — no spinning, no bouncing

**Opening graphic:** Prime Developers logo + tagline "Built on AWS"
**Closing graphic:** "Infrastructure by Asan Innovators · theprimedeveloper.com"

**Output format required:**
- Full narration script (word-for-word, ready to record)
- Scene-by-scene visual direction (what appears on screen, when it animates)
- Slide deck outline (one slide per scene with exact text and diagram layout)
- Suggested B-roll (real AWS console screenshots to insert at each scene)

Use the narration script provided below as the base — adapt the visuals
to match it precisely. The script is the source of truth.

[PASTE FULL SCRIPT FROM PART A HERE]

---

### ✂️ COPY TO HERE ↑

---

## PART C — TOOL-SPECIFIC INSTRUCTIONS

### Option 1 — Record with Loom (Fastest, Free)
1. Open AWS console in your browser
2. Use this script as your teleprompter (paste into https://cueprompter.com)
3. Screen-record the AWS console as you navigate each service
4. For diagrams: open `docs/AWS_MIGRATION_AND_WEBSITE_INTEGRATION.md`
   in VS Code and zoom into each architecture diagram as you narrate
4. Record audio with your microphone
5. Loom auto-uploads and gives you a shareable link instantly

### Option 2 — Synthesia (AI Avatar, No Camera Needed)
1. Go to https://synthesia.io → New Video
2. Choose an avatar and voice
3. Paste each scene's narration into the script box
4. Upload a slide per scene (use Canva with the colour scheme above)
5. Export as MP4

### Option 3 — HeyGen (Best Quality AI Avatar)
1. Go to https://heygen.com → New Video
2. Use "Talking Photo" or "Avatar" mode
3. Paste full script — HeyGen splits by scenes automatically
4. Add slides/diagrams as background per scene
5. Generate and download

### Option 4 — Canva Video (Presentation Style)
1. Go to https://canva.com → New Design → Presentation (16:9)
2. Use dark navy template
3. One slide per scene — paste the visual descriptions
4. Use Canva's built-in diagram tools for the architecture flows
5. Record voiceover directly in Canva → Export as MP4

### Option 5 — Claude Prompt (Generate Custom Script Variation)
Paste PART B prompt into Claude with this addition at the end:
> "Also generate a 2-minute executive summary version of this video
> for sharing with investors — same AWS architecture, but focus only on
> reliability, security, and cost savings. Skip the technical details."

---

## Scene Timing Reference

| Scene | Topic | Start | End | Duration |
|-------|-------|-------|-----|----------|
| 1 | Hook — Prime Developers intro | 0:00 | 0:30 | 30s |
| 2 | Two apps overview | 0:30 | 1:30 | 60s |
| 3 | EC2 — the server | 1:30 | 3:00 | 90s |
| 4 | RDS — the database | 3:00 | 4:15 | 75s |
| 5 | S3 — file storage | 4:15 | 5:15 | 60s |
| 6 | Amplify — public website | 5:15 | 6:15 | 60s |
| 7 | SSM — secrets | 6:15 | 7:00 | 45s |
| 8 | SES — email | 7:00 | 7:40 | 40s |
| 9 | Route 53 + ACM — DNS & SSL | 7:40 | 8:30 | 50s |
| 10 | GitHub Actions — CI/CD | 8:30 | 9:30 | 60s |
| 11 | Full end-to-end flows | 9:30 | 11:00 | 90s |
| 12 | Cost table + close | 11:00 | 12:00 | 60s |
| **Total** | | **0:00** | **12:00** | **12 min** |

---

## Colour & Brand Reference

| Element | Hex | Use |
|---------|-----|-----|
| Background | `#0F1B2D` | All slides |
| Primary text | `#FFFFFF` | Narration text, labels |
| Gold accent | `#C9A84C` | Highlights, arrows, service names |
| Active flow | `#C9A84C` | Animated path currently being described |
| Inactive/dim | `#3A4A5C` | Services not currently in focus |
| Success/free | `#22C55E` | Free tier badges, green checkmarks |
| Warning | `#F59E0B` | Cost notes, expiry warnings |
| Code/tech | `#C9A84C` monospace | Port numbers, URLs, service names |
