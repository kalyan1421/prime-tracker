# Site Tracker — "Update Section" Build Plan

**Source:** `sitetrackeraudit.md` (reverse-engineering audit of monday.com board `Site Tracker`, 26 Aug 2026).
**Goal:** give Prime Tracker an Updates section that does what the monday board does — and fixes the four
modelling faults the audit found in it.
**Written:** 2026-08-27. Read alongside `UPDATE_BOARD_DESIGN.md`, `CONSTRUCTION_UPDATES_BOARD_SPEC.md`,
`NNN_MONTHLY_AND_UNIT_CONSTRUCTION_CHECKLIST_SPEC.md`, `INTERIOR_MODULE_DESIGN.md`.

---

## 0. Headline: most of the skeleton is already built. The differentiator is not.

The audit's §15 "suggested Postgres shape" is largely **already live in Prime Tracker** — and in a stronger
form, because Property is a real entity here rather than a monday group. What is missing is precisely the
thing that makes the monday board worth using: **one append-only update feed per unit, surfaced in a
single cross-property grid.** (Two further halves of the board — AI summary columns, and inbound
email ingestion — were each built and then cut from scope on 2026-08-27; see Phases 4 and 6.)

### Gap table — audit concept → Prime Tracker today

| monday concept (audit §) | Prime Tracker today | Verdict |
|---|---|---|
| Group = property (§2) | `Project` → `Building` → `Unit`, real FKs | ✅ **better** — audit §2 flags monday has no property entity |
| Building-unit item (§3.1) | `Unit` (`schema.prisma:341`) | ✅ |
| Subitem checklist (§4) | `UnitConstructionStage` (`schema.prisma:2513`) | ✅ |
| Subitem Status (§4.1) | `UnitConstructionStage.status`, CustomOption-backed | ✅ |
| Inspection Status + Date (§4.2) | `inspectionStatus`, `inspectionDate` | ✅ |
| Subitem Owner (§4) | `ownerId` | ✅ (monday defined it, never used it) |
| Subitem Timeline (§4) | — no `startsOn`/`endsOn` on a stage | 🟡 small gap |
| Checklist template (§5) | `ConstructionStageTemplateItem` — **per building**, unversioned, not stamped on the unit | 🔴 **same drift bug monday has** |
| `BLOCKER` flag (§3.2) | nothing on `Unit` | 🔴 **gap** |
| `PRIORITY` (§3.3) | nothing on `Unit` | 🔴 **gap** |
| `TENANT / BUSINESS` (§3.6) | tenant via `Lease`/`LeaseTenantAssignment`; **work type does not exist** | 🟡 partial |
| `Person` assignee on the unit (§3.7) | `Task`/`UpdateBoardAssignment` have it; `Unit` does not | 🔴 **gap** |
| Updates feed per unit (§9.1) | **three overlapping surfaces** — `UnitComment`, `DailyLog(unitId)`, `UpdateBoardPost`+comments | 🔴 **fragmented** |
| `Latest Updates` AI column (§3.4) | — | ⛔ **cut from scope 2026-08-27** |
| `Next Actions` AI column (§3.5) | — | ⛔ **cut from scope 2026-08-27** |
| Email → update ingestion (§10) | outbound only (`notifications/mailer.ts`, SES + SMTP) | 🔴 **gap** |
| Photos on updates (§9.1) | `DailyLogPhoto` ✅, `UpdateBoardAttachment` ✅, `UnitComment` ❌ | 🟡 partial |
| Group footer batteries (§11) | `ConstructionChecklistRollup.tsx` — rings + per-building aggregates | ✅ **better** |
| **% complete rollup** (§11, §16.11) | already computed in `getProjectRollup()` | ✅ **better — monday has none** |
| Activity log with Undo (§9.3) | `AuditEvent` — immutable, no undo | 🟡 partial (undo is out of scope) |
| One monday-style grid to see it all | no such view; today it is a card grid + separate pages | 🔴 **gap** |
| Vibe views / Agents / Workflows / Notetaker (§8, §12) | — | ⛔ **skip, per audit §16.13** |

### The two decisions that shape everything below

> **Correction (2026-08-27).** This section originally called `UnitComment`, `DailyLog` and
> `UpdateBoardPost` "three overlapping surfaces" and proposed folding them into one. Reading what
> is actually in them settles it differently: the comments say *"Signage approved by the city"*,
> *"Coastal Ventures under contract"* and carry a Marketing/Sales/Financial taxonomy the dashboard
> groups by; the site updates say *"cabinets delivered, plumber tomorrow"* and carry photos, a
> channel and a checklist stage; `UpdateBoardPost` is org-wide and deliberately not project-scoped.
> Those are three audiences, not one duplicated three times. Merging the tables would put marketing
> chatter in the construction feed and lose the taxonomy. **What was worth fixing was having to
> look in two places on the unit page — a reading problem, not a storage one — and that is what
> the Activity timeline does.**

**D1 — Do not add a fourth update surface.** Prime Tracker already has three. `DailyLog` (`schema.prisma:3092`)
is the closest match to monday's Updates feed: it already carries `projectId`/`buildingId`/**`unitId`**, an author,
free-text notes, and photos, with no unique constraint stopping several posts on one day. **Extend `DailyLog`
into the canonical per-unit feed** and rename it "Site Updates" in the UI. `UnitComment` stays the
business-comment thread (MARKETING/SALES/FINANCIAL); `UpdateBoardPost` stays the org-wide announcement board
— that is the equivalent of monday's separate *DAILY UPDATES* board (audit §13), not of this feed.

**D2 — The Site Tracker row is the `Unit`, not the `InteriorProject`.** `InteriorProject` (`schema.prisma:2895`)
already owns fit-out execution with 7 phases, a PM, per-sqft pricing and snagging — it is the deep model behind
`INTERIOR FINISHOUT`. The Site Tracker grid is the *shallow cross-property status view* on top; it must render
a shell unit and a fit-out unit in the same table. So it reads `Unit` and derives work type; it does not become
a second interior module. See **Q1** below.

---

## Phase 1 — Site Tracker columns on the Unit
*Ports audit §3.2, §3.3, §3.6, §3.7. Fixes audit §3.3 and §3.6 on the way through.*

**Schema** (one migration):

```prisma
model Unit {
  // ... existing
  blockerStatus  String?    // 'YES' | 'NO' | null — null is a real third state (audit §3.2)
  blockerReason  String?    // monday has no such field; without it "YES" is unactionable
  blockerSince   DateTime?  // gives you blocker AGE, which monday cannot show
  sitePriority   String?    // 'LOW' | 'MEDIUM' | 'HIGH' — CustomOption category "site_priority"
  workType       String?    // 'SHELL' | 'INTERIOR_FINISHOUT' | 'PERMIT' — CustomOption "work_type"
  siteAssignees  UnitAssignee[]
}

model UnitAssignee {          // audit §3.7 — multi-assign, monday allows 2+ avatars per row
  unitId     String
  userId     String
  assignedAt DateTime @default(now())
  @@id([unitId, userId])
}
```

**Deliberate deviations from the source:**
- **Do NOT port `PRIORITY → DONE`.** Audit §3.3 calls it out: a priority scale containing a completion value
  mixes two orthogonal concepts, and its `done_colors: [1]` marks **LOW** as complete, which silently corrupts
  monday's own battery. Priority is LOW/MEDIUM/HIGH; completion is the checklist `%`.
- **Do NOT port `TENANT / BUSINESS` as one column.** Audit §3.6 — split it. `workType` goes on the Unit;
  tenant name is already correctly modelled via `Lease` → `LeaseTenantAssignment` and must be read from there,
  never re-typed.
- **Skip the parent `Timeline` column.** 0 of 25 populated (audit §3.9, §16.14). Add it only if the client
  asks for it after Phase 5 ships.

**Backend:** extend `units.service.ts` update path; stamp `blockerSince` on the NO→YES flip and clear it on
YES→NO (same pattern as `availableSince`, `schema.prisma:363`). New permission `siteTracker:edit`.

---

## Phase 2 — Versioned checklist templates by work type
*Fixes the single most important finding in the audit (§5, §16.7) — and the same latent bug in our own schema.*

The audit found **four divergent templates** on one board (22-step Interior, an unnumbered misspelled twin,
an 18-step Shell, a 16-step dot-numbered Shell) plus a **fifth, different 14-step list** that the automations
actually create for every new unit. Cause: monday has no `template_id` on the item.

Prime Tracker has the identical exposure. `ConstructionStageTemplateItem` is keyed to a **Building**, and the
schema comment at `schema.prisma:2499` already concedes the copy is one-way and never resynced. Nothing records
which template a unit's checklist came from.

```prisma
model ChecklistTemplate {
  id        String  @id @default(cuid())
  name      String
  workType  String            // 'SHELL' | 'INTERIOR_FINISHOUT' | 'PERMIT'
  version   Int
  isActive  Boolean @default(true)
  steps     ChecklistTemplateStep[]
  @@unique([workType, version])
}

model ChecklistTemplateStep {
  templateId        String
  stepNo            Int
  label             String
  requiresInspection Boolean @default(false)
  @@id([templateId, stepNo])
}

model Unit {
  templateId       String?   // stamped at apply time — the field monday lacks
  templateVersion  Int?
}
```

**Work:**
1. Seed the two real templates transcribed in audit §5.1 (Interior Finish-out, 22 steps) and §5.3 (Ground-up
   Shell, 18 steps), with the audit's spelling corrections applied (`03 - Plumbing – Underground`,
   `17 - Store Front Glass`, `18 - Garage Doors`).
2. **Do not seed the §5.5 14-step list.** The audit proves it is drift, not intent — it drops Contracts,
   Stamped Permits, Topout, PEC Meter Release and all three separate Finals.
3. Backfill: for each existing unit with stages, fuzzy-match its stage labels to a seeded template and stamp
   `templateId`/`templateVersion`; leave unmatched units stamped `null` and list them in the migration output
   for manual review.
4. Keep `ConstructionStageTemplateItem` as a per-building **override** layer, resolved after the work-type
   template. Existing units' checklists stay immutable — same "past is immutable" rule as `BudgetRevision`.
5. Add a **template drift report**: units whose stage list no longer matches their stamped template version.
   This is the report that would have caught monday's problem on day one.
6. Extend `UnitConstructionStage` with `startsOn`/`endsOn` (audit §4, subitem Timeline — 17/540 used, so it
   is genuinely wanted, unlike the parent Timeline).

---

## Phase 3 — One canonical Site Update feed
*Ports audit §9.1. Implements decision D1.*

Extend `DailyLog`:

```prisma
model DailyLog {
  // ... existing (projectId, buildingId, unitId, logDate, authorId, notes, weather, crewCount, photos)
  parentId  String?    // threaded replies — monday's per-post reply composer (audit §9.1)
  source    String  @default("WEB")   // WEB | MOBILE | EMAIL | WHATSAPP  (audit §9.1 mobile icon, §10 email)
  stageId   String?    // optional pin to a UnitConstructionStage — monday allows subitem updates
}
```

**Frontend:** one `SiteUpdateFeed` component (evolve `components/DailyLogFeed.tsx`, 287 lines) used in three
places — Unit detail, Building detail, and the expanded Site Tracker row. Composer: text, @-mention
(`MentionTextarea.tsx` already exists), photo attach, submit.

**Deliberate deviation:** monday's subitem Updates feed is dead weight — **3 updates across 540 subitems**
(audit §4.3). Build `stageId` as an optional tag on a unit-level update, not as a separate per-stage thread.

**Migration note:** existing `DailyLog` rows keep working unchanged; `source` defaults to `WEB`.

---

## Phase 4 — The AI layer — **CUT FROM SCOPE (2026-08-27)**

Built, then removed at the client's direction: *"remove ai feature no need for now"*. Nothing of it
remains in the codebase — no `ai-summaries` module, no `UnitAiSummary` table, no `@anthropic-ai/sdk`
dependency, no `ANTHROPIC_API_KEY`, and no `Latest update` / `Next action` columns on the grid.

Kept from that work, because it was never an AI feature: **`DailyLog.unitId` is now wired end to
end**. The column had existed on the model since daily logs were added but nothing in the module
ever read or wrote it, so every log was building-level in practice and per-unit site updates could
not exist at all. Create, update and the list filter now handle it, and the building is derived
from the unit so a unit-level log cannot be filed under the wrong building. The grid's per-unit
update count depends on this.

**If it is ever revived**, the two things worth carrying over from the removed implementation are
in git history and in the audit:
- the two prompts (audit §6.1) — a tuned owner-facing spec, not worth re-deriving;
- the two guards enforced in **code** rather than in the prompt, because the source board's own
  prompts are violated on live rows: blocker-language (a summary may only say "blocked" when a
  human has set the flag) and name/number stripping against a known-name roster.
Also carried over: a summary must live in its own field, never in the same column a person edits,
or a regeneration silently destroys what they wrote.

## Phase 5 — The Site Tracker grid
*The UI the client actually pictures when they say "same as monday".*

New route `/site-tracker`, permission `siteTracker:view`, nav entry beside Updates in `Layout.tsx:26`.

A grouped grid — Project → Building → Unit rows:

| Unit | Blocker | Priority | Latest Update ✨ | Next Action ✨ | Work type / Tenant | Owners | % | Current stage |
|---|---|---|---|---|---|---|---|---|

- **Frozen left column** (unit name + update-count and photo-count badges) — audit §3.1.
- **Inline editing** on Blocker, Priority, Owners, Work type. The pattern already exists — `ConstructionBoard.tsx`
  (857 lines) and `ConstructionChecklistRollup.tsx` do this today.
- **Expand a row → the checklist steps inline**, with Status / Inspection Status / Inspection Date / Timeline
  editable in place. This is monday's subitem expand (audit §3.8).
- **Group footers** — segmented status batteries per group (audit §11). `getProjectRollup()` already returns
  what these need.
- **`%` complete column** — the number the audit says a construction owner actually wants and monday shows
  nowhere (§11, §16.11). We already compute it.
- **A real create form** (audit §7, §16.12): name, building, work type, tenant, assignees, **template**. monday
  has no form at all — its blue button appends a blank row and fires 16 automations. Making template choice
  explicit at creation is what closes Phase 2's drift permanently.
- **Label sets and colours** port verbatim from audit §3.2, §4.1, §4.2 — seed them as `CustomOption` rows so
  they stay editable. Two corrections: drop `PRIORITY → DONE` (Phase 1), and re-colour Inspection Status so
  `Failed` and `Requires Follow-up` are not *less* alarming than `In Progress` (audit §4.2 flags these as
  unadjusted template defaults).
- Reuse `usePagination` and `useCollapsibleGroups` — the list-scale fix already landed; do not hand-roll a
  fourth copy.

---

## Phase 6 — Ingestion — **CUT FROM SCOPE (2026-08-27)**

Built, then removed the same day at the client's direction, like Phase 4 before it. The SES/SNS
webhook, the signature verification, the MIME parsing, the sender allowlist and the attachment
rules are all gone; so are the `mailparser` dependency, the `INBOUND_EMAIL_DOMAIN` setting and the
AWS runbook. No AWS resources were ever created, so nothing is left stranded in the cloud either.

**Kept, because it was never part of ingestion:** `DailyLog.source`, which distinguishes an update
posted from a phone on site from one posted at a desk. That shipped as part of Phase 3 and works
today. Its value list was trimmed to the two channels that are actually reachable — listing `EMAIL`
when nothing can produce it would make `?source=EMAIL` accept the filter and return nothing, which
reads as "no email updates" rather than "that channel does not exist".

**If it is ever revived**, the shape is recorded in git history and the design decisions worth
keeping are:
- the inbound address is **not** a secret — it rides on every notification's `Reply-To` — so the
  control is that the SENDER must be an active user, never the address;
- `source` must be server-stamped and never accepted from a request body, or an "arrived by email"
  badge is decoration rather than evidence;
- quoted-reply trimming is what decides whether an ingested feed is readable at all;
- the webhook is the only route reachable without signing in, so its RSA signature check is its
  authentication, and `route-permissions.spec.ts` needs a documented exception rather than a
  weakened assertion.

## Skip list (audit §16.13–15, plus the 2026-08-27 scope cuts)
Everything AI: the two generated columns, the summarisation prompts, and the model integration.
All inbound ingestion: the email webhook and the unbuilt WhatsApp channel.

Build Vibe views (empty scaffolds), Agents (zero exist), Workflows (0 active), Notetaker (demo row only),
the parent `Timeline` column (0/25 used), the subitem `Owner` column (0/540 used — though we already have the
field, so it costs nothing to leave), and the two duplicate untitled `Text` columns (4 values across 540 rows).

---

## Sequencing — state as of 2026-08-27

| Phase | State | Notes |
|---|---|---|
| 1 — Unit columns | ✅ **Delivered** | blocker (+reason +age), site priority, work type, multi-assign owners |
| 2 — Versioned templates | ✅ **Delivered** | templates by work type, provenance stamped on the unit, drift report — and a management screen at `/checklist-templates` |
| 3 — Canonical feed | ✅ **Delivered** | `unitId` wired; feed mounted; `source` server-stamped; threaded replies (one level); optional `stageId` pin; unit page now has ONE Activity timeline merging site updates and team comments |
| 4 — AI layer | ⛔ **Cut from scope** | removed in full at the client's direction — see the Phase 4 section |
| 5 — The grid | ✅ **Delivered** | `/site-tracker`, grouped, inline-edit, expandable checklist |
| 6 — Ingestion | ⛔ **Cut from scope** | built and removed the same day — see the Phase 6 section |

Every phase adds specs to the existing suites (2,310 API + 66 web tests as of 2026-08-27) and must
pass `design-system.test.ts` — which has already caught one real contrast regression on this work.

---

## Open questions for the client

1. **Work type on the Unit vs. the Interior module.** `InteriorProject` already models fit-out properly
   (7 phases, PM, per-sqft, snagging). Is `Unit.workType` a lightweight label for the grid, or should a unit
   marked `INTERIOR_FINISHOUT` be *required* to have an `InteriorProject`? Recommend: label only, with the grid
   deep-linking to the interior project when one exists.
2. **Is the monday board being replaced or mirrored?** If replaced, we need a one-time import of the 25
   Building-units, 540 subitems and 80 updates. If mirrored, we need a sync story — recommend against it.
3. **The three properties with no Prime Tracker equivalent.** The monday board has CENTRO PLAZA, RRC, RIO RANCH,
   SPUR PLAZA (empty) as groups. Confirm these map to existing `Project` rows.
4. **Item naming.** monday names items free-text — `UNITS 402,403,404` is one item covering three physical units
   (audit §3.1). We have `combineUnits` already. Should those become one combined unit, or stay three rows?
5. **Who may set Blocker = YES?** It gates the AI's language, so it is load-bearing. Any role with
   `dailylog:edit`, or PM/Founder only?
6. **AI budget.** Roughly how many site updates per week across all units? Drives the model choice in Phase 4.
