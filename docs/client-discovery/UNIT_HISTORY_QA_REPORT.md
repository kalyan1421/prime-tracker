# Unit Occupancy History — QA Report

**2026-08-12** · Target: `QA — Building Fixtures` / `B-DELTA — Unit History`
Scope: H0 (occupancy log) · H1 (history surface) · H1c (rent changes) · H1b (rent commencement, NNN) · R23 (commission)

**Result: 69 fixture assertions + 546 unit tests, all passing. Three real defects found and fixed, one live-data finding needing a client decision, one model change (NNN), and one test-authoring error corrected.**

---

## What was built to test it

Testing this by clicking around was not going to work: the interesting cases are a unit that
went vacant *before* its first lease, a same-instant double flip, a backfilled event dated two
years before it was written. None occur in demo data, and several cannot be produced through
the UI at all.

So the fixtures are the deliverable, not a by-product:

| File | Purpose |
|---|---|
| [seed-qa-unit-history.ts](../../apps/api/prisma/seed-qa-unit-history.ts) | 17 units, one per edge case, in a new `B-DELTA` building under the existing QA project |
| [qa-unit-history-check.ts](../../apps/api/prisma/qa-unit-history-check.ts) | Runs the real `UnitHistoryService` against each and asserts the claim that unit exists to make |

```bash
npx tsx prisma/seed-qa-building.ts && npx tsx prisma/seed-qa-unit-history.ts
npx ts-node -T --compiler-options '{"module":"commonjs"}' prisma/qa-unit-history-check.ts
```

Both are idempotent and reversible (`--reset`). The check exits non-zero on failure, so it can
go into CI once a test database exists.

**Why a script and not a jest spec.** Every existing spec mocks Prisma. That is right for the
date arithmetic — and it is exactly why these cases needed something else: the questions here
are whether the *exclusion constraint* rejects an overlap, whether the *generator* starts at
rent commencement, whether real `Decimal` columns round correctly. A mocked Prisma cannot
answer any of them. The two layers are complementary and both are now in place.

---

## Test strategy: what is covered where

| Layer | Where | Covers | Count |
|---|---|---|---|
| **Unit** (mocked Prisma) | `unit-history.service.spec.ts` | Window building, ordering, tie-breaks, summarising, rent-entry derivation | 24 |
| **Unit** | `leases.service.spec.ts` | Overlap rules, rent commencement, derived term, NNN, commission | 50 |
| **Unit** | `units.service.spec.ts`, `sales.service.spec.ts` | Occupancy-log writes, transactional atomicity | 31 |
| **Integration** (live DB) | `qa-unit-history-check.ts` | Constraints, generators, end-to-end service output | 64 |
| **UI** (manual, browser) | — | Timeline rendering, warning banner, filter toggle | spot-checked |

Deliberately **not** covered: the HTTP layer (guards are declarative and uniform across the
controller), and visual regression (no harness in the repo; not worth standing one up for this).

---

## Findings

### 🔴 DEFECT — abatement value blank on the commonest free-rent arrangement · **FIXED**

Fixture **H-06**. A lease with free months at the **start** of the term rendered its
rent-free entry with no value: *"2 months at no rent"* and nothing else.

`rentEntriesForLease` valued an abatement from the rent in force *before* it. When free rent
is the first period there is no earlier paying period, so the value came out null. Free months
at the beginning of a lease is the **most common concession there is** — this was not an exotic
edge case, it was the default one.

Fixed by looking **forward** to the next paying period, falling back to the lease's headline
rent when an abatement has paying periods on neither side. Also added `forgoneTotal` so the
concession states its full cost, not just a monthly rate.

Now renders: `Jan 1, 2026 – Feb 28, 2026 · 58 days at no rent · $6,000/mo abated`

Locked in with two unit tests, so it cannot regress:
- *"values an abatement that starts on day one, where nothing precedes it"*
- *"falls back to the headline rent when an abatement has no paying period either side"*

### 🔴 DEFECT — a sold unit's rent schedule was still writable · **FIXED**

Reported from the UI: on a `SOLD` unit the rent panel still offered **"Regenerate future"** and
**"Add rent change"**.

This was worse than a cosmetic slip. Clicking *Regenerate future* would have minted exactly the
post-sale rent periods the timeline suppresses as impossible — and the ledger button would then
bill from them. The earlier fix was **display-only**; it hid the symptom while leaving the
mechanism that produces it fully operational.

The root of it: `NOT_ON_SOLD_UNIT` — the rule that "Prime does not collect rent on a unit it
has sold" — was applied to **reads** (rent roll, cash-flow, the billing cron) but to **no write
path at all**. So the cron would not bill a sold unit, but a person could, by hand, and the read
filters would then hide the rows they had just created.

Guards added at the API, since disabling a button only stops the polite caller:

| Path | Behaviour on a sold unit |
|---|---|
| `regenerateFuture` | Refused — every row it writes is future, so there is nothing legitimate for it to do |
| `generateForLease(force)` | Refused (routes through `regenerateFuture`) |
| `addManualPeriod` | Refused **only** when dated after the sale |
| `generateForLease` (invoices) | `through` capped at the closing date rather than refused |

Two deliberate asymmetries. A manual period dated **before** the sale is still allowed, and the
invoice ledger is **capped rather than blocked** — because correcting or backfilling the
*pre-sale* rent story is legitimate, and H2's backfill depends on being able to do exactly that
on units that have since sold. A blanket refusal would have made this guard something H2 had to
unpick.

A unit flipped to `SOLD` by hand with no sale row has no closing date to anchor to. Those are
treated as closed for the whole schedule, not waved through — on live data they are the majority
of the affected units, so the no-sale-record case is the one that most needs covering.

The UI now disables both buttons with the reason in a tooltip and a banner, so the refusal is
visible before the click rather than as an error after it.

Pinned by 5 new fixture assertions on H-10, including the one that keeps the escape hatch open
(*"still allows a correction dated BEFORE the sale"*).

### 🔴 FINDING — $386k of rent invoiced on units marked SOLD · **needs a decision**

The guard stops new post-sale rows. It does **not** remove existing ones — invoice generation is
append-only by design (rule 7), and nothing in the system deletes an invoice.

Querying live data for the damage already done:

| Unit | Tenant | Invoices on a SOLD unit | Billed | Outstanding |
|---|---|---|---|---|
| 104 | Subway | 26 | $101,102.83 | $101,102.83 |
| 105 | Great Clips | 23 | $95,859.84 | $95,859.84 |
| 209 | Kumon | 19 | $75,605.76 | $75,605.76 |
| 106 | H&R Block | 13 | $63,624.35 | $63,624.35 |
| 207 | T-Mobile | 11 | $49,992.06 | $49,992.06 |
| | **Total** | **92** | **$386,184.84** | **$386,184.84** |

All five are `SOLD` with an `ACTIVE` lease and **no sale record at all** — the status was set by
hand. Their leases run to 2027–2032 with real tenant names, and not one invoice has a payment
against it.

Which reading is right changes what to do, and only Prime can say:

- **The units are not really sold** (status set in error) — then these are **real receivables**,
  and they are currently **invisible in the rent roll**, because `NOT_ON_SOLD_UNIT` filters sold
  units out of exactly the report that would surface them. $386k of AR that nobody is chasing.
- **The units really are sold** — then the leases should be terminated and these 92 invoices
  voided, not left sitting as outstanding balances against former tenants.

Both readings are bad, and the first is worse. This is demo/seed data on my machine; **the same
query should be run against production before the client call** — the shape of the defect is a
property of the code, not of the fixtures.

```sql
-- units marked SOLD that still carry an ACTIVE lease, and what has been billed on them
WITH sold AS (
  SELECT u.id, u."unitNumber",
         coalesce((SELECT min(s."closingDate") FROM sales s
                   WHERE s."unitId"=u.id AND s.status='CLOSED' AND s."deletedAt" IS NULL),
                  '1970-01-01'::timestamp) AS sold_on
  FROM units u WHERE u.status='SOLD' AND u."deletedAt" IS NULL
)
SELECT sold."unitNumber", l."tenantName", sold.sold_on::date,
       count(i.id) AS invoices_after_sale,
       coalesce(sum(i."amountDue" - i."amountPaid"),0) AS outstanding
FROM sold
JOIN leases l ON l."unitId"=sold.id AND l.status='ACTIVE' AND l."deletedAt" IS NULL
LEFT JOIN lease_rent_invoices i ON i."leaseId"=l.id AND i."periodMonth" > sold.sold_on
GROUP BY 1,2,3 ORDER BY 4 DESC;
```

### 🟢 CHANGE — NNN is a one-time charge, not monthly rent · **DONE**

Client-confirmed 2026-08-12, reversing the rule recorded on 2026-07-29. NNN was a column on
every rent period, folded into `monthlyRent` under `monthlyRent = baseRent + nnnAmount`, and
therefore billed **every month** by the invoice generator. Prime charges it **once, at signing**.

A one-time agreed sum settled by one or more payments is what `LeaseObligation` already models,
so NNN became a fourth obligation kind beside `SECURITY_DEPOSIT` and `TI_ALLOWANCE` rather than
getting a mechanism of its own. `Lease.nnnPerSqft` / `nnnTotalAmount` stay as the headline
terms, exactly as `securityDeposit` sits beside its obligation.

| Before | After |
|---|---|
| `LeaseRentPeriod.nnnAmount`, billed monthly | column dropped |
| `monthlyRent = baseRent + nnnAmount` | `monthlyRent = baseRent` |
| `Lease.nnnMonthly` | `Lease.nnnTotalAmount` (one-time) |
| NNN $/sqft/month | NNN $/sqft, charged once |
| NNN column in the schedule table | gone; obligations panel carries it |

**Timing made this cheap.** Exactly **one** rent period in the database carried a non-zero NNN
($150, on a QA fixture) and **no** lease used `nnnPerSqft`. Migrating a live portfolio with NNN
on every lease would have been a reconciliation exercise; here it was a rename.

That single $150 was **not** silently discarded or annualised — a monthly rate does not imply a
one-time total, and guessing would have put an invented number in a ledger. It was carried into
an NNN obligation with a note saying exactly where it came from and that the total needs
verifying.

Verified after migration: **0 rows** violate the new invariant, the schedule table no longer has
an NNN column, and the NNN obligation shows in the obligations panel.

### 🟡 TEST ERROR — my own assertion was wrong · corrected

Fixture **H-05** initially failed *"does not count fit-out as vacancy"*. The code was right;
the assertion was sloppy. It flagged the genuine **lease-up vacancy** (Oct–Jan, before the
lease was signed) as if it were the fit-out window. The fit-out window is `LEASE_PENDING`,
correctly classified `RESERVED`, and correctly excluded from vacancy.

Rewritten to assert what actually matters: *no vacancy window intersects the fit-out range*,
and *the earlier lease-up vacancy is still reported*. Worth recording because a test that
asserts the wrong thing is worse than no test — this one would have blocked a correct change.

### 🟢 CONFIRMED — the `SOLD` + `ACTIVE lease` defect behaves as designed

Fixture **H-10** reproduces the live problem you spotted. Verified in the browser:

- Warning banner: *"This unit is marked SOLD but still has an ACTIVE lease…"*
- *"3 scheduled rent changes dated after the sale closed are not shown — they cannot occur."*
- Two pre-sale escalations remain; three post-sale ones withheld.

Fixture **H-09** — the same sale with the lease properly `TERMINATED` — produces **no** warning
and suppresses nothing, confirming the warning is specific rather than firing on any sold unit.

**This is containment, not a cure.** The root cause (R4: closing a sale does not terminate the
lease) is still open, blocked on Q1.

---

## Coverage by case

| Fixture | Claim under test | Result |
|---|---|---|
| H-01 | Bootstrap-only unit flags "tracked history starts here"; open vacancy measured against now | ✅ 3/3 |
| H-02 | The vacancy **before** the first lease is visible (181 days) | ✅ 2/2 |
| H-03 | Re-let gap **and** lease-up vacancy both counted (59 + 184 days), 2 tenancies | ✅ 4/4 |
| H-04 | Same-day turnover invents no vacancy; a real overlap is still rejected by the constraint | ✅ 3/3 |
| H-05 | Fit-out is its own entry (90d); schedule and ledger start at rent commencement; term 33 not 36 | ✅ 6/6 |
| H-06 | One abatement entry, no fake `$X→$0→$X` pair, **value stated** | ✅ 4/4 *(after fix)* |
| H-07 | One entry per escalation, none for the initial rent, future ones marked upcoming | ✅ 4/4 |
| H-08 | Manual renegotiation carries its reason and a negative delta | ✅ 3/3 |
| H-09 | Clean sale → no warning, nothing suppressed | ✅ 3/3 |
| H-10 | Sold-with-active-lease → warning + suppression, count disclosed | ✅ 4/4 |
| H-10 | Write paths refused: regenerate, forced regen, post-sale manual period, ledger past the sale — while a **pre-sale** correction stays allowed | ✅ 5/5 |
| H-11 | Cancelled sale releases the unit; lost reason shown | ✅ 3/3 |
| H-12 | Construction window narrated; not counted as vacancy | ✅ 2/2 |
| H-13 | Backfilled event sorts by real-world date, not write order | ✅ 1/1 |
| H-14 | Same-instant flip collapses; the surviving state is the one it ended in | ✅ 2/2 |
| H-15 | Future-dated event clamps to 0, never negative | ✅ 1/1 |
| H-16 | Soft-deleted lease absent from the timeline | ✅ 1/1 |
| H-17 | Zero-sqft unit renders without dividing by zero | ✅ 1/1 |
| all | Every entry has a valid date and a finite duration | ✅ 17/17 |

---

## Gaps I did not close

Honest list of what this pass does **not** prove.

1. **No CI wiring.** The integration check needs a database, and there is no test DB in the
   pipeline. It runs on demand. Standing one up is worth doing before H2 backfill lands, since
   backfill multiplies the number of history states considerably.
2. **Concurrency untested.** The occupancy log's atomicity is covered by unit tests and one
   manual transaction probe, but nothing exercises two simultaneous status flips. The
   optimistic lock on sale close is the risky path and it is asserted only with mocks.
3. **No load characterisation.** `getHistory` issues ~6 queries and is fine at 17 units. A unit
   with 20 tenancies and 200 rent periods is untested — plausible after two years of backfill.
4. **UI verified by DOM assertion, not visually.** Content and behaviour were checked in the
   browser; there is no screenshot baseline, so a purely visual regression would pass.
5. **Building-level leases not fixtured.** They are excluded from unit history by construction
   (the query is keyed on `unitId`), but there is no fixture proving a building-level lease
   never leaks onto a unit timeline.
6. **R23 commission is not represented in B-DELTA.** It was verified end-to-end separately
   during its own build, but no permanent fixture exercises the three bases. Worth adding when
   Q12 settles which basis Prime actually uses.

---

## Recommendations

1. **Add a test database to CI** and run `qa-unit-history-check.ts` on every PR touching
   leases, units or sales. It caught a real defect on its first run.
2. **Run the SOLD-with-ACTIVE-lease query against production** before the client call. Whether
   the $386k is real AR or 92 invoices that need voiding is a business question, and it is the
   most consequential thing this pass turned up.
3. **Close R4** (Q1 is the only blocker). H-10 will then be re-purposeable from "reproduces the
   defect" to "proves the conversion terminates the lease".
4. **Extend B-DELTA when H2 lands** — historical/backfilled records are a whole new class of
   history state, and the fixture building is the natural home for them.
5. **Re-run after any change to the rent generator.** The H-05 and H-06 assertions cover the
   two places where date arithmetic and money arithmetic meet, which is where this subsystem
   is most likely to break quietly.

---

## Test totals after this pass

```
Unit tests (mocked Prisma) : 546 passing  (24 suites)
Integration (live DB)      :  69 passing  (17 fixture units)
```
