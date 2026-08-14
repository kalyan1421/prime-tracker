# Unit Occupancy History, Rental Economics & Lease→Sale Conversion

**Spec / PRD — 2026-08-12** (rev. 2 — adds Part 2, rental-history corrections)
Status: Draft for client sign-off
Owner: Kalyan (Asan Innovators)
Related: [LEASING_AND_NOTIFICATIONS_PLAN.md](LEASING_AND_NOTIFICATIONS_PLAN.md), [SALE_PAYMENT_SCHEDULE_DESIGN.md](SALE_PAYMENT_SCHEDULE_DESIGN.md), [UPDATE_PLAN.md](UPDATE_PLAN.md)

---

## TL;DR for the reader in a hurry

The ask ("unit history, rental values, lease-then-sold, and backfill 1–2 years") is **~55% already built**. The
Unit Detail page already renders a lease/sale/vacancy timeline and a per-lease rent schedule + payment ledger,
and `GET /units/:id` already returns every lease a unit ever had.

What is genuinely missing is three things:

1. **Occupancy age is destructively tracked.** `Unit.availableSince` is one nullable column that is overwritten
   on every status flip. Once a unit leases, "how long was it vacant" is gone forever. There is no status event log.
2. **There is no lease→sale conversion.** Closing a sale flips the unit to `SOLD` but leaves the sitting lease
   `ACTIVE` — the rent-invoice cron keeps billing a tenant who now owns the unit.
3. **There is no way to enter the past.** Every guard in the system assumes data arrives forward in time:
   one-active-lease-per-unit, the unit status state machine, `availableSince = new Date()`, and an invoice
   generator that would emit ~24 months of `DUE` rows and light up the overdue-AR reports.

This spec closes those three gaps and adds a Founder/Sales-facing manual backfill flow on the Unit Detail page.

**Part 2** (added rev. 2) covers the client's rental-history feedback of 2026-08-12: separate rent
commencement date, NNN per sqft, editability of past rent history / TI allowance / commission, and surfacing
rent changes in unit history. Two of those eight items are already built, three are pure UI wiring, two are
schema additions, and one — making past rent periods editable — **reverses a decision the client locked on
2026-07-29** and is the reason they are asking for a call.

---

## Reading guide

| Part | Covers | Status |
|---|---|---|
| Part 1 (R1–R18) | Occupancy history, lease→sale conversion, historical backfill | Draft, unchanged from rev. 1 |
| **Part 2 (R19–R26)** | **Rental-history corrections from 2026-08-12 client feedback** | **New in rev. 2** |
| Call agenda | The four things that need the client on a call, not an email | New in rev. 2 |

---

## Problem Statement

Prime's team cannot answer basic questions about a unit's life: *how long did it sit vacant before it leased,
what did each past tenant actually pay, and what happened when it finally sold?* Today the platform records
the unit's **current** state well but keeps almost no durable record of how it got there — `availableSince`
is overwritten on every status change, and the last two years of leases and sales (pre-dating the platform)
have never been entered at all because the system structurally rejects backdated records.

The cost: vacancy and time-on-market reporting starts from "whenever the row was touched last," not from
reality; the rent-roll and revenue reports understate historical income; and when a sitting tenant buys their
unit, the platform silently keeps invoicing them rent. Prime is making pricing and re-let decisions on a
dataset that begins on the day someone last clicked a status dropdown.

---

## Goals

1. **A unit's full occupancy history is reconstructable and never destroyed** — every status transition,
   vacancy window, tenancy and sale attempt is a durable record, not a derived guess from mutable columns.
2. **Time-on-market and vacancy metrics are historically accurate** — the Vacancy Report and the stale-unit
   exception feed compute from real vacancy windows, not from `availableSince ?? createdAt`.
3. **A lease that converts to a sale ends cleanly** — one action closes the sale, terminates the lease on the
   closing date, stops the rent ledger, flips the unit to `SOLD`, and leaves the tenancy intact in history.
4. **Two years of historical leases and sales can be entered by the team without engineering help** — from the
   Unit Detail page, by Founder and Sales, with the full rental economics (rent, escalations, deposit, NNN,
   collected months) captured, not just a date range.
5. **Backfilled history is indistinguishable from live history in reporting, and clearly marked in the UI** —
   historical rows roll into revenue/occupancy reports but carry provenance so nobody mistakes a typed-in
   figure for a system-recorded one.

---

## Non-Goals

1. **CSV / bulk import.** Decided against for v1 — the team will enter records manually per unit. Revisit only
   if the volume proves unworkable (see Open Questions Q4).
2. **Reconstructing historical *documents*** (scanned leases, signed deeds). The doc vault already handles
   attachment; backfilling PDFs is a separate data-entry effort, not a code change.
3. **Historical accounting reconciliation with QuickBooks.** Backfilled rent invoices are a *property* record,
   not a general-ledger entry. No QB sync of historical rows.
4. **Building-level lease history.** Leases are polymorphic (unit *or* building), but the history timeline and
   backfill UI in v1 are unit-scoped only. Building-level history is P2.
5. **Third-party / investor sale of a tenanted unit.** Client decision: a sale close always means the sitting
   tenant bought. A tenanted unit sold to an outside investor is out of scope for v1 (see Open Questions Q1).
6. **Retroactive event replay.** Backfilled records do **not** emit `lease.created` / `unit.sold` events — no
   notifications, no audit-trail noise for things that happened in 2024.

---

## Current-State Findings (verified in code, 2026-08-12)

Read this before estimating — several "new" requirements are already shipped.

### Already built ✅

| Capability | Where | Note |
|---|---|---|
| Unit history timeline (leases + sales + vacancy gaps) | [UnitDetailPage.tsx:124](../../apps/web/src/pages/UnitDetailPage.tsx#L124) `buildUnitHistory()` | Derived client-side from the lease/sale arrays |
| Per-unit rent history — every lease, newest first | [UnitDetailPage.tsx:248](../../apps/web/src/pages/UnitDetailPage.tsx#L248) `UnitRentHistory` | Collapsible; expanded lease shows schedule + ledger |
| All leases (not just active) returned on unit read | [units.service.ts:74](../../apps/api/src/modules/units/units.service.ts#L74) | `leases: { where: { deletedAt: null } }` |
| Contracted rent schedule w/ escalations + free rent | `LeaseRentPeriod` | `source: INITIAL \| AUTO_ESCALATION \| MANUAL \| FREE_RENT` |
| Monthly collection ledger, proration, part-payments | `LeaseRentInvoice` | `@@unique([leaseId, periodMonth])` makes generation idempotent |
| Deposit / TI allowance as paid-down obligations | `LeaseObligation` + `LeaseObligationPayment` | Covers `SECURITY_DEPOSIT`, `TI_ALLOWANCE` |
| Tenant legal entity vs. brand (LLC dba) | `Lease.tenantLegalName` / `tenantBrand` | |
| Sale close → unit `SOLD`, optimistic-locked | [sales.service.ts:202](../../apps/api/src/modules/sales/sales.service.ts#L202) | |
| Sale cancel releases a reserved unit | [sales.service.ts:225](../../apps/api/src/modules/sales/sales.service.ts#L225) | |
| Unit merge retains source-unit history | `Unit.mergedIntoId` / `mergedFrom` | |
| Invoice generator backfills leaseStart→today | [lease-rent-invoice.service.ts:431](../../apps/api/src/modules/leases/lease-rent-invoice.service.ts#L431) `generateForLease` | **Also the main backfill hazard — see below** |

### Gaps and hazards ❌

| # | Finding | Evidence | Impact |
|---|---|---|---|
| G1 | `availableSince` is destructive — set to `now()` on flip *to* AVAILABLE, nulled on flip *away* | [units.service.ts:317-328](../../apps/api/src/modules/units/units.service.ts#L317) | Prior vacancy windows unrecoverable. Vacancy Report falls back to `createdAt` ([reports.service.ts:477](../../apps/api/src/modules/reports/reports.service.ts#L477)) |
| G2 | No unit status event log | — | "Age of unit history" cannot be answered for any period before the current status |
| G3 | Sale close does not terminate the sitting lease | [sales.service.ts:216](../../apps/api/src/modules/sales/sales.service.ts#L216) — flips unit only | Unit is `SOLD` while its lease is `ACTIVE`; `generateDueThrough` keeps invoicing the new owner |
| G4 | No lease→sale linkage of any kind | `Sale` has `convertedLead` but no `convertedLease` | Cannot report "how many tenants bought their unit" |
| G5 | One-active-lease-per-unit guard blocks backfill | [leases.service.ts:232](../../apps/api/src/modules/leases/leases.service.ts#L232) + partial unique index `lease_unit_active_unique` | A second historical lease is rejected unless the first is already `EXPIRED`/`TERMINATED` |
| G6 | Backdated lease generates months of `DUE` invoices | `generateForLease` backfills to today, default status `DUE` | Entering a 2024 lease creates ~24 overdue invoices → false AR, overdue notifications |
| G7 | Unit status state machine has no historical bypass | `STATUS_TRANSITIONS` + `STATUS_OVERRIDE_ROLES = [SUPER_ADMIN, FOUNDER]` | Sales cannot correct a unit into a historically-correct state |
| G8 | `SALES` role can only write `status` and `notes` on a unit | [units.service.ts:283-289](../../apps/api/src/modules/units/units.service.ts#L283) | Client wants Sales to do backfill — needs an explicit new permission |
| G9 | Vacancy is derived only between two *ended* leases | `buildUnitHistory` skips the gap before the first lease and after the last | Initial lease-up vacancy and current vacancy are invisible on the timeline |

---

## User Stories

### Founder / Executive
- As a **Founder**, I want to see a single timeline per unit covering every tenancy, vacancy window and sale
  attempt, so that I can judge whether a unit is priced right before we re-let it.
- As a **Founder**, I want to know the true total days a unit has sat vacant across its life, so that
  time-on-market is a real number and not "days since someone last touched the record."
- As a **Founder**, I want backfilled records visibly marked as historically entered, so that I know which
  figures came from the system and which came from a spreadsheet.

### Sales
- As a **Sales user**, I want to add a past lease to a unit — tenant, term, rent, escalation, deposit — from
  the unit's page, so that the two years before we adopted the platform stop being a blank.
- As a **Sales user**, I want to record that a past lease ended and the tenant then bought the unit, so that
  the unit reads as one continuous story rather than two unrelated records.
- As a **Sales user**, when a sitting tenant buys their unit today, I want one action that closes the sale and
  ends the lease on the closing date, so that we never invoice an owner for rent.

### Finance / AR
- As a **Finance user**, I want historical rent months to land in the ledger already settled, so that
  backfilling two years does not generate two years of fake overdue AR or trigger collection notifications.
- As an **AR user**, I want to see what each past tenant actually paid per month, so that I can answer
  "what did this unit earn in 2025" without opening a spreadsheet.

### Edge cases
- As a **Sales user**, if I enter a historical lease whose dates overlap an existing lease on the same unit, I
  want a clear conflict error naming the overlapping tenant and dates, so that I can fix the input.
- As a **Founder**, if I delete a mis-entered historical record, I want it soft-deleted and gone from the
  timeline, but recoverable, so that a data-entry mistake is not permanent.
- As a **Sales user**, when a unit has no history at all, I want the timeline to say so and offer the
  "Add historical record" action directly, so that the empty state is a starting point rather than a dead end.

---

## Requirements

### P0 — Must have

#### R1. `UnitStatusEvent` — an append-only occupancy log

New model. One row per status transition, written by `UnitsService.update()` and by every service that flips a
unit (sales close/cancel, lease activate/terminate). Never updated, never deleted.

```prisma
model UnitStatusEvent {
  id           String     @id @default(cuid())
  unitId       String
  unit         Unit       @relation(fields: [unitId], references: [id], onDelete: Cascade)
  fromStatus   UnitStatus?          // null = unit creation
  toStatus     UnitStatus
  effectiveAt  DateTime             // when it happened in the real world (backdatable)
  recordedAt   DateTime   @default(now())  // when the row was written — differs for backfill
  source       String               // MANUAL | LEASE_ACTIVATED | LEASE_ENDED | SALE_CLOSED
                                    // | SALE_CANCELLED | BACKFILL | SYSTEM
  leaseId      String?              // provenance, when driven by a lease
  saleId       String?              // provenance, when driven by a sale
  reason       String?              // required when source = MANUAL
  isHistorical Boolean    @default(false)  // true for backfilled rows
  recordedById String?
  recordedBy   User?      @relation(fields: [recordedById], references: [id])

  @@index([unitId, effectiveAt])
  @@index([toStatus, effectiveAt])
  @@map("unit_status_events")
}
```

`Unit.availableSince` stays as a denormalised convenience field (existing reports and the stale-unit cron read
it) but is **no longer the source of truth**. New derived reads compute from the event log.

**Acceptance criteria**
- [ ] Every unit status change writes exactly one `UnitStatusEvent`, inside the same transaction as the unit update
- [ ] Sale close writes one event with `source: SALE_CLOSED` and `saleId` set
- [ ] Sale cancel that releases a reserved unit writes `source: SALE_CANCELLED`
- [ ] Lease activation / termination write `LEASE_ACTIVATED` / `LEASE_ENDED` with `leaseId` set
- [ ] Events are never mutated — no update or delete endpoint exists
- [ ] A data migration seeds one bootstrap event per existing unit: `fromStatus: null`, `toStatus: <current>`,
      `effectiveAt: availableSince ?? createdAt`, `source: SYSTEM`
- [ ] Given a unit that went AVAILABLE→LEASED→AVAILABLE→SOLD, when I read its events, then I get 4 rows in
      chronological order with correct `fromStatus`/`toStatus` chaining

#### R2. Occupancy timeline API — `GET /units/:id/history`

One endpoint that returns the unit's merged, server-computed history, replacing the client-side
`buildUnitHistory()` derivation.

Response shape (per entry): `kind` (`lease` | `sale` | `vacancy` | `status`), `startDate`, `endDate`,
`isOngoing`, `isHistorical`, and a `data` payload for the underlying lease/sale.

**Acceptance criteria**
- [ ] Vacancy windows are computed from `UnitStatusEvent`, not inferred from lease adjacency — so the gap
      **before the first lease** and the **currently-open vacancy** both appear (fixes G9)
- [ ] Each entry carries `durationDays`; the response carries a summary: `totalDaysVacant`, `totalDaysLeased`,
      `totalDaysOwnedBySomeoneElse`, `tenancyCount`, `currentVacancyDays`
- [ ] Entries are ordered newest-first and every entry carries `isHistorical`
- [ ] Backfilled and live entries are structurally identical apart from `isHistorical`
- [ ] Requires `unit:view`

#### R3. Rental economics captured per tenancy

No new models needed — `Lease`, `LeaseRentPeriod`, `LeaseObligation`, `LeaseRentInvoice` already cover this.
Requirement is that the **history view surfaces them per tenancy**, and the backfill form **captures them**.

Per tenancy the UI must show: tenant legal name + brand, term dates, contracted monthly rent, rent/sqft, NNN
split, escalation % and frequency, free-rent months, security deposit (agreed vs. collected vs. returned),
TI allowance, total contracted rent over term, total actually collected, and outstanding at lease end.

**Acceptance criteria**
- [ ] Given a unit with 3 past tenancies, when I open its rent history, then each tenancy shows both the
      contracted schedule and the collection ledger, collapsed by default except the most recent
- [ ] Per-tenancy totals (contracted vs. collected vs. outstanding) are shown as a stat strip
- [ ] A unit-level lifetime roll-up shows total rent collected across all tenancies + sale proceeds
- [ ] Free-rent months render as `FREE` in the ledger, not as unpaid

#### R4. Lease → Sale conversion (sitting tenant buys)

**Client decision: a sale close means the sitting tenant bought the unit.** One action, transactional.

New: `Sale.convertedFromLeaseId` (nullable FK to `Lease`, `onDelete: SetNull`) + `Lease.convertedToSale` back-relation.

New endpoint: `POST /leases/:id/convert-to-sale` — body: buyer (defaults to `tenantLegalName`), salePrice,
closingDate, depositAmt, broker, and how the security deposit is settled.

Behaviour, in one transaction:
1. Create the `Sale` with `convertedFromLeaseId` set, `status: UNDER_CONTRACT` (or `CLOSED` if closingDate is past)
2. On close: set `Lease.status = TERMINATED`, `Lease.leaseEnd = closingDate`
3. Truncate the rent ledger — cancel/void `LeaseRentInvoice` rows with `periodMonth > closingDate`; prorate the
   closing month
4. Flip the unit to `SOLD`, write a `UnitStatusEvent` with `source: SALE_CLOSED`
5. Settle open `LeaseObligation` rows: security deposit either refunded or credited against sale price
6. Emit `unit.sold` — **once**, reusing the existing optimistic-lock guard in `SalesService.update()`

**Acceptance criteria**
- [ ] Given a unit with an ACTIVE lease, when the tenant's sale closes, then the lease becomes `TERMINATED`
      with `leaseEnd = closingDate` and the unit becomes `SOLD`
- [ ] No `LeaseRentInvoice` exists for any month after the closing month
- [ ] The closing month's invoice is prorated (`isProrated: true`, `billedDays` set) if the close is mid-month
- [ ] `generateDueThrough` (the monthly cron) never bills a `TERMINATED` lease — **verify and fix if it does**
- [ ] The terminated lease still appears in full on the unit's history timeline with all its rent history
- [ ] The sale shows "Converted from lease — tenant purchase" with a link back to the lease
- [ ] Given the deposit is credited to the sale price, then the `LeaseObligation` is `SETTLED` with a payment
      row of method `ADJUSTMENT` referencing the sale
- [ ] Concurrent close attempts result in exactly one conversion and one `unit.sold` event
- [ ] Requires `sale:edit` **and** `lease:edit`

#### R5. Manual historical backfill on the Unit Detail page

**Client decision: manual entry, no CSV.** A "Add historical record" action on the Unit Detail page, available
to **Founder** and **Sales**, opening a modal with two modes: *Past lease* and *Past sale*.

Both modes accept fully backdated dates and write records flagged `isHistorical: true`.

**Permissions (client decision 2026-08-12 — option b).** Two permissions, deliberately split, because create
and delete carry very different risk:

| Permission | Grants | Roles |
|---|---|---|
| `unit:history:backfill` | Create and edit historical lease/sale records | `SUPER_ADMIN`, `FOUNDER`, `SALES` |
| `unit:history:delete` | Approve/execute deletion of a historical record | `SUPER_ADMIN`, `FOUNDER` **only** |

These are new permissions rather than a widening of `lease:edit`, because they carry the right to bypass the
guards below. Deletion is governed by the approval flow in **R27**.

Guard bypasses granted **only** to this permission, and only when `isHistorical: true`:
- The one-active-lease-per-unit check is replaced by an **overlap** check (see R6)
- The unit status state machine is bypassed (G7) — but the resulting status is still validated as a legal
  `UnitStatus` value, and a `UnitStatusEvent` is written with `source: BACKFILL`
- `availableSince` is **not** stamped to `now()` (G1)

**Past lease** captures: tenant legal name, brand, contact, term start/end, monthly rent, rent/sqft, NNN split,
escalation % + frequency, free-rent months, security deposit (agreed / collected / returned), TI allowance,
final status (`EXPIRED` | `TERMINATED`), termination reason, notes.

**Past sale** captures: buyer, sale price, deposit, LOI / contract / closing dates, broker + commission, final
status (`CLOSED` | `CANCELLED` + `lostReason`), notes.

**Acceptance criteria**
- [ ] The action appears on Unit Detail only for users with `unit:history:backfill`
- [ ] All dates accept past values; a future date on a historical record is rejected with a clear message
- [ ] `leaseEnd` must be after `leaseStart`; `closingDate` must be ≥ `contractDate` ≥ `loiDate` when present
- [ ] Saving a historical lease writes: the `Lease` (with `isHistorical`), its `LeaseRentPeriod` schedule, its
      settled `LeaseRentInvoice` ledger (R7), its `LeaseObligation` rows, and two `UnitStatusEvent` rows
      (leased at `leaseStart`, vacated at `leaseEnd`) — all in one transaction
- [ ] **No events are emitted and no notifications are sent** for historical records (Non-Goal 6)
- [ ] Historical entries render with a "Historical" chip on the timeline and in the rent history
- [ ] A historical record can be created and edited by `unit:history:backfill` holders (incl. `SALES`)
- [ ] `SALES` cannot delete a historical record directly — deletion goes through R27's approval flow
- [ ] Soft-deleting a historical lease also removes its generated periods/invoices from all reporting
- [ ] Every backfill write produces an `AuditEvent` naming the user and the record
- [ ] Given a unit that was leased 2024-01→2025-06 then sold 2025-08, when both records are entered, then the
      timeline reads: Sold (2025-08) → Vacant 2025-06→2025-08 → Leased 2024-01→2025-06

#### R6. Overlap validation replaces the active-lease guard

The current guard (`status NOT IN (EXPIRED, TERMINATED)`) is a proxy for "no double-booking" that fails as
soon as history exists. Replace with a real date-range overlap check.

**Acceptance criteria**
- [ ] Two leases on the same unit whose `[leaseStart, leaseEnd]` ranges overlap are rejected, regardless of status
- [ ] The error names the conflicting tenant and its date range
- [ ] Back-to-back leases (`A.leaseEnd` == `B.leaseStart`) are **allowed** — same-day turnover is real
- [ ] The existing partial unique index `lease_unit_active_unique` is replaced by an exclusion constraint or an
      equivalent service-level check; the fast-path friendly error is preserved
- [ ] Existing live behaviour is unchanged: you still cannot create a second lease on a currently-leased unit

#### R7. Historical rent ledger, generated settled

**Client decision: yes, generate the full month-by-month ledger, marked settled.**

`generateForLease` already backfills from `leaseStart` to today and is idempotent. It needs a historical mode.

**Acceptance criteria**
- [ ] Given a historical lease, generation emits one `LeaseRentInvoice` per month from `leaseStart` to
      `leaseEnd` (**not** to today)
- [ ] Generated historical invoices default to `status: PAID` with `amountPaid = amountDue` and
      `paidAt = dueDate`, so nothing appears as overdue AR
- [ ] Free-rent months are emitted as `status: FREE`, amount 0
- [ ] The form lets the user mark specific months as `WAIVED` or partially paid before committing, and shows a
      running "total collected" as they do
- [ ] The overdue-invoice finder (`findOverdue`) and any collection notifications never surface a historical row
- [ ] Backfilled invoices are excluded from QuickBooks sync (Non-Goal 3)
- [ ] Prorated first/last months are computed the same way as live leases (`isProrated`, `billedDays`, `monthDays`)

#### R8. Vacancy & time-on-market reporting reads the event log

**Acceptance criteria**
- [ ] The Vacancy Report computes days-vacant from the open `UnitStatusEvent` vacancy window, not from
      `availableSince ?? createdAt` ([reports.service.ts:477](../../apps/api/src/modules/reports/reports.service.ts#L477))
- [ ] The stale-unit exception feed and cron read the same source
- [ ] A new column/metric: **lifetime days vacant** and **number of tenancies** per unit
- [ ] Units whose only history is backfilled report correctly — no `createdAt` fallback contaminating the number
- [ ] Existing report shapes are backwards-compatible; `availableSince` keeps being maintained

---

### P1 — Should have

- **R9. Unit lifetime economics roll-up** — a stat strip on Unit Detail: total rent collected across all
  tenancies, total months leased vs. vacant, average rent/sqft achieved over time, sale proceeds, and
  "total return" for the unit. High client value, but the unit is legible without it.
- **R10. Rent-achieved-over-time chart** — contracted rent/sqft per tenancy plotted across the unit's life, so
  Prime can see whether achieved rents are trending up. Depends on R3 data being present.
- **R11. Backfill progress view** — an admin page listing units with no history entered, so the team can work
  through the backlog systematically rather than unit-by-unit from memory.
- **R12. Duplicate-tenant detection** — warn when a historical tenant's legal name closely matches an existing
  `Client` or another lease's tenant, to keep the tenant list clean across two years of manual entry.
- **R13. Copy-forward from previous tenancy** — pre-fill the historical lease form from the unit's prior lease
  (sqft, NNN structure, escalation pattern), cutting typing on the most repetitive part of the backfill.

### P2 — Future considerations (design for, do not build)

- **R14. Building-level lease/sale history.** The models are already polymorphic; keep the history service
  keyed on an asset reference rather than hard-coding `unitId`, so building history is an additive change.
- **R15. CSV bulk import.** Design R5's write path as a service method with a validated DTO — the API surface
  the modal calls should be the same one a future importer would call, so importing later is a UI, not a rewrite.
- **R16. Third-party sale of a tenanted unit (investor sale).** Explicitly out of v1, but do **not** hard-code
  "close ⇒ terminate lease" inside `SalesService.update()`. Put it behind a conversion mode so an
  `INVESTOR_SALE` mode can be added without unpicking the close path.
- **R17. Unit history in the buyer/client portal.** `Document.isClientVisible` already exists; history entries
  will eventually need the same flag. Do not expose history to `CLIENT` role in v1.
- **R18. Snapshot-based occupancy trending.** `RentRollSnapshot` exists; a per-unit occupancy snapshot series
  would let Prime chart portfolio occupancy over time once two years of history are loaded.

---

## Success Metrics

### Leading indicators (first 30 days after launch)

| Metric | Target | Stretch | How measured |
|---|---|---|---|
| Units with ≥1 historical record entered | 60% of Prime-owned units | 85% | `count(distinct unitId) where isHistorical` / total active units |
| Backfill entries per week, weeks 1–4 | ≥ 40/week | 80/week | `AuditEvent` count for backfill actions |
| Historical entry error rate (rejected saves) | < 10% of attempts | < 5% | 4xx rate on the backfill endpoints |
| Median time to enter one historical lease | < 4 min | < 2.5 min | Modal-open → successful-save, instrumented |
| Lease→sale conversions using the new action | 100% of tenant purchases | — | `Sale.convertedFromLeaseId is not null` / tenant-purchase sales |
| Units in an impossible state (`SOLD` + `ACTIVE` lease) | **0** | 0 | Scheduled data-integrity query |

### Lagging indicators (60–90 days)

| Metric | Target | How measured |
|---|---|---|
| Vacancy Report accuracy | Founder sign-off that reported days-vacant matches reality on a 10-unit spot check | Manual audit |
| Rent invoices generated against a terminated lease | 0 | Ledger query, monthly |
| Historical revenue visible in reports | ≥ 18 months of rent history queryable per backfilled unit | Revenue report date range |
| Support/ad-hoc requests for "what did this unit earn" | Reduced to ~0 | Client feedback at monthly review |
| Re-let pricing decisions citing the history timeline | Qualitative — Founder confirms it is used | Monthly review |

**Evaluation points:** 2 weeks (adoption + error rate), 6 weeks (backfill coverage), 12 weeks (data quality
and reporting accuracy).

---

## Open Questions

### Blocking — needed before implementation starts

| # | Question | Owner |
|---|---|---|
| **Q1** | Confirmed: a sale close always means the *sitting tenant* bought. If Prime has **ever** sold a tenanted unit to an outside investor (tenant stays, ownership changes), R4 as specced would wrongly terminate that lease. Has this happened, or is it plausible in the next 12 months? | Client / Founder |
| ~~Q2~~ | ~~Should `SALES` hold `unit:history:backfill`?~~ **ANSWERED 2026-08-12 — option (b).** Sales may create and edit historical records; **deleting one requires Founder approval.** Specced in R5 + R27. | ✅ Client |
| **Q3** | For the ~24 months of historical rent per unit: does the team actually know the **per-month collection** history, or only the contracted rent? If only the contract is known, R7's "mark specific months waived/partial" UI is wasted effort and every month should just default to PAID. | Client / Finance |
| **Q4** | Volume check: roughly how many units × how many past tenancies need entering? If it is >150 records, manual entry is ~10+ hours of team time and CSV import (R15) may be cheaper than the labour. | Client |

### Non-blocking — resolve during implementation

| # | Question | Owner |
|---|---|---|
| Q5 | Should historical rent roll into the **Revenue Report** and KPI snapshots by default, or sit behind an "include historical" toggle? Default assumption: **included**, since that is the point of entering it. | Client / Finance |
| Q6 | Where does an unknown vacancy start date come from when a historical lease is entered but the prior state is unknown? Assumption: the vacancy window opens at the previous lease's `leaseEnd`, or at unit `createdAt` if none. | Engineering |
| Q7 | Does the monthly `generateDueThrough` cron currently bill `TERMINATED` leases? Needs verification — if yes, that is a live bug independent of this spec. | Engineering |
| Q8 | Should the security deposit on a tenant-purchase default to *credited against sale price* or *refunded*? Assumption: ask in the conversion modal, no default. | Client / Finance |
| Q9 | Retention: should soft-deleted historical records be purgeable, or retained indefinitely for audit? | Legal / Client |
| Q10 | Do historical leases need their scanned lease PDF attached at entry time, or is that a later pass? | Client |

---

## Timeline & Phasing

No hard external deadline. Phasing is ordered so each phase is independently shippable and the team can start
entering data before the whole thing is done.

### ✅ Phase H0 — Foundation — **DELIVERED 2026-08-12**
`UnitStatusEvent` model + migration + bootstrap (R1); events written from every status-flip site; overlap
validation replacing the active-lease guard (R6). See **Delivery log** below.
**Shipped:** nothing user-visible. **Unblocks:** H1, H2, H3.

### ✅ Phase H1 — History surface — **DELIVERED 2026-08-12**
`GET /units/:id/history` (R2), Unit Detail timeline rewired to consume it, per-tenancy economics (R3),
vacancy/time-on-market moved onto the event log (R8). See **Delivery log**.
**Shipped:** an accurate, complete timeline plus trustworthy vacancy numbers.

### Phase H2 — Backfill (est. 6–7 days)
`unit:history:backfill` + `unit:history:delete` permissions. Historical lease + historical sale modals on Unit
Detail (R5). Historical ledger generation, settled (R7). Founder deletion-approval flow (R27). Historical
chips throughout. Audit coverage.
**Ships:** the team can start entering two years of data. **Depends on:** H0, H1. **Blocked by:** Q3.
*(+1 day vs rev. 1 for R27.)*

### Phase H3 — Lease→Sale conversion (est. 3–4 days)
`Sale.convertedFromLeaseId`, `POST /leases/:id/convert-to-sale`, ledger truncation + proration, deposit
settlement, conversion UI (R4). Fix `generateDueThrough` if Q7 confirms the bug.
**Ships:** clean tenant-purchase flow, live and historical. **Depends on:** H0. **Blocked by:** Q1, Q8.

### Phase H4 — P1 polish (est. 3–4 days, optional)
Lifetime economics roll-up (R9), rent-achieved chart (R10), backfill progress view (R11), duplicate-tenant
detection (R12), copy-forward (R13).

**Total P0: ~14–18 engineering days.** H3 can run in parallel with H2 after H0 lands.

### Dependencies & risks
- **AWS account migration is in flight** ([AWS_ACCOUNT_SHIFT.md](../AWS_ACCOUNT_SHIFT.md)) — H0 adds a
  migration and a data migration. Coordinate so the schema change lands on the same side of the cutover as
  the `pg_dump`/restore, or it will be applied twice or lost.
- **Backfill is data entry, not code.** The build is ~3 weeks; the team's entry effort is the longer pole. Q4
  determines whether that is a day or a fortnight.
- **`generateForLease` behaviour change** (R7 historical mode) touches the live invoice generator. It is
  idempotent and unique-keyed, but a regression here silently affects live billing — needs test coverage on
  both modes before merge.

---

## Part 2 — Rental History Corrections (client feedback, 2026-08-12)

Eight items came back from the client on the rental-history screens. Each was checked against the code before
being specced. **Two are already built**, three are UI wiring of APIs that already exist, two need schema, and
one reverses a locked decision.

### Triage

| # | Client said | Verdict | Where |
|---|---|---|---|
| 1 | "Placeholder for lease start date and rent start date" | **Gap — schema.** `Lease` has `leaseStart` only; no rent commencement date | R19 |
| 2 | "The tenure term should end for rent end date" | **Gap — schema + derivation.** `termMonths` is hand-typed and unlinked to the dates | R19 |
| 3 | "Placeholder for NNN price per sft" | **Gap — schema.** NNN is a flat monthly amount on the period; no per-sqft, and no NNN on the lease header at all | R20 |
| 4 | "The rental history is not getting editable — can we have a call" | **Working as designed — client is reversing a locked decision** | R22 + call |
| 5 | "Not able to edit TI allowance" | **UI wiring only.** Full edit UI exists, just isn't rendered on the unit page | R21 |
| 5b | "…and commission" | **Gap — schema.** `Lease` has no broker or commission fields whatsoever | R23 |
| 6 | "3 months free → other 33 months calculate rental in 36 months" | **Already built — but the client may mean something else entirely** | R24 + call |
| 7 | "NNN per sq feet should be editable" | Combination of 3 + 4 | R20 + R22 |
| 8 | "Even rent cost changes should save into history of unit" | **Half built.** Stored correctly, never shown on the unit timeline | R25 |

---

### R19 (P0) — Separate rent commencement date, and derive the term from it

**Finding.** `Lease` has `leaseStart`, `leaseEnd`, and a hand-entered `termMonths`. There is no rent
commencement date. The rent schedule generator uses `leaseStart` as its origin
([lease-rent-period.service.ts](../../apps/api/src/modules/leases/lease-rent-period.service.ts)), so a lease
signed in January with rent starting in April after fit-out bills three months that were never owed.

Nothing today validates that `termMonths` agrees with `leaseEnd − leaseStart`; the two can silently disagree,
and `summariseEffectiveRent` prefers the typed `termMonths` over what the periods actually cover
([lease-rent-period.service.ts:348](../../apps/api/src/modules/leases/lease-rent-period.service.ts#L348)) —
so a wrong term quietly distorts the effective-rent KPI.

**Schema**
```prisma
model Lease {
  leaseStart      DateTime   // legal commencement — unchanged
  rentStartDate   DateTime?  // NEW: rent commencement. Null ⇒ falls back to leaseStart
  leaseEnd        DateTime   // NEW meaning: the rent end date (term expiry)
  termMonths      Int        // NEW: derived from rentStartDate → leaseEnd, no longer hand-typed
}
```

**Acceptance criteria**
- [ ] The lease form shows **Lease start date** and **Rent start date** as separate labelled fields, with
      helper text explaining the difference (legal commencement vs. when rent begins)
- [ ] Rent start defaults to lease start; the user can push it later but never earlier
- [ ] `termMonths` becomes read-only in the form and is **derived** as whole months from `rentStartDate`
      (falling back to `leaseStart`) to `leaseEnd`, recomputed live as the user edits either date
- [ ] The rent schedule generator uses `rentStartDate ?? leaseStart` as its origin — **not** `leaseStart`
- [ ] The rent invoice ledger likewise starts at rent commencement; no invoice exists for the fit-out gap
- [ ] The gap between lease start and rent start renders on the unit timeline as a distinct
      **"Fit-out / rent-free before commencement"** band, not as vacancy and not as free rent
- [ ] Existing leases migrate with `rentStartDate = null`, preserving today's behaviour exactly — no rent
      schedule for any existing lease changes as a result of this migration
- [ ] `summariseEffectiveRent` uses the derived term; a lease whose periods disagree with its term logs a warning

**Migration risk:** every existing lease's schedule must be byte-identical after this lands. Add a test that
regenerates schedules for a sample of live leases pre- and post-change and asserts equality.

---

### R20 (P0) — NNN as a price per sqft

**Finding.** NNN exists only as `LeaseRentPeriod.nnnAmount`, a flat monthly Decimal. The service comments
confirm the lease header has no NNN column at all ("Lease has no NNN column today",
[lease-rent-period.service.ts:371](../../apps/api/src/modules/leases/lease-rent-period.service.ts#L371)) — so
NNN is inferred by subtracting from `monthlyRent` at generation time. Base rent has a `rentPerSqft` companion;
NNN has no equivalent, even though NNN is quoted per sqft in every commercial lease Prime writes.

**Schema**
```prisma
model Lease {
  nnnPerSqft   Decimal? @db.Decimal(8, 2)   // NEW: quoted rate, the input the team actually has
  nnnMonthly   Decimal? @db.Decimal(12, 2)  // NEW: derived = nnnPerSqft × unit sqft; overridable
}
```

`LeaseRentPeriod.nnnAmount` stays the per-period source of truth (it already carries forward unescalated,
which is correct). The new lease-level fields are the **input**; periods are the **result**.

**Acceptance criteria**
- [ ] The lease form has an **NNN $/sqft** field beside the existing base rent $/sqft field
- [ ] Entering NNN $/sqft auto-computes monthly NNN from the unit's `sqft`, shown live beside the input
- [ ] The computed monthly figure is overridable — some leases are quoted as a flat monthly NNN. An override
      is visibly marked so nobody thinks the per-sqft rate still drives it
- [ ] Where a unit has `floorArea` + `mezzanineArea` split, the form states which area the rate applies to
      (default: total `sqft`) — see Open Question Q13
- [ ] The rent schedule's NNN column is unchanged in behaviour: carried forward across escalations, never escalated
- [ ] The invariant `monthlyRent === baseRent + nnnAmount` continues to hold on every write path
- [ ] NNN $/sqft appears in the unit's per-tenancy economics strip (R3) so it is comparable across tenancies
- [ ] Existing leases migrate with both new fields null; `nnnAmount` on existing periods is untouched

---

### R21 (P0) — TI allowance and deposit editable from the unit page

**Finding — cheapest item on the list.** The full edit UI already exists and works:
[LeaseObligationsPanel.tsx](../../apps/web/src/components/LeaseObligationsPanel.tsx) supports create, edit,
delete, waive and record-payment against `SECURITY_DEPOSIT`, `TI_ALLOWANCE` and `OTHER`, backed by live
endpoints (`PUT /leases/obligations/:id` et al, all `lease:edit`) and live hooks (`useUpdateLeaseObligation`,
`useCreateLeaseObligation`, `useWaiveLeaseObligation`, `useRecordObligationPayment`).

It is simply **not rendered on the Unit Detail page**. That page imports the read-only
[ObligationSummaryCard](../../apps/web/src/components/ObligationSummaryCard.tsx) instead
([UnitDetailPage.tsx:1002](../../apps/web/src/pages/UnitDetailPage.tsx#L1002)), which has no write path at all.
`LeaseObligationsPanel` is currently reachable only from the project page
([ProjectDetailPage.tsx:3935](../../apps/web/src/pages/ProjectDetailPage.tsx#L3935)) — so the team on the unit
page correctly reports "not able to edit TI allowance."

**No backend work. No schema. This is a wiring change of roughly half a day.**

**Acceptance criteria**
- [ ] Each tenancy in the unit's rent history renders `LeaseObligationsPanel` for that lease, with
      `canEdit={hasPermission('lease:edit')}`
- [ ] The unit-level `ObligationSummaryCard` roll-up is retained above it — the summary answers "what is
      outstanding on this unit", the panel answers "change this lease's TI"
- [ ] Deposit and TI allowance can be created, edited, waived and paid down from the unit page
- [ ] Editing a TI allowance from the unit page invalidates both the unit and building obligation roll-ups
      (`invalidateObligations` already handles this — pass both `unitId` and `buildingId`)
- [ ] A user without `lease:edit` sees the panel read-only, not hidden

---

### R22 (P0, pending call) — Editable rent history

> **This reverses a decision the client locked on 2026-07-29.** It is the main call agenda item.

**Finding.** Past rent periods are immutable *by design*, and the code says so explicitly:

> "Past periods are IMMUTABLE. Even with canEdit there is no 'edit row': the only writes are appending a
> manual period and re-cutting the future." — [LeaseRentSchedule.tsx:14](../../apps/web/src/components/LeaseRentSchedule.tsx#L14),
> annotated *client-confirmed 2026-07-29*

The backend enforces the same shape: `LeaseRentPeriod` has no update endpoint. The only writes are
`generate`, `regenerate-future` and `append manual period`
([leases.controller.ts:188-211](../../apps/api/src/modules/leases/leases.controller.ts#L188)). Server-side,
`update()` on a lease deliberately re-derives only *future* periods and freezes past ones, "because the tenant
was already invoiced against them."

**Why it was built this way, and why that reasoning still holds:** a past period usually has
`LeaseRentInvoice` rows generated against it, some of them paid. Editing the period retroactively would mean
the invoice says one thing and the schedule says another — an unreconcilable ledger. That is a real
correctness constraint, not a UI shortcut.

**But the client's complaint is also legitimate:** a typo entered on day one is currently uncorrectable, and
backfilled history (Part 1) is *entirely* "past periods" — R5 would produce records the team cannot then fix.
That makes the current rule untenable once backfill ships.

**Recommended resolution — correction with provenance, not silent mutation:**

1. Add `PUT /leases/rent-periods/:id` gated on a **new `lease:history:correct` permission** (Founder /
   Super Admin, matching the R5 backfill authority).
2. An edit to a past period is a **correction**, and is recorded as one: `correctedAt`, `correctedById`,
   `correctionReason` (required), and the prior values retained in a `LeaseRentPeriodCorrection` audit row.
3. If the period has invoices, the API states plainly what will happen and requires an explicit choice:
   **(a)** re-derive unpaid invoices for those months, leaving paid ones alone; **(b)** re-derive all and flag
   the difference as an adjustment; **(c)** leave the ledger untouched and correct the schedule only.
4. Corrected periods carry a visible "Corrected" chip with hover showing who, when, why, and the old value.
5. Historical/backfilled periods (`isHistorical`) are freely editable by `unit:history:backfill` holders with
   no ceremony until the record is marked final — nothing was ever really invoiced against them.

**Acceptance criteria**
- [ ] A Founder can correct any past rent period; the reason is mandatory and blocked client-side
- [ ] The correction is fully reversible from the audit row — the prior value is never destroyed
- [ ] A period with **paid** invoices cannot be silently re-derived; the user must pick an explicit option
- [ ] `Sales` and other `lease:edit` holders keep today's behaviour: append-manual and re-cut-future only
- [ ] Corrected periods are visibly marked in the schedule table
- [ ] Every correction writes an `AuditEvent`
- [ ] The `monthlyRent === baseRent + nnnAmount` invariant is enforced on the correction path too

**If the client instead wants unrestricted editing of past periods with no ceremony**, that is buildable — but
it removes the guarantee that the ledger reconciles to the schedule, and Finance should be in the room when
that is decided. Hence the call.

---

### R23 (P1) — Leasing commission

**Finding.** `Broker`, `brokerId`, `brokerCommissionPct`, `brokerCommissionAmt` and `brokerCommissionPaidAt`
exist on **`Sale`** and a broker link exists on **`Lead`** — but **`Lease` has none of them**
([schema.prisma:815](../../apps/api/prisma/schema.prisma#L815)). There is nowhere to record who brought a
tenant or what they were paid. "Not able to edit commission" is accurate: the field does not exist.

**Schema** — mirror the `Sale` shape rather than inventing a second pattern:
```prisma
model Lease {
  brokerId               String?
  broker                 Broker?   @relation(fields: [brokerId], references: [id], onDelete: SetNull)
  brokerCommissionPct    Decimal?  @db.Decimal(5, 2)   // override of Broker.commissionRate
  brokerCommissionAmt    Decimal?  @db.Decimal(14, 2)  // computed + stored on activation
  brokerCommissionBasis  String?   // FIRST_MONTH_RENT | TOTAL_TERM_RENT | FLAT — see Q12
  brokerCommissionPaidAt DateTime?
}
```

**Acceptance criteria**
- [ ] Broker, commission % (or flat) and basis are editable on the lease form and from the unit's rent history
- [ ] Commission amount is computed from the chosen basis and the lease's contracted rent, and is overridable
- [ ] Commission is stamped when the lease activates, mirroring the sale-side "stamped on close" rule
- [ ] `brokerCommissionPaidAt` is settable when the broker is actually paid
- [ ] Leasing commissions appear in the broker report alongside sale commissions, labelled by type
- [ ] Historical/backfilled leases (R5) can carry a commission

---

### R24 (P0 — clarify, then likely no build) — Free rent across the term

**Finding: already built, on the most natural reading.** For a 36-month term with 3 free months, the current
generator produces exactly what was asked:

- Free rent sits **inside** the term. `leaseEnd` is unchanged and the escalation clock still runs from the
  start, so derived dates never contradict the signed contract (documented on `Lease.freeRentMonths`).
- The schedule emits **33 paying months** at the contracted rent, plus **one** free-rent row spanning the
  abated window at rent 0 (`isFreeRent: true`, `source: FREE_RENT`) — one row for the window, not three rows.
- `summariseEffectiveRent` then straight-lines the total: `effectiveMonthlyRent = totalContractedRent / 36`,
  divided by the **full 36-month term**, not by the 33 paying months
  ([lease-rent-period.service.ts:348](../../apps/api/src/modules/leases/lease-rent-period.service.ts#L348)).

So both readings of "33 months should calculate rental in 36 months" are satisfied today.

**The ambiguity that needs the client — and it is a money question, not a display question.** There is a
third reading: *the landlord should still collect the full 36-month contract value, recovered across the 33
paying months* — i.e. gross the monthly rent up by 36/33 (+9.1%). That is a **different commercial deal**:

| Reading | 36 mo @ $10,000, 3 free | Landlord collects |
|---|---|---|
| **A — current build.** Tenant gets 3 months free; landlord forgoes them | 33 × $10,000 | **$330,000** |
| **B — gross-up.** Full term value recovered over paying months | 33 × $10,909 | **$360,000** |

**$30,000 difference on one lease.** Nothing should be built until this is settled — and if the answer is A,
this item needs **no code at all**, only a clearer display.

**Acceptance criteria (assuming A — current behaviour is correct)**
- [ ] The rent schedule shows a summary line: "36-month term · 3 months free · 33 paying months · effective
      rent $X/mo straight-lined over the full term"
- [ ] The free-rent row states which months are abated and the total value forgone
- [ ] The per-tenancy economics strip shows contracted total, effective monthly, and abatement value separately

**If the answer is B**, add a `freeRentTreatment: ABATED | GROSSED_UP` field to `Lease` and a gross-up branch
in the generator — roughly 2 extra days, and every existing lease must be confirmed as `ABATED` so nothing
silently re-prices.

---

### R25 (P0) — Rent changes appear in the unit's history

**Finding — half built.** Storage is correct: a rent change writes a `LeaseRentPeriod` with `source: MANUAL`
and a mandatory `reason`, and `LeasesService.update()` emits a `lease.rentChanged` event carrying from, to and
effective date. Escalations likewise land as `AUTO_ESCALATION` periods.

But the unit history timeline never shows any of it. `buildUnitHistory()` builds entries only of kind
`lease`, `sale` and `vacant` ([UnitDetailPage.tsx:124](../../apps/web/src/pages/UnitDetailPage.tsx#L124)). A
rent change is visible only if you expand that specific lease's schedule table. The client's "even rent cost
changes should save into history of unit" is really *"…should show in the unit's history."*

**Acceptance criteria**
- [ ] `GET /units/:id/history` (R2) returns a `rent_change` entry kind, sourced from `LeaseRentPeriod`
- [ ] Each entry shows: effective date, old → new monthly rent, base/NNN split, whether it was a scheduled
      escalation or a manual change, the reason, and who made it
- [ ] Scheduled escalations are visually distinct from manual changes — one is expected, one is a decision
- [ ] Free-rent windows and (per R19) the fit-out gap before rent commencement appear as their own entry kinds
- [ ] Corrections (R22) appear as a `rent_correction` entry, never by silently mutating the original entry
- [ ] Rent-change entries are filterable out, so the timeline can still be read as "just tenancies and sales"
- [ ] A unit with 3 tenancies and 6 escalations renders one coherent chronological story

---

### R26 (P1) — Field-label and placeholder pass on the lease form

Several items on the client's list are really "I could not tell what this field wanted." Worth doing as one
deliberate pass rather than field-by-field.

**Acceptance criteria**
- [ ] Every money field states its unit in the label or placeholder: `$/sqft/month` vs `$/month` vs `$ total`
- [ ] Lease start vs rent start each carry one line of helper text distinguishing them (R19)
- [ ] NNN $/sqft shows the computed monthly figure live as you type (R20)
- [ ] Term months is visibly derived, not an empty box inviting a contradictory number
- [ ] Free-rent months states that free months sit **inside** the term and do not extend `leaseEnd`
- [ ] Date placeholders show the expected format
- [ ] Escalation % and frequency state that escalation compounds and applies to base rent only, never NNN

---

### R27 (P0) — Founder approval to delete a historical record ✅ SHIPPED 2026-08-13

**Client decision 2026-08-12 (Q2, option b).** Sales can enter and fix history; only a Founder can erase it.
The asymmetry is deliberate: a wrong record is visible and correctable, a deleted one is neither.

Rather than a full approval-queue subsystem, this is a **request → approve** pair on the record itself,
following the existing `Sale.discountApprovedBy` precedent (single approver, no dual-approval) so it matches a
pattern the codebase and the client already use.

```prisma
model HistoricalRecordDeletion {
  id             String    @id @default(cuid())
  // Polymorphic — exactly one set, service-enforced (matches Lease/Sale/Loan convention)
  leaseId        String?
  saleId         String?
  unitId         String    // denormalised so the unit page can show pending requests cheaply
  reason         String    // required from the requester
  status         String    @default("PENDING") // PENDING | APPROVED | REJECTED | CANCELLED
  requestedById  String
  requestedBy    User      @relation("DeletionRequester", fields: [requestedById], references: [id])
  requestedAt    DateTime  @default(now())
  decidedById    String?
  decidedBy      User?     @relation("DeletionApprover", fields: [decidedById], references: [id])
  decidedAt      DateTime?
  decisionNote   String?

  @@index([unitId, status])
  @@index([status, requestedAt])
  @@map("historical_record_deletions")
}
```

**Flow**
1. A `unit:history:backfill` holder without `unit:history:delete` hits Delete → a reason is required → a
   `PENDING` request is created. The record is **not** touched.
2. The record shows a "Deletion requested" chip on the unit timeline, with requester and reason.
3. Founders are notified (new `NotificationType.HISTORY_DELETION_REQUESTED`).
4. A `unit:history:delete` holder approves — the record is soft-deleted in the same transaction as the
   approval — or rejects with a note.
5. A Founder deleting a record directly skips the request entirely; the audit trail records it as
   self-approved.

**Acceptance criteria**
- [x] `SALES` clicking Delete on a historical record creates a `PENDING` request, not a deletion
- [x] A reason is mandatory on the request, blocked client-side and validated server-side
- [x] The record remains fully visible and intact while a request is pending
- [x] Only one `PENDING` request can exist per record; a second attempt surfaces the existing one
- [x] The requester can cancel their own pending request
- [x] A Founder sees pending requests on the unit page and can approve or reject with a note
- [x] Approval soft-deletes the record **and** its generated periods, invoices and obligations — see
      deviation 2 below: one write achieves this, because every child query filters on
      `lease: { deletedAt: null }`
- [x] Rejection leaves the record untouched and notifies the requester
- [x] Founders and Super Admins delete directly, with no request step, recorded as self-approved
- [x] Every state change (request, approve, reject, cancel) writes an `AuditEvent`
- [x] Given a rejected request, when Sales tries again, then a new request can be raised — rejection is not a permanent block
- [ ] **NOT BUILT** — deleting a historical lease whose unit has a later historical sale referencing it warns
      before proceeding. There is no historical *sale* backfill yet, so nothing can reference one. Revisit
      when sale backfill ships.

**As built** (2026-08-13) — deviations from the design above, each deliberate:

1. **Approval does not delete.** The spec had approval soft-delete the record in the same transaction.
   Shipped as two acts: approve authorises, a separate click deletes. One button that both approves and
   destroys makes the approval a formality rather than a decision, and it leaves no window to change your
   mind. The approval is consumed (`COMPLETED`) by the delete, so it cannot authorise a second one.
2. **No cascade writes.** Periods, invoices and obligations are untouched by the delete. Every query for them
   already filters on `lease: { deletedAt: null }`, so soft-deleting the lease removes the whole ledger from
   view in a single write. Writing `deletedAt` onto children they do not have would have meant three new
   columns to keep in sync for no additional effect.
3. **Lease-only, not polymorphic.** The model carries `leaseId` alone — no `saleId`/`unitId`. Backfill only
   creates tenancies today, so a polymorphic key would have been three nullable columns with one ever set.
4. **The approver deleting directly is recorded as a request they raised and decided**, rather than as a
   deletion with no approval row. The trail then reads the same shape for every deletion instead of having a
   hole where an approval should be.
5. **Nobody decides their own request.** A `unit:history:delete` holder who wants their own record gone
   deletes it directly (4); the request→decide path always puts two people in it. Without this, a Sales user
   who later gained the permission could approve their own backlog.
6. **Two notification types, not one.** `HISTORY_DELETION_REQUESTED` (leadership, by role — a Founder not
   staffed on the project is still the right person to decide) and `HISTORY_DELETION_DECIDED` (the requester,
   by name). A request nobody hears about is a request nobody decides.

**Where it lives** — `LeasesService.{delete,requestHistoricalDeletion,decideHistoricalDeletion,cancelHistoricalDeletion}`,
routes on `LeasesController`, `HistoricalRecordControls.tsx` on the unit page, migrations
`20260813200000_historical_deletion_approval` + `20260813210000_history_deletion_notifications`.
21 unit tests in `leases.service.spec.ts`.

**Open question (non-blocking, Q18):** should approval be required to *edit* a historical record's money
fields too, or only to delete? Assumption: **delete only**, per the client's wording. Edits are visible and
reversible via the audit trail; deletions are not.

---

## Call agenda (client requested)

The client asked for a call on the rental-history editability. Four items genuinely need a conversation —
the rest can be settled by email.

1. **Editable rent history (R22) — 15 min.** Past periods were made immutable on client instruction
   2026-07-29 because invoices are generated against them. Present the correction-with-provenance option and
   confirm which of the three ledger-handling behaviours they want. *Finance should be on this call.*
2. **Free rent: abated or grossed up (R24) — 10 min.** The $330k vs $360k question above. Bring the worked
   example. Nothing gets built until this is answered.
3. ~~**Backfill permission for Sales**~~ — ✅ answered 2026-08-12: Sales creates and edits, Founder approves
   deletion (R27). No longer a call item.
4. **Backfill volume (Part 1, Q4) — 5 min.** Number of units × past tenancies. Determines whether manual
   entry stays the right call.

Items that do **not** need the call: TI allowance (R21 — being fixed, it was a wiring bug), lease/rent start
dates (R19), NNN per sqft (R20), leasing commission (R23), rent changes in history (R25). Confirm these by
email so the call stays on the two decisions that actually cost money.

---

## Part 2 — Open Questions

### Blocking

| # | Question | Owner |
|---|---|---|
| **Q11** | **Free rent: abated or grossed up?** (R24) Does a 36-month lease with 3 free months collect 33 × contracted rent, or 33 × (contracted × 36/33)? Current build is the former. | Client / Finance |
| **Q12** | What is the leasing commission basis (R23) — first month's rent, a % of total term rent, or a flat fee? Does it differ by broker? **No longer blocks code** (2026-08-12): all three are supported and chosen per lease. Still needed so the team knows which to pick, and to decide whether a per-broker default is worth adding. | Client / Finance |
| **Q13** | For NNN $/sqft on a unit with a floor/mezzanine split (R20), does the rate apply to total `sqft`, or is mezzanine charged at a different NNN rate? | Client |

### Non-blocking

| # | Question | Owner |
|---|---|---|
| Q14 | Should the fit-out gap between lease start and rent start (R19) count as **vacancy** in occupancy reporting? Assumption: **no** — the unit is committed, not available. | Client / Founder |
| Q15 | When a past rent period is corrected (R22) and its invoices are re-derived, does the difference need to reach QuickBooks, or is it property-record only? | Finance |
| Q16 | Is leasing commission ever split between two brokers? The `Sale` model assumes one; mirroring it inherits that assumption. | Client |
| Q17 | Should `rentStartDate` be backfillable for existing live leases, or only set going forward? Assumption: editable by `lease:edit` on any lease. | Engineering |

---

## Part 2 — Phasing

Slots alongside Part 1. **R21 should ship immediately and independently** — it is a wiring bug on a screen the
team uses daily, and it is not worth queueing behind a spec.

| Phase | Contents | Est. | Depends on |
|---|---|---|---|
| **H-now** | R21 TI allowance / deposit editable from the unit page — wiring only | **0.5 day** | nothing — ship this week |
| ~~**H1b**~~ | ✅ **DELIVERED 2026-08-12** — R19 · R20 · R26 | — | — |
| **H1c** | R25 rent changes in unit history | 1–2 days | H1 (`GET /units/:id/history`) |
| **H2b** | R22 rent-history correction + `lease:history:correct` + audit trail | 3 days | **Q11 not needed; call outcome required** |
| ~~**H3b**~~ | ✅ **DELIVERED 2026-08-12** — R23. Built basis-per-lease, so Q12 became data entry rather than a blocker | — | — |
| **—** | R24 free rent | **0 days if reading A** (display only, folds into R26); +2 days if reading B | **Q11** |

**Part 2 P0 total: ~8–10 days**, of which half a day is shippable now. Combined with Part 1 P0 (~14–18 days),
the full programme is **~22–28 engineering days**.

**Sequencing note.** R22 (editable history) and Part 1's R5 (backfill) are entangled: backfilled records are
*all* past periods, so shipping backfill without a correction path hands the team records they cannot fix.
Either R22 lands with or before H2, or backfilled records must be freely editable until finalised — the latter
is what R22's acceptance criteria assume. Settle this on the call.

---

## Delivery log

### 2026-08-12 — R21 (TI allowance editable from the unit page)

`LeaseObligationsPanel` now renders per tenancy inside the unit's rent history
([UnitDetailPage.tsx](../../apps/web/src/pages/UnitDetailPage.tsx)), with `buildingId` threaded through so
obligation writes invalidate the building rollup precisely rather than sweeping the whole
`['obligation-summary']` prefix. No backend or schema change — the endpoints and hooks already existed.

### 2026-08-12 — H0 foundation (R1 + R6)

**Migration** `20260812000000_unit_status_events` — hand-written, since the bootstrap and the constraint swap
are things Prisma cannot express.

**What landed**

| Piece | Detail |
|---|---|
| `unit_status_events` table | Append-only; `effectiveAt` (real-world) vs `recordedAt` (write time); `isHistorical`; provenance via `leaseId`/`saleId`; `source` as text, not an enum, so H2 can add `BACKFILL` without a migration |
| Bootstrap | 499 rows for 499 units, `fromStatus` NULL (we genuinely don't know what came before), `effectiveAt = COALESCE(availableSince, createdAt)`, guarded by `NOT EXISTS` so re-running is safe |
| `UnitStatusEventService` | [common/utils/unit-status-event.service.ts](../../apps/api/src/common/utils/unit-status-event.service.ts) — transaction-aware; `record()` and `recordIfChanged()` |
| Write sites | `UnitsService.create` (`UNIT_CREATED`), `.update` (`MANUAL`), `.combine` (`UNIT_COMBINED`, both sides), `SalesService` close (`SALE_CLOSED`) and cancel (`SALE_CANCELLED`) |
| Actor attribution | `userId` threaded through the unit update/updateStatus and sale update controllers so a flip has an author |
| R6 overlap constraint | `lease_unit_no_overlap` — a `daterange` GiST exclusion constraint, replacing `lease_unit_active_unique` |

**Findings from the live data**

- **Only 2 of 499 units carry an `availableSince`** — 208 units are AVAILABLE, so the Vacancy Report and the
  stale-unit feed have been reading `createdAt` for 206 of them. This is the strongest evidence yet for R8,
  and it means current time-on-market numbers should not be trusted until H1 lands.
- **Zero overlapping lease pairs** in live data, so the exclusion constraint applied without any data cleanup.

**Deliberate choices worth knowing**

- The event write is **inside** the same transaction as the unit flip and is *not* error-swallowed — the
  opposite of `AuditService`. A rejected status change is recoverable; a silently missing one is not.
- The sale-close path reads the unit's prior status **inside** the transaction. Reading it outside would race
  the very concurrent close that the existing optimistic lock exists to defend against.
- The sale-cancel path was converted from an array-form `$transaction` to an interactive one, because
  array-form operations cannot read a value produced within the same transaction.
- `Unit.availableSince` is still maintained. It is now a denormalised convenience, not the source of truth;
  R8 moves the readers over.
- Archiving a source unit in a combine logs `fromStatus === toStatus` with an explanatory reason. There is no
  `UnitStatus` for "archived", and recording the merge honestly beats leaving the trail to stop mid-sentence.

**Verification**

- 486/486 API tests pass, including 7 new occupancy-log tests and 7 rewritten overlap tests (the old
  active-lease tests asserted behaviour this phase deliberately removed).
- Constraint behaviour proven against the live DB in a rolled-back transaction: overlapping lease **rejected**,
  back-to-back (`A.end == B.start`) **accepted**, prior-period historical lease **accepted** — the case the
  old rule made impossible.
- Atomicity proven end-to-end: a transaction that throws after both writes leaves neither the flip nor the
  event. DB confirmed byte-identical afterwards (499 events, 499 units, all `SYSTEM`).
- API boots clean; Nest DI resolves the new provider in both modules.

**Not done in H0, by design:** lease activation/termination do not flip unit status anywhere in the codebase
today, so there are no `LEASE_ACTIVATED` / `LEASE_ENDED` write sites to hook. Those sources exist in the type
union and get their writers in **H3** (R4 conversion), where the lease genuinely drives the unit.

### 2026-08-12 — H1 history surface (R2 + R3 + R8)

No schema change — H1 is entirely read-side.

| Piece | Detail |
|---|---|
| `UnitHistoryService` | [unit-history.service.ts](../../apps/api/src/modules/units/unit-history.service.ts). Window building and summarising are exported pure functions, so the date maths is tested without a DB |
| `GET /units/:id/history` | `unit:view`. Returns `entries` (lease / sale / vacancy / status), raw `windows`, and a lifetime `summary` |
| Per-tenancy economics (R3) | Contracted vs collected vs outstanding, deposit and TI, via **three** aggregate queries — not one per lease |
| Frontend | `useUnitHistory` hook; `UnitHistoryTimeline` now renders server data; new lifetime summary strip (total vacant / total leased / tenancies / rent collected) |
| Cache | A `refreshUnit()` helper invalidates `['unit', id]` **and** `['unit-history', id]` together at all four write sites, so the timeline cannot silently lag the panels above it |
| R8 | `currentVacancyStartByUnit()` (DISTINCT ON) now drives the Vacancy Report, the exceptions feed and the stale-units cron |

**The three vacancies the old client-side derivation could not see** — it measured gaps between two *ended*
leases, so it missed the vacancy **before the first lease**, the vacancy **open right now** (no later lease to
measure against), and any vacancy on a unit that **never had a lease**. All three now come from the event log.

**Measured impact of R8 on live data**

| | Before (availableSince) | After (occupancy log) |
|---|---|---|
| AVAILABLE units that can be aged | **1 of 208** | **208 of 208** |

The exceptions feed was worse than inaccurate: it filtered on `availableSince: { lt: cutoff }`, and a SQL
comparison against NULL is never true, so all 206 units with a null `availableSince` were **silently excluded**
from the stale-unit feed entirely. It wasn't reporting wrong numbers, it was reporting almost nothing.

**Data-integrity finding — 6 units are `SOLD` while holding an `ACTIVE` lease.** They have no sale record at
all, so the status was set by hand rather than by a sale close, and their leases run to 2027–2032 with 10–25
invoices already generated each. Nothing in the system enforces the invariant either way. This is very likely
seed/demo data, but it is exactly the state R4 exists to prevent and exactly the "0 units in an impossible
state" success metric — worth a check against production before H3.

**Verification:** 499/499 API tests pass (13 new, covering ordering by real-world date so backfilled events
slot in, same-instant tie-breaking, zero-length window collapse, and future-dated clamping). Service exercised
against live data via ts-node. Route mapped and guarded (401 not 404). Web typecheck and production build clean.

### 2026-08-12 — H1c rent changes on the timeline (R25)

Rent movements now appear as their own timeline entries, sourced from `LeaseRentPeriod`. Storage was already
correct; they were simply invisible outside that one lease's schedule table.

Two things stop this being a naive diff of consecutive periods:

- **The INITIAL period is not a change.** It is the lease starting, which the lease entry already states.
  Emitting it would double every tenancy.
- **Free rent would otherwise produce two fake changes per abatement.** Free months sit *inside* the term at
  rent 0, so consecutive-period diffing yields `$10,000 → $0` then `$0 → $10,000` around every abatement.
  Comparing against the last **paying** rent makes the abatement one entry stating what it cost, and rent that
  resumes unchanged produces none. A real escalation immediately after free rent is still reported, measured
  from the last paying rent rather than the abated zero.

Scheduled escalations render distinctly from manual changes (pale vs solid dot, `Scheduled` vs `Manual` chip) —
one was agreed at signing, the other was a decision someone made later. Manual changes carry reason and author.
A **Hide rent changes** toggle keeps the timeline readable as "who was here and when": a 5-year lease
escalating semi-annually adds 10+ entries.

**Verified in the running app** (Unit 201, two tenancies, 15 rent periods): 12 escalation entries with
from → to → delta → %, one free-rent entry reading "Nov 29, 2025 – Jan 28, 2026 · 2 months at no rent" (not a
drop-to-zero pair), per-tenancy economics `Collected $15,890 of $21,852` and `Collected $104,816 of $104,816`,
and the toggle taking escalations 12 → 0 → 12.

**Honesty fix found during that verification.** The summary read "Total leased: 21 days" on a unit whose
tenancies go back to 2020 — correct, because the occupancy log starts at the H0 bootstrap, but it reads as a
bug. The two day tiles now carry a `since <date>` caption whenever the log holds nothing but the bootstrap row.
Inferring the missing days from lease dates would be exactly the guesswork the event log exists to replace;
entering the history (H2) is the real fix.

### 2026-08-12 — H1b rent commencement, NNN per sqft, label pass (R19 + R20 + R26)

**Migration** `20260812120000_lease_rent_start_and_nnn_psf` — three nullable columns plus a CHECK constraint
(`rentStartDate >= leaseStart`). Deliberately **no backfill**: setting `rentStartDate = leaseStart` on existing
rows would be a no-op today but would erase the distinction between "rent genuinely starts at commencement"
and "nobody has told us yet" — the distinction the leasing team needs when they set real fit-out dates.

| R19 | Detail |
|---|---|
| Schedule origin | The rent-period generator now uses `rentStartDate ?? leaseStart`. A lease signed in January with rent starting in April was generating three months of periods the tenant never owed |
| Ledger origin | Same for the invoice generator — and because generation is idempotent on `(leaseId, periodMonth)`, those wrong invoices were **permanent** unless deleted by hand |
| Manual periods | Bounded by rent commencement, not legal commencement |
| Derived term | `termMonths` is computed from `(rentStartDate ?? leaseStart) → leaseEnd` on every write and the submitted value is ignored. It was previously hand-typed and unvalidated while `summariseEffectiveRent` **prefers it** over what the periods cover — so a typo silently skewed the effective-rent KPI |
| Fit-out on the timeline | New `fit_out` entry kind — its own kind, not vacancy (the unit is committed and off the market, so counting it as vacancy overstates time-on-market) and not free rent (no rent has commenced to abate) |

| R20 | Detail |
|---|---|
| `nnnPerSqft` | The rate as actually negotiated. `nnnMonthly` is derived against the unit's area and is overridable for leases quoted flat |
| Precedence | Per-call override → `lease.nnnMonthly` → zero. Existing leases have null, so they resolve to zero and generate identical schedules |
| Live feedback | The form shows `= $500/month on 1,000 sqft` beside the rate as you type |

**R26 label pass:** every money field now states its unit (`$/month`, `$/sqft/month`, `$ total`); lease start vs
rent start each carry one line distinguishing them; term is visibly read-only and derived; escalation states
that it compounds and applies to base rent only, never NNN; free rent states that free months sit **inside**
the term. A term summary line spells out the free-rent arithmetic — "36-month term · 3 months free · 33 paying
months at $10,000/mo — the abated months are forgone, not recovered" — which is the **Q11** question stated in
the UI rather than left to be inferred. If Prime answers "grossed up" instead, that sentence changes with the
generator.

**Also fixed:** the two lease edit dialogs each had a hand-rolled row→form mapping and had already drifted —
one silently dropped `rentPerSqft` on edit. Both now use one shared `leaseToForm`.

**Equivalence — the thing this phase had to prove.** All 24 leases / 31 periods / 265 invoices were snapshotted
before the migration, then every schedule was force-regenerated and every ledger re-run through the new code,
and the result compared row by row:

```
pre-existing rows changed or lost : 0
leases missing                    : 0
```

The force-regeneration did create 59 periods and 84 invoices — for leases that had never had schedules
generated, plus the current month. Generation is append-only (rule 7 in the invoice service), so no existing
row was touched and no recorded payment was at risk. **Those rows are now in the local dev database**; they are
what the system would have produced anyway, but they were not there before.

**End-to-end proof** on a real unit — lease 2025-01-01, rent 2025-04-01, `termMonths: 999` submitted,
`nnnPerSqft: 0.5` on 1,000 sqft:

```
termMonths  : 33      (derived; the 999 sent was ignored)
nnnMonthly  : 500     (0.50 x 1000)
first period: 2025-04-01     base/nnn/total = 9500/500/10000
first invoice: 2025-04-01    invoices before rent start: 0
```

519/519 tests (11 new). Test lease removed afterwards.

### 2026-08-12 — R23 leasing commission

**Migration** `20260812140000_lease_broker_commission` — `brokerId`, `brokerCommissionPct`,
`brokerCommissionAmt`, `brokerCommissionBasis`, `brokerCommissionPaidAt` on `Lease`, plus an FK
(`onDelete: SetNull`, matching `sales.brokerId`) and a CHECK restricting the basis to the three known values.
All nullable, no backfill — every existing lease predates broker attribution.

Field names mirror `Sale` deliberately so the broker report can sum both sides without a translation layer.

**Built without waiting on Q12.** A sale has one obvious base — the price. A lease does not: first month's
rent, a percentage of total term rent, and a flat fee are all normal, and Prime has not said which they use.
Rather than picking one, the basis is recorded **per lease**, which turns Q12 from a code question into a data
question. When it is absent nothing is computed — leaving the fee unstamped is honest, whereas guessing a base
puts a wrong number into a report someone might pay against.

| Basis | Formula |
|---|---|
| `FIRST_MONTH_RENT` | pct × one month's rent |
| `TOTAL_TERM_RENT` | pct × monthly rent × **derived** term (so a fit-out gap is not commissioned) |
| `FLAT` | the broker's flat fee, percentage ignored |

Stamped on **activation**, mirroring the sale side's stamp-on-close, and re-stamped when the broker, rate,
basis, rent or term later changes. The broker report gains its own leasing columns
(`leasesSigned`, `leaseCommissionEarned/Paid/Owed`) plus `totalCommission*` across both sides — kept separate
because a one-off disposal fee and a tenancy fee blended into one figure would reconcile to neither ledger.
New: `GET /brokers/:id/leases` and `PATCH /brokers/leases/:leaseId/mark-commission-paid`.

**A bug the tests caught.** The first cut decided "did a commission input change?" by checking whether the
field was *present* in the update payload. But H1b's `normaliseTermAndNnn` derives and writes `termMonths` on
**every** update — so every edit, including a note, looked like a commission change and silently recomputed a
manually negotiated `brokerCommissionAmt` back to the formula value. An override was only safe until someone
touched the notes. Now compares values against the stored row; three regression tests pin it.

**Verified end-to-end** against the live DB — a broker at 5% / $2,500 flat, on a $10,000/month 36-month lease:

```
FIRST_MONTH_RENT  -> $500       TOTAL_TERM_RENT -> $18,000      FLAT -> $2,500
no basis (Q12)    -> null  (no guess stamped)
report: leasesSigned=4  earned=$21,000  paid=$500  owed=$20,500
```

539/539 tests (24 new). Test data removed afterwards.

### 2026-08-12 — Dev Quick Login

One-click sign-in as any of the 12 roles on the local login page, so RBAC changes can be checked as Viewer or
Sales in one click. Full detail in **[docs/DEV_LOGIN.md](../DEV_LOGIN.md)**.

The ask was "remove it before deploying to AWS". Built differently on purpose — a manual removal step is the
exact failure mode that ships auth bypasses. **Three independent gates, all three must fail at once:**

1. **Not in the production bundle.** Gated on `import.meta.env.DEV`, which Vite replaces with `false` at build
   time; the branch dies and the import is tree-shaken. Verified — 0 occurrences of any marker in `vite build`
   output.
2. **The API must opt in.** The `demo-<ROLE>` token is only accepted inside `JwtAuthGuard`'s `DEMO_MODE` branch.
3. **The API refuses to boot if both are bypassed.** `main.ts` exits `1` on `NODE_ENV=production` +
   `DEMO_MODE=true`. Verified — exit code 1, reason printed first in the log.

No passwords anywhere: the panel mints the demo bearer token and calls `GET /auth/me` so the **server** decides
the permissions, rather than keeping a second role→permission map that could drift from the guard's.

⚠️ **`DEMO_MODE` and the guard bypass pre-date this work.** Only the panel, the boot guard and the doc are new.
If `DEMO_MODE` was ever set on a deployed environment, that environment was accepting unauthenticated
`Bearer demo-SUPER_ADMIN` requests — worth checking. Gate 3 now makes that state unbootable.

---

## Appendix — Schema delta summary

```prisma
// NEW
model UnitStatusEvent { ... }              // R1 — append-only occupancy log

// CHANGED
model Lease {
  isHistorical      Boolean @default(false)  // R5 — backfilled record
  convertedToSale   Sale?                    // R4 — back-relation
  terminationReason String?                  // R5 — why a past lease ended

  // ---- Part 2 ----
  rentStartDate          DateTime?                    // R19 — rent commencement; null ⇒ leaseStart
  // leaseEnd  → now means the RENT end date (term expiry)
  // termMonths → now DERIVED from (rentStartDate ?? leaseStart) → leaseEnd, no longer hand-typed
  nnnPerSqft             Decimal? @db.Decimal(8, 2)   // R20 — quoted NNN rate
  nnnMonthly             Decimal? @db.Decimal(12, 2)  // R20 — derived, overridable
  brokerId               String?                      // R23 — leasing commission, mirrors Sale
  broker                 Broker?  @relation(fields: [brokerId], references: [id], onDelete: SetNull)
  brokerCommissionPct    Decimal? @db.Decimal(5, 2)
  brokerCommissionAmt    Decimal? @db.Decimal(14, 2)
  brokerCommissionBasis  String?                      // FIRST_MONTH_RENT | TOTAL_TERM_RENT | FLAT (Q12)
  brokerCommissionPaidAt DateTime?
  // freeRentTreatment   String?   // R24 — ONLY if Q11 answers "grossed up". ABATED | GROSSED_UP
}

// NEW — Part 2
model LeaseRentPeriodCorrection {                     // R22 — prior values, never destroyed
  id                String   @id @default(cuid())
  periodId          String
  period            LeaseRentPeriod @relation(fields: [periodId], references: [id], onDelete: Cascade)
  previousBaseRent  Decimal  @db.Decimal(12, 2)
  previousNnnAmount Decimal  @db.Decimal(12, 2)
  previousStartDate DateTime
  previousEndDate   DateTime?
  correctionReason  String                            // required
  ledgerAction      String                            // REDERIVE_UNPAID | REDERIVE_ALL | SCHEDULE_ONLY
  correctedById     String?
  correctedBy       User?    @relation(fields: [correctedById], references: [id])
  correctedAt       DateTime @default(now())

  @@index([periodId])
  @@map("lease_rent_period_corrections")
}

model Sale {
  isHistorical         Boolean @default(false)  // R5
  convertedFromLeaseId String?                  // R4
  convertedFromLease   Lease?  @relation(fields: [convertedFromLeaseId], references: [id], onDelete: SetNull)
}

model LeaseRentInvoice {
  isHistorical Boolean @default(false)     // R7 — excluded from overdue/AR/QB
}

model Unit {
  statusEvents UnitStatusEvent[]           // R1
  // availableSince retained as a denormalised convenience field, no longer source of truth
}

// REMOVED / REPLACED
// partial unique index `lease_unit_active_unique` → date-range overlap check (R6)
```
