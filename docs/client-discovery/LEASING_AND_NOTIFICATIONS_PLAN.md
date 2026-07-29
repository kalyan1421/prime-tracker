# Leasing Depth + Notification Triggers + Tab Audit — Plan

**Date:** 2026-07-29 (rev 2 — client answers incorporated)
**Scope:** four client asks —
(1) building LLC name, (2) event-driven notification triggers, (3) lease economics
(NNN split, escalation history, free rent, security deposit, TI allowance, tenant contact,
**unit-wise rent payment history**), (4) **audit of Project Details tabs for demo/unconnected values**.

Code references verified against the codebase on 2026-07-29. CLAUDE.md is stale in several places
(ProjectDetailPage has **13** tabs, not 11 — `budget` and `activity` were added).

---

## 0. Client answers — locked

| # | Question | Answer | Design impact |
|---|---|---|---|
| Q1 | Escalation compounds? | **Yes, compounding** | each period's rent = previous period × (1 + pct) |
| Q2 | Escalation applies to NNN? | **Base rent only.** NNN edited manually each year | `escalationPct` touches `baseRent`; `nnnAmount` carries forward until edited |
| Q3 | "Custom month" meaning | **Interval in months** (12 / 6 / 18) | `escalationFreq` already models this — **no new field, no calendar-month mode** |
| Q4 | Free rent vs term | **My call** — see §3.4 | free months sit *inside* the term; `leaseEnd` unchanged |
| Q5 | TI allowance basis | **Not a percentage.** Fixed amount, disbursed in phases | **drop `percentBasis` / `basisAmount`** from the model |
| Q6 | Deposit split | **One deposit at the level the lease sits at. Never split.** Roll up for display | confirmed as designed |
| Q7 | Notification recipients | **My call** — see §2 | leadership global + everyone else project-scoped |
| Q8 | Tenants receive notifications? | **Strictly internal** | recipients are always `User` rows; `tenantEmail` is contact data only |
| Q9 | *(new)* Rent payment history | **Per unit. Paid / not paid, updatable by internal staff, shown unit-wise** | new `LeaseRentInvoice` model — see §3.7 |
| Q10 | *(new)* Demo-data audit | Audit all Project Details tabs | done — see §5 |

Q3's answer **removes** work: the calendar-month escalation mode is cancelled.
Q5's answer **removes** work: no percentage-basis derivation.

---

## 1. Building LLC name

**Decision: free-text string, not a relation.** Add `Building.llcName String?`. Nullable → every
existing building is editable immediately, no backfill, no data migration.

I considered a first-class `LegalEntity` model (one LLC owning many buildings, with EIN, registered
address, formation docs). **Not now** — nothing in the ask needs LLC *data*, only an LLC *label*.
A lookup table plus an admin CRUD screen plus a picker in every building form solves a problem the
client has not stated. If "show me everything under Prime Leander LLC" becomes real, promoting a
string to a relation is mechanical (`SELECT DISTINCT llcName` → seed table → FK).

| Layer | Change |
|---|---|
| Migration | `20260730000000_add_building_llc_name` — `ALTER TABLE buildings ADD COLUMN "llcName" TEXT` |
| Schema | `llcName String?` on `Building` |
| DTO | `@IsOptional() @IsString() @MaxLength(200) llcName?: string` in `CreateBuildingDto` (Update inherits via `PartialType`) |
| Service | none — `buildings.service.ts` passes the DTO through |
| Web | `Input label="LLC Name"` in the `BuildingsTab` create/edit modal (`ProjectDetailPage.tsx:4004`); add to `EMPTY_BUILDING` + edit prefill; display on `BuildingDetailPage.tsx` header and the building card |

Permission: reuses `building:edit`. No new permission. **~2 hours, zero open questions.**

---

## 2. Notification triggers

### The trap in the ask

The request is "add more triggers." The failure mode of "add more triggers" is that everyone mutes
notifications within two weeks — and then the *important* one (a $2M draw needs approval) gets
missed too. Prime Tracker is already primed for this: only **two** places in the whole API currently
send anything (the daily 8AM cron and `DrawEventHandlers`), `sendToRoles` fans out to 5–6 global
roles per event, and `NotificationPreference` is all-or-nothing per type — a Founder who mutes
`LEASE_ADDED` mutes it for every project forever.

So the real feature is not "more triggers." It's **routing and severity**.

### Architecture: extend the EventBus (not a rules engine)

Feature services emit typed domain events; a new `LeaseEventHandlers` service subscribes and calls
`NotificationsService`. This mirrors `DrawEventHandlers` exactly — the codebase already chose this
pattern and documents it in `domain-events.ts`; it just never got extended past draws.

Rejected: a data-driven `NotificationRule` table with an admin UI. Genuinely more flexible, and
genuinely a month of work plus a screen nobody asked for. Routing becomes *data* only where it
actually varies — the recipient list.

### Q7 decision — recipients: leadership global, everyone else project-scoped

```
recipients(event, projectId) =
    users with role in {SUPER_ADMIN, FOUNDER, EXECUTIVE}          ← always, portfolio owners
  ∪ users who are ProjectMember(projectId) AND hold a relevant role for this event type
```

**Fallback:** if the project has **zero** `ProjectMember` rows, fall back to role-global. Without
this, a newly created project that nobody has staffed yet generates no notifications at all and
reads as broken software. This fallback is not optional.

Rationale: Prime is founder-led with a small team — leadership genuinely wants portfolio-wide
visibility, but a salesperson on Leander does not need every Rio Ranch lease event. `ProjectMember`
already exists and is already populated via `TeamMembersCard`.

### Severity tiers — the thing that prevents mute-everything

- **Action needed** — someone must do something. In-app **+ email**.
- **FYI** — situational awareness. **In-app only** by default; email is opt-**in**.

Almost everything in this request is FYI. Shipping them all as email is how you kill the inbox.
This needs one column: `NotificationPreference.emailEnabled Boolean @default(false)`, so in-app and
email toggle separately. **This is the single highest-leverage change in this section.**

### New events

```ts
| { type: 'unit.sold'; unitId: string; saleId: string; projectId: string }
| { type: 'lease.created'; leaseId: string; projectId: string }
| { type: 'lease.activated'; leaseId: string; projectId: string }
| { type: 'lease.terminated'; leaseId: string; projectId: string; reason?: string }
| { type: 'lease.rentChanged'; leaseId: string; from: number; to: number; effectiveAt: Date; source: 'AUTO'|'MANUAL' }
| { type: 'lease.freeRentEnding'; leaseId: string; firstPayingMonth: Date }
| { type: 'lease.depositOutstanding'; leaseId: string; outstanding: number; daysLate: number }
| { type: 'lease.tiDisbursed'; leaseId: string; amount: number; pending: number }
| { type: 'rent.overdue'; invoiceId: string; leaseId: string; unitId?: string; daysOverdue: number }
```

New `NotificationType` values (one migration, alongside the `DRAW_FUNDING_OVERDUE` fix from §5):
`UNIT_SOLD`, `LEASE_ADDED`, `LEASE_ACTIVATED`, `LEASE_TERMINATED`, `LEASE_RENT_CHANGED`,
`FREE_RENT_ENDING_30`, `DEPOSIT_OUTSTANDING`, `TI_DISBURSED`, `RENT_OVERDUE`, `DRAW_FUNDING_OVERDUE`.

### Routing table

| Trigger | Tier | Roles (∩ project members, per Q7) |
|---|---|---|
| `UNIT_SOLD` | FYI | Finance, Sales, Accounting |
| `LEASE_ADDED` (DRAFT) | FYI | Sales, Finance |
| `LEASE_ACTIVATED` | FYI | Finance, Accounting, AR_AP |
| `LEASE_TERMINATED` | Action | Finance, Sales |
| `LEASE_RENT_CHANGED` | FYI | Finance, Accounting, AR_AP |
| `FREE_RENT_ENDING_30` | Action | Finance, Accounting, AR_AP |
| `DEPOSIT_OUTSTANDING` | Action | Finance, Accounting, AR_AP, Sales |
| `RENT_OVERDUE` | Action | Finance, Accounting, AR_AP |
| `TI_DISBURSED` | FYI | Finance, Accounting |

(SUPER_ADMIN / FOUNDER / EXECUTIVE are added to every row automatically by the Q7 rule.)

Cron-driven ones (`FREE_RENT_ENDING_30`, `DEPOSIT_OUTSTANDING`, `RENT_OVERDUE`, escalation-due) join
the existing daily 8AM job — no new scheduler.

### Work

| Layer | Change |
|---|---|
| Migration | new `NotificationType` values + `NotificationPreference.emailEnabled` |
| `domain-events.ts` | 9 new event types |
| `leases.service.ts` / `sales.service.ts` | `bus.emit(...)` on create / status-change (mirrors the existing `sale.statusChanged` emit at `sales.service.ts:181`) |
| new `lease-event-handlers.service.ts` | subscribes, calls `notifications.send()` |
| `notifications.service.ts` | Q7 recipient resolver (+ zero-member fallback); tier-aware email gating |
| `scheduled-notifications.service.ts` | free-rent-ending, deposit-outstanding, rent-overdue, escalation-due; **fix the building-lease skip (§5 B1)** |
| Web `SettingsPage.tsx` | two toggles per type (in-app / email), grouped by tier |

**~4 days.**

---

## 3. Lease economics

Eight sub-asks. They are not eight independent features — they collapse into **three models**.

### 3.1 Tenant contact — email + phone

`tenantContact` is one free-text string today. Add `tenantEmail String?` (`@IsEmail()`) and
`tenantPhone String?`; keep `tenantContact` as the contact **person's name**. No backfill — the old
value stays readable where it is. Per Q8 these are contact data only; the system never emails
tenants.

### 3.2 Rent + NNN + escalation schedule + rent history — one model

The client asked for four things: rent + NNN must sum to monthly rent; rent escalates by % every
N months; escalation is auto-calculated; rent changes save into the unit's history.

**These are one table.** An escalation is *known in advance* — the schedule and the history are the
same timeline, just before and after today. Modelling them separately means writing the same number
twice and reconciling forever.

```prisma
model LeaseRentPeriod {
  id            String   @id @default(cuid())
  leaseId       String
  lease         Lease    @relation(fields: [leaseId], references: [id], onDelete: Cascade)
  sequence      Int                                   // 1 = initial term
  startDate     DateTime
  endDate       DateTime?                             // null = runs to lease end
  baseRent      Decimal  @db.Decimal(12, 2)           // the rent portion — escalates (Q2)
  nnnAmount     Decimal  @default(0) @db.Decimal(12, 2) // carries forward, edited manually (Q2)
  monthlyRent   Decimal  @db.Decimal(12, 2)           // == baseRent + nnnAmount (service-enforced)
  isFreeRent    Boolean  @default(false)              // abatement month → monthlyRent 0
  escalationPct Decimal? @db.Decimal(5, 2)            // pct applied vs PREVIOUS period (Q1: compounding)
  source        String                                // INITIAL | AUTO_ESCALATION | MANUAL | FREE_RENT
  reason        String?                               // required when source = MANUAL
  createdById   String?
  createdAt     DateTime @default(now())

  invoices LeaseRentInvoice[]

  @@unique([leaseId, sequence])
  @@index([leaseId, startDate])
  @@map("lease_rent_periods")
}
```

Why this shape:
- **Rent + NNN = monthly rent** is an invariant on one row. Reject the write with a clear 400 —
  `leases.service.ts` already validates in this style.
- **Auto-escalation** is a generator: given `escalationPct` + `escalationFreq` (months, per Q3) +
  lease start/end, produce the full period list at lease creation. The client sees the whole 10-year
  rent schedule the day they sign — a better product than a lone % field.
- **History is free.** Every period row *is* a history row; `source` distinguishes a scheduled
  escalation from a mid-term renegotiation.
- **Free rent (§3.4)** is just periods with `isFreeRent = true, monthlyRent = 0`. No special-casing
  anywhere downstream.
- **Rent roll** becomes "the period covering today," which is correct in the presence of both free
  rent and escalations — where today's flat `sum(lease.monthlyRent)` is not (see §5 A3).

`Lease.monthlyRent` / `escalationPct` / `escalationFreq` stay as the *headline* values, maintained
by the service from the active period — the same mirroring pattern as `BudgetLine.revisedAmt` ←
latest `BudgetRevision`. **Nothing that reads `lease.monthlyRent` today breaks.**

**Unit-level view (client asked for history on the unit):** `Unit → leases → rentPeriods` already
gets there. Add a "Rent history" section to `UnitDetailPage.tsx` that flattens periods across *all*
leases for that unit, so a re-let reads as one continuous rent timeline.

### 3.3 Escalation engine

- On lease create with `escalationPct` + `escalationFreq`: generate periods for the full term.
- Each period's `baseRent` = previous period's `baseRent` × (1 + pct) — **compounding (Q1)**.
- `nnnAmount` carries forward unchanged and is edited by hand per year — **NNN never escalates (Q2)**.
- On lease edit of term/pct/freq: regenerate **future** periods only. Past periods are immutable
  (append-only, same rule as `BudgetRevision`).
- A daily cron activates the newly-current period and emits `lease.rentChanged`.

### 3.4 Free rent months — Q4 decision

**Free months sit *inside* the term. `leaseEnd` is unchanged. The escalation clock runs from
`leaseStart`, not from first paying month.**

A 36-month lease with 3 free months = 33 paying months, ending on the date the contract says.

Rationale: `leaseEnd` must match the signed document. If free rent silently pushed it out, every
expiry notification, rent-roll date and renewal report would disagree with the paper contract — and
the contract wins every argument. Escalation anniversaries in commercial leases are conventionally
tied to the commencement date, not to rent commencement, for the same reason.

This is reversible: it's one branch in the period generator if the client disagrees after seeing it.
No config flag — I'm not building a toggle for a decision nobody has contested yet.

Fields on `Lease`: `freeRentMonths Int?`, `freeRentStartDate DateTime?`. The generator emits those
months as `isFreeRent` periods at rent 0. Two derived numbers worth surfacing, because they're what
a Founder actually asks about:
- **Effective rent** = total contracted rent ÷ term months (`RentRollSnapshot.effectiveRent` already
  exists as a column and is currently not populated by this logic).
- **First paying month** — drives `FREE_RENT_ENDING_30`.

### 3.5 + 3.6 Security deposit and TI allowance — one model

Two asks that are structurally identical:

- **Security deposit** (Q6): tenant → Prime. Agreed amount; paid or not; how much; viewed per unit
  and per building. **One deposit at whatever level the lease sits at — never split.**
- **TI allowance** (Q5): Prime → tenant. **A fixed amount, disbursed in phases.** How much given,
  how much pending.

Both are: *an agreed total, paid down by discrete payments, with a running balance* — exactly what
`SalePayment` already does for sales. One shared model, two `kind`s:

```prisma
model LeaseObligation {
  id          String   @id @default(cuid())
  leaseId     String
  lease       Lease    @relation(fields: [leaseId], references: [id], onDelete: Cascade)
  kind        String   // SECURITY_DEPOSIT | TI_ALLOWANCE | OTHER
  direction   String   // FROM_TENANT | TO_TENANT
  totalAmount Decimal  @db.Decimal(14, 2)   // Q5: a plain agreed figure — no percentage basis
  dueDate     DateTime?
  status      String   @default("PENDING")  // PENDING | PARTIAL | SETTLED | WAIVED
  paidAmount  Decimal  @default(0) @db.Decimal(14, 2)  // mirror of sum(payments)
  notes       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  payments LeaseObligationPayment[]

  @@index([leaseId, kind])
  @@index([status, dueDate])
  @@map("lease_obligations")
}

model LeaseObligationPayment {
  id           String   @id @default(cuid())
  obligationId String
  obligation   LeaseObligation @relation(fields: [obligationId], references: [id], onDelete: Cascade)
  amount       Decimal  @db.Decimal(14, 2)
  paidAt       DateTime
  method       String?  // WIRE | CHECK | ACH | CASH | ADJUSTMENT
  reference    String?  // check no / wire ref
  documentId   String?  // receipt from the doc vault
  notes        String?
  recordedById String?
  createdAt    DateTime @default(now())

  @@index([obligationId])
  @@map("lease_obligation_payments")
}
```

`pending = totalAmount - paidAmount` — one derived number answering both "deposit paid?" and "how
much TI still owed." TI phases are simply multiple `LeaseObligationPayment` rows.

*Alternative considered:* two dedicated tables (`SecurityDeposit`, `TiAllowance`). Marginally nicer
field names, but two near-identical services and two near-identical UI panels. Reversible call — say
so before L2 starts if you prefer explicit tables.

**Deposit rollup per unit / building (Q6)** is a query, not a model — group obligations where
`kind = SECURITY_DEPOSIT` through `lease.unitId` / `lease.buildingId`. Surfaces as:
- a column on the units table — `Deposit: $12,000 ✓` / `$4,000 of $12,000`
- a building-level total on `BuildingDetailPage`
- a "Deposits outstanding" stat on the Revenue tab

**TI vs the Interior module:** `InteriorProject` already tracks what fit-out *costs Prime*
(`contractValue`, `InteriorInvoice`). `LeaseObligation{kind: TI_ALLOWANCE}` tracks what Prime *owes
the tenant*. Different numbers, both needed. Link via the existing `InteriorProject.leaseId` so one
screen shows cost vs allowance vs disbursed.

### 3.7 Unit-wise rent payment history (Q9) — new

> "unit wise payment history should be paid if the tenant was paid or not, should also be able to
> update by the internal staff, and it should be shown unit wise"

This is monthly **rent collection tracking** — distinct from everything above. §3.2 says what the
tenant *owes* each month; this says what they *paid*.

```prisma
model LeaseRentInvoice {
  id           String   @id @default(cuid())
  leaseId      String
  lease        Lease    @relation(fields: [leaseId], references: [id], onDelete: Cascade)
  periodId     String?                                // the LeaseRentPeriod that set the amount
  period       LeaseRentPeriod? @relation(fields: [periodId], references: [id], onDelete: SetNull)
  periodMonth  DateTime                               // first day of the month
  amountDue    Decimal  @db.Decimal(12, 2)            // from the covering period
  amountPaid   Decimal  @default(0) @db.Decimal(12, 2)
  paidAt       DateTime?
  dueDate      DateTime
  status       String   @default("DUE")               // DUE | PARTIAL | PAID | FREE | WAIVED
  method       String?
  reference    String?
  notes        String?
  recordedById String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([leaseId, periodMonth])
  @@index([status, dueDate])
  @@map("lease_rent_invoices")
}
```

- **Generated**, never hand-created: one row per month per lease, amount read from the covering
  `LeaseRentPeriod`. Backfilled on lease create, extended by a monthly cron.
- **Free-rent months generate rows too** — `amountDue = 0, status = FREE`. The history stays
  continuous, so a unit's payment record has no unexplained gaps.
- The `@@unique([leaseId, periodMonth])` makes generation idempotent — the cron can re-run safely.

**Internal staff update:** `PATCH /leases/invoices/:id/payment` `{ amountPaid, paidAt, method, reference }`.
Status derives from the amounts — staff never set it directly.

**New permission `rent:collect`** granted to SUPER_ADMIN, FOUNDER, FINANCE, ACCOUNTING, AR_AP.
Deliberately *not* `lease:edit` — an AR/AP clerk should be able to record a rent payment without
being able to rewrite lease terms.

**Unit-wise display (the explicit ask):** a "Rent payments" table on `UnitDetailPage.tsx`, month by
month across *all* leases for that unit, paid/unpaid chips, inline "record payment". Same table
embedded per-lease in the Revenue tab.

Emits `rent.overdue` → `RENT_OVERDUE` notification from the daily cron.

### 3.8 Rent roll and reporting impact

Once periods and invoices exist, these move to as-of-date logic:
- `leases.service.ts` `getRentRoll()` — sum the period covering the as-of date, not `monthlyRent`
- `useMonthlyLeaseIncome` / revenue reports
- `RentRollSnapshot.effectiveRent` — populate properly (free-rent adjusted)
- **The two "Annual Rent = monthly × 12" stat cards** (§5 A3) must be fixed in the same PR

⚠️ This is a **behaviour change to existing numbers**, not just an addition. Rent-roll totals will
*drop* for any lease sitting in a free-rent period — correct, but tell the client before it appears
on screen, not after.

---

## 3.9 Build status (updated 2026-07-29)

**L0 — complete.** Schema + 2 migrations applied (44 → 46). `Building.llcName`, lease
`tenantEmail`/`tenantPhone`/`freeRentMonths`/`freeRentStartDate`, `NotificationType.DRAW_FUNDING_OVERDUE`.
Audit bugs A1 (Revenue `$0`) and A2 (funded-total mismatch) fixed; backend bugs B1 (building-lease
expiry silence) and B2 (mislabelled draw type) fixed. UI wired in `ProjectDetailPage`,
`BuildingDetailPage`, `TenantProfilePanel`.

Four **additional** pre-existing bugs found and fixed during the work, none part of the original ask:
- 3 notification deep links pointed at non-existent tabs (`/leases`, `/financials` ×2) — the router
  silently falls back to Overview, so those alerts landed on the wrong screen. Now `/revenue`,
  `/draws`, `/budget`.
- `Building.acreage` was unsettable through the API — on the model, missing from the DTO, and
  `main.ts` runs `forbidNonWhitelisted`, so any client sending it got a 400.
- `buildings.service.ts` inline param types omitted `llcName` and `acreage`.
- `freeRentStartDate` needed the same `YYYY-MM-DD` → `Date` coercion `leaseStart`/`leaseEnd` already have.

**L1 / L2 — API complete. UI outstanding.** `LeaseRentPeriodService` (58 tests) and
`LeaseObligationService` (35 tests) built, registered, and now fully wired: 14 HTTP routes + DTOs,
15 web query hooks, schedule generation on lease create/update, and an as-of-date rent roll.

Verified against **real Postgres**, not just mocks — every unit test mocks Prisma, so nothing had
proven the generator writes correct rows. A throwaway 36-month lease at 5%/12mo with 3 free months
produced: one free period spanning exactly the abated months, 33 paying months of 36 with `leaseEnd`
unmoved, escalations at +12/+24mo from `leaseStart`, base rents 1000 → 1050 → 1102.50, and
`forwardYearRent` 12,862.50 vs a naive ×12 of 12,600.

⚠️ **Plan correction — do not mirror `Lease.monthlyRent` from the active period.** §3.2 originally
called for this (the `BudgetLine.revisedAmt` pattern). It is wrong here: a lease inside a free-rent
period has an effective rent of 0, so mirroring would zero the headline rent, and the next
regeneration would derive a zero schedule from it. `monthlyRent` stays the contractual base;
effective rent is always derived, never stored back.

Still outstanding for L1/L2 — **UI only**:
- rent history / schedule table on the lease and on `UnitDetailPage` (flattened across all leases
  for that unit, so a re-let reads as one continuous timeline)
- deposit + TI panels; deposit column on the units table; building-level totals
- "Deposits outstanding" stat on the Revenue tab

Verification: API `tsc --noEmit` exit 0; web `tsc --noEmit` exit 0; 248 tests pass. 11 failures in
`interior.service`, `encryption.service`, `daily-logs.service` are **pre-existing** — confirmed by
stashing all of this work and re-running to the identical 11.

**Two engine decisions worth knowing:**
- Rounding compounds the *rounded* value (half-up, 2dp, at each period boundary) — the tenant is
  invoiced the rounded number, so that is the contractual base for the next escalation.
- `LeaseObligationService` **allows overpayment** (SETTLED, `pending` goes negative as a refund
  signal). This deliberately diverges from `SalePaymentsService`, which blocks it. Worth reconciling.

---

## 4. Phasing

| Phase | Contents | Depends on | Effort |
|---|---|---|---|
| **L0 — fixes + quick wins** | §5 audit bugs A1, A2, B1, B2; Building `llcName`; tenant email/phone | none | **~1.5 days** |
| **L1 — rent timeline** | `LeaseRentPeriod`, compounding escalation generator, free-rent periods, rent history on lease + unit, rent-roll as-of-date, fix A3 | L0 | **~5 days** |
| **L2 — money in/out** | `LeaseObligation` + payments (deposit + phased TI); deposit rollup per unit & building; receipt doc links | L0 | **~4 days** |
| **L2b — rent collection** | `LeaseRentInvoice`, generation cron, `rent:collect` permission, unit-wise payment table | L1 | **~4 days** |
| **L3 — notifications** | new event types, `LeaseEventHandlers`, Q7 recipient resolver, tiered in-app/email preferences, new cron checks | L1 + L2 + L2b | **~4 days** |

L1+L2b and L2 are independent tracks and can run in parallel. L3 goes last — it notifies about
things the earlier phases create.

**Total ~18–19 working days** for one developer, excluding client review cycles.
L0 is unblocked and can start immediately.

---

## 5. Audit — Project Details tabs (Q10)

> "Values in each screen — are they just demo, or not connected to any data point / API?
> List out in project details, all tabs."

### Verdict: **no demo or mock data anywhere in Project Details.**

All 13 tabs fetch from real hooks against real endpoints. Zero `TODO` / `mock` / `placeholder` /
`dummy` markers in the file, and zero hardcoded metric constants or fake math.

**But three values render numbers that are wrong or permanently dead** — which is very likely what
prompted the question. One of them is a headline revenue figure stuck at $0.

### Tab-by-tab

| # | Tab | Component | Data source | Verdict |
|---|---|---|---|---|
| 1 | overview | `OverviewTab:549` | `useProject`, `useProjectHealth`, `useFinancialSummary`, `useSalesPipeline`, `useMonthlyLeaseIncome`, `useMonthlyPayments`, `useLeads`, `useProjectDraws` | ✅ live — but see **A2** |
| 2 | construction | `ConstructionTab:4506` | composes `BuildingsTab` (`useBuildings`) + `DailyLogFeed` | ✅ live |
| 3 | budget | `BudgetTab:4521` | `useProject`, `useFinancialSummary`, `useProjectBudgetRevisions`, `useSetApprovedBudget` | ✅ live |
| 4 | revenue | `RevenueTab:4705` | `useSalesPipeline`, `useMonthlyLeaseIncome` + composes `SalesTab`, `LeasesTab` | 🔴 **A1 — 2 dead stat cards** |
| 5 | units | `UnitsTab:2125` | `useUnits`, `useBuildings`, `useMonthlyLeaseIncome`, `useCustomOptions` | ✅ live |
| 6 | milestones | `MilestonesTab:2886` | `useMilestones`, `useUsers`, `useProjectDrawSchedules` | ✅ live |
| 7 | leads | `ProjectLeadsTab:4751` | `useLeads`, `useUnits`, `useLeadActivities` | ✅ live |
| 8 | draws | `DrawsTab:5459` | `useProjectDraws`, `useLoans`, `useDrawSchedule` | 🟠 live, but **A2** |
| 9 | vendors | `VendorsTab:6075` | `useContracts`, `useContractSummary`, `useVendors` | ✅ live |
| 10 | documents | `DocumentsTab:6434` | `useDocuments` | ✅ live |
| 11 | tasks | `TasksPageInner` (`TasksPage.tsx:62`) | `useTasks`, `useCustomOptions` | ✅ live |
| 12 | comments | `ProjectCommentsTab:5310` | `useProjectComments` | ✅ live |
| 13 | activity | `ProjectActivityTab:6763` | `useProjectActivity` | ✅ live |

### Findings

**A1 — 🔴 HIGH. Revenue tab "Closed Sales" always shows $0 and "Under Contract" always shows 0.**

[`ProjectDetailPage.tsx:4712-4713`](../../apps/web/src/pages/ProjectDetailPage.tsx#L4712):
```ts
const closedSalesValue = (pip?.CLOSED || []).reduce((s, sale) => s + (sale.salePrice || 0), 0);
const underContractCount = (pip?.UNDER_CONTRACT || []).length;
```
`GET /sales/pipeline` returns `{ byStatus, avgDaysToClose, totalPipelineValue, closedRevenue }`
([`sales.service.ts:18-44`](../../apps/api/src/modules/sales/sales.service.ts#L18)). The per-status
arrays live under **`byStatus`**, not at the root — so `pip.CLOSED` and `pip.UNDER_CONTRACT` are
always `undefined`, and both cards render `$0` / `0` no matter how many sales exist.

`SalesTab` on the very same page reads it correctly (`pipeline?.byStatus`, line 3683), and
`OverviewTab` uses the API's own `closedRevenue` correctly (line 845) — this tab is the odd one out.

*Latent second bug in the same line:* Prisma `Decimal` fields serialize to JSON as **strings**, so
`s + (sale.salePrice || 0)` would string-concatenate (`0 + "500000"` → `"0500000"`) even if the key
existed. Every other summation in the file wraps in `Number()`.

**Fix:** use the values the API already computes — `fmt(pip?.closedRevenue || 0)` and
`String(pip?.byStatus?.UNDER_CONTRACT?.length || 0)`.

**A2 — 🟠 MEDIUM. "Funded Total" can differ between Overview and Draws for the same project.**

- Overview (`:651`): `Number(d.requestedAmount || d.amount || 0)`
- Draws tab (`:5499`): `Number(d.amount || 0)`

Neither uses `approvedAmount` — the field holding what the lender actually approved
(`schema.prisma:637`). When a lender funds less than requested (common), both screens overstate,
and they can disagree with each other. **Fix:** one shared helper, `approvedAmount ?? amount`.

**A3 — 🟡 LOW now, HIGH after L1. "Annual Rent = monthly × 12" in two places.**

`ProjectDetailPage.tsx:3398` (LeasesTab) and `:4723` (RevenueTab). Correct *only* because free rent
and escalations don't exist yet. The day L1 ships, both silently become wrong. **Must be fixed as
part of L1**, not deferred.

### Backend bugs found in the same sweep

**B1 — 🔴 Building-level leases never notify on expiry.**
[`scheduled-notifications.service.ts:218`](../../apps/api/src/modules/notifications/scheduled-notifications.service.ts#L218)
— `if (!lease.unitId || !lease.unit) continue;`. Whole-building leases (e.g. Leander Bldg 1) skip
the 30-day and 7-day warnings entirely. Silent since Sprint 1 made `Lease.unitId` nullable.

**B2 — 🟠 `onFundingOverdue` writes a mislabelled notification type.**
`draw-event-handlers.service.ts` uses `type: 'BUDGET_VARIANCE'` with a code comment admitting it's
wrong. Users see draw-funding alerts under their budget-variance preference — and muting one mutes
the other. Fixed by the `DRAW_FUNDING_OVERDUE` type in §2's migration.

### Recommendation

A1, A2, B1, B2 go into **L0** — they're live defects, independent of the new features, and A1 in
particular is a revenue number reading zero on a screen the client looks at.

---

## 6. Remaining open questions

Only two, and neither blocks L0 or L1:

**R1 — Rent due date.** `LeaseRentInvoice.dueDate`: 1st of the month, or a per-lease `rentDueDay`
(5th, 10th)? *Assumption: 1st, with an optional `Lease.rentDueDay Int?` if the client wants it.*
Blocks L2b only.

**R2 — Partial-month rent.** A lease starting the 15th — does month 1 bill pro-rata or a full month?
*Assumption: pro-rata by day count.* Blocks L2b only.

---

## 7. Explicitly out of scope

- No `LegalEntity` master table (§1) — LLC stays a label until proven otherwise.
- No data-driven notification rules engine (§2).
- No calendar-month escalation mode — **cancelled by Q3**.
- No percentage-basis derivation for TI — **cancelled by Q5**.
- No CAM/opex reconciliation. NNN is an agreed figure edited yearly (Q2), not reconciled against
  actual expenses. True NNN reconciliation would be its own module.
- No tenant-facing portal or tenant emails — **strictly internal per Q8**.
- WhatsApp notification channel (tracked separately in `UPDATE_PLAN.md`).
