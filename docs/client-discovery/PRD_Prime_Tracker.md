# Prime Tracker — Product Requirements Document

**Asan Innovators** | Prepared by: Kalyan Kumar Bedugam (AK)
**Version:** 1.0 | **Date:** 2026-06-02 | **Status:** Draft for client review
**Client:** Prime Developers (US + India entities) | **System:** Prime Tracker internal real-estate ops platform

> **Scope of this document.** This PRD covers the platform **from its current built state through the planned
> update cycle**. It folds in (a) the returned client discovery workbook + the 36 follow-up questions, (b) a
> code-review pass on the actual codebase, and (c) a product-brainstorming layer of open decisions. It is the
> single planning reference that sits above the existing design docs:
> [UPDATE_PLAN.md](UPDATE_PLAN.md) · [PHASED_DELIVERY_PLAN.md](PHASED_DELIVERY_PLAN.md) ·
> [INTERIOR_MODULE_DESIGN.md](INTERIOR_MODULE_DESIGN.md) · [SALE_PAYMENT_SCHEDULE_DESIGN.md](SALE_PAYMENT_SCHEDULE_DESIGN.md) ·
> [TDD_Interior_and_SalePayment.md](TDD_Interior_and_SalePayment.md) ·
> [SOW_Prime_Tracker_Interior_and_SalePayment.docx](SOW_Prime_Tracker_Interior_and_SalePayment.docx) ·
> [CLIENT_FOLLOWUP_QUESTIONS.docx](CLIENT_FOLLOWUP_QUESTIONS.docx).

---

## Table of Contents

1. Overview
2. User Research Synthesis (who uses it, what hurts)
3. Client Requests Register (the workbook, decoded)
4. Goals & Success Metrics
5. Current State — What Is Already Built (baseline)
6. **Scope of Updates** — the five tracks the client asked for
   - 6.1 New Feature Updates
   - 6.2 Existing-Feature Updates
   - 6.3 Backend Issues & Resolutions
   - 6.4 Auth & Profiles Setup
   - 6.5 Roles & Rules (RBAC)
7. User Stories (prioritized)
8. Data Model Changes
9. Technical Constraints
10. Phased Delivery Plan
11. Product Brainstorming — Open Decisions & Options
12. Out of Scope
13. Definition of Done

---

## 1. Overview

### 1.1 Problem statement
Prime Developers runs construction projects (shell), then optional interior fit-outs, sells/leases units, takes
construction loans with lender draws, raises investor equity, and runs marketing campaigns — today across
**QuickBooks + Bill.com + BuilderTrend + spreadsheets + email**. Prime Tracker already replaces most of that
sprawl, but three gaps remain: (a) the **interior fit-out workflow has no representation at all**, (b) a sale
stores **one number, not a payment schedule**, so the **cashflow forecast cannot show real money-in dates**, and
(c) the **#1 daily pain** — re-keying PO numbers between tools and "construction files are hardest to find" — is
unaddressed. This update cycle closes those gaps and hardens what exists.

### 1.2 Solution summary
A staged extension of the existing NestJS + Prisma + React platform that:
- Adds the **Interior / Fit-Out module** (7-phase workflow, isolated TI budget, sub-contractor invoices, snagging, handover gates).
- Adds the **Sale Payment Schedule** (milestone-linked installments that feed the cashflow forecast + overdue alerts).
- Adds **Broker tracking + commissions**, **daily construction logs with photos**, **unit groups**, and **lead-funnel** refinements.
- **Hardens the backend** (test coverage on money paths, sale-cancellation reversal, QuickBooks go-live, RLS posture).
- Tightens **auth & profiles** (self-service profile, session visibility) and **roles & rules** (assignment-scoped visibility, edit-rights matrix).
- Defers the heavy external integrations (BuilderTrend ↔ Bill.com bridge, WhatsApp, PWA/offline) to a dependency-gated final phase.

### 1.3 Target users
Internal staff at Prime Developers across two org entities (US + India): Founders/Executives, Finance/Accounting/AR-AP,
Project Managers, Construction, Sales, Marketing, Legal, and Viewers. Buyer-facing **Clients** are a Phase-2 portal
audience (enum exists, portal not built).

---

## 2. User Research Synthesis

*(The `/user-research` lens — synthesized from the returned discovery workbook + follow-up answers. No new interviews were run; this distills what the client already told us.)*

### 2.1 Personas

| Persona | Role(s) | Primary jobs | Loudest pains (verbatim themes) |
|---|---|---|---|
| **The Founder / Co-Founder** | FOUNDER, EXECUTIVE | Portfolio health; approve draws & discounts; "how much money do I need next 2/4 weeks?" | No real cashflow projection; can't see money-in vs money-out by date; approvals scattered |
| **Finance / Accounting / AR-AP** | FINANCE, ACCOUNTING, AR_AP | Budget vs actual; lender draws; investor capital; QB reconciliation | Interior costs mixed with construction; manual PO re-entry (BuilderTrend→Bill.com); receivables invisible |
| **Project Manager** | PROJECT_MANAGER | Run shell **and** interior for the same units; milestones; vendors | No interior workflow in-system; juggles fit-out in spreadsheets; same PM, no separate role wanted |
| **Construction lead** | CONSTRUCTION | Daily field progress, photos, snags | **#1 pain:** "daily logs with pictures"; "construction files are hardest to find" |
| **Sales** | SALES | Pipeline, installments, brokers | Sale = one number; can't schedule/chase installments; broker performance untracked |
| **Marketing** | MARKETING | Leads, campaigns, attribution | Funnel missing *Potential* / *Site Visit*; one lead ↔ many units not modeled |
| **Legal** | LEGAL | Contracts, LOIs, NOCs, deeds | Wants stage-by-stage document presence (not yet enforced) |
| **Viewer / Investor (read)** | VIEWER (+ Phase-2 CLIENT) | Read dashboards / statements | Investors get updates outside the system today |

### 2.2 Top pain points (ranked by how loudly the client raised them)
1. 🔴 **Daily construction logs with photos** — explicitly the client's #1 pain.
2. 🔴 **Manual PO re-entry** BuilderTrend → Bill.com — top time-waster.
3. 🔴 **No interior fit-out tracking** — a core part of the business, entirely outside the system.
4. 🔴 **No real cashflow projection** — "money needed next 2/4 weeks" is unanswerable without installment data.
5. 🟠 **Finding construction files** — documents hard to locate at the right stage.
6. 🟠 **Broker performance & commissions** — brokers bring leads; nothing measures them.

### 2.3 Research-derived design principles
- **Same PM, no new role** — interiors reuse `PROJECT_MANAGER`; don't add org complexity.
- **Money must never mix** — interior (TI) costs are reported as a top-level category, never summed into construction.
- **Templates are the adoption lever** — if maintaining a payment schedule is tedious, Sales reverts to Excel and cashflow stays fictional.
- **Mobile-first for the field** — daily logs / snags must work one-handed on a phone with sometimes-slow internet.
- **Reuse over rebuild** — event bus, notifications, storage, exceptions feed, budget/actual tables are extended, not forked.

---

## 3. Client Requests Register

*(The "client request Excel" decoded. The returned workbook's answers are folded into the plan below; these are
the items that still **block scope or build** and must be confirmed at kickoff (M0). Full list:
[CLIENT_FOLLOWUP_QUESTIONS.docx](CLIENT_FOLLOWUP_QUESTIONS.docx).)*

| # | Topic | Question to confirm | Priority |
|---|---|---|---|
| A1–A5 | **Data migration** | History to migrate? Volume? Format (Excel/QB/BuilderTrend)? How far back? Anything excluded? | 🔴 Blocks scope |
| B6–B8 | **Investors** | How are statements sent today? Equity per-project or portfolio? Capital-call/distribution process + approver? | 🔴 Blocks scope/build |
| C9 | **Interior payment milestones** | Standard split (e.g. 30/40/30)? | 🔴 Blocks build |
| C10 | **Interior packages** | Provide 2–3 package definitions now, or model-now/fill-later? | 🔴 Blocks build |
| C11 | **City Approval** | Approver of record? Hard-block to Procurement or just tracked? | 🔴 Blocks build |
| C12 | **Interior spend tracking** | How is actual-vs-quote tracked today? | 🟠 Blocks build |
| C13–C14 | **Interior billing/encryption** | Encrypt contract values like loans? Single billing entity? | 🟢 Good to know |
| ~~D15~~ | ~~**Sale installment structure**~~ | ✅ **ANSWERED 2026-08-14** — 10/40/50 and 30/40/30 are Prime's real templates, plus per-installment customisation. All three already built (`PAYMENT_TEMPLATES` + `addPayment`). | ✅ Closed |
| D16 | **Deposit handling** | Deposit becomes first installment, or stays a separate field? | 🔴 Blocks build |
| D17 | **Who records payments** | Finance/Accounting only, or Sales too? | 🔴 Blocks build |
| D18 | **Sale cancellation** | Release unit? Refund? Penalty? Walk through it. | 🔴 Blocks build |
| D19 | **Unit upgrade/change after signing** | How should the system handle it? | 🟢 Good to know |
| E20 | **Broker fees** | Flat or % of sale? Earned on close? | 🔴 Blocks build |
| E21 | **Lead funnel** | Confirm exact stages incl. Potential + Site Visit | 🔴 Blocks build |
| E22–E23 | **Sales docs / waitlist** | Enforce docs per stage? Build per-unit waitlist? | 🟢 Good to know |
| F24 | **BuilderTrend ↔ Bill.com** | API access + tier? Full sync or just kill manual PO re-entry? | 🔴 Blocks scope |
| F25 | **QuickBooks go-live** | Live credentials? Push, pull, or both? | 🔴 Blocks build |
| F26 | **Cost-code list** | Share for mapping to budget categories | 🔴 Blocks build |
| F27 | **Daily logs** | Capture beyond photos (notes/weather/crew)? Who fills/reviews? | 🔴 Blocks build |
| F28 | **Budget views** | Confirm Loan / Sub-AP / TI / Commissions as top-level lines, M/Q/A + outstanding | 🔴 Blocks build |
| G29 | **External logins** | Brokers/lenders/lawyers/investors need login, or all internal? | 🔴 Blocks build |
| G30 | **Project visibility** | Assignment-scoped, or everyone sees all? | 🔴 Blocks build |
| G31 | **Who can create/edit projects** | Confirm edit roles beyond view-only | 🟢 Good to know |
| G32–G33 | **Offline / language** | Offline a v1 priority? Non-English/RTL needed? | 🟢 Good to know |
| H34–H36 | **Success criteria** | What does success look like at 3 months? What would make you stop? Internal champion? | 🟢 Good to know |

> **Decisions already locked by the client** (do not re-litigate): same PM for interiors; unit-combine = merge into
> 1 legal unit; externals get **no login**; installments tied to milestones (child table); interior priced **per
> sqft**; interior **cannot** run parallel to construction; **USD only**; notifications = **email + in-app**
> (WhatsApp later); **single approval** (no dual-approval) for draws & discounts.

---

## 4. Goals & Success Metrics

| Goal | Metric | Target (proposed — confirm H34) |
|---|---|---|
| Interiors tracked in-system | % of active fit-outs with an `InteriorProject` record | ≥ 90% within 1 month of launch |
| Cashflow projection becomes real | % of active sales with a maintained payment schedule | ≥ 80% of `UNDER_CONTRACT`/`CLOSED` sales |
| Kill manual PO re-entry | Manual PO re-keys between BuilderTrend & Bill.com per week | → 0 (Phase 6, gated on API access) |
| Field logging adoption | Projects with ≥ 1 daily log/working day | ≥ 70% of active construction projects |
| Money correctness | Defects in payment/invoice math post-launch | 0 (≥ 80% test coverage on money paths) |
| Broker visibility | Sales with broker attribution + commission computed on close | 100% of broker-sourced sales |

> Client left Sheet 6 Q16–18 (success criteria + champion) blank — these targets are **proposed** and must be
> confirmed with the internal champion at kickoff.

---

## 5. Current State — What Is Already Built (baseline)

**Headline: most originally-scoped "gaps" are already built.** Verified against `apps/api/prisma/schema.prisma`,
`apps/api/src/modules/` (**31 modules**), and `apps/web/src/pages/`. Do **not** rebuild these:

| Area | Status | Notes |
|---|---|---|
| Project → Building → Unit hierarchy (+ raw-land LOT) | ✅ Built | `BuildingType.LOT`, building-level phases |
| Milestones + dependencies + photos | ✅ Built | `Milestone.dependsOnId`, `MilestonePhoto` |
| Budgets + revisions + categories; Actuals; Commitments | ✅ Built | append-only `BudgetRevision` |
| Loans + draw requests + multi-step approval + draw schedule + docs | ✅ Built | `draws` module, AES-encrypted loan fields |
| Sales pipeline + weighted forecast + lost reasons | ✅ Built | auto-flips unit→SOLD on close |
| Leads + activities + convert-to-sale; Campaigns + spend + UTM | ✅ Built | `leads`, `campaigns` modules |
| Leases + rent-roll | ✅ Built | `LEASE_PENDING`, `OWNER_OCCUPIED` states |
| Cashflow forecast (inflow/outflow, burn) | ✅ Built — **but no real sale-installment inflows** | the gap §6.1-B fills |
| Contracts + change orders + contract payments + vendors | ✅ Built | `contracts`, `vendors` |
| Investors + equity + capital calls + distributions | ✅ Built | operating detail unknown (B6–B8) |
| Documents + versioning + categories + client-visible flag | ✅ Built | Supabase storage, presigned upload |
| Tasks + comments + attachments; Exceptions feed | ✅ Built | `tasks`, `exceptions` |
| In-app **+ email** notifications + daily cron triggers | ✅ Built | nodemailer; WhatsApp is the outstanding channel |
| Reports (portfolio/sales/revenue/debt/unit-sales/vacancy); role dashboards | ✅ Built | Founder/Finance/Sales/Construction/Lead |
| Multi-org (US + India) | ✅ Built | `Organization`, `OrgMembership` |
| QuickBooks OAuth + REST sync (vendors/bills/payments) | ✅ Built (real REST) — **unverified vs live creds** | go-live is a task, not a build |
| Auth: Google OAuth (domain-restricted) + JWT (15m/7d, rotated) + MFA TOTP | ✅ Built | see §6.4 |
| RBAC: 12 internal roles + CLIENT; role→permission map | ✅ Built | `packages/shared/src/types/index.ts:226-437` |

**Confirmed absent today** (these are the net-new builds): `InteriorProject`, `SalePayment`, `Broker`, `DailyLog`,
`SnagItem`, `UnitGroup`, `LeadUnitInterest`.

---

## 6. Scope of Updates

*The client asked for five explicit tracks. Each is a subsection below.*

### 6.1 New Feature Updates 🆕

| ID | Feature | Priority | What it is | Key design refs |
|---|---|---|---|---|
| **A** | **Interior / Fit-Out module** | 🔴 P0 | Standalone `InteriorProject` anchored to a unit; 7 phases (Design → Client Approval → City Approval → Procurement → Execution → Snagging → Handover); per-sqft contract; **isolated TI budget**; sub-contractor invoices; BOQ + 2–3 package templates; **soft parallel gate** (block Procurement/Execution pre-shell); **document gates** (city-approval doc → Execution, handover cert → Handover). Per-unit Interior tab + cross-project Interior Portfolio page. | INTERIOR_MODULE_DESIGN, TDD §4–7 |
| **B** | **Sale Payment Schedule** | 🔴 P0 | `SalePayment` child of Sale: N installments, fixed-date **and** milestone triggers, partial payments, % or fixed amount. Auto due-date stamping on milestone completion. Overdue cron + alerts. **Feeds cashflow inflows** + Finance receivables view. Coupled to (A): the per-sqft TI charge is one installment. | SALE_PAYMENT_SCHEDULE_DESIGN, TDD §4,6 |
| **C** | **Broker model + commissions** | 🟠 P1 | `Broker` (internal-only, **no login**): name, company, phone, commissionRate. Attribute leads/sales to brokers; commission calc on close; broker-performance report. | UPDATE_PLAN §3-C |
| **D** | **Daily construction logs (photos)** | 🟠 P1 | `DailyLog` (date, author, notes, optional weather/crew) + multiple photos, scoped to project/building. **Mobile-first capture** — the #1 pain point. | UPDATE_PLAN §3-F |
| **E** | **Snagging / punch list** | 🟠 P1 | `SnagItem` (description, room, assignee, status, photo, resolvedAt) — delivered inside the Interior module, reusable on construction milestones. | INTERIOR_MODULE_DESIGN §4 |
| **F** | **Unit Groups / combine** | 🟠 P1 | Combine adjacent units → **merge into one legal unit**, retaining child history. (Operation, not a long-lived overlay — confirm UX, §11.) | UPDATE_PLAN §3-D |
| **G** | **Lead funnel + multi-unit interest** | 🟢 P2 | Extend `LeadStatus` (+`POTENTIAL`, +`SITE_VISIT`); `LeadUnitInterest` join (one lead ↔ many units; per-unit waitlist). | UPDATE_PLAN §3-I |
| **H** | **BuilderTrend ↔ Bill.com PO bridge** | 🟠 P1 (value) / gated | Eliminate manual PO re-entry. Sizing depends on API access (F24). Phase 6. | UPDATE_PLAN §3-G |
| **I** | **WhatsApp notifications** | 🟢 P2 | Add a channel to `notifications` (Twilio vs Meta — §11). Defer. | UPDATE_PLAN §3-H |
| **J** | **PWA / offline polish** | 🟢 P2 | Install + light offline caching + queued photo upload for field use. Defer unless prioritized. | UPDATE_PLAN §3-J |

### 6.2 Existing-Feature Updates ✏️

These enhance modules that **already exist** — not new builds:

| Module | Update | Why |
|---|---|---|
| **Cashflow** | Wire real **inflows** from `SalePayment` + **outflows** from interior `Actual`s; add **"receivables next 2/4 weeks"** Finance view. | The forecast is currently fiction without installment data (founder's stated need). |
| **Sales** | Add **cancellation reversal** (release unit status — see §6.3); discount-approval gate (single approval, Founder/Co-Founder). | Cancelled sales currently strand the unit (§6.3). |
| **Budgets / Reporting** | Surface **TI / Interior** as a top-level reporting category (peer to Loan / Sub-contractors AP / Commissions); M/Q/A toggle + outstanding-per-bucket. | Client listed these exact budget buckets (F28). |
| **Milestones** | Emit/consume `milestone.completed` to stamp linked `SalePayment` due-dates (reuse existing event bus). | Powers "installments linked to milestones." |
| **Notifications** | New triggers: `PAYMENT_DUE_7`, `PAYMENT_OVERDUE`, `INTERIOR_PHASE_CHANGED`, `INTERIOR_HANDOVER_DUE`, `SNAG_OVERDUE`. Add WhatsApp channel (later). | Reuse the daily 8AM cron + email/in-app engine. |
| **Documents** | New categories `CITY_APPROVAL`, `HANDOVER_CERTIFICATE`; optional stage/phase document gates. | Attacks "files hardest to find" + enforces handover. |
| **Exceptions feed** | Surface overdue payments + overdue snags + stalled interior phases (no new page). | High-visibility, cheap win. |
| **Leads** | Funnel stage additions + multi-unit interest (see 6.1-G). | Matches client's real funnel. |
| **Enums (minor)** | `LeadSource` (+WhatsApp/Resquared/flyer); `ProjectPhase` (+Conceptual/Handover); `DrawDocType` (+budget-sheet/material-photo) — surfaced during the design refresh. | Small UX-driven additions. |

### 6.3 Backend Issues & Resolutions 🛠️

*(The `/code-review` lens — findings verified against the live codebase, with file:line evidence.)*

| # | Issue (verified) | Evidence | Resolution | Phase |
|---|---|---|---|---|
| 1 | **Sale cancellation does not release the unit.** Only `CLOSED` flips the unit to `SOLD`; `CANCELLED` just sets `lostReason` and leaves the unit in its prior status (e.g. stuck `UNDER_CONTRACT`). | `apps/api/src/modules/sales/sales.service.ts:107-121` | Add cancellation path that releases the unit (→ `AVAILABLE`, restore `availableSince`) inside one `$transaction`; define refund/penalty per D18. | Phase 3 |
| 2 | **Thin test coverage — only 4 spec files** in the whole API (auth, organizations, encryption, projects). New money logic must not ship untested. | `apps/api/**/*.spec.ts` = 4 files | Ship Interior + SalePayment with unit + e2e tests; **≥ 80%** coverage on the two new services + state machine. Add a CI review gate per phase. | All phases |
| 3 | **QuickBooks sync unverified against live credentials.** Code is real REST (OAuth 2.0, no mocks), but never run against a live company. | `apps/api/src/modules/quickbooks/quickbooks.service.ts` | Schedule a **go-live verification** task (credentials F25, direction push/pull, cost-code mapping F26). Treat as ops, not new build. | Phase 6 |
| 4 | **RLS is enabled but bypassed by the API.** Policies exist on `projects`, `buildings`, `units`, `budget_lines`, but the NestJS connection uses the `postgres` role, which **bypasses RLS**. So row security is enforced only for direct Supabase-client access, not the app. | `apps/api/prisma/migrations/20260502120000_add_rls_4_modules/migration.sql` | Decide posture: either (a) treat RLS as defense-in-depth for direct DB access and rely on `PermissionsGuard` in the app (document this), or (b) move the API to a non-superuser role + `SET app.user_role` per request. **Recommend (a) + explicit doc** for this internal tool. | Phase 0 decision |
| 5 | **No self-service profile editing.** The only user-update route is `PUT /users/:id` gated by `user:manage` (admin-only); a normal user cannot edit their own name/avatar. | `apps/api/src/modules/users/users.controller.ts:85-94` | Add `PATCH /users/me` (self) for name/avatar; keep role/status under `user:manage`. (See §6.4.) | Phase 0/1 |
| 6 | **CLAUDE.md was stale** (described ~18 modules; repo has 31). | (now refreshed) | Keep CLAUDE.md + these docs current as modules land. | Ongoing |
| 7 | **Confirm `TAB_ROLES` hides leads/sales/revenue from Construction** (client requirement). | `apps/web/src/pages/ProjectDetailPage.tsx:226-238` | ✅ Verified correct: CONSTRUCTION sees construction/units/milestones/vendors/documents; **not** leads/revenue/draws. Keep as-is; add tests. | Verified |
| 8 | **Additive-only migrations.** All new models/enums are nullable/new tables — no destructive changes. | TDD §5 | Single combined migration `interior_and_sale_payments`; run `prisma migrate status` before each. | Phase 1 |

> **Positive findings:** no `TODO/FIXME/HACK` markers in the backend; JWT refresh-token **rotation + revocation**
> is implemented correctly; MFA TOTP is production-grade; QB code is genuine REST (not stubbed).

### 6.4 Auth & Profiles Setup 🔐

**Current (verified):**
- **Google OAuth** (Workspace SSO), domain-restricted via `GOOGLE_ALLOWED_DOMAIN` (`primedevelopers.com`); first
  login auto-creates a user as **VIEWER**, upgradable by a Founder. (`auth.service.ts:92-146`)
- **JWT**: access **15m**, refresh **7d**; refresh tokens stored in a `RefreshToken` table with `expiresAt` /
  `revokedAt`; **rotated** on refresh, **revoked** on logout (single or all sessions). (`auth.service.ts:166-233`)
- **MFA / TOTP** via `otplib`: setup → QR → enable → verify; encrypted `mfaSecret` on `User`; `MfaGuard` enforces. (`auth.service.ts:235-307`)
- **User/profile fields:** `id, email, name, avatarUrl, googleId, role, isActive, passwordHash, mfaEnabled, mfaSecret, lastLoginAt, createdAt, updatedAt`. (`schema.prisma:18-69`)
- Axios interceptor auto-attaches the bearer token and auto-refreshes on 401 (frontend).

**Planned updates:**
1. **Self-service profile** — `PATCH /users/me` for `name` + `avatarUrl` (avatar upload via existing Supabase storage); a Profile screen in the web app. (Resolves §6.3 #5.)
2. **Session visibility / control** — a "your sessions" view + "log out everywhere" using the existing `RefreshToken` revocation.
3. **MFA enrollment policy** — keep optional, but **prompt/encourage** FINANCE/FOUNDER (the existing `MfaBanner`), and make it **mandatory-on-demand** by org policy (config flag).
4. **External users get no login** (client-confirmed, G29): brokers/lenders/lawyers/investors remain internal-tracked entities, **not** auth principals. The Phase-2 buyer **CLIENT** portal is the only future external surface.
5. **Decision:** confirm whether email/password (`passwordHash` exists) is a supported path or **Google-only** (recommend Google-only for staff; keep password as break-glass admin).

### 6.5 Roles & Rules (RBAC) 👥

**Current (verified):**
- **12 internal roles**: `SUPER_ADMIN, FOUNDER, EXECUTIVE, FINANCE, ACCOUNTING, AR_AP, PROJECT_MANAGER, CONSTRUCTION, SALES, MARKETING, LEGAL, VIEWER` — plus `CLIENT` (Phase-2 buyer portal). (`schema.prisma:84-99`)
- **Role → permission map** lives in `packages/shared/src/types/index.ts:226-437` (50+ granular permission strings); JWT carries the resolved permission list; `PermissionsGuard` + `@RequirePermissions()` enforce server-side; frontend gates via `<ProtectedRoute permission>` and `ProjectDetailPage` `TAB_ROLES`.
- **Summary of current grants:** SUPER_ADMIN = all; FOUNDER = all except `SYSTEM_CONFIG`; EXECUTIVE = read-all + financial edit/export + draw approval + audit; FINANCE = full financial + investor; ACCOUNTING = budget/actual + QB (no loans/investor); AR_AP = draws + payment approvals; PROJECT_MANAGER = full project lifecycle + milestones + vendors + docs; CONSTRUCTION = milestones edit + docs upload + vendors view; SALES = sales/lease/lead full + unit edit + campaign view; MARKETING = lead full + campaign full + spend; LEGAL = contracts/leases/sales view + docs upload; VIEWER = view-only.

**Planned updates:**
1. **New permission strings** for the new modules:
   - `interior:view` (PM, CONSTRUCTION, FOUNDER, EXECUTIVE, FINANCE), `interior:edit` (PROJECT_MANAGER, FOUNDER), `interior:approve` (FOUNDER, EXECUTIVE + City approver of record — confirm C11), `interior:finance` (FINANCE, ACCOUNTING, AR_AP).
   - `payment:log` (FINANCE, ACCOUNTING, AR_AP — and SALES? confirm D17).
   - `broker:view` / `broker:edit`, `dailylog:view` / `dailylog:edit`, `snag:view` / `snag:edit`.
2. **Assignment-scoped project visibility** (G30 — **must confirm**): today every authenticated user can read all projects (RLS SELECT = any app user). Decide: keep "everyone sees all," or restrict some roles (e.g. CONSTRUCTION/SALES) to **assigned projects only** via the existing `ProjectMember` model. This is a scope-affecting rule.
3. **Edit-rights matrix** (G31): confirm which roles may **create/edit projects** beyond view-only (currently SUPER_ADMIN, FOUNDER, PROJECT_MANAGER per RLS).
4. **Document the RLS-vs-app-guard posture** (§6.3 #4) so the security model is explicit.
5. **Single-approval rule** (client-confirmed): no dual approval; Founder/Co-Founder approve draws **and** discounts — encode `interior:approve` / discount gate accordingly.

---

## 7. User Stories (prioritized)

**Priority:** P0 = must-have this cycle · P1 = should-have · P2 = nice-to-have/deferred.

**Interior / Fit-Out (P0)**
- As a **PM**, I want to create an interior project on a unit and move it through 7 phases, so the fit-out is tracked in-system. *(P0)*
- As a **PM**, I want Procurement/Execution blocked until the shell is complete, so we don't start fit-out too early. *(P0)*
- As **Finance**, I want interior costs reported as a separate TI category, so they never mix with construction. *(P0)*
- As a **PM**, I want city-approval and handover documents required to advance, so handover is never undocumented. *(P0)*
- As a **PM**, I want to log sub-contractor invoices against an interior project, so spend rolls into cashflow. *(P1)*
- As **Construction**, I want a punch list with photos I can update on my phone, so snags are closed before handover. *(P1)*

**Sale Payment Schedule (P0)**
- As **Sales**, I want to set up a buyer's installment schedule from a template in a couple of clicks, so I actually maintain it. *(P0)*
- As **Sales**, I want installments to follow construction milestones, so due-dates track reality automatically. *(P0)*
- As the **Founder**, I want a "receivables next 2/4 weeks" view, so I know how much cash is coming in. *(P0)*
- As **Finance**, I want overdue-payment alerts, so I can chase buyers. *(P0)*
- As **Finance**, I want to log partial payments, so commercial draws are represented accurately. *(P1)*

**Broker / Daily logs / Leads (P1–P2)**
- As **Sales**, I want broker-sourced leads attributed and commissions computed on close, so I can measure brokers. *(P1)*
- As **Construction**, I want to post a daily log with photos from my phone, so progress and files are easy to find. *(P1 — #1 pain)*
- As **Marketing**, I want *Potential* and *Site Visit* funnel stages and one-lead-to-many-units, so the pipeline matches reality. *(P2)*

**Auth & roles (P0–P1)**
- As **any user**, I want to edit my own name and avatar, so I'm not dependent on an admin. *(P1)*
- As a **Founder**, I want to restrict some roles to assigned projects only (if we choose that), so visibility matches responsibility. *(P0 decision)*
- As **Finance**, I want to be prompted to enable MFA, so financial data is protected. *(P1)*

---

## 8. Data Model Changes

All **additive** — no destructive changes (TDD §5). Single combined migration `interior_and_sale_payments`,
then incremental migrations per later phase.

**New models:** `InteriorProject`, `InteriorScopeItem`, `InteriorInvoice`, `SnagItem`, `SalePayment`,
`Broker`, `DailyLog` (+`DailyLogPhoto`), `LeadUnitInterest`, optional `UnitGroup`.

**New enums:** `InteriorPhase` (7), `InteriorStatus`, `InteriorContractType`, `SnagStatus`,
`SalePaymentStatus`, `SalePaymentTrigger`.

**Enum extensions:** `DocCategory` (+`CITY_APPROVAL`, +`HANDOVER_CERTIFICATE`); `NotificationType`
(+`INTERIOR_PHASE_CHANGED`, +`INTERIOR_HANDOVER_DUE`, +`SNAG_OVERDUE`, +`PAYMENT_DUE_7`, +`PAYMENT_OVERDUE`);
`LeadStatus` (+`POTENTIAL`, +`SITE_VISIT`).

**Back-relations:** add to `Unit`, `Building`, `Sale`, `Lease`, `Milestone`, `Vendor`, `Document`, `User`
(see TDD §4.4 for the exact list). Full Prisma sketches are in [TDD_Interior_and_SalePayment.md](TDD_Interior_and_SalePayment.md) §4.

---

## 9. Technical Constraints

> **Stack note:** This project **overrides** the Asan default (Flutter/Supabase/Razorpay). Prime Tracker is:

| Layer | Technology |
|---|---|
| Backend | **NestJS** modular monolith · **Prisma v5** · **PostgreSQL** |
| Eventing | in-process typed `EventBus` (`common/events`) — no module-to-module imports |
| Scheduling | `@nestjs/schedule` `@Cron` (daily 8AM CT) |
| Files | Supabase Storage via `StorageService` (presigned upload) |
| Encryption | AES-256-GCM (`EncryptionService`) for sensitive fields |
| Frontend | **React 18 + Vite** · **HeroUI** · **TanStack Query v5** · Zustand · Tailwind v4 · Recharts |
| Auth | Google OAuth (domain-restricted) + JWT (15m/7d, rotated) + MFA TOTP |
| Queues | BullMQ + Redis |
| Money | `Decimal(14,2)` everywhere; invoice↔Actual & payment writes in `$transaction`; **no floats** |

**Hard constraints:** USD only; single approval (no dual-approval); same PM (no new role); additive migrations
only; reuse existing event bus / notifications / storage / exceptions / budget tables.

---

## 10. Phased Delivery Plan

Three parallel tracks (**A** Features · **B** Design System & Frontend · **C** Code Quality & Review) across
**7 phases**. Detail in [PHASED_DELIVERY_PLAN.md](PHASED_DELIVERY_PLAN.md); the SOW commits ~10 weeks for the
headline (Interior + SalePayment) train.

| Phase | Theme | Headline output |
|---|---|---|
| **0** | Discovery, foundation, baseline | Resolve 🔴 questions; design audit + tokens; CI review gate; RLS-posture decision |
| **1** | Interior foundation + SalePayment core 🔴 | Combined migration; 7-phase workflow + soft gate; milestone-linked installments; first design-system screens |
| **2** | Interior financials + cashflow truth 🔴 | Isolated TI budget; sub-contractor invoices; real cashflow inflows; receivables view |
| **3** | Snagging, handover, doc-gates + sale lifecycle 🟠 | Punch list; document gates; Interior Portfolio; **sale-cancellation reversal**; overdue cron |
| **4** | Broker + daily construction logs 🟠 | Broker model + commissions + report; mobile daily-log photo capture (#1 pain); lead-funnel stages |
| **5** | Frontend design refresh (full sweep) | Apply design system app-wide; mobile/responsive polish; accessibility pass |
| **6** | Integrations & hardening (gated) | BuilderTrend↔Bill.com PO bridge; QuickBooks go-live; WhatsApp; optional PWA/offline |

**Every phase ends with a review gate** (lint, typecheck, tests on new logic, diff review). Phase 0 is
non-negotiable first — the red questions change scope.

---

## 11. Product Brainstorming — Open Decisions & Options

*(The `/product-brainstorming` lens — decisions that shape the build, with a recommendation each. None block
signature; all resolve at M0/kickoff.)*

1. **Interior budget storage** — reuse `BudgetLine`/`Actual` + `interiorProjectId` discriminator (less code) **vs** separate tables (cleaner statements). → **Recommend reuse + discriminator + TI as a top-level reporting category** (already converged).
2. **Unit-group UX** — after merge, keep originals visible (badge/overlay) **vs** fully replace with one record. Legal outcome = merge; confirm the operational Buildings-tab view. → **Wireframe before build.**
3. **BuilderTrend / Bill.com** — full sync **vs** just kill manual PO re-entry; depends on API tier (F24). → **Scope to "kill re-entry" first**; size full sync only if APIs allow.
4. **City Approval** — gating block to Procurement **vs** tracked status only; approver of record (C11). → **Recommend tracked + soft-gate via the city-approval document**, not a hard person-block.
5. **Deposit handling** — fold `Sale.depositAmt` into the schedule as the `ON_SIGNING` row (cashflow sees it) **vs** keep separate (D16). → **Recommend fold-in**, keep `depositAmt` as a denormalized convenience.
6. **`payment:log` scope** — Finance/Accounting only **vs** Sales too (D17). → **Recommend Finance/Accounting/AR-AP**; revisit if Sales needs it.
7. **Project visibility** — everyone sees all **vs** assignment-scoped (G30). → **Decision required** — scope-affecting; recommend assignment-scoping for CONSTRUCTION/SALES via `ProjectMember`, all-visible for leadership/finance.
8. **Interior contract encryption** — AES like loans **vs** plain (C13). → **Recommend AES** for parity if values are commercially sensitive; cheap to add.
9. ~~**Schedule templates**~~ — ✅ **CLOSED 2026-08-14.** Prime confirmed 10/40/50 and 30/40/30, plus a customise option. All three were already built (`PAYMENT_TEMPLATES`, `applyTemplate`, and `addPayment` for bespoke installments) — no work required.
10. **WhatsApp provider** — Twilio (easier) **vs** Meta (cheaper at scale) — only when prioritized; needs a verified business account.
11. **Investor operating model** — equity per-project vs portfolio; capital-call/distribution process (B6–B8) — **blocks any investor-module enhancement**; gather before committing line items.
12. **Data migration** — volume/format/horizon unknown (A1–A5) — **could insert a dedicated migration sub-phase**; size after answers.

---

## 12. Out of Scope (this update cycle)

- Broker commission tracking, unit-grouping, daily logs, BuilderTrend/Bill.com, WhatsApp, sale cancellation refund/penalty workflow → **only insofar as the signed SOW defers them**; this PRD plans them across Phases 3–6, but the **committed SOW** (Interior + SalePayment) explicitly scopes Broker, Unit-groups, Daily logs, BuilderTrend/Bill.com, WhatsApp, and cancellation-refund as **out of scope of the first engagement** (separate/future). See [SOW §2.2](SOW_Prime_Tracker_Interior_and_SalePayment.docx).
- Multi-currency (USD only).
- Multi-tenant `tenantId` (commented in schema; multi-**org** already live).
- Buyer **CLIENT** portal (Phase 2; enum + `isClientVisible` flag exist, UI not built).
- Real-time / WebSocket push (notifications poll every 30s).
- PDF export of reports.
- Historical data migration of interior/payment records (quote separately, pending A1–A5).

---

## 13. Definition of Done

A phase is "done" when:
- Acceptance criteria for its user stories pass in a demo to the client champion.
- New business logic has unit + e2e tests; **≥ 80%** coverage on money paths (payments, invoices, state machine).
- The review gate passes (lint, typecheck, diff review); migration is additive and `prisma migrate status` is clean.
- New screens use the design-system tokens; mobile/responsive verified for field-facing screens.
- CLAUDE.md + the relevant design doc are updated.

The **engagement** is done when: an interior project completes all 7 gated phases; a sale carries a
milestone-linked schedule that drives a real cashflow projection and overdue alerts; cancelling a sale frees its
unit; brokers and daily logs are live; and (gated) manual PO re-entry is eliminated with QuickBooks verified.

---
*Asan Innovators — Building Beyond Boundaries*
*Confidential — Asan Innovators © 2026*
