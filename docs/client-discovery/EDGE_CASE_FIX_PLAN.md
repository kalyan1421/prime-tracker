# Edge-case fix plan

**Date:** 2026-08-13
**Basis:** client answers received 2026-08-13, against the edge cases catalogued in
[TENANCY_AND_RENT_FLOWS.md](./TENANCY_AND_RENT_FLOWS.md).

---

## 1. Decisions received 2026-08-13 — now locked

| # | Question | Answer | Consequence |
|---|---|---|---|
| **Q11** | Free rent: 36 months / 3 free — abated or grossed up? | **33 × rent (abated)** | ✅ **Zero code.** This is exactly what the build already does. The R24 gross-up branch is now formally dropped |
| **Holdover** | What happens when a tenant overstays? | **Notify Founder + Super Admin**, bill the **same rent** | 🔨 Build. Two parts: a notification, and the schedule extension that makes billing possible at all |
| **DRAFT** | Does a draft mean "signed, not started"? | **Yes — a draft should set the unit to `LEASE_PENDING`** | 🔨 Build. Reverses the conservative default I shipped on 2026-08-13 |
| **R22** | Should past rent periods be editable? | **Correction-with-provenance, behind a permission — not silent mutation** | 🔨 Build. New `lease:history:correct` permission + a correction record |
| **Q3** | Do you know per-month collection history for the backfill? | **Yes — and all past rental details need entering** | ✅ **H2 is unblocked.** Historical ledgers are real, not reconstructed |
| **Data** | The 8 sold-with-a-live-lease units | **Test data, not real** | ✅ Closed for dev. Production still needs the same query run once |

### One thing still ambiguous — and how I am reading it

> *"Holdover rent send notification to founder and super admin and do you bill the same rent"*

I am reading this as **bill the same rent**, and building it that way. Flagging it because
the commercial default in US retail is usually an **uplift** (125–150% of the last rate)
precisely to discourage overstaying, so "same rent" is a deliberate choice rather than an
oversight — worth one confirmation before it bills a real tenant.

The rate is implemented as a **per-lease multiplier defaulting to 1.0**, so moving to
150% later is data entry on the lease, not a code change.

---

## 2. The plan

Five phases. Ordered by whether the gap loses money, then by what unblocks what.

---

### Phase A — Sale closes the lease (H3) ⚠️ SHIPPED, then superseded 2026-08-14

> **Superseded by `SALE_ON_TENANTED_UNIT_SPEC.md`.** Phase A shipped and closed the hole
> described below, but it did so on an assumption — that the sitting tenant is always the
> buyer — which a code review on 2026-08-14 found to be load-bearing and wrong. A
> third-party sale of a tenanted unit currently DESTROYS the tenancy: schedule deleted,
> invoices voided, tenant still in occupation. Four further defects were confirmed in the
> same path (the tenancy-ended notification was captured and never emitted; a drafted
> renewal blocks the close outright; the deposit is silently orphaned; nothing warns the
> user). Read the new spec before touching this code.

### Phase A — original entry 🔴 **~2 days**

**The gap.** `SalesService.close()` contains **zero** references to a lease. Closing a
sale flips the unit to `SOLD` and stops. The lease stays ACTIVE and only the cron's
sold-unit filter stops it being billed. This is the largest hole in the system.

The 8 affected units being test data is good news for the data, and changes nothing about
the code — the next real sale of a tenanted unit does exactly the same thing.

**Fix.**
1. `SalesService.close()` calls `endTenancy` in its existing transaction, with
   `terminationReason: 'TENANT_BOUGHT'` and `terminationDate = closingDate`.
2. If `endTenancy` refuses — rent collected past the closing date — the **sale close is
   refused too**, naming the months. A sale that half-closes is worse than one that
   refuses: the unit would read SOLD with a tenancy still running.
3. `SalesService.cancel()` must **not** resurrect the lease. A cancelled sale releases the
   unit; it does not un-end a tenancy that genuinely ended.

**Edge cases covered:** lease→sold (all four), and it removes the "sold with no sale
record" fallback path for anything created after it ships.

**Confirm first:** the build assumes a sale always means **the sitting tenant bought**.
If Prime ever sells a tenanted unit to an outside investor, the lease must *survive* the
sale and this needs a second path. Still unanswered.

---

### Phase B — Holdover 🔴 **~2 days**

**The gap.** `terminationDate` can *record* a holdover (no upper CHECK, deliberately) and
the timeline reports "held over N days" — but **no rent is generated for those months, at
any rate.** A tenant overstaying currently produces zero revenue in the system.

**Fix.**

1. **Detect.** A lease is in holdover when `leaseEnd < today`, `terminationDate` is null
   and status is ACTIVE. That is exactly the "expired but still ACTIVE" query already in
   the consistency script.
2. **Notify** — new `LEASE_HOLDOVER` notification type, **ACTION** tier, routed to
   `LEADERSHIP_ROLES` (which already means SUPER_ADMIN / FOUNDER / EXECUTIVE — note it
   includes EXECUTIVE; say if that should be narrowed). Raised by the existing daily
   08:00 CT cron, with a `dedupeKey` of `holdover:<leaseId>` so it re-raises while the
   condition persists without spamming daily.
3. **Bill.** New `Lease.holdoverRatePct` (default `100`). Past `leaseEnd`, the schedule
   extends month by month at `last paying rent × holdoverRatePct / 100`, generated by the
   same cron. Periods carry `source: 'HOLDOVER'` so they are visibly not contracted term.
4. **Stop** the moment `endTenancy` is called — `capAtTermination` already truncates at
   the move-out date and needs no change.

**Why a multiplier rather than a flag:** it makes "same rent" and "150%" the same code
path, and the answer becomes data entry per lease.

**Edge cases covered:** holdover 🔴, and the "expired but still ACTIVE" category in the
consistency scan stops being a silent state.

---

### Phase C — Editing a lease that already has a ledger 🔴 **~1.5 days**

**The gap.** Moving `leaseStart` after invoices exist leaves the lease and the ledger
silently disagreeing. Periods that have started are frozen; invoices are idempotent on
`(leaseId, periodMonth)`, so months billed under the old dates stay billed and
regenerating will not correct them. *This is what the reported screenshot showed —
`leaseStart` moved from Aug 2026 back to Jan 2026 with a ledger already in place.*

**Fix.**

1. **Warn before the save, not after.** The lease form, when the lease has invoices,
   shows: *"12 invoices already exist for this lease, covering Jan–Aug 2026. Changing the
   dates will not revisit them."* — with the affected range spelled out.
2. **Offer the reconciliation** rather than leaving it to be discovered: after a
   date-changing save, list the invoices now outside the term and offer to VOID them, as
   one reviewable action.
3. **Surface ledger coverage** — a line on the Rent History header: *"Billed through
   August 2026."* Today nothing tells a user whether Generate ledger did anything, which
   is its own edge case.

**Edge cases covered:** moving `leaseStart` 🔴, shortening the term 🔴, and the
"regenerating won't fix a wrong invoice" trap.

---

### Phase D — R22 corrections with provenance ✅ **SHIPPED 2026-08-14**

**The decision.** Past periods stay immutable by default. Corrections are a **recorded
act**, not an edit.

**Fix.**

1. New permission **`lease:history:correct`**, granted to nobody by default — Prime
   chooses the roles. It is deliberately separate from `lease:edit`, because editing
   future terms and rewriting billed history are different powers.
2. New `LeaseRentPeriodCorrection` row per correction: period, old value, new value,
   reason (**mandatory**, same rule as `BudgetRevision`), who, when.
3. The period is updated **and** the correction recorded, in one transaction. The
   original value is never lost.
4. Any invoice generated from a corrected period is flagged for review — the correction
   changes what was owed, and the ledger already billed the old figure.
5. Corrections appear on the unit timeline as their own entry kind, visually distinct
   from a scheduled escalation or a manual renegotiation.

**Finance should see this before it ships** — that was their own note, and it is the
right one: this is the only feature that can change a number a tenant was already billed.

**Edge cases covered:** past-period immutability, and the "correcting means voiding or
editing the row" gap in the ledger.

**As built (2026-08-14).** All five points shipped. Notes on the choices that were not
spelled out above:

- **`lease:history:correct` is granted to no role explicitly**, as specified. It is not
  literally held by nobody: FOUNDER and SUPER_ADMIN inherit it from their blanket grants.
  So until Prime assigns it, the people who can correct billed rent are exactly the people
  who already own the whole book — which is the intended posture, but worth stating rather
  than leaving as an assumption.
- **Flagged, never adjusted.** A corrected period sets `needsReview` + `reviewReason` on
  every non-VOID invoice billed from it. `amountDue` is untouched, because the invoice
  records what was actually billed and the discrepancy is the thing Finance needs to see.
  `POST /leases/rent-invoices/:id/clear-review` (behind `rent:collect`, not the correction
  permission) records that somebody looked; it changes no money.
- **Only a money change flags invoices.** Moving a period's dates changes what it covers
  going forward; it does not restate a figure already sent out.
- **The correction row stores `invoicesFlagged`** rather than recomputing it. It is the
  number that was true at the moment of the correction; re-deriving it later gives a
  different answer as the ledger moves.
- **Two DB CHECKs** back the DTO: the reason cannot be blank, and the correction must
  actually change something.
- `summariseInvoices` gained `flaggedCount`, counted separately from `overdueCount` —
  a flagged month may be fully paid, since the question is what was billed, not whether
  the money arrived.
- UI: a "Correct" action on billed rows for permission holders (never on future rows,
  where "Add rent change" is the right tool), a dialog that leads with the distinction
  between the two, the provenance trail under the schedule, and an amber CHECK AMOUNT
  badge on flagged months — deliberately not red, so a questioned month does not read as
  a tenant being chased.

**Where it lives** — `LeaseRentPeriodService.{correctPeriod,findCorrections,clearInvoiceReview}`,
migration `20260814000000_rent_period_corrections`, `LeaseRentSchedule.tsx` +
`RentCollectionPanel.tsx`. 19 unit tests.

**Still owed to Finance:** the walkthrough they asked for. The code is shippable; the
conversation is not optional.

---

### Phase E — Backfill (H2) 🟠 **~4 days — now unblocked**

**Unblocked by Q3.** Prime knows per-month collection history, so historical ledgers are
**real data, not reconstruction**. That was the fork the whole phase waited on.

**Fix.**

1. Manual entry on the Unit Detail page — Founder + Sales, per the 2026-08-12 decision.
   Explicitly **not** a CSV import.
2. Historical leases generate the full month-by-month ledger, defaulted to **PAID** so
   they never appear as overdue AR — then per-month collection is entered where it
   differs, which is now worth doing because the data exists.
3. Two permissions: `unit:history:backfill` (Sales can create/edit) and
   `unit:history:delete` (Founder approves deletion), via a `HistoricalRecordDeletion`
   request modelled on `Sale.discountApprovedBy`.
4. Backfilled occupancy events use `source: 'BACKFILL'`, `isHistorical: true`, dated by
   the lease — the plumbing already exists and is used by the consistency script.

**Still worth asking:** roughly how many historical records? Above ~150 the manual-entry
decision deserves revisiting, however clear it was in principle.

---

### Phase F — Smaller items 🟠🟡 **~1.5 days total**

| | Item | Fix |
|---|---|---|
| 🟠 | **DRAFT does not move the unit** | Extend `syncUnitFromLease`: DRAFT → `LEASE_PENDING`. The state machine already allows `AVAILABLE → LEASE_PENDING` and `LEASED → LEASE_PENDING` |
| 🟠 | **Renewal linked after the fact leaves a phantom vacancy** | The occupancy log is append-only, so the vacancy event cannot be retracted. Instead: when a successor is linked to an already-ended lease, write a *correcting* event rather than pretending the first never happened |
| 🟠 | **Commission not clawed back on early exit** | Still unanswered. When answered: re-stamp on `endTenancy` if the basis is `TOTAL_TERM_RENT` |
| 🟠 | **`termMonths` is derived, silently** | One line of help text under the field |
| 🟡 | **"Create and link the renewal" from End tenancy** | Removes the create-first-then-come-back detour |
| 🟡 | **Day totals predate the occupancy log** | Already flagged in the UI; revisit after H2 backfills real history |

---

## 3. Sequencing and effort

| Phase | Work | Days | Blocks |
|---|---|---:|---|
| **A** | Sale closes the lease (H3) | 2 | — |
| **B** | Holdover: notify + bill | 2 | — |
| **C** | Lease-edit vs ledger warning | 1.5 | — |
| **D** | R22 corrections with provenance | 2.5 | Finance review |
| **E** | H2 backfill | 4 | benefits from C |
| **F** | Smaller items | 1.5 | — |
| | **Total** | **13.5** | |

A, B and C are independent and can run in any order. **D should not ship without Finance
seeing it.** E is the longest and now has no blockers.

Suggested first cut: **A + B + F** (~5.5 days) — that closes both 🔴 revenue gaps and the
DRAFT/`LEASE_PENDING` behaviour the client just asked for.

---

## 4. Still open

1. **Holdover rate** — building "same rent" per the answer, as a per-lease multiplier.
   One confirmation before it bills a real tenant.
2. **Holdover recipients** — `LEADERSHIP_ROLES` includes EXECUTIVE alongside
   SUPER_ADMIN/FOUNDER. Narrow it, or is Executive fine?
3. **Third-party sale of a tenanted unit** — Phase A assumes the sitting tenant always
   buys. If not, the lease must survive the sale.
4. **Commission clawback on early termination.**
5. **Which roles get `lease:history:correct`.**
6. **Roughly how many historical records** for H2.
7. **Run the consistency query against production** once — the dev numbers were test data.
