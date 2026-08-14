# PRD — Unit & Construction Updates Board

**Date:** 2026-08-13
**Author:** Engineering, from the client's Monday board screenshot (PRIME LEWISVILLE)
**Status:** Draft — 3 blocking decisions before build
**Related:** [LEASE_TRANSITION_SPEC.md](./LEASE_TRANSITION_SPEC.md) (sequenced together at the end of this doc)

---

## Audit first: most of this already exists

The client's board has seven columns. Six of them are already columns on `Task`.

| Board column | Status in Prime Tracker |
|---|---|
| Item — `UNIT 506`, `BUILDING 7` | ✅ `Task.unitId`, `Task.buildingId`, `Task.projectId` all exist |
| 💬 comment count | ✅ `TaskComment` |
| Person | ✅ `Task.assignedTo` → `User` |
| Status | ✅ `Task.status` — and `CustomOption` already stores label + **color** + sortOrder per category, so "Working on it / amber" is configuration, not schema |
| Priority | ✅ `Task.priority` (LOW / MEDIUM / HIGH / URGENT), same colour mechanism |
| Title | ✅ `Task.title` |
| Group header — `PRIME LEWISVILLE` | ✅ grouping by project |
| **Updates, day-wise** | ⚠️ `DailyLog` exists (logDate, notes, weather, crewCount, photos) but is **project/building only — no `unitId`**, and is not linked to a work item |
| **Combination units** — `UNITS 402,403,404` | ❌ `Task.unitId` is singular |
| **@mention → notify that person** | ⚠️ `resolveMentions()` + `COMMENT_MENTION` exist and work — but **only in the comments module**. `tasks.service.ts` contains zero notification wiring |
| **Notify on assignment** | ❌ no `TASK_ASSIGNED` notification type; assigning a task today tells nobody |

**So this is not a new module.** It is one join table, one nullable column, three notification types, and a board view. The instinct to build "Construction Updates" as a parallel system to Tasks would duplicate assignment, comments, attachments, permissions, and audit for no gain.

⚠️ **`UnitsService.combine()` is not the answer to combination units.** It exists, but it *merges* — it creates a new unit with the summed area and soft-archives the sources behind `mergedIntoId`, and it refuses when the units have sales, active leases, or interior projects. The client's `UNITS 402,403,404` is one *work item* spanning three units that each keep their own lease, sale, and rent history. Reusing `combine()` here would destroy exactly the per-unit records the last two weeks of work built.

---

## Problem Statement

Prime's construction and fit-out progress lives on a Monday.com board that is disconnected from the unit records in Prime Tracker. The PM keeps a unit's status, owner, priority, and running commentary in one system while its lease, sale, budget, and occupancy history live in another, so nobody can answer "what is happening with Unit 506" without opening two tools and reconciling them by hand. Work items routinely span several units at once (`UNITS 402,403,404`), which the current `Task` model cannot express at all, and assigning work to someone notifies them nowhere — the handoff happens verbally or not at all.

## Goals

1. **One place to answer "what is happening with this unit."** The unit's construction status and its rent/occupancy history appear on the same page — measured by retiring the Lewisville Monday board within 30 days of launch.
2. **Multi-unit work items are first-class.** A single item can cover 3 units without duplicating it 3 times or merging the units — target: zero duplicate items on the Lewisville board at launch.
3. **Assignment and @mention actually reach the person.** Every assignment and every @mention produces an in-app notification within 60s — target ≥90% of items have an assignee, versus a board where assignment carries no signal.
4. **Day-wise updates are attributable and dated.** Each update carries its own date, author, and optional photos, distinct from when it was typed.
5. **No parallel system.** Construction items reuse `Task` — one permission model, one audit trail, one comment system.

## Non-Goals

1. **Not a general Monday replacement.** No custom column builder, no formula columns, no automations, no timeline/Gantt view. Those are Monday's product; we are replacing one board, not the tool.
2. **Not drag-and-drop reordering of items.** Sorting is by group → priority → due date. Manual ordering needs a fractional-index column and earns its way in only if the PM asks after using it.
3. **Not external/vendor access.** Contractors do not get logins in v1. Brokers already have no login by design; same call here.
4. **Not a rewrite of `DailyLog`.** The daily construction log stays what it is (project/building-level, weather, crew count). This spec adds unit scope to it, not a new logging concept.
5. **Not real-time collaboration.** Notifications poll at 30s like everything else. WebSockets are a platform decision, not a feature of this board.

## User Stories

**Project Manager**
- As a PM, I want to create an item for several units at once so that a shared fit-out job appears once, not three times.
- As a PM, I want to assign an item to a person and have them told about it, so that handoff does not depend on me remembering to message them.
- As a PM, I want to post a dated update with photos against a unit so that progress has an auditable trail rather than a chat history.
- As a PM, I want a board grouped by project with coloured status and priority so that I can see the whole site's state in one screen — the thing the Monday board is actually giving them today.

**Construction lead**
- As a construction lead, I want to be notified when I am @mentioned in an update so that a question addressed to me does not sit unread.
- As a construction lead, I want to filter to only my items so that I can see my own workload across projects.

**Founder / Executive**
- As a founder, I want a unit's construction items on the Unit Detail page next to its lease history so that I can see occupancy and readiness together.

**Edge cases**
- As a PM, when I remove a unit from a multi-unit item, I want its update history to stay attached to the item so that history is not silently deleted.
- As a PM, when a unit is archived by a `combine()` merge, I want its items to follow the surviving unit rather than disappear.
- As any user, when I @mention a deactivated account I want to be told it did not notify anyone rather than assume it did.

---

## Requirements

### P0 — Must have

**R1. Multi-unit items.** New `TaskUnit` join table; `Task.unitId` retained for now and backfilled into it.

```prisma
model TaskUnit {
  taskId String
  unitId String
  task   Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  unit   Unit @relation(fields: [unitId], references: [id], onDelete: Cascade)
  @@id([taskId, unitId])
  @@index([unitId])
  @@map("task_units")
}
```

- [ ] An item can be linked to 1..n units, all within one building
- [ ] An item can instead be linked to a building with no units (`BUILDING 7 / SHELL`)
- [ ] Given a multi-unit item, when I open any one of its units, then the item appears on that unit's page
- [ ] Removing a unit from an item does **not** delete the item's updates
- [ ] `Task.unitId` becomes a derived convenience (single-unit items only) and is **not** written by new code — dual-write is how the two drift apart

**R2. `Task.kind` discriminator.** `TASK` (default) | `CONSTRUCTION`. Without it, cross-project admin todos and site work land in the same list and the Tasks page becomes unusable. One table, one permission model, filtered views.

**R3. Day-wise updates.** `TaskUpdate` — dated, authored, photo-capable.

```prisma
model TaskUpdate {
  id        String   @id @default(cuid())
  taskId    String
  updateDate DateTime // the DAY being reported — distinct from createdAt, same
                      // reason DailyLog.logDate is distinct: updates get typed late
  authorId  String
  content   String
  createdAt DateTime @default(now())
  photos    TaskUpdatePhoto[]
  @@index([taskId, updateDate])
}
```

- [ ] Updates render newest-first grouped by `updateDate`
- [ ] `updateDate` defaults to today and is editable; future dates rejected
- [ ] Photos reuse the existing presigned-upload path — no second storage mechanism

**R4. @mention notifications on updates and task comments.** Reuse `resolveMentions()` from `comments/mentions.ts` verbatim and the existing `COMMENT_MENTION` type. Do not write a second mention parser.

- [ ] Given an update containing a user's name, when it is saved, then that user gets a notification linking to the item
- [ ] Mentioning a deactivated user notifies nobody and the UI says so
- [ ] The author is never notified of their own mention

**R5. Assignment notification.** New `TASK_ASSIGNED` notification type + preference toggle.

- [ ] Fires on assignment and on re-assignment, to the new assignee only
- [ ] Does not fire when a user assigns an item to themselves
- [ ] Compare against the stored row, never `data.assignedTo !== undefined` — H1b's `normaliseTermAndNnn` bug: a service that writes a field on every update makes presence checks fire on every edit

**R6. Board view.** Grouped by project, columns exactly as the screenshot: Item / comments / Person / Status / Priority / Title / Updates.

- [ ] Status and priority chips read label + colour from `CustomOption` (`task_status`, `task_priority`) — configurable without a deploy
- [ ] Filter by building, assignee, status, priority
- [ ] Empty state, loading state, and permission gate per the existing `ui.tsx` components

**R7. Unit Detail integration.** A "Construction" section on `UnitDetailPage` listing that unit's items, sitting alongside Rent History.

**R8. `DailyLog.unitId`** — nullable, so a daily log can be scoped to a unit and not just a building. One column; the module otherwise unchanged.

### P1 — Should have

- **R9.** Item-level due dates surfaced in the exceptions feed as overdue construction work
- **R10.** `@` autocomplete in the update composer (today mentions are plain-text name matching)
- **R11.** Bulk status change across selected items
- **R12.** Per-unit rollup on the board — "3 of 4 units complete" on a multi-unit item
- **R13.** Photo lightbox + per-unit photo gallery aggregated across updates

### P2 — Future, design for but do not build

- **R14.** Contractor accounts with scoped write access to their own items — informs whether `TaskUpdate.authorId` should allow non-`User` authors. It should not; a contractor gets a `User` row with a restricted role when the time comes.
- **R15.** Item dependencies (`blocked by`). `Milestone.dependsOnId` already has a cycle-checked DAG — copy that, do not invent a second one.
- **R16.** Manual drag ordering (needs a fractional index column).
- **R17.** WhatsApp delivery of assignment/mention notifications — already on the roadmap as the outstanding notification channel.

---

## Success Metrics

**Leading (first 30 days)**
- Lewisville Monday board retired — binary, measured at day 30
- ≥90% of construction items have an assignee (Monday board today: 6 of 6, so this is parity, not aspiration)
- ≥3 updates/week posted per active building
- Assignment notification → item opened, median under 4 hours

**Lagging (90 days)**
- Construction items created per week is flat or rising at day 90 — the honest failure signal is a burst at launch that decays, which means the board did not fit how the PM works
- Second project (beyond Lewisville) adopts the board without engineering involvement
- Reduction in "what's the status of unit X" messages — self-reported by the PM, since we have no support-ticket instrument

---

## Open Questions

**Blocking — needed before the migration**

1. **(Client)** Do the Monday status values map onto `TODO / IN_PROGRESS / DONE / CANCELLED`, or does the client want their own set? The screenshot shows "Working on it" and one blank. `CustomOption` makes this configuration either way, but the *stored slugs* are a migration and should be decided once. **Recommendation:** keep the four canonical slugs, relabel via `CustomOption`, and add `BLOCKED` — a blank status cell is almost certainly "stuck".
2. **(Client)** Can a multi-unit item span two buildings? The spec assumes no, which lets the board group cleanly by building. Cheap now, expensive later.
3. **(Engineering/Client)** Do construction items and admin tasks share the `/tasks` page with a filter, or get their own nav entry? Affects R2's surfacing but not its schema. **Recommendation:** own nav entry under the project's construction tab, since that is where the PM already works.

**Non-blocking**

4. **(Client)** Should posting an update auto-advance status (first update → "Working on it")? Convenient, but it makes status a side effect of typing.
5. **(Client)** Retention on update photos — these accumulate fastest of anything in the system.
6. **(Engineering)** `tasks.service.ts` has **no spec file** — the only module of its size without one. R5's re-assignment logic is exactly the kind of thing that broke silently in R23. Tests are part of the estimate, not extra.

---

## Timeline — both features, sequenced

Two independent tracks. Lease transitions is the one with a client already waiting on it and a live constraint bug, so it goes first.

### Phase 1 — Lease transitions (4–5 days) — *start here*

Per [LEASE_TRANSITION_SPEC.md](./LEASE_TRANSITION_SPEC.md).

| Step | Work | Days |
|---|---|---|
| 1.1 | Migration: `terminationDate` / `terminationReason` / `successorLeaseId`, `LeaseTenantAssignment`, invoice `VOID`. **Rebuild `lease_unit_no_overlap` over `COALESCE(terminationDate, leaseEnd)` first** — until that lands, an early-terminated lease blocks its own successor | 1 |
| 1.2 | `endTenancy()` — cap schedule, void future invoices, settle deposit, flip unit, write `unit_status_events` | 1.5 |
| 1.3 | `assignTenant()` + `LEASE_PENDING` in the unit state machine | 0.5 |
| 1.4 | Timeline: `tenancy_end` + `assignment` kinds, suppress the phantom vacancy between linked leases | 0.5 |
| 1.5 | UI: End Tenancy dialog, Assign Tenant dialog, `invalidateAfterLeaseWrite()` extension | 1 |
| 1.6 | Tests + verify in the running app | 0.5 |

### Phase 2 — Construction board P0 (5–6 days)

| Step | Work | Days |
|---|---|---|
| 2.1 | Migration: `TaskUnit`, `Task.kind`, `TaskUpdate` + `TaskUpdatePhoto`, `DailyLog.unitId`, `TASK_ASSIGNED`. Backfill `Task.unitId` → `TaskUnit` | 1 |
| 2.2 | Service: multi-unit CRUD, updates CRUD, mention wiring, assignment notification (+ the missing `tasks.service.spec.ts`) | 2 |
| 2.3 | Board view — grouping, colour chips from `CustomOption`, filters | 1.5 |
| 2.4 | Unit Detail construction section + update composer with photos | 1 |
| 2.5 | Verify in the running app, seed the Lewisville board as a fixture | 0.5 |

### Phase 3 — P1 polish (3–4 days, on demand)

R9–R13, after the PM has used the board for two weeks. Deliberately not scheduled — half of these usually turn out to be wrong once someone uses the thing.

**Total: 12–15 engineering days for both P0s.** They touch disjoint code (leases/units vs tasks) so Phase 2 can start before Phase 1 ships if a second pair of hands is available — but Phase 1's migration should land alone, since it rebuilds a constraint.

### Dependencies and risks

- Phase 1.1 must be the first migration in; it changes an exclusion constraint and should not share a deploy.
- The 6 units that are `SOLD` with an `ACTIVE` lease and no sale record will make `endTenancy` refuse — clear them first.
- The AWS cutover is deferred but not cancelled. Both phases add migrations; whoever runs the cutover needs the list.

---

## Client feedback round 1 — delivered 2026-08-14

Six items came back after the client used the board. All six are in.

### 1. Photos would not upload — and neither would building images

**One root cause, and not in the board at all.** Uploads went browser → S3 directly with a
presigned PUT, which is a **cross-origin** request. The bucket has no CORS rule, so Chrome
blocked every one at preflight and the app saw an opaque `Failed to fetch`. Confirmed in
the console:

```
Access to fetch at 'https://prime-tracker-documents-….s3.us-east-1.amazonaws.com/…'
from origin 'http://localhost:3000' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

That hook has **six call sites** — the board, building images, daily logs, draw documents
and project documents — so every upload in the product was broken the same way, and the
two the client noticed were the two they happened to try.

**Fix:** a new `POST /api/documents/upload-file`. It takes the file through the API,
stores it server-side and returns `{ storagePath, publicUrl }` with no Document row.
Same-origin, so CORS never enters into it. `usePresignedUpload` now calls it and keeps its
name and return shape, so all six call sites were fixed by one change.

**Correction, same day.** The bucket **did** already have a CORS rule. It allowed
`GET/HEAD/PUT` from `https://app.theprimedeveloper.com`, `http://localhost:5173`,
`http://localhost:3001` and `https://98-89-192-161.nip.io`. What it did not allow was
`http://localhost:3000` — the port this dev session happened to run on. So the scope of
the earlier claim was wrong: **production was never broken**, and the failure was local
dev on any port other than 5173.

The web dev server is configured with `autoPort: true`, so its port changes per session.
No fixed list of localhost ports can keep up with that, which is the argument for the
API-routed upload being the permanent fix rather than a workaround.

**CORS rule updated 2026-08-14** so the presigned path works from dev again:

```
AllowedMethods: GET, HEAD, PUT
AllowedOrigins:
  https://app.theprimedeveloper.com
  https://98-89-192-161.nip.io
  http://localhost:*        ← replaces the two fixed ports; autoPort makes them unkeepable
  http://127.0.0.1:*
ExposeHeaders: ETag
MaxAgeSeconds: 3000
```

The localhost wildcards are a dev convenience, not a security relaxation: a PUT still needs
a valid presigned signature, which only comes from an authenticated API call. CORS decides
which page may *ask*; the signature decides whether the write is allowed.

Verified from `http://localhost:3000`: presigned PUT returns 200 with an ETag.

### 2. Notes column removed

It showed a comment count and nothing else — no way to read a comment, no way to add one.
A number that cannot be clicked is furniture.

### 3–4. Several buildings, and several people, per item

Both were scalars, which made the second building and the second person **unsayable**.
`TaskBuilding` and `TaskAssignment` join tables, same shape as the existing `TaskUnit`.

- The "all units on one item must be in the same building" rule is **gone**. It was an
  assumption from 2026-08-13, not a requirement, and it was wrong: one contractor doing
  the same job across B1 and B2 is one item, not two.
- A multi-building item appears **under every building's group** on the board, with a
  badge saying so. Picking one and hiding it from everyone looking at the other is the
  exact failure that made this worth asking for.
- The scalar `buildingId` / `assignedTo` columns remain as a **mirror of the single-value
  case** — filled only when there is exactly one, null otherwise. A silently-chosen
  "primary" is what makes a mirror start lying. All three list filters now read the join
  tables, never the scalars, or multi-item rows would vanish from the filter that exists
  to find them.

### 5. Tagging notifies everyone tagged

`TASK_ASSIGNED` fired for the scalar assignee only, so on a multi-person item everybody
after the first was silently never told.

The guard against spam is `notifiedAt` **on the join row**, not a comparison of the old
and new assignee. That is stronger: it can tell "added Priya" from "added Priya and Ravi",
and a form that posts every field on every save cannot re-alert a crew that is already on
the item. Verified: renaming an item with two people on it produced zero new
notifications.

### A bug caught while building this

Every setter in the dialog has to seed **all** the state, not just its own field. `touched`
flips the whole dialog from reading the task to reading local state, so a setter that
filled only `form` left the three link lists empty — and **typing a title on an existing
item would have silently dropped its buildings, units and people on save**. Hence
`seedAll()`. Verified in the running app: renaming through the UI leaves both buildings and
both people intact.

### A second, separate upload bug — found only by testing through the UI

The CORS fix and the API route both worked when driven directly. Uploading through the
**actual dialog** still failed, with the server answering `400 No file was received`.

Cause: the axios instance sets `Content-Type: application/json` as a default for every
call. A `FormData` body needs `multipart/form-data; boundary=…` — a header only the
browser can produce, and only when none is already set. The default overrode it, multer
saw a body it could not parse, and reported a missing file.

The error message is what made this expensive: "No file was received" points at the file
input, which was fine, rather than at a header set three layers away in `src/lib/api.ts`.

**Fix:** the request interceptor now deletes `Content-Type` when the body is `FormData`.
That is the right layer — the default belongs to the instance, so the bug would otherwise
have been re-fixed once per upload screen, and every future FormData caller inherits the
correct behaviour.

Four tests in `src/lib/api.test.ts` pin it, including that dropping the header does not
drop the bearer token (the two rules share one interceptor). Mutation-checked: removing
the fix fails exactly one of them.

**The lesson worth keeping:** two of the three defects in this round were invisible to
direct API calls and only appeared when the real UI drove the request. Verifying an
upload means clicking it.
