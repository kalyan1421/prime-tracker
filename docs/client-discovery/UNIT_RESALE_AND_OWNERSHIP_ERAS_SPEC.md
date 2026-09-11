# Unit Resale & Ownership Eras — spec and plan

**Date:** 2026-09-11
**Status:** Draft. **Blocked on Q1** (below) — that one answer decides whether this is a
reporting change or a new money model.
**Raised by:** client, 2026-09-11 — "a unit will be sold to a business, then given on lease to
another tenant, and again we can sell it to someone else", plus "when a unit is leased, if any
condition the lease will be stopped and given to another tenant as lease", both "positional with
the date we give of lease or sale dates".

---

## 1. What is already built (verified in code and against live data, 2026-09-11)

**Scenario B — lease stopped early, unit re-let to a new tenant: BUILT.** No new work needed.
- `LeasesService.endTenancy({ terminationDate, terminationReason, successorLeaseId,
  depositDisposition })` — `leases.service.ts`.
- Ten termination reasons incl. `EARLY_TERMINATION`, `EVICTION`, `MUTUAL`,
  `LANDLORD_TERMINATED`, `ASSIGNED`, `RELOCATED`.
- Deposit carry-over to the next tenant: `settleDeposit` `TRANSFER` moves the held balance onto
  the successor's obligation and discharges the source. `REFUND` / `APPLY` / `DECIDE_LATER` also
  supported.
- `lease_unit_no_overlap` (DB constraint) enforces that two tenancies cannot claim the same unit
  over the same dates — which is what makes "positional by date" safe rather than advisory.
- Design already written up in `LEASE_TRANSITION_SPEC.md` (turnover / renewal / relocation /
  assignment, all four confirmed in scope by the client 2026-08-13).
- Live data: 3 units already carry more than one lease.

**The chronological spine — BUILT.** `UnitStatusEvent` (`unit_status_events`) records every
transition with `fromStatus`/`toStatus`, a **backdatable `effectiveAt`**, `source`, provenance
(`leaseId`, `saleId`) and an `isHistorical` flag. `UnitHistoryService` (1,042 lines) turns that
into ordered occupancy windows including vacancy before the first lease and vacancy happening
right now. So "ordered by the dates we give" is already the storage model — it does not need
inventing, only extending.

**Third-party sale of a tenanted unit — BUILT** (this was the August blocking question, since
answered). `Sale.buyerType`: `SITTING_TENANT` ends the tenancy (`TENANT_BOUGHT`, ledger capped);
`THIRD_PARTY` hands the tenancy over intact (`LEASE_TRANSFERRED_WITH_SALE`, ledger preserved).

---

## 2. What is NOT built: Scenario A — sold → leased again → sold again

**`SOLD` is deliberately terminal today.** Three independent mechanisms enforce it:

1. `syncUnitFromLease` refuses to move a SOLD unit: *"A SOLD unit is never overwritten. Prime
   does not own it; a lease on it is a data-integrity question (there are 8), not a licence to
   un-sell it."*
2. `NOT_ON_SOLD_UNIT` (~10 call sites — invoicing, rent roll, cash-flow engine, obligations)
   removes every lease on a sold unit from all money.
3. No transition out of `SOLD` exists anywhere. `releasable = unit.status !== 'SOLD'`.

**Live data agrees that this has never happened yet:** of 875 units, **0** have more than one
`CLOSED` sale. 8 units are SOLD while holding a lease — and all 8 are `buyerType:
SITTING_TENANT`, i.e. the tenant-bought case, not a re-let.

**The missing concept is ownership over time.** `Unit.primeOwned` is a single boolean with no
dates, so the unit cannot say "Prime owned it until Mar 2021, a business owned it Mar 2021 –
Jun 2024, Prime brokered its resale in Jun 2024". Without that, a lease recorded after a sale has
no answer to *whose rent it is*, which is why every money path currently just excludes it.

---

## 3. The question that gates the design

**Q1. After Prime sells a unit to a business and it is leased again — whose rent is that?**
Three models, very different implications:

| | Model | Rent is | Prime's revenue | Build cost |
|---|---|---|---|---|
| **M1** | Prime manages it for the new owner | collected by Prime, remitted to owner | management fee only | High — pass-through ledger, owner statements |
| **M2** | The unit comes back onto Prime's book (buy-back / reversal) | Prime's | full rent | Medium — needs an "un-sell" event with a date |
| **M3** | Prime only records history; the owner handles the tenancy | not Prime's at all | resale commission only | Low — display + a second sale |

Today's behaviour is closest to **M3 with the history hidden**. My recommendation is to build
**M3 properly first** (it is display + ordering, no money model), and treat M1/M2 as separate
phases gated on the answer — because M1 is a property-management product, not a feature.

---

## 4. Proposed model (independent of which of M1–M3 wins)

Add **`UnitOwnershipEra`** — the missing dated dimension:

```
UnitOwnershipEra
  unitId
  kind        PRIME_OWNED | THIRD_PARTY_OWNED | MANAGED_FOR_OWNER
  ownerName   (null when PRIME_OWNED)
  startedAt   date   -- driven by a Sale closing, or by unit creation
  endedAt     date?  -- null while current
  startSaleId / endSaleId   -- provenance, same pattern as UnitStatusEvent
```

- Eras are non-overlapping and contiguous; the same `effectiveAt`-ordered discipline as
  `unit_status_events`, so it slots into `UnitHistoryService` rather than competing with it.
- A `Lease` resolves its era by date → that answers "whose rent" **structurally**, instead of the
  current all-or-nothing `NOT_ON_SOLD_UNIT` filter.
- Money filters change from `unit.status !== 'SOLD'` to *"which era covers this invoice month"* —
  which is also what makes a second sale reportable without double-counting.

**Sale reporting hazard to settle now:** the Founder dashboard shows `CLOSED SALES (ALL-TIME)
$32,675,540`. If Prime brokers a resale of a unit it no longer owns, adding that price to the same
total double-counts the asset. Resale value has to be a separate line from first-sale value —
see Q4.

---

## 5. Phases

| Phase | Scope | Gated on |
|---|---|---|
| **R0** | Allow a **second sale** on a unit, and render sale/lease/sale interleaved in the unit timeline strictly by date. No money changes; resale excluded from sales totals until Q4 is answered. | — |
| **R1** | `UnitOwnershipEra` + backfill one era per existing unit from its current `primeOwned`/sale state. Era shown on the unit timeline. Still no money change. | Q2, Q3 |
| **R2** | Re-let after sale: permit a lease in a `THIRD_PARTY_OWNED` era, clearly marked not-Prime-revenue, excluded from rent roll and cash-flow but visible in history. | Q1 = M3 |
| **R3** | Money: management-fee / rent pass-through (M1) **or** buy-back (M2). Owner statements. | Q1 = M1 or M2 |
| **R4** | Resale commission + broker attribution on the second sale; resale line in reports. | Q4, Q5 |
| **R5** | Import/backfill support for multi-era history in the sale and rent importers. | R1 |

R0 is small and safe. R1 is one migration and should be sequenced like any other schema change.
R3 is the one that is a genuine product decision, not a build task.

---

## 6. Two smaller items raised in the same message

**S1. Security deposit should default to PAID on a backfilled tenancy.** Real gap, small fix.
The monthly rent ledger already defaults to paid in full for historical leases
(`settleHistoricalLedger`, client decision 2026-08-12) precisely so a 2019 tenancy does not show
as overdue AR. But the `SECURITY_DEPOSIT` `LeaseObligation` is seeded from the lease terms with
the model default `status: PENDING`, `paidAmount: 0` — so every backfilled lease reports its
deposit as still uncollected. Inconsistent with the ledger decision beside it. See Q6 for the one
thing worth confirming (ended vs still-running tenancies).

**S2. Ledger exceptions from the uploaded sheet — already built for the template, missing for
"Upload your own spreadsheet".** The template path reads the `Ledger Exceptions` sheet, joins it
by (Unit Number, Tenant Name), and applies per-month collected amounts as `collections` overrides
on the lease's monthly invoices — i.e. already tagged to the unit through its lease. The generic
column-mapping path hardcodes `orphaned: []` and does not source them ("not sourced from a generic
sheet in v1"). Work: extend the mapper to accept month/amount-collected columns, or a
second mapped sheet. Medium, no client input needed.

---

## 7. Questions for Prime

**For the sales team / company — Q1 blocks everything in §5 R2–R3.**

- **Q1 (blocking).** When Prime sells a unit to a business and that unit is later leased to a
  tenant — who collects the rent, and does Prime earn anything from it? (M1 manage-for-owner /
  M2 unit comes back to Prime / M3 not Prime's business at all.)
- **Q2.** Has this actually happened yet, or is it expected? There are 0 units with two sales in
  the system today, so we need to know whether this is history to backfill or only future deals.
- **Q3.** When Prime sells and later re-sells the same unit, does Prime still own it in between,
  or is the second sale Prime acting as broker for the owner?
- **Q4.** Should a resale's price count in "Closed Sales (all-time)"? It is currently
  $32.68M; adding resales to it double-counts the same asset. Separate line, or included?
- **Q5.** On a resale, does Prime take a commission, and is that commission tracked like the
  existing broker commissions (with installments)?
- **Q6.** For the deposit fix (S1): on a **backfilled** tenancy that has already **ended**, should
  the deposit read as collected-in-full and then refunded, or simply collected-in-full? And for one
  still running, is "Prime holds it" always true?
- **Q7.** When a lease is stopped early and re-let (Scenario B, already built), does the deposit
  normally transfer to the new tenant, get refunded, or get applied to arrears? There is a
  four-way choice on the screen today and knowing the usual answer lets us default it.
