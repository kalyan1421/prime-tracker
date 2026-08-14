# Prime Tracker — Client Decision Questions

Prepared 2026-08-14. These are the product-policy decisions needed before the
next sales, leasing, and project-status edge cases are built.

Priority key: Blocking = cannot build safely without answer. Important = affects
money, reporting, or workflow accuracy.

---

## 1. Project Archiving

**Priority:** Blocking

**Question:** When a project is archived, should the archive cascade to its
buildings, units, sales, leases, and related records?

**Why this matters:** Today, archiving hides only the project. Child records can
remain visible and operational in inventory, reports, sales, and leasing views.

**Decision options:**

| Option | Meaning |
|---|---|
| Archive project only | Only the project is hidden; child records remain live. |
| Cascade archive visibility | Project and child records are hidden from normal active views, but history remains intact. |
| Cancel project | Project status becomes `CANCELLED` and active workflows are stopped. |

**Recommended default:** Treat archive as a visibility action, not a business
cancellation. Archive should cascade in normal views, but should not automatically
change status to `CANCELLED`.

**Client answer needed:**

1. Should archive cascade to child records in normal active views? Yes / No
2. Should archiving automatically change project status to `CANCELLED`? Yes / No
3. If no, should there be a separate "Cancel Project" action? Yes / No

---

## 2. Lead Conversion Likelihood

**Priority:** Important

**Question:** Do the built-in lead-to-sale likelihoods match how Sales reads the
funnel?

**Current assumption:** A brand-new lead has low likelihood, roughly 5%, rising
up to roughly 75% once negotiating.

**Why this matters:** These numbers directly drive the campaign ROI dashboard.
If the likelihoods are wrong, campaign ROI will look artificially high or low.

**Decision needed:** Confirm or replace the probability for each stage.

| Lead stage | Proposed probability |
|---|---:|
| New | 5% |
| Contacted | 10% |
| Qualified | 25% |
| Tour / Site Visit | 40% |
| LOI / Proposal | 55% |
| Negotiating | 75% |
| Won / Converted | 100% |
| Lost | 0% |

**Recommended default:** Make these admin-configurable rather than hardcoded,
with Prime's confirmed numbers as the default.

**Client answer needed:**

1. Are these stages correct? Yes / No
2. Are these probabilities correct? Yes / No
3. If not, what percentage should each stage use?

---

## 3. Holdover Rent

**Priority:** Important

**Question:** Confirm holdover rent one more time: should a tenant who overstays
after lease expiry be billed at the same rent by default?

**Current instruction implemented:** Same rent by default.

**Why this matters:** The typical US retail norm is often 125% to 150% of rent
for holdover periods, specifically to discourage overstaying. If Prime wants
that policy, billing at the same rent will undercharge holdover tenants.

**Decision options:**

| Option | Meaning |
|---|---|
| Same rent | Holdover tenant continues at existing rent. |
| 125% rent | Holdover is billed at 1.25x normal rent. |
| 150% rent | Holdover is billed at 1.5x normal rent. |
| Per lease | Each lease has its own holdover rate. |

**Recommended default:** Use "per lease" with a default multiplier chosen by
Prime. If Prime does not specify one, keep same rent only as a conscious policy.

**Client answer needed:**

1. What default holdover rate should the system use?
2. Should users be allowed to override this per lease? Yes / No

---

## 4. Lease Commission Clawback

**Priority:** Important

**Question:** If a lease ends early, is any previously stamped broker commission
recoverable?

**Current behavior:** A `TOTAL_TERM_RENT` commission is stamped on activation
from the full lease term. If a 60-month lease ends in month 6, the full-term
commission remains recorded unless Finance handles it outside the system.

**Decision options:**

| Option | Meaning |
|---|---|
| No clawback | Commission is fully earned at activation. |
| Prorated clawback | Unearned commission is recoverable based on remaining lease term. |
| Clawback window | Recover only if lease ends within a defined period, e.g. first 6 or 12 months. |
| Case-by-case | System flags it, Finance decides manually. |

**Recommended default:** Case-by-case with a calculated suggested clawback, then
Finance approval before any financial movement is recorded.

**Client answer needed:**

1. Does Prime claw back commission on early lease termination? Yes / No
2. If yes, what formula or window should apply?
3. Should Finance approve clawback amounts before posting? Yes / No

---

## 5. Deposit Refund / Forfeit

**Priority:** Important

**Question:** When a deposit is marked refund or forfeit, should Prime Tracker
only record the decision, or should it create the financial movement?

**Current behavior:** The system records the refund/forfeit decision and leaves
the money movement to Finance.

**Decision options:**

| Option | Meaning |
|---|---|
| Record only | Prime Tracker stores the decision; Finance moves money elsewhere. |
| Create finance event | Refund creates payable; forfeiture creates income/offset. |
| QuickBooks handoff | Prime Tracker records decision and pushes/syncs to QuickBooks once integration is live. |

**Recommended default:** Record the decision now, but create a finance event that
Finance can approve/export later. Add partial refund support if Prime uses it.

**Client answer needed:**

1. Should deposit decisions create financial entries in Prime Tracker? Yes / No
2. Is partial refund needed? Yes / No
3. Should Finance approve before money movement is treated as complete? Yes / No

---

## 6. Sale Cancellation Money Handling

**Priority:** Blocking

**Question:** When a sale with paid installments is cancelled, what happens to
money already paid by the buyer?

**Why this matters:** Paid installment money cannot disappear from the workflow.
It must be refunded, forfeited, netted against another obligation, or explicitly
left for Finance decision.

**Decision options:**

| Option | Meaning |
|---|---|
| Refund | Buyer is owed money back. |
| Forfeit | Prime keeps all or part of the paid amount. |
| Net | Paid amount is netted against a penalty, transfer, or other obligation. |
| Case-by-case | Finance decides per cancelled sale. |

**Recommended default:** Case-by-case, with required Finance outcome fields:
refund amount, forfeited amount, penalty amount, net amount, reason, approver,
and decision date.

**Client answer needed:**

1. Is there a default policy for cancelled sale payments? Refund / Forfeit / Net / Case-by-case
2. If forfeiture or penalty applies, who approves it?
3. Should the sale remain blocked from final cancellation until Finance records the money outcome?

---

## 7. Reopening Cancelled Sales

**Priority:** Blocking

**Question:** Should a cancelled sale ever be reopened?

**Why this matters:** Reopening a cancelled sale can revive old payments,
discounts, broker terms, document status, and unit reservations. That should not
happen silently.

**Decision options:**

| Option | Meaning |
|---|---|
| Never reopen | Cancelled sales are final; create a new sale if the buyer returns. |
| Reopen with approval | Founder/Finance approval required, with audit reason. |
| Reopen only before refund/forfeit | Reopen allowed only if Finance has not finalized cancellation money handling. |

**Recommended default:** Allow reopening only with Founder approval, an audit
reason, and validation of unit availability and payment status.

**Client answer needed:**

1. Can a cancelled sale be reopened? Yes / No
2. If yes, who can approve reopening?
3. Should reopening be blocked after refund/forfeit has been finalized?

---

## 8. Buyer Unit Swap After LOI / Contract

**Priority:** Blocking

**Question:** If a buyer wants to switch to a different unit after signing an
LOI or contract, is that a cancel-and-restart, or should the existing sale carry
forward to the new unit?

**Why this matters:** A naive update like `sale.unitId = newUnitId` creates
serious issues:

- The old unit can stay stuck in `UNDER_CONTRACT`.
- Percent-of-price installments become wrong if the new unit has a different
  price.
- A discount approval for the old unit can accidentally become approval for a
  more expensive unit.

**Decision options:**

| Option | Meaning |
|---|---|
| Cancel and restart | Existing sale is cancelled; a new sale is created for the new unit. |
| Transfer sale | Buyer, broker, documents, and payments carry to the new unit with controlled recalculation. |
| Transfer only before contract | Unit swap allowed at LOI stage, but contract-stage swaps require cancel/restart. |

**Recommended default:** Support a controlled sale unit transfer. Record a
`SaleUnitTransfer` history event with from-unit, to-unit, effective date, old
price, new price, reason, actor, and whether discount re-approval was required.

**Client answer needed:**

1. Should unit swaps be allowed after LOI? Yes / No
2. Should unit swaps be allowed after contract? Yes / No
3. Should this be a transfer of the same sale, or cancel-and-restart?

---

## 9. Discount Approval During Unit Swap

**Priority:** Blocking

**Question:** Does discount approval survive a unit swap to a more expensive
unit?

**Why this matters:** A Founder approval may mean "yes, 12% off Unit 101 at
$800k." Carrying that approval to Unit 205 at $1.1M turns a specific approval
into a broader discount authority.

**Recommended rule for confirmation:** Discount approval carries only if the
discount percentage on the new unit is less than or equal to the previously
approved percentage. If the new discount percentage is higher, clear the approval
and require Founder approval again.

**Client answer needed:**

1. Should discount approval carry to the new unit if the discount percentage is unchanged or lower? Yes / No
2. Should discount approval be cleared if the new discount percentage is higher? Yes / No
3. Should a more expensive unit always require re-approval even when the percentage is unchanged? Yes / No

---

## 10. Payments During Unit Swap

**Priority:** Important

**Question:** When a sale transfers to another unit, should payment schedule
rows be rebased to the new unit price, or recreated from scratch?

**Recommended rule for confirmation:** Rebase, do not recreate. Keep existing
installment rows and their `paidAmount`. Recompute unpaid installment amounts
for rows based on percent of price. If recomputation affects an already-paid row,
flag it for human review instead of silently restating history.

**Why this matters:** Existing payments are real financial history. Recreating
them can break auditability, while silently changing paid rows can hide over- or
under-collection.

**Client answer needed:**

1. Should existing paid installment history carry across a unit swap? Yes / No
2. Should unpaid percent-of-price installments be recalculated against the new unit price? Yes / No
3. If a paid row becomes over- or under-collected after the swap, should Finance manually resolve the difference? Yes / No

---

## 11. Sale of a Tenanted Unit

**Priority:** Blocking

**Question:** When a unit with an active tenant is sold, is the buyer always the
sitting tenant?

**Current assumption:** Closing a sale ends the active lease, which assumes the
tenant bought the unit.

**Why this matters:** If Prime sells a tenanted unit to an outside investor, the
lease should survive the sale. The buyer changes, but the tenant and lease may
remain active.

**Decision options:**

| Option | Lease behavior |
|---|---|
| Sitting tenant buys | Lease ends or converts at sale close. |
| Outside investor buys | Lease remains active and survives sale. |
| Both paths | User must choose buyer type when closing the sale. |

**Recommended default:** Support both paths with an explicit buyer type:
`SITTING_TENANT`, `OUTSIDE_INVESTOR`, or `OTHER`.

**Client answer needed:**

1. Does Prime ever sell tenanted units to outside investors? Yes / No
2. If yes, should the lease remain active after sale close? Yes / No
3. Should every sale close require choosing whether the buyer is the tenant or an outside investor?

---

## Highest-Priority Answers Needed

1. Should project archive cascade, and should it change status to `CANCELLED`?
2. What default holdover rent multiplier should be used?
3. What happens to paid installment money when a sale is cancelled?
4. Can a cancelled sale be reopened?
5. Should unit swap be a controlled transfer or cancel-and-restart?
6. Does discount approval survive a unit swap to a more expensive unit?
7. Can Prime sell a tenanted unit to an outside investor while preserving the lease?
