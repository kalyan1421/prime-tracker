# Sale Payment Schedule — Design Brainstorm

**Status:** Brainstorm → converging
**Date:** 2026-05-30
**Scope:** 🔴 HIGH item B from `UPDATE_PLAN.md`. Coupled to the Interior module (per INTERIOR_MODULE_DESIGN §0.1 — the per-sqft TI charge is one of these installments).
**Grounded against:** `Sale` model + `SalesService` (event bus `sale.statusChanged`, atomic unit-status flip on close), `scheduled-notifications.service` (daily 8AM CT cron), `DrawSchedule`↔`Milestone` link (the existing "schedule tied to milestones" pattern to mirror), `NotificationType` enum.

---

## 1. Problem framing

Client (Sheet 2 Q16): *"After the contract is signed, do clients pay in installments linked to construction
milestones?"* → **Yes.** Today `Sale` stores only `salePrice` + `depositAmt` — a single number. There is no
representation of *when* money is due, *how much* of it has arrived, or *what triggers* each installment.

This is not just a data-entry gap. It's the missing **inflow side of the cashflow forecast** the founder asked
for ("budget needed for next two/four weeks", "cashflow projection — when money comes in vs goes out"). The
existing `cashflow` module computes a forecast but has no real sale-installment inflows feeding it. So this
feature is the keystone that makes the cashflow projection actually true.

**The real job:** *When a sale is signed, I want to schedule the buyer's installments against milestones, so I
can (a) chase overdue payments and (b) see real money-in dates on the cashflow.*

---

## 2. The central design tension

Client said installments are **"linked to construction milestones."** That's the crux — and it has a trap.

- **If a payment's due-date IS a milestone**, then when the milestone slips, the payment date should slip too —
  powerful, automatic, matches reality.
- **But** not every installment is milestone-driven. The *deposit* is on signing (a date). The *interior/TI*
  charge may be on fit-out completion. Some clients negotiate flat calendar dates.

So a payment needs to support **both** a fixed `dueDate` AND an optional `milestoneId` trigger — not one or the
other. This mirrors exactly what the codebase already does for the *outflow* side: `DrawSchedule` has a
`plannedDate` **and** `linkedMilestones`. **Reuse that mental model** so the team (and the cashflow engine)
sees inflows and outflows as symmetric.

---

## 3. Options for the model (decomposition)

### Option A — `SalePayment` child table (recommended; matches UPDATE_PLAN + Sheet 8 Q5)
```prisma
enum SalePaymentStatus { SCHEDULED  DUE  PARTIALLY_PAID  PAID  OVERDUE  WAIVED }

enum SalePaymentTrigger { ON_SIGNING  ON_MILESTONE  FIXED_DATE  ON_HANDOVER }

model SalePayment {
  id            String   @id @default(cuid())
  saleId        String
  sale          Sale     @relation(fields: [saleId], references: [id], onDelete: Cascade)
  label         String              // "Deposit", "Foundation draw", "TI / interior", "Handover"
  sequence      Int                 // ordering in the schedule
  trigger       SalePaymentTrigger  @default(FIXED_DATE)
  // Either a fixed date OR a milestone trigger (service enforces ≥1). When the
  // milestone completes, effectiveDueDate is stamped from milestone.completedAt.
  dueDate       DateTime?
  milestoneId   String?
  milestone     Milestone? @relation(fields: [milestoneId], references: [id], onDelete: SetNull)
  amount        Decimal  @db.Decimal(14,2)        // fixed amount...
  percentOfPrice Decimal? @db.Decimal(5,2)        // ...or % of salePrice (compute amount)
  paidAmount    Decimal  @default(0) @db.Decimal(14,2)
  paidAt        DateTime?
  status        SalePaymentStatus @default(SCHEDULED)
  // Links this installment to the interior project when it's the TI charge (INTERIOR §0.1)
  interiorProjectId String?
  notes         String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```
- ➕ Flexible schedule (N installments), partial payments, milestone-linked or fixed.
- ➕ Feeds cashflow as discrete inflow rows.
- ➕ Symmetric with `DrawSchedule` (outflow) — reuse the milestone-link UX/engine.
- ➖ One more table + a new tab.

### Option B — Installment fields on `Sale`
- ➖ Only works for fixed 2–3 installment deals; can't model milestone triggers or partial payments. Sheet 8 already flagged this as the weak option. **Reject.**

### Option C — Reuse `DrawSchedule` generalized to inflows
- Tempting (symmetry!) but `DrawSchedule` is loan-anchored (`loanId` required, `drawNumber` unique per loan). Bending it to sales would muddy a clean financial model. **Reject** — instead *mirror its shape* in a dedicated table.

**Recommendation: Option A.**

---

## 4. Workflow & automation (where this earns its keep)

```
Sale → UNDER_CONTRACT/CLOSED
   │
   └─ create schedule (manual, or seeded from a template: e.g. 10% signing / milestone draws / 10% handover)
         │
   each SalePayment:  SCHEDULED ──(due date reached or milestone completes)──▶ DUE ──(payment logged)──▶ PAID
                                                                                 └──(past due)──▶ OVERDUE
```

Three automation hooks, all reusing existing infrastructure:

1. **Milestone completion → stamp payment due-date.** When a `Milestone` with linked `SalePayment`s completes,
   set those payments' `effectiveDueDate` and flip to `DUE`. Mirror of the existing milestone→DrawRequest
   auto-draft (`Milestone.linkedDrawScheduleId`). *This is the "linked to construction milestones" feature
   the client literally asked for.*
2. **Daily cron → overdue detection + notify.** Extend `scheduled-notifications.service` (already runs 8AM CT,
   already does overdue-milestone / lease-expiry / loan-maturity). Add `checkOverduePayments()`. New
   `NotificationType.PAYMENT_OVERDUE` (+ optional `PAYMENT_DUE_7`). Recipients: Sales head + Finance + Founder
   (matches "who is notified when a sale closes" answer).
3. **Cashflow inflows.** `cashflow.getForecast` gains sale-installment inflows (by `effectiveDueDate || dueDate`,
   amount minus paidAmount). This is what makes the founder's "money in vs out for next 2/4 weeks" real.

---

## 5. Assumption stress-test (the sparring part)

| Assumption in my draft | Confidence | Risk if wrong |
|---|---|---|
| Installments are milestone-linked | **High** — client said yes explicitly | If actually calendar-only, the milestone-link engine is wasted. Mitigated: model supports both. |
| Deposit/signing is just the first SalePayment | Med | Client already has `Sale.depositAmt`. **Decision needed:** does deposit become a SalePayment row, or stay a separate field? (I lean: migrate it into the schedule as the ON_SIGNING row so cashflow sees it; keep `depositAmt` as a denormalized convenience.) |
| Partial payments happen | Med | Commercial draws often arrive partial. `paidAmount` vs `amount` covers it cheaply — keep it. |
| % or fixed amount both needed | Med | Templates ("10% / 40% / 50%") want %; ad-hoc wants fixed. Supporting both is cheap; do it. |
| Refund/penalty on cancel belongs here | **Low / out of scope** | That's the Sale *cancellation flow* (UPDATE_PLAN item 11). Keep separate — don't scope-creep. |

**Riskiest assumption:** that Sales will actually *maintain* the schedule. If it's tedious, they'll keep using
Excel and the cashflow stays fictional. **Mitigation: schedule templates** so a typical deal is 2 clicks, not
8 rows of manual entry. The template is the adoption lever, not a nice-to-have.

---

## 6. UI placement

- **Primary:** a **payment-schedule panel inside the Sale detail** (Revenue tab → Sales, or the sale modal).
  Shows installments, status chips (reuse the comment/status chip pattern), "Log payment" action, % paid bar.
- **Cross-cutting:** overdue payments surface in the existing **`ExceptionFeed`** (already on the Overview tab
  and dashboards) — no new page needed. This is the cheap, high-visibility win.
- **Finance dashboard:** "upcoming receivables (next 2/4 weeks)" widget fed by the same data — directly answers
  the founder's stated report need.

---

## 7. Build slices

- **Slice 1:** `SalePayment` model + enums + CRUD under the sale + manual schedule entry + % paid display.
- **Slice 2:** milestone-link trigger + auto due-date stamping on milestone completion (reuse event bus).
- **Slice 3:** overdue cron + `PAYMENT_OVERDUE`/`PAYMENT_DUE_7` notifications + ExceptionFeed surfacing.
- **Slice 4:** schedule templates (10/40/50 etc.) + cashflow inflow integration + receivables widget.

---

## 8. Decisions needed

1. **Deposit handling** — fold `Sale.depositAmt` into the schedule as the ON_SIGNING row (recommended), or keep separate?
2. **Schedule templates** — what are Prime's 1–2 standard installment structures? (Needed for Slice 4 / adoption.)
3. **Who logs payments** — Finance/Accounting only, or Sales too? (Drives `payment:edit` permission.)
4. **Cancellation refund/penalty** — confirm it stays in the separate cancellation-flow item, not here.
5. **Auto-create schedule on which status** — at `UNDER_CONTRACT` or `CLOSED`? (Client: "after the contract is signed" → UNDER_CONTRACT.)

---

## 9. Coupling notes

- **Interior module (§0.1):** the TI/interior installment is a `SalePayment` with `interiorProjectId` set,
  triggered `ON_HANDOVER` of the interior project. Build these two together.
- **Cashflow module:** this is the inflow source the forecast currently lacks — highest-leverage integration.
- **Broker model (next):** broker commission could become an *outflow* `SalePayment`-sibling on close, but
  that's the Broker item — note the symmetry, don't merge.
