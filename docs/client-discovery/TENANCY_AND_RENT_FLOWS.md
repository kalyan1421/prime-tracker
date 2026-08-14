# Tenancy & rent flows — how they work, and where they break

**Date:** 2026-08-13
**Audience:** Prime + engineering. Written after building the tenancy transitions (T1) and
re-reading every write path involved.

Two systems meet on the Unit Detail page and they are frequently confused:

- **The tenancy chain** — who is in the unit, and how one occupancy becomes the next.
- **The rent chain** — what they owe (schedule), what they were billed (ledger), what
  they paid (collection).

They are linked in exactly one direction: **the lease drives the rent, never the reverse.**
Almost every confusion below comes from expecting the arrow to point the other way.

---

# Part 1 — The tenancy chain

## 1.1 The four ways a unit changes hands

| | Lease document | Tenant | Unit | Occupancy | Action |
|---|---|---|---|---|---|
| **Turnover** | ends, new one signed | changes | same | breaks | `endTenancy`, no successor |
| **Renewal** | ends, new one signed | same | same | continuous | `endTenancy` + successor on same unit |
| **Relocation** | ends, new one signed | same | **changes** | continuous | `endTenancy` + successor on another unit |
| **Assignment** | **survives** | changes | same | continuous | `assignTenant` |

The first three end a lease. The fourth does not — and that distinction is the single
most important thing for the team to get right, because an assignment recorded as a
turnover destroys the ledger's continuity, and a turnover recorded as an assignment
attaches a new tenant to a year of invoices they never received.

## 1.2 The lease-to-lease shift, step by step

```
  1. CREATE the successor lease first
     └─ + Add Lease on the unit (renewal) or on the new unit (relocation)
     └─ status DRAFT if not yet started, ACTIVE if it has
     └─ ⚠ dates must not overlap the outgoing lease's OCCUPIED range
                                       │
  2. END the outgoing tenancy          ▼
     └─ Tenant panel → End tenancy (the ⇥ icon)
     └─ move-out date  ← the date they ACTUALLY left, not the contracted expiry
     └─ reason         ← RENEWED / RELOCATED tell the system occupancy continues
     └─ successor      ← links the two; this is what suppresses a phantom vacancy
     └─ deposit        ← REFUND / FORFEIT / TRANSFER / decide later
                                       │
  3. The server does all of this in ONE transaction
     ├─ stamps terminationDate + reason + successorLeaseId
     ├─ status → EXPIRED if move-out ≥ leaseEnd, else TERMINATED   (derived, not asked)
     ├─ caps the rent schedule at the move-out date
     ├─ VOIDs unpaid invoices billed after it
     ├─ records the deposit decision
     └─ releases the unit + writes an occupancy event
        └─ UNLESS the successor is on the SAME unit (renewal) — nobody left
```

**Why the successor must exist first.** The dialog cannot create one. It links two
leases; it does not author them. If the successor is not there yet, end the tenancy now
and link it later by editing the lease — nothing in the flow is one-way.

**What "continuous" actually changes.** With `successorLeaseId` set and the successor on
the same unit, the unit is *not* released and the timeline does *not* draw a vacancy. On
a relocation the successor is on a different unit, so this unit *is* released — correctly,
because it is now empty.

## 1.3 Assignment — the one that is not a shift

Use it when the tenant *entity* changes but the deal does not: a business sold, an LLC
restructured. The lease, the rent schedule, the invoice ledger and the obligations all
continue untouched — that is the definition.

The outgoing name is snapshotted onto a `LeaseTenantAssignment` row. Without it, editing
`tenantName` in place would silently rewrite history: last year's invoices would read as
billed to a party that did not exist yet.

---

# Part 2 — The rent chain

Three layers, generated in order. Each depends on the one above it.

```
   LEASE                    the contract: monthlyRent, dates, escalation, free rent
     │
     │  computeRentSchedule()
     ▼
   LeaseRentPeriod          WHAT IS OWED, over time
     │                      one row per rent level; escalations COMPOUND
     │                      free-rent months are rows at rent 0
     │
     │  computeRentInvoiceSchedule()
     ▼
   LeaseRentInvoice         WHAT WAS BILLED — one row per lease per calendar month
     │                      @@unique(leaseId, periodMonth) ← makes generation idempotent
     │
     ▼
   payments                 WHAT WAS PAID (amountPaid replaces, never accumulates)
```

## 2.1 The rent schedule (periods)

Built **once**, when the lease is created. `generateForLease` returns the existing rows
untouched unless `force` is passed — so it cannot silently double up.

- Starts at **`rentStartDate ?? leaseStart`**. A tenant fitting out for three months owes
  nothing during it, and this is the field that says so.
- Escalation **compounds**: each period's base = previous × (1 + pct).
- Free rent sits **inside** the term — `leaseEnd` does not move, and the escalation clock
  still runs from `leaseStart`.
- **Past periods are immutable.** Editing rent terms re-derives only periods starting
  *after today* (`regenerateFuture`). Anything already running or finished is frozen,
  because the tenant was already invoiced against it.
- Overlap is resolved by **latest-start-wins**, not by editing old rows. That is how a
  mid-term renegotiation supersedes a scheduled period without violating immutability.

## 2.2 The ledger (invoices) — what "Generate ledger" does

Two entry points, same code:

| Trigger | What it does |
|---|---|
| **"Generate ledger" button** | Bills every month from rent commencement up to today |
| **Daily cron, 08:00 CT** | Same, for every ACTIVE lease on a unit that is not sold |

For each month it computes what the covering period says is owed, then inserts **only
the months that do not exist yet** (`skipDuplicates` on `leaseId + periodMonth`).

**Three consequences that matter:**

1. **Generation is append-only and idempotent.** Re-running it is safe. It is also why a
   *wrong* invoice is permanent — regenerating will not correct it, because the row
   already exists for that month. Correcting means voiding or editing the row.
2. **It is capped.** `capAtEnd` stops billing at the earlier of the sale closing date and
   the tenancy's move-out date. Without that cap, a departed tenant keeps being invoiced
   every night by the cron, permanently.
3. **Free months generate rows too**, at £0 with status `FREE`, so the payment history
   has no gaps.

## 2.3 Statuses on an invoice

| | Meaning | Counts toward `billed`? |
|---|---|---|
| `DUE` / `PARTIAL` / `PAID` | the ordinary lifecycle | yes |
| `FREE` | an abated month | yes (at 0) |
| `WAIVED` | **was owed, forgiven** — a Finance concession | **no** |
| `VOID` | **never owed** — the tenancy had ended | **no** |

`WAIVED` and `VOID` are deliberately not the same. Collapsing them would put phantom
concessions in the reporting.

---

# Part 3 — Edge cases, by area

Ranked within each area: 🔴 can produce wrong money · 🟠 wrong or missing information ·
🟡 confusing but harmless.

## 3.1 Unit history / timeline

| | Edge case | What happens today |
|---|---|---|
| 🟠 | **Day totals predate the log** | `unit_status_events` began 2026-08-12 with one bootstrap row per unit. "Total leased: 0 days" on a unit that has been leased for a year is the log's age, not the unit's. Flagged in the UI, but people will still read it as fact |
| 🟠 | **Backdated entry** | `effectiveAt` vs `recordedAt` are distinct and the timeline sorts by real-world date. Correct — but a row entered today for last March appears *above* today's rows, which reads like a bug unless you know |
| 🟡 | **Phantom vacancy between linked leases** | Suppressed only when the gap is *contained* in the handover window. A real multi-month gap between a lease and its "renewal" still shows a vacancy — deliberately, because the unit really was empty |
| 🟡 | **Relocation successor is invisible** | The successor lives on another unit, so this unit's timeline can say the tenancy continues but cannot name where. `continuesOnThisUnit: false` |

## 3.2 Lease-to-lease shift

| | Edge case | What happens today |
|---|---|---|
| 🔴 | **Successor created before the predecessor is ended** | Refused by `lease_unit_no_overlap` until the move-out date is set. Correct, but the error arrives at the *second* step and reads as though the successor is wrong |
| 🟠 | **Renewal linked after the fact** | If you end the tenancy with no successor, the unit is released and a vacancy is recorded. Linking the successor afterwards does **not** retract that event — the log is append-only. The vacancy stays on the timeline |
| 🟠 | **Successor claimed twice** | `successorLeaseId` is `@unique`, so a second lease claiming the same successor is refused — but only at the DB level for concurrent writes |
| 🟡 | **Same-day turnover** | Legal. `[)` bounds mean a lease ending 30 Jun and one starting 30 Jun do not collide |
| 🟡 | **Deposit TRANSFER with nothing collected** | Reports "no deposit was collected" rather than creating a £0 obligation on the successor that looks real |

## 3.3 Ending a tenancy

| | Edge case | What happens today |
|---|---|---|
| 🔴 | **Rent collected past the move-out date** | **Refused**, naming the months. Either the date is wrong or a refund is owed — not something an automated void should decide |
| 🔴 | **Holdover** | `terminationDate` may be **after** `leaseEnd` (deliberately no upper bound on the CHECK) and the timeline reports "held over N days". But **the schedule cannot bill holdover months, at any rate.** Rent for a tenant who overstays is simply not generated |
| 🟠 | **Early exit vs the contracted term** | `leaseEnd` is never truncated — it stays the signed term, because effective-rent and `TOTAL_TERM_RENT` commission are computed from it. The gap between the two *is* the exposure |
| 🟠 | **Commission is not clawed back** | A `TOTAL_TERM_RENT` fee stamped on activation stays stamped when the lease dies in month 6 of 60 |
| 🟡 | **Deposit REFUND / FORFEIT** | Records the **decision** only; it moves no money. Finance still books the actual refund as a payment. Only `TRANSFER` moves a balance |

## 3.4 Lease → sold

| | Edge case | What happens today |
|---|---|---|
| 🔴 | **Closing a sale does NOT end the lease** | `SalesService.close()` contains **zero** references to a lease. It flips the unit to `SOLD` and stops there. The lease stays ACTIVE, and the only thing preventing it being billed is that the cron filters sold units. **8 units are in this state right now.** This is the missing H3 |
| 🔴 | **Money already collected past the closing date** | `endTenancy` will *refuse* on those units, so they cannot be cleaned up with the normal action |
| 🟠 | **Sold with no sale record** | A unit hand-flipped to `SOLD` is treated as closed for the whole schedule (`soldAt` falls back to the epoch) — deliberately, because those units exist in live data |
| 🟠 | **Third-party sale of a tenanted unit** | Out of scope for v1. The build assumes a sale means the **sitting tenant bought** |

## 3.5 Editing an existing lease

| | Edge case | What happens today |
|---|---|---|
| 🔴 | **Moving `leaseStart` after invoices exist** | Periods that have already started are **frozen**, so the schedule keeps its original shape while the lease claims new dates. Invoices already generated are **not** revisited — generation is idempotent, so months billed under the old dates stay billed. *This is the case in the screenshot: leaseStart moved from Aug 2026 back to Jan 2026* |
| 🔴 | **Shortening the term** | `leaseEnd` pulled earlier does not void invoices already generated beyond it. Only `endTenancy` voids |
| 🟠 | **`termMonths` is derived** | Server-side from `(rentStartDate ?? leaseStart) → leaseEnd`; a submitted value is ignored. Correct, but a user who types 24 and sees 6 has no explanation |
| 🟠 | **Changing rent** | Re-derives **future** periods only. The current month keeps the old rate — usually right, occasionally not what the user meant |
| 🟡 | **A no-op save** | Records nothing on the timeline. Only real diffs are logged |

---

# Part 4 — What to check, in order

Run these against **production**, not the dev database.

**1. Units and leases that contradict each other** — the script reports and repairs only
what the data settles:

```bash
npx ts-node -T --compiler-options '{"module":"commonjs"}' \
  apps/api/prisma/fix-unit-lease-consistency.ts
```

**2. Sold units still carrying a live lease** — the 🔴 above. For each: did the sitting
tenant buy (→ end the tenancy at the closing date), or is the sale wrong?

**3. Leases whose term has expired but are still ACTIVE** — did they leave, or are they
holding over? The second cannot currently be billed.

**4. Ledgers that disagree with their schedule** — units where invoices exist for months
the current periods no longer cover. These are the fingerprints of a lease edited after
its ledger was generated.

---

# Part 5 — Flow changes worth making

| Priority | Change | Why |
|---|---|---|
| 🔴 **1** | **Close the lease when a sale closes** (H3) | The single largest hole. A sale is a real event that ends a tenancy, and nothing connects them. Should reuse `endTenancy` with reason `TENANT_BOUGHT` and the closing date as the move-out |
| 🔴 **2** | **Bill holdover** | A tenant overstaying is common and currently generates no rent at all. Needs a decision on rate first (same, or an uplift) |
| 🟠 **3** | **Warn when editing a lease that already has a ledger** | Today the edit silently succeeds and the ledger quietly disagrees. The form should say "12 invoices already exist for this lease; changing the dates will not revisit them" |
| 🟠 **4** | **Offer "create the renewal" from the End-tenancy dialog** | The successor must exist first, which forces users out of the flow and back into it. A "create and link" path would make renewals one action |
| 🟠 **5** | **Make the ledger's coverage visible** | There is no view that says "this lease is billed through August 2026". Users cannot tell whether Generate ledger did anything |
| 🟡 **6** | **Explain derived `termMonths`** | One line under the field |

---

# Part 6 — Questions for Prime

Grouped by what they block. Several are repeats — they have been open a while and each
one is cheap to answer and expensive to guess.

### Money — a wrong answer puts a wrong number in a report

1. **Free rent: abated or grossed up?** On 36 months with 3 free, does Prime collect
   33 × rent, or 33 × rent × 36/33? ~£30k per lease. Current build is the former.
   *(Open since 2026-07-29.)*
2. **Holdover rent** — when a tenant overstays, do you bill the same rent, an uplift
   (commonly 125–150%), or nothing? Nothing is what happens today, by omission.
3. **Commission clawback** — a `TOTAL_TERM_RENT` fee is stamped on activation from the
   full term. If the lease dies in month 6 of 60, is any of it recoverable?
4. **Deposit REFUND / FORFEIT** — we record the decision and leave the money to Finance.
   Should the system instead move it?

### Process — these change what we build

5. **When a unit is sold with a sitting tenant, is it always the tenant buying?** The
   build assumes yes. If Prime ever sells a tenanted unit to an outside investor, the
   lease must survive the sale and H3 needs a second path. *(Open since 2026-08-12.)*
6. **Does a DRAFT lease mean "signed, not started" or "still negotiating"?** Today a
   draft does not move the unit. If Prime only drafts once signed, it should set the unit
   to `LEASE_PENDING`.
7. **Should past rent periods be editable?** Reverses the 2026-07-29 decision to freeze
   them. Recommended: correction-with-provenance behind a permission, not silent
   mutation. **Finance should be on that call.** *(Open since 2026-08-12.)*
8. **Do you know per-month collection history for the backfill, or only contracted
   rent?** Determines whether historical ledgers are real or reconstructed.
   *(Blocks H2. Open since 2026-08-12.)*

### Data — needs a person, not a script

9. **The 8 sold-with-a-live-lease units** — for each: tenant bought, or sale mis-entered?
10. **Units marked tenanted with no lease** — genuinely empty, or is a real tenancy
    missing from the system? The second is un-billed rent.
