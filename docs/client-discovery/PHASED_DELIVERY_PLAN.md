# Prime Tracker — Phased Delivery Plan

**Asan Innovators** | Prepared by: Kalyan Kumar Bedugam (AK)
**Version:** 1.0 | **Date:** 2026-05-30
**Inputs:** `UPDATE_PLAN.md`, `INTERIOR_MODULE_DESIGN.md`, `SALE_PAYMENT_SCHEDULE_DESIGN.md`, `TDD_Interior_and_SalePayment.md`, client discovery workbook.

> **On the two commands you referenced:**
> - `/code-review` reviews an actual code diff — there's no diff for the new features yet. Its *intent* lives
>   here as **Track C (Code Quality & Review)**: the cleanup of the existing codebase + a review gate per phase.
> - `/design-taste-frontend` builds/redesigns UI — a build action, not planning. Its *intent* lives here as
>   **Track B (Design System & Frontend Refresh)**: establish a real design system, then apply it.
> When you want either run for real (a branch to review, or a screen to redesign), point me at the target.

---

## 1. How this plan is structured

Three parallel **tracks** run across **seven phases (0–6)**. Most phases advance all three tracks a little, so
the product stays shippable and good-looking the whole way — not "build for 3 months, then bolt on design."

| Track | What it covers |
|---|---|
| **A — Features** | New modules + behavior changes from discovery (Interior, SalePayment, Broker, logs, integrations) |
| **B — Design System & Frontend** | Anti-generic, consistent UI: tokens, component library audit, screen-by-screen refresh |
| **C — Code Quality & Review** | Existing-codebase cleanup, test coverage, a review gate at the end of every phase |

Estimates are **relative effort** (S/M/L), not calendar — the SOW expresses the committed timeline.

---

## 2. Phase 0 — Discovery, Foundation & Baseline  *(blocks everything)*

**Goal:** answer the red questions, lock decisions, and set quality/design baselines before building.

| Track | Work | Size |
|---|---|---|
| A | Resolve the 5 🔴 client questions (migration, investor equity model, BuilderTrend/Bill.com API access). Confirm payment templates + interior packages. Run `npx prisma migrate status` (schema validates clean today). | M |
| B | **Design audit of the current app** (the `/design-taste-frontend` "audit-first" step): screenshot every page, catalog HeroUI usage, find inconsistencies (spacing, color, typography, empty/loading/error states). Define design tokens + a component inventory. Pick the visual direction (data-dense real-estate ops tool — clarity over flash). | M |
| C | Stand up the **review gate**: lint/typecheck in CI, decide coverage target, list the existing-code cleanups (below). Branch strategy. | S |

**Exit criteria:** red questions answered · design tokens + direction approved · CI gate live · cleanup backlog written.

**Existing-code cleanup backlog (Track C, surfaced this session):**
- Sales cancellation only sets a flag — no unit-status reversal (fix in Phase 3 with SalePayment).
- Test coverage is thin (**4 spec files total**) — new money logic must ship with tests.
- CLAUDE.md was stale (now refreshed) — keep it current as modules land.
- QuickBooks sync is coded but **unverified against live credentials** — schedule a go-live verification.
- Confirm `TAB_ROLES` actually hides leads/sales from Construction (client requirement).

---

## 3. Phase 1 — Interior Foundation + Sale Payment Core  🔴  *(the headline release)*

**Goal:** ship the two coupled HIGH features' core. These ship together because the interior price is a sale installment.

| Track | Work | Size |
|---|---|---|
| A | **One combined migration**: `InteriorProject` + 7-phase enum + `SalePayment` + supporting enums/back-relations. Interior CRUD + phase state machine + **soft parallel gate** (block Procurement/Execution pre-shell). SalePayment schedule with fixed-date **and** milestone triggers; auto due-date stamping on `milestone.completed` (reuse existing event bus). | L |
| B | Build the **Interior tab** (`UnitDetailPage`) with the design-system phase stepper, and the **SalePayment panel** in the Sale view — both as the first screens using the new tokens (set the pattern others copy). | M |
| C | State-machine unit tests + cross-module event test (milestone → payment DUE). Review gate. | M |

**Exit criteria:** an interior project moves through all 7 phases respecting gates · a sale has a milestone-linked schedule · both screens use the new design system.

---

## 4. Phase 2 — Interior Financials + Cashflow Truth  🔴/🟠

**Goal:** make the money real — isolated TI budget, sub-contractor invoices, and the cashflow forecast the founder asked for.

| Track | Work | Size |
|---|---|---|
| A | Interior budget/actuals isolation; **TI as a top-level reporting category** (peer to Loan / Sub-contractors AP / Commissions). `InteriorInvoice` (sub-contractor) → paired `Actual` in one transaction. Payment logging + partial payments. **Cashflow inflows** from SalePayments. **Finance "receivables next 2/4 weeks" view** (direct client ask). | L |
| B | Budget views with monthly/quarterly/annual toggle + outstanding-per-bucket; receivables widget; **funded-draws-clickable** enhancement (client ask). | M |
| C | Money-path tests (partial → PAID; invoice↔Actual transaction). Review gate. | M |

**Exit criteria:** interior costs never mix with construction · cashflow shows real inflows + outflows · receivables view live.

---

## 5. Phase 3 — Snagging, Handover, Doc-Gates + Sale Lifecycle  🟠

**Goal:** close out the interior workflow and harden the sale lifecycle.

| Track | Work | Size |
|---|---|---|
| A | `SnagItem` punch list (status, assignee, photo). **Document gates** (city-approval doc → Execution; handover certificate → Handover). **Interior Portfolio page** (cross-project: phase, budget vs actual, days-to-handover). **Sale cancellation reversal** (release unit status — the cleanup item) + discount-approval gate. Payment overdue cron + alerts. | L |
| B | Snag list UI + photo capture (mobile-friendly); Interior Portfolio page; overdue items surfaced in the existing `ExceptionFeed` (no new page). | M |
| C | Cron tests (overdue detection); cancellation-reversal test. Review gate. | M |

**Exit criteria:** punch list usable on phone · gates enforced · portfolio view live · cancelling a sale frees the unit.

---

## 6. Phase 4 — Broker Model + Daily Construction Logs  🟠

**Goal:** the next two highest-value items — broker tracking and the client's #1 pain point.

| Track | Work | Size |
|---|---|---|
| A | `Broker` model (internal-only, no login) + lead/sale attribution + commission calc on close + **broker performance report**. `DailyLog` (date, author, notes, optional weather/crew) + multiple photos, scoped to project/building — **mobile-first** (the #1 pain). Lead funnel: add `POTENTIAL` + `SITE_VISIT`; `LeadUnitInterest` (one lead ↔ many units / unit waitlist). | L |
| B | Broker report screen; **daily-log mobile capture flow** (the design priority — fast, low-friction, works one-handed on site); lead-board stage updates. | L |
| C | Commission-calc tests; daily-log upload tests. Review gate. | M |

**Exit criteria:** brokers tracked + reported · field crews log daily progress with photos from a phone · funnel matches client's stages.

---

## 7. Phase 5 — Frontend Design Refresh (full sweep)  *(Track B headline)*

**Goal:** apply the design system to the **whole** app, not just new screens — the `/design-taste-frontend` redesign pass.

| Track | Work | Size |
|---|---|---|
| B | Screen-by-screen refresh against the Phase-0 tokens: dashboards, project detail (11 tabs), inventory, reports, admin. Kill generic/inconsistent patterns; unify empty/loading/error states; tighten data-dense tables; consistent status chips, spacing, typography. Mobile/responsive polish (construction uses phones). | L |
| A | Minor enum/UX edits surfaced during refresh (LeadSource WhatsApp/Resquared/flyer; ProjectPhase Conceptual/Handover; DrawDocType budget-sheet/material-photo). | S |
| C | Visual-regression spot checks; accessibility pass (contrast, focus, labels). Review gate. | M |

**Exit criteria:** the app looks like one coherent, intentional product on desktop and mobile; no orphaned old-style screens.

---

## 8. Phase 6 — Integrations & Hardening  *(backlog, dependency-gated)*

**Goal:** the heavy integrations and go-live items — sequenced last because they depend on external access.

| Track | Work | Size |
|---|---|---|
| A | **BuilderTrend ↔ Bill.com PO bridge** (top time-waster — gated on API access confirmed in Phase 0). **QuickBooks live-credential go-live** + verification. WhatsApp notification channel (Twilio vs Meta). PWA + light offline (queued photo upload) if prioritized. | L |
| C | Integration tests against sandboxes; end-to-end smoke; final review + knowledge transfer. | M |

**Exit criteria:** no manual PO re-entry · QB sync verified live · (optional) WhatsApp + offline.

---

## 9. Sequencing rationale (why this order)

1. **Phase 0 is non-negotiable first** — the red questions (migration, investor model, integration API access) change scope; building before answers = rework.
2. **Interior + SalePayment lead** — both HIGH, and coupled (interior price = a sale installment). Splitting them doubles the wiring.
3. **Cashflow truth (Phase 2) right after** — it's the founder's stated need and the payoff of SalePayment; do it while that code is warm.
4. **Design refresh is staged, not deferred** — new screens use the system from Phase 1; the full sweep (Phase 5) happens once enough patterns exist to standardize. Avoids redesigning twice.
5. **Integrations last** — highest external dependency + risk; isolating them protects the earlier phases' timeline.

---

## 10. Cross-cutting principles

- **Every phase ends with a review gate** (the `/code-review` intent): lint, typecheck, tests for new logic, and a diff review before merge.
- **Additive migrations only** — no destructive schema changes; run `prisma migrate status` before each.
- **Reuse over rebuild** — event bus, notifications, storage, exceptions feed, and budget/actual tables are reused, not forked.
- **Ship demoable increments** — each phase produces something the client can see and sign off.
- **Keep CLAUDE.md + these docs current** as modules land.

---

## 11. Open dependencies that can move the plan

- 🔴 BuilderTrend / Bill.com API access (gates Phase 6 sizing).
- 🔴 Migration scope (could insert a dedicated migration sub-phase).
- 🟠 Interior package definitions + payment templates (gate Phase 1–2 polish).
- 🟠 QuickBooks live credentials (gate Phase 6 go-live).

---
*Asan Innovators — Building Beyond Boundaries*
