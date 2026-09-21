# Leads Board + Site-Visit Scheduling — Spec

**Date:** 2026-09-21
**Status:** Draft for client sign-off
**Scope:** `/leads`, `/leads/dashboard`, role dashboards, new site-visit scheduling module

---

## 0. Summary

Three things in one train, because they share the Lead record and ship badly if split:

1. **Site-visit scheduling** (the new build) — the Founder/Admin publishes availability, Sales/Marketing books an open slot against it, the Founder confirms or rejects, and pending requests surface on the main dashboard as an attention card.
2. **Leads board parity with the monday.com CRM** — spreadsheet grid *alongside* today's card list, the three missing columns (Followup Date, VIA, Team owner), a visits/follow-ups calendar, and a per-lead conversation thread.
3. **Call tracking** — how many times a lead was called, when the last call was, with notes, and a per-lead calendar for back-dating a call onto the day it actually happened.

Plus a campaign filter on the leads list, which the audit below shows is **already built on the backend and simply unreachable from the UI**.

---

## 1. Audit — what already exists

This section exists because most of what looks like new work is not. Verified against the codebase on 2026-09-21.

### Already built and working

| Thing | Where | Note |
|---|---|---|
| `Lead.campaignId` + `campaign` relation + index | `apps/api/prisma/schema.prisma` | Full attribution incl. `utmSource/Medium/Campaign/Content` |
| `GET /api/leads?campaignId=` | `leads.controller.ts:43`, `leads.service.ts` (`if (campaignId) where.campaignId = campaignId`) | Filter works end-to-end on the API |
| **"Ask for the ads campaign when adding a lead"** | `LeadsPage.tsx:661` — `label="Campaign"` select | **Already done.** No work needed. |
| Campaign chip on each lead row | `LeadsPage.tsx` — amber chip, `FiBarChart2` | Already renders the campaign name |
| `useCampaigns()` hook | `useApi.ts:1615` | Gated on `campaign:view` |
| `campaign:view` for SALES and MARKETING | `packages/shared/src/types/index.ts` | **Both roles have it** — no permission work for the filter |
| `SITE_VISIT` as a lead status | `custom-options.service.ts` — `lead_status` catalogue | Already in the funnel, admin-editable |
| `SITE_VISIT` as an activity type | `LeadActivityType` enum | Logs a visit that *happened* — not a booking |
| `CALL` activity type + note + author + timestamp | `LeadActivity` model | **Call tracking needs no new table** — see §6.3 |
| Approval-gate pattern | `HistoricalRecordDeletion` model | `requestedBy → decidedBy/decidedAt/decisionNote`. Copy this shape for site visits. |
| Attention-card component | `apps/web/src/components/ExceptionFeed.tsx` | `ExceptionItem` / `ExceptionRow`, severity critical/warning/info. The "eye focus" card reuses this. |
| Notification tiers + leadership routing | `notifications.service.ts` — `NOTIFICATION_TIERS`, `LEADERSHIP_ROLES`, `sendToRoles` | ACTION = in-app + email; FYI = in-app only |
| Pagination / grouping hooks | `usePagination.ts`, `useCollapsibleGroups.ts` | Built for exactly this during the list-scale fix |

### Gaps — the actual work

| Gap | Where | Size |
|---|---|---|
| `useLeads()` params type **omits `campaignId`** | `useApi.ts:1532` | **One line.** TypeScript is the only thing blocking the campaign filter. |
| No campaign filter control on the list | `LeadsPage.tsx:839–895` (search / assignee / broker only) | Small |
| **`source` is a phantom filter** | `useLeads()` accepts `source?: string`; `leads.controller.findAll` and the service **never read it** | **Bug.** Filtering by source today silently returns *every* lead. |
| Status filter is a chip strip, not a dropdown | `LeadsPage.tsx:896+` "Pipeline strip" | Small — but see the concern in §8.1 |
| No `followUpDate` on Lead | schema | Migration |
| No `via` field on Lead | schema | Migration + `lead_via` catalogue |
| No spreadsheet grid view | — | Medium |
| No calendar view | — | Medium |
| No per-lead conversation thread | — | Medium |
| No back-dating on activities | `LeadActivity` has `createdAt` only | Migration — blocks the per-lead call calendar |
| **No availability, slot, or booking model anywhere** | — | **Large. Entirely net-new.** |

---

## 2. Problem statement

When a lead asks to see a property, the request leaves the system. A Sales or Marketing rep has no view of when the Founder is free, so scheduling happens over phone and WhatsApp; the Founder learns about a visit when it is already promised, double-bookings are caught by accident, and a visit that gets missed or rescheduled leaves no trace. Nothing on any dashboard says "someone is waiting on you to confirm a viewing."

The same blind spot runs through follow-up: the team tracks call history in their heads or in the monday board, so nobody can answer "how many times have we called this lead, and what came of it" without asking the rep.

Cost of leaving it: the Founder is the bottleneck on every viewing and has no queue; leads go cold between "yes I'd like to see it" and an actual date; and the call history that would justify marking a lead DEAD lives nowhere.

---

## 3. Locked decisions (client, 2026-09-21)

| # | Decision |
|---|---|
| D1 | **Founder/Admin publishes availability. Sales books an open slot. The booking sits PENDING until the Founder confirms or rejects.** |
| D2 | **Founder/Admin is the only host in v1.** One shared leadership availability calendar. |
| D3 | **Internal only.** No automated email or WhatsApp to the lead in v1. The rep tells the lead by phone as they do today. |
| D4 | **Both views.** The spreadsheet grid is added *alongside* the existing card list, not instead of it. |
| D5 | Track **call count** and **last call with its note** per lead. |
| D6 | Per-lead **calendar**: tapping a date logs a call on that date with a note (back-dating). |
| D7 | **Reschedule** must be a first-class action when a visit is missed or the Founder becomes unavailable. |
| D8 | Status filter becomes a **dropdown**; campaign names render as **chips**. |

---

## 4. Goals

1. A site-visit request reaches the Founder and gets a confirm/reject decision **inside the tracker**, with the pending queue visible on the dashboard — target median time-to-decision under 4 working hours.
2. **Zero double-bookings.** Two reps cannot hold the same slot; enforced at the database level, not in the UI.
3. Any rep can answer "when did we last speak to this lead, how many times, and what was said" in **one click, without asking anyone**.
4. A missed or moved visit is **rescheduled, not lost** — every visit ends in a recorded terminal state (Completed / No-show / Cancelled / Rescheduled).
5. The leads list answers "show me everything from this ads campaign" — and the existing monday board becomes redundant rather than parallel.

---

## 5. Non-goals

| Not doing | Why |
|---|---|
| Lead-facing booking page or self-service slot picking | No buyer portal is live for leads. D3 keeps v1 internal; a public booking page is a separate security and consent surface. |
| Automated email/WhatsApp to the lead | D3. SMTP is built, but outbound to external addresses needs verified-email handling, opt-out, and a reschedule path — that is its own phase. |
| Google Calendar / ICS two-way sync | Workspace SSO already exists so this is *feasible*, but two-way sync means conflict resolution and token refresh. Deferred to P2; the data model is designed not to block it. |
| Multiple hosts / rep-led viewings | D2 fixes v1 to the Founder. The `hostId` column is on the model from day one so opening it up later is a permission change, not a migration. |
| Replacing the card list with the grid | D4 — explicitly both. |
| Routing / travel-time optimisation between visits | Premature. Revisit once there is real booking volume. |

---

## 6. Data model

### 6.1 Availability (new)

```prisma
model VisitAvailability {
  id            String    @id @default(cuid())
  hostId        String
  host          User      @relation("VisitHost", fields: [hostId], references: [id], onDelete: Cascade)
  /// OPEN = bookable window. BLOCKED = carve-out that beats any overlapping OPEN rule.
  kind          String    @default("OPEN")
  /// Recurring weekly rule: 0=Sun..6=Sat. Exactly one of (dayOfWeek, date) is set.
  dayOfWeek     Int?
  /// One-off date, used for both ad-hoc openings and blackout days.
  date          DateTime? @db.Date
  /// Minutes from local midnight, in `timezone`. NOT a DateTime — a recurring rule has
  /// no absolute instant, and storing one is what makes schedules drift across DST.
  startMin      Int
  endMin        Int
  /// Slot granularity this window is cut into.
  slotMinutes   Int       @default(60)
  timezone      String    @default("America/Chicago")
  effectiveFrom DateTime? @db.Date
  effectiveTo   DateTime? @db.Date
  note          String?
  createdBy     String
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([hostId, dayOfWeek])
  @@index([hostId, date])
  @@map("visit_availability")
}
```

**Why minutes + named timezone, not a DateTime:** a recurring "Tuesdays 10:00–16:00" has no absolute instant, and storing one means the window silently shifts an hour at every DST boundary. Concrete bookings (§6.2) *are* absolute UTC. This split is deliberate — see the TZ trap in §13.

### 6.2 SiteVisit (new)

```prisma
model SiteVisit {
  id                String    @id @default(cuid())
  leadId            String
  lead              Lead      @relation(fields: [leadId], references: [id], onDelete: Cascade)
  /// Denormalised for dashboard scoping and project-access filtering without a join.
  projectId         String
  project           Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  /// What they are coming to see. At most one of (unitId, buildingId) — the same
  /// polymorphic rule the service layer already enforces on Lead/Sale/Lease.
  unitId            String?
  unit              Unit?     @relation(fields: [unitId], references: [id], onDelete: SetNull)
  buildingId        String?
  building          Building? @relation(fields: [buildingId], references: [id], onDelete: SetNull)

  hostId            String
  host              User      @relation("SiteVisitHost", fields: [hostId], references: [id])

  /// Absolute instants. The local wall-clock time is derivable from `timezone`.
  startsAt          DateTime
  endsAt            DateTime
  timezone          String    @default("America/Chicago")

  /// REQUESTED | CONFIRMED | REJECTED | CANCELLED | RESCHEDULED | COMPLETED | NO_SHOW
  status            String    @default("REQUESTED")

  requestedById     String
  requestedBy       User      @relation("SiteVisitRequester", fields: [requestedById], references: [id])
  requestedAt       DateTime  @default(now())
  requestNote       String?

  decidedById       String?
  decidedBy         User?     @relation("SiteVisitDecider", fields: [decidedById], references: [id], onDelete: SetNull)
  decidedAt         DateTime?
  decisionNote      String?

  /// Reschedule chain. The old row goes terminal at RESCHEDULED and the new row points
  /// back at it — history is appended, never restated.
  rescheduledFromId String?    @unique
  rescheduledFrom   SiteVisit? @relation("VisitReschedule", fields: [rescheduledFromId], references: [id], onDelete: SetNull)
  rescheduledTo     SiteVisit? @relation("VisitReschedule")
  rescheduleReason  String?

  outcomeNote       String?
  completedAt       DateTime?

  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([hostId, startsAt])
  @@index([status, startsAt])
  @@index([leadId])
  @@index([projectId, startsAt])
  @@map("site_visits")
}
```

**Lifecycle:**

```
REQUESTED ──confirm──> CONFIRMED ──> COMPLETED | NO_SHOW
    │                      │
    ├──reject──> REJECTED  ├──cancel──> CANCELLED
    │                      │
    └──────── reschedule ──┴──> RESCHEDULED (terminal) + new REQUESTED row
```

**Double-booking guard (P0, DB-level).** A partial unique index Prisma cannot express — raw SQL in the migration:

```sql
CREATE UNIQUE INDEX site_visits_host_slot_active
  ON site_visits (host_id, starts_at)
  WHERE status IN ('REQUESTED', 'CONFIRMED');
```

A `REQUESTED` booking **soft-holds** the slot: the slot disappears from the picker for everyone else while it is pending. Rationale — if two reps could both request 10:00 Tuesday, the Founder would have to arbitrate between clients, which is exactly the phone-tag this feature removes. On reject or cancel, the row leaves the index predicate and the slot returns automatically.

### 6.3 Call tracking — no new table

`LeadActivity` already has `type=CALL`, `note`, `createdBy`, `createdAt`. Call count and last-call are derived:

- **Call count** = `count(LeadActivity where leadId=… and type='CALL')`
- **Last call** = most recent by `occurredAt`, with its `note` and author

One migration is required, and it is what unblocks D6:

```prisma
model LeadActivity {
  // …existing fields…
  /// WHEN IT HAPPENED, as opposed to createdAt = when it was typed in. Back-dating a
  /// call onto the day it actually occurred is impossible without this, and the per-lead
  /// calendar (D6) is exactly a back-dating UI. Backfilled to createdAt on migrate.
  occurredAt DateTime @default(now())

  @@index([leadId, type, occurredAt])
}
```

Backfill: `UPDATE lead_activities SET occurred_at = created_at;`

Everything already writing activities keeps working — `occurredAt` defaults to now, which is correct for a live-logged call.

### 6.4 Lead — three new columns

```prisma
model Lead {
  // …existing fields…
  /// monday parity: the "Followup Date" column. Date only — a follow-up is a day, not an instant.
  followUpDate DateTime? @db.Date
  /// monday parity: the "VIA" column — the ENGAGEMENT SIGNAL that produced the lead
  /// (Favorited / Downloaded OM / Viewed listing / Phone / Email lead). Deliberately
  /// NOT the same as `source`: source is the portal (LOOPNET, CREXI), via is what they
  /// did there. Backed by CustomOption category "lead_via" so it stays admin-editable.
  via          String?

  @@index([followUpDate])
}
```

**`TEAM` / owner column needs no schema change** — `Lead.assignedTo` + `assignedUser` already exist. It is purely a rendering gap (avatar instead of a name string).

New `lead_via` catalogue seeded in `custom-options.service.ts` `SYSTEM_DEFAULTS`:
`PHONE`, `EMAIL_LEAD`, `FAVORITED`, `DOWNLOAD_OM`, `VIEW_LISTING`, `WALK_IN`, `OTHER`.

### 6.5 Per-lead conversation thread

Reuse the Update Board's shape rather than inventing a second one. A `LeadComment` model mirroring `TaskComment`, and — critically — **reuse the existing `resolveMentions()` parser** from the update-board module rather than writing a second @mention parser. Notification type `LEAD_COMMENT_MENTION`, tier ACTION.

> Note: this is deliberately *not* merged into `LeadActivity`. The activity log is a structured audit of what was done to a lead (call, email, status change); a conversation is discussion *about* the lead. A prior attempt to merge comments into an activity timeline was reversed on this project for exactly this reason.

---

## 7. API surface

All under `/api`, all behind `JwtAuthGuard + PermissionsGuard + ProjectAccessGuard + AuditInterceptor`, matching every other module.

### Availability
```
GET    /api/visit-availability?hostId=            availability:view
POST   /api/visit-availability                    availability:manage
PUT    /api/visit-availability/:id                availability:manage
DELETE /api/visit-availability/:id                availability:manage
GET    /api/visit-availability/slots              siteVisit:view
       ?hostId=&from=&to=
       -> computed OPEN slots minus BLOCKED minus held slots
```

`/slots` is the one endpoint doing real work: expand recurring rules across the range, subtract BLOCKED windows, subtract any slot already held by a REQUESTED/CONFIRMED visit, and return bookable instants. **Computed, never stored** — a materialised slot table would need reconciling every time a rule changed.

### Site visits
```
GET    /api/site-visits?status=&hostId=&leadId=&from=&to=     siteVisit:view
GET    /api/site-visits/pending                               siteVisit:view
GET    /api/site-visits/:id                                   siteVisit:view
POST   /api/site-visits                                       siteVisit:request
POST   /api/site-visits/:id/confirm                           siteVisit:approve
POST   /api/site-visits/:id/reject      { reason }            siteVisit:approve
POST   /api/site-visits/:id/reschedule  { startsAt, reason }  siteVisit:request
POST   /api/site-visits/:id/cancel      { reason }            siteVisit:request
POST   /api/site-visits/:id/outcome     { result, note }      siteVisit:request
```

### Leads — additions
```
GET /api/leads?campaignId=     ALREADY WORKS — only the hook type blocks it
GET /api/leads?source=         MUST BE ADDED — currently accepted by the hook and
                               silently ignored by the service (see §1 gaps)
GET /api/leads?via=            new
GET /api/leads?followUpBefore= new
GET /api/leads/:id/calls       call count + last call + per-date roll-up for the calendar
POST /api/leads/:id/activities { type, note, occurredAt }   occurredAt is new
```

---

## 8. UI

### 8.1 Leads list — filter bar

Per D8, the current chip strip becomes a dropdown and campaigns become chips:

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Search…]  [Status ▾]  [Assignee ▾]  [Campaign ▾]  [VIA ▾]  [Clear]  │
│                                                                       │
│ Campaigns:  ( All )  ( Diwali Launch 26 · 34 )  ( Meta Q3 · 12 )  …   │
├──────────────────────────────────────────────────────────────────────┤
│                                          [ ▤ Cards ]  [ ▦ Grid ]     │
└──────────────────────────────────────────────────────────────────────┘
```

> **One concern, stated and then built as asked.** Today's status chip strip shows a live count next to every status — that at-a-glance funnel is genuinely useful and a plain dropdown loses it. Building it as requested, with the counts carried *inside* the dropdown items (`Site Visit · 12`) plus a summary on the closed trigger, so nothing is lost. If that reads badly in review, reverting to chips is a small change.

Campaign chips: name + lead count, active chip filled, click to filter, click again to clear. Multi-select is P1.

### 8.2 Grid view (D4 — alongside, not instead)

Columns mirroring the monday board: **Name · Team · Lead Source · VIA · Date · Followup Date · Email · Phone · Status · Building/Unit · Calls · Last call · Next visit**.

- Grouped by project, collapsible — reuse `useCollapsibleGroups`
- Paginated — reuse `usePagination`
- Inline-editable: Status, Followup Date, Assignee, VIA
- View preference persists per user in `localStorage`
- **Inline edits must batch.** See the throttle trap in §13.

### 8.3 Calendar view

Month grid, chips reading `Lead name | PROJECT`, coloured per project — matching the Agency Dashboard screenshot. Shows confirmed site visits and follow-up dates. Clicking a chip opens the lead. Month / Week toggle.

### 8.4 Per-lead panel — calls + visits (D5, D6)

```
┌─ Rahul Sharma ─────────── SITE VISIT ── CENTRO B2 ─┐
│  📞 Called 4 times   ·   Last: 18 Sep — "asked      │
│     for floor plan, sending Monday"                 │
│                                                     │
│  [ Log a call ]  [ Request site visit ]             │
│                                                     │
│  ◀  September 2026  ▶                               │
│  M   T   W   T   F   S   S                          │
│  1   2   3  [4]  5   6   7     ← dot = call logged  │
│  8   9  10  11 [12] 13  14                          │
│                                                     │
│  Tap any date to log a call on that day + note      │
└─────────────────────────────────────────────────────┘
```

Tapping a past date opens the note composer with `occurredAt` pre-set to that date — this is precisely why §6.3 adds the column. Dates with activity carry a dot; tapping one shows what was logged.

### 8.5 The "eye focus" dashboard card

Reuses `ExceptionFeed.tsx` — no new component vocabulary.

**Founder / Super Admin / Executive** (`FounderDashboardPage`, `DashboardPage` founder branch):

```
┌─ 👁  Site Visits — Awaiting Your Confirmation  (3) ──────────┐
│ ⚠  Rahul Sharma · CENTRO B2        Tue 24 Sep, 10:00–11:00  │
│    Requested by Priya · 2h ago · "flexible on timing"        │
│                                    [ Confirm ]  [ Reject ]   │
│ ⚠  Mark Skinner · RIO RANCH        Wed 25 Sep, 14:00–15:00  │
│ ⓘ  Jay S · LEANDER                 Fri 27 Sep, 11:00–12:00  │
└──────────────────────────────────────────────────────────────┘
```

Severity: `critical` if the visit is inside 48h and still undecided, `warning` inside 7 days, `info` beyond.

**Sales / Marketing** (`SalesDashboardPage`): their own pending requests, confirmed upcoming visits, and — the one that matters — **rejected or missed visits needing a reschedule**, at `critical`.

Card hides entirely when the list is empty. No zero-state noise on the dashboard.

---

## 9. Notifications & permissions

### New `NotificationType` values

| Type | Tier | Routed to |
|---|---|---|
| `SITE_VISIT_REQUESTED` | ACTION | Leadership (`sendToRoles` with `LEADERSHIP_ROLES`) |
| `SITE_VISIT_CONFIRMED` | ACTION | The requesting rep |
| `SITE_VISIT_REJECTED` | ACTION | The requesting rep |
| `SITE_VISIT_RESCHEDULED` | ACTION | Host + requester |
| `SITE_VISIT_TOMORROW` | FYI | Host + requester (daily 08:00 CT cron) |
| `SITE_VISIT_MISSED` | ACTION | Host + requester — confirmed visit still with no outcome **2h after `endsAt`** (Q6) |
| `LEAD_COMMENT_MENTION` | ACTION | The mentioned user |

> **Enum trap, already documented in the schema:** every value must land in the Prisma enum, the migration, **and** `NOTIFICATION_TIERS`. A value present in the DB but missing from the enum is invisible to `Object.values(NotificationType)`, so it never appears in `getPreferences()` and **users can never mute it**.

### New permissions

| Permission | SALES | MARKETING | FOUNDER / SUPER_ADMIN / EXECUTIVE |
|---|:--:|:--:|:--:|
| `siteVisit:view` | ✅ | ✅ | ✅ |
| `siteVisit:request` | ✅ | ✅ | ✅ |
| `siteVisit:approve` | — | — | ✅ |
| `availability:manage` | — | — | ✅ |

Separate `siteVisit:*` permissions rather than reusing `lead:edit`, for the same reason `siteTracker:*` was split out: approving a viewing is a leadership act, while editing a lead is day-to-day sales work. Folding approval into `lead:edit` would hand every rep the confirm button.

No campaign permission work — SALES and MARKETING already hold `campaign:view` (verified §1).

---

## 10. User stories

**Sales / Marketing rep**
1. As a rep, I want to see the Founder's open slots when a lead asks for a viewing, so I can offer a real time on the call instead of "let me check and get back to you".
2. As a rep, I want my booking to hold the slot the moment I submit it, so a colleague cannot promise the same time to a different client.
3. As a rep, I want to know the instant a request is confirmed or rejected, so the lead is not left waiting on me.
4. As a rep, I want to reschedule a missed visit in one action that keeps the original on record, so the lead's history still shows we tried.
5. As a rep, I want to log a call against the day it actually happened, so Friday's catch-up does not record three calls as having happened on Friday.
6. As a rep, I want to see call count and the last call's note on the lead, so I can pick up the conversation without reading the whole timeline.
7. As a rep, I want to filter the list to one ads campaign, so I can work a batch from one spend.

**Founder / Admin**
8. As the Founder, I want to publish my weekly availability once, so I stop being asked "are you free Tuesday".
9. As the Founder, I want pending viewing requests on my dashboard with lead, property, time and requester, so I can clear them without opening each lead.
10. As the Founder, I want to reject with a reason, so the rep knows whether to rebook or drop it.
11. As the Founder, I want to block a day when I travel, so nobody books against it.

**Marketing**
12. As a marketer, I want leads chipped and filterable by campaign, so I can see which spend produced which pipeline.

**Edge cases**
13. As a rep, when I open the picker and every slot is taken, I want to be told that plainly and offered the next open date rather than shown an empty calendar.
14. As a rep, when my request is rejected, I want it on my dashboard as needing action, not silently gone.
15. As the Founder, when I delete availability that already has confirmed visits against it, I want to be told what it affects before it applies.

---

## 11. Requirements

### P0 — must ship

**R1 · Availability management**
- Founder sets recurring weekly windows (day, start, end, slot length) and one-off OPEN or BLOCKED days
- BLOCKED always beats an overlapping OPEN rule
- `AC:` Given Tue 10:00–16:00 recurring at 60min, when the Founder blocks Tue 24 Sep, then no slots appear on 24 Sep and following Tuesdays are unaffected
- `AC:` Given availability with confirmed visits against it, when the Founder deletes it, then a confirmation names the affected visits and existing bookings survive

**R2 · Slot picker + booking**
- `/slots` returns only genuinely bookable instants (OPEN, minus BLOCKED, minus held)
- Booking creates a `REQUESTED` visit and soft-holds the slot
- `AC:` Given rep A holds 10:00 Tue, when rep B opens the picker, then 10:00 Tue is absent
- `AC:` Given two reps submit the same slot simultaneously, then exactly one succeeds and the other gets a clear "just taken" message with a refreshed picker — **enforced by the partial unique index, not by UI state**
- `AC:` Slots starting within `siteVisitMinNoticeHours` (default 6) of now are not offered
- `AC:` Changing that setting to 0 makes same-hour slots bookable without a deploy
- `AC:` The horizon is unbounded — a slot 8 months out is bookable (Q2)
- `AC:` Given no slots in range, then an explicit empty state names the next open date

**R3 · Confirm / reject**
- Founder confirms or rejects from the dashboard card or the visit detail; reject requires a reason
- `AC:` On confirm, status → CONFIRMED, `decidedById`/`decidedAt` set, requester notified
- `AC:` On reject, status → REJECTED, slot returns to the pool, requester notified with the reason
- `AC:` Only `siteVisit:approve` holders see the buttons; a direct API call without it returns 403

**R4 · Reschedule (D7)**
- Available from REQUESTED, CONFIRMED, or after a miss
- `AC:` On reschedule, the old row goes RESCHEDULED (terminal), a new REQUESTED row is created with `rescheduledFromId` pointing back, and the lead's timeline shows both
- `AC:` The original is never mutated in place — history appended, not restated

**R5 · The "eye focus" dashboard card**
- Founder/Exec/Super Admin see pending requests awaiting decision
- Sales/Marketing see their own pending + confirmed-upcoming + rejected/missed needing action
- `AC:` Each row shows lead name, property, date/time, requester, age
- `AC:` Severity escalates to critical inside 48h
- `AC:` Card is absent, not empty, when there is nothing pending

**R6 · Call tracking (D5)**
- Call count and last call + note on the lead row, panel, and grid
- `AC:` Logging a call increments the count immediately and updates "last call"
- `AC:` Counts only `type='CALL'` activities

**R7 · Per-lead call calendar (D6)**
- Month calendar on the lead panel; dates with activity are dotted; tapping a date logs a call with `occurredAt` set to that date
- `AC:` A call logged on 18 Sep while today is 21 Sep sorts into the timeline at 18 Sep
- `AC:` Future dates cannot be used for a call log
- `AC:` `createdAt` still records when it was typed — the audit trail stays honest

**R8 · Campaign filter + chips (D8)**
- Add `campaignId` to the `useLeads()` params type *(one line)*
- Campaign dropdown + chip row with counts
- `AC:` Selecting a campaign returns only its leads; the chip shows an accurate count
- `AC:` Leads with no campaign are reachable via an explicit "No campaign" option

**R9 · Fix the phantom `source` filter**
- `source` is accepted by the hook and ignored by the service — it silently returns everything
- `AC:` `GET /api/leads?source=LOOPNET` returns only LOOPNET leads
- `AC:` A regression test asserts an unknown filter key never widens the result set

**R10 · Status dropdown (D8)**
- Chip strip → dropdown, counts preserved inside the items

**R11 · New Lead fields**
- `followUpDate`, `via` on the form, list, and grid; assignee renders as an avatar
- `AC:` A follow-up date in the past shows an overdue chip
- `AC:` `via` options come from the `lead_via` catalogue and are admin-editable

**R12 · Grid view (D4)**
- Grid alongside cards, toggle persisted per user
- `AC:` Toggling preserves active filters
- `AC:` Inline edits are batched, not one request per cell

### P1 — fast follow

- **R13** Calendar view of visits + follow-ups (§8.3)
- **R14** Per-lead conversation thread with @mentions (§6.5)
- **R15** Visit outcome capture — Completed / No-show + note, prompted the morning after
- **R16** `SITE_VISIT_TOMORROW` and `SITE_VISIT_MISSED` on the existing 08:00 CT cron
- **R17** Multi-select campaign chips
- **R18** Auto-advance lead status to `SITE_VISIT` on confirmation — **directional guard per Q3**:
  advances only from upstream statuses, never overwrites `PROPOSAL_SENT`/`NEGOTIATING`/`CONVERTED`/`LOST`/`DEAD`,
  and writes a `STATUS_CHANGE` activity attributed to the confirming user
- **R19** Site-visit conversion reporting: visits → sales, by campaign

### P2 — designed for, not built

- **R20** Multiple hosts (`hostId` already on the model — a permission change, not a migration)
- **R21** Google Calendar / ICS sync (Workspace SSO already in place)
- **R22** Lead-facing confirmation + self-service reschedule link
- **R23** WhatsApp channel for visit notifications
- **R24** Travel-time buffers between consecutive visits

---

## 12. Success metrics

### Leading (days–weeks)

| Metric | Target | How |
|---|---|---|
| Visit requests made in-app | ≥ 80% of site visits within 30 days | `site_visits` count vs. `SITE_VISIT` activity logs created without a booking |
| Median time-to-decision | < 4 working hours | `decidedAt − requestedAt`, p50 |
| Requests undecided > 24h | < 10% | Count where status=REQUESTED and age > 24h |
| Double-booking collisions | **0** | Unique-index violations are logged; any non-zero is a bug |
| Leads with ≥1 logged call | ≥ 70% of active leads at 30 days | `LeadActivity type=CALL` distinct leads ÷ active leads |
| Grid view adoption | ≥ 40% of lead-list sessions | View-toggle preference |

### Lagging (weeks–months)

| Metric | Target | How |
|---|---|---|
| Visit → Under Contract conversion | Baseline at 30 days, +15% relative by 90 | Visits with a `CONVERTED` lead ÷ completed visits |
| Days from first contact to visit | −30% vs. baseline | First activity → first confirmed visit |
| Missed visits with no reschedule | < 5% | NO_SHOW/CANCELLED with no `rescheduledTo` |
| monday.com board retired | Yes by day 90 | Client confirmation — the real test of parity |

**Baseline problem, stated honestly:** there is no in-app history of site visits, so the "before" number does not exist. The first 30 days *are* the baseline; targets above are hypotheses to re-set at that point, not commitments.

---

## 13. Known traps

Hard-won on this codebase. Ignoring these costs hours.

1. **Throttle vs. bulk writes** — a 10 req/sec cap silently truncates parallel per-item write loops. Inline grid editing must go through a `/bulk` endpoint wrapped in `$transaction`, never a per-cell request loop.
2. **Timezone** — store recurring rules as local minutes + named timezone; store bookings as absolute UTC. A lease test on this repo already fails 18:30–24:00 UTC on IST machines from exactly this class of bug. Verify with `TZ=UTC` before investigating any time-related failure.
3. **Permission token staleness** — a new permission never reaches a live session. `siteVisit:*` and `availability:manage` require **re-login**; refresh returns tokens only. This must be in the rollout note or the Founder will report the confirm button missing.
4. **HeroUI `SelectItem`** — multi-expression children render a blank trigger. Any option showing `{name} · {count}` needs an explicit `textValue`. Directly relevant to the status dropdown with counts (R10) and the campaign dropdown (R8).
5. **HeroUI `size="sm"`** — label/placeholder overlap unless `labelPlacement="outside"`.
6. **Synthetic events do not update HeroUI/React state** — live verification must use real clicks.
7. **Design system** — one gray ramp, semantic text at `-700`, three type tiers; enforced by `design-system.test.ts`. The visit-status colours must come from the existing token set.
8. **Data must actually reach the UI** — this project has a standing skill for fields that save but never render. Every new column (`followUpDate`, `via`, `occurredAt`, call counts) needs a UI assertion, not just an API test.
9. **Ports are pinned 3041/5173** — never re-add `autoPort` to `.claude/launch.json`.
10. **Check DTO + service + controller + enum together** — a prior bug shipped where `Document` had six anchor columns and the upload path wrote four. Partial wiring is this codebase's most common defect shape, and §1 found two more instances of it.

---

## 14. Resolved decisions (client, 2026-09-21)

All ten questions are answered. Nothing is blocking.

| # | Question | Answer |
|---|---|---|
| Q1 | Minimum notice | **6 hours**, and **admin-configurable** — stored on `OrgSettings`, not hardcoded |
| Q2 | Booking horizon | **Unbounded** |
| Q3 | Auto-advance lead status on confirm | **Yes, guarded** — see below |
| Q4 | Slot length / working hours | **60 min, 09:00–18:00 CT** (configurable, same store as Q1) |
| Q5 | One visit, multiple units | **One property per visit in v1.** Join table deferred to P2 |
| Q6 | Missed grace period | **2 hours after `endsAt`** |
| Q7 | Who can approve | **Founder, Super Admin, and Executive** |
| Q8 | Rejected visits | **Stay on the lead timeline permanently** |
| Q9 | Is `via` multi-valued | **Single-value in v1** |
| Q10 | Availability scope | **Global**, not per-project |

### Q3 in detail — auto-advance, guarded

The answer accepted auto-advance while naming its risk: it "overwrites a status the rep may
have deliberately set." Both halves are honoured by making the advance **directional**.

On confirming a visit, the lead advances to `SITE_VISIT` **only if its current status sits
upstream of `SITE_VISIT`** in the `lead_status` catalogue order:

- `NEW`, `POTENTIAL`, `CONTACTED`, `QUALIFIED` → **advances** to `SITE_VISIT`
- `PROPOSAL_SENT`, `NEGOTIATING`, `CONVERTED` → **left alone** (never moved backwards)
- `LOST`, `DEAD` → **left alone**, and the UI warns before booking a visit for a dead lead

Order comes from the live `lead_status` CustomOption `sortOrder`, not a hardcoded array, so
an admin adding a stage keeps the guard correct. Every auto-advance writes a
`STATUS_CHANGE` activity attributed to the confirming user, so the timeline says why it moved.

### Q1/Q4/Q6 storage

These are tunables, not constants, so they go on the existing `OrgSettings` model beside
`unitStaleDaysThreshold` and `drawFundingExpectedDays` — the same admin surface, no new
settings mechanism:

```prisma
model OrgSettings {
  // …existing…
  siteVisitMinNoticeHours   Int @default(6)    // Q1
  siteVisitSlotMinutes      Int @default(60)   // Q4
  siteVisitDayStartMin      Int @default(540)  // Q4 — 09:00 local
  siteVisitDayEndMin        Int @default(1080) // Q4 — 18:00 local
  siteVisitMissedGraceHours Int @default(2)    // Q6
}
```

### Q5 consequence — recorded so it is not forgotten

`SiteVisit` carries a nullable `unitId` **and** `buildingId` with an "at most one" rule. If
multi-unit tours turn out to be common, the change is a `SiteVisitUnit` join table plus a
backfill of existing rows — additive, no data loss, but a migration. The spec deliberately
does **not** pre-build it; revisit after 30 days of real bookings.


---

## 15. Phasing

| Phase | Contents | Rationale |
|---|---|---|
| **A — Quick wins** | R8 campaign filter + chips, R9 source-filter bug, R10 status dropdown, R11 new Lead fields | Days, not weeks. R8 is largely a one-line type fix plus a control; R9 is a live bug. Ships value before the large build starts. |
| **B — Scheduling core** | R1, R2, R3, R5 + permissions + notifications | The heart of the request. Not splittable — availability without booking is useless, booking without the dashboard card is invisible. |
| **C — Visit lifecycle** | R4 reschedule, R15 outcomes, R16 cron alerts | Needs B's data. Reschedule (D7) is explicitly client-requested, so C is not optional polish. |
| **D — Board parity** | R12 grid, R6/R7 calls + per-lead calendar, R13 calendar view | Independent of B/C; could run in parallel with a second pair of hands. |
| **E — Conversation** | R14 thread + mentions | Smallest client value of the five; last. |

**Dependencies:** A is independent. B blocks C. D blocks nothing. E blocks nothing.
**Recommended:** ship A immediately, then B, then run C and D together.

---

## 16. Rollout notes

1. **Re-login is mandatory** after the permission migration — trap #3. Tell the Founder before they report a missing button.
2. **Seed availability before announcing.** An empty slot picker on day one reads as broken. The Founder should publish a first week of availability behind the scenes.
3. **Backfill `occurredAt = createdAt`** in the same migration that adds it.
4. **Run the partial unique index as raw SQL** — Prisma cannot express it. Verify it exists after deploy: a missing index means the double-booking guard is silently absent while the UI still looks correct.
5. **Keep the monday board running in parallel for two weeks.** Retiring it is the real success test (§12), not a launch prerequisite.
