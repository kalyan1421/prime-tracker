# Spec: Monthly NNN on Every Lease + Per-Unit Construction Checklist

**Status:** Draft — ready for engineering estimate, one item flagged for explicit client re-confirmation before build.
**Date:** 2026-08-21
**Source:** Client screenshots of a Monday.com-style construction board (PRIME board) + verbal ask about rent fields.
**Related:** [[prime-tracker-construction-board]], [[prime-tracker-leasing-notifications-plan]], `docs/client-discovery/CONSTRUCTION_UPDATES_BOARD_SPEC.md`, `docs/client-discovery/TENANCY_AND_RENT_FLOWS.md`

This bundles two unrelated asks that arrived in the same message. They are scoped, staffed, and can ship independently — do not let them block each other.

---

## ⚠️ Decision flagged for re-confirmation: NNN reverts to monthly

The client's answer to "where should base rent + NNN live" was: use the existing Lease fields, but **NNN should be charged every month**, not once at signing.

This is not a small toggle. It reverses a decision the client made **nine days ago**:

- Migration `20260812160000_nnn_one_time` deliberately removed a monthly `nnnAmount` column from `LeaseRentPeriod` and moved NNN to a one-time `LeaseObligation` (kind `NNN`), collected at signing.
- `LeaseRentPeriodService` has an explicit runtime guard that **throws an error** — `"NNN is charged once at signing and is recorded as a lease obligation, not as..."` — if a caller tries to fold NNN back into monthly rent.
- There are dedicated regression tests asserting this exact behavior: `leases.service.spec.ts` — *"never folds NNN into the monthly rent"*, *"derives the one-time NNN total from the per-sqft rate"*; `lease-rent-period.service.spec.ts` — *"explains that NNN is not part of monthly rent"*, *"reports the same figure for total rent and base rent, now that NNN is not monthly"*.
- Any lease signed in the last 9 days already has a one-time `LeaseObligation(kind=NNN)` row instead of a rent-period NNN component — those records need a migration decision (see Open Questions).

**Recommendation: confirm explicitly with the client before starting build** — quote back "NNN goes back to a monthly charge, reversing the 2026-08-12 decision, and we'll need to convert any NNN obligations created since then" and get a yes. If confirmed, proceed as specified below. This spec assumes confirmation and designs the monthly version, but flags every place the reversal touches so nothing is silently changed underneath existing tested behavior.

---

## Feature A — NNN as a monthly charge

### Problem Statement
Every lease should show NNN as a recurring monthly amount alongside base rent, the way it was billed before 2026-08-12. Finance and the client want NNN visible per month in the rent roll and invoices, not as a single lump collected at signing.

### Goals
- Every active lease has a monthly NNN amount that appears on its `LeaseRentPeriod` and flows into `LeaseRentInvoice.amountDue` alongside base rent.
- Base rent escalation continues to apply to `baseRent` only — NNN carries forward unchanged period to period (this rule was already correct before 2026-08-12 and is being restored, not redesigned).
- Rent-roll and "effective rent" reporting show base rent and NNN as distinct, addable figures again.
- Existing one-time NNN `LeaseObligation` rows (created since 2026-08-12) are resolved by an explicit, reviewed migration — not silently orphaned or double-counted.

### Non-Goals
- **Not** changing security deposit or TI allowance — they stay on `LeaseObligation` exactly as today; only NNN's shape changes.
- **Not** re-deriving `nnnTotalAmount`/`nnnPerSqft` on `Lease` as anything other than the quoted *rate* — those fields already exist and stay as the headline term; only the *billing mechanism* changes from one-time to monthly.
- **Not** touching `Unit.askingRent` — no new fields are added to `Unit`. This confirms the client's answer: use what already exists on `Lease`, don't duplicate onto `Unit`.
- **Not** retroactively re-invoicing tenants for months already billed under the one-time model — past `LeaseRentInvoice` rows are immutable, same rule as every other billed record in this system.

### User Stories
- As Finance, I want NNN to appear as part of the monthly amount due on each lease's invoice, so tenant billing matches how NNN is actually collected.
- As Finance, I want to see base rent and NNN broken out separately on the rent roll, so I can report each to ownership/lenders as they expect.
- As a Founder/Executive, I want escalation to keep applying to base rent only, so NNN isn't accidentally inflated by the annual bump.
- As Finance, I want a clear one-time migration report showing which leases' NNN obligations were converted to monthly, so I can reconcile anything already collected as a lump sum.

### Requirements

**Must-Have (P0)**
1. Restore a monthly NNN component on `LeaseRentPeriod` (e.g. `nnnAmount`), carried forward unchanged from the previous period unless manually edited (same rule as before 2026-08-12).
   - *Acceptance:* Given a lease with `nnnAmount = 500`, when the period regenerates for the next year with a 3% escalation, then `baseRent` increases 3% and `nnnAmount` stays 500.
2. `LeaseRentInvoice.amountDue` = period's `monthlyRent + nnnAmount` (pro-rated together for partial months, same day-count logic already used for rent).
   - *Acceptance:* Given a partial first month billed 15/30 days, when the invoice generates, then both rent and NNN are pro-rated by the same day-count fraction.
3. Remove the `LeaseRentPeriodService` guard that throws on monthly NNN, and update/replace the regression tests that assert the one-time-only behavior so they assert the restored monthly behavior instead (the tests are the spec here — they must change in lockstep with the code, not be deleted quietly).
4. Rent roll and "effective rent" reporting (`LeasesService.getRentRoll`, the effective-rent KPI) report base rent and NNN as separate line items again, summing for a "total effective rent" figure.
5. **Data migration for the ~9-day gap:** every `LeaseObligation(kind='NNN')` created since 2026-08-12 is inventoried; for each, decide (with Finance) whether to (a) convert the remaining unpaid balance into a `nnnAmount` on the lease's current and future rent periods, or (b) leave it as a one-time obligation already agreed with that tenant and simply not create new ones going forward. This must be a reviewed list, not an automatic bulk conversion.

**Nice-to-Have (P1)**
- A one-time script/report listing every lease signed since 2026-08-12 with its current NNN obligation status, to hand to Finance for the migration decision in P0-5.
- Surface NNN in the lease creation/edit form as a clearly monthly field (label change from "NNN total" framing to "NNN /month").

**Future Considerations (P2)**
- Manual NNN adjustment mid-term with a reason (mirrors `LeaseRentPeriodCorrection` for rent) — not requested now, but the append-only period model already supports it structurally.

### Success Metrics
- 100% of leases created after this ships have `nnnAmount` populated on their rent periods (no lease left with NNN only as a one-time obligation going forward).
- Zero regression-test failures in `lease-rent-period.service.spec.ts` / `leases.service.spec.ts` after the intentional rewrite (i.e., the suite fully reflects the new behavior, nothing left half-migrated).
- Finance confirms the P0-5 migration inventory is fully reconciled (every post-2026-08-12 NNN obligation has a documented resolution).

### Open Questions
- **[Blocking — client]** Explicit re-confirmation of the reversal itself, given how recent and deliberate the one-time decision was.
- **[Blocking — Finance]** For each `LeaseObligation(kind='NNN')` created since 2026-08-12: convert to monthly, or honor as one-time since it was already communicated to that tenant?
- **[Engineering]** Does `nnnAmount` belong on `LeaseRentPeriod` (escalation-exempt, same table as before) or as a separate lightweight table? Recommendation: same column that existed pre-migration — reuse the shape the tests and comments already describe rather than inventing a new one.

### Timeline Considerations
- Should ship as its own migration + PR, independent of the construction checklist (Feature B) — no shared code, no reason to couple them.
- Get the client re-confirmation (blocking question above) before writing the migration; do not build against a possible misreading of a one-word answer.

---

## Feature B — Unit Construction Checklist

### Problem Statement
The construction head tracks each unit's build-out as a fixed, ordered sequence of stages (e.g. "01 – Contracts" through "22 – Final Inspection" for an interior build-out, or an 18-stage list for a building shell/site). Today this lives in an external Monday.com board. The existing in-app "Construction Updates Board" (`Task`/`TaskUnit`, shipped 2026-08-13) is ad-hoc-item shaped — title, status, priority, assignee, day-wise updates — and does not model a fixed numbered checklist with per-stage owner and inspection status. Building this as a distinct, template-driven checklist (confirmed by the client) avoids distorting the Task model to fit a shape it wasn't designed for.

### Goals
- Every unit that enters construction gets a checklist of ordered stages, each independently trackable by status, owner, and inspection status.
- The construction head can update any unit's checklist stage-by-stage without leaving the unit/building view.
- Stage templates are defined per building (a shell/site-level building and an interior-fit-out unit legitimately need different stage lists, as shown in the two screenshots), and new stages can be added to a template or to a single unit's instance without breaking other units.
- Reporting can answer "which units are behind on which stage" across a project.

### Non-Goals
- **Not** replacing or merging with the existing Task/Construction Updates Board — that system stays for ad-hoc work items, multi-unit/multi-building tasks, and day-wise `TaskUpdate` logs. This is a separate, template-driven checklist.
- **Not** building generic workflow/BPM tooling — stages are a simple ordered list, not a DAG (unlike `Milestone.dependsOnId`, which already handles dependency graphs elsewhere in the app).
- **Not** a client/tenant-facing view in this phase — this is internal (Construction, PM, Founder/Executive roles) only.
- **Not** scheduling/date-planning per stage in v1 (no start/end dates, no Gantt) — status + owner + inspection status only, matching what the screenshots actually show.

### User Stories
- As a Construction Head, I want to mark a unit's stage (e.g. "12 – Flooring") as Done and note the inspection status, so the team sees real-time build progress per unit.
- As a Construction Head, I want a unit's checklist to start pre-populated from its building's stage template, so I don't re-type the same 18–22 stages for every unit.
- As a Construction Head, I want to add an extra stage to one unit's checklist (a one-off requirement) without changing the template every other unit uses.
- As a PM/Founder, I want to see every unit currently in construction, with each unit's current stage and how many stages remain, so I can spot units falling behind.
- As a PM, I want to define or edit a building's default stage template (add/reorder/rename stages), so new units created under that building start with the right checklist automatically.

### Requirements

**Must-Have (P0)**
1. `ConstructionStageTemplate` (per building, or per `buildingType`/`unitType` if the client confirms templates are type-based rather than building-instance-based — see Open Questions) holding an ordered list of stage names.
2. `UnitConstructionStage` — one row per unit per stage, copied from the template when a unit enters construction (or is created under a building with a template). Fields: `sortOrder`, `label`, `status` (reuse the existing `CustomOption` category pattern — `Not Started | Working on it | Done | Blocked`, same slugs already used for Task status per [[prime-tracker-construction-board]]), `ownerId` (nullable `User`), `inspectionStatus` (new — no equivalent exists anywhere in the schema today; needs its own small enum/CustomOption category), `inspectionDate` (nullable), `notes` (nullable).
3. Adding a stage to one unit does not affect the template or any other unit's checklist (each `UnitConstructionStage` row is independent once created).
4. Adding a stage to a *template* only affects units created afterward — existing units' checklists are not retroactively modified (same "past is immutable, only future changes" principle already used for `BudgetRevision` and `LeaseRentPeriod` elsewhere in this app).
5. UI: a checklist panel on `UnitDetailPage` (or a new tab/section per the two screenshots' layout — ordered rows, owner avatar picker, status pill, inspection status column) editable by roles with `construction:edit` (or equivalent — confirm against the existing permission set), read-only for others.
6. A project- or building-level rollup view: units currently in construction, their current/next incomplete stage, and count of stages remaining — for the PM/Founder use case above.

**Nice-to-Have (P1)**
- Bulk "mark stage done for units X, Y, Z" action when the same stage completes for several units on the same day (mirrors how the client's board groups work).
- Notification when a stage's status changes to Blocked (reuse the existing notification-trigger pattern from [[prime-tracker-construction-board]] — `TASK_ASSIGNED` was added the same way).
- Photos attached per stage (reuse `TaskUpdatePhoto`'s presigned-upload pattern rather than inventing a new one).

**Future Considerations (P2)**
- Linking a checklist stage to a `Milestone` or `DrawSchedule` line (some stages likely gate draw requests — out of scope until Interior/Fit-Out module work clarifies that link, per `docs/client-discovery/INTERIOR_MODULE_DESIGN.md`).
- Client/buyer-portal visibility into build progress (Phase 2 buyer portal is out of scope for this spec).

### Success Metrics
- Every unit that enters `UNDER_CONSTRUCTION` status has a checklist within [target: same session it's created/status-changed] — no manual template copy-paste needed.
- Construction head can update a stage in ≤2 clicks from the unit view (status pill + save), matching the external board's speed.
- Zero units "in construction" with zero checklist stages after 30 days of use (the whole point is to replace the spreadsheet-equivalent, so an empty checklist is a tracking gap).

### Open Questions
- **[Blocking — client]** Are stage templates keyed to a specific **building** (each building instance gets its own editable template, as the two screenshots — different unit, different building — suggest) or to a **building/unit type** (all "shell" buildings share one template, all "interior fit-out" units share another)? This determines whether `ConstructionStageTemplate` has a `buildingId` FK or a `buildingType`/`unitType` string key. Recommendation leans building-instance (matches "Per-building template" answer already given), but confirm whether that means literally one template per building record or one per building *type*.
- **[Engineering]** Confirm `inspectionStatus` value set — the screenshots show it as a column but the visible rows are all "Not Started" for both; need the client's actual value list (e.g. Not Started / Scheduled / Passed / Failed) before modeling it as a `CustomOption` category.
- **[Engineering]** Does creating a `Unit` under a building with a template auto-populate its checklist immediately, or only when the unit's status changes to `UNDER_CONSTRUCTION`? Affects whether every unit always carries a checklist or only ones actively being built.
- **[Non-blocking — design]** Exact placement: new tab on `ProjectDetailPage`/`UnitDetailPage`, or a section within an existing tab (e.g. `construction`)? `TAB_MAP` already has a `construction` tab (Buildings + Budget/Costs) — recommend a sub-section there rather than a 12th top-level tab, pending confirmation.

### Timeline Considerations
- Independent of Feature A — no shared schema or code. Can build in parallel or in either order.
- Natural sequencing: template + `UnitConstructionStage` schema and CRUD first (P0-1–4), then the UI panel (P0-5), then the rollup view (P0-6) — each is independently testable and shippable.
- Reuses several existing patterns (CustomOption status slugs, presigned-upload photos, notification triggers) — estimate should credit that reuse rather than pricing this as a from-scratch module.
