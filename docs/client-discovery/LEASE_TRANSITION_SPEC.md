# Lease Transition Spec — ending a tenancy and starting the next

**Date:** 2026-08-13
**Status:** Draft for build. Client confirmed all four scenarios are in scope, and confirmed
cap-and-void as the invoice rule.
**Depends on:** H0/H1/H1b/H1c (delivered 2026-08-12) — `unit_status_events`, `UnitHistoryService`,
`lease_unit_no_overlap`.

---

## The problem

A unit moving "from one lease to another" is four different events that look identical in the
database today, because nothing records the transition itself:

| Scenario | Lease doc | Tenant | Unit | Occupancy |
|---|---|---|---|---|
| **Turnover** | ends, new one signed | changes | same | breaks (vacancy) |
| **Renewal / re-papering** | ends, new one signed | same | same | continuous |
| **Relocation** | ends, new one signed | same | **changes** | continuous, moves |
| **Assignment / novation** | **survives** | changes | same | continuous |

Today all four are performed as: flip `Lease.status` to `TERMINATED` by hand, create a second
lease row by hand, then remember to go to the Unit page and change the status by hand. What is
lost each time:

1. **Why and when the tenant actually left.** `Lease` has no `terminationDate`,
   `terminationReason`, or `moveOutDate`. `leaseEnd` stays at the *contracted* expiry, so a
   tenant who walked out 14 months early still reads as running to term in the rent roll, the
   expiring-lease notifications, and effective-rent.
2. **The unit state.** `leases.service.ts` never writes `unit.status` and never writes
   `unit_status_events` — the only writers are `units.service.ts` and `sales.service.ts`. A
   terminated lease leaves the unit at `LEASED` with `availableSince` unset, which is precisely
   the condition R8 just repaired for 206 units (vacancy report and the stale-unit feed skip it
   entirely).
3. **The link between the two leases.** A renewal is indistinguishable from an unrelated new
   tenant, so the timeline invents a vacancy that never happened.
4. **Who was billed.** On an assignment, editing `tenantName` in place silently rewrites history:
   last year's invoices appear to have been billed to a tenant who did not exist yet.

---

## Blocking discovery: the exclusion constraint truncates the signed term

`lease_unit_no_overlap` is built on `daterange(leaseStart, leaseEnd)`. A lease terminated early
still carries its contracted `leaseEnd`, so **the successor lease is refused** — the same failure
mode as the old `lease_unit_active_unique` index that R6 replaced.

The tempting fix — truncate `leaseEnd` to the move-out date — is wrong. `leaseEnd` drives the
effective-rent straight-lining and `brokerCommissionBasis = TOTAL_TERM_RENT`; overwriting it
destroys the signed term and silently restates a commission someone may already have been paid.

**Fix:** rebuild the constraint over the *occupied* range, keeping `leaseEnd` as the contract.

```sql
ALTER TABLE leases DROP CONSTRAINT lease_unit_no_overlap;
ALTER TABLE leases ADD CONSTRAINT lease_unit_no_overlap
  EXCLUDE USING gist (
    "unitId" WITH =,
    daterange("leaseStart"::date, COALESCE("terminationDate", "leaseEnd")::date, '[)') WITH &&
  ) WHERE ("unitId" IS NOT NULL AND "deletedAt" IS NULL);
```

`assertNoOverlappingLease` (the friendly-400 fast path) must be changed to match, or it will
keep rejecting valid successors before the DB is ever consulted.

---

## Schema

### 1. Termination metadata on `Lease` — covers turnover, renewal, relocation

```prisma
// Actual end of occupancy. Null = the lease is running, or ran, to leaseEnd.
// Deliberately distinct from leaseEnd, which stays the CONTRACTED expiry: the
// difference between them is the early-termination exposure, and overwriting
// leaseEnd would erase the term that effective rent and TOTAL_TERM_RENT
// commission are computed from.
terminationDate   DateTime?
// EXPIRED | NON_RENEWAL | EARLY_TERMINATION | EVICTION | MUTUAL |
// LANDLORD_TERMINATED | RENEWED | RELOCATED | ASSIGNED | TENANT_BOUGHT
terminationReason String?
terminationNote   String?

// The lease that CONTINUES this tenancy — renewal (same unit) or relocation
// (different unit). Null for a genuine turnover. Unique so two leases cannot
// both claim the same successor; cycle-checked on write like Milestone.dependsOnId.
successorLeaseId  String?  @unique
successorLease    Lease?   @relation("LeaseSuccession", fields: [successorLeaseId], references: [id], onDelete: SetNull)
predecessorLease  Lease?   @relation("LeaseSuccession")
```

Constraints:
- `CHECK (terminationDate IS NULL OR terminationDate >= leaseStart)`. No upper bound — holdover
  past `leaseEnd` is real and must be recordable.
- `TENANT_BOUGHT` already has a home: the existing lease→sale rule (H3) terminates the lease at
  the closing date. This reason exists so that path writes the same field rather than a second one.

Continuity is **derived, not flagged**: `successorLeaseId` set + same `unitId` = renewal, no
vacancy entry. Set + different `unitId` = relocation. Null = turnover, vacancy entry emitted.
One less field to keep consistent.

### 2. `LeaseTenantAssignment` — the lease document survives

```prisma
model LeaseTenantAssignment {
  id                  String   @id @default(cuid())
  leaseId             String
  lease               Lease    @relation(fields: [leaseId], references: [id], onDelete: Cascade)
  effectiveDate       DateTime
  fromTenantName      String
  fromTenantLegalName String?
  toTenantName        String
  toTenantLegalName   String?
  toTenantContact     String?
  toTenantEmail       String?
  toTenantPhone       String?
  reason              String?  // BUSINESS_SALE | NOVATION | ENTITY_RESTRUCTURE | OTHER
  documentId          String?  // the executed assignment agreement
  recordedById        String?
  createdAt           DateTime @default(now())

  @@index([leaseId, effectiveDate])
  @@map("lease_tenant_assignments")
}
```

An assignment is **not** a new lease. The rent periods, the invoice ledger, and the obligations
continue uninterrupted — that is the definition of the thing. Without this table the only record
of the change is the audit interceptor's `newValues`, which is the whole submitted form body and
therefore cannot say what changed (the same limitation that forced `recordLeaseChanges`).

### 3. Invoice void

`LeaseRentInvoice.status` gains `VOID`, plus `voidReason String?` and `voidedAt DateTime?`.

`VOID` is not `WAIVED`. `WAIVED` is a Finance decision — money that was owed and forgiven, and it
belongs in concession reporting. `VOID` means the tenancy had ended and the invoice was never owed
at all. Collapsing them puts phantom concessions in the numbers.

---

## Service behaviour

### `LeasesService.endTenancy(leaseId, input, userId)` — one transaction

```
input: { terminationDate, terminationReason, terminationNote?,
         successorLeaseId?, depositDisposition: REFUND | FORFEIT | TRANSFER | DECIDE_LATER,
         newUnitStatus? }
```

1. **Guard.** Refuse if `terminationDate < leaseStart`. Refuse if a `PAID` invoice exists dated
   after `terminationDate` — that is a real conflict a person must resolve, not something to
   paper over.
2. **Stamp** `terminationDate`, `terminationReason`, `terminationNote`, `successorLeaseId`, and
   `status` = `EXPIRED` when `terminationDate >= leaseEnd`, else `TERMINATED`.
3. **Cap the schedule.** `LeaseRentPeriodService` truncates the last period at `terminationDate`
   and drops periods starting after it — reusing the guard already written for sold units.
4. **Void, do not delete.** Every invoice with `periodMonth > terminationDate` and status in
   (`DUE`, `PARTIAL`, `FREE`) → `VOID` with `voidReason`. `PAID` rows are never touched (step 1
   has already refused that case). `generateForLease` caps `through` at `terminationDate`, the
   same cap it applies at a sale closing date — without it, generation is idempotent on
   `(leaseId, periodMonth)` and any regeneration would resurrect them permanently.
5. **Deposit.** Settle the `SECURITY_DEPOSIT` obligation per `depositDisposition`. `TRANSFER`
   requires `successorLeaseId` and moves the balance to the successor's obligation.
   `DECIDE_LATER` leaves it open and raises an exceptions-feed item — never guess at money.
6. **Unit + occupancy log.** Flip the unit and write **one** `unit_status_events` row carrying
   `leaseId`, `reason`, `recordedById`, `effectiveAt = terminationDate`:
   - turnover → `AVAILABLE` (which sets `availableSince`, starting the vacancy clock)
   - renewal → straight to the successor's state, no `AVAILABLE` hop, no vacancy
   - relocation → **two** events: old unit → `AVAILABLE`, new unit → `LEASED`/`LEASE_PENDING`
7. **Notify.** The existing `lease.terminated` bus event, now carrying the reason.

### `LeasesService.assignTenant(leaseId, input, userId)` — one transaction

Writes the `LeaseTenantAssignment` row **and** updates the lease's tenant fields. Nothing else is
touched: no new lease, no schedule change, no invoice change, no unit status change. Historical
invoices keep pointing at the lease, and the assignment table is what says who was the tenant on
any given date.

### State machine

`units.service.ts:20` allows `LEASED → ['AVAILABLE', 'OCCUPIED', 'UNDER_CONTRACT']`. Add
`LEASE_PENDING` — signing the successor before the sitting tenant moves out is normal, and today
there is no legal path to represent it.

---

## Timeline

Two new `TimelineEntryKind`s in `UnitHistoryService`:

- **`tenancy_end`** — move-out date, reason, days early/late vs `leaseEnd`, deposit disposition.
- **`assignment`** — "Tenant changed: X → Y", effective date, reason, link to the agreement.

And one suppression: when `successorLeaseId` links two leases with no gap, **do not emit the
`vacancy` entry**. This is the same class of bug as H1c's rent-change comparison — a derived entry
that is technically true of the dates and false about what happened.

---

## Permissions

Reuse `lease:edit` for `endTenancy`. `assignTenant` rewrites who was billed, so it should sit
behind the same bar as the R27 backfill split — Sales can record, Founder approves reversal.

## Out of scope / to raise

- **Commission clawback on early termination.** `brokerCommissionAmt` is stamped on activation
  from the full term. If a `TOTAL_TERM_RENT` lease dies in month 6, is the commission recoverable?
  Nothing in the build changes it either way; flagging so it is a decision, not an oversight.
- **Holdover rent.** Occupancy past `leaseEnd` at a different (usually uplifted) rate. The schedule
  has no way to express it. Separate item.
- The 6 units that are `SOLD` with an `ACTIVE` lease and no sale record should be resolved before
  this ships — `endTenancy` will refuse on some of them.

## Estimate

Migration + `endTenancy` + `assignTenant` + timeline + UI + tests: **4–5 days**, comparable to R23.
