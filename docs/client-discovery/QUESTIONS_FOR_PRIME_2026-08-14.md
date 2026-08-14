# Questions for Prime Developers

Compiled 2026-08-14 by auditing the live codebase module by module (7 parallel passes) and
reconciling against the prior discovery record. 55 open items across 8 modules. Priority key:
🔴 Blocking · 🟠 Important · 🟢 Good to know.

Focused client decision packet for sales/leasing/project-status policy answers:
`docs/client-discovery/CLIENT_DECISION_QUESTIONS_2026-08-14.md`.

---

## 1. Projects & Organizations

1. 🔴 Is the buyer portal (`CLIENT` role) actually scheduled for this cycle, or should it stay
   unstarted? — `CLIENT` isn't in the permissions map at all (resolves to zero permissions), and
   there's no buyer-facing route anywhere in the frontend. Schema stub only.
2. 🔴 Should archiving a project cascade to its buildings/units/sales, and should status actually
   flip to `CANCELLED` as the API docs claim? — today only `deletedAt` is set; everything
   underneath stays fully live. (`projects.service.ts`)
3. 🟠 Should units under an archived/deleted project still show up in the cross-project Inventory
   page and reports? — a gap in the ownership-chain check lets them leak through today.
4. 🟠 Should Organization membership (US vs India) actually restrict data visibility, or is it
   purely a labeling/reporting field for now? — no org-based access boundary exists yet.
5. 🟠 Confirm: Founders/Super Admins are deliberately excluded from ever joining an Organization —
   intended, given US and India are separate legal entities?
6. 🟢 Confirm this matches intent: only Super Admin, Founder, and Project Manager can create/edit
   projects; only Super Admin/Founder can delete.
7. 🟢 Should project-team member roles be a fixed list instead of free text? Typos succeed silently
   today.
8. 🟢 Any near-term need for real LLC/entity-level P&L per building? `Building.llcName` is
   deliberately a text label today, not a real entity relation.

## 2. Buildings

1. 🔴 Should force-deleting a building with leases/sales/loans attached be permanent, or soft-delete
   like the rest of the app? — today it's a true hard delete that permanently erases sale/lease/loan
   history underneath. Same applies to deleting a unit directly. (`units.service.ts:447`,
   `buildings.service.ts:108-122`)
2. 🔴 Should that force-delete require a stricter permission than ordinary editing? — anyone who can
   edit a building can currently wipe every sale/lease beneath it. (`buildings.controller.ts:59-61`)
3. 🟠 Should the delete-confirmation dialog show full blast radius (lease/sale/loan counts), not just
   unit count?
4. 🟠 Should a unit's type be constrained by its parent building's type (e.g. no Event Center unit in
   a purely Residential building), or is mixing intentional for Mixed-Use?
5. 🟠 Does `Building.totalSqft` need to reconcile against the sum of its units' sqft? Independent
   numbers today, can silently drift.
6. 🟢 Do LOT (raw land/acreage) buildings need a dedicated land report? Unit-driven reports show
   nothing for them today.

## 3. Units

1. 🟠 Should Under Construction → Available require confirmed milestone completion, or stay a PM
   judgment call as it works today? Nothing currently blocks it mid-build. (`units.service.ts:15-27`)
2. 🟠 Are the 8 seeded unit types (Retail, Medical, Flex, Residential Lot, Commercial Lot, Office,
   Restaurant, Event Center) still complete/correct? Notably no plain "Residential" unit type exists.
3. 🟢 See Buildings item 1 — unit deletion carries the same permanent-history risk.

## 4. Tenants & Leasing

Most of the hard questions here (free-rent math, backfilling old leases, ending/transferring a
tenancy) are already answered and built. What's left:

1. 🔴 Has Prime ever sold a tenanted unit to an outside investor, rather than the sitting tenant
   buying? The system only handles "sitting tenant buys" today. Same question as Sales item 4.
2. 🟠 Reconfirm holdover rent: system bills at same rent by default per your instruction — US retail
   norm is usually 125–150% specifically to discourage overstaying. Worth one more check before it
   bills live tenants.
3. 🟠 Editing a past, already-invoiced rent period needs a Finance call — periods are frozen once
   invoices exist; reopening needs "correction with a visible trail," not silent edit.
4. 🟢 Operational: a handful of production units may show Sold with an active lease and no linked
   sale record. Looked like test data in dev — worth a one-time check against production.

## 5. Sales

Payment schedule, discount approval, and broker commissions are built and locked.

1. 🔴 Sale cancellation refund/penalty — the cancellation screen collects refund/penalty amounts but
   they're discarded; nothing records what happens to the money. (`CancelSaleModal.tsx`,
   `sales.service.ts:314-355`)
2. 🔴 Can a cancelled sale be reopened? Nothing currently blocks reviving a dead deal.
3. 🟠 Unit-swap mid-contract — no code path exists today; needs designing if it should be possible.
4. 🟠 Third-party sale of a tenanted unit — every sale close today unconditionally ends the lease,
   assuming the buyer is the sitting tenant. See Tenants item 1.
5. 🟠 Are the weighted forecast probabilities by stage (10/35/75/100%) real numbers or a placeholder?
   A per-org override exists in the schema but the forecast endpoint never uses it.
6. 🟢 Should LOI_SIGNED require the LOI document attached first? No document check exists on any
   stage transition today.
7. 🟢 Confirm the two payment-schedule templates (10/40/50 and 30/40/30) are Prime's real templates.

## 6. Construction

Daily logs are fully built and already the client favorite.

**Milestones & Interior/Fit-Out**
1. 🔴 Should Handover be blocked while any snag (punch-list item) is still open? Nothing checks this
   today.
2. 🔴 Is the isolated TI budget actually reviewed by Finance anywhere? Correctly separated from the
   main budget, but doesn't appear in any report yet.
3. 🟠 Should a milestone's date slip auto-push every dependent milestone, or need PM review first?
   Fully automatic today.
4. 🟠 When a slipped milestone is linked to a draw schedule, should the lender's draw date move too?
   Only the milestone date shifts today.
5. 🟠 Should resolving a snag require an "after" photo, like daily logs do? No photo requirement
   exists today.
6. 🟠 Should milestone photos require sign-off before a phase counts complete? Uploading one has zero
   effect on status today.
7. 🟢 Snagging/punch-list is already fully built end-to-end — still listed as "remaining work" in the
   roadmap doc; worth updating and confirming nothing's left beyond item 5.

**Updates Board**
8. 🟢 Does your Monday.com status set map cleanly onto the 4 built-in statuses + the new "Blocked" we
   added?
9. 🟢 Can one board item ever span two buildings? Current design assumes no.

## 7. Revenue & Financials

Draws/Budgets/Loans were addressed in a prior feedback round, code-complete but never walked
through end-to-end with the client.

1. 🔴 Should every report (portfolio/sales/revenue/debt) be scoped by Organization (US/India), or is
   blending intentional? Every report mixes both today with no filter.
2. 🟠 Should capital calls/distributions stay manual entry, or tie to milestones/budget shortfalls
   like SalePayment installments?
3. 🟠 Should distributions calculate pro-rata automatically from ownership %? No pro-rata math exists
   anywhere today.
4. 🟠 Should capital-call/distribution entries require a second approver, like discount approvals and
   draw approvals do? Both fire instantly today.
5. 🟠 How do investors actually receive statements today (email/spreadsheet/print)? No way to attach
   a document to an investor, no PDF export — no in-app delivery path exists.
6. 🟢 Should overdue capital calls auto-flag, like sale-payment installments and milestones already
   do?
7. 🟢 Confirm the 3 distribution types (Return of Capital / Preferred Return / Profit Share) are the
   complete list.
8. 🟢 Worth a walkthrough: the original 6-item Draws/Budgets/Loans list is code-complete but
   unconfirmed against your actual workflow (one item — draw attachments seeming broken — was a
   permissions bug, since fixed).

## 8. Everything Else

**Documents**
1. 🔴 Should moving a sale to Under Contract/Closed require a specific document (LOI, Booking
   Agreement) attached first? Nothing enforces this today.
2. 🔴 Do permits/NOCs/possession certificates need expiry dates with reminders? No expiry field
   exists today.
3. 🟠 When is the buyer-visible document flag actually meant to go live? Exists in the schema, unused
   in code. Same timing question as the buyer portal (Projects item 1).

**Leads & Campaigns**
4. 🟠 Does the marketing channel list (Meta, Google Ads, Newspaper, Broker, Email, Signage, Event,
   Other) cover everywhere Prime spends? Feeds the already-built ROI dashboards.
5. 🟠 Does the built-in lead-to-sale conversion likelihood (5%→75% by stage) match how Sales reads
   the funnel? Drives the campaign ROI numbers.
6. 🟢 Is automatic ad-spend syncing from Meta/Google wanted, or is manual entry from agency reports
   sufficient long-term?

**Notifications**
7. 🔴 A newly assigned lead triggers no notification at all today — toggle exists in Settings but
   nothing fires it.
8. 🟠 Same gap on Interior/Fit-Out — phase-change and handover-due alerts are toggleable but silent.
9. 🟢 Is the existing 30-second in-app refresh fast enough once lead-assignment alerts are wired up?

**Integrations**
10. 🔴 QuickBooks — live credentials + sync direction (pull only, as built, or push too)?
11. 🔴 Cost-code list — every synced bill lands in a generic "Other" category today with no real
    mapping.
12. 🔴 BuilderTrend↔Bill.com — still needs API access + confirmed integration tier; #1 manual-effort
    pain point, nothing started.
13. 🟠 Do you need QuickBooks vendor/payment records actually persisted and matched to draw requests,
    or is Bills-only sufficient? Today they're only counted, never saved.

**Data migration & program-level**
14. 🔴 Historical data migration — history/volume/format/horizon/exclusions? Nothing built yet.
15. 🟢 Is offline access a v1 priority, or is normal online access acceptable?
16. 🟢 Any non-English/RTL requirement for the India team?
17. 🟢 Not a build question: success criteria at 3 months, internal champion, what would make you
    stop using it?

---

## Already settled — not being re-asked

- Externals (lenders/lawyers/investors/brokers) get no login.
- Free rent is abated (33×rent across a 36mo/3-free term), not grossed up.
- Historical lease backfill is manual entry by Sales, Founder-approved deletion.
- NNN is one-time at signing, not monthly.
- A signed-but-not-started lease now correctly sets its unit to Lease Pending.
- Interior/fit-out is per-sqft, same PM, can't enter Procurement/Execution before shell complete.
- Multiple interior projects can now run on the same unit concurrently.
- Combining units permanently merges them — does not group units that each keep separate leases.
- Daily construction logs with photos are fully built.
- Broker commissions support flat or % structures, stamped at close.
- Notifications are email + in-app; WhatsApp is deferred deliberately.
- Investor equity is tracked per-project, not blended into one portfolio number.
- All approvals are single-signoff, no dual-approval chains.
- Currency is USD only across both entities.
