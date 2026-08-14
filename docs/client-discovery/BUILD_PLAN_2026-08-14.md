# Build Plan — Client Decisions of 2026-08-14

Source: client answers to `QUESTIONS_FOR_PRIME_2026-08-14.md` (55 items, 8 modules).
Every item below is traced back to its question number, e.g. **S1** = Sales item 1.

Grounded in a codebase audit run 2026-08-14, not on the roadmap doc — several items the
roadmap still lists as "remaining" turned out to be built, and several assumed-built
items turned out to be stubs. What each phase says is *actually there* is verified.

Ordering is by **dependency**, not by priority. Phase N cannot start cleanly before N-1.

---

## Design principle for the three from-scratch features

Sale cancellation, unit swap and third-party sale look like three features. They are one
defect three times: **`Sale` models an event ("a unit was sold") rather than an agreement
("a buyer committed, under terms, against a unit").**

- Cancellation loses money because a sale has nowhere to record an *outcome*, only a status.
- Swap is impossible because `Sale.unitId` is a bare mutable pointer carrying no history.
- The lease dies unconditionally because "sold" and "the tenant left" are fused into one path.

The codebase has already converged on the fix **five times** — `LeaseTenantAssignment`,
`LeaseRentPeriodCorrection`, `HistoricalRecordDeletion`, `UnitStatusEvent`,
`BudgetRevision`. Every one is an **immutable transition record** rather than a mutated
field. `assignTenant` states the principle outright: *editing `Lease.tenantName` in place
is a silent rewrite of history.*

The same argument applies verbatim to `Sale`. So for all three:

> **Do not add outcome fields to `Sale`. Add transition rows that point at it.**

---

## Decisions that require NO build

Recorded so nobody re-opens them. These are confirmations, not deferrals.

| Ref | Decision |
|---|---|
| P4 | Organization membership (US/India) stays a **labelling and reporting field**. No access boundary. |
| P6 | RBAC confirmed as built: Super Admin / Founder / PM create+edit projects; Super Admin / Founder delete. |
| P8 | `Building.llcName` stays a plain text label. No entity relation, no per-LLC P&L. |
| U1 | Under Construction → Available stays a **PM judgment call**. No milestone gate. |
| U2 | The 8 unit types are correct as seeded. |
| B4 | Unit-type mixing inside a building is **intentional** for Mixed-Use. No constraint added. |
| B5 | `Building.totalSqft` need not reconcile against the sum of its units. Same logic continues. |
| F4 | Capital calls and distributions keep firing **instantly**, no second approver. |
| L4 | The marketing channel list (Meta, Google Ads, Newspaper, Broker, Email, Signage, Event, Other) covers where Prime spends. |
| L6 | Manual entry of ad spend from the agency's monthly report is **sufficient long-term**. No Meta/Google sync. |
| E15 | Normal online connectivity is acceptable. No offline/PWA work. |

---

## Phase 0 — Stabilise and ship what is already built

**Why first:** there are ~120 uncommitted files, ~10k changed lines and 14 unapplied
migrations sitting in the working tree (leases/rent/holdover, unit history, construction
board, broker commissions). Building new features on top of that makes every later phase
un-rollbackable. Both API and web typecheck clean; the blockers are six logic bugs.

### 0.1 — Land the six confirmed code-review findings

| # | File | Defect |
|---|---|---|
| 1 | `sales.service.ts:293` | Sale close terminates only the newest lease on the unit. A concurrent sitting lease keeps running on a `SOLD` unit — the exact inconsistency the code says it prevents. Reachable because `LEASED → LEASE_PENDING` was just added to support a signed successor while the tenant is still in. |
| 2 | `lease-rent-invoice.service.ts:542` | `recordPayment` / `clearPayment` / `waive` have no `VOID` guard, and `deriveInvoiceStatus` never returns `VOID`. Any of the three silently resurrects a voided invoice with `voidedAt` still set, putting it back into outstanding AR. |
| 3 | `units.service.ts:458` | `findInventory` filters only the unit's own `deletedAt`. Units under an archived project still list — and then 404 when opened, because `findById` was fixed and `findInventory` was not. **This is decision P3.** |
| 4 | `brokers.service.ts:152` | Lease-commission `groupBy` filters `status: 'ACTIVE'`, so unpaid broker commission vanishes from the report the moment the lease expires. The sale side correctly filters on `CLOSED`, a terminal state. |
| 5 | `lease-rent-period.service.ts:806` | `correctPeriod` never clears `isFreeRent`, and `summariseEffectiveRent` skips any row with it set. Rent corrected onto an abatement month is dropped from the effective-rent KPI. |
| 6 | `notifications.service.ts:606` | Holdover alert states "Rent is being billed at the holdover rate" when `holdoverRatePct` defaults to null and nothing is billed. |
| 7 | `sales.service.ts:230,297` | `endedLeaseId` is assigned and **never read** — the post-commit `lease.terminated` emit its own comment promises was never written. Ending a tenancy by closing a sale notifies **nobody**, while ending one by hand does. The alert depends on which door was used. Found via `SALE_ON_TENANTED_UNIT_SPEC.md` R5, not by the review. |

> **Cross-reference:** `docs/client-discovery/SALE_ON_TENANTED_UNIT_SPEC.md` already specifies
> this whole code path (R1–R11). Findings #1 and #7 are its R4 and R5. Note **R4 requires the
> close is _never blocked_ by a drafted future lease** — the fix is lease *selection* (act on
> the tenancy in occupation), not refusal. The "ask the user about the drafted lease" half is
> UI work belonging to that spec's own build, not to Phase 0.

### 0.2 — Verify already-built items claimed by this decision set

Audit found these **already implemented** in the uncommitted tree. Confirm and commit
rather than rebuild:

- **B1 / U3 — building and unit soft-delete.** `buildings.service.ts` now soft-deletes the
  building and archives its units in one transaction; `units.service.ts` soft-deletes
  instead of a cascading hard delete. The old behaviour permanently erased every
  Sale/Lease/Loan beneath (`onDelete: Cascade`). **Decision B1 is already satisfied.**
- **T3 — rent-period corrections (R22).** `correctPeriod` + `LeaseRentPeriodCorrection`
  + invoice `needsReview` flagging is built, behind a dedicated
  `lease:history:correct` permission. Invoices are flagged, never restated.

### 0.3 — Commit and deploy

**Correction to an earlier reading of this plan:** the 14 new migrations are **already
applied to the local dev database** — `prisma migrate status` reports 67 migrations found
and *"Database schema is up to date"*. Nothing needs running locally.

What is actually outstanding is that those migration directories
(`20260812000000_unit_status_events` … `20260814120000_task_multi_building_assignee`) are
**untracked in git**. Until they are committed, CI's `prisma migrate deploy` and the
production box have no way to apply them — the schema exists on one laptop only.

So 0.3 is: commit the migrations with the code that depends on them, in one changeset, so
the two can never arrive separately.

**Exit criteria:** clean working tree, migrations committed, all four suites green
(`test`, `test:integration`, web `test`, and a Playwright run if servers are up).

⚠️ **CI must set `CI=1`.** Without it the integration suite silently skips on a machine
with no database and still reports green — which is exactly how a dropped constraint
reaches production. GitHub Actions sets it; a local `test:all` does not.

---

## Phase 1 — Data-integrity guardrails

Small, independent, low-risk. Clears the decisions that are one-file changes.

| Ref | Item | Size | Status |
|---|---|---|---|
| P3 | Archived/deleted projects must not leak into cross-project Inventory or reports | S | ✅ **Shipped in Phase 0** as finding #3 — plus six further report queries with the same hole, the worst being `getVacancyReport`, which applied its parent filter *only* when a `projectId` was passed, so the default all-projects view listed archived units as stale inventory. |
| B3 | Delete-confirmation dialog shows full blast radius | S | **To build.** Today it reports unit count only. Extend the conflict payload to carry lease / sale / loan counts and surface them in the modal. Applies to both building and unit delete. |
| P7 | Project-team member roles restricted to a fixed list | S | **To build.** `ProjectMember.role` is a free-text `String` defaulting to `"TEAM_MEMBER"`, with a parallel `roles String[]`. Typos succeed silently. Needs a validated constant list applied to **both** fields. |
| ~~F1~~ | ~~Scope all reports to one Organization~~ | — | ❌ **VOID — see below.** |

> **F1 is cancelled. Prime is a SINGLE organization** (client, 2026-08-14). There is no US
> entity and no India entity. Verified against live data: one org, "Prime Developers", one
> project.
>
> This supersedes the earlier answer in the same round ("scope reports to US Prime only, no
> other org") — there is no other org to exclude, and reports "blending both entities" was
> never a real defect. **No org scoping is to be built into reports, dashboards or access
> control.** The `Organization` / `OrgMembership` models stay as schema for a possible future,
> but no feature branches on them.
>
> `CLAUDE.md` has been corrected — it previously asserted "multi-org is live … Prime runs US +
> India entities" in four places, which would have misled every future session. Projects Q4 in
> the question doc is now settled twice over: org membership was already labelling-only, and
> there is only one org regardless.

---

## Phase 2 — Sales money integrity

**Why here:** the refund/penalty ledger is a prerequisite for Phase 5's unit swap, which
may need to move or partially refund collected installments.

### 2.1 — S1 · Sale cancellation refund/penalty ledger 🔴 **blocking, from scratch**

**Problem.** `CancelSaleModal.tsx` collects refund and penalty amounts and
`sales.service.ts:318` throws them away — the code comment defers it as "discovery item
D18". `SalePayment` is fully built (installments, `paidAmount`, `paidAt`, milestone
triggers, `interiorProjectId` for the TI charge), so there is genuinely collected money
with no account of what became of it.

**Rejected approach.** Adding `refundAmount` / `penaltyAmount` columns to `Sale`. It is
exactly what the modal already collects, and it would appear to work while being wrong:
two loose numbers with no relationship to the money actually collected, no record of
*when* it moved, and no way to express a mixed outcome.

**Design — mirror `settleDeposit`** (`leases.service.ts:789`). That pattern is already in
the codebase and its reasoning is already done: *record a decision, do not move money;
collection status keeps meaning "what was collected".*

```
model SaleCancellation
  saleId          @unique              // one per sale
  cancelledAt, cancelledById
  totalCollected  Decimal              // SNAPSHOT at cancellation, so it cannot drift
                                       // when someone later edits a SalePayment
  disposition     REFUND | FORFEIT | NET | DECIDE_LATER
  refundAmount    Decimal @default(0)
  penaltyAmount   Decimal @default(0)
  refundPaidAt    DateTime?            // when money ACTUALLY moved
  refundReference String?              // ≠ when the decision was made
```

**The invariant is what makes this a ledger** rather than two free-text boxes:

> `refundAmount + penaltyAmount == totalCollected` whenever `disposition != DECIDE_LATER`.

Refuse the cancellation when it does not reconcile — same shape and same rationale as
`assertRentInvariant` in `lease-rent-period.service.ts`.

**Locked decisions (client, 2026-08-14):**

- ✅ **`DECIDE_LATER` is the default**, exactly like the deposit disposition. It is what
  lets someone cancel at 6pm without Finance in the room. Without it you get zeros typed
  in to clear the dialog — which is worse than no data, because it looks like a record.
- ✅ **No standing policy.** Refund / forfeit / net are all recordable outcomes decided
  per deal. Do not implement a default disposition beyond `DECIDE_LATER`.

**Deliberately NOT per-installment.** Prime refunds a *buyer*, not an installment. Per-
installment allocation is real accounting complexity for no current benefit. The
`totalCollected` snapshot is what preserves accuracy instead.

**Existing `SalePayment` rows on cancellation:** mark remaining `SCHEDULED` installments
`CANCELLED`; leave `PAID` ones untouched; never delete. `sale-payments.service.ts:250`
already behaves this way and documents why — this feature is the "separate refund
concern" that comment defers to.

### 2.2 — S5 · Wire the per-org forecast probabilities

`OrgSettings.saleStageProbabilities` exists with a JSON default of
`{PROSPECT:0.10, LOI_SIGNED:0.35, UNDER_CONTRACT:0.75, CLOSED:1.0, CANCELLED:0.0}`.
`sales-forecast.service.ts` mentions it **in a comment only** and never reads it — every
project sees the same hardcoded numbers. Size: S. Wire the read, fall back to the
default, expose it in settings.

### 2.3 — S7 · Payment-schedule templates + custom — ✅ **ALREADY BUILT, no work**

Audited 2026-08-14. Everything the client asked for exists:

| Asked for | Where it already is |
|---|---|
| 10/40/50 template | `PAYMENT_TEMPLATES['10-40-50']` — `sale-payments.service.ts:313` |
| 30/40/30 template | `PAYMENT_TEMPLATES['30-40-30']` — same block |
| Apply a template | `applyTemplate()` + `POST` route in `sales.controller.ts:120` |
| Template buttons in the UI | `SalePaymentPanel.tsx:127,130` |
| **Customise** | "Add installment" (`SalePaymentPanel.tsx:116`) → `addPayment()`, accepting either a flat `amount` or a `percentOfPrice`; plus per-row edit, delete and log-payment |

Both templates use `ON_SIGNING` / `FIXED_DATE` / `ON_HANDOVER` triggers and refuse to
apply over an existing schedule, which is the correct guard.

**D15 is closed.** The client confirmed both splits on 2026-08-14. The stale
`(Confirm with Prime — D15)` TODOs have been removed from `sale-payments.service.ts`, and
`PRD_Prime_Tracker.md` no longer lists D15 as blocking. No build.

---

## Phase 3 — Document control

Grouped because S6 and D1 are the same mechanism: a stage transition that requires a
document of a given `DocCategory` to already be attached.

| Ref | Item | Size |
|---|---|---|
| D2 | Permits, NOCs and possession certificates get **expiry dates with reminders** | M |
| S6 | `LOI_SIGNED` requires the LOI document attached first | S |
| D1 | `UNDER_CONTRACT` and `CLOSED` require their specific document (LOI, Booking Agreement) attached first | S |

**D2 detail:** no expiry field exists on `Document` today. Needs a nullable `expiresAt`,
a scheduled check in `scheduled-notifications.service.ts` alongside the existing lease and
loan checks, and a new `NotificationType`. Note the existing test asserts an **exact**
`NotificationType` count (currently 33) — bump it deliberately, and give the new type a
tier in `NOTIFICATION_TIERS` or it becomes unmutable in `getPreferences()`.

**S6 / D1 detail — ✅ built.** Canonical map in `apps/api/src/modules/sales/sale-document-gates.ts`;
`apps/web/src/components/DocumentGateChip.tsx` is the display mirror (not shared, because
`deploy-web` does not build `@prime-tracker/shared` — see Phase 1).

The map already existed on the **frontend only**, rendering a red/amber/green chip on the
pipeline board that read *"blocks advancement"* while the transition sailed straight
through. The UI had been advertising an enforcement that did not exist; this makes it true.

- **Cumulative over the rungs a transition CROSSES**, not over the sale's whole history.
  `PROSPECT → CLOSED` owes everything in between — a gate you can walk around by skipping a
  stage is not a gate. But `LOI_SIGNED → UNDER_CONTRACT` owes only the Booking Agreement, so
  sales already sitting in a stage are never retroactively trapped. For anyone moving one
  stage at a time it is a no-op.
- **Ungated:** backwards moves, `CANCELLED` (a deal dying because paperwork never arrived is
  exactly when documents are missing), same-stage no-ops, and any update that does not change
  status. `create()` is also ungated — a document attaches by `saleId`, so at creation there
  is no sale to attach to and the gate could never be satisfied.

> ### ✅ RESOLVED — the `CLOSED` list is now client-confirmed
>
> The three-document `CLOSED` requirement (`DEED`, `NOC`, `POSSESSION_CERTIFICATE`) had been
> an unconfirmed assumption inherited from the frontend chip — Prime had only ever confirmed
> LOI and Booking Agreement. It was **put to the client explicitly on 2026-08-14 and
> confirmed as built.**
>
> So: Sales cannot close a deal until all three are on file, and a `PROSPECT → CLOSED` jump
> needs five documents. That is intended, not an accident of an old default. The ⚠️ warning
> in `sale-document-gates.ts` has been replaced with the confirmation.

---

## Phase 4 — Construction control

Six items, all in modules that already exist. This is hardening, not greenfield.

| Ref | Item | What exists today | Size |
|---|---|---|---|
| C3 | Milestone slip needs **PM review** before cascading; notify PM **and** admins | `milestone-deps.service.ts:68 propagateSlippage()` cascades **fully automatically** today | M |
| C4 | When a slipped milestone is linked to a lender's draw schedule, **move the draw date too** | Only the milestone date shifts | M |
| C1 | **Handover blocked** while any snag is still open | `SnagItem` + `SnagStatus` are built end-to-end; nothing checks them at handover | S |
| C5 | Resolving a snag requires an **"after" photo** as proof | No photo requirement on snags. Daily logs already do this — reuse that pattern | S |
| C6 | Milestone photos require **sign-off** before the phase counts complete | `MilestonePhoto` has `storagePath`, `caption`, `uploadedBy` — no sign-off field, and uploading has zero effect on status | M |
| C2 | The isolated **TI budget must be reviewed by Finance**, checkable **project-wise** | TI budget is correctly isolated from the main budget but appears in **no report** | M |

**C3 + C4 belong together** — both change what happens when a date slips, and shipping C3
alone would leave the draw-date shift firing off a cascade that a PM has not yet approved.

**C1 note:** the client said *"need to check what it needs"*. Handover-blocking is one
line of logic; the real question is what the **override** looks like (who can hand over
with snags open, and is it recorded). Resolve in the brainstorm.

---

## Phase 5 — Sales lifecycle · designed from scratch

Both items need real design before code. This is the brainstorm's subject.

### 5.1 — S3 · Unit swap mid-contract 🔴 **from scratch**

*"If a buyer wants to switch to a different unit after signing an LOI or contract, is that
a cancel-and-restart, or should the existing sale — its payments, discount approval,
broker — carry forward?"* → **Carry forward. Build it, connect correct values.**

No code path exists today.

**Rejected approach.** `sale.unitId = newUnitId`. It silently leaves the old unit stuck in
`UNDER_CONTRACT`, breaks every `percentOfPrice` installment against the new price, loses
the occupancy story on both units — and, most seriously, **launders an unapproved
discount**.

**Design — `SaleUnitTransfer`**, same shape as `LeaseTenantAssignment`:

```
model SaleUnitTransfer
  saleId, fromUnitId, toUnitId
  effectiveDate
  priceBefore, priceAfter     Decimal
  approvalReRequired          Boolean   // see the discount rule below
  reason, note
  recordedById, recordedAt
```

**What carries, and what does not:**

| Carries | Handling |
|---|---|
| Buyer, documents, broker | Untouched. Broker commission is stamped at close and derived from `salePrice`, so it recomputes naturally — no special handling needed. |
| `SalePayment` rows | **Rebase, do not recreate.** Keep the rows and their `paidAmount`; recompute `amount` for any installment carrying `percentOfPrice` against the new price. |
| Paid installments whose amount would move | **Flag, never restate.** The buyer is now over- or under-collected and a human must resolve it. This is the R22 invoice-flagging pattern (`needsReview` + `reviewReason`) applied to a new surface. |
| Discount approval | ⚠️ **Conditional — see below.** |

**⚠️ The discount-approval rule — needs client confirmation before build.**

The approval was a Founder saying *"yes, 12% off Unit 101 at $800k."* Carrying it
unchanged to Unit 205 at $1.1M converts a specific approval into a blank cheque, and the
discount gate stops meaning anything.

**Proposed rule:** carry `discountApprovedById` / `discountApprovedAt` forward **only if
the new discount % is ≤ the approved one**. Otherwise clear both and re-gate through the
existing approval flow. Record which happened in `SaleUnitTransfer.approvalReRequired`.

This is the single decision in the whole plan most likely to be overruled, and it is cheap
to get wrong in Prime's favour. **Do not build it until they answer.** Everything else in
5.1 can proceed regardless.

**Unit statuses:** old unit → `AVAILABLE` with a `SALE_TRANSFERRED_OUT` occupancy event;
new unit → `UNDER_CONTRACT`. Both events dated to the transfer, not to now.

### 5.2 — S4 / T1 · Third-party sale of an occupied unit 🔴 **from scratch**

**The tension in the client's answers**, resolved in favour of building:
- *"prime is owner of all units, no third parties entering in this"* — describes ownership **today**
- *"need to build true third-party sale of an occupied unit"* — the **instruction**

Today **every** sale close unconditionally ends the lease, hard-coded to `TENANT_BOUGHT`.
The service comment is explicit: *"Assumes the SITTING TENANT BOUGHT, which is the
client-confirmed v1 rule. A third-party sale of a tenanted unit would need the lease to
survive the sale."*

> **⚠️ A full spec for this already exists** — `docs/client-discovery/SALE_ON_TENANTED_UNIT_SPEC.md`
> (R1–R11, written 2026-08-14 off a code review of the lease→sold path). It covers the close
> dialog, deposit settlement, notification parity and unit history, not just the lease-survives
> branch. **Build from that spec; this section only records the decisions that resolve its open
> questions.** Do not duplicate it.
>
> Its blocking question — *"does Prime ever sell tenanted units to third parties?"* — is the
> one answered on 2026-08-14, which promotes its R2 third-party branch from P2 to buildable.
> Two of its P0 items (R4 lookup, R5 notification) are pulled forward into Phase 0 as findings
> #1 and #7, since they are defects rather than features.

**Rejected approach.** A boolean `endsLease` on `Sale`. Six months on, nobody remembers
what `false` meant.

**Design — model the buyer's relationship, derive the side-effect:**

```
Sale.buyerType : SITTING_TENANT | THIRD_PARTY     (default SITTING_TENANT)
```

Close behaviour follows from it, which makes it self-documenting and gives one place to
change the rule:

| `buyerType` | On close |
|---|---|
| `SITTING_TENANT` | End the lease as `TENANT_BOUGHT`. Today's behaviour, now explicit rather than assumed. |
| `THIRD_PARTY` | **Lease survives the sale.** Unit → `SOLD`; lease is **transferred off Prime's book**. |

**✅ Locked decision (client, 2026-08-14): Prime hands the tenancy over entirely.**

This is the decision that keeps the feature small, and it is worth being explicit about
why. `NOT_ON_SOLD_UNIT`, plus the `capAtSale` / `soldAt` guards added in the current
uncommitted work, all **hard-refuse rent writes on a sold unit** — they were built on the
premise that sold means Prime stops collecting.

Because Prime hands over entirely, **that premise stays true and none of those guards need
a carve-out.** The lease is marked transferred and becomes read-only history; Prime stops
billing; the rent roll, cash-flow forecast and billing cron all keep behaving correctly
with no change.

The alternative — Prime continuing to manage the tenancy for the investor — was rejected.
It would require a carve-out in every sold-unit guard plus a management agreement, a fee
and rent remittance to a third party, none of which exists in the schema. That is a
property-management product, not this feature. It is also incompatible with the standing
decision that externals get no login: the investor-owner would have nowhere to look.

**Build shrinks to:** a `buyerType` field, a new `LEASE_TRANSFERRED_WITH_SALE` termination
reason alongside the existing ten in `TERMINATION_REASONS`, and branching the
`TENANT_BOUGHT` path in `sales.service.ts`. Small — correctly sized to a case the client
says is rare.

**Depends on Phase 0 finding #1.** The sale-close lease-termination path picks the wrong
lease when a unit holds more than one; it must be correct *before* it is made conditional,
or the branch inherits the bug.

---

## Phase 6 — Notification wiring

*"notifications should for below wire all"*

| Ref | Item | State today |
|---|---|---|
| N7 | Newly assigned lead triggers a notification | Toggle exists in Settings; **nothing fires it** |
| N8 | Interior/Fit-Out phase-change and handover-due alerts | Toggleable but **silent** |
| N9 | Lead assignment reaching Sales fast enough | The 30s in-app poll is accepted; no change unless N7 proves too slow in practice |

Last deliberately, so it wires notifications for features that exist in their final shape
rather than being rewritten each phase. `TASK_ASSIGNED` shipped in the uncommitted tree
and is the pattern to copy — including the `notifiedAt` guard that stops an edit
re-alerting everyone.

---

## Still open — needs a client answer before it can be scheduled

| Ref | Question | Why it blocks | Blocks what |
|---|---|---|---|
| **S2** | **Can a cancelled sale be reopened?** | Never answered. Nothing in the code blocks reviving a dead deal, yet `CancelSaleModal` tells the user *"This action cannot be undone"* — an assertion the system does not enforce. The new ledger write is an upsert precisely so a re-cancellation does not 500, which quietly assumes reopening IS possible. Either enforce the copy or correct it; right now they disagree. | The copy, and whether a status guard is needed. |
| **S3** | **Does discount approval survive a unit swap to a more expensive unit?** | Proposed rule: carry forward only if the new discount % is ≤ the approved one, else re-gate. Most likely decision in this plan to be overruled, and cheap to get wrong in Prime's favour. | Only the approval branch of 5.1. The rest of the swap can be built. |
| **Deposit** | **When the sitting tenant buys, is the deposit refunded or netted off the purchase price?** | From `SALE_ON_TENANTED_UNIT_SPEC.md` blocking Q2, still unanswered. Decides whether `CREDIT_TO_SALE` is the **default** disposition or merely available. Today `DECIDE_LATER` fires silently and leaves real money PENDING against a dead lease on a sold unit, with no owner. | That spec's phase 3 (R3 + R6). |
| T3 | Editing a past, already-invoiced rent period — *"needs a short call with Finance"* ✅ agreed | The mechanism (R22) is **built**. The call is about **who holds `lease:history:correct`** — no role is granted it explicitly today, so only Founder/Super Admin have it via blanket grants. **It is also a sequencing gate:** the third-party-sale branch touches `capAtTermination` and `voidAfter`, the same code R22 uses, and that spec says land it *after* the Finance walkthrough so the two aren't explained at once. | Permission assignment, **and the timing of Phase 5.2**. |
| D3 | When does the buyer-visible document flag go live? | The answer given was ambiguous. Field exists in schema, unused in code. Tied to the buyer-portal timing question (P1), which was not answered at all. | Nothing scheduled. |

### Resolved 2026-08-14 — no longer blocking

- ✅ **S1 · cancellation policy.** `DECIDE_LATER` is the default. Refund / forfeit / net
  are all recordable per deal; there is no standing policy to implement.
- ✅ **S4 · third-party sale.** Prime hands the tenancy over entirely. No property-
  management build, no carve-out in the sold-unit guards.
- ✅ **F1 · organization scoping.** Cancelled outright — Prime is a single organization.
  No US/India split exists. `CLAUDE.md` corrected in four places.

---

## Sequencing summary

```
Phase 0  Stabilise ──────────────────────────► everything depends on this
   │
   ├── Phase 1  Guardrails            (independent, ship anytime after 0)
   │
   ├── Phase 2  Sales money ──┐
   │                          │
   ├── Phase 3  Documents ────┼──────► Phase 5  Sales lifecycle
   │                          │        (swap needs payments + doc gates;
   ├── Phase 4  Construction  │         3rd-party sale needs finding #1)
   │                          │
   └──────────────────────────┴──────► Phase 6  Notifications (last)
```
