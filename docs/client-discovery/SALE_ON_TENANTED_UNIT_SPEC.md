# Closing a sale on a tenanted unit

**Status:** Draft for client sign-off
**Date:** 2026-08-14
**Supersedes:** the "sitting tenant always bought" assumption in `EDGE_CASE_FIX_PLAN.md` Phase A
**Related:** `UNIT_HISTORY_AND_LEASE_TO_SALE_SPEC.md`, `TENANCY_AND_RENT_FLOWS.md`

---

## Problem statement

When a sale closes on a unit that has a sitting tenant, Prime Tracker **ends that tenancy
silently** — it deletes the remaining rent schedule, voids future invoices, stamps the
reason as "tenant bought", and leaves the security deposit unresolved. None of this is
shown, confirmed, or asked about: closing a sale is an ordinary status change on a form
that never mentions a tenant.

The assumption behind it — that the sitting tenant is always the buyer — was recorded as a
v1 shortcut on 2026-08-13. It is wrong often enough to matter: an investor buying a leased
retail unit is routine, and in that case the tenancy is precisely what is being bought.

**Who it affects.** Sales (closes the deal), Finance (owns the deposit and the ledger), and
the tenant (whose rent schedule disappears while they are still in occupation).

**Cost of not solving it.** Five defects confirmed by code review on 2026-08-14, all
reachable today:

| # | Defect | Consequence |
|---|---|---|
| 1 | `endedLeaseId` captured but never emitted | Ending a tenancy via a sale notifies **nobody**. The same act done by hand does notify — so the alert depends on which door was used. |
| 2 | A DRAFT future lease outranks the sitting one | A drafted renewal **blocks the sale from closing at all**, with an error naming a date nobody typed. |
| 3 | Deposit defaults to `DECIDE_LATER` with no flag | A £/$ deposit sits PENDING against a dead lease on a sold unit. No task, no notification, no owner. |
| 4 | `TENANT_BOUGHT` hardcoded for any sitting lease | A third-party sale **destroys a live tenancy**: schedule deleted, invoices voided, tenant still in occupation and still owing rent. |
| 5 | No UI warning | The destructive half of the operation is invisible until after it has happened. |

Defect 4 is the serious one: it is unrecoverable data loss driven by an assumption the user
was never asked to confirm.

---

## Goals

1. **No tenancy ends without someone saying so.** Closing a sale on a tenanted unit
   requires an explicit answer to "what happens to the tenant" — zero silent terminations.
2. **Support the third-party sale.** A tenanted unit can be sold with the tenancy intact,
   which is currently impossible without data loss.
3. **Every deposit reaches a decision.** No security deposit is left unresolved on a lease
   that a sale terminated — measured as zero PENDING deposits on SOLD units.
4. **Tell the people who own the consequences.** Finance hears that a tenancy ended and a
   deposit needs settling, on the same footing as a manual end-tenancy.
5. **Close is never blocked by a drafted lease.** Drafting a renewal ahead of completion is
   normal practice and must not fail the sale.

---

## Non-goals

1. **Rent apportionment between seller and buyer at completion.** Real, and standard in
   conveyancing, but it is a settlement calculation rather than a tenancy decision. Separate
   spec.
2. **Assigning the lease to the buyer as landlord.** When a tenancy survives a third-party
   sale the freehold changes hands, not the lease. Prime stops managing it; modelling the new
   landlord is a portfolio-boundary question, out of scope here.
3. **Refund mechanics.** Deciding a deposit is refundable is in scope; moving the money is
   Finance's existing obligation ledger and needs nothing new.
4. **Building-level sales.** A sale attached to a Building, not a Unit, has no single
   tenancy to reason about. Deliberately unchanged.
5. **Retro-fixing units already sold with a live lease.** The 8 found in dev are test data
   (client-confirmed). Production is covered by `audit-unit-lease-consistency.sql`, which is
   a data exercise, not a feature.

---

## User stories

**Sales — the person closing the deal**

- As a salesperson, I want to be told a unit has a sitting tenant **before** I close the
  sale, so that I do not discover the consequences afterwards.
- As a salesperson, I want to say whether the **tenant** or a **third party** bought it, so
  the record matches what actually happened.
- As a salesperson, I want the sale to close even when a renewal has been drafted, so that
  ordinary practice does not block a completion.

**Finance — the person who owns the money**

- As a Finance user, I want to be told when a sale ends a tenancy, so that I learn about it
  from the system rather than from the salesperson.
- As a Finance user, I want the deposit's fate recorded at the moment the sale closes —
  refunded, forfeited, or credited against the purchase — so that no deposit is left held
  against a lease that no longer exists.
- As a Finance user, I want "decide later" to be a **tracked** state with an owner, not the
  silent default it is today.

**Whoever reads the record afterwards**

- As anyone opening the unit later, I want its history to say whether the tenant bought it
  or a landlord changed, because those are different events with different consequences.

---

## Requirements

### P0 — must have

**R1. The close dialog asks, when and only when there is a sitting tenant.**

A unit with no live lease closes exactly as it does today. No new friction on the common case.

- [ ] Given a sale being set to CLOSED on a unit with a live lease, when the user confirms,
      then a dialog names the tenant, the lease end date, and the rent still scheduled.
- [ ] Given a unit with no live lease, when the sale is closed, then no dialog appears.
- [ ] The dialog states, in words, what will happen to the rent schedule and the invoices.

**R2. Who bought it — an explicit choice, no default.**

| Choice | What happens to the tenancy |
|---|---|
| **The sitting tenant bought it** | Tenancy ends at completion. Reason `TENANT_BOUGHT`. Schedule capped, future invoices voided. (Today's behaviour, now chosen rather than assumed.) |
| **A third party bought it** | **Tenancy survives.** Nothing is capped, nothing is voided. The lease is marked as no longer managed by Prime from the completion date. |

- [ ] Neither option is pre-selected. The dialog cannot be submitted without one.
- [ ] Choosing "third party" leaves `LeaseRentPeriod` and `LeaseRentInvoice` rows untouched
      — verified by an integration test, because this is the data-loss case.
- [ ] The choice is recorded on the sale, not inferred later from the lease.

**R3. The deposit is settled, or explicitly deferred to a named owner.**

Reuses the existing `depositDisposition` vocabulary (`REFUND` / `FORFEIT` / `TRANSFER` /
`DECIDE_LATER`) plus one new option:

- [ ] `CREDIT_TO_SALE` — the deposit is netted against the purchase price. This is the
      commonest outcome when the tenant buys, and today has no representation at all.
- [ ] `DECIDE_LATER` remains available but is no longer silent: it raises a task assigned to
      Finance, titled with the unit and the amount held.
- [ ] Given a lease with no deposit obligation, when the sale closes, then no deposit
      question is asked.

**R4. The sitting-tenant lookup finds the tenancy in occupation.**

- [ ] Given a unit with an ACTIVE lease and a DRAFT lease starting later, when the sale
      closes, then the ACTIVE lease is the one acted on.
- [ ] Given a drafted future lease on a unit being sold, then the user is told it exists and
      asked what to do with it — it cannot simply be ignored, because a lease drafted for a
      unit Prime no longer owns is a commitment nobody can honour.
- [ ] The close is never blocked by the presence of a drafted lease.

**R5. Notify on the same footing as a manual end-tenancy.**

- [ ] Given a sale that ends a tenancy, when the transaction commits, then `lease.terminated`
      is emitted — after commit, never before.
- [ ] Given a transaction that rolls back, then no notification is sent.
- [ ] Given a deposit left as `DECIDE_LATER`, then Finance is notified separately from the
      tenancy-ended event; they are different actions for different people.

**R6. The unit's history distinguishes the two endings.**

- [ ] A tenant-bought sale reads as one continuous story: tenancy ended because they bought.
- [ ] A third-party sale reads as a landlord change with the tenancy continuing.

### P1 — should have

- **R7.** Show the deposit balance and the remaining scheduled rent **inside** the dialog, so
  the decision is made against the numbers rather than from memory.
- **R8.** Where rent has been collected for months after completion, offer the apportionment
  figure as a suggestion rather than the hard refusal `endTenancy` gives today.
- **R9.** A cancelled sale that had ended a tenancy should surface what it did, so that
  reversing the sale does not silently leave the tenancy dead.

### P2 — future, design for but do not build

- **R10.** Rent apportionment at completion (non-goal 1) will need the completion date and
  the paid-through date, both of which this flow already has. Do not shape the dialog in a
  way that makes adding a computed figure awkward.
- **R11.** If Prime ever sells a *portfolio* of tenanted units, the choice in R2 becomes a
  per-unit answer inside a bulk action. Keep the decision on the sale row, not in dialog
  state, so a bulk path can reuse it.

---

## Success metrics

**Leading (first 30 days)**

| Metric | Target | How measured |
|---|---|---|
| Silent tenancy terminations | **0** | Terminations with reason `TENANT_BOUGHT` and no recorded user choice |
| Sales blocked by a drafted lease | **0** | Failed CLOSE attempts with a lease-start error |
| Deposits PENDING on a SOLD unit | **0** | `audit-unit-lease-consistency.sql`, extended with a deposit bucket |
| Dialog completion rate | **>95%** | Opened vs submitted — a lower figure means it is asking the wrong things |

**Lagging (first quarter)**

- Third-party sales recorded **without** a tenancy being destroyed: the count going above
  zero is the proof this was a real gap, not a theoretical one.
- Finance reporting no unexplained deposits at quarter-end close.

---

## Open questions

**Blocking — needed before build starts**

1. **Does Prime sell tenanted units to third parties today, or is every sale to the sitting
   tenant?** *(Client / Sales.)* If it is always the tenant, R2's second branch drops to P2
   and this becomes a much smaller piece of work. Everything else in the spec stands either
   way. **This is the one answer that changes the shape of the build.**
2. **When the tenant buys, what normally happens to the deposit — refunded, or netted off
   the price?** *(Finance.)* Determines whether `CREDIT_TO_SALE` is the default option or
   merely available.

**Non-blocking — can be settled during implementation**

3. What should happen to a lease drafted for a unit that then sells? Delete, or keep as a
   record of an intention that lapsed? *(Sales — assumption: keep it, marked lapsed, since
   deleting loses the fact that it was negotiated.)*
4. Should a third-party sale keep the unit visible in Prime's rent roll until the tenancy
   ends? *(Finance — assumption: no. Prime no longer collects the rent.)*
5. Who should the `DECIDE_LATER` task be assigned to — a named Finance user or the role?
   *(Finance.)*

---

## Timeline

No hard external deadline. Sequencing matters more than speed:

| Phase | Work | Est. |
|---|---|---|
| **1** | R4 + R5 + R1 — fix the lookup, wire the notification, add the warning. All three are defect fixes and none depend on the blocking questions. | ~1.5 days |
| **2** | R2 — the who-bought choice, including the tenancy-survives branch. **Gated on blocking question 1.** | ~2 days |
| **3** | R3 + R6 — deposit disposition and the history distinction. **Gated on blocking question 2.** | ~1.5 days |
| **4** | R7–R9 (P1) after Sales and Finance have used phase 1–3 once. | ~1 day |

**Phase 1 can start immediately** — it fixes three of the five confirmed defects and needs
no client input. Phases 2 and 3 need the two blocking answers, which is a single short
conversation with Sales and Finance together.

**Dependency:** phase 2 touches `capAtTermination` and `voidAfter`, the same code the R22
correction flow uses. Land it after the Finance walkthrough of R22, not before, so the two
are not being explained at once.
