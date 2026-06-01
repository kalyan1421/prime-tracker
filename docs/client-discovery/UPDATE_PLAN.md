# Prime Tracker — Post-Discovery Update Plan

**Status:** Draft for review
**Date:** 2026-05-30
**Input:** Client-returned discovery workbook (`Prime_Tracker_Client_Discovery (1).xlsx`, sheets 1–6 now filled)
**Method:** Each client answer compared against the *actual* codebase (Prisma schema + NestJS modules + React pages), not the CLAUDE.md description (which is now stale — the system has grown well beyond it).

> **Important context:** This plan is analysis only. No application code was changed to produce it.
> The previous gap analysis (`PRIME_TRACKER_REQUIREMENTS_ANALYSIS.md`, Excel sheets 7 & 8) was written
> *before* the client replied. This document supersedes it with (a) verified build status and
> (b) the client's real answers folded in.

---

## 1. Executive Summary

The big headline: **most of the originally-scoped "gaps" are already built.** Investors, document vault,
campaigns + attribution, cashflow forecast, draw approval workflow, contracts/vendors, QuickBooks REST
sync, email notifications, tasks, exceptions (delay/blocker) tracking, expanded roles, and milestone photos
all exist in the current schema and modules.

After reconciling against client answers, the **true remaining work** clusters into one large new module and
a handful of targeted additions:

| # | Work item | Priority | Effort | Why (client answer) |
|---|-----------|----------|--------|---------------------|
| A | **Interior / Fit-Out module** (entirely new) | 🔴 HIGH | High | Sheet 3 fully answered — this is a core part of Prime's business and does not exist at all |
| B | **Sale payment schedule** (installments tied to milestones) | 🔴 HIGH | Medium | "clients pay in installments linked to construction milestones" — Sale stores only a total today |
| C | **Broker model + commission tracking + broker report** | 🟠 MED | Medium | Brokers bring leads; "track broker performance" + commissions; only a `BROKER` enum value exists |
| D | **Unit Groups / combined commercial spaces** | 🟠 MED | Medium | "two+ adjacent units combined… merge into 1 unit"; no grouping concept today |
| E | **Snagging / punch list** | 🟠 MED | Medium | "Punch list" named explicitly; part of interior handover |
| F | **Daily construction logs (photos)** | 🟠 MED | Medium | **#1 pain point** — "daily logs with pictures" for construction |
| G | **BuilderTrend ↔ Bill.com bridge** (PO auto-entry) | 🟠 MED | High | **Top manual-effort pain point** — "enter PO number manually from BuilderTrend to Bill.com" |
| H | **WhatsApp notifications** | 🟢 LOW | Medium | Wanted "Email and inside app" → email + in-app already done; WhatsApp is future |
| I | **Lead pipeline stage tweaks** (+ multi-unit interest) | 🟢 LOW | Low | Client funnel adds *Potential* and *Site Visit* stages; one lead ↔ many units |
| J | **Mobile / offline polish (PWA)** | 🟢 LOW | Medium | Mobile use = yes, slow internet "sometimes" |

Recommended sequencing is in §6.

---

## 2. What Is Already Built (do NOT rebuild)

Verified present in `apps/api/prisma/schema.prisma` + `apps/api/src/modules/` + `apps/web/src/pages/`:

| Client topic | Status | Where |
|---|---|---|
| Project → Building → Unit hierarchy | ✅ Built | `Building`, `Unit` models; building-level phases |
| Raw-land lots (acreage, no units) | ✅ Built | `BuildingType.LOT`, `Building.acreage` |
| Lease "pending" / owner-occupied states | ✅ Built | `UnitStatus.LEASE_PENDING`, `LeaseStatus.OWNER_OCCUPIED` |
| Milestones + dependencies + photos | ✅ Built | `Milestone.dependsOnId`, `MilestonePhoto` |
| Delay / blocker / exception log | ✅ Built | `exceptions` module (`forPortfolio`, `forProject`) |
| Documents + versioning + categories + client-visible flag | ✅ Built | `Document`, `DocumentVersion`, `StorageService` (Supabase), presigned upload |
| Permit / contract / drawing doc categories | ✅ Built | `DocCategory` enum (PERMIT, CONTRACT, DRAWING, LOI, DEED, NOC…) |
| Leads + activities + assignment + conversion | ✅ Built | `leads` module, `Lead`, `LeadActivity`, `convertToSale` |
| Campaigns + spend + UTM attribution | ✅ Built | `campaigns` module, `Campaign`, `CampaignSpend` |
| Sales pipeline + weighted forecast + lost reasons | ✅ Built | `Sale`, `LostReason`, `expectedCloseDate` |
| Loans + draw requests + multi-step approval + draw schedule + draw docs | ✅ Built | `draws` module, `DrawApproval`, `DrawSchedule`, `DrawDocument` |
| Budget lines + revisions + categories | ✅ Built | `BudgetLine`, `BudgetRevision`, `BudgetCategory` |
| Cashflow forecast (inflow/outflow, burn rate, monthly) | ✅ Built | `cashflow` module, `getForecast` |
| Commitments (vendor) + contracts + change orders + contract payments | ✅ Built | `Commitment`, `Contract`, `ChangeOrder`, `ContractPayment`, `vendors` module |
| Investors + equity + capital calls + distributions | ✅ Built | `investors` module, `Investor`, `EquityPosition`, `CapitalCall`, `Distribution` |
| QuickBooks OAuth + sync (vendors/bills/payments) | ✅ Built (real REST) | `quickbooks` module — needs live credentials + verification |
| In-app + **email** notifications (SMTP) | ✅ Built | `notifications` module, nodemailer transporter |
| Notification triggers (overdue milestone, lease expiry, loan maturity, budget variance, new lead) | ✅ Built | `NotificationType` enum, `scheduled-notifications.service` |
| Expanded roles | ✅ Built | `UserRole`: SUPER_ADMIN, EXECUTIVE, FINANCE, ACCOUNTING, AR_AP, PM, CONSTRUCTION, SALES, MARKETING, LEGAL, VIEWER, CLIENT |
| Multi-org / 2 locations (US + India) | ✅ Built | `Organization`, `OrgMembership`, `organizations` module |
| Tasks + comments + attachments | ✅ Built | `tasks` module |
| Reports: portfolio, sales, revenue, debt, unit-sales, vacancy | ✅ Built | `reports` module |
| Role dashboards (Founder / Finance / Sales / Construction / Lead) | ✅ Built | `FounderDashboardPage`, `FinanceDashboardPage`, etc. |
| USD currency | ✅ Matches | single-currency formatting already in place |

**Implication for the contract/estimate:** scope the *remaining* items in §1, not the full sheet-7 list.

---

## 3. Gap Detail — What Still Needs Building

### A. Interior / Fit-Out Module 🔴 HIGH (the big one)
Client (Sheet 3) confirmed an entire fit-out workflow that **does not exist in the schema** (no `InteriorProject`,
no interior phases, no snagging, no interior budget).

Client answers to design against:
- **Trigger:** after shell completion / after contract signed; *cannot* run parallel to main construction.
- **Optional** per client; mostly custom, with 2–3 generic package options.
- **Same PM** manages interiors → **no new INTERIOR_PM role needed.**
- Prime sources all materials; uses **sub-contractors**.
- Priced **per sqft**; interior cost is part of the contract agreement.
- **Phases:** Design → Client Approval → **City Approval** → Procurement → Execution → Snag → Handover.
- Design approved by construction team + city.
- **Separate budget line** for interior vs construction (must not mix).
- Track **sub-contractor invoices** per interior project.

Build:
1. `InteriorProject` model — linked to a Unit (and/or UnitGroup); fields: status, phase, contractType=`PER_SQFT`, ratePerSqft, contractValue, PM, start/end dates.
2. `InteriorPhase` enum: `DESIGN → CLIENT_APPROVAL → CITY_APPROVAL → PROCUREMENT → EXECUTION → SNAGGING → HANDOVER`.
3. Interior budget & actuals isolated from construction (reuse `BudgetLine`/`Actual` with an `interiorProjectId` discriminator — simpler — *see open question §5*).
4. Optional BOQ / scope items + 2–3 reusable package templates.
5. Sub-contractor invoice tracking per interior project (reuse `Vendor` + a contract-payment-style child).
6. Interior portfolio view (phase, budget vs actual, days-to-handover).

### B. Sale Payment Schedule 🔴 HIGH
`Sale` stores only `salePrice` + `depositAmt`. Client confirmed **installments linked to construction milestones.**
Build a `SalePayment` child table: installment amount, due date / linked milestone, paid date, status; overdue alerts via existing notifications.

### C. Broker / Referral Tracking 🟠 MED
Only `LeadSource.BROKER` + `CampaignChannel.BROKER` exist (string-level). Client: brokers bring leads, wants
**broker performance report** + commission tracking; discount approval = Founder/Co-Founder.
Build a `Broker` model (name, company, phone, commissionRate), attribute leads/sales to brokers, commission calc on close, and a broker-performance report. **Internal-only — no broker login** (client said sub-contractors/externals get no access).

### D. Unit Groups / Combined Commercial Spaces 🟠 MED
Client: adjacent units can combine into one space and **merge into a single legal unit.** No grouping today.
Because the legal outcome is *merge into one*, the simplest model is a "combine" operation that produces one
unit (retaining child unit history) rather than a long-lived overlay group — **confirm UX in §5.**

### E. Snagging / Punch List 🟠 MED
Named explicitly ("Punch list"). `SnagItem`: description, room, assignee, status (OPEN/IN_PROGRESS/RESOLVED),
photo, resolvedAt — linked to InteriorProject (and reusable on construction milestones).

### F. Daily Construction Logs with Photos 🟠 MED — **#1 pain point**
`MilestonePhoto` exists but there's no dedicated daily-log feed. Build a `DailyLog` (date, author, notes, weather/crew optional) with multiple photos, scoped to project/building — mobile-first capture.

### G. BuilderTrend ↔ Bill.com Bridge 🟠 MED (new — not in original sheet 7)
**Top time-waster:** "enter PO number manually from BuilderTrend to Bill.com." Client stack is QuickBooks +
Bill.com + BuilderTrend. Scope a small integration/import that carries PO numbers across (or at least a
CSV/API import that eliminates re-keying). Needs API access confirmation for both tools.

### H. WhatsApp Notifications 🟢 LOW
Email + in-app already satisfy the stated need ("Email and inside app"). WhatsApp is "maybe future" — defer.
When needed: add a channel to `notifications` (Twilio vs Meta — open question §5).

### I. Lead Pipeline + Multi-Unit Interest 🟢 LOW
- Client funnel adds **Potential** and **Site Visit** stages → extend `LeadStatus` (`POTENTIAL`, `SITE_VISIT`).
- One lead ↔ many units and one unit ↔ many leads (waitlist/demand). Current `Lead.unitId` is single → add a
  `LeadUnitInterest` join table. (Low priority — qualify-first fields client collects are just name/phone/email.)

### J. Mobile / Offline (PWA) 🟢 LOW
Construction uses phones on site, internet "sometimes" slow. App is responsive; add PWA install + light
offline caching for read-heavy screens and queued photo upload. Defer unless prioritized.

---

## 4. Dev Clarifications — Now Resolved by Client (Sheet 8)

| Q | Client answer → decision |
|---|---|
| Interior managed by same PM or new role? | **Same PM** → no `INTERIOR_PM` role. |
| Unit group: new model or merge? | **Merge into 1 legal unit** → favor a combine operation, keep child history. |
| Broker login (external portal) vs internal field? | Externals get no access → **internal-only broker tracking.** |
| Sale payments: child table vs fields? | Installments tied to milestones → **child `SalePayment` table.** |
| Interior contract pricing | **Per sqft.** |
| Interior can run parallel to construction? | **No** — starts after shell completion. |
| Currency | **USD only** → no multi-currency work. |
| Notification channels | **Email + in-app** (both built); WhatsApp later. |
| Dual approval for payments? | **No** — single approval (Founder/Co-Founder for draws & discounts). |

---

## 5. Open Questions Still Needing Client Input

1. **Interior budget storage** — reuse BudgetLine/Actual with `interiorProjectId` (less code) vs separate tables (cleaner reporting)? Recommend reuse + discriminator unless finance wants fully isolated statements.
2. **Unit-group UX** — when two units merge, should the originals still be visible (badge/overlay) or fully replaced by one record? (Legal said merge; confirm operational view for Buildings tab — wireframe before build.)
3. **BuilderTrend & Bill.com** — do they have API access / which plan tier? Is the goal full sync or just kill the manual PO re-entry? Sizing depends on this.
4. **City Approval step** — is it a gating approval (blocks next phase) or just a tracked status? Who is the approver of record?
5. **WhatsApp (if/when)** — Twilio (easier) vs Meta (cheaper at scale)? Business account verified?
6. **Investors** — equity per-project or portfolio-wide? Capital-call / distribution process detail (Sheet 4 Q9–11 left blank).
7. **Data migration** — Sheet 6 migration questions are blank: how much history, what format, how far back? Needed to size migration effort.
8. **Interior contract value encryption** — sensitive enough to AES-encrypt like loans? (Sheet 8 Q14.)
9. **Document checklist gates** — extend draw-style checklists to sales stages + interior phases + milestone completion? (Client: "documents must be present before milestone complete" = yes for permits.)

---

## 6. Recommended Delivery Plan (phased)

**Sprint 1 — Interior foundation (🔴):** `InteriorProject` + `InteriorPhase` + interior budget/actuals + interior portfolio view. (Item A core.)

**Sprint 2 — Interior completion + snagging (🔴/🟠):** BOQ/packages, sub-contractor invoices, `SnagItem` punch list, interior documents + handover certificate. (A finish + E.)

**Sprint 3 — Sales depth (🔴/🟠):** `SalePayment` installment schedule tied to milestones + overdue alerts; sale cancellation/reversal flow; discount-approval chain. (B.)

**Sprint 4 — Broker + construction logs (🟠):** `Broker` model + commission calc + broker performance report; `DailyLog` with photo feed (addresses #1 pain point). (C + F.)

**Sprint 5 — Unit groups + lead polish (🟠/🟢):** unit combine/merge operation + UX; `LeadStatus` new stages + `LeadUnitInterest`. (D + I.)

**Backlog / future:** BuilderTrend↔Bill.com bridge (G, pending API access), WhatsApp channel (H), PWA/offline (J), QuickBooks live-credential go-live verification.

---

## 7. Schema Changes Summary (for migration planning)

New models: `InteriorProject`, `InteriorScopeItem`(opt), `SnagItem`, `DailyLog`(+`DailyLogPhoto`), `SalePayment`, `Broker`, `LeadUnitInterest`, optional `UnitGroup`.
New enums: `InteriorPhase`, `InteriorContractType`, `SnagStatus`.
Enum extensions: `LeadStatus` (+`POTENTIAL`, +`SITE_VISIT`); `Sale`/lead broker FK; `NotificationType` (+ interior/payment-due triggers).
All additive — no breaking changes to existing tables. Run `prisma migrate status` before writing new migrations (schema currently validates clean: ✅).

---

## 8. Notes / Risks

- **CLAUDE.md is stale.** It describes ~18 modules; the repo has ~38 modules and far more models. Update it after this round so future planning starts from reality.
- **QuickBooks** code is real (OAuth + REST sync) but unverified against live credentials — treat go-live as a task, not new build.
- **Bill.com / BuilderTrend** are net-new integrations the original analysis didn't capture; they map to the client's loudest pain points, so worth scoping early even if delivered late.
- Several **Sheet 4 (investors/capital calls)** and **Sheet 6 (migration)** cells are blank — follow up before committing those line items.
