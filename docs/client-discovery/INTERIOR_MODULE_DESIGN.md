# Interior / Fit-Out Module — Design Brainstorm

**Status:** Converged — 3 key forks decided (see §0). Ready to turn into a build spec.
**Date:** 2026-05-30
**Scope:** The 🔴 HIGH item from `UPDATE_PLAN.md` — the single largest net-new build.
**Grounded against:** existing `Sale`, `Lease`, `Building`, `Unit`, `Contract`/`ContractPayment`, `Vendor`, `DrawSchedule`, `MilestonePhoto`, `Document`/`DocCategory`, `BudgetLine`/`Actual` models.

---

## 0. Converged Decisions (the 3 forks that change the build)

These were stress-tested against the client's *exact* words and decided:

1. **Interior (TI) money = top-level category + price on Sale.**
   Reuse `BudgetLine`/`Actual` *tables* (no schema fork), but the **reporting layer treats TI as a
   first-class category** — a peer to Loan / Sub-contractors AP / Commissions, exactly as the client listed
   their budget buckets ("1. Monthly Loan Payment 2. Sub-contractors AP 3. TI – Interior work 4. Commissions").
   The **client-facing per-sqft price is NOT owned by the interior project** — it lives as installment line(s)
   on the **`Sale`** ("interior cost is part of the contract agreement"). Consequence: **Interior and the
   Sale Payment Schedule (UPDATE_PLAN item B) must be built in the same sprint** — the TI amount is one of the
   milestone-linked installments. `InteriorProject` owns the *work / phases / snags / sub-contractor invoices*
   (operational truth); `Sale` owns the *price the client pays*.

2. **"No parallel work" = soft gate.** Block entering **`PROCUREMENT` and `EXECUTION`** until the unit's shell
   phase is complete. **Allow `DESIGN` / `CLIENT_APPROVAL` / `CITY_APPROVAL` anytime** — these paperwork
   phases realistically overlap the tail of shell construction, and a hard block would push early design work
   back into spreadsheets (the exact behavior this project exists to kill).

3. **Light document-gates are in scope for this module (not deferred).** Advancing past key phases requires the
   right document on file (city-approval doc before `EXECUTION`; handover certificate before `HANDOVER`). This
   directly attacks the client's two loudest pains — cross-team approvals and "construction files are hardest
   to find." It's a small, module-local version of the broader checklist-gate idea; the generic engine can come later.

---

## 1. Problem framing

Prime builds the *shell* (existing construction modules), then — for some units — does an *interior fit-out*
as a **separate, sequential** engagement. Today there is **no representation of this at all**: no project type,
no phases, no isolated budget, no snag list. Finance explicitly needs interior costs to **never mix** with
construction actuals, and the contract is **per-sqft**.

The design problem is really three sub-problems:
1. **Where does an interior project "hang"** in the data model (unit? sale? lease? standalone)?
2. **How is its money kept separate** from construction while reusing existing financial machinery?
3. **Where does it live in the UI** so the *same PM* can run it without a context switch.

---

## 2. Anchor decisions from client answers (already settled)

These remove whole branches of the design tree:

| Client answer | Design consequence |
|---|---|
| Same PM manages interiors | **No `INTERIOR_PM` role.** Reuse PROJECT_MANAGER + permissions. |
| Cannot run parallel to construction | Interior can only start when the unit/building shell phase is ≥ complete → a **guard**, not a scheduling engine. |
| Priced **per sqft** | Contract value = `ratePerSqft × area`. Store rate + area + computed value. |
| Separate budget line | Interior money is **tagged/isolated**, never summed into construction reports. |
| Sub-contractors, Prime sources materials | Reuse `Vendor`; track **sub-contractor invoices** per interior project. |
| Phases: Design → Client Approval → City Approval → Procurement → Execution → Snag → Handover | Fixed **`InteriorPhase` enum** (7 states). |
| Mostly custom, 2–3 generic packages | Support **free BOQ** + a small set of **package templates** (not a rigid catalog). |
| Optional per client | Interior is opt-in — created on demand, not auto-spawned. |

---

## 3. Three model options for "where it hangs"

### Option A — Standalone module linked to a Unit (recommended)
`InteriorProject` is a top-level entity with `unitId` (and optional `buildingId` for whole-building fit-outs),
plus optional `saleId`/`leaseId` back-references for context.

- ➕ Cleanest REST (`/interior-projects?unitId=`), survives sale cancellation, supports renovation #2 years later (one Unit → many InteriorProjects — client said "maybe sometimes").
- ➕ Mirrors how `Loan`/`Sale` already attach polymorphically to Unit **or** Building.
- ➖ One more top-level module to wire.

### Option B — Child of Sale/Lease
Interior bolted onto the transaction record.

- ➕ Matches "included in the contract agreement."
- ➖ Breaks for owner-occupied/retained units with no sale; breaks for re-fit-out after the original sale; couples lifecycle to a transaction that can be cancelled.

### Option C — A flag + fields on Unit
- ➕ Trivial.
- ➖ Can't model phases/budget/snags/multiple fit-outs. Non-starter for this scope.

**Recommendation: Option A** — standalone, unit-anchored, with optional sale/lease links for the "part of the contract" reporting view. It's the only one that satisfies "maybe more than one interior project per unit over its lifetime."

---

## 4. Proposed data model (Prisma sketch)

```prisma
enum InteriorPhase {
  DESIGN
  CLIENT_APPROVAL
  CITY_APPROVAL
  PROCUREMENT
  EXECUTION
  SNAGGING
  HANDOVER
}

enum InteriorStatus { NOT_STARTED  IN_PROGRESS  ON_HOLD  COMPLETED  CANCELLED }

enum InteriorContractType { PER_SQFT  FIXED  COST_PLUS }   // per_sqft is the client default

model InteriorProject {
  id            String        @id @default(cuid())
  // Anchor: exactly one of unit/building (service-enforced, mirrors Sale/Loan pattern)
  unitId        String?
  unit          Unit?         @relation(fields: [unitId], references: [id])
  buildingId    String?
  building      Building?     @relation(fields: [buildingId], references: [id])
  // Optional context links — "interior is part of the contract"
  saleId        String?
  leaseId       String?
  name          String
  status        InteriorStatus @default(NOT_STARTED)
  phase         InteriorPhase  @default(DESIGN)
  pmId          String?        // same PM pool — User
  contractType  InteriorContractType @default(PER_SQFT)
  ratePerSqft   Decimal?       @db.Decimal(12,2)
  area          Decimal?       @db.Decimal(10,2)   // sqft used for pricing
  contractValue Decimal?       @db.Decimal(14,2)   // = rate × area (or fixed)
  packageTemplateId String?    // optional 2–3 generic packages
  startDate     DateTime?
  targetEnd     DateTime?
  handoverAt    DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  deletedAt     DateTime?

  scopeItems    InteriorScopeItem[]
  snags         SnagItem[]
  invoices      InteriorInvoice[]
  documents     Document[]          // via new interiorProjectId on Document
}

model InteriorScopeItem {          // BOQ line; can be seeded from a package template
  id        String @id @default(cuid())
  interiorProjectId String
  description String
  category  String?   // flooring | ceiling | MEP_ROUGH | MEP_FINISH | joinery ...
  quantity  Decimal? @db.Decimal(12,2)
  unit      String?   // sqft, nos, lm...
  unitPrice Decimal? @db.Decimal(12,2)
  total     Decimal? @db.Decimal(14,2)
}

model InteriorInvoice {            // sub-contractor invoice per interior project
  id        String @id @default(cuid())
  interiorProjectId String
  vendorId  String                 // reuse Vendor
  amount    Decimal @db.Decimal(14,2)
  invoiceNo String?
  invoiceDate DateTime?
  paidAt    DateTime?
  status    String @default("PENDING")  // PENDING | APPROVED | PAID
}

enum SnagStatus { OPEN  IN_PROGRESS  RESOLVED }

model SnagItem {                   // punch list — reusable on construction too
  id        String @id @default(cuid())
  interiorProjectId String?
  milestoneId String?              // so it can attach to construction snags later
  description String
  room      String?
  assigneeId String?
  status    SnagStatus @default(OPEN)
  photoPath String?                // reuse Supabase StorageService
  resolvedAt DateTime?
}
```

**Budget isolation — DECIDED (§0.1):**
- Reuse `BudgetLine`/`Actual` **tables** + nullable `interiorProjectId` discriminator (no schema fork).
- **Reporting layer surfaces TI as a top-level category** (peer to Loan / Sub-contractors AP / Commissions),
  not as a filtered subset of construction. Construction reports exclude `interiorProjectId IS NOT NULL`;
  the budget/cashflow view adds a dedicated **TI** line.
- `InteriorInvoice` (sub-contractor invoices) is the operational money record; each rolls into an `Actual`
  tagged with `interiorProjectId` so the existing cashflow forecast keeps working without special-casing.
- **`contractValue` here is the internal cost-to-build.** The *client-facing* per-sqft price is a
  `SalePayment` line on the linked `Sale` — build alongside this module (UPDATE_PLAN item B).

---

## 5. Workflow

```
[create InteriorProject]  (allowed once unit shell exists)
        │
   DESIGN → CLIENT_APPROVAL → CITY_APPROVAL ──┊── PROCUREMENT → EXECUTION → SNAGGING → HANDOVER
        │            │              │          ┊        │                      │           │
   BOQ/scope   client signs   city approval    ┊   shell-complete         punch list   handover cert
   (free/pkg)                  doc on file      ┊   SOFT GATE here        (SnagItem)   doc REQUIRED
                                                ┊
   ── phases left of ┊ can overlap shell work; phases right of ┊ require shell complete (§0.2)
```

- **Phase advance** = same pattern as existing milestone/draw step transitions (service method, audit-logged).
- **Soft parallel gate (§0.2):** entering `PROCUREMENT` or `EXECUTION` requires the unit's shell phase complete.
  `DESIGN` / `CLIENT_APPROVAL` / `CITY_APPROVAL` are unrestricted.
- **Document gates (§0.3 — in scope):** entering `EXECUTION` requires a city-approval `Document`; entering
  `HANDOVER` requires a handover-certificate `Document`. Extend `DocCategory` with `CITY_APPROVAL` and
  `HANDOVER_CERTIFICATE`.
- **Approval records:** Client Approval & City Approval store approver + timestamp (construction team + city).
- **Notifications:** reuse existing engine — add triggers: interior phase change, snag overdue, handover due,
  missing-gate-document (mirrors the draw "missing documents" red-flag pattern).

---

## 6. UI placement

Two surfaces, both reusing existing patterns:

1. **Per-unit:** a new **"Interior" tab on `UnitDetailPage`** (interior is fundamentally per-unit). Shows the
   unit's interior project(s), current phase stepper, BOQ, snag list, invoices, docs.
2. **Cross-project portfolio:** a new top-level **`InteriorPortfolioPage`** (`/interior`) — table of all active
   interior projects: phase, budget vs actual, days-to-handover. Mirrors the existing report/dashboard pages.
   Optionally surface a compact widget on the Construction/Founder dashboards.

A per-**project** "Interior" tab on `ProjectDetailPage` is optional (filtered list); the unit-level + portfolio
views cover the real workflows. Recommend skipping the project-tab in v1 to keep the tab bar lean.

---

## 7. Permissions

Reuse existing strings; no new role. Suggested:
- `interior:view` — PM, Construction, Founder, Finance, Executive.
- `interior:edit` — PM (and Founder). Create/advance phase, edit BOQ, log invoices.
- `interior:approve` — Founder/Co-Founder for the client-approval gate (discount-style authority).
- Invoices visible to Finance/Accounting/AR_AP (align with existing financial-data access answer).

---

## 8. Build slices (maps to UPDATE_PLAN Sprints 1–2)

- **Slice 1 (foundation):** `InteriorProject` + `InteriorPhase`/`InteriorStatus` enums + CRUD + phase advance + per-unit tab + **soft parallel gate** (§0.2). Ship with the `SalePayment` TI installment line (§0.1 coupling).
- **Slice 2 (money):** interior budget/actuals isolation + TI top-level reporting category + `InteriorInvoice` (vendor) + per-sqft cost calc.
- **Slice 3 (scope):** `InteriorScopeItem` BOQ + 2–3 package templates.
- **Slice 4 (snagging + handover):** `SnagItem` punch list + **document gates** (city approval → Execution; handover cert → Handover, §0.3) + portfolio page.

---

## 9. Decision status

**Decided (§0):**
- ✅ Budget = reuse tables, TI as top-level reporting category; client price on `Sale`.
- ✅ Parallel rule = soft gate (block Procurement/Execution only).
- ✅ Document gates = in scope (city approval → Execution; handover cert → Handover).
- ✅ Anchor model = standalone `InteriorProject`, unit-anchored, one-unit-→-many (§3 Option A).
- ✅ No new role; reuse `Vendor`; fixed 7-phase enum.
- ✅ UI = Interior tab on `UnitDetailPage` + cross-project portfolio page; skip per-project tab in v1.

**Still needs client/team input (smaller, non-blocking):**
1. **Packages** — do the 2–3 generic fit-out package definitions exist now, or model structure + fill later?
2. **Invoice approval** — interior sub-contractor invoices: same single approval as draws, or just a status field? (Client said no dual approval.)
3. **Encryption** — interior contract values: AES like loans, or plain? (Sheet 8 Q14.)
4. **City Approval approver of record** — which user/role signs it off in-system?

## 10. Cross-references / sprint impact

- **Couples to UPDATE_PLAN item B (Sale Payment Schedule):** decision §0.1 means these ship **together**, not in
  separate sprints. Suggest merging UPDATE_PLAN Sprint 1 (interior foundation) and the front of Sprint 3
  (SalePayment) so the per-sqft TI installment is wired on day one.
- **Pulls forward a slice of the doc-checklist idea** (UPDATE_PLAN MED item) into the interior build, per §0.3.
- **Snagging (item E)** is delivered inside this module's Slice 4 — remove it as a standalone line in UPDATE_PLAN.
```
