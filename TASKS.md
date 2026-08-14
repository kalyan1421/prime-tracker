# Tasks

## Active

- [ ] **Build lease transitions (endTenancy + assignTenant)** - spec at `docs/client-discovery/LEASE_TRANSITION_SPEC.md`, all 4 scenarios
  - [x] ~~1.1 migration + constraint rebuild~~ (2026-08-13) — `20260813000000_lease_tenancy_transition`, 566/566 tests
  - [x] ~~1.2 `endTenancy()` — cap schedule, void future invoices, settle deposit, flip unit, write `unit_status_events`~~ (2026-08-13) — 581/581, verified E2E
  - [ ] **Confirm with client:** deposit REFUND/FORFEIT records the decision as a note only, does not move money (TRANSFER does)
  - [x] ~~1.3 `assignTenant()` + `LEASE_PENDING` in the unit state machine~~ (2026-08-13) — 589/589, verified E2E
  - [ ] **Revisit:** `assign-tenant` uses `lease:edit`; spec suggested a stricter bar, deferred until R27's permission split is decided
  - [x] ~~1.4 timeline `tenancy_end` + `assignment` kinds, suppress phantom vacancy~~ (2026-08-13) — 599/599
  - [x] ~~1.5 UI dialogs + extend `invalidateAfterLeaseWrite()`~~ (2026-08-13) — verified in the running app
  - **Phase 1 COMPLETE.** Remaining: the deposit + permission confirmations above.
- [ ] **Build construction updates board (Phase 2)** - spec at `docs/client-discovery/CONSTRUCTION_UPDATES_BOARD_SPEC.md`
  - [x] ~~2.1 migration — `task_units`, `tasks.kind`, `task_updates`, `daily_logs.unitId`, `TASK_ASSIGNED`~~ (2026-08-13)
  - [x] ~~2.2 service — multi-unit CRUD, updates, mentions, assignment notification + the missing spec file~~ (2026-08-13) — 620/620
  - [x] ~~2.3 board view as the "Updates Board" tab on ProjectDetailPage~~ (2026-08-13) — verified in the running app
  - [x] ~~2.4 construction section on UnitDetailPage + photo upload on updates~~ (2026-08-13) — verified in the running app
  - [x] ~~2.5 seed the Lewisville board as a fixture~~ (2026-08-13) — `prisma/seed-construction-board.ts`, idempotent
  - **Phase 2 P0 COMPLETE.** P1 polish (R9-R13) deliberately unscheduled until the PM has used it 2 weeks.
  - **Decisions I made rather than blocked on** — confirm when convenient: `BLOCKED` added to `task_status`
    (the blank cell on their board); one item cannot span two buildings (API refuses it)
- [x] ~~**Prompt for tenant details when a unit is flipped to a leased status**~~ (2026-08-13) — UnitDetailPage
  auto-opens the lease form + a persistent "marked leased, no tenant" banner; ProjectDetailPage grid already
  did this for LEASED, now extended to LEASE_PENDING/OCCUPIED so both paths agree
- [ ] **Test gaps — plan at `docs/client-discovery/TESTING_STRATEGY.md`** (~5 days, items 1-2 are the ones not to skip)
  - [x] ~~closed the mocked-but-untested units: capAtTermination, paidAfter, voidAfter, photo storagePath guard~~ (2026-08-13, +29 tests)
  - [x] ~~fixed: `Task.kind` reached the DB unvalidated (`@Body() any` bypasses the DTO) — a bad value made the row invisible on BOTH views~~
  - [x] ~~controller + DTO tests~~ (2026-08-13) — `route-permissions.spec.ts` sweeps every controller (642 checks), `tenancy-dto.spec.ts` runs the real ValidationPipe (31)
  - [x] ~~integration harness + DB constraint tests~~ (2026-08-13) — `pnpm test:integration`, 17 checks, rolled back
  - [x] ~~transaction rollback~~ (2026-08-13) — endTenancy atomicity against the real transaction
  - [x] ~~Playwright journeys for both features~~ (2026-08-13) — 5 passing in 12s
  - [ ] **vitest + component tests — the only gap left.** Needs new dev deps in apps/web; say the word
  - [ ] **CI must set `CI=1`** or the integration suite skips silently on a machine with no Postgres and still reports green
  - [ ] **Decide:** `leases.unitId` is `ON DELETE SET NULL`, so deleting a unit orphans its leases (pointing at neither unit nor building — violates the service's "exactly one of" rule)
- [x] ~~**Bug: successor-lease dropdown was always empty**~~ (2026-08-13) — `EndTenancyDialog` was passed
  `u.building.projectId`, which does not exist (the unit payload nests `building.project.id`), so
  `useLeases('')` stayed disabled. Now uses the route param + an empty state that says how to create one
- [x] ~~**Unit status vs lease contradiction — surfaced**~~ (2026-08-13) — derived tenancy state (Active /
  Ending soon / Term ended / Draft / Past tenant), past tenancies render as history, contradiction banner.
  Review: `docs/client-discovery/UNIT_LEASE_CONSISTENCY.md`. **NB the first count (101) was wrong — inflated
  ~10x by not excluding units under soft-deleted projects (471 of 529 units are). Real figure: 13**
- [x] ~~**Lease activation now drives unit status**~~ (2026-08-13) — `LeasesService.syncUnitFromLease`, in the
  same transaction as the lease write. ACTIVE only; never un-sells SOLD; never downgrades OCCUPIED; event
  dated by `leaseStart`. 1331 tests
- [x] ~~**Backfill script**~~ — `prisma/fix-unit-lease-consistency.ts`, dry-run by default. Fixes category B
  only; reports A/C/D and refuses to guess
- [ ] **13 units need a human decision** (live projects): 8 SOLD with a live lease, 5 marked tenanted with no
  lease. Run the script and walk the list with Prime
- [ ] **DECIDE: should a DRAFT lease move the unit to LEASE_PENDING?** Currently it does not — a draft may be
  speculative. If Prime only drafts once signed, it should
- [x] ~~**Bug: a unit whose project is soft-deleted still renders**~~ (2026-08-13) — `UnitsService.findById` now
  404s when the unit OR its building OR its project is soft-deleted. 4 tests
- [x] ~~**Unit detail whitespace**~~ (2026-08-13) — cards were stretching to the tallest in the grid row.
  Now CSS masonry (`columns`) so each card takes its own height and the next flows into the gap; empty
  sections collapse to a title row with "None". Reading order is column-major — a deliberate trade
- [x] ~~**Duplicate "Deposits & Allowances" on the unit page**~~ (2026-08-13) — the unit-wide
  `ObligationSummaryCard` and the per-lease `LeaseObligationsPanel` showed identical totals on a
  single-lease unit. Rollup now renders only when there is >1 tenancy to roll up
- [x] ~~**Lease-change history entries now explain themselves**~~ (2026-08-13) — header summarises what
  changed; each row carries a delta ("13 months earlier", "+$3,000", "6 fewer"). Deltas are neutral, not
  colour-coded: "up" is good for rent and bad for a TI allowance
- [x] ~~**"12.032258 paying months"**~~ (2026-08-13) — unformatted float, now rounded to 1dp
- [ ] **EDGE-CASE FIX PLAN — `docs/client-discovery/EDGE_CASE_FIX_PLAN.md`** (~13.5 days, 6 phases).
  Suggested first cut: A + B + F (~5.5d) closes both revenue gaps + the DRAFT behaviour
  - [x] ~~**A. Sale closes the lease (H3)**~~ (2026-08-13) — `endTenancyWithin` runs in the sale's own
    transaction; a sale REFUSES to close if the tenancy can't be ended. Verified E2E
  - [x] ~~**B. Holdover: notify + bill**~~ (2026-08-13) — `LEASE_HOLDOVER` (ACTION, recurring, leadership),
    `Lease.holdoverRatePct`. **Billing is OPT-IN (rate NULL by default)** — see below
  - [x] ~~**C. Warn when editing a lease that already has a ledger**~~ (2026-08-13) — names the invoice count
    and range ("6 invoice(s) … covering Jan 2026 – Jun 2026"); Rent Collection now shows "Billed through <month>"
  - [ ] **D. R22 corrections with provenance** — 2.5d, needs `lease:history:correct` + Finance review
  - [~] **E. H2 backfill — API DONE 2026-08-13, UI still to build**
    - [x] ~~permissions `unit:history:backfill` (Sales) / `unit:history:delete` (Founder)~~ — Q2 option b
    - [x] ~~`POST /leases/backfill`~~ — creates lease + schedule + COMPLETE ledger defaulted to PAID,
      backdates two occupancy events, and does NOT touch the unit's current status. Verified E2E
    - [x] ~~**UI: "+ Record a past tenancy" on the Unit Detail page**~~ (2026-08-13) — collapsed per-month
      collection grid (default all-paid), verified E2E: 18 months billed, unit status untouched
    - [ ] `unit:history:delete` is granted but nothing consumes it — the R27 `HistoricalRecordDeletion`
      approval row is not built, so deletion is still a plain lease delete
  - [x] ~~**F. DRAFT → LEASE_PENDING**~~ (2026-08-13) — never moves a unit backwards from LEASED/OCCUPIED
  - [ ] **CONFIRM: holdover billing is OPT-IN per lease.** The rate defaults to NULL, so nothing bills until
    someone sets it (100 = same rent). The system cannot tell a real holdover from a lease nobody closed, and
    invoices are permanent once generated. Set all at once with:
    `UPDATE leases SET "holdoverRatePct"=100 WHERE "holdoverRatePct" IS NULL;`
  - [x] ~~**Holdover UI**~~ (2026-08-13) — "Holdover rent (%)" on the lease form; blank = do not bill,
    100 = same rent. Blank sends NULL so clearing it actually clears it
  - [x] ~~**H2 volume**~~ — client confirms 2026-08-13 they have a team to enter all past detail; manual
    entry stands, no CSV import
- [ ] **Flow + edge-case analysis written** — `docs/client-discovery/TENANCY_AND_RENT_FLOWS.md`. Two 🔴 gaps
  it surfaced that were not previously on this list:
  - [ ] **Closing a sale does NOT end the lease** — `SalesService.close()` has zero lease references. This is
    the missing H3 and the cause of the 8 sold-with-live-lease units
  - [ ] **Holdover cannot be billed at all** — `terminationDate` can record it, the schedule cannot charge it
  - [ ] **Editing a lease after its ledger exists** silently leaves the two disagreeing — needs a warning
- [ ] **Raise with client: commission clawback on early termination** - `TOTAL_TERM_RENT` commission is stamped on activation from the full term
- [x] ~~**Data integrity: SOLD units with an ACTIVE lease**~~ — client confirms 2026-08-13 these are **test
  data, not real**. Still run the query once against PRODUCTION to confirm. Original note:
- [ ] ~~superseded~~ **Data integrity: SOLD units with an ACTIVE lease** - dev DB shows 8 (2 are QA fixtures). 5 have NO sale row at all (104, 105, 106, 207, 209); 107 closed 2026-08-12 with its lease still ACTIVE and 1 paid invoice. **Run the same query against production** — `endTenancy` will refuse where money sits past the closing date

## Waiting On

- [x] ~~**Q3 — per-month collection history?**~~ ANSWERED 2026-08-13: **yes**, and all past rental detail needs entering. **H2 is unblocked**
- [ ] **Q1/Q8 — has Prime ever sold a tenanted unit to an outside investor?** - blocks H3 (lease→sale conversion), since 2026-08-12
- [x] ~~**Q11 — free rent abated vs grossed up**~~ ANSWERED 2026-08-13: **33 × rent (abated)** = the current build. **Zero code.** R24 gross-up branch dropped
- [x] ~~**R22 — editable past rent periods**~~ ANSWERED 2026-08-13: **correction-with-provenance behind a permission**, not silent mutation. Finance to review before it ships
- [ ] **AWS cutover** - client deferred; keep working on the local DB
- [ ] **Construction board: 3 blocking questions** - status value set (keep 4 slugs + add BLOCKED?), can an item span two buildings, own nav entry vs `/tasks` filter

## Someday

- [ ] **R9–R13** - P1 rent-history polish
- [ ] **R24** - free-rent gross-up branch, only if Q11 says so

## Done
