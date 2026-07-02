# Prime Tracker — QA Testing Guide (Feature-by-Feature)

> **Purpose:** A point-by-point checklist to test every feature in Prime Tracker. Go through it
> top to bottom, one feature at a time. Each section lists: what the feature does, the things you
> must test (happy path), and the edge cases that break in real use.
>
> **How to use:** Tick each `[ ]` as you verify it. For each feature, test the **happy path first**,
> then walk the **edge cases**. Anything that fails → note the feature + step number and report it.
>
> Codebase verified: June 2026. API = NestJS (`apps/api`), Web = React/Vite (`apps/web`).
> Ports: API `:3001`, Web `:5173`. Swagger: `http://localhost:3001/api/docs`.

---

## Test Environment Setup (do this once before starting)

- [ ] `pnpm run dev` starts both API and web without errors
- [ ] DB migrated and seeded (`pnpm run db:migrate` + `pnpm run db:seed`)
- [ ] You can log in with at least these roles to test permissions: **SUPER_ADMIN/FOUNDER**, **FINANCE**, **PROJECT_MANAGER** (scoped), **SALES**, **VIEWER**
- [ ] Have a test project with: ≥2 buildings, ≥4 units, ≥1 loan, ≥1 sale, ≥1 lease, ≥1 lead, ≥1 milestone
- [ ] Browser console open (catch frontend errors) + watch API logs (catch 500s)
- [ ] Know the seed login: dev role quick-login buttons on LoginPage use password `Prime@123`

**General checks to repeat on EVERY screen:**
- [ ] Empty state renders (no data) without crashing
- [ ] Loading state shows, then resolves
- [ ] Error state shows a friendly message (not a white screen) when API fails
- [ ] A role *without* permission cannot see the tab/page (gated, not just hidden)
- [ ] Money formats consistently (2 decimals); dates format consistently
- [ ] Mobile/narrow width doesn't break layout

---

# 1. Authentication & Login

**What it does:** Google Workspace SSO + email/password login, JWT (15m access / 7d refresh), auto token refresh, MFA (TOTP).

### Happy path
- [ ] Sign in with Google using an `@primedevelopers.com` account → lands on role dashboard
- [ ] Email/password login with valid seed creds works
- [ ] After login, refresh the browser → still logged in (token persisted)
- [ ] Logout → redirected to `/login`, cannot reach protected pages by URL
- [ ] `GET /auth/me` returns the right user + permissions

### Edge cases
- [ ] Google login with a **non-`@primedevelopers.com`** domain → blocked with 403 + clear message, **no account created**
- [ ] Wrong password → "Invalid email or password" (must NOT reveal whether email exists)
- [ ] Deactivated account (`isActive=false`) → login blocked with 403
- [ ] Let access token expire (15m) → next API call auto-refreshes and succeeds (no logout)
- [ ] Revoked/expired refresh token → forced logout → redirect to `/login`
- [ ] Logout "all sessions" → other tab's refresh fails on next call
- [ ] OAuth callback missing params or malformed user JSON → redirect to `/login?error=...` (no crash)
- [ ] Throttle: 11 login attempts in 60s → 429 on the 11th

### MFA (TOTP)
- [ ] MFA setup modal: intro → QR code renders → enter 6-digit code → enabled
- [ ] Enable with a wrong/expired code → rejected, stays on verify step
- [ ] After MFA enabled, sensitive ops (loan create/edit, role change, status toggle) require step-up verify
- [ ] MFA verify with invalid code → 401; throttle 5/min → 429
- [ ] FINANCE/FOUNDER roles see the MFA banner prompting setup

---

# 2. Roles & Permissions (RBAC)

**What it does:** 12+ roles mapped to permission strings (`domain:action`). Field roles (PM, CONSTRUCTION, SALES, MARKETING) are **project-scoped**; leadership/finance see the whole portfolio.

### Things to test
- [ ] Each role lands on its correct default dashboard after login
- [ ] A tab/page the role lacks permission for is **not shown** in nav
- [ ] Hitting a gated route by direct URL → blocked (403/redirect), not silently allowed
- [ ] Scoped PM sees **only their assigned projects**; cannot open a non-member project (404 via ProjectAccessGuard)
- [ ] EXECUTIVE/FOUNDER/FINANCE see **all** projects
- [ ] API returns 403 with the **specific missing permission** when a role calls an unauthorized endpoint

### Edge cases
- [ ] Non-SUPER_ADMIN **cannot** assign the SUPER_ADMIN role (403)
- [ ] A SUPER_ADMIN user can only be modified by another SUPER_ADMIN (403 otherwise)
- [ ] Change a user's role mid-session → old token keeps old perms until next refresh, then updates
- [ ] Promote VIEWER → FINANCE → after refresh, finance pages/tabs appear
- [ ] Role dropdown for a non-SUPER_ADMIN excludes SUPER_ADMIN as an option

---

# 3. Projects

**What it does:** Core entity. List with filters, detail page with 11 role-filtered tabs, computed phase (= max of building phases), soft-delete.

### Happy path
- [ ] Projects list loads; filters/search work
- [ ] Create project → appears in list
- [ ] Open project detail → correct tabs show for your role
- [ ] Edit project fields → persists after reload
- [ ] Delete project (soft-delete) → disappears from list but history preserved
- [ ] Project `phase` reflects the **max** of its buildings' phases

### Edge cases
- [ ] Project with **zero** buildings/units → detail page renders, no crash
- [ ] Tab order is `overview → construction → revenue → units → milestones → leads → draws → vendors → documents → tasks → comments`
- [ ] Deep-link to a tab (`/projects/:id/milestones`) loads that tab directly
- [ ] Deep-link to a tab your role can't see → gracefully redirected/blocked
- [ ] Add a building with a higher phase → project phase rolls **up**; lower → rolls back to new max

---

# 4. Buildings (Construction Tab)

**What it does:** Buildings under a project; can be type `LOT` (raw land, no units). Phase per building; cover photo.

### Happy path
- [ ] Add building (name + projectId required) → card appears with unit count/sqft/stories
- [ ] Edit building (name, sqft, stories, type, phase)
- [ ] Upload / replace / remove cover photo (signed URL loads the image)
- [ ] Delete an **empty** building (no force needed)

### Edge cases
- [ ] Create building on a **CANCELLED** project → blocked (409 conflict)
- [ ] Delete a building **with units** without force → blocked, error states the unit count
- [ ] Delete with `force=true` → cascades unit delete
- [ ] Change one building's phase → project phase recomputes (verify in overview)
- [ ] `LOT` type building (acreage, no units) → handled, doesn't require units
- [ ] Permission: `building:view` to read, `building:edit` to mutate

---

# 5. Budget & Costs (Construction Tab → Financials)

**What it does:** Budget lines by category with revision history; financial summary (budget vs actual vs committed vs forecast vs variance).

### Happy path
- [ ] Add budget line (category, description, baselineAmt required)
- [ ] Edit line; set a `revisedAmt` → revision history shows baseline vs revised
- [ ] Delete budget line
- [ ] Financial summary cards: Budget Total, Actuals, Committed, Variance render correctly
- [ ] Budget-vs-actual chart + per-category table match the numbers

### Edge cases
- [ ] **0 budget lines** → totals all 0, variance 0, no divide-by-zero
- [ ] `revisedAmt < baselineAmt` allowed (shows negative delta)
- [ ] `revisedAmt = null` → summary uses baselineAmt
- [ ] Variance > 0 (under budget) shows green; < 0 (over) shows red
- [ ] **Interior/TI actuals are excluded** from the project budget summary (verify by adding an interior invoice — it must NOT appear here)
- [ ] description length 1–200 chars; negative baselineAmt rejected
- [ ] Add budget line on CANCELLED project → blocked

---

# 6. Commitments & Actuals

**What it does:** Commitments = vendor spend lines (contractAmt, paidToDate, retainage). Actuals = real spend (manual or QB-synced).

### Commitments
- [ ] Add commitment (vendor, description, contractAmt > 0, category required)
- [ ] Outstanding = `contractAmt − paidToDate − retainage` (verify it flows into cashflow first month)
- [ ] Edit paid/retainage → outstanding recalculates
- [ ] Delete commitment
- [ ] **Edge:** contractAmt = 0 → rejected (must be positive)
- [ ] **Edge:** paidToDate > contractAmt → allowed (over-payment tracking), outstanding can go negative
- [ ] **Edge:** amounts beyond 2 decimals → rejected

### Actuals
- [ ] Project actuals list shows newest first, **excludes interior** actuals
- [ ] QB unmapped list shows only `qbSyncStatus=UNMAPPED`
- [ ] Map an unmapped txn to project + category → leaves the unmapped list
- [ ] **Edge:** negative actual (refund) allowed; QB re-sync of same txn id is idempotent (no dup)

---

# 7. Contracts, Change Orders & Vendors (Vendors Tab)

**What it does:** Formal contracts with change orders (only APPROVED ones change the total) and payments. Vendor master list.

### Happy path
- [ ] Create vendor (name required; contact/email/phone/trade optional)
- [ ] Create contract (vendor, description, originalAmount) → status defaults DRAFT, currentAmount = original
- [ ] Add change order → status PENDING, auto-numbered
- [ ] **Approve** change order → `currentAmount = original + sum(approved COs)`
- [ ] **Reject** change order → status REJECTED, currentAmount **unchanged**
- [ ] Record a payment; summary `pctComplete = totalPaid / totalCurrent`

### Edge cases
- [ ] Approve CO1, add CO2, approve CO2 → total = original + CO1 + CO2
- [ ] Approve same CO twice → idempotent (no double counting)
- [ ] Negative change order (credit) → handled
- [ ] Payment > currentAmount → allowed (over-payment), summary still sane
- [ ] `totalCurrent = 0` → pctComplete = 0 (no divide-by-zero)
- [ ] Delete a vendor that has commitments/contracts → verify intended behavior (block vs cascade)
- [ ] Permission: `vendor:view` / `vendor:edit`

---

# 8. Loans

**What it does:** Project/Building/Unit polymorphic loans. **Sensitive fields encrypted** (lender, principal, rate, balance). MFA required to create/edit. Monthly debt service aggregation.

### Happy path
- [ ] Add loan (loanType, lender, principalAmt > 0, rate 0–100, termMonths > 0; **MFA prompt** appears)
- [ ] Loans table shows type, lender, principal, rate, balance, monthly payment, maturity
- [ ] Monthly debt service = sum of monthly payments; annual = ×12
- [ ] Edit loan → re-saves; changing lender/rate re-encrypts silently (GET still returns decrypted)

### Edge cases
- [ ] Loan with **projectId only** → ok
- [ ] Loan with **buildingId only** → service back-fills projectId from the building
- [ ] Loan with **neither** project nor building → rejected (400)
- [ ] Loan with a non-existent building → 404
- [ ] Create/edit **without MFA** → blocked
- [ ] Rate > 100 or > 4 decimals → rejected; principal ≤ 0 → rejected
- [ ] Building-level loan shows up in the **project-level** loan list (OR filter)
- [ ] Permission: `loan:view` read, `loan:edit` write + MFA

---

# 9. Draws (Draws Tab) — Approval Workflow ⭐

**What it does:** Construction draw state machine: `DRAFT → SUBMITTED → APPROVED → FUNDED`, with reject/cancel/revise. Required-document gates. Funding auto-creates an Actual.

### State machine — test each transition
- [ ] Create draw (auto draw number increments per loan)
- [ ] **Submit** (DRAFT→SUBMITTED) requires `SWORN_STATEMENT` + `VENDOR_INVOICE` docs
- [ ] **Approve internal** (SUBMITTED→APPROVED) requires **all 4** docs (LIEN_WAIVER, INSPECTION_REPORT, SWORN_STATEMENT, VENDOR_INVOICE)
- [ ] **Submit to lender** → stays APPROVED, records the step + timestamp
- [ ] **Mark funded** (APPROVED→FUNDED) → an **Actual** is auto-created (category HARD_COSTS, qbTxnId `draw:{id}`)
- [ ] **Reject** (from SUBMITTED or APPROVED) requires a reason → REJECTED
- [ ] **Revise** a REJECTED draw → back to DRAFT
- [ ] **Cancel** from any non-terminal state → CANCELLED

### Edge cases
- [ ] Submit missing a required doc → blocked, error **lists the missing doc types**
- [ ] Approve with only 3 of 4 docs → blocked
- [ ] **Mark funded twice** → Actual NOT duplicated (idempotent on qbTxnId)
- [ ] Reject with **empty reason** → rejected
- [ ] Cannot transition out of FUNDED or CANCELLED (terminal)
- [ ] Delete a draw → only allowed in DRAFT
- [ ] Document checklist shows uploaded count per type; upload/delete docs reflects live
- [ ] Approval audit trail shows actor, step, action, comment, timestamp in order
- [ ] Concurrent draws on one loan still get unique sequential numbers
- [ ] Permission: `draw:view` / `draw:edit` / `draw:approve`

---

# 10. Cashflow Forecast

**What it does:** 12-month (configurable) projection merging inflows (sale payments, lease income, draw schedule, manual) and outflows (loan payments, subcontractor AP, interior TI, commissions, misc). "Obligations" re-buckets outflows by M/Q/Y.

### Happy path
- [ ] Forecast renders a monthly timeline with inflow/outflow per source
- [ ] Loan monthly payment appears each month until maturity, then stops
- [ ] Active lease income appears across the lease term (with escalation if configured)
- [ ] Sale payment installments appear as inflow (outstanding only = amount − paid)
- [ ] Commitment outstanding lands in the first month as a near-term payable
- [ ] Obligations panel switches M / Q / Y granularity

### Edge cases
- [ ] `months > 60` → clamped to 60; `months < 1` → clamped to 1
- [ ] **Empty project** (no sales/leases/loans/commitments) → all months 0, no crash
- [ ] Lease escalation only applies when both escalationPct > 0 **and** escalationFreq > 0
- [ ] All amounts rounded to 2 decimals
- [ ] Portfolio forecast respects role scope (PM sees only their projects; founder sees all)
- [ ] Draw scheduled outside the horizon → excluded
- [ ] Permission: `financial:view`

---

# 11. Milestones (Milestones Tab)

**What it does:** Milestones with dependencies (cycle-checked), slippage propagation to dependents, optional draw-schedule link, photos. Auto-stamps `completedAt`.

### Happy path
- [ ] Add milestone (title, status, dueDate required)
- [ ] Mark COMPLETED → `completedAt` auto-set to now
- [ ] Set a dependency (A depends on B)
- [ ] "Can start?" check returns blocked reason if dependency not complete
- [ ] Upload/remove milestone photos (signed URL renders)

### Edge cases
- [ ] Create a dependency **cycle** (A→B→C→A) → rejected
- [ ] Self-dependency (A→A) → rejected
- [ ] Clear dependency (set to null) → allowed
- [ ] `canStart` = false when dependency is NOT_STARTED / IN_PROGRESS; true when COMPLETED
- [ ] Mark COMPLETED twice → `completedAt` unchanged (idempotent)
- [ ] **Slippage:** move a milestone's dueDate **later** → all non-complete dependents shift by the same delta (verify transitive A→B→C cascade)
- [ ] Move dueDate **earlier** or on a completed milestone → no propagation
- [ ] Milestone with a linked draw schedule, marked COMPLETED → **auto-drafts a DrawRequest** (DRAFT); completing again does not duplicate it
- [ ] Permission: `milestone:view` / `milestone:edit`

---

# 12. Units & Inventory

**What it does:** Units under buildings; status lifecycle; time-on-market (`availableSince`); combine adjacent units into one legal unit.

### Happy path
- [ ] Create unit (must select a building) → defaults AVAILABLE, `availableSince` set
- [ ] Units tab groups units by building; filter to one building works
- [ ] Inventory page: cross-project grid, status filter, search
- [ ] Time-on-market bar: green (0–30d) → yellow (30–60) → orange (60–90) → red (90+)
- [ ] Quick-edit unit status from inventory

### Edge cases
- [ ] Status transitions follow the matrix (e.g., AVAILABLE→UNDER_CONTRACT→SOLD); SUPER_ADMIN/FOUNDER can override
- [ ] AVAILABLE→UNDER_CONTRACT→CANCELLED → `availableSince` **restarts** (clock resets)
- [ ] Unit flipped to SOLD/LEASED → `availableSince` cleared (bar disappears)
- [ ] **Combine units:** select 2+ units in the **same building** → new merged unit, sources archived (soft-deleted, `mergedIntoId` set), summed area
- [ ] Combine with a unit that has an **active sale/lease/interior project** → blocked
- [ ] Combine across different buildings → blocked
- [ ] Combined unit number collides with existing → blocked with suggestion
- [ ] SALES role tries to combine → blocked (permission)
- [ ] Historical sales/leases stay on the original units, reachable via merge history

---

# 13. Sales Pipeline (Revenue Tab)

**What it does:** Sale lifecycle PROSPECT → LOI_SIGNED → UNDER_CONTRACT → CLOSED/CANCELLED. Polymorphic (unit XOR building). Discount approval gate, broker commission on close, payment schedules, weighted forecast.

### Happy path
- [ ] Create sale (exactly one of unitId/buildingId; asset must belong to the project)
- [ ] Move through stages; pipeline view shows counts + velocity
- [ ] **Close** a sale → atomic: unit flips to **SOLD**, `availableSince` cleared, broker commission stamped
- [ ] Cancel a sale (with lostReason) → if unit was UNDER_CONTRACT, it flips back to AVAILABLE, clock restarts
- [ ] Weighted forecast: probabilities PROSPECT 10% / LOI 35% / UNDER_CONTRACT 75% / CLOSED 100%; `closedYtd` separate

### Edge cases
- [ ] Sale attached to a unit from a **different project** → rejected
- [ ] Both unit + building, or neither → rejected
- [ ] **Discount gate:** sale price below asking by more than the org threshold (default 5%) → committing to UNDER_CONTRACT/CLOSED is **blocked** until a Founder/Co-Founder approves
- [ ] After approval, changing the discount again requires re-approval
- [ ] Building-level sale (no asking price) → bypasses discount check
- [ ] **Broker commission precedence:** per-sale override % → broker default rate % → broker flat fee; verify `$1M × 2.5% = $25,000` exactly (no float dust)
- [ ] Close a sale **twice** (concurrent) → only one stamps commission (optimistic lock)
- [ ] Delete a CLOSED sale → only Founder/SuperAdmin allowed
- [ ] Sale with no broker → no commission stamped

### Sale payment schedule
- [ ] Add installment (FIXED_DATE needs dueDate; ON_MILESTONE needs milestoneId)
- [ ] Seed from template (e.g., 10-40-50) → 3 installments at correct % of sale price
- [ ] Seeding when a schedule already exists → blocked
- [ ] Log a partial payment → status SCHEDULED→PARTIALLY_PAID, outstanding updates; pay rest → PAID
- [ ] Log payment **greater than outstanding** → rejected
- [ ] Edit an installment **below the already-paid** amount → rejected
- [ ] Milestone-linked installment becomes DUE when the milestone completes

---

# 14. Leases (Revenue Tab → Rent Roll)

**What it does:** Leases (unit or building); rent roll; feeds cashflow lease income; expiry notifications.

### Happy path
- [ ] Create lease (tenant, rent, start/end, status)
- [ ] Active lease shows in rent roll + monthly lease income
- [ ] Edit / terminate / expire a lease
- [ ] Tenant profile panel shows tenant details

### Edge cases
- [ ] Lease income only counts **ACTIVE** leases across their term
- [ ] Escalation applies per configured pct/frequency in cashflow
- [ ] Lease expiring in 30d / 7d → triggers the expiring notifications
- [ ] OWNER_OCCUPIED status handled
- [ ] Permission: `lease:view` / `lease:edit`

---

# 15. Leads (Leads Tab + Global)

**What it does:** Lead lifecycle NEW → … → CONVERTED/LOST/DEAD. Polymorphic, UTM/campaign attribution, multi-unit interest (waitlist), activity timeline, convert-to-sale.

### Happy path
- [ ] Create lead (name, source, etc.; throttled 5/min)
- [ ] Add activities (CALL/EMAIL/MEETING/SITE_VISIT/FOLLOW_UP/NOTE) → timeline updates, `updatedAt` bumps
- [ ] Add unit-of-interest → appears on that unit's waitlist (oldest first)
- [ ] **Convert to sale** → atomic: unit reserved UNDER_CONTRACT, sale created, lead marked CONVERTED
- [ ] Lead dashboard: funnel by status, source pie, conversion rate, stale list, attribution coverage

### Edge cases
- [ ] Lead attached to unit from another project → rejected; both unit+building → rejected
- [ ] Convert when unit already SOLD/UNDER_CONTRACT → rejected (race-safe via optimistic lock)
- [ ] Convert an already-CONVERTED lead → blocked
- [ ] Stale detection: lead untouched >14 days and not terminal → appears in stale list; CONVERTED/LOST excluded even if old
- [ ] Waitlist excludes soft-deleted units; ordering = first to express interest is #1
- [ ] `utmCampaign` text matches an active campaign by name (case-insensitive) → resolves `campaignId`
- [ ] Multiple leads add interest in one unit → waitlist positions correct

---

# 16. Campaigns & Marketing

**What it does:** Marketing spend by channel + lead-to-sale attribution (CPL, CPA, ROI). Soft-delete preserves attribution.

### Happy path
- [ ] Create campaign (name, channel; projectId optional for cross-project)
- [ ] Record spend (amount, date, source); dedup by `externalRef`
- [ ] Performance table: leads, revenue, CPL, CPA, ROI
- [ ] Spend-trend chart grouped by channel (default 6 months)

### Edge cases
- [ ] CPA counts **only CONVERTED** leads (spend / conversions)
- [ ] Campaign with 0 spend → CPL/ROI handled (no divide-by-zero / shows n/a)
- [ ] Duplicate spend with same `externalRef` → deduped
- [ ] Soft-delete a campaign → leads keep `campaignId`, attribution history intact
- [ ] Cross-project campaign (projectId null) → rolls into the right project views
- [ ] Permission: `campaign:view`

---

# 17. Brokers

**What it does:** Broker records (no login). Track leads brought, closed sales, commission earned. Soft-delete.

### Things to test
- [ ] Create broker (name required; commission rate % OR flat fee)
- [ ] Edit broker; toggle active/inactive
- [ ] Broker detail shows recent leads + sales
- [ ] Performance report: leads, closed sales, commission earned, conversion rate
- [ ] **Edge:** commission rounding exact (`$1M × 2.5% = $25,000`)
- [ ] **Edge:** soft-delete a broker → historical sales keep commission visible
- [ ] **Edge:** broker with 0 leads → conversion = 0/null, no crash
- [ ] **Edge:** inactive brokers excluded from the report (confirm intended)

---

# 18. Interior / Fit-Out Module

**What it does:** Tenant-improvement projects per unit/building. Phases DESIGN → CLIENT_APPROVAL → CITY_APPROVAL → PROCUREMENT → EXECUTION → SNAGGING → HANDOVER. Isolated TI budget, BOQ scope, sub-contractor invoices, snagging, document gates.

### Happy path
- [ ] Portfolio page lists all fit-outs with phase, contract value, spend, days-to-handover; stat cards correct
- [ ] Create interior project from a unit (name required; rate/sqft prefilled)
- [ ] Edit fields (PM, rate, area, contract value, dates)
- [ ] Advance phase step by step; progress bar updates
- [ ] Approve Client / Approve City buttons stamp timestamps (interior:approve role)
- [ ] Handover signoff modal collects signer + notes before final advance → status COMPLETED
- [ ] Delete → soft-delete + status CANCELLED

### Phase gates (edge cases)
- [ ] Phases are **forward-only**; cannot skip or go back
- [ ] PROCUREMENT/EXECUTION blocked until the **shell** (unit/building phase) is LEASE_UP/STABILIZED/SOLD_REFI → red banner, button disabled
- [ ] EXECUTION blocked until a **CITY_APPROVAL** document is on file
- [ ] HANDOVER blocked until a **HANDOVER_CERTIFICATE** document is on file
- [ ] Cannot set COMPLETED directly via edit (must reach HANDOVER)

### BOQ
- [ ] Add BOQ line (description, category, qty > 0, unitPrice > 0) → line total = qty × unitPrice
- [ ] Variance indicator: BOQ total vs contract value (overage warning)
- [ ] Delete BOQ line

### Invoices (TI budget isolation)
- [ ] Log a sub-contractor invoice → creates a **paired Actual** tagged with `interiorProjectId`
- [ ] That Actual is **excluded** from the main project budget (verify in §5)
- [ ] Duplicate invoice number → blocked (idempotent)
- [ ] Permission: `interior:view` / `interior:edit` / `interior:approve` / `interior:finance`

---

# 19. Snagging / Punch List

**What it does:** Defect tracking inside an interior project. OPEN → IN_PROGRESS → RESOLVED, assignee, room.

### Things to test
- [ ] Add snag (description required; room/assignee optional)
- [ ] Filter tabs ALL / OPEN / IN_PROGRESS / RESOLVED
- [ ] Resolve a snag → status RESOLVED, `resolvedAt` set, progress bar updates
- [ ] Status badge colors: OPEN red, IN_PROGRESS amber, RESOLVED green
- [ ] **Edge:** cannot un-resolve via UI
- [ ] **Edge:** unassigned snag shows "Unassigned"; deleted assignee → "Unassigned"
- [ ] **Edge:** empty filter shows the right empty message
- [ ] Snag-overdue notification fires to PM/Construction roles

---

# 20. Daily Construction Logs

**What it does:** Per-project/building daily site logs with notes, weather, crew count, and photos.

### Things to test
- [ ] Add log (notes required; logDate defaults today; weather/crew optional)
- [ ] Attach multiple photos (presigned upload) → thumbnails render via signed URL
- [ ] Feed ordered newest first (logDate desc, then createdAt)
- [ ] Edit / delete a log (author or PM)
- [ ] **Edge:** one photo upload fails → log still saved, toast shown, retry possible
- [ ] **Edge:** invalid storagePath (absolute path, `..`, external URL) → rejected
- [ ] **Edge:** building-scoped feed hides the building picker; project-level requires/permits null building
- [ ] Permission: `dailylog:view` / `dailylog:edit`

---

# 21. Documents (Documents Tab + Vault)

**What it does:** Versioned document vault, multi-scope (project/building/unit/sale/lead/interior). Presigned Supabase upload, soft-delete, `isClientVisible` for buyer portal, signed download URLs.

### Things to test
- [ ] Upload via multipart (≤ 50 MB) with category + display name
- [ ] Presigned upload flow: get URL → browser PUTs file → record saved
- [ ] List filters by scope (projectId/buildingId/unitId/interiorProjectId)
- [ ] Download → redirects to a signed URL (1-hour expiry)
- [ ] Re-upload (new version) → prior version archived, version number increments
- [ ] Soft-delete → removed from list, file removed from storage, history kept
- [ ] **Edge:** file > 50 MB → rejected ("file too large")
- [ ] **Edge:** display name with/without extension → extension not doubled
- [ ] **Edge:** `externalUrl` doc (e.g., DocuSign) → returned as-is, no signing
- [ ] **Edge:** toggle `isClientVisible` → only then visible to buyer-portal (CLIENT) role
- [ ] Permission: `document:view` / `document:upload`

---

# 22. Tasks (Tasks Tab + Global)

**What it does:** Project-scoped tasks, status TODO/IN_PROGRESS/DONE, priority, assignment, comments, attachments (≤25 MB).

### Things to test
- [ ] Create task (title + projectId required; status→TODO, priority→MEDIUM defaults)
- [ ] Filter by assignee/status/priority/search; ordering due-date asc then created desc
- [ ] Edit task; change status/priority/assignee/due date
- [ ] Add comment (content required); delete comment
- [ ] Upload attachment (≤25 MB); download; delete
- [ ] **Edge:** non-creator (non-PM+) edits/deletes a task → blocked with clear message
- [ ] **Edge:** non-author (non-Founder) deletes a comment → blocked
- [ ] **Edge:** attachment > 25 MB → 413 rejected
- [ ] **Edge:** deleting a task cascades its comments/attachments
- [ ] **Edge:** assignee deactivated → shows gracefully (not a crash)

---

# 23. Comments (Project + Unit)

**What it does:** Unit-level and project-level comments, 3 types (MARKETING purple / SALES blue / FINANCIAL green), ownership-gated edit/delete, type-based notifications.

### Things to test
- [ ] Create unit comment and project comment (content + type)
- [ ] Comments sort: **MARKETING → SALES → FINANCIAL**, then newest first within each
- [ ] Type chips show correct colors
- [ ] Edit your own comment; delete your own comment
- [ ] Recent comments appear on the dashboard grouped by type
- [ ] **Edge:** create with neither unitId nor projectId → 400
- [ ] **Edge:** edit/delete **another user's** comment → 403
- [ ] **Edge:** SUPER_ADMIN/FOUNDER can delete any comment
- [ ] **Edge:** creating a FINANCIAL comment notifies Finance/Accounting roles (if opted in); SALES→Sales/Exec; MARKETING→Marketing/Sales

---

# 24. Unit Detail Page

**What it does:** Per-unit dashboard: metrics, activities, sales/leases, comments thread, documents, sold-unit panel, sale payment panel.

### Things to test
- [ ] Metrics: sqft, type, lease income, days-on-market
- [ ] Inline comments thread with type selector
- [ ] Sales/lease panels reflect attached records
- [ ] Sold-unit panel (read-only) shows buyer, price, deposit, dates, broker, commission
- [ ] Documents scoped to the unit
- [ ] **Edge:** unit with no sales/leases/docs → clean empty states

---

# 25. Dashboards (Role-Specific)

**What it does:** Founder, Finance, Sales, Construction dashboards aggregating KPIs, charts, milestones, comments, exception feed. 60s cache, invalidated on writes.

### Things to test (per dashboard)
- [ ] **Founder:** project counts, total budget/actuals, variance, loan book, phase pie, units-by-status bar, recent milestones, recent comments, exception feed
- [ ] **Finance:** budget vs actuals, loan book, monthly service, receivables widget, exceptions
- [ ] **Sales:** pipeline by status, lead funnel, conversion, recent deals
- [ ] **Construction:** milestones, snags, build progress (CONSTRUCTION role sees **no** financials)
- [ ] Exception feed shows top 5, "expand" reveals all; clicking an exception navigates to the right page

### Edge cases
- [ ] Non-Founder hitting `/dashboard/founder` → 403
- [ ] CONSTRUCTION hitting `/dashboard/finance` → 403
- [ ] Scoped PM dashboard shows **only assigned projects'** data
- [ ] Edit a project budget → dashboard cache invalidates, numbers update (within 60s / on refresh)
- [ ] Zero projects → charts render empty, KPIs 0 (no crash)

---

# 26. Reports

**What it does:** Cross-project analytics: Portfolio, Sales, Revenue, Debt, Unit-sales, Vacancy. Permission-gated; printable.

### Things to test
- [ ] Portfolio report (needs `financial:view`): KPIs, budget-vs-actual chart, per-project table, project filter
- [ ] Sales report (`sales:view`)
- [ ] Revenue report (`lease:view`)
- [ ] Debt report (`loan:view`)
- [ ] Vacancy report (`sales:view`): available units by time-on-market, `minDays` filter, optional project filter
- [ ] Print button opens print dialog cleanly
- [ ] **Edge:** role without the permission → 403 per report
- [ ] **Edge:** zero data → empty charts, KPIs 0
- [ ] **Edge:** variance with zero budget → no divide-by-zero

---

# 27. Investors

**What it does:** Equity positions, capital calls (PENDING/PAID/OVERDUE), distributions (RETURN_OF_CAPITAL/PREFERRED_RETURN/PROFIT_SHARE).

### Things to test
- [ ] Create/edit investor (name, email, phone, entityName)
- [ ] Investors list shows computed totals (committed, called, distributions)
- [ ] Summary KPIs correct
- [ ] Add equity position (project, % ownership, committed amount) → allocation pie
- [ ] Create capital call → mark PAID → status changes
- [ ] Record distribution → distributions-by-year chart
- [ ] **Edge:** capital call due-date past + still PENDING → shows OVERDUE
- [ ] **Edge:** mark a paid call PAID again → idempotent
- [ ] **Edge:** investor with zero positions → totals 0
- [ ] Permission: `investor:view` read, `investor:manage` write

---

# 28. Notifications & Preferences

**What it does:** In-app + email notifications, 11+ types, per-user opt-out, daily 8AM CT cron (overdue milestones, leases 30/7d, loan maturity 60d, budget variance >10%).

### Things to test
- [ ] Bell icon shows unread count; panel lists notifications; polls ~30s
- [ ] Mark one / mark all as read → `readAt` set
- [ ] Settings page: toggle a type **off** → that type no longer delivered
- [ ] Toggle back **on** → delivered again
- [ ] Trigger types fire to the right roles (e.g., MILESTONE_OVERDUE → Founder/Exec/PM, not CONSTRUCTION)
- [ ] Comment notifications route by type (FINANCIAL→Finance, etc.)
- [ ] **Edge:** SMTP down → in-app notification still created, email failure logged (not fatal)
- [ ] **Edge:** inactive user → no email
- [ ] **Edge:** WhatsApp channel shows "coming soon" (disabled)

---

# 29. Admin & Organizations

**What it does:** User management (create/edit/role/status/delete), audit log, QuickBooks status, organizations (US/India entities, LEAD/EMPLOYEE members).

### Things to test
- [ ] Users tab: list, search, role filter; create user (defaults VIEWER); edit name/email
- [ ] Change role → **MFA required**; toggle active/inactive → **MFA required**
- [ ] Soft-delete user → audit log records DELETE
- [ ] Audit log paginates; shows LOGIN, ROLE_CHANGE, etc. with actor + metadata
- [ ] Roles tab shows the role→permission matrix
- [ ] Organizations: create (name, entityType US/India), add/remove members, deactivate
- [ ] **Edge:** edit user email to an existing email → 409 conflict
- [ ] **Edge:** no `user:manage` → /users blocked (403); no `org:manage` → org ops blocked
- [ ] **Edge:** QB sync requires `quickbooks:manage`; sync error logged in audit

---

# 30. QuickBooks Integration (caveat — unverified against live creds)

**What it does:** OAuth + REST sync of vendors/bills/payments. Code exists but **not validated against live QuickBooks credentials** — treat go-live as a separate task.

### Things to test (when creds available)
- [ ] OAuth connect flow completes
- [ ] Sync pulls vendors/bills/payments → land as Actuals (unmapped until mapped)
- [ ] Re-sync is idempotent (no duplicate Actuals — dedup on qb txn id)
- [ ] Sync status endpoint reflects last run + errors
- [ ] **Until creds exist:** confirm the UI degrades gracefully (status shows "not connected", no crash)

---

# Cross-Feature Integration Tests (the "glue" — test these last)

These chain modules together and are where subtle bugs hide:

- [ ] **Milestone → Draw:** complete a milestone linked to a draw schedule → DrawRequest auto-drafts (DRAFT); re-completing doesn't duplicate
- [ ] **Draw → Actual:** mark a draw FUNDED → Actual auto-created (HARD_COSTS); marking funded twice → no duplicate
- [ ] **Commitment → Cashflow:** set contractAmt/paid/retainage → outstanding shows in cashflow first-month payable; update paid → next forecast reflects it
- [ ] **Loan → Cashflow:** loan monthly payment recurs each month until maturity, then stops
- [ ] **Lead → Sale:** convert a lead → unit reserved, sale created, lead CONVERTED (all-or-nothing transaction)
- [ ] **Sale close → Unit + Broker:** close sale → unit SOLD + `availableSince` cleared + broker commission stamped, all atomic
- [ ] **Interior invoice → Budget isolation:** interior invoice creates a TI Actual that does NOT pollute the main project budget summary
- [ ] **Comment → Notification:** create a typed comment → correct roles notified (respecting opt-out)
- [ ] **Building phase → Project phase:** change a building phase → project phase recomputes to the max
- [ ] **Unit combine → History:** combine units → sources archived, sales/lease history preserved on originals

---

# Non-Functional / Quality Pass

- [ ] **Security:** every API route requires auth (no anonymous access); permission gates enforced server-side, not just hidden in UI
- [ ] **Audit:** sensitive actions (login, role/status change, MFA, deletes, QB sync) appear in the audit log
- [ ] **Encryption:** loan sensitive fields are encrypted at rest (DB shows ciphertext), decrypted only on authorized read
- [ ] **Money/precision:** no floating-point dust on commissions, variance %, forecast totals (all 2 dp; rates 4 dp)
- [ ] **Dates:** ISO on the wire, consistent timezone (UTC internally, CT for cron); no off-by-one on month boundaries
- [ ] **Concurrency:** double-submit (close sale / fund draw / convert lead twice) never double-applies
- [ ] **Soft-deletes:** deleted records vanish from lists but preserve historical references (no orphan crashes)
- [ ] **Error handling:** 401 auto-refreshes; 403 shows a clear "no permission"; 404 doesn't white-screen; 500 surfaces a toast
- [ ] **Performance:** large lists (inventory, leads, audit) paginate or stay responsive
- [ ] **Accessibility:** key forms/selects have labels; modals are keyboard-navigable

---

## Suggested testing order (per session)

1. **Auth + RBAC** (gates everything else)
2. **Projects → Buildings → Units** (the data spine)
3. **Construction financials** (Budget, Commitments, Actuals, Contracts, Loans, Draws, Cashflow)
4. **Milestones** (+ draw auto-draft glue)
5. **Revenue** (Sales, Leases, Sale Payments)
6. **Leads → Campaigns → Brokers** (acquisition chain)
7. **Interior + Snagging + Daily Logs** (the new module)
8. **Documents + Tasks + Comments** (collaboration)
9. **Dashboards + Reports + Investors + Notifications**
10. **Admin/Orgs + QuickBooks**
11. **Cross-feature integration tests + non-functional pass**

---

*Generated from a code-level review of the live codebase. If a step's actual behavior differs from
what's written here, the behavior is the source of truth — flag the mismatch so this guide (and possibly
the code) gets corrected.*
