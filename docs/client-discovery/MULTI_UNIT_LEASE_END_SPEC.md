# Multi-unit lease: per-unit outcomes when the lease ends

**Date:** 2026-09-12
**Status:** Draft spec. **Blocked on Q1 and Q2** (§5).
**Raised by:** client, 2026-09-12 — *"option if lease end then i want option for unit can end of
2 unit and sold to other business and 1 unit can start new lease other customise end lease"*.
**Companion to:** `UNIT_RESALE_AND_OWNERSHIP_ERAS_SPEC.md` (2026-09-11), which this depends on
for the money question. **Do not build this before that spec's Q1 is answered.**

---

## 1. The scenario

One lease covers three units — 104, 105, 106. The lease ends. Three different things then
happen to the three units:

- **104, 105** → sold to another business.
- **106** → let to a new tenant.

Today there is no single action that expresses this. The lease is ended, and then each unit has
to be driven separately by hand, with nothing recording that the three outcomes were one event.

---

## 2. Decision already taken (2026-09-12, client)

A lease spanning several units keeps the units **separate and linked** — it does NOT merge them
into one new unit via `UnitsService.combine()`.

This was chosen specifically because of this scenario. Under a true merge, 104/105/106 would be
archived behind a single unit "104-106", and selling two of them afterwards would require an
un-combine operation that **does not exist** and would have to be built. Keeping them separate
means each unit already has its own identity, its own sale, and its own next lease.

The rent-history importer now implements this: a `"104, 105, 106"` cell expands into one tenancy
per unit, tied by a shared `combinedDealRef`, with the rent divided across them.

---

## 3. What is already built

Because the units stay separate, most of the machinery exists:

| Need | Status |
|---|---|
| One lease record per unit, linked as a group | **Built** — `Lease.combinedDealRef`, indexed |
| End a tenancy with a reason + deposit disposition | **Built** — `LeasesService.endTenancy`, `POST /leases/:id/end-tenancy` |
| Sell a unit to a third party | **Built** — `Sale`, `buyerType: THIRD_PARTY` |
| Sell to the sitting tenant | **Built** — `buyerType: SITTING_TENANT`, ends tenancy as `TENANT_BOUGHT` |
| Start a new lease on a freed unit | **Built** — ordinary lease create; `lease_unit_no_overlap` keeps the dates honest |
| Chronological unit history | **Built** — `UnitStatusEvent` + `UnitHistoryService` |

**So this is mostly an orchestration and UI gap, not a data-model gap.**

## 4. What is actually missing

**4.1 `combinedDealRef` is invisible.** It is written by the importer and stored on every lease,
but it is not read anywhere in `apps/web/src` except the import column mapper. A three-unit lease
therefore shows up as three unrelated leases on three unit pages. Nothing tells a user they are
one deal, and ending one of them says nothing about the other two.

*This is the foundation. Nothing else in this spec is worth building first.*

**4.2 No group-level end action.** `endTenancy` takes one lease id. Ending a three-unit deal
means three calls, three chances to use a different move-out date, and no record that they were
one decision.

**4.3 No per-unit outcome at the point of ending.** Even with a group action, the outcome has to
be chosen per unit — ended / sold / re-let — and today the end-tenancy form has one shape for
all of them.

**4.4 The money question is unanswered.** Two of the three units are sold to another business.
Whether Prime keeps collecting anything on them afterwards, and what happens to a deposit held
against a three-unit deal when only one unit is retained, are open — see §5.

---

## 5. Blocking questions for Prime

**Q1 — the deposit.** One deposit was held for the whole three-unit deal. When 104 and 105 are
sold and 106 is re-let, what happens to it? Options: refund in full; transfer the whole balance
to the new 106 tenant; apportion it (by rent share? by sqft?) and refund the sold units' share.
*Nothing can be built until this is decided — it is the one number that cannot be guessed.*

**Q2 — must the outcomes share one date?** Is the end of a multi-unit lease a single event on a
single date, with the sale and the new lease starting from it — or can 104/105 end in March and
106 run on to June under the same original lease? This decides whether the group end is one
action or a per-unit one.

**Q3 — partial end.** Can two units of a three-unit lease be released while the lease *continues*
on the third at a reduced rent, or does ending it always end the whole deal and start a new lease
on 106? This changes whether rent has to be re-apportioned mid-term.

**Q4 — carried from the companion spec.** If Prime later brokers a lease on a unit it has sold
(the sold → leased → sold case), whose rent is it? Still blocking in
`UNIT_RESALE_AND_OWNERSHIP_ERAS_SPEC.md` §Q1, and it governs 104/105 after the sale here.

---

## 6. Proposed build, once Q1–Q3 are answered

**Phase 1 — make the group visible** (no new questions needed; safe to start).
- Surface `combinedDealRef` on the unit and lease views: "part of a 3-unit lease with 104, 105".
- An API read that returns a deal group by ref.

**Phase 2 — group end with per-unit outcomes.**
- `POST /leases/deal/:ref/end` taking a move-out date and, per unit, one of
  `ENDED` / `SOLD` / `RE_LET`.
- Runs the existing `endTenancy` per lease inside one transaction, applying the deposit rule
  from Q1, and writes one audit event naming the whole group.
- `SOLD` hands off to the existing sale flow rather than re-implementing it.

**Phase 3 — the follow-on records.**
- Pre-fill a sale draft for each `SOLD` unit and a lease draft for each `RE_LET` unit, so the
  three outcomes are completed from one screen instead of three.

---

## 7. Deliberately not in scope

- **Un-combining merged units.** No `split()` exists, and under the 2026-09-12 decision none is
  needed. If a true merge is ever adopted, this spec does not cover unwinding it.
- **Re-apportioning rent mid-term** — depends on Q3.
