# Historical Data Sheet Import — Spec

**Status:** Draft for client review. Not yet built.
**Written:** 2026-08-22
**Relates to:** [`UNIT_HISTORY_AND_LEASE_TO_SALE_SPEC.md`](UNIT_HISTORY_AND_LEASE_TO_SALE_SPEC.md) (H2 manual backfill, delivered 2026-08-13),
`LEASE_TRANSITION_SPEC.md` (R27 historical-record deletion approval, delivered 2026-08-13)

---

## Important context before reading further

On 2026-08-12 the client locked a decision: historical backfill would be **manual entry only, explicitly NOT
CSV import**. That was built — [`BackfillTenancyDialog.tsx`](../../apps/web/src/components/BackfillTenancyDialog.tsx)
and `POST /leases/backfill` let Sales or a Founder hand-enter one past tenancy (lease + full paid ledger) at a
time from the Unit Detail page, gated behind `unit:history:backfill`.

This spec was requested to **reconsider that decision for bulk loads**: the client confirmed (2026-08-22) they
now want a spreadsheet-import option *alongside* the manual form, covering both **past rent (tenancy) history**
and **past sales history**. This document does not silently reopen the earlier concern — it designs the import
around the same safeguard that motivated "no CSV" in the first place (see **Non-Goals** and **R2/R5** below):
nothing is written to the database without a human reviewing a row-by-row preview first.

**A real historical spreadsheet was shared during discovery**, and the actual file
(`PRIME TRACKER DETAILS - RENT.xlsx`, one sheet "RRC", 9 historical leases across two LLCs) was opened and
checked cell-by-cell on 2026-08-22 — it matches the pasted sample exactly: transposed layout (units as
columns B–J, fields as rows), multi-value cells, mixed date formats, and free text mixed into currency fields.
That sheet is **not** what this feature imports directly. It informed the field list in the template below.

**Client answers received 2026-08-22, folded into this revision:**
- **Q1 → yes.** R4 (manual historical sale entry) ships as its own deliverable before/alongside import.
- **Q3 → combined units must be saved correctly, not duplicated as a workaround.** 3 of the 9 sample leases
  span more than one unit (700+701, 1001+1002, 1101+1102) — this is a third of real records, not an edge case.
  Resolved below under **R1/R8**, not deferred to the Unit Groups roadmap item.
- **Q4 → yes**, renewal option terms go in the free-text Notes column.
- **Q5 → a warning is sufficient**, not hard enforcement of import order.
- **Q6 → "10 years of data."** No exact record count yet; still worth confirming roughly how many project
  sheets like this one exist (see refined Open Question Q6).
- **Q7 → yes, move to P0.** The sample data itself proves this: "First month rent" and "TI Paid" cells
  routinely show partial/dated payments ("50K PAID" against a larger TI, "$11,250(prepaid rent)"), not clean
  paid-in-full history.
- **New, not previously scoped:** broker commission is paid **in installments**, not one lump sum — the sample
  sheet has separate "1st Commission paid" and "2nd Commission" rows per lease. Resolved below as new **R7**.

---

## Problem Statement

Prime Developers has 1–2+ years of pre-platform tenancy and sales history living in ad hoc spreadsheets
(rent rolls, deal trackers) maintained outside Prime Tracker. The manual backfill form (H2) works but enters
one historical tenancy at a time — for a portfolio-scale backlog (hundreds of historical leases across ~499
units, per the 2026-08-12 live-data check) that is a multi-week data-entry project for Sales/Founder staff.
Historical **sales** have no backfill path at all today, manual or otherwise, so that data currently has
nowhere to go except the spreadsheets it already lives in. Until this history is in the platform, Unit History
timelines, rent-roll trends, and portfolio reporting are incomplete for any unit with a pre-platform past.

## Goals

1. Let Sales/Founder staff commit dozens of historical tenancy records in one operation instead of one form
   submission per record, without weakening the guards H2 already established (no future-dated records, no
   silent overwrite, financial ledgers entered complete and reviewed).
2. Give historical **sales** a first-class home in the data model and an entry path — currently absent
   entirely — with the same historical-record semantics (flagged, timeline-visible, approval-gated deletion)
   as backfilled leases.
3. Preserve the "never write on trust" posture: every imported row is parsed, validated, and shown to the user
   for confirmation before anything touches the database — matching the precedent set by discount-approval and
   TI-overpayment confirmation elsewhere in the app.
4. Reduce the time to fully backfill a unit's history from "one form per tenancy" to "one file per project (or
   portfolio)," measurably shortening the client's own backfill effort.

## Non-Goals

- **Parsing arbitrary/legacy spreadsheet layouts automatically.** The sample sheet shared during discovery is
  transposed (units as columns, fields as rows), mixes multiple values in single cells (three emails in one
  cell, PSF and total rent in one cell, a paid-date embedded in a currency field), and uses inconsistent date
  formats. Auto-detecting and normalizing formats like that is exactly the kind of silent, unreviewable
  transformation the 2026-08-12 "no CSV" decision was protecting against. v1 imports **only** the structured
  template this spec defines (see R1/R4); the client's team transcribes existing sheets into it. This is the
  non-goal that makes the rest of the feature safe to build.
- **A spreadsheet-column-mapping wizard** ("match your headers to our fields"). Deferred to P2 — see below.
- **Building the full Unit Groups feature** (permanently merging adjacent units into one legal unit — the
  separate, larger roadmap item). This spec needs only enough to record that two historical `Lease` rows are
  one commercial deal, not to permanently restructure the unit inventory. **R8** below is the narrow fix; full
  Unit Groups stays a separate future initiative.
- **Renewal *options*** (e.g., "2 × 5-year options") as structured data. Only actually-exercised renewals —
  real historical lease rows linked via the existing `successorLeaseId` chain — are importable. Option terms
  are, at most, free text in the `notes` column (client-confirmed, Q4).
- **Background job processing / async import for very large files.** v1 assumes portfolio-scale files (tens to
  low hundreds of rows), processed synchronously within one request. A file large enough to need a job queue
  is out of scope until the client's actual data volume says otherwise (Open Question Q6).
- **Syncing imported historical data to QuickBooks or any external system.** This is a Prime Tracker
  record-keeping feature only.
- **A structured "owning LLC / seller entity" field on Project or Building.** Both the rent sheet ("LLC NAME
  (LANDLORD)") and the sales column list ("Seller") carry this, and Prime Tracker doesn't model it anywhere
  today — not just for history, for live records either. Captured as free text in the Sale's Seller field /
  Lease's Notes for v1; a structured multi-entity model is a separate, larger change or worth confirming
  really is single-entity per Prime's existing SINGLE-org decision (that decision was about the
  `Organization` model, not necessarily about per-project holding LLCs, which the sample data suggests exist).

## User Stories

- As a **Sales team member**, I want to upload a spreadsheet of past tenancies for a project so that I don't
  have to re-enter each one through the single-record form.
- As a **Sales team member**, I want to see exactly which rows will be imported and which have errors *before*
  anything is saved, so a typo in row 40 doesn't silently corrupt row 40's ledger or block rows 1–39.
- As a **Founder**, I want a downloadable template with the exact columns the importer expects, so the
  transcription work from our old spreadsheets is unambiguous.
- As a **Founder**, I want historical sales entered the same importable way as historical leases, so the
  pre-platform deal history isn't stuck in spreadsheets forever.
- As a **Founder**, I want an imported record to be indistinguishable in kind from a manually-backfilled one
  (same "historical" flag, same Unit History timeline entry, same R27 deletion-approval requirement), so
  reviewing and correcting mistakes doesn't require learning a second set of rules.
- As anyone viewing **Unit History**, I want imported historical rent/sale records to render exactly like
  manually-backfilled ones (dimmed, "Past tenant" styling, correct PAID/DUE ledger), so there's no visual tell
  that distinguishes "imported" from "typed in" data quality.

## Requirements

### Must-Have (P0)

**R1 — Rent History import template**
- A downloadable `.xlsx` template, **three tabs**, driven directly by what the real sample file
  (`PRIME TRACKER DETAILS - RENT.xlsx`) turned out to need once it was actually opened:
  1. **Tenancies** — one row per historical lease, columns matching `BackfillTenancyDto` field-for-field:
     Unit Number, Building, Tenant Name, Tenant Legal Name (optional), Tenant Brand (optional), Sqft, Lease
     Start, Lease End, Termination Date, Termination Reason (optional, constrained to `TERMINATION_REASONS`),
     Monthly Rent, Rent PSF (optional, informational — the sample's "$34/$8,641.66" is exactly PSF/Total in one
     cell; the template requires them **split into two columns**, never combined), Rent Start Date (optional),
     Security Deposit + Security Deposit Paid Date (optional; the sample's "13030.43\nfeb 06,2026" is exactly
     this pattern — amount and paid-date **must be separate columns**, never one cell), TI Allowance PSF /
     Total (optional), Rent Due Day (optional), Combined Deal Reference (optional — see **R8**), Notes
     (optional — renewal option terms go here per Q4, e.g. "2×5yr renewal options").
  2. **Ledger Exceptions** — Unit Number, Month (`YYYY-MM`), Amount Collected. One row per month that
     differed from paid-in-full (**P0 per Q7**, not deferred — see R2). Rows with no exception simply have no
     entry here; the Tenancies tab's ledger defaults to fully paid exactly as `backfillTenancy` does today.
  3. **Commission Installments** — Unit Number, Installment Number, Amount, Paid Date. See **R7**.
- Acceptance: template downloads with header row + one filled example row per tab (built directly from a
  de-identified version of the real "RRC" sample) + a short "how to fill this in" comment on each header cell
  (unit format, date format, what goes in which column when the source cell has two things in it).

**R2 — Rent History import flow**
- Given a Sales or Founder user with `unit:history:backfill` on the Rent History import screen,
  When they upload a `.xlsx` or `.csv` file matching the R1 template,
  Then the file is parsed and every row is validated against the same rules `backfillTenancy` already
  enforces (no future termination date, unit exists and is resolvable, lease end ≥ lease start, no overlap
  with an existing lease on that unit) **without writing anything**.
- The user sees a preview table: one row per parsed record, a status column (✅ ready / ⚠️ error), and the
  specific error message for failed rows (unit not found, overlapping lease, negative rent, bad date, etc.).
- The user can only commit once they've seen the preview. Committing writes only the ✅ rows — a broken row
  never blocks the rest of the file, and nothing is written silently.
- Each committed row is created by calling the **existing** `backfillTenancy()` service method once per row
  (composition, not a bypass) — so it inherits every guard, ledger generation, `isHistorical` flagging, and
  audit trail the manual form already has, in the same DB transaction boundary per row. Any Ledger Exceptions
  rows for that unit are matched by Unit Number + Month and passed through as `collections` overrides, exactly
  the mechanic the manual form's collection grid already writes. Any Commission Installments rows for that
  unit are applied after the lease is created (see R7).
- After commit: a results summary (N imported, M skipped/failed with reasons), and every imported tenancy
  appears immediately in that unit's Rent History exactly as if entered by hand.
- Acceptance:
  - [ ] Upload a valid 20-row file → preview shows 20 ✅ rows → confirm → 20 leases + full paid ledgers created
  - [ ] Upload a file with 2 rows referencing unknown unit numbers → preview shows 18 ✅ + 2 ⚠️ with a clear
        "unit 9999 not found in this project" message → confirming imports only the 18
  - [ ] Upload a file with a future termination date → that row is rejected in preview with the same message
        `backfillTenancy` already gives ("This tenancy has not ended yet…")
  - [ ] Re-uploading the same file after commit does not duplicate already-imported rows silently — it hits
        the same overlap constraint and reports those rows as errors

**R3 — Import results are audit-visible**
- Each row's creation goes through the existing audit interceptor exactly as a manual backfill does (no new
  audit mechanism). Acceptance: an imported tenancy's `AuditEvent` trail is indistinguishable from a manually
  backfilled one except for the note "Historical — entered during backfill" already present today.

**R4 — Historical Sale entry (new, single-record)**
Sales backfill has no manual path today; import needs one to compose, mirroring the R27/H2 precedent rather
than inventing a bulk-only mechanism with no single-record equivalent (Q1, confirmed).
- New `backfillSale()` service method + `POST /sales/backfill` (`unit:history:backfill`), fields mirroring
  `Sale`: unitId (or buildingId, polymorphic like the live model), seller (free text — see Non-Goals; no
  structured owning-LLC field), buyer, buyerType, sale price, price PSF (informational only, not stored —
  cross-check against price ÷ unit sqft), sale-agreement/executed date (→ `Sale.contractDate`), closing date
  (required, must be in the past — see Q10 below on whether this ever differs from the agreement date for
  historical deals), broker + commission (optional, see **R7**), notes.
- **Deposit and any second/later payment are NOT flat fields — they compose the existing `SalePayment`
  schedule** (the live Sale Payment Schedule feature already models exactly this: a sale has zero or more
  labeled installments with an amount and a paid date). `backfillSale` accepts an optional list of
  `{ label, amount, paidAt }` and creates one `SalePayment` row per entry (e.g. "Deposit" paid on date X,
  "Second Payment" paid on date Y) — composition of an existing pattern, not new schema, the same relationship
  R2 has to `backfillTenancy`'s `collections` override.
- Sets the unit's status to `SOLD` and writes an `isHistorical` occupancy event, same pattern as the live
  `SalesService.close()`.
- If the unit has an **active tenancy already recorded** (imported via R2 or entered live) that overlaps the
  closing date, the backfilled sale must end it the same way `SalesService.close()` does today (composing
  `endTenancyWithin`, reason `TENANT_BOUGHT`) — otherwise a backfilled portfolio ends up with the exact
  SOLD-with-live-lease contradiction the 2026-08-13 `UNIT_LEASE_CONSISTENCY.md` audit found and fixed for the
  live path. This creates an **ordering dependency**: if both a historical lease and its historical sale are
  being imported for the same unit, the lease import must run first (see Open Question Q5).
- Acceptance:
  - [ ] Backfilling a sale with no prior tenancy sets the unit to SOLD, no lease side-effects
  - [ ] Backfilling a sale for a unit with an overlapping historical/live lease ends that lease with reason
        TENANT_BOUGHT at the closing date, same as the live close() path
  - [ ] Backfilling a sale with a future closing date is refused
  - [ ] The record is flagged historical and renders in Unit History the same way a backfilled lease does

**R5 — Sale History import template + flow**
- Same template + upload + parse + validate + preview + confirm + commit pattern as R1/R2, built on R4.
- **Template finalized 2026-08-22** against the client's real column list — two tabs:
  1. **Sales** — Sl No (spreadsheet reference only, not imported), Unit Number, Building, Sqft (informational,
     cross-checked against the unit's own recorded sqft, not overwritten), Seller (free text), Buyer, Purchase
     Price, Price PSF (informational), Deposit Amount, Deposit Date, Second Payment Amount (optional), Second
     Payment Date (optional), Sale Agreement / Executed Date, **Closing Date** (required — added beyond the
     client's list because `backfillSale` needs it to flip the unit SOLD and end any tenancy; see Q10), Broker
     (optional), Notes.
  2. **Commission Installments** — shared with R1's tab (same shape, same table), Unit Number, Installment
     Number, Amount, Paid Date.
- Acceptance criteria mirror R2's, substituting sale fields for lease fields; deposit/second-payment rows
  become `SalePayment` records exactly as R4 specifies.

**R6 — Historical Sale deletion, approval-gated**
- Extends the existing R27 `HistoricalRecordDeletion` approval flow (currently lease-only) to cover
  historical sales, so a bad import row (wrong price, wrong unit) has the same "Sales/whoever entered it
  requests, Founder approves" correction path leases already have. Gated by `unit:history:delete`.
- Acceptance: requesting deletion of a backfilled sale creates an approval request; a non-historical
  (live-closed) sale is refused deletion via this path with the existing "recorded live, not backfilled"
  message.

**R7 — Broker commission paid in installments (new schema, both Lease and Sale)**
Both `Lease.brokerCommissionAmt`/`brokerCommissionPaidAt` and `Sale.brokerCommissionAmt`/
`brokerCommissionPaidAt` are a **single** amount + a **single** paid timestamp today. The real data shows
commission is routinely split — every sample lease with a commission has a "1st Commission paid" and a
"2nd Commission" figure, sometimes only one of the two paid. That single-payment model cannot represent this
even for a manually-entered historical record, let alone an imported one — this is a genuine schema gap the
sample data surfaced, not an import-only concern.
- New `CommissionInstallment` table (mirrors the existing `SalePayment` pattern already in the schema):
  `leaseId? / saleId?` (polymorphic, exactly one set — same convention as `Sale.unitId`/`buildingId`),
  `sequence` (1st, 2nd, …), `amount`, `paidAt` (nullable — unpaid installments are legitimate), `notes`.
  `brokerCommissionAmt` stays as the **total** contracted commission (sum of installments, or the number
  entered before installments exist); it stops meaning "the one payment." `brokerCommissionPaidAt` is
  deprecated in favor of "all installments have `paidAt`."
- Applies to **both** historical (R2/R4/R5 import and manual backfill) and **live** leases/sales — the live
  commission report (R23, `GET /brokers/:id/leases`) currently assumes one payment date and needs the same fix
  independent of import, otherwise a live deal with a split commission has nowhere to record the first payment
  without prematurely marking the whole thing paid.
- Acceptance:
  - [ ] A lease/sale can have 1, 2, or N commission installments; broker report sums correctly and shows
        partial-paid state (e.g. "1 of 2 installments paid, $X outstanding") rather than a single paid/unpaid
        flag
  - [ ] Importing a Commission Installments row for a unit that has no matching lease/sale in that import
        batch is reported as a preview error, not silently dropped

**R8 — Combined multi-unit historical deals (narrow fix, not full Unit Groups)**
The real sample data has 3 of 9 leases spanning multiple physical units, and it already carries the per-unit
split when it matters (e.g. Sqft `"4200(3200+1000)"` is the combined total *with* the individual units'
breakdown in parentheses) — the source data was never actually ambiguous about which unit gets what, only the
transposed spreadsheet layout was. Given that, the correct fix is not "duplicate the whole lease onto two
units" (which would double-count rent) and not "wait for full Unit Groups" (a separate, heavier feature) — it
is: **one `Lease` row per physical unit, each carrying its own correct sqft/rent share, linked by a shared
reference so each unit's history shows the other unit(s) it was leased together with.**
- Template (R1): a combined deal is entered as **one Tenancies row per unit**, each with that unit's own Sqft
  and Rent (not the combined total), plus the same **Combined Deal Reference** value (any string — e.g. the
  tenant name, or a deal ID) on every row that belongs together.
- `backfillTenancy` (and the new `backfillSale`) accept an optional `combinedDealRef` passed straight through
  to `notes` metadata / a new nullable `Lease.combinedDealRef` column, no relation table needed for v1.
- **Per-unit rent split when it isn't separately known (Q8 — adopted default, not a confirmed client answer):**
  the sample's sqft breakdown proves Prime usually *does* know the per-unit split. When the template's
  per-unit Rent field is left blank for one row in a combined-deal group but the group's *total* rent is
  entered on the first row, the importer proportions the remainder by each unit's sqft share (the same ratio
  already visible in the sqft breakdown) rather than leaving it at $0. The preview flags any row filled this
  way ("rent split proportionally by sqft — confirm before import") so it's never silently guessed past the
  human review step.
- Unit History timeline renders a "Leased together with Unit(s) X, Y" cross-link when `combinedDealRef` is
  set and shared by more than one lease.
- Acceptance:
  - [ ] Importing the sample's "1001 & 1002" pair as two Tenancies rows with the same Combined Deal Reference
        creates two leases, each unit showing its own correct rent, each cross-linking to the other in Unit
        History
  - [ ] `combinedDealRef` is purely informational — it does not participate in the overlap constraint, rent
        calculations, or reporting aggregation; each unit's numbers stand alone and correctly reflect only
        that unit's economics

### Nice-to-Have (P1)

- **Inline preview correction** — fix a bad cell directly in the preview table instead of re-uploading the
  whole file. v1 ships with "fix in your spreadsheet and re-upload" instead; this is a fast follow once we see
  how often users hit small, single-cell errors in practice.
- **Cross-row validation inside one file** — e.g. flag two rows in the same upload that both claim the same
  unit for overlapping date ranges, before either hits the per-row `backfillTenancy` overlap check (currently
  the second row would just fail against the first *if* the first committed first — order-dependent and
  confusing in the preview).
- **Import session log** — a lightweight "who imported what file, when, how many rows" record, distinct from
  the per-row `AuditEvent` trail, for accountability when multiple people are doing bulk transcription.

### Future Considerations (P2)

- ~~Flexible column mapping~~ — **promoted out of P2 and designed below as R9** (client request, 2026-08-22):
  accept a spreadsheet with the client's own headers/layout, in whatever shape, and let the user map it to our
  fields interactively instead of requiring our exact template.
- **Full Unit Groups integration** — if/when the separate Unit Groups feature ships (permanently merging
  units), migrate R8's `combinedDealRef` links into real Unit Groups where they line up, instead of the two
  mechanisms coexisting indefinitely.
- **Auto-linking renewal chains** — detect that two imported rows for the same unit/tenant are sequential
  tenancies and wire `successorLeaseId` automatically instead of requiring that to be entered by hand
  afterward.

## Success Metrics

**Leading (days–weeks):**
- First-upload validation pass rate (✅ rows ÷ total rows) once the client's team has used the template a
  few times — target 80%+ after the first 2–3 files (the first file or two teaching them the template's
  quirks is expected and fine).
- Time from file upload to committed records for a 50-row file: target under 5 minutes end-to-end (upload +
  review + confirm), versus the ~50 individual form submissions the manual path would take.
- Adoption: number of import sessions run by Sales/Founder in the first 30 days post-launch.

**Lagging (weeks–months):**
- % of the portfolio's pre-platform tenancy/sale history backfilled within 60 days of launch (ties back to
  the original H2 spec's "1–2 years of pre-platform data" goal, which is still largely unbackfilled per the
  2026-08-13 live-data check).
- Ratio of import-created historical records to manually-created ones — if import doesn't become the dominant
  path for bulk loads, something about the template or preview flow is too friction-heavy.
- Number of `HistoricalRecordDeletion` requests filed against imported records over time, as a proxy for
  import-introduced mistakes — should trend down as the client's team gets comfortable with the template.

## Open Questions

**Resolved 2026-08-22** (kept here for record; requirements above already reflect these):
Q1 (R4 ships as its own item, before import) · Q3 (combined units are R8, not a duplicate-row workaround) ·
Q4 (renewal options → free-text Notes) · Q5 (import-order enforcement is a warning, not a hard block) ·
Q7 (Ledger Exceptions is P0, folded into R1/R2).

**Resolved 2026-08-22, round 2:**
- **Q2 → answered.** Client provided the real Sale History column list (Sl No, Unit No, Sqft, Seller, Buyer,
  Purchase Price, PSF, Deposit + date, Second Payment + date (if any), Sale Agreement executed date) — folded
  into R4/R5 above. Deposit/second-payment map onto the existing `SalePayment` schedule rather than new
  fields.
- **Q6 → answered.** 5 projects, each with a sheet of units, each project **at least 100+ units**. Confirms
  portfolio scale (consistent with the ~499-unit figure already known from [[prime-tracker-unit-history-spec]])
  but not directly a *historical-record* count — most units in a 100+-unit project won't all have pre-platform
  turnover history the way the 9-lease RRC sample represents a subset of one project. Working assumption:
  synchronous per-file processing stays sufficient as long as each project's historical file stays in the
  dozens-to-low-hundreds of rows, the way the sample was; revisit if any single project's file turns out to be
  much larger.
- **Q9 → answered.** Commission is "2 or more" installments, not fixed at 2 — confirms R7's `sequence`-based
  design (any count, not hardcoded to two) is the right shape, not overengineering.

**Still open (non-blocking — R7 can start regardless):**
- **Q8 — adopted a working default, not a confirmed answer.** See R8 above: proportional-by-sqft fallback when
  a combined deal's per-unit rent isn't separately known, flagged in preview for confirmation rather than
  silently applied. Correct me if a different default is wanted.
- **Q10 (new, client):** Is "Sale Agreement / executed date" ever a *different* date from Closing Date for
  these historical deals, or do they coincide for most/all of the portfolio's past sales? The client's column
  list named only the agreement date; `backfillSale` needs a Closing Date specifically (it's what flips the
  unit to SOLD and ends any tenancy) — the template has both columns, but if they're always the same date in
  practice, the template's guidance should say so plainly rather than making the preparer wonder.

## Timeline Considerations

- **Scope grew materially from the first draft** once the real file and the client's answers were in hand:
  R7 (commission installments) and R8 (combined-unit linkage) are both new P0 schema work driven directly by
  what the real data actually contains, not speculative additions. Worth saying plainly: this is now a bigger
  first release than "wire a preview screen onto an existing form."
- **Dependency on R27:** R6 (historical sale deletion) extends the existing `HistoricalRecordDeletion` model —
  needs that table/flow generalized from lease-only to polymorphic (lease | sale), a small schema change.
- **R7 touches live commission tracking (R23), not just historical data** — the broker report and the lease/
  sale commission fields are shared between live and historical records, so this is one schema change with
  two consumers, not two separate efforts.
- **Suggested phasing**, in order, each independently shippable and demoable:
  1. **R7** — commission installments schema (`CommissionInstallment`, migration, broker report update). Do
     this first: R1/R4's templates and R2/R5's import logic both need it to exist, and it also fixes a live
     gap independent of import.
  2. **R4** — manual historical sale entry (establishes the sale-side data model + guards, no import UI yet)
  3. **R1 + R2 + R8** — Rent History import, including the three-tab template, Ledger Exceptions (P0 per Q7),
     and combined-unit linkage. Lower risk than the sale side: composes an already-hardened `backfillTenancy`.
  4. **R5** — Sale History import (composes R4 the same way R2 composes `backfillTenancy`); template is now
     finalized (Q2 answered), so this no longer needs to wait on anything but R4 itself
  5. **R6** — historical sale deletion approval
  6. R3 falls out of R2/R4/R5 for free (existing audit interceptor); no separate work item.
- No hard external deadline known. Recommend sequencing against whatever's currently in flight per
  [[prime-tracker-update-scope]] rather than treating this as urgent — the manual backfill path already works
  for anyone who wants to start entering history today, and R7's live-commission fix is worth prioritizing
  slightly on its own merits regardless of when the rest of this ships.

---

## R9 — Generic Column-Mapping Import

**Status:** P0 DELIVERED 2026-08-23, on branch `feature/r9-generic-column-mapping-import` (not yet merged/committed).
R1/R2/R4/R5/R6/R7/R8 above were all delivered in prior sessions; this closes out the last open item from that
list. Built for the **Tenancies/rent-history side only** (`/leases/backfill/import/analyze` and
`/preview-mapped`), matching the P0 scope below — Sale History (R5) reuse is still P1, not built.

**What shipped vs. the design below:**
- Both orientations are supported, not just row-per-record — **transposed sheets ship in P0**, not deferred.
  This mattered in practice: the client's actual reference file (`PRIME TRACKER DETAILS - RENT.xlsx`) turned
  out to be transposed, so shipping row-per-record only would have failed on the one real sample available.
- PSF/Total combined-cell splitting shipped as designed. Embedded-paid-date and multi-value-text splitting
  (Step 1's other two examples) did **not** ship — no real sample exercised those patterns, so building
  detectors for them would have been guessing. Fast-follow once Q14 sample sheets exist.
- Q15 resolved: unmapped columns are surfaced, not silently dropped — the mapping screen shows every detected
  column/row including ones with no field suggestion, and a banner names any required field with no column
  mapped to it yet.
- **New finding, not in the original design:** running the real sample through the mapper surfaced that it
  has no Lease End / Termination Date data at all — every column in that file describes an **active,
  ongoing** tenancy (10-year terms starting as recently as 2026), not an ended one. That sheet is a current
  rent roll, not historical-backfill data as this whole R1–R9 pipeline assumes. It mapped and previewed
  correctly (proving the mapper works), but every row correctly errors as missing required fields — this
  import path is not the right destination for that specific file. Worth a direct question back to the
  client: is there a *different* sheet with actually-ended tenancies, or does "historical" here really mean
  "as of now, backfill everything as one lease record per current tenant" (which would need a different,
  simpler import — no termination logic at all)?
- Two rows in the real sample ("May 29th, 2026", "January 23rd, 2026") initially failed to parse at all —
  native `Date` parsing rejects ordinal suffixes ("29th", "23rd"). Fixed in `textToDateIso`, which strips
  them before parsing. While fixing this, found and fixed a **pre-existing** off-by-one bug shared with R1's
  `cellDateIso`: parsing a text date via `new Date(str).toISOString()` shifts the calendar date backward a
  day in any timezone ahead of UTC (reproduced locally — this machine is IST). Fixed in both places by
  re-anchoring the parsed Y/M/D at UTC midnight instead of converting the parsed moment across timezones.
- Auto-suggested mappings are a starting point, not always right — verified against the real file, "First
  month rent" and "Extended rent commencement date" both got incorrectly suggested as Monthly Rent (token
  overlap with "rent"). Harmless by design (the user reviews and corrects every suggestion before continuing)
  but worth knowing the synonym-matching heuristic isn't perfect on live data.
- Multi-unit cells ("700 and 701", "1001 & 1002") and combined-sqft cells ("4200(3200+1000)") are **not**
  auto-split — mapping a column to Unit Number just takes the cell text as-is, so a combined-unit row
  correctly fails unit resolution with a clear per-row error rather than silently guessing a split. Auto-
  splitting free-text unit lists into multiple linked rows (R8's territory) was judged out of scope for a
  *column* mapper — it's a different capability (parsing structure out of one cell's prose), not a mapping
  problem. If this comes up often, the client's existing option today is to correct just that one cell to a
  clean `combinedDealRef`-style entry before upload, or use the R1 template path directly for those rows.

### R9.1 — Field-gap audit (2026-08-23, same-day follow-up)

After the P0 build above shipped, running the client's real file through the finished mapper (and the user
pasting the mapping screen back with a specific gap list) surfaced eight target fields with genuinely nowhere
to map to, plus one serious bug the audit's live E2E testing caught. All fixed same day, on the same branch.

**New mappable fields added (all schema-backed — the schema already had these, they were just never exposed
to backfill/import before):**
- `landlordEntity` — **new column**, migration `20260823000000_lease_landlord_entity`. Free text, mirrors
  `Sale.seller` exactly (same reasoning: no structured owning-entity model in v1).
- `tenantEmail` / `tenantPhone` — already on `Lease`; multi-value cells ("a@x.com\nb@y.com") take the first
  value, since the target holds one.
- `escalationPct`, `rentPerSqft`, `nnnPerSqft` / `nnnTotalAmount`, `tiAllowance` — already on `Lease` and on
  the live `create()` path; `backfillTenancy()` silently dropped all of them until now. `tiAllowance` seeds a
  `TI_ALLOWANCE` obligation via the existing `syncHeadlineObligations()` — same mechanism a live lease uses.
- `leaseTermMonths` — a **derived-only** field: parses "10years"/"5 YEARS" text and computes Lease End from
  Lease Start when Lease End isn't otherwise mapped. The real sample gives duration, not an end date.
- `commissionInstallment1/2/3` — up to 3 fixed installment-amount columns, feeding the existing R7
  `CommissionInstallments` mechanism. Requires a Broker Name also be mapped and resolve — same rule the
  template path's Ledger-Exceptions join already enforces (a commission installment with no broker is refused
  as an error, not silently dropped).

**Two real false-positive suggestions found and fixed** (both would have written wrong data if acted on,
not just imperfect guesses): a bare `'ti'` synonym matched "TI Paid"/"TI Balance" (disbursement figures) and
would have suggested overwriting the AGREED total with the amount already paid; a bare `'sf'` synonym for
Sqft substring-matched inside "psf" and mis-suggested Sqft for "TI(PSF/Total)". Both synonyms removed.

**Split-target labeling bug fixed:** the original P0 build had `splitTargetsForHeader()` correctly detecting
NNN/TI columns on the backend, but the frontend's submit handler (`handleConfirmMapping`) hardcoded
`rentPsf`/`monthlyRent` for every split-enabled column regardless of which pair it actually belonged to.

**A serious data-corruption bug, found only by live-testing against a sheet with Rent + NNN + TI together**
(exactly the client's real shape): because of the labeling bug above, mapping all three split columns caused
each one's "total" half to overwrite the SAME `monthlyRent` field — last column in the sheet wins. A 1-record
test file with Rent $3,000/NNN $1,200/TI $6,000 committed with **Monthly Rent silently written as $6,000**.
Fixed at the root (frontend now reads each column's actual `splitSuggestion.parts`) and defended in depth
(backend `extractField` now lets the first column to claim a target field win, for split AND plain columns —
even a misconfigured mapping fails safe by dropping the duplicate, not by corrupting the first value).

**Deliberately NOT built — a decision point, not an oversight:** "TI Paid" / "TI Balance". `tiAllowance`
(the AGREED total) auto-creates a `TI_ALLOWANCE` obligation, but actually recording "TI Paid" as a payment
against it needs `LeaseObligationService.recordPayment()`, which fires a live `tiDisbursed` notification —
correct for a real disbursement, wrong noise for a 2019 historical one. R1's ledger backfill solved the
equivalent problem for rent via a dedicated `settleHistoricalLedger()` bypass; TI would need the same kind of
purpose-built historical-safe path, not a direct call to the live payment API. Needs a explicit decision
before building, not a guess — flagged, not silently skipped.

**"Multiple unit view" request:** re-verified live — Step 3 (Preview) already shows one row per
unit/record in a single table, confirmed against all 9 records of the real file simultaneously. The mapping
screen's "Sample values" column has been relabeled to show the actual record count ("up to 3 of your 9
records") so it reads as multiple records at a glance instead of looking like one blended value.

**Verified:** 2079 API tests / 43 web tests, `tsc` clean both apps. Live E2E: the real client file through
analyze→map→preview (all new fields auto-suggest correctly on the real headers); a synthetic file covering
every new field together through full commit — verified in Postgres (landlordEntity, tenantEmail, tenantPhone,
correct $3,000 Monthly Rent, rentPerSqft, escalationPct, nnnPerSqft/Total, tiAllowance + auto-created
TI_ALLOWANCE obligation, 2 commission installments with correct broker) — then hard-deleted with zero
orphaned rows (cascade confirmed).

### R9.2 — Missing units, active tenancies, broker fallback (2026-08-24, same-day follow-up)

Live-testing R9.1 against the client's real file surfaced three structural gaps beyond field coverage,
all fixed same day, same branch:

**1. Auto-create missing units from the import.** Previously a row whose unit didn't exist just errored
permanently. The preview now lists distinct unresolved unit numbers with an inline Building + Type + Sqft
picker; "Create these units" writes them via the existing `POST /units` (one real, visible, separately-
confirmed write — never silent, never during preview itself) and automatically re-runs the same preview
so newly-resolvable rows flip to ready without a re-upload.

**2. Active (not just historical) tenancies.** A row with no Termination Date is no longer an error — it's
treated as a tenancy that's STILL GOING. `backfillTenancy()` now branches: given a `terminationDate` it
behaves exactly as before; given none, it creates the lease **ACTIVE** (not EXPIRED/TERMINATED), which lets
`create()`'s own `syncUnitFromLease` flip the unit to LEASED for free (dated by `leaseStart`, not today —
same mechanism a live lease already uses). Lease End is still required either way (a contracted term isn't
optional); the same-file overlap check now ranges over `terminationDate ?? leaseEnd`, mirroring the DB's own
`COALESCE` constraint. The ledger is generated complete-and-paid through **today** instead of through a
move-out date — confirmed safe before building: `generateForLease` is append-only
(`createMany` + `skipDuplicates` on `[leaseId, periodMonth]`), so the nightly cron picking up this now-ACTIVE,
`terminationDate: null` lease afterward only adds genuinely new months going forward; it cannot duplicate or
retroactively flag the backdated period as overdue. Investigated via a dedicated research pass before writing
any code, specifically because routing a backdated lease through the ordinary live path *without* this
ledger pre-generation would have silently created months of "overdue" AR and spammed Finance with one
notification per invoice on the next cron run.

**3. Broker fallback for commission installments.** A sheet with commission amounts but no Broker Name
column previously hard-errored every such row. The mapping screen now offers an optional sheet-wide default
broker — pick an existing one, or type a name to create it on the spot — used only for a row that has
commission to attribute and named no broker of its own; it never overrides a row's own (resolved or
unresolved) broker, and the backend independently validates the id is real before trusting it.

**Verified:** 2092 API tests / 43 web tests green, `tsc` clean both apps. Live E2E through actual commit for
each of the three, with Postgres verification and full cleanup after each: (1) a missing unit created inline,
mapped, and its lease committed — unit flipped LEASED, no `deletedAt` orphans; (2) an active-tenancy row
committed — lease `status: ACTIVE`, `terminationDate: null`, unit flipped LEASED, exactly ONE `LEASE_ACTIVATED`
occupancy event (not a manual BACKFILL one), 92 invoices generated through today all `PAID`; (3) both broker-
fallback paths — selecting the existing "Tester" broker, and typing+creating a brand-new one — each correctly
attributed the commission installment and left no other row untouched when it already had its own broker.

### R9.2 bug fixes (2026-08-24, same day — found from the user's own live testing)

The user hit two real bugs while actually using R9.2 against their full 9-record file:

1. **A single unit-creation failure silently broke the whole batch.** `handleCreateMissingUnits` had one
   `try` around the entire create-loop; if any one unit failed (they'd hit exactly this — re-clicking
   "Create these units" after an earlier attempt had already succeeded, so a later click tried to
   re-create a unit that now genuinely existed and got a 409), the `catch` swallowed it and skipped
   `rerunPreview()` entirely — leaving the preview stuck showing "not found" for units that, by then, existed.
   Fixed: each unit is now created independently (a per-item try/catch), successes and failures are both
   toasted, and the preview is **always** re-checked afterward regardless of partial failure — so a
   conflict-because-it-already-exists now self-resolves on the next check instead of getting stuck.
2. **Sqft was in the sheet but never made it to the "create this unit" form.** `TenancyPreviewRow` never
   exposed the row's parsed Sqft at all — the mapping already captured it, it just weren't surfaced. Added
   `sqft` to the row (unit metadata, not lease data, so it sits alongside `unitNumber`/`willBeActive` rather
   than inside `data`) and the frontend now pre-fills the Sqft field for a missing unit from it, editable
   still if the sheet's value needs correcting.

Also fixed the same swallowed-state class of bug in the broker-fallback path: a freshly-created default
broker's name was never cleared from the input, so re-running preview (e.g. right after creating missing
units) would try to create ANOTHER broker with the same name. Now resolved into `defaultBrokerId` and the
text field cleared immediately after creation.

Verified: 2093 API / 43 web tests green. Live E2E reproducing the exact reported scenario — deleted a unit
to force a fresh "missing unit" state, confirmed Sqft (1804, from the sheet) pre-filled correctly, created
it, and confirmed the preview auto-refreshed to show that row resolved with no manual re-upload needed.

### R9.3 — Per-row broker picker (2026-08-24, same-day follow-up)

R9.2's broker fallback was sheet-wide only — one default broker for every unbrokered commission row. Real
data broke that assumption: of 9 rows in the client's actual file, 4 needed a broker fixed and they didn't
share one (some had no broker at all, one already resolved its own). The preview table's Status cell now
renders an inline "Broker for this row" Select (existing brokers) + "Type a new name" Input directly next
to each row's "no Broker Name was set" error, each disabled while the other has a value. "Apply broker
fixes & re-check" creates any new brokers first (deduped by name within the batch), folds every row's
choice into `rowBrokerOverrides: Record<rowNumber, brokerId>`, and re-runs the same preview endpoint —
`validateTenancyRows` resolves a row's own broker first, then a matching row override, then the sheet-wide
default, in that order, so a row override never clobbers a broker the row already resolved for itself.

Verified live against the real 9-record file: fixed 3 of the 4 blocked rows (two by typing new broker
names, one by picking the existing "Tester" broker) and deliberately left the 4th untouched as a control —
preview correctly showed "8 ready, 1 with errors" with only the untouched row still blocked and its picker
still listing the two just-created brokers. Fixed the 4th the same way and confirmed "9 ready, 0 errors."
Never clicked Import — this was a mapping-feature verification pass, not a real commit — then deleted the
two placeholder test brokers ("Row300 Broker", "Row1108 Broker", confirmed zero lease references first) and
the scratch upload file to leave no test residue.

Everything below this line is the original pre-build design; kept as the design record, not a live TODO.

### Why this exists

R1/R2 require the client's team to transcribe old spreadsheets into **our** template before uploading — a
deliberate non-goal in the original spec, chosen because the real sample sheet
(`PRIME TRACKER DETAILS - RENT.xlsx`) is transposed, mixes several values into single cells, and uses
inconsistent date formats, and auto-parsing an unknown, freeform layout for financial data was judged too
fragile to build blind.

The client has now asked for the opposite explicitly: **upload the sheet as-is, in whatever shape it's
already in, no transcription first.** This spec answers that ask directly rather than re-litigating the
original caution — the safety net that made R1 acceptable (nothing is written until a human reviews a
row-by-row preview) is exactly what makes this askable now: a wrong column guess is caught in preview, not
silently written to the ledger.

### Problem Statement

The client's historical spreadsheets are not one consistent shape. The rent sample is **transposed** (each
column is one lease, each row is one field — "Tenant", "Unit Num", "Leased Date", …). Other sheets — sales
trackers, other projects' rent rolls — may be normal **row-per-record** tables with their own header
wording ("Lessee" instead of "Tenant Name", "Start Date" instead of "Lease Start", columns in a different
order, extra columns we don't use). Requiring the client's team to reshape every sheet into our exact
template before every upload is real, recurring manual work — the thing R1 was built to eliminate for the
*data entry*, but not for the *transcription*.

### Goals

1. Accept an uploaded `.xlsx`/`.csv` in **whatever layout it already has** — no pre-transcription into our
   template.
2. Let the user tell the system what each column (or, for a transposed sheet, each row) means, with the
   system's best guess pre-filled so confirming is faster than mapping from scratch.
3. Preserve the same "nothing is written until a human has seen a row-by-row preview" guarantee R1 already
   has — a generic mapper is inherently more likely to misread a cell than a fixed template, so the review
   step matters *more* here, not less.
4. Reuse R1/R2's existing validation, preview, and commit pipeline (unit resolution, overlap checks, R8
   combined-deal splitting, R7 commission installments) rather than duplicating it — this feature is a new
   **front end** that produces the same intermediate row shape `previewImport` already validates, not a
   parallel import path.

### Non-Goals

- **Fully unattended parsing.** The system proposes a mapping; a human confirms or corrects it before
  anything is validated against the database. This is not "upload and forget."
- **Understanding a sheet with no recognizable field labels at all.** If a column's header (or a transposed
  sheet's field-label column) doesn't match any known field and doesn't resemble one closely enough to
  suggest a mapping, it is left unmapped and shown as "not used" — the user can still map it manually, but the
  system won't guess at random.
- **Rewriting R1/R2/R5's underlying validation.** Unit resolution, the overlap check, R8's proportional-split
  logic, and R7's commission handling are unchanged; this feature only changes how raw cells become the input
  rows those already do.
- **A permanent "mapping profile" library in v1** — see Open Questions; worth asking whether this is needed
  before building it, since it's a meaningfully bigger UI than a one-time mapping step.

### Design

**Step 0 (new) — Upload & orientation detection.** User uploads any `.xlsx`/`.csv`. The system reads the raw
grid and guesses orientation:
- If row 1 looks like a header row of *known field synonyms* ("tenant", "unit", "lease start", …) → treat as
  **row-per-record** (like our template).
- Else if column A's values look like known field *labels* themselves (e.g. literally contains cells reading
  "Tenant", "Unit Num", "Leased Date" stacked down the column, the way the real sample does) → treat as
  **transposed** (fields down, one record per remaining column).
- Either way, this is a **guess** the user confirms or flips in Step 1 — never assumed silently.

**Step 1 (new) — Mapping screen.** A table: one row per detected column (or, if transposed, one row per
detected record-column) with:
- The raw header/label text as it appeared in the sheet.
- A sample of its actual values (2–3 real cells), so the user is looking at real data, not guessing blind.
- A dropdown of our known fields (Unit Number, Tenant Name, Lease Start, Monthly Rent, …, "Not used"),
  **pre-selected** by fuzzy-matching the raw header/label against a synonym list per field (e.g. "Tenant",
  "Tenant Name", "Lessee" all suggest Tenant Name; "Leased Date", "Lease Start", "Start Date" all suggest
  Lease Start).
- A flag on any column whose sample values look like they combine more than one thing we track (matches a
  known messy pattern — `$X/$Y` PSF-and-total, a date embedded after a currency amount, multiple emails
  separated by newlines) with a proposed split, shown as two suggested target fields instead of one — e.g. a
  column sampled as `"$34/$8,641.66"` offers to map to *both* Rent PSF (informational) *and* Monthly Rent, by
  splitting on `/`.

**Step 2 (existing, reused as-is) — Preview.** The mapped-and-split data is run through the exact same
validation `previewImport` already does for a template upload (unit resolution, required fields, date logic,
same-file overlap, R8 split, R7 commission linkage) and rendered in the same ready/error table.

**Step 3 (existing, reused as-is) — Commit.** Identical to R1/R2 — `commitImport` composes `backfillTenancy()`
per row.

### Requirements

**Must-Have (P0)**
- Upload accepts any `.xlsx`/`.csv`, not just our template — orientation auto-detected with a visible,
  correctable guess.
- Mapping screen with pre-filled best-guess suggestions per column/row, editable before proceeding.
- Detected "combined cell" patterns (PSF+total, embedded paid-date, multi-value text) are surfaced with a
  proposed split the user can accept or reject — never applied silently.
- Feeds directly into the existing R1/R2 preview → confirm → commit pipeline; no second validation path.
- Works for the Tenancies data specifically first (matches the client's actual sample and this request).

**Nice-to-Have (P1)**
- Extend the same mapping wizard to the Sale History importer (R5) — same component, different target field
  list.
- **Save the confirmed mapping as a reusable profile** ("RRC-style rent roll"), offered as the pre-fill the
  next time a similarly-shaped sheet is uploaded — high value if the client has many project sheets in
  roughly this same transposed shape (per Q6, "10 years of data" across "5 projects"), low value if every
  sheet turns out differently shaped.
- Mapping support for the Ledger Exceptions / Commission Installments auxiliary data too (today those still
  need our template shape even once Tenancies is generically mapped).

**Future Considerations (P2)**
- Auto-detect and offer the same split heuristics for cell patterns not yet seen (learn from corrections
  rather than a fixed pattern list).
- A fully generic "any tabular data" mapper reusable outside the historical-import context.

### Open Questions

- **Q13 (client):** How many genuinely *different* sheet shapes are we actually dealing with — is it really
  "every sheet is different," or is it closer to "one shape per project, repeated," like the RRC sample
  suggests? This changes whether **mapping profiles (P1)** are worth building now or later — reusable profiles
  are far more valuable if the shapes repeat than if each one is unique.
- **Q14 (client):** Can you send 2–3 *more* real sheets (ideally in different shapes, e.g. a sales tracker) so
  the synonym list and the "combined cell" pattern detectors are built against real variety instead of just
  the one rent sample seen twice? Everything in this design is only as good as the examples it was built from.
- **Q15 (engineering, non-blocking):** Should an unmapped-but-clearly-present column (something in the sheet
  that doesn't match any known field) be silently ignored, or surfaced as "N columns in your file weren't
  used — check nothing important was missed"? Recommend the latter — silent data loss on a financial import
  is the wrong default.

### Timeline Considerations

This sits **on top of** the now-delivered R1/R2/R7/R8 pipeline — it changes only how raw rows are produced,
not how they're validated or committed, so it's additive risk, not a rebuild. Rough sequencing: orientation
detection + mapping UI for Tenancies only (P0) is a substantial but self-contained slice; P1's mapping
profiles and Sales-side reuse are naturally a fast-follow once the P0 shape is proven against real client
uploads (not just the one sample sheet).
