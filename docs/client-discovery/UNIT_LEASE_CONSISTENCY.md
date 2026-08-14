# Unit status vs. lease reality — a data consistency review

**Date:** 2026-08-13
**Trigger:** a user noticed Unit 101 (Spur Plaza) showing status **AVAILABLE** while the
Tenant panel showed **The Coffee House — Active**, lease running to Dec 2027.

That unit is not an isolated case. Scanning the whole portfolio:

> ### ⚠️ Correction, same day
>
> The first version of this review reported **101 contradicting units**. That figure was
> **wrong — inflated roughly tenfold.** The scan did not exclude units whose parent
> project is soft-deleted, and **471 of the 529 units in the dev database sit under one of
> the 12 deleted projects**. Spur Plaza — the project the reported unit belongs to — is
> itself soft-deleted.
>
> The corrected numbers are below. The underlying defect is real and unchanged; only its
> size was overstated. Lesson: `deletedAt IS NULL` on the row you are counting is not
> enough when the row has soft-deletable parents.

## The numbers (live projects only)

| State | Units | |
|---|---:|---|
| ok — tenanted **and** leased | **12** | ✅ |
| ok — vacant, no lease | 7 | ✅ |
| **C. marked SOLD, has a live lease** | **8** | 🔴 |
| **A. marked tenanted, NO live lease** | **5** | 🔴 |
| **B. marked AVAILABLE, has a live lease** | **0** | ✅ none in a live project |
| SOLD (no lease) | 18 | — |
| under construction / under contract | 8 | — |

**Of the 25 units that either claim to be tenanted or hold a live lease, 12 agree and 13
contradict** — roughly half. Still a real problem, an order of magnitude smaller than
first reported.

The unit that triggered this (Spur Plaza · Unit 101, AVAILABLE with an active lease) is in
a **soft-deleted project**, which is why it does not appear in the corrected counts. It is
still a genuine instance of the defect — and it raises a separate question: the unit detail
page happily renders a unit whose project has been deleted.

Separately: **1 lease's term ran out (Jul 2026) and is still marked ACTIVE** — nobody
closed it.

## Why

**Nothing has ever set a unit's status from its lease.** Activating a lease does not
touch the unit; ending one did not either until `endTenancy` shipped today. Unit status is
a hand-maintained field that duplicates information the lease already holds, and on a
portfolio this size hand-maintenance loses.

The 91 in category A are the same shape as the finding on 2026-08-12 that only 2 of 499
units had `availableSince` set: a field nobody remembers to write.

## What shipped today

Both halves are now *visible* rather than silent:

- **A derived tenancy state.** The Tenant panel no longer trusts `lease.status`. It
  computes from the dates: `Active` / `Ending soon` (≤60d) / **`Term ended`** (ran out,
  never closed — red) / `Draft` / **`Past tenant`**. A lease whose term expired last month
  can no longer wear a green "Active" chip.
- **Past tenancies read as history.** Dimmed, grey avatar, "Nobody is in this unit now —
  showing the last tenancy", with the move-out date. Previously a unit with only ended
  leases showed a bare "no active lease", which is true and useless.
- **The contradiction is named.** When the unit and its lease disagree, a banner says what
  each one claims and offers *Fix unit status* — it does not silently pick a winner,
  because from the UI neither field is more trustworthy than the other.
- (Earlier the same day: the mirror banner for "marked leased, no tenant recorded", which
  is what surfaces the 91.)

## Root cause — FIXED 2026-08-13

`LeasesService.syncUnitFromLease` now drives the unit from the lease, inside the same
transaction as the lease write. Deliberately narrow:

- **Only an ACTIVE lease moves the unit.** A DRAFT is a proposal, not an occupancy.
- **A SOLD unit is never overwritten.** Prime does not own it; a lease on it is category C,
  not a licence to un-sell it.
- **OCCUPIED is never downgraded to LEASED.** It is the more specific claim and a human set
  it on purpose.
- The occupancy event is dated by **`leaseStart`, not `now()`** — a lease entered three
  weeks late did not start occupying the unit the day it was typed in.

Together with `endTenancy` (which already releases the unit), both ends of a tenancy now
move the unit. 1331 tests, 9 of them on this behaviour and its restraint.

## Repairing the existing rows

`prisma/fix-unit-lease-consistency.ts` — **dry run by default**, `--apply` to write.

```bash
npx ts-node -T --compiler-options '{"module":"commonjs"}' prisma/fix-unit-lease-consistency.ts
```

It fixes **only category B**, where an active lease is positive evidence somebody is in
the unit and the status is the field with nothing behind it. Changes are written with a
`BACKFILL` occupancy event dated by the lease.

It **reports and refuses to touch** A, C and D, because the data cannot settle them:

- **A** — either the unit is empty and the status is stale, **or a real tenancy was never
  entered**. Flipping these to AVAILABLE would silently erase the second case, and that is
  the one that costs money: an un-entered tenancy is un-billed rent.
- **C** — either the sale is wrong or the lease should have terminated at closing. Both are
  real events with money attached; `endTenancy` already refuses some of these where rent
  was collected past the closing date.
- **D** — closing an expired lease is a business question (did they leave, or hold over?),
  and holdover cannot currently be billed at all.

## Still open

- **The 13 in A and C need a human**, unit by unit. The script prints them with project,
  building and tenant.
- **Should a DRAFT lease move the unit to `LEASE_PENDING`?** Currently it does not. A draft
  can be speculative, so acting on it seemed worse than the problem — but if Prime only
  ever drafts a lease once it is signed, it should.
- **A unit whose project is soft-deleted still renders.** Separate defect, found while
  correcting the numbers above.

## Run this against production first

The numbers above are the dev database. **`prisma/audit-unit-lease-consistency.sql`** is
the read-only version of the whole classification — same four buckets as the repair
script, as plain SQL, so it needs no Node, no Prisma client and no deploy:

```bash
psql "$DATABASE_URL" -f apps/api/prisma/audit-unit-lease-consistency.sql
```

Every statement in it is a SELECT. It prints a bucket count, then each bucket in full with
project / building / unit / tenant, so the A and C rows can be worked through on a call
line by line.

Note the parent filters it carries throughout — omitting them is what produced the
tenfold error the first time these numbers were taken. 471 of 529 dev units sit under
soft-deleted projects, and every one of them is a unit nobody will ever open.

Dev run, 2026-08-14 (for comparison against whatever production says):

| Bucket | Units |
|---|---|
| A — tenanted, no live lease | 5 |
| C — SOLD with a live lease | 8 |
| D — term expired, still ACTIVE | 1 |
| B — AVAILABLE with an ACTIVE lease (auto-fixable) | 0 |
| consistent | 45 |

Six of the eight C rows carry **no closing date at all** — they are units flipped to SOLD
by hand, with no sale behind them. That is the shape to look for in production: it tells
you whether C is a data-entry habit or a genuine sale/lease conflict. Prime has said the
dev C rows are test data.
